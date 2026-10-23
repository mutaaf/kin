// Client for the AI director: POST /kin/api/think (server-sent events) and the BYOK connect call.
import type { AIChoice } from './config';
import type { Card, Thought } from './schema';

const API = `${import.meta.env.BASE_URL === './' ? 'https://mutaafaziz.com/kin/' : import.meta.env.BASE_URL}api`;
// Local dev has no Worker: talk to production, like the relay does.
const base = () => (/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) ? 'https://mutaafaziz.com/kin/api' : API);

export interface ThinkHandlers {
  prompt?: (e: { provider: string; model: string; colo: string | null; system: string; user: string }) => void;
  token?: (e: { text: string }) => void;
  done?: (e: { thought: Thought | null; errors: string[]; usage: { inTokens: number; outTokens: number; neurons: number }; cost: number | null; ms: number; ttft: number }) => void;
  error?: (e: { message: string; fallback?: boolean }) => void;
}

export async function think(card: Card, ai: AIChoice, on: ThinkHandlers, signal?: AbortSignal) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ai.provider !== 'edge' && ai.key) headers['x-kin-key'] = ai.key;
  let res: Response;
  try {
    res = await fetch(`${base()}/think`, { method: 'POST', headers, signal, body: JSON.stringify({ card, provider: ai.provider, model: ai.model }) });
  } catch {
    on.error?.({ message: 'The thought-reader is offline.', fallback: true });
    return;
  }
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    on.error?.({ message: res.status === 429 ? 'Lots of thinking from here this hour. Try again soon.' : b.error === 'key' ? 'That key looks malformed.' : 'The thought-reader is offline.', fallback: true });
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
      const ev = /^event: (.+)$/m.exec(block)?.[1] as keyof ThinkHandlers | undefined;
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!ev || !data) continue;
      try {
        (on[ev] as ((d: unknown) => void) | undefined)?.(JSON.parse(data));
      } catch (err) {
        console.warn('think event', ev, err);
      }
    }
  }
}

export async function listModels(key: string): Promise<{ provider?: string; models?: string[]; suggested?: string; error?: string }> {
  try {
    const res = await fetch(`${base()}/models`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kin-key': key }, body: JSON.stringify({ provider: 'auto' }) });
    const body = (await res.json().catch(() => ({}))) as { provider?: string; models?: string[]; suggested?: string; error?: string };
    return res.ok ? body : { error: body.error || 'Could not reach the provider.' };
  } catch {
    return { error: 'You appear to be offline.' };
  }
}
