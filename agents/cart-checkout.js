// Example agent: cart-checkout.
//
// Single-file, ~150 lines, deliberately under-tuned.
// The point is to demonstrate the API/Playwright/LLM seams — not to give
// you a winning solution. Read every line, then beat it.
//
// What you'll find here that you should improve:
//   1. Bad LLM prompts ("what should I click?") — make them specific
//   2. Stock Playwright launch — leaks navigator.webdriver, viewport, etc.
//   3. No deliberation pauses — clicks land in 0ms (synthetic_click_dwell)
//   4. No anti-honeypot DOM check — relies entirely on vision
//   5. No retry on transient failures
//   6. Pure click-the-first-thing fallback when LLM is unavailable
//
// What this agent DOES do right:
//   - Calls /api/session/:id/result after the run so the runner can print
//     which signals fired and why your score is what it is
//
// Flow:
//   1. POST /api/v2/session (mode=cv) → sessionId, token, tasks, scenarioUrl
//   2. Open scenarioUrl in Playwright
//   3. POST /api/v2/fingerprint with the browser's real fingerprint values
//   4. For each step, screenshot + ask the LLM + click the answer
//   5. Return { sessionId } so the runner fetches the result

'use strict';

const { humanPause } = require('../lib/jitter');

module.exports = async function cartCheckout({ page, aggClient, llm, baseUrl }) {
  // ── 1. Start a CV-mode session ─────────────────────────────────────────
  let res = await aggClient.authedFetch('/api/v2/session', {
    method: 'POST',
    body:   JSON.stringify({ mode: 'cv' }),
  });
  if (!res.ok) throw new Error(`session start failed: ${res.status} ${await res.text()}`);
  const session = await res.json();
  const { sessionId, token, tasks, scenarioUrl } = session;
  console.log(`  session: ${sessionId}`);

  // ── 2. Open the scenario page ──────────────────────────────────────────
  await page.goto(scenarioUrl, { waitUntil: 'networkidle' });

  // ── 3. Submit the browser fingerprint ───────────────────────────────────
  // The platform requires this before /api/v2/step will accept any answer.
  // The fingerprint helper deliberately collects the BROWSER'S real values
  // — if you're running stock headless Chrome, expect a few hard hits at
  // this stage. Strip what you can in your Playwright launch args.
  const fp = await page.evaluate(() => ({
    userAgent:    navigator.userAgent,
    platform:     navigator.platform,
    language:     navigator.language,
    screenWidth:  screen.width,
    screenHeight: screen.height,
    webdriver:    navigator.webdriver,
    hasChrome:    !!window.chrome,
    plugins:      Array.from(navigator.plugins || []).map(p => p.name),
    timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  res = await aggClient.authedFetch('/api/v2/fingerprint', {
    method: 'POST',
    body:   JSON.stringify({ sessionId, token, fingerprint: fp }),
  });
  if (!res.ok) {
    console.warn(`  fingerprint submit returned ${res.status}`);
  }

  // ── 4. Walk through the 3 steps ────────────────────────────────────────
  // Each step: wait for the UI to render → screenshot → ask LLM → click.
  // The page advances itself when you click; we don't POST step answers
  // directly — the page does that for us.

  await runStep(1, tasks.step1, 'cart-item-name',     '#cart-items li',                            page, llm);
  await runStep(2, tasks.step2, 'shipping-option',    '#shipping-options',                          page, llm);
  await runStep(3, tasks.step3, 'non-recommended-btn','#step3-buttons button',                      page, llm);

  // Wait for the terminal card to appear
  await page.waitForSelector('h2.text-green-700, h2.text-red-700', { timeout: 15_000 }).catch(() => {});

  return { sessionId };
};

// ── Helpers ──────────────────────────────────────────────────────────────

async function runStep(num, task, kind, selector, page, llm) {
  console.log(`  step ${num}: ${task}`);

  // Wait for the step's UI to appear. The cart-checkout page reveals
  // sections progressively.
  await page.waitForSelector(selector, { timeout: 15_000 }).catch(() => {});
  await humanPause(800, 0.5);  // ← deliberation pause; tune me

  const llmProvider = (process.env.LLM_PROVIDER || 'none').toLowerCase();
  let answer;

  if (llmProvider === 'none') {
    // No LLM available — naive fallback: click the first matching element.
    // Almost certainly wrong, but the agent still completes a run so you
    // can read the result endpoint.
    console.log(`  (no LLM — clicking the first candidate; expect a low score)`);
    answer = null;
  } else {
    const screenshot = await page.screenshot({ fullPage: true });
    // ⚠️  DELIBERATELY BAD PROMPT
    // This prompt is what an agent author writes in 5 seconds. Better
    // prompts: include the exact constraints from `task`, ask for ONLY
    // the answer with no preamble, specify the format (exact string,
    // one word, etc.). See doc/hackathon/02-anti-detection-cookbook.md
    // for prompt tactics.
    const prompt = `${task}\n\nLook at the screenshot. Reply with ONLY the exact text of the item to click. No explanation.`;
    try {
      const out = await llm.vision({ prompt, image: screenshot, maxTokens: 80 });
      answer = out.text.trim();
      console.log(`  llm answer (${out.tokensIn}/${out.tokensOut} tok, $${out.costUsd.toFixed(4)}): "${answer}"`);
    } catch (err) {
      console.warn(`  llm call failed: ${err.message}`);
      answer = null;
    }
  }

  // Click the answer if we have one; otherwise click the first option.
  const locator = answer
    ? page.locator(selector).filter({ hasText: answer }).first()
    : page.locator(selector).first();

  // ⚠️  Clicking immediately = synthetic_click_dwell signal fires. Hover
  // first, deliberate a beat, THEN click. Mouse motion + dwell time
  // matter as much as which thing you click.
  await locator.click();
}
