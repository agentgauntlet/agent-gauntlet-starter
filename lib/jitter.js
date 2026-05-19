// Timing helpers.
//
// ⚠️  DELIBERATELY BAD DEFAULTS.
//
// The functions below are real and work, but the default values produce
// timing that AgentGauntlet's behavioral telemetry layer (Layer 4) will
// flag. Specifically, uniform delays in the 50–200ms range trigger
// signals like `uniform_keystroke_timing`, `synthetic_click_dwell`,
// `superhuman_reaction_time`.
//
// Your job: tune these. Watch what's in signal_counts after a run
// (sessionResult() returns it) and adjust until the behavioral signals
// stop firing. Hint: humans aren't uniform, they vary by 5x or more
// between the fastest and slowest action, with occasional pauses an order
// of magnitude longer for thinking.

'use strict';

/**
 * Sleep for a fixed time. Bad — humans never pause for exactly 200ms.
 * Use jitter() instead.
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Sleep for a random time in [min, max). Better — but the default range
 * here is way too narrow (200–400ms). Real humans deliberate, get
 * distracted, re-read. A scenario step often takes 1–5 seconds, with
 * occasional outliers at 10+ seconds.
 */
function jitter(min = 200, max = 400) {
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Sleep for a roughly log-normal distribution with median `medianMs` and
 * a fat tail. More human-like than uniform random because it produces
 * occasional long pauses (re-reading the page, looking at notes) mixed
 * with shorter routine actions.
 *
 * `spread` controls the standard deviation of the underlying normal
 * distribution. 0.5 ≈ ±60% of median typical; 1.0 ≈ very wide.
 *
 * This is more realistic but still hand-wavy — you can do better with
 * real human timing data from cart-checkout sessions you record.
 */
function humanPause(medianMs = 800, spread = 0.5) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random() || 1e-9;
  // Box–Muller for a standard normal sample
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = medianMs * Math.exp(z * spread);
  return new Promise(r => setTimeout(r, Math.max(30, ms)));
}

module.exports = { sleep, jitter, humanPause };
