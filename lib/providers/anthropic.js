// Anthropic Claude provider plugin.
//
// Docs: https://docs.anthropic.com/en/api/messages
//
// Pricing (per-million-token, claude-sonnet-4-6 as of 2026-05):
//   input  $3, output $15
// Update PRICING below if you switch models or prices change. Values are
// rough — track them yourself if cost matters.

'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages';

const PRICING = {
  // [in $/MTok, out $/MTok]
  'claude-sonnet-4-6':    [3,    15],
  'claude-opus-4-1':      [15,   75],
  'claude-haiku-4-5':     [0.8,   4],
};

function priceFor(model, tokensIn, tokensOut) {
  const p = PRICING[model] || PRICING['claude-sonnet-4-6'];
  return (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000;
}

async function callAnthropic({ model, system, messages, maxTokens = 1024, temperature = 0.3 }) {
  const res = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'x-api-key':         process.env.LLM_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model,
      system:      system || undefined,
      messages,
      max_tokens:  maxTokens,
      temperature,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = (json.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  const tokensIn  = json.usage?.input_tokens  ?? 0;
  const tokensOut = json.usage?.output_tokens ?? 0;
  return {
    text,
    tokensIn,
    tokensOut,
    costUsd: priceFor(model, tokensIn, tokensOut),
    raw:     json,
  };
}

async function chat({ system, messages, maxTokens, temperature, model }) {
  return callAnthropic({ model, system, messages, maxTokens, temperature });
}

async function vision({ system, prompt, image, maxTokens, model }) {
  const base64 = Buffer.isBuffer(image) ? image.toString('base64') : image;
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
      { type: 'text', text: prompt },
    ],
  }];
  return callAnthropic({ model, system, messages, maxTokens, temperature: 0.2 });
}

module.exports = {
  chat,
  vision,
  defaultModel: 'claude-sonnet-4-6',
  name:         'anthropic',
};
