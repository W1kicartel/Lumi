// Piccoli attrezzi dell'interfaccia: chiamate al server, creazione di elementi, avvisi, icone, formati.
import { t, numero, soldi, data, dataOra } from './lingua.js';

export class ErroreApi extends Error { constructor(stato, corpo) { super(corpo?.errore || t('comune.errore-n', { stato })); this.stato = stato; this.corpo = corpo || {}; } }
export async function api(metodo, percorso, corpo) {
  const r = await fetch('/api' + percorso, { method: metodo, credentials: 'same-origin',
    headers: { 'X-Kubo': '1', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) { if (r.status === 401 && !percorso.startsWith('/accedi')) location.hash = '#/accedi'; throw new ErroreApi(r.status, j); }
  return j;
}
export const get = p => api('GET', p);

// h('div.classe#id', { attributi, on: { click }, stile }, figli…)
export function h(tag, attr = {}, ...figli) {
  if (typeof attr !== 'object' || attr === null || attr instanceof Node || Array.isArray(attr)) { figli.unshift(attr); attr = {}; }
  const [nome, ...resto] = tag.split(/(?=[.#])/); const e = document.createElement(nome || 'div');
  for (const p of resto) p[0] === '.' ? e.classList.add(p.slice(1)) : (e.id = p.slice(1));
  for (const [k, v] of Object.entries(attr)) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f);
    else if (k === 'stile') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? e.style.setProperty(p, x) : (e.style[p] = x);
    else if (k === 'class') { for (const c of String(v).split(/\s+/)) if (c) e.classList.add(c); }
    else if (k === 'testo') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && !k.startsWith('aria') && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat(Infinity)) if (f != null && f !== false) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}
export const svuota = e => { while (e.firstChild) e.firstChild.remove(); return e; };

let tToast;
export function toast(testo, male = false) {
  document.querySelector('.toast')?.remove(); clearTimeout(tToast);
  const el = h('div.toast', { testo }); if (male) el.classList.add('male'); document.body.append(el);
  tToast = setTimeout(() => el.remove(), male ? 5000 : 2600);
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// icone a tratto (24×24), scelte per nome nell'entità («icona»)
const TRATTI = {
  persona: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  scatola: 'M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
  cassa: 'M4 10h16v10H4zM7 10V5h10v5M8 14h2m4 0h2m-8 3h8',
  furgone: 'M2 6h11v10H2zM13 9h4l4 4v3h-8M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  calendario: 'M4 6h16v14H4zM4 10h16M8 3v4m8-4v4',
  attrezzi: 'M14 6l4 4-9 9H5v-4l9-9Zm2-2 4 4',
  documento: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7m-7 4h7',
  cartella: 'M3 6h6l2 2h10v11H3z',
  stella: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  ingranaggio: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  utenti: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0M17 3a4 4 0 0 1 0 8m5 9a7 7 0 0 0-4-6.3',
  matita: 'M4 20h4L19 9l-4-4L4 16v4Z',
  griglia: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  esci: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
};
export function icona(nome) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icona');
  s.innerHTML = `<path d="${TRATTI[nome] || TRATTI.cartella}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`; return s;
}
export const NOMI_ICONE = Object.keys(TRATTI);

// formati
// numeri, valuta dell'azienda e date nel formato della lingua (lingua.js)
export const COLORI = ['grigio', 'verde', 'rosso', 'blu', 'giallo', 'viola'];
export function chip(o) { return h('span.chip', { stile: { '--c': `var(--${o?.colore || 'grigio'})` }, testo: o?.nome ?? '' }); }
export function formatta(c, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  const tipo = c.tipo === 'calcolato' ? c.formato || (typeof v === 'boolean' ? 'si_no' : typeof v === 'number' ? 'numero' : 'testo') : c.tipo;
  switch (tipo) {
    case 'valuta': return soldi(v);
    case 'numero': case 'durata': return numero(v);
    case 'percentuale': return t('comune.percento', { n: numero(v) });
    case 'si_no': return v ? t('comune.si') : t('comune.no');
    case 'data': return data(v);
    case 'data_ora': return dataOra(v);
    case 'scelta': case 'stato': return chip(c.opzioni?.find(o => o.id === v) || { nome: v });
    case 'scelta_multipla': return h('span', v.map(x => chip(c.opzioni?.find(o => o.id === x) || { nome: x })));
    case 'relazione': return Array.isArray(v) ? v.map(x => x.titolo).join(', ') : v.titolo ?? v;
    case 'immagine': return h('span.miniature', v.slice(0, 3).map(x => h('img', { src: x.url, alt: x.nome, loading: 'lazy' })), v.length > 3 ? `+${v.length - 3}` : null);
    case 'file': return v.map(x => x.nome).join(', ');
    default: return String(v);
  }
}
export const destra = c => ['valuta', 'numero', 'percentuale', 'durata'].includes(c.tipo === 'calcolato' ? c.formato || 'numero' : c.tipo);
