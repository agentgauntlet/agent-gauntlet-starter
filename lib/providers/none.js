// "None" provider — no LLM is configured.
//
// Calling chat() or vision() throws a clear error pointing at how to
// configure a real provider. This is the default — many of the seven
// AgentGauntlet scenarios don't actually need an LLM (bank-login,
// payment-checkout, auction, crypto-exchange all yield to pure DOM
// scraping). Don't reach for an LLM unless your strategy genuinely
// benefits from one — the No-LLM Hero category exists for a reason.

'use strict';

function explain() {
  throw new Error(
    'LLM_PROVIDER is "none" (or unset). Set LLM_PROVIDER and LLM_API_KEY ' +
    'in .env to use Anthropic, OpenAI, or Google. Or solve this scenario ' +
    'without an LLM — most can be.',
  );
}

module.exports = {
  chat:         () => explain(),
  vision:       () => explain(),
  defaultModel: 'none',
  name:         'none',
};
