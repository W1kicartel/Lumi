// Documenti nell'interfaccia: «Stampa» (anteprima A4 e finestra di stampa del browser, da cui si salva anche il PDF),
// «Crea fattura» dalle vendite, dai preventivi e dalle commesse, «FatturaPA» sulle fatture (controlli, poi il file XML),
// e la pagina #/documenti con i dati dell'azienda, il logo e l'editor dei modelli di stampa.
// Il documento arriva dal server già pronto e «escapato»; si mostra in un iframe sandbox senza script.

import { t, minuscole } from '../lingua.js';

// i campi dei dati dell'azienda: [id, nome (moduli.doc-campo-<id>), largo?]
const TESTI_AZIENDA = [['ragione_sociale', 'largo'], ['piva'], ['codice_fiscale'], ['regime'], ['via', 'largo'], ['cap'], ['comune'], ['provincia'],
  ['telefono'], ['email'], ['pec'], ['codice_destinatario'], ['iban', 'largo'], ['banca'], ['aliquota'], ['colore']].map(([id, largo]) => [id, t('moduli.doc-campo-' + id), largo]);
const stampabile = def => def.campi.some(c => c.tipo === 'righe');
const fattureDi = schema => schema.find(e => e.id === 'fatture');
let cssCaricato = false;

function caricaCss() {
  if (cssCaricato) return; cssCaricato = true;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/moduli/documenti.css' }));
}

// ---------- anteprima e stampa ----------
function finestra(k, titolo, ...contenuto) {
  const { h } = k;
  const chiudi = () => { velo.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', chiudi); };
  const esc = ev => { if (ev.key === 'Escape') chiudi(); };
  const velo = h('div.documenti-velo', { on: { click: ev => { if (ev.target === velo) chiudi(); } } },
    h('div.documenti-finestra', { role: 'dialog', 'aria-label': titolo },
      h('div.documenti-barra', h('b', titolo), h('span.documenti-spazio'), ...contenuto.filter(x => x?.dataset?.barra), h('button.btn.nudo', { title: t('moduli.doc-chiudi'), testo: '×', on: { click: () => chiudi() } })),
      ...contenuto.filter(x => !x?.dataset?.barra)));
  document.addEventListener('keydown', esc); window.addEventListener('hashchange', chiudi); document.body.append(velo);   // cambiando pagina si chiude
  return { velo, chiudi };
}
function foglio(k, html) {
  const f = k.h('iframe.documenti-foglio', { title: t('moduli.doc-anteprima') });
  f.setAttribute('sandbox', 'allow-same-origin allow-modals'); f.srcdoc = html;
  return f;
}
async function stampa(f) {
  const w = f.contentWindow; try { await w.document.fonts?.ready; } catch { /* niente */ }
  w.focus(); w.print();
}
async function apriStampa(def, riga, k) {
  const { h, get, toast } = k;
  let s; try { s = await get(`/documenti/stampa/${def.id}/${riga.id}`); } catch (e) { return toast(e.message, true); }
  const f = foglio(k, s.html);
  const bottone = h('button.btn.pieno', { testo: t('moduli.doc-stampa-pdf'), 'data-barra': '1', on: { click: () => stampa(f) } });
  const modifica = k.stato.poteri?.schema ? h('a.btn', { href: `#/documenti/modelli/${def.id}`, testo: t('moduli.doc-modifica-modello'), 'data-barra': '1' }) : null;
  finestra(k, s.titolo, modifica, bottone, h('div.documenti-tavolo', f));
}

// ---------- FatturaPA ----------
async function fatturaPA(riga, k) {
  const { h, get, api, toast } = k;
  let c; try { c = await get(`/documenti/fatturapa/${riga.id}`); } catch (e) { return toast(e.message, true); }
  if (c.errori.length) {
    finestra(k, t('moduli.doc-xml-manca'), h('div.documenti-controlli', h('p', t('moduli.doc-sistema')), h('ul', c.errori.map(x => h('li', x))),
      k.stato.poteri?.schema ? h('p', h('a', { href: '#/documenti', testo: t('moduli.doc-apri-dati') })) : null));
    return;
  }
  try {
    const x = await api('POST', `/documenti/fatturapa/${riga.id}`);
    const a = h('a', { href: URL.createObjectURL(new Blob([x.xml], { type: 'application/xml' })), download: x.nome });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(t('moduli.doc-scaricato', { nome: x.nome }));
  } catch (e) { toast(e.message, true); }
}

// ---------- pagina «Documenti» ----------
function pagina(contenuto, k, sezione, entita) {
  const { h } = k;
  const schede = h('div.documenti-schede',
    h('a', { href: '#/documenti', class: !sezione ? 'si' : '', testo: t('moduli.doc-dati-azienda') }),
    h('a', { href: '#/documenti/modelli', class: sezione === 'modelli' ? 'si' : '', testo: t('moduli.doc-modelli-stampa') }));
  const corpo = h('div.corpo');
  contenuto.replaceChildren(h('div.testa', h('h1', t('moduli.doc-documenti')), schede), corpo);
  if (sezione === 'modelli' && entita) return editorModello(corpo, k, entita);
  if (sezione === 'modelli') return elencoModelli(corpo, k);
  return datiAzienda(corpo, k);
}

async function datiAzienda(corpo, k) {
  const { h, get, api, toast } = k;
  let a; try { a = await get('/documenti/azienda'); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
  const puo = !!k.stato.poteri?.schema;
  const campi = {};
  const griglia = h('div.griglia', TESTI_AZIENDA.map(([id, nome, largo]) => {
    let e;
    if (id === 'regime') e = h('select.campo', Object.entries(a.regimi).map(([v, n]) => h('option', { value: v, testo: `${v} · ${n}`, selected: v === a.regime })));
    else if (id === 'colore') e = h('input.campo.documenti-colore', { type: 'color', value: a.colore || '#111111' });
    else if (id === 'aliquota') e = h('input.campo', { type: 'number', min: 0, max: 100, step: 'any', value: a.aliquota ?? 22 });
    else e = h('input.campo', { type: id === 'email' || id === 'pec' ? 'email' : 'text', value: a[id] ?? '', autocomplete: 'off' });
    if (!puo) e.disabled = true;
    campi[id] = e; return h('div', { class: largo || '' }, h('label.etichetta', nome), e);
  }));
  const avviso = h('div');
  const salva = h('button.btn.pieno', { testo: t('viste.salva'), disabled: !puo, on: { click: async () => {
    const corpo = Object.fromEntries(Object.entries(campi).map(([id, e]) => [id, id === 'aliquota' ? Number(e.value) : e.value]));
    avviso.replaceChildren();
    try { const n = await api('PUT', '/documenti/azienda', corpo); for (const [id, e] of Object.entries(campi)) if (id !== 'regime' && n[id] != null) e.value = n[id]; toast(t('moduli.doc-dati-salvati')); disegnaPronto(n); }
    catch (e) { avviso.replaceChildren(h('div.avviso', e.message, e.corpo?.dettagli?.length > 1 ? h('ul', e.corpo.dettagli.map(x => h('li', x))) : null)); }
  } } });
  // il logo
  const img = h('img.documenti-logo', { alt: t('moduli.doc-logo') }), vuoto = h('span.nota', t('moduli.doc-nessun-logo'));
  const mostraLogo = async () => { const l = a.logo ? (await get('/documenti/logo')).dati : null; img.hidden = !l; vuoto.hidden = !!l; if (l) img.src = l; };
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, on: { change: () => {
    const x = file.files[0]; file.value = ''; if (!x) return;
    if (!['image/png', 'image/jpeg'].includes(x.type)) return toast(t('moduli.doc-logo-tipo'), true);
    if (x.size > 300 * 1024) return toast(t('moduli.doc-logo-grande'), true);
    const r = new FileReader(); r.onload = async () => { try { await api('PUT', '/documenti/logo', { dati: r.result }); a.logo = true; mostraLogo(); toast(t('moduli.doc-logo-caricato')); } catch (e) { toast(e.message, true); } }; r.readAsDataURL(x);
  } } });
  const logo = h('div.documenti-riga-logo', h('div.documenti-cornice', img, vuoto), puo ? h('div', h('button.btn', { testo: t('moduli.doc-carica-logo'), on: { click: () => file.click() } }), ' ',
    h('button.btn.nudo', { testo: t('comune.togli'), on: { click: async () => { await api('DELETE', '/documenti/logo'); a.logo = false; mostraLogo(); } } }), h('div.nota', t('moduli.doc-logo-nota')), file) : null);
  const pronto = h('div');
  function disegnaPronto(x) {
    const voci = [[t('moduli.doc-campo-ragione_sociale'), !!x.ragione_sociale], [t('moduli.doc-campo-piva'), !!x.piva], [t('moduli.doc-campo-regime'), !!x.regime], [t('moduli.doc-indirizzo-completo'), !!(x.via && x.cap && x.comune)]];
    pronto.replaceChildren(h('div.etichetta', t('moduli.doc-fattura-elettronica')), h('ul.documenti-pronto', voci.map(([n, ok]) => h('li', { class: ok ? 'ok' : '' }, ok ? '✓ ' : '○ ', n))),
      h('p.nota', t('moduli.doc-fatturapa-nota')));
  }
  disegnaPronto(a); mostraLogo();
  corpo.replaceChildren(avviso, h('div.scheda', h('div.foglio', h('div.etichetta', t('moduli.doc-logo')), logo, h('div', { stile: { height: '18px' } }), griglia,
    h('div', { stile: { marginTop: '18px', display: 'flex', justifyContent: 'flex-end' } }, salva)), h('div.lato-scheda', h('div.foglio', pronto))));
}

async function elencoModelli(corpo, k) {
  const { h, get } = k;
  let l; try { l = await get('/documenti/modelli'); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
  if (!l.length) { corpo.replaceChildren(h('div.vuoto', t('moduli.doc-nessuna-stampa'))); return; }
  corpo.replaceChildren(h('p.nota', t('moduli.doc-elenco-nota')),
    h('table.tabella', h('thead', h('tr', h('th', t('moduli.doc-documento')), h('th', t('moduli.doc-modello')), h('th'))), h('tbody', l.map(m => h('tr', { on: { click: () => { location.hash = `#/documenti/modelli/${m.id}`; } } },
      h('td', m.nome), h('td', m.personalizzato ? t('moduli.doc-personalizzato') : t('moduli.doc-predefinito')), h('td.num', h('a.btn.piccolo', { href: `#/documenti/modelli/${m.id}`, testo: t('moduli.ag-modifica') })))))));
}

async function editorModello(corpo, k, e) {
  const { h, get, api, toast } = k;
  const def = k.schema.find(x => x.id === e);
  let m, esempio;
  try { m = await get(`/documenti/modelli/${e}`); esempio = (await get(`/dati/${e}?n=1`)).righe[0]; } catch (x) { corpo.replaceChildren(h('div.avviso', x.message)); return; }
  const puo = !!k.stato.poteri?.schema;
  const testo = (id, nome, righe = 1, nota) => {
    const el = righe > 1 ? h('textarea.campo', { value: m[id] ?? '', rows: righe }) : h('input.campo', { value: m[id] ?? '' });
    el.addEventListener('input', () => { m[id] = el.value; aggiorna(); });
    return h('div.documenti-voce', h('label.etichetta', nome), el, nota ? h('div.nota', nota) : null);
  };
  const spunta = (id, nome) => { const el = h('input', { type: 'checkbox', checked: !!m[id], on: { change: () => { m[id] = el.checked; aggiorna(); } } }); return h('label.documenti-spunta', el, nome); };
  const elenco = (id, nome, conAllinea) => {
    const box = h('div');
    const disegna = () => box.replaceChildren(h('label.etichetta', nome), ...m[id].map((x, i) => h('div.documenti-colonna',
      h('input.campo', { value: x.etichetta, placeholder: t('moduli.ag-titolo'), on: { input: ev => { x.etichetta = ev.target.value; aggiorna(); } } }),
      h('input.campo.mono', { value: x.valore, placeholder: '{{campo}}', on: { input: ev => { x.valore = ev.target.value; aggiorna(); } } }),
      conAllinea ? h('select.campo', { on: { change: ev => { if (ev.target.value) x.allinea = 'destra'; else delete x.allinea; aggiorna(); } } },
        h('option', { value: '', testo: t('moduli.doc-sinistra'), selected: x.allinea !== 'destra' }), h('option', { value: 'destra', testo: t('moduli.doc-destra'), selected: x.allinea === 'destra' })) : null,
      h('div.documenti-mosse', h('button.btn.nudo.piccolo', { title: t('comune.su'), testo: '↑', disabled: !i, on: { click: () => { [m[id][i - 1], m[id][i]] = [m[id][i], m[id][i - 1]]; disegna(); aggiorna(); } } }),
        h('button.btn.nudo.piccolo', { title: t('comune.togli'), testo: '×', on: { click: () => { m[id].splice(i, 1); disegna(); aggiorna(); } } })))),
      h('button.btn.piccolo', { testo: t('moduli.ag-piu-aggiungi'), on: { click: () => { m[id].push({ etichetta: '', valore: '' }); disegna(); } } }));
    disegna(); return box;
  };
  const colore = h('input.campo.documenti-colore', { type: 'color', value: m.colore || '#111111', on: { input: () => { m.colore = colore.value; aggiorna(); } } });
  const coloreAzienda = h('input', { type: 'checkbox', checked: !m.colore, on: { change: () => { m.colore = coloreAzienda.checked ? '' : colore.value; aggiorna(); } } });
  const avviso = h('div');
  const salva = h('button.btn.pieno', { testo: t('moduli.doc-salva-modello'), disabled: !puo, on: { click: async () => {
    avviso.replaceChildren();
    try { m = { ...(await api('PUT', `/documenti/modelli/${e}`, m)), personalizzato: true }; toast(t('moduli.doc-modello-salvato')); }
    catch (x) { avviso.replaceChildren(h('div.avviso', x.message)); }
  } } });
  const predefinito = h('button.btn.nudo', { testo: t('moduli.doc-torna-predefinito'), disabled: !puo, on: { click: async () => {
    if (!confirm(t('moduli.doc-torna-conferma'))) return;
    await api('DELETE', `/documenti/modelli/${e}`); toast(t('moduli.doc-modello-predefinito')); editorModello(corpo, k, e);
  } } });
  // l'anteprima: il documento più recente della sezione, con il modello com'è adesso (non ancora salvato)
  const tavolo = h('div.documenti-tavolo.documenti-tavolo-editor');
  let timer;
  function aggiorna() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!esempio) { tavolo.replaceChildren(h('div.vuoto', t('moduli.doc-crea-uno', { nome: def?.nome ? minuscole(def.nome) : e }))); return; }
      try { const s = await api('POST', `/documenti/anteprima/${e}/${esempio.id}`, m); const f = foglio(k, s.html); tavolo.replaceChildren(f); }
      catch (x) { tavolo.replaceChildren(h('div.avviso', x.message)); }
    }, 350);
  }
  const relazioni = (def?.campi || []).filter(c => c.tipo === 'relazione' && !c.molti).map(c => `{{${c.id}.nome}}`);
  const aiuto = h('details.documenti-aiuto', h('summary', t('moduli.doc-segnaposto')),
    h('p', t('moduli.doc-seg-campi'), h('code', (def?.campi || []).filter(c => !['righe'].includes(c.tipo)).map(c => `{{${c.id}}}`).join(' '))),
    relazioni.length ? h('p', t('moduli.doc-seg-collegati'), h('code', relazioni.join(' '))) : null,
    h('p', t('moduli.doc-seg-azienda'), h('code', '{{azienda.ragione_sociale}} {{azienda.piva}} {{azienda.iban}} {{azienda.pec}}')),
    h('p', t('moduli.doc-seg-colonne'), h('code', '{{linea.descrizione}} {{linea.quantita}} {{linea.prezzo}} {{linea.sconto}} {{linea.iva}} {{linea.totale}}'), t('moduli.doc-seg-campi-riga'), h('code', '{{riga.campo}}')),
    h('p', t('moduli.doc-seg-totali'), h('code', '{{totali.imponibile}} {{totali.imposta}} {{totali.totale}}'), t('moduli.doc-seg-oggi'), h('code', '{{oggi}}')),
    h('p', t('moduli.doc-seg-se'), h('code', '{{#note}}Note: {{note}}{{/note}}'), t('moduli.doc-seg-se-manca'), h('code', '{{^scadenza}}Pagamento a vista{{/scadenza}}'), '.'));
  corpo.replaceChildren(avviso, h('div.documenti-editor',
    h('div.foglio.documenti-moduli',
      h('div.documenti-titolo', h('a.btn.nudo.piccolo', { href: '#/documenti/modelli', testo: '←' }), h('b', def?.nome || e), m.personalizzato ? h('span.nota', ' · ', t('moduli.doc-personalizzato')) : null),
      testo('titolo', t('moduli.doc-ed-titolo')),
      h('div.documenti-voce', h('label.etichetta', t('moduli.doc-ed-colore-label')), h('div.documenti-in-riga', colore, h('label.documenti-spunta', coloreAzienda, t('moduli.doc-ed-colore-azienda')))),
      testo('etichettaDestinatario', t('moduli.doc-ed-sopra-destinatario')), testo('destinatario', t('moduli.doc-ed-destinatario'), 4),
      elenco('dettagli', t('moduli.doc-ed-dettagli')), elenco('colonne', t('moduli.doc-ed-colonne'), true),
      spunta('riepilogoIva', t('moduli.doc-ed-riepilogo-iva')), spunta('prezziIvati', t('moduli.doc-ed-prezzi-ivati')),
      testo('note', t('moduli.doc-ed-note'), 3), testo('pagamento', t('moduli.doc-ed-pagamento'), 2), testo('piede', t('moduli.doc-ed-piede'), 2), aiuto,
      h('div.documenti-azioni', predefinito, salva)),
    tavolo));
  aggiorna();
}

export default {
  nome: 'documenti',
  async avvio(k) {
    caricaCss();
    // i clienti dei modelli di settore prendono i campi per la fattura elettronica (codice destinatario, PEC, indirizzo…)
    const f = fattureDi(k.schema), cl = f && k.schema.find(e => e.id === f.campi.find(c => c.id === 'cliente')?.entita);
    // (e il vecchio campo libero «Indirizzo» si unifica con via, CAP e comune: server/moduli/sicurezza-migrazioni.js)
    // è una modifica dello schema: si chiede prima (una volta per sessione, se la risposta è «no»)
    let chiesto = false; try { chiesto = sessionStorage.getItem('kubo.documenti.prepara') === 'no'; } catch {}
    if (cl && (!cl.campi.some(c => c.id === 'codice_destinatario') || cl.campi.some(c => c.id === 'indirizzo')) && k.stato.poteri?.schema && !chiesto) {
      const ok = confirm(t('moduli.doc-prepara-chiedi', { nome: cl.nome }));
      if (!ok) { try { sessionStorage.setItem('kubo.documenti.prepara', 'no'); } catch {} return; }
      try { const r = await k.api('POST', '/documenti/prepara'); await k.ricaricaSchema(); if (r.aggiunti?.length) k.toast(t('moduli.doc-prepara-fatto')); } catch { /* si riprova al prossimo avvio */ }
    }
  },
  lato: k => (k.stato.poteri?.schema ? [{ href: '#/documenti', icona: 'documento', nome: t('moduli.doc-documenti') }] : []),
  rotte: { documenti: (contenuto, k, a, b) => pagina(contenuto, k, a, b) },
  azioniScheda(def, riga, k) {
    const { h } = k, out = [];
    const f = fattureDi(k.schema), entCliente = f?.campi.find(c => c.id === 'cliente')?.entita;
    if (f && def.id !== 'fatture' && f.puo?.crea && def.campi.some(c => c.tipo === 'relazione' && !c.molti && c.entita === entCliente) && riga.id)
      out.push(h('button.btn', { testo: t('moduli.doc-crea-fattura'), title: t('moduli.doc-crea-fattura-nota'), on: { click: async ev => {
        ev.target.disabled = true;
        try { const n = await k.api('POST', `/documenti/fattura-da/${def.id}/${riga.id}`); k.toast(t('moduli.doc-fattura-creata')); location.hash = `#/e/fatture/${n.id}`; }
        catch (e) { k.toast(e.message, true); ev.target.disabled = false; }
      } } }));
    if (def.id === 'fatture' && def.puo?.crea && riga.numero && riga.tipo !== 'TD04' && ['emessa', 'pagata'].includes(riga.stato))
      out.push(h('button.btn', { testo: t('moduli.doc-nota-credito'), title: t('moduli.doc-nota-credito-nota'), on: { click: async ev => {
        if (!confirm(t('moduli.doc-nota-conferma', { numero: riga.numero }))) return;
        ev.target.disabled = true;
        try { const n = await k.api('POST', `/documenti/nota-di-credito/${riga.id}`); k.toast(t('moduli.doc-nota-creata')); location.hash = `#/e/fatture/${n.id}`; }
        catch (e) { k.toast(e.message, true); ev.target.disabled = false; }
      } } }));
    if (def.id === 'fatture') out.push(h('button.btn', { testo: 'FatturaPA', title: t('moduli.doc-fatturapa-titolo'), on: { click: () => fatturaPA(riga, k) } }));
    if (stampabile(def)) out.push(h('button.btn', { title: t('moduli.doc-stampa-titolo'), on: { click: () => apriStampa(def, riga, k) } }, k.icona('documento'), t('moduli.doc-stampa')));
    return out;
  },
};
