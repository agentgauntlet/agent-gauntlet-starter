# agent-gauntlet-starter

Minimal starter template for building AI agents against [AgentGauntlet](https://agentgauntlet.ai)'s benchmark scenarios.

This repo gives you:
- Auth + retry wrapper around the AgentGauntlet API
- A provider-agnostic LLM adapter (Anthropic, OpenAI, Google, or none) with no SDK dependencies
- Playwright launcher + deliberately under-tuned timing helpers
- One working example agent for `cart-checkout`

It deliberately does **not** give you:
- Working agents for the other six scenarios — that's your job
- Pre-tuned prompts, mouse motion, typing rhythm, or honeypot detection
- A way to win without writing engineering

The platform rewards humanized browser behavior far more than picking a smart LLM. Spend your time on Layer 4 (behavioral telemetry), not on the model dropdown.

---

## 5-minute quickstart

```bash
# 1. Clone and install
git clone https://github.com/agentgauntlet/agent-gauntlet-starter.git
cd agent-gauntlet-starter
npm install

# 2. Get an AgentGauntlet API key
#    Go to https://agentgauntlet.ai/keys.html and sign in with GitHub.
#    Copy your agg_... key.

# 3. Configure
cp .env.example .env
# Edit .env — at minimum set AG_KEY. LLM_PROVIDER=none works for a first run.

# 4. Run the example agent
npm run agent -- cart-checkout

# 5. Read the output. The runner prints what signals fired.
#    Tune your code until those signals stop firing. Lower score wins.
```

If you want to use an LLM for the vision step:

```bash
# Pick one and set both in .env:
LLM_PROVIDER=anthropic   # or openai, or google
LLM_API_KEY=sk-...       # your own provider key
```

---

## Project layout

```
agent-gauntlet-starter/
├── package.json
├── .env.example
├── lib/
│   ├── agg-client.js          # Bearer auth, retry, /api/keys/me, /api/session/:id/result
│   ├── llm.js                 # provider-agnostic chat() + vision()
│   ├── providers/
│   │   ├── anthropic.js       # Claude — claude-sonnet-4-6 default
│   │   ├── openai.js          # GPT-4o default
│   │   ├── google.js          # Gemini 2.0 Flash default
│   │   └── none.js            # throws — for the No-LLM track
│   ├── jitter.js              # sleep / jitter / humanPause (BAD defaults)
│   └── human-typing.js        # typeHuman / typeJittered (BAD defaults)
├── bin/
│   └── agent.js               # `npm run agent -- <scenario>` runner
└── agents/
    └── cart-checkout.js       # the ONE example — deliberately under-tuned
```

You add new agents at `agents/<scenario-name>.js`. They get invoked by `npm run agent -- <scenario-name>`. Each agent exports an async function with this signature:

```js
module.exports = async function (ctx) {
  const { page, context, browser, aggClient, llm, baseUrl } = ctx;
  // ...
  return { sessionId: '...' };   // so the runner can fetch the result
};
```

---

## The seven scenarios

| Scenario | Vision needed? | LLM useful? | Hardest part |
|---|---|---|---|
| `cart-checkout` | Yes | Yes | Reading the right item from a screenshot |
| `payment-checkout` | No | Marginally | Multi-step decoy avoidance + step-up |
| `bank-login` | No | No | TOTP timing + honeypot avoidance |
| `product-search` | No | Yes (NL parsing) | Interpreting the search instruction |
| `auction` | No | No | Real-time bidding before timer |
| `crypto-exchange` | No | No | TOTP + 2-step state machine |
| `image-captcha` | Yes | Yes | Classifying 3×3 grid against a textual prompt |

**Four of these (bank-login, payment-checkout, auction, crypto-exchange) can be solved without an LLM at all.** The "No-LLM Hero" track exists for a reason — DOM scraping + careful state management often beats LLM smarts.

---

## How scoring works (short version)

AgentGauntlet's bot detection has four layers:

| Layer | Weight ceiling | What it sees |
|---|---|---|
| 1. HTTP headers | up to 90 | User-Agent, client headers, request shape |
| 2. TLS (JA3) | up to 80 | Your TLS handshake fingerprint |
| 3. Browser fingerprint | up to 80 | `navigator.webdriver`, plugins, viewport, canvas hash |
| 4. Behavioral telemetry | up to 60 | Mouse, keystrokes, click dwell, scroll patterns |

Score thresholds: `0–29 allow • 30–69 step-up • 70–100 block`.

**Lower score wins.** Plus there are "challenge gate" signals worth 100 weight each (honeypot, decoy clicks, wrong item) — any single one fires → instant block regardless of score.

Read `/api/session/:id/result` after every run — the runner does this for you and prints which signals fired. That's your debug loop.

---

## What you should improve in this template

When you run the example agent for the first time, expect a score of ~40–70 and a fistful of signals. The obvious things to fix:

1. **`navigator.webdriver = true`** — strip it with `page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });`
2. **Default headless viewport (800×600 or similar)** — set a real laptop size, e.g. 1440×900
3. **No mouse motion before clicks** — `synthetic_click_dwell` fires. Hover, deliberate, then click.
4. **Uniform typing delays** — `lib/human-typing.js` uses uniform 50ms. Vary it. Add inter-word pauses.
5. **Zero deliberation between steps** — `lib/jitter.js` has `humanPause()` with bad default median. Tune.
6. **Bad LLM prompts** — the example asks "what should I click?" with no context. Give the model the exact constraints, ask for ONE-WORD answers, etc.
7. **No DOM honeypot check before clicking** — make sure your target element is `display:!=none`, `visibility:!=hidden`, and within viewport before clicking.

The `/api/session/:id/result` payload tells you exactly which signals are firing. Use that as your test loop.

---

## Bring your own LLM key, or ask for one

**BYO is the default.** Set `LLM_PROVIDER` and `LLM_API_KEY` in `.env` with your own provider account. Pricing varies — see each provider's plugin in `lib/providers/` for the rough per-million-token rates baked in for cost tracking.

**At a hackathon event:** organizers may have a small pool of shared keys to hand out to participants without their own. Ask in the event Discord/Slack.

---

## License

MIT — see `LICENSE`.

---

## Hints, in spoiler order

<details>
<summary>Hint 1: which signals fire first?</summary>

Run the example agent and check the printed signal list. You'll almost certainly see:
- `navigator_webdriver` (Layer 3) — Playwright sets this. Strip it.
- `default_headless_viewport` (Layer 3) — set `viewport: { width: 1440, height: 900 }` in the browser context.
- `synthetic_click_dwell` (Layer 4) — your `locator.click()` lands instantly. Hover then click.
- `uniform_keystroke_timing` (Layer 4) — `lib/human-typing.js` uses uniform 50ms intervals.

Fixing those four should get your score below 40.
</details>

<details>
<summary>Hint 2: I'm getting blocked despite a low score</summary>

You probably hit a challenge gate — a 100-weight signal that bypasses the threshold check. Common ones:
- `honeypot_filled`: you typed into a hidden field. Check `element.offsetParent !== null` before filling.
- `clicked_decoy_step1`: you clicked a visually hidden button. Same visibility check before clicking.
- `wrong_item_step1`: your LLM picked the wrong cart item. Improve the prompt — give it the exact price range from `tasks.step1`.

The result endpoint shows the gate in `signal_counts`.
</details>

<details>
<summary>Hint 3: my agent works but I want to go for the No-LLM Hero category</summary>

Four scenarios (bank-login, payment-checkout, auction, crypto-exchange) have everything you need in the DOM. The `mode: 'cv'` session payload includes textual prompts already; for those four scenarios, the headless (non-CV) mode session payload includes the cart/options as structured JSON. Set `LLM_PROVIDER=none` and read the DOM directly.

For cart-checkout, image-captcha, and product-search, vision/NL helps. But even there, careful DOM parsing can extract the item names, prices, and instructions textually.
</details>
