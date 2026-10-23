// Which brain the AI director uses. Stored on this device only. A bring-your-own key never leaves
// the browser except as a header on our own /kin/api calls, which use it for one request to that
// provider and keep nothing. (Same contract as COLD GAS.)
import type { Provider } from './detect';

export type AIProvider = 'edge' | Provider;
export interface AIChoice {
  provider: AIProvider;
  model: string;
  key?: string;
}

const KEY = 'kin_ai_v1';

export const PROVIDER_INFO: Record<AIProvider, { label: string; vendor: string; keyUrl?: string; steps?: string }> = {
  edge: { label: 'Cloudflare Edge', vendor: 'Workers AI · open model' },
  anthropic: { label: 'Anthropic', vendor: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys', steps: 'Sign in, then Create Key' },
  openai: { label: 'OpenAI', vendor: 'GPT', keyUrl: 'https://platform.openai.com/api-keys', steps: 'Sign in, then Create new secret key' },
  xai: { label: 'xAI', vendor: 'Grok', keyUrl: 'https://console.x.ai', steps: 'Sign in, then API Keys, then Create' },
  gemini: { label: 'Google', vendor: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', steps: 'Sign in, then Create API key' },
};

export const EDGE_DEFAULT: AIChoice = { provider: 'edge', model: '@cf/google/gemma-4-26b-a4b-it' };

export function loadAI(): AIChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as AIChoice | null;
    if (v && v.provider in PROVIDER_INFO && (v.provider === 'edge' || (v.key && v.model))) return v;
  } catch {
    /* storage blocked or corrupt */
  }
  return { ...EDGE_DEFAULT };
}

export function saveAI(v: AIChoice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}

export function forgetAI() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

export const shortModel = (m: string) => String(m || '').replace(/^@cf\/[^/]+\//, '').replace(/-instruct.*$|-it$/, '');

/** claude-haiku-5-5 → Claude Haiku 5.5 · gpt-5.4-nano → GPT-5.4 Nano · gemma-4-26b-a4b-it → Gemma 4 */
export function nice(m: string): string {
  const id = shortModel(m);
  if (/^gemma-4/.test(id)) return 'Gemma 4';
  if (/^llama-3\.1-8b/.test(id)) return 'Llama 3.1 8B';
  const cap = (w: string) => (/^\d/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1));
  const words = id.replace(/-(\d+)-(\d+)(?=$|-)/g, ' $1.$2').split(/[-\s]+/).filter(Boolean);
  if (words[0] === 'gpt' && words[1]) return `GPT-${words[1]} ${words.slice(2).map(cap).join(' ')}`.trim();
  return words.map(cap).join(' ');
}

export const aiLabel = (ai = loadAI()) => (ai.provider === 'edge' ? 'Free edge brain' : `Your ${PROVIDER_INFO[ai.provider].vendor} key`);
