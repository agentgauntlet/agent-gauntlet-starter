// Typing helpers.
//
// ⚠️  DELIBERATELY BAD DEFAULTS.
//
// The default inter-key delay is uniform 50ms, which is exactly what
// AgentGauntlet's behavioral layer flags as `uniform_keystroke_timing`.
// You'll trigger it on your first run. Watch sessionResult() and tune.
//
// What humans actually do:
//   - Variable inter-key delays (40–200ms typically)
//   - Burst patterns: fast within a word, slower between words
//   - Occasional pauses for thinking, re-reading
//   - Backspaces and corrections
//   - Slower on punctuation, faster on common letter pairs
// You don't need all of that. You probably need most of it for behavioral
// signals to stop firing.

'use strict';

const { sleep, jitter } = require('./jitter');

/**
 * Type a string into a Playwright Locator one character at a time.
 *
 * Defaults are deliberately bad (uniform 50ms between keys). Better:
 *   - varied per-key delay
 *   - longer pause between words
 *   - occasional 300–800ms thinking pauses every few words
 *
 * @param {import('playwright').Locator} locator
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.perKeyMs=50]  uniform — change me
 */
async function typeHuman(locator, text, opts = {}) {
  const perKeyMs = opts.perKeyMs ?? 50;
  await locator.click();
  for (const ch of text) {
    await locator.press(ch === ' ' ? 'Space' : ch);
    await sleep(perKeyMs); // ← uniform delay — you'll trip uniform_keystroke_timing
  }
}

/**
 * Slightly better default: random per-key delay in a range. Still likely
 * to be flagged by `synthetic_keystroke_pattern` if the variance is too
 * narrow or the distribution looks too clean.
 */
async function typeJittered(locator, text, opts = {}) {
  const min = opts.minMs ?? 40;
  const max = opts.maxMs ?? 120;
  await locator.click();
  for (const ch of text) {
    await locator.press(ch === ' ' ? 'Space' : ch);
    await jitter(min, max);
  }
}

module.exports = { typeHuman, typeJittered };
