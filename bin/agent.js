#!/usr/bin/env node
//
// Generic agent runner.
//
// Usage:
//   npm run agent -- cart-checkout
//   npm run agent -- cart-checkout --headful
//
// Looks for `agents/<name>.js`, calls its default export, prints the
// final result and the structured /api/session/:id/result payload.
//
// Every agent module should export a single function with signature:
//
//   module.exports = async function (ctx) { ... }
//
// where `ctx` provides browser tooling, LLM access, and the API client.

'use strict';

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { chromium } = require('playwright');
const aggClient    = require('../lib/agg-client');
const llm          = require('../lib/llm');

function parseArgs(argv) {
  const out = { headful: process.env.HEADFUL === 'true' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headful') out.headful = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!out.scenario) out.scenario = a;
  }
  return out;
}

function listAgents() {
  const dir = path.join(__dirname, '..', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.slice(0, -3));
}

function printHelp() {
  console.log(`Usage: npm run agent -- <name> [--headful]

Available agents:
${listAgents().map(n => '  - ' + n).join('\n') || '  (none — add files to agents/<name>.js)'}

Flags:
  --headful   Show the browser window (default: headless)

Env:
  AG_KEY          your AgentGauntlet API key (required)
  AG_BASE_URL     default https://agentgauntlet.ai
  LLM_PROVIDER    anthropic | openai | google | none (default: none)
  LLM_API_KEY     required if LLM_PROVIDER != none
  LLM_MODEL       optional model override`);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.scenario) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const agentPath = path.join(__dirname, '..', 'agents', `${args.scenario}.js`);
  if (!fs.existsSync(agentPath)) {
    console.error(`No agent at ${agentPath}.`);
    console.error(`Available: ${listAgents().join(', ') || '(none)'}`);
    process.exit(1);
  }

  // Verify the API key works before bothering with a browser launch.
  let keyInfo;
  try {
    keyInfo = await aggClient.whoami();
  } catch (err) {
    console.error(`AG_KEY check failed: ${err.message}`);
    console.error('Get a key at https://agentgauntlet.ai/keys.html');
    process.exit(1);
  }

  const { provider: llmProvider, model: llmModel } = llm.info();
  console.log(`▶ Scenario:       ${args.scenario}`);
  console.log(`  Base URL:       ${aggClient.baseUrl()}`);
  console.log(`  Key:            ${keyInfo.name || '(unnamed)'} (${keyInfo.tier})`);
  console.log(`  LLM:            ${llmProvider}${llmProvider === 'none' ? '' : ` / ${llmModel}`}`);
  console.log(`  Mode:           ${args.headful ? 'headful' : 'headless'}`);
  console.log('');

  const agent = require(agentPath);
  if (typeof agent !== 'function') {
    console.error(`Agent ${agentPath} must export a default async function (ctx).`);
    process.exit(1);
  }

  const t0      = Date.now();
  const browser = await chromium.launch({ headless: !args.headful });
  const context = await browser.newContext({
    // Deliberately stock defaults. Customize what your agent needs.
    viewport:  { width: 1280, height: 800 },
    locale:    'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  let outcome;
  try {
    outcome = await agent({
      page,
      context,
      browser,
      aggClient,
      llm,
      baseUrl: aggClient.baseUrl(),
    });
  } catch (err) {
    console.error(`\n✗ Agent threw: ${err.message}`);
    console.error(err.stack);
    outcome = { sessionId: null, error: err.message };
  } finally {
    await browser.close();
  }

  const elapsedMs = Date.now() - t0;
  console.log(`\n— Run done in ${(elapsedMs / 1000).toFixed(1)}s`);

  if (outcome?.sessionId) {
    try {
      const result = await aggClient.sessionResult(outcome.sessionId);
      console.log('\n  Result:');
      console.log(`    Session ID:  ${result.session_id}`);
      console.log(`    Scenario:    ${result.scenario || args.scenario}`);
      console.log(`    Outcome:     ${result.outcome}`);
      console.log(`    Risk score:  ${result.risk_score} (${result.risk_tier})`);
      console.log(`    Elapsed:     ${result.elapsed_ms}ms`);
      if (result.signal_counts && Object.keys(result.signal_counts).length > 0) {
        console.log('\n  Signals fired:');
        const entries = Object.entries(result.signal_counts).sort((a, b) => b[1] - a[1]);
        for (const [sig, count] of entries) console.log(`    - ${sig}: ${count}`);
        console.log('\n  Tune your agent to stop these from firing. Lower score wins.');
      } else if (result.signal_counts) {
        console.log('\n  Signals fired: none. Nice run.');
      }
    } catch (err) {
      console.warn(`\n  Could not fetch session result: ${err.message}`);
    }
  } else {
    console.log('\n  No session id returned — agent did not call POST /api/session/start.');
  }

  process.exit(outcome?.error ? 1 : 0);
})();
