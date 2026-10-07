// Le viste generiche: lista (tabella o kanban) e scheda. Tutto si genera dallo schema dell'entità.
import { h, api, get, toast, formatta, destra, chip, ErroreApi } from './ui.js';
import { editor, titoloDi } from './campi.js';

const COLONNE_MAX = 7;
const visibile = c => !c.archiviato && !c.nascosto_in_lista && !['righe', 'testo_lungo', 'immagine', 'file', 'indirizzo'].includes(c.tipo);
const prefs = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('kubo.' + k) || 'null'); localStorage.setItem('kubo.' + k, JSON.stringify(v)); } catch { return null; } };

// ---------- lista ----------
export function lista(def, contenitore, { schema }) {
  const stato = prefs('lista.' + def.id) || {};
  let q = '', pagina = 1, ordina = stato.ordina || null, filtri = [], modo = stato.modo || 'tabella', archiviati = false;
  const campoKanban = def.campi.find(c => c.tipo === 'stato') || def.campi.find(c => c.tipo === 'scelta');
  const colonne = def.campi.filter(visibile).slice(0, COLONNE_MAX);
  const cerca = h('input.campo.cerca', { type: 'search', placeholder: `Cerca in ${def.nome.toLowerCase()}…`, on: { input: () => { q = cerca.value; pagina = 1; ricarica(); } } });
  const corpo = h('div'), barraFiltri = h('div.filtri');
  const nuovo = def.puo.crea ? h('a.btn.pieno', { href: `#/e/${def.id}/nuovo`, testo: '+ Nuovo' }) : null;
  const modi = campoKanban ? h('div', { stile: { display: 'flex', gap: '4px' } },
    h('button.btn.piccolo', { testo: 'Tabella', on: { click: () => { modo = 'tabella'; prefs('lista.' + def.id, { ...stato, modo }); ricarica(); } } }),
    h('button.btn.piccolo', { testo: 'Kanban', on: { click: () => { modo = 'kanban'; prefs('lista.' + def.id, { ...stato, modo }); ricarica(); } } })) : null;
  const arch = h('button.btn.piccolo.nudo', { testo: 'Archiviati', on: { click: () => { archiviati = !archiviati; arch.classList.toggle('pieno', archiviati); pagina = 1; ricarica(); } } });
  contenitore.replaceChildren(
    h('div.testa', h('h1', def.nome), cerca, modi, arch, nuovo),
    h('div.corpo', barraFiltri, corpo));
  disegnaFiltri();

  function disegnaFiltri() {
    const scegli = h('select.campo', { stile: { width: 'auto' }, on: { change: () => { const c = def.campi.find(x => x.id === scegli.value); if (c) aggiungiFiltro(c); scegli.value = ''; } } },
      h('option', { value: '', testo: '+ Filtro' }), def.campi.filter(c => !c.archiviato && ['scelta', 'stato', 'si_no', 'relazione', 'calcolato', 'data', 'numero', 'valuta'].includes(c.tipo) && !c.molti).map(c => h('option', { value: c.id, testo: c.nome })));
    barraFiltri.replaceChildren(...filtri.map((f, i) => h('span.filtro', `${f.etichetta}`, h('button', { testo: '×', on: { click: () => { filtri.splice(i, 1); disegnaFiltri(); ricarica(); } } }))), scegli);
  }
  function aggiungiFiltro(c) {
    let f = null;
    if (['scelta', 'stato'].includes(c.tipo)) { const o = prompt(`${c.nome}: ${c.opzioni.map(o => o.nome).join(', ')}`); const op = c.opzioni.find(x => x.nome.toLowerCase() === String(o || '').trim().toLowerCase()); if (op) f = { campo: c.id, op: '=', valore: op.id, etichetta: `${c.nome}: ${op.nome}` }; }
    else if (c.tipo === 'si_no' || (c.tipo === 'calcolato' && !c.formato)) f = { campo: c.id, op: '=', valore: true, etichetta: c.nome };
    else if (c.tipo === 'relazione') { const t = prompt(`${c.nome} contiene:`); if (t) f = { campo: c.id, op: 'nonvuoto', etichetta: `${c.nome}: c'è` }; }
    else { const t = prompt(`${c.nome} maggiore o uguale a:`); if (t !== null && t !== '') f = { campo: c.id, op: '>=', valore: c.tipo === 'data' ? t : Number(t.replace(',', '.')), etichetta: `${c.nome} ≥ ${t}` }; }
    if (f) { filtri.push(f); disegnaFiltri(); pagina = 1; ricarica(); }
  }

  async function ricarica() {
    const par = new URLSearchParams({ p: pagina, n: modo === 'kanban' ? 300 : 50 });
    if (q) par.set('q', q); if (archiviati) par.set('arch', '1');
    if (filtri.length) par.set('f', JSON.stringify(filtri.map(({ etichetta, ...f }) => f)));
    if (ordina) par.set('o', `${ordina.campo}:${ordina.dir}`);
    let r; try { r = await get(`/dati/${def.id}?${par}`); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
    if (!r.totale) { corpo.replaceChildren(h('div.vuoto', q || filtri.length ? 'Nessun risultato.' : archiviati ? 'Niente in archivio.' : `Ancora nessun elemento in ${def.nome.toLowerCase()}.`, def.puo.crea && !q && !filtri.length && !archiviati ? h('div', { stile: { marginTop: '12px' } }, h('a.btn.pieno', { href: `#/e/${def.id}/nuovo`, testo: '+ Crea il primo' })) : null)); return; }
    if (modo === 'kanban' && campoKanban) return kanban(r.righe);
    const th = colonne.map(c => h('th', { class: [destra(c) ? 'num' : '', ordina?.campo === c.id ? 'ord' + (ordina.dir === 'asc' ? ' su' : '') : ''].join(' '),
      on: { click: () => { ordina = ordina?.campo === c.id && ordina.dir === 'desc' ? { campo: c.id, dir: 'asc' } : { campo: c.id, dir: 'desc' }; prefs('lista.' + def.id, { ...stato, modo, ordina }); ricarica(); } } }, c.nome));
    const tr = r.righe.map(x => h('tr', { on: { click: () => { location.hash = `#/e/${def.id}/${x.id}`; } } }, colonne.map(c => h('td', { class: destra(c) ? 'num' : '' }, formatta(c, x[c.id])))));
    const pagine = Math.ceil(r.totale / r.perPagina);
    corpo.replaceChildren(h('table.tabella', h('thead', h('tr', th)), h('tbody', tr)),
      h('div.pagine', `${r.totale} in tutto`, pagine > 1 ? [h('button.btn.piccolo', { testo: '‹', disabled: pagina <= 1, on: { click: () => { pagina--; ricarica(); } } }), `${pagina} / ${pagine}`, h('button.btn.piccolo', { testo: '›', disabled: pagina >= pagine, on: { click: () => { pagina++; ricarica(); } } })] : null));
  }
  function kanban(righe) {
    const c = campoKanban, titolo = def.campi.find(x => x.id === def.titolo) || colonne[0], sotto = colonne.filter(x => x !== titolo && x !== c).slice(0, 2);
    corpo.replaceChildren(h('div.kanban', c.opzioni.map(o => {
      const qui = righe.filter(x => x[c.id] === o.id);
      const col = h('div.colonna', { on: {
        dragover: ev => { ev.preventDefault(); col.classList.add('sopra-qui'); }, dragleave: () => col.classList.remove('sopra-qui'),
        drop: async ev => { ev.preventDefault(); col.classList.remove('sopra-qui'); const id = ev.dataTransfer.getData('text/plain');
          try { await api('PATCH', `/dati/${def.id}/${id}`, { [c.id]: o.id }); ricarica(); } catch (e) { toast(e.message, true); } } } },
        h('h3', chip(o), h('span.nota', String(qui.length))),
        qui.map(x => h('div.carta', { draggable: def.puo.modifica, on: { dragstart: ev => ev.dataTransfer.setData('text/plain', x.id), click: () => { location.hash = `#/e/${def.id}/${x.id}`; } } },
          h('div.t', formatta(titolo, x[titolo.id]) || '—'), sotto.map(s => x[s.id] != null && x[s.id] !== '' ? h('div.s', `${s.nome}: `, formatta(s, x[s.id])) : null))));
      return col;
    })));
  }
  ricarica();
  return { ricarica };
}

// ---------- scheda ----------
export async function scheda(def, id, contenitore, { schema, azioni: azioniModuli = () => [] }) {
  const nuovo = id === 'nuovo';
  // nuovo: i valori predefiniti dello schema (@oggi = oggi; @utente lo mette il server)
  let riga = nuovo ? Object.fromEntries(def.campi.filter(c => c.predefinito !== undefined && c.predefinito !== '@utente').map(c => [c.id, c.predefinito === '@oggi' ? new Date().toISOString().slice(0, 10) : c.predefinito])) : {};
  if (!nuovo) { try { riga = await get(`/dati/${def.id}/${id}`); } catch (e) { contenitore.replaceChildren(h('div.corpo', h('div.avviso', e.message))); return; } }
  let sporco = false;
  const editori = {}, errori = {};
  const sola = !nuovo && !def.puo.modifica;
  const campi = def.campi.filter(c => !c.archiviato && !(nuovo && ['calcolato'].includes(c.tipo)));
  const griglia = h('div.griglia', campi.map(c => {
    const e = editor(c, riga[c.id], { schema, esistente: !nuovo, cambia: () => { sporco = true; salva.disabled = false; } });
    if (sola || c.sola_lettura) { e.querySelectorAll?.('input,select,textarea,button').forEach(x => { x.disabled = true; }); if (e.disabled !== undefined) e.disabled = true; }
    editori[c.id] = e; errori[c.id] = h('div.errore-campo');
    return h('div', { class: ['righe', 'testo_lungo', 'scelta_multipla', 'indirizzo'].includes(c.tipo) || (c.tipo === 'stato' && c.opzioni.length > 4) ? 'largo' : '' },
      h('label.etichetta', c.nome, c.obbligatorio ? ' *' : ''), e, errori[c.id]);
  }));
  const avviso = h('div');
  const salva = h('button.btn.pieno', { testo: nuovo ? 'Crea' : 'Salva', disabled: !nuovo, on: { click: salvataggio } });
  async function salvataggio() {
    const valori = {};
    for (const c of campi) { if (c.sola_lettura) continue; const v = editori[c.id].leggi(); if (v !== undefined) valori[c.id] = v; }
    for (const x of Object.values(errori)) x.textContent = '';
    contenitore.querySelectorAll('.sbagliato').forEach(x => x.classList.remove('sbagliato')); avviso.replaceChildren();
    salva.disabled = true;
    try {
      const r = nuovo ? await api('POST', `/dati/${def.id}`, valori) : await api('PATCH', `/dati/${def.id}/${id}`, valori);
      sporco = false; toast(nuovo ? 'Creato' : 'Salvato');
      if (nuovo) location.hash = `#/e/${def.id}/${r.id}`; else scheda(def, id, contenitore, { schema, azioni: azioniModuli });
    } catch (e) {
      salva.disabled = false;
      if (e instanceof ErroreApi && e.corpo.campi) for (const [k, m] of Object.entries(e.corpo.campi)) { if (errori[k]) { errori[k].textContent = m; editori[k].classList?.add('sbagliato'); editori[k].querySelector?.('input,select')?.classList.add('sbagliato'); } }
      avviso.replaceChildren(h('div.avviso', e.message));
    }
  }
  const titolo = nuovo ? `Nuovo in ${def.nome.toLowerCase()}` : String(titoloDi(riga, def.id) ?? '');
  const azioni = [];
  if (!nuovo && def.puo.elimina && !riga.archiviato) azioni.push(h('button.btn.pericolo', { testo: 'Archivia', on: { click: async () => { if (!confirm('Archiviare? Si può ripristinare dall\'archivio.')) return; await api('DELETE', `/dati/${def.id}/${id}`); toast('Archiviato'); location.hash = `#/e/${def.id}`; } } }));
  if (!nuovo) azioni.push(...azioniModuli(riga));
  if (riga.archiviato && def.puo.elimina) azioni.push(h('button.btn', { testo: 'Ripristina', on: { click: async () => { await api('POST', `/dati/${def.id}/${id}/ripristina`); toast('Ripristinato'); scheda(def, id, contenitore, { schema, azioni: azioniModuli }); } } }));
  const lato = nuovo ? null : h('div.lato-scheda', h('div.foglio', h('div.etichetta', 'Storia'), storia(def, id)));
  contenitore.replaceChildren(
    h('div.testa', h('a.btn.nudo', { href: `#/e/${def.id}`, testo: '←' }), h('h1', titolo, riga.archiviato ? h('span.nota', ' · archiviato') : null), ...azioni, sola ? null : salva),
    h('div.corpo', avviso, h('div.scheda', h('div.foglio', griglia), lato)));
  contenitore.querySelector('input.campo')?.focus();
  window.onbeforeunload = () => (sporco ? true : undefined);
  contenitore.addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); if (!salva.disabled) salvataggio(); } });
}

function storia(def, id) {
  const ul = h('ul.storia', { stile: { paddingLeft: '16px', margin: '6px 0 0' } }, h('li', 'Carico…'));
  const nome = k => def.campi.find(c => c.id === k)?.nome || k;
  const val = (k, v) => { const c = def.campi.find(x => x.id === k); const f = c ? formatta(c, v) : v; return f instanceof Node ? f.textContent : String(f ?? '—') || '—'; };
  get(`/dati/${def.id}/${id}/storia`).then(r => {
    ul.replaceChildren(...r.slice(0, 30).map(x => {
      const quando = new Date(x.quando).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }), chi = x.chi || 'automazione';
      if (x.tipo === 'modifica' && x.dopo) return h('li', h('b', chi), ` · ${quando}`, h('div', Object.keys(x.dopo).filter(k => !['righe'].includes(k)).slice(0, 4).map(k => h('div', `${nome(k)}: ${val(k, x.prima?.[k])} → ${val(k, x.dopo[k])}`))));
      return h('li', h('b', chi), ` · ${quando} · ${{ crea: 'creato', elimina: 'archiviato', ripristina: 'ripristinato' }[x.tipo] || x.tipo}`);
    }));
  }).catch(() => ul.replaceChildren());
  return ul;
}
