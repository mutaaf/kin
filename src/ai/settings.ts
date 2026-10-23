// "Your own AI": one box, one action (the established COLD GAS flow). Paste any AI key and it's
// done: the provider is recognised from the key, the key is checked against the provider's live
// model list, the cheapest current fast model is chosen, and it's saved. The model can still be
// changed under "Advanced".
import { listModels } from './client';
import { EDGE_DEFAULT, forgetAI, loadAI, nice, PROVIDER_INFO, saveAI, type AIChoice, type AIProvider } from './config';
import { detectProvider } from './detect';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function openAISettings(onChange?: (ai: AIChoice) => void) {
  const root = document.createElement('div');
  root.className = 'ai-scrim';
  document.getElementById('hud')!.append(root);
  let cur = loadAI();
  let timer = 0;
  let seq = 0;

  const statusLine = () =>
    cur.provider === 'edge'
      ? `<span class="ai-dot free"></span>Free: <b>${esc(nice(cur.model))}</b> on Cloudflare's edge`
      : `<span class="ai-dot"></span>Your ${esc(PROVIDER_INFO[cur.provider].label)} key: <b>${esc(nice(cur.model))}</b>`;

  root.innerHTML = `
    <div class="sheet ai-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-title">
      <div class="ai-top"><h2 id="ai-title">Your own AI</h2><button type="button" class="btn" data-close>Close</button></div>
      <p class="sub">Your KIN's thoughts come from a free open model by default. Paste a key to use Claude, GPT, Grok or Gemini instead.</p>
      <p class="ai-status" data-status>${statusLine()}</p>
      <label class="ai-paste" for="ai-key">
        <span class="label">Paste any AI key</span>
        <span class="ai-row">
          <input id="ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…  sk-…  xai-…  AIza…" data-key />
          <button type="button" class="btn" data-eye>Show</button>
          <button type="button" class="btn" data-clip>Paste</button>
        </span>
      </label>
      <p class="ai-result" data-result aria-live="polite">Works with Anthropic (Claude), OpenAI (GPT), xAI (Grok) and Google (Gemini). We work out which one it is.</p>
      <div class="label">No key yet? Get one in a minute</div>
      <div class="ai-get">
        ${(['anthropic', 'openai', 'xai', 'gemini'] as AIProvider[]).map((id) => `
          <a class="ai-tile" href="${PROVIDER_INFO[id].keyUrl}" target="_blank" rel="noopener noreferrer">
            <b>${PROVIDER_INFO[id].vendor}</b><span>${PROVIDER_INFO[id].label}</span><i>${PROVIDER_INFO[id].steps} ↗</i></a>`).join('')}
      </div>
      <p class="ai-privacy">Your key stays on this device. For each thought it goes once to KIN's own server on mutaafaziz.com, which uses it for that one call and keeps nothing. Your provider bills you, usually a fraction of a cent per thought.</p>
      <div class="row">
        <button type="button" class="btn primary" data-done>Done</button>
        <button type="button" class="btn" data-free ${cur.provider === 'edge' ? 'hidden' : ''}>Use the free brain</button>
        <details class="ai-adv" data-adv hidden><summary>Advanced</summary><select data-model aria-label="Model"></select></details>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const input = $<HTMLInputElement>('[data-key]');
  const result = $('[data-result]');
  setTimeout(() => input.focus(), 50);
  const say = (html: string, kind = '') => {
    result.innerHTML = html;
    result.className = `ai-result ${kind}`;
  };
  const refresh = () => {
    $('[data-status]').innerHTML = statusLine();
    $('[data-free]').hidden = cur.provider === 'edge';
  };

  async function connect(raw: string) {
    const d = detectProvider(raw);
    if (!d.key) return say('Works with Anthropic (Claude), OpenAI (GPT), xAI (Grok) and Google (Gemini). We work out which one it is.');
    if (!d.provider) return say(esc(d.reason ?? ''), 'bad');
    const info = PROVIDER_INFO[d.provider];
    say(`<span class="ai-spin"></span>That's ${/^[AEIOU]/.test(info.label) ? 'an' : 'a'} ${esc(info.label)} key. Checking it…`, 'busy');
    const mine = ++seq;
    const res = await listModels(d.key);
    if (mine !== seq) return; // a newer paste won
    if (res.error || !res.models) return say(`${esc(res.error ?? 'Could not check that key.')}${/rejected/.test(res.error ?? '') ? ' Check you copied the whole key, and that it hasn’t been revoked.' : ''}`, 'bad');
    const model = res.suggested || res.models[0]!;
    cur = { provider: (res.provider as AIProvider) || d.provider, key: d.key, model };
    saveAI(cur);
    onChange?.(cur);
    refresh();
    say(`✓ Done. Your KIN now thinks with <b>${esc(nice(model))}</b> (${esc(info.label)}).`, 'ok');
    const sel = $<HTMLSelectElement>('[data-model]');
    sel.innerHTML = res.models.map((m) => `<option value="${esc(m)}"${m === model ? ' selected' : ''}>${esc(m)}${m === res.suggested ? ' (cheapest fast, recommended)' : ''}</option>`).join('');
    $('[data-adv]').hidden = false;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => connect(input.value), 450);
  });
  input.addEventListener('paste', () => {
    clearTimeout(timer);
    setTimeout(() => connect(input.value), 0);
  });
  const close = () => {
    clearTimeout(timer);
    root.remove();
    removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => e.target === root && close());
  $('[data-close]').onclick = close;
  $('[data-done]').onclick = close;
  $('[data-eye]').onclick = (e) => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    (e.target as HTMLElement).textContent = show ? 'Hide' : 'Show';
  };
  $('[data-clip]').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      input.value = t;
      void connect(t);
    } catch {
      say('Your browser blocked reading the clipboard. Tap the box and paste instead.', 'bad');
      input.focus();
    }
  };
  $('[data-free]').onclick = () => {
    forgetAI();
    cur = { ...EDGE_DEFAULT };
    onChange?.(cur);
    refresh();
    input.value = '';
    say('Back on the free brain. Your key has been removed from this device.', 'ok');
  };
  $<HTMLSelectElement>('[data-model]').onchange = (e) => {
    cur = { ...cur, model: (e.target as HTMLSelectElement).value };
    saveAI(cur);
    onChange?.(cur);
    refresh();
  };
}
