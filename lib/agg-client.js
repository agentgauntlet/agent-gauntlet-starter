// Tiny wrapper around AgentGauntlet's public API.
//
// Handles:
//   - Bearer auth from process.env.AG_KEY
//   - Base URL from process.env.AG_BASE_URL (default https://agentgauntlet.ai)
//   - Modest exponential-backoff retry on 5xx / network errors (3 tries)
//   - Reading the structured /api/session/:id/result endpoint after each run
//
// What it deliberately does NOT do:
//   - Pre-tune any humanization (timing, mouse motion) — that's your job
//   - Avoid honeypots / decoys — read the DOM yourself
//   - Add stealth flags to Playwright — figure out what the platform sees
//
// The whole point of this template is to make the toolchain trivial and
// the strategy your problem. The closer you stay to the API surface, the
// better placed you are to debug your own runs from /api/session/:id/result.

'use strict';

const DEFAULT_BASE = 'https://agentgauntlet.ai';

function getKey() {
  const key = process.env.AG_KEY;
  if (!key || !key.startsWith('agg_')) {
    throw new Error('AG_KEY environment variable is required and must start with "agg_". ' +
                    'Get one at https://agentgauntlet.ai/keys.html');
  }
  return key;
}

function baseUrl() {
  return (process.env.AG_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

async function authedFetch(pathOrUrl, opts = {}, attempt = 1) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl()}${pathOrUrl}`;
  const headers = {
    'Authorization': `Bearer ${getKey()}`,
    'Accept':        'application/json',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...opts.headers,
  };
  try {
    const res = await fetch(url, { ...opts, headers });
    // Retry on 5xx — these are transient. 4xx is your problem to fix.
    if (res.status >= 500 && attempt < 3) {
      await new Promise(r => setTimeout(r, 300 * attempt));
      return authedFetch(pathOrUrl, opts, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 300 * attempt));
      return authedFetch(pathOrUrl, opts, attempt + 1);
    }
    throw err;
  }
}

/**
 * Look up your own key info (tier, daily limit, runs today).
 * Useful for verifying your key works before starting a run.
 */
async function whoami() {
  const res = await authedFetch('/api/keys/me');
  if (!res.ok) throw new Error(`whoami failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Fetch the structured result of a session. Read this after EVERY run —
 * it's how you discover which signals fired and why your agent got the
 * score it did.
 *
 * Returns shape (paid/event tier participants see signal_counts; free tier
 * sees a coarser summary):
 *   {
 *     session_id, scenario, outcome: 'complete'|'block'|...,
 *     risk_score, risk_tier, elapsed_ms,
 *     signal_counts: { synthetic_click_dwell: 3, uniform_keystroke_timing: 1, ... }
 *   }
 */
async function sessionResult(sessionId) {
  const res = await authedFetch(`/api/session/${encodeURIComponent(sessionId)}/result`);
  if (!res.ok) throw new Error(`sessionResult failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = {
  authedFetch,
  whoami,
  sessionResult,
  baseUrl,
};
