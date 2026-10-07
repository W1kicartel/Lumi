// Il costruttore dei filtri: campo → operatore adatto al tipo → valore con l'editor giusto (opzioni, relazione con
// ricerca, date con «oggi / questa settimana / questo mese»). I filtri si salvano «come li ha scritti la persona»
// (es. { op: 'periodo', valore: 'mese' }) e diventano filtri del server solo al momento della richiesta (risolvi),
// così una vista salvata «questo mese» resta questo mese anche il mese prossimo.
import { h, get, chip } from './ui.js';
import { editor } from './campi.js';

// il foglio di stile del costruttore e dei popover, una volta sola
if (!document.querySelector('link[href="/filtri.css"]')) document.head.append(h('link', { rel: 'stylesheet', href: '/filtri.css' }));

const TESTI = ['testo', 'testo_lungo', 'email', 'telefono', 'url', 'codice_a_barre', 'contatore', 'indirizzo'];
const NUMERI = ['numero', 'valuta', 'percentuale', 'durata'];
export const SISTEMA = [{ id: 'creato', nome: 'Creato il', tipo: 'data_ora' }, { id: 'modificato', nome: 'Modificato il', tipo: 'data_ora' }];
const PERIODI = { oggi: 'oggi', ieri: 'ieri', settimana: 'questa settimana', mese: 'questo mese', ultimi_7: 'ultimi 7 giorni', ultimi_30: 'ultimi 30 giorni', anno: "quest'anno" };
const NOMI_OP = { '=': 'è', '!=': 'non è', '>': '>', '>=': '≥', '<': '<', '<=': '≤', tra: 'fra', contiene: 'contiene', inizia: 'inizia con', vuoto: 'è vuoto', nonvuoto: 'non è vuoto',
  in: 'è uno di', periodo: '', prima: 'prima del', dopo: 'dal', vero: 'è vero', falso: 'è falso', si: 'sì', no: 'no' };

// un calcolato senza formato: è un sì/no se la formula è un confronto (giacenza <= soglia), un numero se fa conti
const tipoCalcolato = c => c.formato || (/^\s*SE\s*\(/i.test(c.formula || '') ? 'testo' : /(<=|>=|<>|[<>=]|\bE\b|\bO\b|\bNON\b|\bVUOTO\b)/.test(c.formula || '') ? 'si_no' : /[-+*/]|SOMMA|MEDIA|ARROTONDA/i.test(c.formula || '') ? 'numero' : 'testo');
export const tipoDi = c => (c.tipo === 'calcolato' ? tipoCalcolato(c) : c.tipo);
export function operatori(c) {
  const t = tipoDi(c);
  if (TESTI.includes(t)) return ['contiene', '=', 'inizia', 'vuoto', 'nonvuoto'];
  if (NUMERI.includes(t)) return ['=', '!=', '>=', '<=', '>', '<', 'tra', 'vuoto', 'nonvuoto'];
  if (['data', 'data_ora'].includes(t)) return ['periodo', 'prima', 'dopo', 'tra', 'vuoto', 'nonvuoto'];
  if (t === 'si_no') return ['si', 'no'];
  if (['scelta', 'stato'].includes(t)) return ['in', 'vuoto', 'nonvuoto'];
  if (t === 'scelta_multipla') return ['contiene', 'vuoto'];
  if (t === 'relazione' && !c.molti) return ['=', 'vuoto', 'nonvuoto'];
  if (t === 'utente') return ['=', 'vuoto', 'nonvuoto'];
  return [];
}
export const filtrabili = def => [...def.campi.filter(c => !c.archiviato && operatori(c).length), ...SISTEMA];
const campoDi = (def, id) => def.campi.find(c => c.id === id) || SISTEMA.find(c => c.id === id);

// ---------- date locali ----------
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const piu = (g, n) => { const [y, m, d] = g.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
const mezzanotte = g => { const [y, m, d] = g.split('-').map(Number); return new Date(y, m - 1, d).toISOString(); };
export function periodoLocale(nome, oggi = iso(new Date())) {
  const dow = (new Date(oggi + 'T12:00:00').getDay() + 6) % 7, m = /^ultimi_(\d+)$/.exec(nome);
  if (m) return [piu(oggi, -(Number(m[1]) - 1)), oggi];
  switch (nome) {
    case 'oggi': return [oggi, oggi];
    case 'ieri': return [piu(oggi, -1), piu(oggi, -1)];
    case 'settimana': return [piu(oggi, -dow), piu(oggi, 6 - dow)];
    case 'mese': { const p = oggi.slice(0, 8) + '01'; const [y, mm] = p.split('-').map(Number); return [p, iso(new Date(y, mm, 0))]; }
    case 'anno': return [oggi.slice(0, 4) + '-01-01', oggi.slice(0, 4) + '-12-31'];
  }
  return [oggi, oggi];
}
// da filtro «della persona» a filtri del server
let io = null; get('/stato').then(s => { io = s.utente?.id; }).catch(() => {});
export function risolvi(def, filtri) {
  return filtri.flatMap(f => {
    const c = campoDi(def, f.campo); if (!c) return [];
    const t = tipoDi(c), ora = t === 'data_ora';
    const fra = (da, a) => (ora ? [{ campo: f.campo, op: '>=', valore: mezzanotte(da) }, { campo: f.campo, op: '<', valore: mezzanotte(piu(a, 1)) }] : [{ campo: f.campo, op: '>=', valore: da }, { campo: f.campo, op: '<=', valore: a }]);
    switch (f.op) {
      case 'periodo': return fra(...periodoLocale(f.valore));
      case 'tra': return ['data', 'data_ora'].includes(t) ? fra(f.valore[0], f.valore[1]) : [{ campo: f.campo, op: 'tra', valore: f.valore }];
      case 'prima': return [{ campo: f.campo, op: '<', valore: ora ? mezzanotte(f.valore) : f.valore }];
      case 'dopo': return [{ campo: f.campo, op: '>=', valore: ora ? mezzanotte(f.valore) : f.valore }];
      case 'si': return [{ campo: f.campo, op: '=', valore: true }];
      case 'no': return [{ campo: f.campo, op: '=', valore: false }];
      case 'contiene': return [{ campo: f.campo, op: 'contiene', valore: t === 'scelta_multipla' ? `"${f.valore}"` : f.valore }];
      case '=': return [{ campo: f.campo, op: '=', valore: f.valore === '@io' ? io : f.valore?.id ?? f.valore }];
      default: return [{ campo: f.campo, op: f.op, valore: f.valore?.id ?? f.valore }];
    }
  });
}

// ---------- etichetta del filtro ----------
let persone = null;
export const caricaPersone = () => (persone ||= get('/agenda-persone').catch(() => []));
export function etichetta(def, f) {
  const c = campoDi(def, f.campo); if (!c) return f.campo;
  const v = f.valore, data = x => (x ? new Date(x + 'T12:00:00').toLocaleDateString('it-IT') : '…');
  let testo;
  if (f.op === 'periodo') testo = PERIODI[v] || v;
  else if (['vuoto', 'nonvuoto', 'si', 'no', 'vero', 'falso'].includes(f.op)) testo = NOMI_OP[f.op];
  else if (f.op === 'in') testo = (v || []).map(x => c.opzioni?.find(o => o.id === x)?.nome || x).join(' o ');
  else if (f.op === 'tra') testo = ['data', 'data_ora'].includes(tipoDi(c)) ? `${data(v?.[0])} – ${data(v?.[1])}` : `${v?.[0]} e ${v?.[1]}`;
  else if (['prima', 'dopo'].includes(f.op)) testo = `${NOMI_OP[f.op]} ${data(v)}`;
  else if (f.op === 'contiene' && tipoDi(c) === 'scelta_multipla') testo = `contiene ${c.opzioni?.find(o => o.id === v)?.nome || v}`;
  else testo = `${NOMI_OP[f.op] || f.op} ${v === '@io' ? 'me' : v?.titolo ?? v?.nome ?? v}`;
  return f.op === 'in' || f.op === 'periodo' ? `${c.nome}: ${testo}` : `${c.nome} ${testo}`;
}

// ---------- popover ----------
export function apriPop(ancora, contenuto, { largo = false } = {}) {
  document.querySelector('.pop')?.chiudi?.();
  const pop = h('div.pop', { class: largo ? 'largo' : '' }, contenuto);
  const r = ancora.getBoundingClientRect();
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - (largo ? 420 : 340)))}px`;
  const fuori = ev => { if (!pop.contains(ev.target) && !ancora.contains(ev.target) && !ev.target.closest?.('.rel .menu')) pop.chiudi(); };
  const esc = ev => { if (ev.key === 'Escape') pop.chiudi(); };
  pop.chiudi = () => { pop.remove(); document.removeEventListener('mousedown', fuori, true); document.removeEventListener('keydown', esc); };
  setTimeout(() => { document.addEventListener('mousedown', fuori, true); document.addEventListener('keydown', esc); });
  document.body.append(pop); pop.querySelector('select,input')?.focus();
  return pop;
}

// ---------- il costruttore: chip dei filtri + «+ Filtro» ----------
// opz: { cambia(filtri) }. Restituisce l'elemento; .imposta(filtri) lo ridisegna con altri filtri.
export function costruttore(def, filtri, { cambia, schema }) {
  let attuali = [...(filtri || [])];
  const barra = h('div.filtri');
  const aggiorna = () => { disegna(); cambia([...attuali]); };
  function disegna() {
    const piu = h('button.btn.piccolo', { type: 'button', testo: '+ Filtro', on: { click: () => modifica(piu, null) } });
    barra.replaceChildren(...attuali.map((f, i) => {
      const el = h('span.filtro', h('span.filtro-t', { testo: etichetta(def, f), title: 'Cambia il filtro', on: { click: () => modifica(el, i) } }),
        h('button', { type: 'button', title: 'Togli', testo: '×', on: { click: () => { attuali.splice(i, 1); aggiorna(); } } }));
      return el;
    }), piu, ...(attuali.length > 1 ? [h('button.btn.piccolo.nudo', { type: 'button', testo: 'Togli tutti', on: { click: () => { attuali = []; aggiorna(); } } })] : []));
  }
  function modifica(ancora, i) {
    const f = i == null ? null : attuali[i];
    const campi = filtrabili(def);
    const sCampo = h('select.campo', h('option', { value: '', testo: 'Scegli il campo…' }), campi.map(c => h('option', { value: c.id, testo: c.nome, selected: f?.campo === c.id })));
    const sOp = h('select.campo'), zonaValore = h('div.pop-valore'), err = h('div.errore-campo');
    let leggiValore = () => null;
    const disegnaOp = () => {
      const c = campoDi(def, sCampo.value); if (!c) { sOp.replaceChildren(); zonaValore.replaceChildren(); return; }
      const ops = operatori(c);
      sOp.replaceChildren(...ops.map(o => h('option', { value: o, testo: o === 'periodo' ? 'nel periodo' : NOMI_OP[o], selected: f?.campo === c.id ? f.op === o : false })));
      disegnaValore();
    };
    const disegnaValore = () => {
      const c = campoDi(def, sCampo.value), op = sOp.value, t = tipoDi(c), v = f?.campo === c.id && f.op === op ? f.valore : null;
      leggiValore = () => null; zonaValore.replaceChildren();
      if (['vuoto', 'nonvuoto', 'si', 'no'].includes(op)) return;
      if (op === 'periodo') {
        let scelto = v || 'oggi';
        const bott = Object.entries(PERIODI).map(([k, n]) => h('button.btn.piccolo', { type: 'button', class: k === scelto ? 'pieno' : '', testo: n, on: { click: ev => { scelto = k; bott.forEach(b => b.classList.remove('pieno')); ev.currentTarget.classList.add('pieno'); } } }));
        zonaValore.append(h('div.pop-scelte', bott)); leggiValore = () => scelto; return;
      }
      if (['data', 'data_ora'].includes(t)) {
        const a = h('input.campo', { type: 'date', value: (op === 'tra' ? v?.[0] : v) || '' }), b = h('input.campo', { type: 'date', value: v?.[1] || '' });
        zonaValore.append(op === 'tra' ? h('div.pop-due', a, b) : a);
        leggiValore = () => (op === 'tra' ? (a.value && b.value ? [a.value, b.value] : undefined) : a.value || undefined); return;
      }
      if (op === 'in') {
        const sc = new Set(v || []);
        zonaValore.append(h('div.pop-scelte', c.opzioni.map(o => h('label.pop-opz', h('input', { type: 'checkbox', checked: sc.has(o.id), on: { change: ev => { ev.target.checked ? sc.add(o.id) : sc.delete(o.id); } } }), chip(o)))));
        leggiValore = () => (sc.size ? [...sc] : undefined); return;
      }
      if (t === 'scelta_multipla') {
        const s = h('select.campo', c.opzioni.map(o => h('option', { value: o.id, testo: o.nome, selected: v === o.id }))); zonaValore.append(s); leggiValore = () => s.value; return;
      }
      if (t === 'relazione') {
        const e = editor({ ...c, molti: false }, v, { schema }); let titolo = v?.titolo;
        e.addEventListener('scelto', ev => { titolo = ev.detail?.titolo; });
        zonaValore.append(e); leggiValore = () => { const id = e.leggi(); return id ? { id, titolo: titolo ?? id } : undefined; }; return;
      }
      if (t === 'utente') {
        const s = h('select.campo', h('option', { value: '@io', testo: 'Io' })); zonaValore.append(s);
        caricaPersone().then(l => { s.append(...l.map(p => h('option', { value: p.id, testo: p.nome }))); if (v) s.value = v.id ?? v; });
        leggiValore = () => (s.value === '@io' ? '@io' : { id: s.value, nome: s.selectedOptions[0]?.textContent }); return;
      }
      const num = NUMERI.includes(t), conv = x => (num ? Number(String(x).replace(',', '.')) : x);
      const a = h('input.campo', { type: 'text', inputMode: num ? 'decimal' : 'text', value: (op === 'tra' ? v?.[0] : v) ?? '', placeholder: num ? '0' : 'testo' });
      const b = h('input.campo', { type: 'text', inputMode: 'decimal', value: v?.[1] ?? '' });
      zonaValore.append(op === 'tra' ? h('div.pop-due', a, b) : a);
      leggiValore = () => {
        if (op === 'tra') return a.value.trim() && b.value.trim() && Number.isFinite(conv(a.value)) && Number.isFinite(conv(b.value)) ? [conv(a.value), conv(b.value)] : undefined;
        if (!a.value.trim()) return undefined;
        return num && !Number.isFinite(conv(a.value)) ? undefined : conv(a.value.trim());
      };
    };
    sCampo.addEventListener('change', disegnaOp); sOp.addEventListener('change', disegnaValore);
    const applica = ev => {
      ev?.preventDefault();
      if (!sCampo.value) { err.textContent = 'Scegli un campo'; return; }
      const op = sOp.value, valore = ['vuoto', 'nonvuoto', 'si', 'no'].includes(op) ? null : leggiValore();
      if (valore === undefined) { err.textContent = 'Manca il valore'; return; }
      const nuovo = { campo: sCampo.value, op, valore };
      if (i == null) attuali.push(nuovo); else attuali[i] = nuovo;
      pop.chiudi(); aggiorna();
    };
    const pop = apriPop(ancora, h('form', { on: { submit: applica } }, h('div.pop-titolo', i == null ? 'Nuovo filtro' : 'Cambia il filtro'),
      sCampo, sOp, zonaValore, err, h('div.pop-azioni', h('button.btn.pieno.piccolo', { type: 'submit', testo: 'Applica' }))));
    if (f) disegnaOp();
  }
  disegna();
  barra.imposta = l => { attuali = [...(l || [])]; disegna(); };
  barra.filtri = () => [...attuali];
  return barra;
}
