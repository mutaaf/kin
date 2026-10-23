// Ported from COLD GAS (src/ai/detect.js): the established one-paste key detection.
// Which provider a pasted key belongs to, from its shape alone. Pure: the client uses it to
// connect without asking, the Worker uses it when the client says "auto".
//
//   Anthropic  sk-ant-…            xAI (Grok)  xai-…
//   OpenAI     sk-proj-… / sk-…    Google      AIza… (39 chars)
//
// Keys from look-alike services get a friendly "not this one" instead of a failed call.
export type Provider = 'anthropic' | 'openai' | 'xai' | 'gemini';

const LOOKALIKES: [RegExp, string][] = [
  [/^gsk_/, 'That’s a Groq key (Groq with a q). KIN works with xAI’s Grok: those keys start with xai-.'],
  [/^sk-or-/, 'That’s an OpenRouter key. Paste a key from Anthropic, OpenAI, xAI or Google instead.'],
  [/^r8_/, 'That’s a Replicate key. Paste a key from Anthropic, OpenAI, xAI or Google instead.'],
  [/^hf_/, 'That’s a Hugging Face token. Paste a key from Anthropic, OpenAI, xAI or Google instead.'],
  [/^pplx-/, 'That’s a Perplexity key. Paste a key from Anthropic, OpenAI, xAI or Google instead.'],
  [/^ghp_|^github_pat_/, 'That’s a GitHub token, not an AI key. Don’t share it; paste an AI provider key instead.'],
];

export function cleanKey(raw: unknown): string {
  // People paste with quotes, "Bearer ", spaces or a trailing newline.
  return String(raw || '').trim().replace(/^["'`]|["'`]$/g, '').replace(/^Bearer\s+/i, '').replace(/^\w+_API_KEY\s*=\s*/, '').trim();
}

export function detectProvider(raw: unknown): { provider: Provider | null; key: string; reason?: string } {
  const key = cleanKey(raw);
  if (!key) return { provider: null, key, reason: '' };
  for (const [re, reason] of LOOKALIKES) if (re.test(key)) return { provider: null, key, reason };
  if (/^sk-ant-/.test(key)) return { provider: 'anthropic', key };
  if (/^xai-/.test(key)) return { provider: 'xai', key };
  if (/^AIza[\w-]{30,}$/.test(key)) return { provider: 'gemini', key };
  if (/^sk-(proj-|svcacct-|admin-)?[\w-]{20,}$/.test(key)) return { provider: 'openai', key };
  if (key.length < 20) return { provider: null, key, reason: 'That looks too short to be a key. Copy the whole thing.' };
  return { provider: null, key, reason: 'We couldn’t tell whose key that is. Keys from Anthropic start sk-ant-, OpenAI sk-, xAI xai-, Google AIza.' };
}
