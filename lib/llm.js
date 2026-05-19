// Provider-agnostic LLM adapter.
//
// Picks a provider at runtime from LLM_PROVIDER env var. Each provider
// plugin exposes a uniform { chat, vision, name, defaultModel } interface
// — your agent code calls llm.chat(...) or llm.vision(...) without knowing
// which backend is behind it.
//
// Why no SDK dependencies?
//   The four providers (Anthropic, OpenAI, Google, none) total ~150 lines.
//   Pulling in @anthropic-ai/sdk + openai + @google/generative-ai would
//   add ~30MB to node_modules for code that wraps fetch. The bundle stays
//   tiny, you can read every byte that talks to a provider, and switching
//   providers takes a single env-var change.
//
// What this template DELIBERATELY does not give you:
//   - Pre-tuned prompts. The example agent uses a deliberately bad prompt
//     so you can discover that better prompts win.
//   - Caching, structured outputs, function calling, streaming. Add what
//     you need.
//   - Cost optimization. Track tokensIn/tokensOut on every call (returned
//     from chat/vision) and decide if you're paying for value.
//
// Uniform return shape from chat() and vision():
//   {
//     text:        '...',     // the model's response
//     tokensIn:    123,        // approximate input tokens
//     tokensOut:   456,        // approximate output tokens
//     costUsd:     0.0042,     // approximate cost (provider's published rate)
//     provider:    'anthropic',
//     model:       'claude-sonnet-4-6',
//     raw:         { ... },    // full provider response, for debugging
//   }

'use strict';

const PROVIDERS = {
  anthropic: require('./providers/anthropic'),
  openai:    require('./providers/openai'),
  google:    require('./providers/google'),
  none:      require('./providers/none'),
};

function resolve() {
  const name = (process.env.LLM_PROVIDER || 'none').toLowerCase().trim();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown LLM_PROVIDER='${name}'. Valid: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  if (name !== 'none' && !process.env.LLM_API_KEY) {
    throw new Error(`LLM_API_KEY is required when LLM_PROVIDER='${name}'`);
  }
  const model = process.env.LLM_MODEL || provider.defaultModel;
  return { provider, model, name };
}

/**
 * Send a chat completion request.
 *
 * @param {Object} opts
 * @param {string} opts.system        system prompt
 * @param {Array<{role,content}>} opts.messages  user/assistant turns
 * @param {number} [opts.maxTokens]   default 1024
 * @param {number} [opts.temperature] default 0.3
 */
async function chat(opts) {
  const { provider, model, name } = resolve();
  const out = await provider.chat({ ...opts, model });
  return { provider: name, model, ...out };
}

/**
 * Send a vision request. The image is a Buffer or base64 string (PNG/JPEG).
 *
 * @param {Object} opts
 * @param {string} opts.system        system prompt
 * @param {string} opts.prompt        instruction
 * @param {Buffer|string} opts.image  PNG/JPEG bytes or base64 string
 * @param {number} [opts.maxTokens]   default 1024
 */
async function vision(opts) {
  const { provider, model, name } = resolve();
  if (!provider.vision) {
    throw new Error(`Provider '${name}' does not support vision`);
  }
  const out = await provider.vision({ ...opts, model });
  return { provider: name, model, ...out };
}

function info() {
  const { name, model } = resolve();
  return { provider: name, model };
}

module.exports = { chat, vision, info };
