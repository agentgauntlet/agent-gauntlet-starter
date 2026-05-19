// OpenAI provider plugin.
//
// Docs: https://platform.openai.com/docs/api-reference/chat
//
// Pricing (per-million-token, gpt-4o as of 2026-05):
//   input $2.50, output $10
// Update PRICING below if you switch models. Vision goes through the same
// chat/completions endpoint with image content parts.

'use strict';

const API_URL = 'https://api.openai.com/v1/chat/completions';

const PRICING = {
  // [in $/MTok, out $/MTok]
  'gpt-4o':         [2.5,  10],
  'gpt-4o-mini':    [0.15,  0.6],
  'gpt-4-turbo':    [10,   30],
  'o1-mini':        [3,    12],
};

function priceFor(model, tokensIn, tokensOut) {
  const p = PRICING[model] || PRICING['gpt-4o'];
  return (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000;
}

async function callOpenAi({ model, system, messages, maxTokens = 1024, temperature = 0.3 }) {
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;
  const res = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'authorization': `Bearer ${process.env.LLM_API_KEY}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify({
      model,
      messages:    fullMessages,
      max_tokens:  maxTokens,
      temperature,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || '';
  const tokensIn  = json.usage?.prompt_tokens     ?? 0;
  const tokensOut = json.usage?.completion_tokens ?? 0;
  return {
    text,
    tokensIn,
    tokensOut,
    costUsd: priceFor(model, tokensIn, tokensOut),
    raw:     json,
  };
}

async function chat({ system, messages, maxTokens, temperature, model }) {
  return callOpenAi({ model, system, messages, maxTokens, temperature });
}

async function vision({ system, prompt, image, maxTokens, model }) {
  const base64 = Buffer.isBuffer(image) ? image.toString('base64') : image;
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
    ],
  }];
  return callOpenAi({ model, system, messages, maxTokens, temperature: 0.2 });
}

module.exports = {
  chat,
  vision,
  defaultModel: 'gpt-4o',
  name:         'openai',
};
