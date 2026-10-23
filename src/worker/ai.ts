// The AI director's providers (ported from COLD GAS src/worker/ai/providers.js, with plain fetch
// instead of SDKs to keep the Worker tiny). One shape for all: `stream()` is an async generator of
// text chunks that finishes with token usage.
//
// - edge:      Cloudflare Workers AI, free daily allowance (the default: no key needed)
// - anthropic: Claude Messages API
// - openai, xai, gemini: their OpenAI-compatible chat endpoints
//
// Bring-your-own keys arrive per request in `x-kin-key` and are used for that one call only:
// never stored, never logged. Base URLs are fixed here, so the Worker can't be pointed anywhere else,
// and the prompt is built server-side from a sanitised card, so it can't be used as an open relay.

export type ProviderId = 'edge' | 'anthropic' | 'openai' | 'xai' | 'gemini';

export const EDGE_MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-3.1-8b-instruct-fp8'];

export const PROVIDERS: Record<ProviderId, { label: string; needsKey: boolean; base?: string }> = {
  edge: { label: 'Cloudflare Edge', needsKey: false },
  anthropic: { label: 'Anthropic', needsKey: true, base: 'https://api.anthropic.com/v1' },
  openai: { label: 'OpenAI', needsKey: true, base: 'https://api.openai.com/v1' },
  xai: { label: 'xAI', needsKey: true, base: 'https://api.x.ai/v1' },
  gemini: { label: 'Google', needsKey: true, base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
};

// USD per million tokens, where known. null = billed by the provider at its own rates.
const PRICES: Record<string, [number, number]> = {
  '@cf/google/gemma-4-26b-a4b-it': [0.1, 0.3],
  '@cf/meta/llama-3.1-8b-instruct-fp8': [0.152, 0.287],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};
export const costUsd = (model: string, i: number, o: number) => {
  const p = PRICES[model];
  return p ? (i * p[0] + o * p[1]) / 1e6 : null;
};

// Pick a sensible, cheap, current chat model from a provider's live list (same rules as COLD GAS).
const PREFER: Record<string, RegExp[]> = {
  anthropic: [/^claude-haiku-\d/, /^claude-sonnet-\d/],
  openai: [/^gpt-\d+(\.\d+)?-nano$/, /^gpt-\d+(\.\d+)?-mini$/, /^gpt-\d+(\.\d+)?-nano/, /^gpt-\d+(\.\d+)?-mini/, /^gpt-\d/],
  xai: [/^grok-[\d.]+-fast(?!.*(image|vision))/, /fast/, /mini/, /^grok-[\d.]+$/, /^grok/],
  gemini: [/^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-flash-lite/, /^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash/, /^gemini/],
};
const NOT_CHAT = /(embed|tts|audio|realtime|transcri|whisper|dall|image|vision-preview|moderation|search|sora|video|veo|imagen|aqa|davinci|babbage|instruct$|codex|computer|live|native-audio|robotics|learnlm)/i;
const ver = (id: string) => (id.match(/\d+(\.\d+)?/g) || ['0']).map(Number);
const newer = (a: string, b: string) => {
  const va = ver(a);
  const vb = ver(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] || 0) - (vb[i] || 0);
    if (d) return d > 0;
  }
  return a.length < b.length;
};
export function pickModel(provider: ProviderId, ids: string[]): string | null {
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  for (const re of PREFER[provider] || []) {
    const hits = chat.filter((id) => re.test(id) && !/preview|exp|latest|\d{4}-\d{2}-\d{2}|\d{8}/.test(id));
    const pool = hits.length ? hits : chat.filter((id) => re.test(id));
    if (pool.length) return pool.reduce((best, id) => (newer(id, best) ? id : best));
  }
  return chat[0] ?? null;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const headersFor = (provider: ProviderId, key: string): Record<string, string> =>
  provider === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    : { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

export async function listModels(provider: ProviderId, key: string): Promise<string[]> {
  const p = PROVIDERS[provider];
  const res = await fetch(`${p.base}/models${provider === 'anthropic' ? '?limit=100' : ''}`, {
    headers: headersFor(provider, key),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(res.status);
  const j = (await res.json()) as { data?: { id: string }[] };
  return (j.data ?? []).map((m) => String(m.id).replace(/^models\//, ''));
}

export interface Usage {
  inTokens: number;
  outTokens: number;
  neurons: number;
}

/** Read an SSE body line by line, yielding each `data:` payload parsed as JSON. */
async function* sseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        /* partial or keep-alive line */
      }
    }
  }
}

type Chunk = { text: string };

interface StreamOpts {
  provider: ProviderId;
  env: { AI?: { run(model: string, body: unknown, opts?: unknown): Promise<unknown> } };
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export async function* stream(o: StreamOpts): AsyncGenerator<Chunk, Usage> {
  const usage: Usage = { inTokens: 0, outTokens: 0, neurons: 0 };
  const maxTokens = o.maxTokens ?? 300;
  if (o.provider === 'edge') {
    if (!o.env.AI) throw new HttpError(503);
    const body: Record<string, unknown> = { messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }], stream: true, max_tokens: maxTokens };
    if (/gemma-4|qwen3|glm/.test(o.model)) body.chat_template_kwargs = { enable_thinking: false };
    const rs = (await o.env.AI.run(o.model, body)) as ReadableStream<Uint8Array>;
    for await (const j of sseJson(rs)) {
      const choice = (j.choices as { delta?: { content?: string } }[] | undefined)?.[0];
      const t = choice?.delta?.content ?? (j.response as string | undefined);
      if (t) yield { text: t };
      const u = j.usage as { prompt_tokens?: number; completion_tokens?: number; neurons?: number } | undefined;
      if (u) {
        usage.inTokens += u.prompt_tokens ?? 0;
        usage.outTokens += u.completion_tokens ?? 0;
        usage.neurons += u.neurons ?? 0;
      }
    }
    return usage;
  }
  const p = PROVIDERS[o.provider];
  if (o.provider === 'anthropic') {
    const res = await fetch(`${p.base}/messages`, {
      method: 'POST',
      headers: headersFor('anthropic', o.key),
      body: JSON.stringify({ model: o.model, max_tokens: maxTokens, system: o.system, stream: true, messages: [{ role: 'user', content: o.user }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || !res.body) throw new HttpError(res.status);
    for await (const j of sseJson(res.body)) {
      if (j.type === 'content_block_delta') {
        const d = j.delta as { type?: string; text?: string };
        if (d.type === 'text_delta' && d.text) yield { text: d.text };
      } else if (j.type === 'message_start') {
        usage.inTokens = ((j.message as { usage?: { input_tokens?: number } }).usage?.input_tokens) ?? 0;
      } else if (j.type === 'message_delta') {
        usage.outTokens = ((j.usage as { output_tokens?: number } | undefined)?.output_tokens) ?? usage.outTokens;
        if ((j.delta as { stop_reason?: string } | undefined)?.stop_reason === 'refusal') throw Object.assign(new Error('The model declined.'), { userFacing: true });
      }
    }
    return usage;
  }
  // OpenAI-compatible (OpenAI, xAI, Gemini). Reasoning models get low effort; no output cap so
  // thinking can't starve the answer.
  const reasoning = (o.provider === 'openai' && /^(gpt-5|o\d)/.test(o.model)) || (o.provider === 'gemini' && /^gemini-(2\.5|[3-9])/.test(o.model));
  const body: Record<string, unknown> = { model: o.model, stream: true, messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }] };
  if (o.provider !== 'gemini') body.stream_options = { include_usage: true };
  if (reasoning) body.reasoning_effort = 'low';
  let res = await fetch(`${p.base}/chat/completions`, { method: 'POST', headers: headersFor(o.provider, o.key), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (res.status === 400) {
    // Some models reject optional parameters; retry once with the bare request.
    res = await fetch(`${p.base}/chat/completions`, { method: 'POST', headers: headersFor(o.provider, o.key), body: JSON.stringify({ model: o.model, stream: true, messages: body.messages }), signal: AbortSignal.timeout(30_000) });
  }
  if (!res.ok || !res.body) throw new HttpError(res.status);
  for await (const j of sseJson(res.body)) {
    const d = (j.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta;
    if (d?.content) yield { text: d.content };
    const u = j.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (u) {
      usage.inTokens = u.prompt_tokens ?? usage.inTokens;
      usage.outTokens = u.completion_tokens ?? usage.outTokens;
    }
  }
  return usage;
}

/** A short, key-free message for the player when a provider call fails. */
export function describeError(provider: ProviderId, err: unknown): string {
  const e = err as { userFacing?: boolean; message?: string; status?: number; name?: string };
  if (e?.userFacing) return e.message ?? 'The model declined.';
  const label = PROVIDERS[provider]?.label ?? provider;
  const status = e?.status;
  if (status === 401 || status === 403) return `${label} rejected the key.`;
  if (status === 404) return `${label} doesn't offer that model to this key.`;
  if (status === 429) return `${label} is rate-limiting this key right now.`;
  if (status === 402) return `${label} says the account is out of credit.`;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `${label} took too long to answer.`;
  return `${label} couldn't be reached.`;
}
