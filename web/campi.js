// Gli editor dei campi, uno per tipo. editor(campo, valore, { schema, cambia }) → elemento con .leggi() che restituisce il
// valore da mandare al server (undefined = non toccare).
import { h, get, api, toast, formatta, chip } from './ui.js';
import { calcola } from '/motore/formule.js';
import { t, virgola, leggiNumero, numero } from './lingua.js';

const ORA = () => new Date().toISOString().slice(0, 10);

export function editor(c, v, opz = {}) {
  const cambia = () => opz.cambia?.();
  const input = (tipo, extra = {}) => { const e = h('input.campo', { type: tipo, ...extra, on: { input: cambia } }); return e; };
  switch (c.tipo) {
    case 'testo_lungo': case 'indirizzo': { const e = h('textarea.campo', { value: v ?? '', on: { input: cambia } }); e.leggi = () => e.value; return e; }
    case 'numero': case 'percentuale': case 'durata': { const e = input('number', { value: v ?? '', step: 'any' }); e.leggi = () => (e.value === '' ? null : Number(e.value)); return e; }
    case 'valuta': { const e = input('text', { value: v == null ? '' : String(v.toFixed?.(2) ?? v).replace('.', virgola()), inputMode: 'decimal', placeholder: `0${virgola()}00` }); e.leggi = () => (e.value.trim() === '' ? null : leggiNumero(e.value) ?? e.value); return e; }
    case 'data': { const e = input('date', { value: v ?? '' }); e.leggi = () => e.value || null; return e; }
    case 'data_ora': { const e = input('datetime-local', { value: v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '' }); e.leggi = () => (e.value ? new Date(e.value).toISOString() : null); return e; }
    case 'si_no': { const e = h('input', { type: 'checkbox', checked: !!v, on: { change: cambia } }); const l = h('label', { stile: { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 0' } }, e, t('comune.si')); l.leggi = () => e.checked; return l; }
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
          return h('button', { type: 'button', class: o.id === attuale ? 'si' : '', disabled: !permesso, title: permesso ? '' : t('viste.non-si-passa', { da: c.opzioni.find(x => x.id === v)?.nome }),
            on: { click: () => { attuale = o.id; disegna(); cambia(); } } }, o.nome);
        }));
      };
      disegna(); e.leggi = () => attuale; return e;
    }
    case 'relazione': return c.molti ? relazioneMolti(c, v, cambia) : relazione(c, v, cambia);
    case 'righe': return righe(c, v, opz);
    case 'calcolato': { const e = h('div.valore-calcolato', formatta(c, v) || '—'); e.leggi = () => undefined; e.aggiorna = x => e.replaceChildren(formatta(c, x) || '—'); return e; }
    case 'contatore': { const e = h('div.valore-calcolato.mono', v || t('viste.al-salvataggio')); e.leggi = () => undefined; return e; }
    case 'immagine': case 'file': return allegati(c, v, cambia);
    case 'email': { const e = input('email', { value: v ?? '' }); e.leggi = () => e.value; return e; }
    case 'telefono': { const e = input('tel', { value: v ?? '' }); e.leggi = () => e.value; return e; }
    case 'url': { const e = input('url', { value: v ?? '' }); e.leggi = () => e.value; return e; }
    default: { const e = input('text', { value: v ?? '' }); e.leggi = () => e.value; return e; }
  }
}

// allegati: si scelgono o si trascinano qui, partono subito a pezzi (vedi server/moduli/import-file.js) e diventano del
// campo al salvataggio della scheda. Le immagini si vedono in anteprima, gli altri file si scaricano.
export async function carica(file, { max, avanzamento } = {}) {
  const a = await api('POST', '/file/carica', { nome: file.name, tipo: file.type, dimensione: file.size, max });
  let da = 0, ultimo = null;
  while (da < file.size) {
    const pezzo = new Uint8Array(await file.slice(da, da + a.pezzo).arrayBuffer());
    let bin = ''; for (let i = 0; i < pezzo.length; i += 0x8000) bin += String.fromCharCode(...pezzo.subarray(i, i + 0x8000));
    ultimo = await api('POST', `/file/carica/${a.id}`, { da, pezzo: btoa(bin) }); da += pezzo.length; avanzamento?.(da / file.size);
  }
  return ultimo.file;
}
export const peso = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${numero(Math.round(n / 104857.6) / 10, 1)} MB`);
function allegati(c, v, cambia) {
  const lista = [...(v || [])], immagine = c.tipo === 'immagine', e = h('div.allegati', { class: immagine ? 'immagini' : '' });
  const scegli = h('input', { type: 'file', multiple: true, accept: immagine ? 'image/*' : undefined, hidden: true, on: { change: () => { aggiungi([...scegli.files]); scegli.value = ''; } } });
  const bottone = h('button.btn.piccolo', { type: 'button', on: { click: () => scegli.click() } }, immagine ? t('viste.piu-immagine') : t('viste.piu-file'));
  async function aggiungi(files) {
    for (const f of files) {
      if (immagine && !f.type.startsWith('image/')) { toast(t('viste.non-immagine', { nome: f.name }), true); continue; }
      const x = { nome: f.name, dimensione: f.size, caricando: 0, anteprima: immagine ? URL.createObjectURL(f) : null }; lista.push(x); disegna();
      try { Object.assign(x, await carica(f, { avanzamento: p => { x.caricando = p; disegna(); } }), { caricando: null }); cambia(); }
      catch (err) { lista.splice(lista.indexOf(x), 1); toast(err.message, true); }
      disegna();
    }
  }
  function disegna() {
    e.replaceChildren(...lista.map(x => h('div.allegato',
      immagine ? h('a.miniatura', { href: x.url || x.anteprima, target: '_blank', rel: 'noopener' }, h('img', { src: x.anteprima || x.url, alt: x.nome, loading: 'lazy' })) : null,
      h('div.info', x.url && !immagine ? h('a', { href: x.url + '?scarica=1', testo: x.nome }) : h('span', { testo: x.nome }),
        x.caricando != null ? h('progress', { max: 1, value: x.caricando }) : h('small', peso(x.dimensione))),
      h('button.btn.nudo.piccolo', { type: 'button', title: t('comune.togli'), testo: '×', on: { click: () => { lista.splice(lista.indexOf(x), 1); disegna(); cambia(); } } }))),
      h('div.aggiungi', bottone, h('small.nota', t('viste.o-trascina')), scegli));
  }
  e.addEventListener('dragover', ev => { ev.preventDefault(); e.classList.add('sopra'); });
  e.addEventListener('dragleave', () => e.classList.remove('sopra'));
  e.addEventListener('drop', ev => { ev.preventDefault(); e.classList.remove('sopra'); if (!e.querySelector('button:disabled')) aggiungi([...ev.dataTransfer.files]); });
  disegna();
  // mentre un file sta ancora salendo non si tocca il campo
  e.leggi = () => (lista.some(x => x.caricando != null) ? undefined : lista.filter(x => x.id).map(({ id, nome, tipo, dimensione }) => ({ id, nome, tipo, dimensione })));
  return e;
}

// relazione: campo di ricerca con il menu dei risultati (frecce, invio, esc)
function relazione(c, v, cambia) {
  let scelto = v ? { id: v.id ?? v, titolo: v.titolo ?? v } : null, risultati = [], su = 0, attesa;
  const inp = h('input.campo', { value: scelto?.titolo ?? '', placeholder: t('comune.cerca'), autocomplete: 'off' });
  const menu = h('div.menu', { hidden: true }), e = h('div.rel', inp, menu);
  const mostra = () => {
    menu.hidden = !risultati.length;
    menu.replaceChildren(...risultati.map((r, i) => h('div', { class: i === su ? 'su' : '', on: { mousedown: ev => { ev.preventDefault(); scegli(r); } } }, r.titolo)));
  };
  const scegli = r => { scelto = r; inp.value = r?.titolo ?? ''; risultati = []; mostra(); cambia(); e.dispatchEvent(new CustomEvent('scelto', { detail: r })); };
  inp.addEventListener('input', () => {
    clearTimeout(attesa); if (!inp.value.trim()) { scelto = null; risultati = []; mostra(); cambia(); return; }
    attesa = setTimeout(async () => {
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
  const disegna = () => lista.replaceChildren(...[...scelti].map(([id, tit]) => h('span.filtro', tit, h('button', { type: 'button', testo: '×', on: { click: () => { scelti.delete(id); disegna(); cambia(); } } }))));
  cerca.addEventListener('scelto', ev => { if (ev.detail) { scelti.set(ev.detail.id, ev.detail.titolo); disegna(); cambia(); cerca.querySelector('input').value = ''; } });
  disegna(); const e = h('div', lista, h('div', { stile: { marginTop: '6px' } }, cerca)); e.leggi = () => [...scelti.keys()]; return e;
}

// righe: una piccola tabella modificabile con i campi dell'entità figlia (senza il campo che punta al padre)
function righe(c, v, opz) {
  const figlia = opz.schema?.find(e => e.id === c.entita); if (!figlia) return h('div.nota', t('viste.righe-non-trovata'));
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
        editori[x.id].value = x.tipo === 'valuta' ? String(Number(src[x.id]).toFixed(2)).replace('.', virgola()) : src[x.id]; }
      ricalcola();
    });
    const tr = h('tr', colonne.map(k => h('td', { class: ['valuta', 'numero', 'percentuale'].includes(k.tipo) || k.tipo === 'calcolato' ? 'num' : '' , stile: { minWidth: k.tipo === 'relazione' ? '220px' : k.tipo === 'calcolato' ? '90px' : '90px' } }, editori[k.id])),
      h('td', h('button.btn.nudo.piccolo', { type: 'button', title: t('comune.togli'), testo: '×', on: { click: () => { stato.splice(stato.indexOf(r), 1); tr.remove(); ricalcola(); opz.cambia?.(); } } })));
    return tr;
  }
  // calcolo locale con lo stesso motore delle formule del server, per vedere subito i totali; il server ricalcola comunque
  function ricalcola() {
    const somme = {};
    for (const r of stato) for (const k of colonne) {
      if (k.tipo !== 'calcolato') continue;
      const val = Object.fromEntries(colonne.filter(x => x.tipo !== 'calcolato').map(x => { const y = r.editori[x.id].leggi?.(); return [x.id, (typeof y === 'number' ? y : leggiNumero(y)) || 0]; }));
      let x = null; try { x = calcola(k.formula, { valori: val }); } catch { x = null; }
      r.editori[k.id].aggiorna?.(x); if (typeof x === 'number') somme[k.id] = (somme[k.id] || 0) + x;
    }
    tot.replaceChildren(...colonne.filter(k => k.tipo === 'calcolato' && somme[k.id] != null).map(k => h('span', `${k.nome}: `, h('b', formatta(k, somme[k.id])))));
  }
  for (const r of stato) corpo.append(riga(r));
  const aggiungi = h('button.btn.piccolo', { type: 'button', testo: t('viste.aggiungi-riga'), on: { click: () => { const r = { valori: Object.fromEntries(colonne.filter(k => k.predefinito !== undefined && !String(k.predefinito).startsWith('@')).map(k => [k.id, k.predefinito])) }; stato.push(r); corpo.append(riga(r)); ricalcola(); r.editori[colonne[0].id].querySelector?.('input')?.focus() || r.editori[colonne[0].id].focus?.(); } } });
  const e = h('div', h('table.righe', h('thead', h('tr', colonne.map(k => h('th', { class: ['valuta', 'numero', 'percentuale', 'calcolato'].includes(k.tipo) ? 'num' : '' }, k.nome)), h('th'))), corpo), h('div', { stile: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, aggiungi, tot));
  ricalcola();
  e.leggi = () => stato.map(r => ({ ...(r.id ? { id: r.id } : {}), ...Object.fromEntries(colonne.map(k => [k.id, r.editori[k.id].leggi()]).filter(([, x]) => x !== undefined)) }))
    .filter(r => r.id || Object.values(r).some(x => x != null && x !== '' && x !== false));
  return e;
}
export { ORA };
