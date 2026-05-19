// Google Gemini provider plugin (via AI Studio API key).
//
// Docs: https://ai.google.dev/api/generate-content
//
// Pricing (per-million-token, gemini-2.0-flash as of 2026-05):
//   input $0.10, output $0.40
// Free tier exists for low-volume use — handy for hackathon participants
// without a paid Anthropic or OpenAI plan. Update PRICING below if you
// switch models.

'use strict';

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.LLM_API_KEY)}`;
}

const PRICING = {
  // [in $/MTok, out $/MTok]
  'gemini-2.0-flash':       [0.1, 0.4],
  'gemini-2.0-flash-lite':  [0.0375, 0.15],
  'gemini-2.5-pro':         [1.25, 5],
};

function priceFor(model, tokensIn, tokensOut) {
  const p = PRICING[model] || PRICING['gemini-2.0-flash'];
  return (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000;
}

function toGoogleContents(system, messages) {
  // Gemini's API takes `contents` (user/model turns) plus an optional
  // `systemInstruction`. Map OpenAI/Anthropic-style messages onto it.
  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: Array.isArray(m.content)
      ? m.content
      : [{ text: String(m.content) }],
  }));
  return { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined };
}

async function callGoogle({ model, system, messages, maxTokens = 1024, temperature = 0.3 }) {
  const body = {
    ...toGoogleContents(system, messages),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  const res = await fetch(endpoint(model), {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google ${res.status}: ${t.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('');
  const tokensIn  = json.usageMetadata?.promptTokenCount      ?? 0;
  const tokensOut = json.usageMetadata?.candidatesTokenCount  ?? 0;
  return {
    text,
    tokensIn,
    tokensOut,
    costUsd: priceFor(model, tokensIn, tokensOut),
    raw:     json,
  };
}

async function chat({ system, messages, maxTokens, temperature, model }) {
  return callGoogle({ model, system, messages, maxTokens, temperature });
}

async function vision({ system, prompt, image, maxTokens, model }) {
  const base64 = Buffer.isBuffer(image) ? image.toString('base64') : image;
  const messages = [{
    role: 'user',
    content: [
      { text: prompt },
      { inlineData: { mimeType: 'image/png', data: base64 } },
    ],
  }];
  return callGoogle({ model, system, messages, maxTokens, temperature: 0.2 });
}

module.exports = {
  chat,
  vision,
  defaultModel: 'gemini-2.0-flash',
  name:         'google',
};
