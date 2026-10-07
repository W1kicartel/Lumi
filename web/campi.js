// Gli editor dei campi, uno per tipo. editor(campo, valore, { schema, cambia }) → elemento con .leggi() che restituisce il
// valore da mandare al server (undefined = non toccare).
import { h, get, formatta, chip } from './ui.js';
import { calcola } from '/motore/formule.js';

const ORA = () => new Date().toISOString().slice(0, 10);

export function editor(c, v, opz = {}) {
  const cambia = () => opz.cambia?.();
  const input = (tipo, extra = {}) => { const e = h('input.campo', { type: tipo, ...extra, on: { input: cambia } }); return e; };
  switch (c.tipo) {
    case 'testo_lungo': case 'indirizzo': { const e = h('textarea.campo', { value: v ?? '', on: { input: cambia } }); e.leggi = () => e.value; return e; }
    case 'numero': case 'percentuale': case 'durata': { const e = input('number', { value: v ?? '', step: 'any' }); e.leggi = () => (e.value === '' ? null : Number(e.value)); return e; }
    case 'valuta': { const e = input('text', { value: v == null ? '' : String(v.toFixed?.(2) ?? v).replace('.', ','), inputMode: 'decimal', placeholder: '0,00' }); e.leggi = () => (e.value.trim() === '' ? null : e.value.replace(/\./g, '').replace(',', '.')); return e; }
    case 'data': { const e = input('date', { value: v ?? '' }); e.leggi = () => e.value || null; return e; }
    case 'data_ora': { const e = input('datetime-local', { value: v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '' }); e.leggi = () => (e.value ? new Date(e.value).toISOString() : null); return e; }
    case 'si_no': { const e = h('input', { type: 'checkbox', checked: !!v, on: { change: cambia } }); const l = h('label', { stile: { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 0' } }, e, 'Sì'); l.leggi = () => e.checked; return l; }
    case 'scelta': {
      const e = h('select.campo', { on: { change: cambia } }, h('option', { value: '', testo: '—' }), c.opzioni.map(o => h('option', { value: o.id, testo: o.nome, selected: o.id === v })));
      e.leggi = () => e.value || null; return e;
    }
    case 'scelta_multipla': {
      const sc = new Set(v || []);
      const e = h('div.etichette-scelte', c.opzioni.map(o => h('label', h('input', { type: 'checkbox', checked: sc.has(o.id), on: { change: ev => { ev.target.checked ? sc.add(o.id) : sc.delete(o.id); cambia(); } } }), o.nome)));
      e.leggi = () => [...sc]; return e;
    }
    case 'stato': {
      let attuale = v ?? c.iniziale ?? c.opzioni[0]?.id;
      const e = h('div.stati'); const disegna = () => {
        e.replaceChildren(...c.opzioni.map(o => {
          const permesso = !opz.esistente || o.id === v || !c.transizioni || (c.transizioni[v] || []).includes(o.id);
          return h('button', { type: 'button', class: o.id === attuale ? 'si' : '', disabled: !permesso, title: permesso ? '' : `Da «${c.opzioni.find(x => x.id === v)?.nome}» non si passa qui`,
            on: { click: () => { attuale = o.id; disegna(); cambia(); } } }, o.nome);
        }));
      };
      disegna(); e.leggi = () => attuale; return e;
    }
    case 'relazione': return c.molti ? relazioneMolti(c, v, cambia) : relazione(c, v, cambia);
    case 'righe': return righe(c, v, opz);
    case 'calcolato': { const e = h('div.valore-calcolato', formatta(c, v) || '—'); e.leggi = () => undefined; e.aggiorna = x => e.replaceChildren(formatta(c, x) || '—'); return e; }
    case 'contatore': { const e = h('div.valore-calcolato.mono', v || 'al salvataggio'); e.leggi = () => undefined; return e; }
    case 'immagine': case 'file': { const e = h('div.nota', 'Gli allegati arrivano nella prossima versione.'); e.leggi = () => undefined; return e; }
    case 'email': { const e = input('email', { value: v ?? '' }); e.leggi = () => e.value; return e; }
    case 'telefono': { const e = input('tel', { value: v ?? '' }); e.leggi = () => e.value; return e; }
    case 'url': { const e = input('url', { value: v ?? '' }); e.leggi = () => e.value; return e; }
    default: { const e = input('text', { value: v ?? '' }); e.leggi = () => e.value; return e; }
  }
}

// relazione: campo di ricerca con il menu dei risultati (frecce, invio, esc)
function relazione(c, v, cambia) {
  let scelto = v ? { id: v.id ?? v, titolo: v.titolo ?? v } : null, risultati = [], su = 0, t;
  const inp = h('input.campo', { value: scelto?.titolo ?? '', placeholder: 'Cerca…', autocomplete: 'off' });
  const menu = h('div.menu', { hidden: true }), e = h('div.rel', inp, menu);
  const mostra = () => {
    menu.hidden = !risultati.length;
    menu.replaceChildren(...risultati.map((r, i) => h('div', { class: i === su ? 'su' : '', on: { mousedown: ev => { ev.preventDefault(); scegli(r); } } }, r.titolo)));
  };
  const scegli = r => { scelto = r; inp.value = r?.titolo ?? ''; risultati = []; mostra(); cambia(); e.dispatchEvent(new CustomEvent('scelto', { detail: r })); };
  inp.addEventListener('input', () => {
    clearTimeout(t); if (!inp.value.trim()) { scelto = null; risultati = []; mostra(); cambia(); return; }
    t = setTimeout(async () => {
      const r = await get(`/dati/${c.entita}?n=8&q=${encodeURIComponent(inp.value)}`).catch(() => ({ righe: [] }));
      risultati = r.righe.map(x => ({ id: x.id, titolo: x.__titolo ?? titoloDi(x), riga: x })); su = 0; mostra();
    }, 160);
  });
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { su = Math.min(su + 1, risultati.length - 1); mostra(); ev.preventDefault(); }
    if (ev.key === 'ArrowUp') { su = Math.max(su - 1, 0); mostra(); ev.preventDefault(); }
    if (ev.key === 'Enter' && risultati[su]) { scegli(risultati[su]); ev.preventDefault(); }
    if (ev.key === 'Escape') { risultati = []; mostra(); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { risultati = []; mostra(); if (!scelto) inp.value = ''; else inp.value = scelto.titolo; }, 120));
  e.leggi = () => scelto?.id ?? null; return e;
}
let schemaGlobale = [];
export const usaSchema = s => { schemaGlobale = s; };
export function titoloDi(riga, entita) {
  const def = entita ? schemaGlobale.find(e => e.id === entita) : null;
  const k = def?.titolo || def?.campi.find(c => ['testo', 'contatore'].includes(c.tipo))?.id;
  const v = k ? riga[k] : riga.nome ?? riga.numero ?? riga.id;
  return v && typeof v === 'object' ? v.titolo : v ?? riga.id;
}
function relazioneMolti(c, v, cambia) {
  const scelti = new Map((v || []).map(x => [x.id, x.titolo]));
  const lista = h('div.etichette-scelte'), cerca = relazione({ ...c, molti: false }, null, () => {});
  const disegna = () => lista.replaceChildren(...[...scelti].map(([id, t]) => h('span.filtro', t, h('button', { type: 'button', testo: '×', on: { click: () => { scelti.delete(id); disegna(); cambia(); } } }))));
  cerca.addEventListener('scelto', ev => { if (ev.detail) { scelti.set(ev.detail.id, ev.detail.titolo); disegna(); cambia(); cerca.querySelector('input').value = ''; } });
  disegna(); const e = h('div', lista, h('div', { stile: { marginTop: '6px' } }, cerca)); e.leggi = () => [...scelti.keys()]; return e;
}

// righe: una piccola tabella modificabile con i campi dell'entità figlia (senza il campo che punta al padre)
function righe(c, v, opz) {
  const figlia = opz.schema?.find(e => e.id === c.entita); if (!figlia) return h('div.nota', 'Entità delle righe non trovata');
  const colonne = figlia.campi.filter(k => k.id !== c.campo && !['righe', 'immagine', 'file'].includes(k.tipo));
  const corpo = h('tbody'), stato = (v || []).map(r => ({ id: r.id, valori: r }));
  const tot = h('div.totali');
  function riga(r) {
    const editori = Object.fromEntries(colonne.map(k => [k.id, editor(k, r.valori[k.id], { schema: opz.schema, cambia: () => { ricalcola(); opz.cambia?.(); } })]));
    r.editori = editori;
    // scegliendo un articolo, i campi con lo stesso nome (es. prezzo) si riempiono dai suoi valori
    for (const k of colonne.filter(k => k.tipo === 'relazione' && !k.molti)) editori[k.id].addEventListener('scelto', ev => {
      const src = ev.detail?.riga; if (!src) return;
      for (const x of colonne) if (x.id !== k.id && src[x.id] != null && editori[x.id].tagName === 'INPUT' && !editori[x.id].value) {
        editori[x.id].value = x.tipo === 'valuta' ? String(Number(src[x.id]).toFixed(2)).replace('.', ',') : src[x.id]; }
      ricalcola();
    });
    const tr = h('tr', colonne.map(k => h('td', { class: ['valuta', 'numero', 'percentuale'].includes(k.tipo) || k.tipo === 'calcolato' ? 'num' : '' , stile: { minWidth: k.tipo === 'relazione' ? '220px' : k.tipo === 'calcolato' ? '90px' : '90px' } }, editori[k.id])),
      h('td', h('button.btn.nudo.piccolo', { type: 'button', title: 'Togli', testo: '×', on: { click: () => { stato.splice(stato.indexOf(r), 1); tr.remove(); ricalcola(); opz.cambia?.(); } } })));
    return tr;
  }
  // calcolo locale con lo stesso motore delle formule del server, per vedere subito i totali; il server ricalcola comunque
  function ricalcola() {
    const somme = {};
    for (const r of stato) for (const k of colonne) {
      if (k.tipo !== 'calcolato') continue;
      const val = Object.fromEntries(colonne.filter(x => x.tipo !== 'calcolato').map(x => [x.id, Number(String(r.editori[x.id].leggi?.() ?? 0).replace(',', '.')) || 0]));
      let x = null; try { x = calcola(k.formula, { valori: val }); } catch { x = null; }
      r.editori[k.id].aggiorna?.(x); if (typeof x === 'number') somme[k.id] = (somme[k.id] || 0) + x;
    }
    tot.replaceChildren(...colonne.filter(k => k.tipo === 'calcolato' && somme[k.id] != null).map(k => h('span', `${k.nome}: `, h('b', formatta(k, somme[k.id])))));
  }
  for (const r of stato) corpo.append(riga(r));
  const aggiungi = h('button.btn.piccolo', { type: 'button', testo: '+ Aggiungi riga', on: { click: () => { const r = { valori: Object.fromEntries(colonne.filter(k => k.predefinito !== undefined && !String(k.predefinito).startsWith('@')).map(k => [k.id, k.predefinito])) }; stato.push(r); corpo.append(riga(r)); ricalcola(); r.editori[colonne[0].id].querySelector?.('input')?.focus() || r.editori[colonne[0].id].focus?.(); } } });
  const e = h('div', h('table.righe', h('thead', h('tr', colonne.map(k => h('th', { class: ['valuta', 'numero', 'percentuale', 'calcolato'].includes(k.tipo) ? 'num' : '' }, k.nome)), h('th'))), corpo), h('div', { stile: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, aggiungi, tot));
  ricalcola();
  e.leggi = () => stato.map(r => ({ ...(r.id ? { id: r.id } : {}), ...Object.fromEntries(colonne.map(k => [k.id, r.editori[k.id].leggi()]).filter(([, x]) => x !== undefined)) }))
    .filter(r => r.id || Object.values(r).some(x => x != null && x !== '' && x !== false));
  return e;
}
export { ORA };
