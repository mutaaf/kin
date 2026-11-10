import { describe, it, expect } from 'vitest';
import { describeError, stream } from '../src/worker/ai';

describe('the free brain through Prompter', () => {
  it("says plainly when today's shared allowance is used up", () => {
    const err = new Error("Prompter: today's shared AI allowance for kin is used up. It resets at 00:00 UTC.");
    expect(describeError('edge', err)).toMatch(/resting until 00:00 UTC/);
  });

  it('keeps the last cumulative usage, not the sum', async () => {
    const lines = ['data: {"response":"hi","usage":{"prompt_tokens":10,"completion_tokens":1,"neurons":0.2}}\n\n', 'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"neurons":0.5}}\n\n', 'data: [DONE]\n\n'];
    const env = { AI: { run: async () => new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l)); c.close(); } }) } };
    const it = stream({ provider: 'edge', env, model: '@cf/meta/llama-3.1-8b-instruct-fp8', system: 's', user: 'u' } as never);
    let r; while (!(r = await it.next()).done) { /* drain */ }
    expect(r.value).toEqual({ inTokens: 10, outTokens: 2, neurons: 0.5 });
  });
});
