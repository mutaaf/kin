// Client for the AI director: POST /kin/api/{think,ask,analyze,snack} (server-sent events) and the
// BYOK connect call. Every call streams the same events: prompt → token… → done | error.
import type { AIChoice } from './config';
import type { Card, Thought } from './schema';

const API = `${import.meta.env.BASE_URL === './' ? 'https://mutaafaziz.com/kin/' : import.meta.env.BASE_URL}api`;
// Local dev has no Worker: talk to production, like the relay does.
const base = () => (/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) ? 'https://mutaafaziz.com/kin/api' : API);

export type DirectorKind = 'think' | 'ask' | 'analyze' | 'snack';

export interface Done<R> {
  kind?: DirectorKind;
  thought?: Thought | null;
  result: R | null;
  errors: string[];
  usage: { inTokens: number; outTokens: number; neurons: number };
  cost: number | null;
  ms: number;
  ttft: number;
}

export interface Handlers<R> {
  prompt?: (e: { kind?: DirectorKind; provider: string; model: string; colo: string | null; system: string; user: string }) => void;
  token?: (e: { text: string }) => void;
  done?: (e: Done<R>) => void;
  error?: (e: { message: string; fallback?: boolean }) => void;
}

/** Back-compat name used by the original theatre. */
export type ThinkHandlers = Handlers<Thought>;

const OFFLINE: Record<DirectorKind, string> = {
  think: 'The thought-reader is offline.',
  ask: 'Your KIN can’t hear the question right now.',
  analyze: 'The reading is offline.',
  snack: 'The snack kitchen is offline.',
};

export async function direct<R>(kind: DirectorKind, body: Record<string, unknown>, ai: AIChoice, on: Handlers<R>, signal?: AbortSignal) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ai.provider !== 'edge' && ai.key) headers['x-kin-key'] = ai.key;
  let res: Response;
  try {
    res = await fetch(`${base()}/${kind}`, { method: 'POST', headers, signal, body: JSON.stringify({ ...body, provider: ai.provider, model: ai.model }) });
  } catch {
    on.error?.({ message: OFFLINE[kind], fallback: true });
    return;
  }
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    const msg =
      res.status === 429 ? 'Lots of thinking from here this hour. Try again soon.'
        : b.error === 'key' ? 'That key looks malformed.'
          : b.error === 'question' ? 'Try asking that a different way.'
            : b.error === 'topic' ? 'Try a different topic.'
              : OFFLINE[kind];
    on.error?.({ message: msg, fallback: true });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1] as keyof Handlers<R> | undefined;
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!ev || !data) continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        // Servers from before `result` existed only sent `thought`.
        if (ev === 'done' && parsed.result === undefined) parsed.result = parsed.thought ?? null;
        (on[ev] as ((d: unknown) => void) | undefined)?.(parsed);
      } catch (err) {
        console.warn('director event', ev, err);
      }
    }
  }
}

export const think = (card: Card, ai: AIChoice, on: Handlers<Thought>, signal?: AbortSignal) => direct('think', { card }, ai, on, signal);

export async function listModels(key: string): Promise<{ provider?: string; models?: string[]; suggested?: string; error?: string }> {
  try {
    const res = await fetch(`${base()}/models`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kin-key': key }, body: JSON.stringify({ provider: 'auto' }) });
    const body = (await res.json().catch(() => ({}))) as { provider?: string; models?: string[]; suggested?: string; error?: string };
    return res.ok ? body : { error: body.error || 'Could not reach the provider.' };
  } catch {
    return { error: 'You appear to be offline.' };
  }
}

/** "Feed it a topic": an AI-baked, validated snack card, or the local fallback. No theatre. */
export async function snackFromTopic(topic: string, ai: AIChoice): Promise<{ card: import('./schema').TopicCard; source: 'model' | 'local' }> {
  const { cleanTopic, localTopicCard } = await import('./schema');
  const t = cleanTopic(topic);
  if (!t) throw new Error('topic');
  let card: import('./schema').TopicCard | null = null;
  await direct<import('./schema').TopicCard>('snack', { topic: t }, ai, { done: (e) => (card = e.result) });
  return card ? { card, source: 'model' } : { card: localTopicCard(t), source: 'local' };
}
