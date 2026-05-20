// Example agent: cart-checkout.
//
// Single-file, ~150 lines, deliberately under-tuned.
// The point is to demonstrate the API/Playwright/LLM seams — not to give
// you a winning solution. Read every line, then beat it.
//
// What you'll find here that you should improve:
//   1. Bad LLM prompt ("what should I click?") — make it specific
//   2. Stock Playwright launch — leaks navigator.webdriver, viewport, etc.
//   3. No deliberation pauses — clicks land in 0ms (synthetic_click_dwell)
//   4. No anti-honeypot DOM check — relies entirely on vision
//   5. No retry on transient failures
//   6. Pure click-the-first-thing fallback when LLM is unavailable
//
// What this agent DOES do right:
//   - Returns the sessionId so the runner can print signal_counts from
//     /api/session/:id/result — that's how you discover what to fix
//
// Flow (CV mode):
//   1. POST /api/v2/session (mode=cv) → sessionId, token, tasks, scenarioUrl
//   2. Open scenarioUrl in Playwright. The page itself handles session
//      resume + fingerprint submission + step POSTs to the server. We
//      only navigate and click.
//   3. For each step: wait for UI → screenshot + LLM (or first-match
//      fallback) → click the answer.
//   4. Return { sessionId }.

'use strict';

const { humanPause } = require('../lib/jitter');

module.exports = async function cartCheckout({ page, aggClient, llm }) {
  let sessionId = null;
  try {
    // ── 1. Start a CV-mode session ────────────────────────────────────────
    const res = await aggClient.authedFetch('/api/v2/session', {
      method: 'POST',
      body:   JSON.stringify({ mode: 'cv' }),
    });
    if (!res.ok) throw new Error(`session start failed: ${res.status} ${await res.text()}`);
    const session = await res.json();
    const { tasks, scenarioUrl } = session;
    sessionId = session.sessionId;
    console.log(`  session: ${sessionId}`);

    // ── 2. Open the scenario page ──────────────────────────────────────────
    // The page's own JS submits the fingerprint and resumes the session
    // automatically once it loads — we don't post fingerprint ourselves.
    await page.goto(scenarioUrl, { waitUntil: 'networkidle' });

    // ── 3. Walk through the 3 steps ───────────────────────────────────────
    // Each step: wait for the UI to render → screenshot → ask LLM → click.
    // The page advances itself when you click; we don't POST step answers
    // directly — the page does that for us.
    await runStep(1, tasks.step1, '#cart-items [data-item-id]', page, llm);
    await runStep(2, tasks.step2, '#shipping-options button',   page, llm);
    await runStep(3, tasks.step3, '#step3-buttons button',      page, llm);

    // Wait for the terminal card to appear
    await page.waitForSelector('h2.text-green-700, h2.text-red-700', { timeout: 15_000 }).catch(() => {});

    return { sessionId };
  } catch (err) {
    // Always return sessionId so the runner can still fetch the result —
    // even when we crashed before all three steps completed, the
    // /api/session/:id/result endpoint tells us which signals fired
    // and what went wrong.
    console.error(`  step error: ${err.message}`);
    return { sessionId, error: err.message };
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────

async function runStep(num, task, selector, page, llm) {
  console.log(`  step ${num}: ${task}`);

  // Wait for the step's UI to appear. The cart-checkout page reveals
  // sections progressively.
  await page.waitForSelector(selector, { timeout: 15_000 }).catch(() => {});
  await humanPause(800, 0.5);  // ← deliberation pause; tune me

  const llmProvider = (process.env.LLM_PROVIDER || 'none').toLowerCase();
  let answer = null;

  if (llmProvider === 'none') {
    // No LLM available — naive fallback: click the first matching
    // element. Almost certainly wrong, but the run still completes so
    // you can read the result endpoint.
    console.log(`  (no LLM — clicking first candidate; expect a bad score)`);
  } else {
    const screenshot = await page.screenshot({ fullPage: true });
    // ⚠️  DELIBERATELY BAD PROMPT.
    // This prompt is what an agent author writes in 5 seconds. Better
    // prompts: include the exact constraints from `task`, ask for ONLY
    // the answer with no preamble, specify the format (exact string,
    // one word, etc.). See doc/hackathon/02-anti-detection-cookbook.md
    // for prompt tactics.
    const prompt = `${task}\n\nLook at the screenshot. Reply with ONLY the exact text of the item to click. No explanation.`;
    try {
      const out = await llm.vision({ prompt, image: screenshot, maxTokens: 80 });
      answer = out.text.trim();
      console.log(`  llm (${out.tokensIn}in/${out.tokensOut}out, $${out.costUsd.toFixed(4)}): "${answer}"`);
    } catch (err) {
      console.warn(`  llm call failed: ${err.message}`);
    }
  }

  // Click the answer if we have one; otherwise click the first option.
  const locator = answer
    ? page.locator(selector).filter({ hasText: answer }).first()
    : page.locator(selector).first();

  // ⚠️  Clicking immediately = synthetic_click_dwell signal fires. Hover
  // first, deliberate a beat, THEN click. Mouse motion + dwell time
  // matter as much as which thing you click.
  await locator.click({ timeout: 10_000 });
}
