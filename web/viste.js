// Le viste generiche: lista (tabella o kanban) e scheda. Tutto si genera dallo schema dell'entità.
import { h, api, get, toast, formatta, destra, chip, ErroreApi } from './ui.js';
import { editor, titoloDi } from './campi.js';
import { costruttore, risolvi, apriPop, tipoDi, caricaPersone, pronto } from './filtri.js';
import { t, minuscole, dataOra } from './lingua.js';

const COLONNE_MAX = 7;
const visibile = c => !c.archiviato && !c.nascosto_in_lista && !['righe', 'testo_lungo', 'file', 'indirizzo'].includes(c.tipo);
const prefs = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('kubo.' + k) || 'null'); localStorage.setItem('kubo.' + k, JSON.stringify(v)); } catch { return null; } };

// ---------- lista ----------
// Stato della lista: ricerca, filtri (costruttore in filtri.js), colonne scelte e ordinate, raggruppamento con i totali
// (dal server, su tutte le righe filtrate), ordinamento, tabella o kanban; e le viste salvate «per me» o «per tutti».
export function lista(def, contenitore, { schema, poteri = {} }) {
  const stato = prefs('lista.' + def.id) || {};
  const campoKanban = def.campi.find(c => c.tipo === 'stato') || def.campi.find(c => c.tipo === 'scelta');
  // la prima immagine (se c'è) va per prima, come una miniatura
  const predefinite = [...def.campi.filter(c => visibile(c) && c.tipo === 'immagine').slice(0, 1), ...def.campi.filter(c => visibile(c) && c.tipo !== 'immagine')].slice(0, COLONNE_MAX).map(c => c.id);
  const raggruppabili = def.campi.filter(c => !c.archiviato && (['scelta', 'stato', 'utente', 'si_no'].includes(c.tipo) || (c.tipo === 'relazione' && !c.molti)));
  let q = '', pagina = 1, archiviati = false, viste = [], vista = null;
  let { ordina = null, modo = 'tabella', filtri = [], colonne = predefinite, raggruppa = null } = stato;
  const ricorda = () => prefs('lista.' + def.id, { ordina, modo, filtri, colonne, raggruppa, vista: vista?.id || null });
  const campiColonne = () => colonne.map(id => def.campi.find(c => c.id === id && !c.archiviato)).filter(Boolean);
  const cerca = h('input.campo.cerca', { type: 'search', placeholder: t('viste.cerca-in', { nome: minuscole(def.nome) }), on: { input: () => { q = cerca.value; pagina = 1; ricarica(); } } });
  const corpo = h('div');
  const nuovo = def.puo.crea ? h('a.btn.pieno', { href: `#/e/${def.id}/nuovo`, testo: t('viste.nuovo') }) : null;
  const bModo = m => h('button.btn.piccolo', { testo: m === 'tabella' ? t('viste.tabella') : t('viste.kanban'), 'data-modo': m, class: modo === m ? 'pieno' : '', on: { click: ev => { modo = m; ev.currentTarget.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('pieno', b === ev.currentTarget)); ricorda(); ricarica(); } } });
  const modi = campoKanban ? h('div.lista-modi', bModo('tabella'), bModo('kanban')) : null;
  const arch = h('button.btn.piccolo.nudo', { testo: t('viste.archiviati'), on: { click: () => { archiviati = !archiviati; arch.classList.toggle('pieno', archiviati); pagina = 1; ricarica(); } } });
  const sceltaVista = h('select.campo.lista-vista', { title: t('viste.viste-salvate'), on: { change: () => usaVista(viste.find(v => v.id === sceltaVista.value) || null) } });
  const barraFiltri = costruttore(def, filtri, { schema, cambia: l => { filtri = l; pagina = 1; ricorda(); segnaModificata(); ricarica(); } });
  const bColonne = h('button.btn.piccolo', { testo: t('viste.colonne'), on: { click: () => sceltaColonne(bColonne) } });
  const sRaggruppa = h('select.campo.piccolo', { title: t('viste.raggruppa'), on: { change: () => { raggruppa = sRaggruppa.value || null; pagina = 1; ricorda(); segnaModificata(); ricarica(); } } },
    h('option', { value: '', testo: t('viste.senza-gruppi') }), raggruppabili.map(c => h('option', { value: c.id, testo: t('viste.gruppi-per', { nome: minuscole(c.nome) }), selected: raggruppa === c.id })));
  const bSalva = h('button.btn.piccolo', { testo: t('viste.salva-vista'), on: { click: () => salvaVista(bSalva) } });
  contenitore.replaceChildren(
    h('div.testa', h('h1', def.nome), sceltaVista, cerca, modi, arch, nuovo),
    h('div.corpo', h('div.lista-barra', barraFiltri, h('div.lista-strumenti', raggruppabili.length ? sRaggruppa : null, bColonne, bSalva)), corpo));

  // ---------- viste salvate ----------
  async function caricaViste(scegli) {
    viste = await get(`/viste/${def.id}`).catch(() => []);
    if (scegli !== undefined) vista = viste.find(v => v.id === scegli) || null;
    else if (stato.vista) vista = viste.find(v => v.id === stato.vista) || null;
    sceltaVista.replaceChildren(h('option', { value: '', testo: t('viste.tutti') }),
      viste.filter(v => v.perTutti).length ? h('optgroup', { label: t('viste.per-tutti') }, viste.filter(v => v.perTutti).map(v => h('option', { value: v.id, testo: v.nome }))) : null,
      viste.filter(v => !v.perTutti).length ? h('optgroup', { label: t('viste.mie') }, viste.filter(v => !v.perTutti).map(v => h('option', { value: v.id, testo: v.nome }))) : null);
    sceltaVista.value = vista?.id || ''; sceltaVista.hidden = !viste.length;
  }
  function usaVista(v) {
    vista = v;
    filtri = v?.filtri || []; ordina = v?.ordina || null; raggruppa = v?.raggruppa || null; modo = v?.modo || 'tabella';
    colonne = v?.colonne?.length ? v.colonne : predefinite;
    if (v?.incompleta) toast(t('viste.filtri-tolti'));
    barraFiltri.imposta(filtri); sRaggruppa.value = raggruppa || ''; pagina = 1;
    modi?.querySelectorAll('button').forEach(b => b.classList.toggle('pieno', b.dataset.modo === modo));
    ricorda(); segnaModificata(); ricarica();
  }
  const attuale = () => ({ filtri, colonne, ordina, raggruppa, modo });
  function segnaModificata() {
    const diversa = vista && JSON.stringify(attuale()) !== JSON.stringify({ filtri: vista.filtri || [], colonne: vista.colonne?.length ? vista.colonne : predefinite, ordina: vista.ordina || null, raggruppa: vista.raggruppa || null, modo: vista.modo || 'tabella' });
    bSalva.textContent = diversa ? t('viste.salva-modifiche') : t('viste.salva-vista');
  }
  function salvaVista(ancora) {
    const nome = h('input.campo', { value: vista && (vista.mia || (vista.perTutti && poteri.schema)) ? vista.nome : '', placeholder: t('viste.esempio-vista'), required: true, maxLength: 60 });
    const perTutti = h('input', { type: 'checkbox', checked: !!vista?.perTutti && !!poteri.schema });
    const err = h('div.errore-campo');
    const puoAggiornare = vista && (vista.mia || (vista.perTutti && poteri.schema));
    const manda = async (comeNuova) => {
      if (!nome.value.trim()) { err.textContent = t('viste.nome-vista'); return; }
      const corpoV = { nome: nome.value.trim(), perTutti: perTutti.checked, ...attuale() };
      try {
        const v = puoAggiornare && !comeNuova ? await api('PUT', `/viste/${def.id}/${vista.id}`, corpoV) : await api('POST', `/viste/${def.id}`, corpoV);
        pop.chiudi(); toast(perTutti.checked ? t('viste.salvata-tutti') : t('viste.salvata-te')); await caricaViste(v.id); ricorda(); segnaModificata();
      } catch (e) { err.textContent = e.message; }
    };
    const pop = apriPop(ancora, h('form', { on: { submit: ev => { ev.preventDefault(); manda(false); } } },
      h('div.pop-titolo', puoAggiornare ? t('viste.vista-nome', { nome: vista.nome }) : t('viste.salva-questa')),
      h('div.nota', t('viste.cosa-salva')), nome,
      poteri.schema ? h('label.pop-opz', perTutti, t('viste.la-vedono-tutti')) : h('div.nota', t('viste.solo-tu')), err,
      h('div.pop-azioni',
        puoAggiornare ? h('button.btn.piccolo.nudo.pericolo', { type: 'button', testo: t('viste.elimina'), on: { click: async () => {
          if (!confirm(t('viste.elimina-vista', { nome: vista.nome }))) return;
          try { await api('DELETE', `/viste/${def.id}/${vista.id}`); pop.chiudi(); toast(t('viste.vista-eliminata')); await caricaViste(null); usaVista(null); } catch (e) { err.textContent = e.message; } } } }) : null,
        puoAggiornare ? h('button.btn.piccolo', { type: 'button', testo: t('viste.salva-nuova'), on: { click: () => manda(true) } }) : null,
        h('button.btn.pieno.piccolo', { type: 'submit', testo: puoAggiornare ? t('viste.aggiorna') : t('viste.salva') }))));
  }

  // ---------- colonne: quali e in che ordine ----------
  function sceltaColonne(ancora) {
    const tutte = def.campi.filter(c => !c.archiviato && !['righe', 'immagine', 'file'].includes(c.tipo));
    let ordine = [...colonne.filter(id => tutte.some(c => c.id === id)), ...tutte.filter(c => !colonne.includes(c.id)).map(c => c.id)];
    const scelte = new Set(colonne), elenco = h('div.pop-colonne');
    const applica = () => { colonne = ordine.filter(id => scelte.has(id)); ricorda(); segnaModificata(); ricarica(); };
    const disegna = () => elenco.replaceChildren(...ordine.map((id, i) => {
      const c = tutte.find(x => x.id === id);
      const sposta = d => { const j = i + d; if (j < 0 || j >= ordine.length) return; [ordine[i], ordine[j]] = [ordine[j], ordine[i]]; disegna(); applica(); };
      return h('div.pop-colonna', h('label.pop-opz', h('input', { type: 'checkbox', checked: scelte.has(id), on: { change: ev => { ev.target.checked ? scelte.add(id) : scelte.delete(id); if (!scelte.size) { scelte.add(id); ev.target.checked = true; } applica(); } } }), c.nome),
        h('button.btn.nudo.piccolo', { type: 'button', title: t('comune.su'), testo: '↑', disabled: i === 0, on: { click: () => sposta(-1) } }),
        h('button.btn.nudo.piccolo', { type: 'button', title: t('comune.giu'), testo: '↓', disabled: i === ordine.length - 1, on: { click: () => sposta(1) } }));
    }));
    disegna();
    apriPop(ancora, h('div', h('div.pop-titolo', t('viste.colonne')), elenco, h('div.pop-azioni', h('button.btn.piccolo.nudo', { type: 'button', testo: t('viste.come-inizio'), on: { click: () => { colonne = predefinite; ordine = [...predefinite, ...tutte.filter(c => !predefinite.includes(c.id)).map(c => c.id)]; scelte.clear(); predefinite.forEach(x => scelte.add(x)); disegna(); applica(); } } }))));
  }

  // ---------- dati ----------
  const numerico = c => ['valuta', 'numero', 'durata'].includes(c.tipo) || (c.tipo === 'calcolato' && ['valuta', 'numero'].includes(tipoDi(c)));
  let giro = 0;
  async function ricarica() {
    const mio = ++giro; await pronto;
    const fs = risolvi(def, filtri), gruppi = raggruppa && modo === 'tabella' && !archiviati;
    const par = new URLSearchParams({ p: gruppi ? 1 : pagina, n: modo === 'kanban' || gruppi ? 500 : 50 });
    if (q) par.set('q', q); if (archiviati) par.set('arch', '1');
    if (fs.length) par.set('f', JSON.stringify(fs));
    if (ordina) par.set('o', `${ordina.campo}:${ordina.dir}`);
    contenitore.dataset.query = par.toString();   // i filtri correnti, per chi esporta la lista (web/moduli/import.js)
    const cc = campiColonne(), somme = cc.filter(numerico);
    let r, tot = null;
    try {
      [r, tot] = await Promise.all([get(`/dati/${def.id}?${par}`),
        (somme.length || gruppi) && !archiviati ? api('POST', '/aggregati', { entita: def.id, filtri: fs, cerca: q, per: gruppi ? raggruppa : null, misure: [{ misura: 'conta' }, ...somme.map(c => ({ misura: 'somma', campo: c.id }))] }).catch(() => null) : null]);
    } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
    // i campi «utente» si mostrano con il nome della persona, non con l'id
    const nomi = cc.some(c => c.tipo === 'utente') ? new Map((await caricaPersone()).map(p => [p.id, p.nome])) : null;
    const cella = (c, v) => (c.tipo === 'utente' && v ? nomi?.get(v) || v : formatta(c, v));
    if (mio !== giro) return;
    if (!r.totale) { corpo.replaceChildren(h('div.vuoto', q || filtri.length ? t('viste.nessun-risultato') : archiviati ? t('viste.niente-archivio') : t('viste.ancora-nessuno', { nome: minuscole(def.nome) }), def.puo.crea && !q && !filtri.length && !archiviati ? h('div', { stile: { marginTop: '12px' } }, h('a.btn.pieno', { href: `#/e/${def.id}/nuovo`, testo: t('viste.crea-primo') })) : null)); return; }
    if (modo === 'kanban' && campoKanban) return kanban(r.righe);
    const th = cc.map(c => h('th', { class: [destra(c) ? 'num' : '', ordina?.campo === c.id ? 'ord' + (ordina.dir === 'asc' ? ' su' : '') : ''].join(' '),
      on: { click: () => { ordina = ordina?.campo === c.id && ordina.dir === 'desc' ? { campo: c.id, dir: 'asc' } : { campo: c.id, dir: 'desc' }; ricorda(); segnaModificata(); ricarica(); } } }, c.nome));
    const riga = x => h('tr', { on: { click: () => { location.hash = `#/e/${def.id}/${x.id}`; } } }, cc.map(c => h('td', { class: destra(c) ? 'num' : '' }, cella(c, x[c.id]))));
    // una riga di totali: le somme dal server (su tutte le righe filtrate, non solo questa pagina)
    const totali = (valori, testo, classe) => h('tr', { class: classe }, cc.map((c, i) => {
      const k = somme.indexOf(c);
      if (k >= 0 && valori) return h('td.num', formatta(tot.valuta[k + 1] ? { tipo: 'valuta' } : { tipo: 'numero' }, valori[k + 1]));
      return h('td', i === 0 ? testo : '');
    }));
    let tbody;
    if (gruppi) {
      const c = def.campi.find(x => x.id === raggruppa), chiave = x => { const v = x[raggruppa]; return v && typeof v === 'object' ? v.id : c.tipo === 'si_no' ? (v ? 'si' : 'no') : v ?? ''; };
      const perGruppo = new Map(); for (const x of r.righe) { const k = String(chiave(x)); if (!perGruppo.has(k)) perGruppo.set(k, []); perGruppo.get(k).push(x); }
      const ordineG = (tot?.gruppi || []).filter(g => g.conta).map(g => g.chiave); for (const k of perGruppo.keys()) if (!ordineG.includes(k)) ordineG.push(k);
      tbody = h('tbody', ordineG.map(k => {
        const g = tot?.gruppi?.find(x => x.chiave === k), righe = perGruppo.get(k) || [];
        const nome = g?.etichetta ?? (k || t('viste.nessuno')), opz = c.opzioni?.find(o => o.id === k);
        return [h('tr.gruppo', cc.map((col, i) => {
          const s = somme.indexOf(col);
          if (i === 0) return h('td', opz ? chip(opz) : h('b', String(nome)), h('span.nota', ` · ${g?.conta ?? righe.length}`));
          return h('td', { class: s >= 0 ? 'num' : '' }, s >= 0 && g ? formatta(tot.valuta[s + 1] ? { tipo: 'valuta' } : { tipo: 'numero' }, g.valori[s + 1]) : '');
        })), righe.map(riga)];
      }));
    } else tbody = h('tbody', r.righe.map(riga));
    const piede = tot && somme.length ? h('tfoot', totali(tot.totali, t('viste.totale', { n: tot.totali[0] }), 'totale')) : null;
    const pagine = Math.ceil(r.totale / r.perPagina);
    corpo.replaceChildren(h('div.tabella-scorre', h('table.tabella', h('thead', h('tr', th)), tbody, piede)),
      h('div.pagine', gruppi && r.totale > r.righe.length ? t('viste.prime-di', { k: r.righe.length, n: r.totale }) : t('viste.in-tutto', { n: r.totale }),
        !gruppi && pagine > 1 ? [h('button.btn.piccolo', { testo: '‹', disabled: pagina <= 1, on: { click: () => { pagina--; ricarica(); } } }), `${pagina} / ${pagine}`, h('button.btn.piccolo', { testo: '›', disabled: pagina >= pagine, on: { click: () => { pagina++; ricarica(); } } })] : null));
  }
  function kanban(righe) {
    const cc = campiColonne(), c = campoKanban, titolo = def.campi.find(x => x.id === def.titolo) || cc[0], sotto = cc.filter(x => x !== titolo && x !== c).slice(0, 2);
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
  caricaViste().then(() => { if (vista) segnaModificata(); });
  ricarica();
  return { ricarica };
}

// ---------- scheda ----------
export async function scheda(def, id, contenitore, { schema, azioni: azioniModuli = () => [] }) {
  const nuovo = id === 'nuovo';
  // nuovo: i valori predefiniti dello schema (@oggi = oggi; @utente lo mette il server)
  let riga = nuovo ? Object.fromEntries(def.campi.filter(c => c.predefinito !== undefined && c.predefinito !== '@utente').map(c => [c.id, c.predefinito === '@oggi' ? new Date().toISOString().slice(0, 10) : c.predefinito])) : {};
  // valori messi da un'altra vista (es. il calendario: la data dello spazio cliccato), una volta sola
  if (nuovo) { try { const k = 'kubo.precompila.' + def.id, x = JSON.parse(sessionStorage.getItem(k) || 'null'); sessionStorage.removeItem(k); if (x) riga = { ...riga, ...x }; } catch {} }
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
  const salva = h('button.btn.pieno', { testo: nuovo ? t('viste.crea') : t('viste.salva'), disabled: !nuovo, on: { click: salvataggio } });
  async function salvataggio() {
    const valori = {};
    for (const c of campi) { if (c.sola_lettura) continue; const v = editori[c.id].leggi(); if (v !== undefined) valori[c.id] = v; }
    for (const x of Object.values(errori)) x.textContent = '';
    contenitore.querySelectorAll('.sbagliato').forEach(x => x.classList.remove('sbagliato')); avviso.replaceChildren();
    salva.disabled = true;
    try {
      const r = nuovo ? await api('POST', `/dati/${def.id}`, valori) : await api('PATCH', `/dati/${def.id}/${id}`, valori);
      sporco = false; toast(nuovo ? t('viste.creato') : t('viste.salvato'));
      if (nuovo) location.hash = `#/e/${def.id}/${r.id}`; else scheda(def, id, contenitore, { schema, azioni: azioniModuli });
    } catch (e) {
      salva.disabled = false;
      if (e instanceof ErroreApi && e.corpo.campi) for (const [k, m] of Object.entries(e.corpo.campi)) { if (errori[k]) { errori[k].textContent = m; editori[k].classList?.add('sbagliato'); editori[k].querySelector?.('input,select')?.classList.add('sbagliato'); } }
      avviso.replaceChildren(h('div.avviso', e.message));
    }
  }
  const titolo = nuovo ? t('viste.nuovo-in', { nome: minuscole(def.nome) }) : String(titoloDi(riga, def.id) ?? '');
  const azioni = [];
  if (!nuovo && def.puo.elimina && !riga.archiviato) azioni.push(h('button.btn.pericolo', { testo: t('viste.archivia'), on: { click: async () => { if (!confirm(t('viste.archiviare'))) return; await api('DELETE', `/dati/${def.id}/${id}`); toast(t('viste.archiviato')); location.hash = `#/e/${def.id}`; } } }));
  if (!nuovo) azioni.push(...azioniModuli(riga));
  if (riga.archiviato && def.puo.elimina) azioni.push(h('button.btn', { testo: t('viste.ripristina'), on: { click: async () => { await api('POST', `/dati/${def.id}/${id}/ripristina`); toast(t('viste.ripristinato')); scheda(def, id, contenitore, { schema, azioni: azioniModuli }); } } }));
  const lato = nuovo ? null : h('div.lato-scheda', h('div.foglio', h('div.etichetta', t('viste.storia')), storia(def, id)));
  contenitore.replaceChildren(
    h('div.testa', h('a.btn.nudo', { href: `#/e/${def.id}`, testo: '←' }), h('h1', titolo, riga.archiviato ? h('span.nota', ' · ', t('viste.archiviato-min')) : null), ...azioni, sola ? null : salva),
    h('div.corpo', avviso, h('div.scheda', h('div.foglio', griglia), lato)));
  contenitore.querySelector('input.campo')?.focus();
  window.onbeforeunload = () => (sporco ? true : undefined);
  contenitore.addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') { ev.preventDefault(); if (!salva.disabled) salvataggio(); } });
}

function storia(def, id) {
  const ul = h('ul.storia', { stile: { paddingLeft: '16px', margin: '6px 0 0' } }, h('li', t('comune.carico')));
  const nome = k => def.campi.find(c => c.id === k)?.nome || k;
  const val = (k, v) => { const c = def.campi.find(x => x.id === k); const f = c ? formatta(c, v) : v; return f instanceof Node ? f.textContent : String(f ?? '—') || '—'; };
  get(`/dati/${def.id}/${id}/storia`).then(r => {
    ul.replaceChildren(...r.slice(0, 30).map(x => {
      const quando = dataOra(x.quando), chi = x.chi || t('viste.automazione');
      if (x.tipo === 'modifica' && x.dopo) return h('li', h('b', chi), ` · ${quando}`, h('div', Object.keys(x.dopo).filter(k => !['righe'].includes(k)).slice(0, 4).map(k => h('div', `${nome(k)}: ${val(k, x.prima?.[k])} → ${val(k, x.dopo[k])}`))));
      return h('li', h('b', chi), ` · ${quando} · ${{ crea: t('viste.storia-creato'), elimina: t('viste.archiviato-min'), ripristina: t('viste.storia-ripristinato') }[x.tipo] || x.tipo}`);
    }));
  }).catch(() => ul.replaceChildren());
  return ul;
}
