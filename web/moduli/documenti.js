// Documenti nell'interfaccia: «Stampa» (anteprima A4 e finestra di stampa del browser, da cui si salva anche il PDF),
// «Crea fattura» dalle vendite, dai preventivi e dalle commesse, «FatturaPA» sulle fatture (controlli, poi il file XML),
// e la pagina #/documenti con i dati dell'azienda, il logo e l'editor dei modelli di stampa.
// Il documento arriva dal server già pronto e «escapato»; si mostra in un iframe sandbox senza script.

const TESTI_AZIENDA = [
  ['ragione_sociale', 'Ragione sociale', 'largo'], ['piva', 'Partita IVA'], ['codice_fiscale', 'Codice fiscale'], ['regime', 'Regime fiscale'],
  ['via', 'Indirizzo (via e civico)', 'largo'], ['cap', 'CAP'], ['comune', 'Comune'], ['provincia', 'Provincia (sigla)'],
  ['telefono', 'Telefono'], ['email', 'Email'], ['pec', 'PEC'], ['codice_destinatario', 'Il tuo codice destinatario'],
  ['iban', 'IBAN', 'largo'], ['banca', 'Banca'], ['aliquota', 'IVA predefinita %'], ['colore', 'Colore dei documenti'],
];
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
      h('div.documenti-barra', h('b', titolo), h('span.documenti-spazio'), ...contenuto.filter(x => x?.dataset?.barra), h('button.btn.nudo', { title: 'Chiudi (Esc)', testo: '×', on: { click: () => chiudi() } })),
      ...contenuto.filter(x => !x?.dataset?.barra)));
  document.addEventListener('keydown', esc); window.addEventListener('hashchange', chiudi); document.body.append(velo);   // cambiando pagina si chiude
  return { velo, chiudi };
}
function foglio(k, html) {
  const f = k.h('iframe.documenti-foglio', { title: 'Anteprima di stampa' });
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
  const bottone = h('button.btn.pieno', { testo: 'Stampa o salva PDF', 'data-barra': '1', on: { click: () => stampa(f) } });
  const modifica = k.stato.poteri?.schema ? h('a.btn', { href: `#/documenti/modelli/${def.id}`, testo: 'Modifica il modello', 'data-barra': '1' }) : null;
  finestra(k, s.titolo, modifica, bottone, h('div.documenti-tavolo', f));
}

// ---------- FatturaPA ----------
async function fatturaPA(riga, k) {
  const { h, get, api, toast } = k;
  let c; try { c = await get(`/documenti/fatturapa/${riga.id}`); } catch (e) { return toast(e.message, true); }
  if (c.errori.length) {
    finestra(k, 'Prima del file XML manca qualcosa', h('div.documenti-controlli', h('p', 'Sistema questi punti e riprova:'), h('ul', c.errori.map(x => h('li', x))),
      k.stato.poteri?.schema ? h('p', h('a', { href: '#/documenti', testo: 'Apri i dati dell\'azienda' })) : null));
    return;
  }
  try {
    const x = await api('POST', `/documenti/fatturapa/${riga.id}`);
    const a = h('a', { href: URL.createObjectURL(new Blob([x.xml], { type: 'application/xml' })), download: x.nome });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Scaricato ${x.nome}: ora caricalo sul portale del tuo intermediario o di Fatture e Corrispettivi`);
  } catch (e) { toast(e.message, true); }
}

// ---------- pagina «Documenti» ----------
function pagina(contenuto, k, sezione, entita) {
  const { h } = k;
  const schede = h('div.documenti-schede',
    h('a', { href: '#/documenti', class: !sezione ? 'si' : '', testo: 'Dati dell\'azienda' }),
    h('a', { href: '#/documenti/modelli', class: sezione === 'modelli' ? 'si' : '', testo: 'Modelli di stampa' }));
  const corpo = h('div.corpo');
  contenuto.replaceChildren(h('div.testa', h('h1', 'Documenti'), schede), corpo);
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
  const salva = h('button.btn.pieno', { testo: 'Salva', disabled: !puo, on: { click: async () => {
    const corpo = Object.fromEntries(Object.entries(campi).map(([id, e]) => [id, id === 'aliquota' ? Number(e.value) : e.value]));
    avviso.replaceChildren();
    try { const n = await api('PUT', '/documenti/azienda', corpo); for (const [id, e] of Object.entries(campi)) if (id !== 'regime' && n[id] != null) e.value = n[id]; toast('Dati dell\'azienda salvati'); disegnaPronto(n); }
    catch (e) { avviso.replaceChildren(h('div.avviso', e.message, e.corpo?.dettagli?.length > 1 ? h('ul', e.corpo.dettagli.map(x => h('li', x))) : null)); }
  } } });
  // il logo
  const img = h('img.documenti-logo', { alt: 'Logo' }), vuoto = h('span.nota', 'Nessun logo');
  const mostraLogo = async () => { const l = a.logo ? (await get('/documenti/logo')).dati : null; img.hidden = !l; vuoto.hidden = !!l; if (l) img.src = l; };
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, on: { change: () => {
    const x = file.files[0]; file.value = ''; if (!x) return;
    if (!['image/png', 'image/jpeg'].includes(x.type)) return toast('Il logo deve essere un PNG o un JPEG', true);
    if (x.size > 300 * 1024) return toast('Il logo è troppo grande: al massimo 300 KB', true);
    const r = new FileReader(); r.onload = async () => { try { await api('PUT', '/documenti/logo', { dati: r.result }); a.logo = true; mostraLogo(); toast('Logo caricato'); } catch (e) { toast(e.message, true); } }; r.readAsDataURL(x);
  } } });
  const logo = h('div.documenti-riga-logo', h('div.documenti-cornice', img, vuoto), puo ? h('div', h('button.btn', { testo: 'Carica il logo', on: { click: () => file.click() } }), ' ',
    h('button.btn.nudo', { testo: 'Togli', on: { click: async () => { await api('DELETE', '/documenti/logo'); a.logo = false; mostraLogo(); } } }), h('div.nota', 'PNG o JPEG, al massimo 300 KB. Va in testa a ogni documento.'), file) : null);
  const pronto = h('div');
  function disegnaPronto(x) {
    const voci = [['Ragione sociale', !!x.ragione_sociale], ['Partita IVA', !!x.piva], ['Regime fiscale', !!x.regime], ['Indirizzo completo', !!(x.via && x.cap && x.comune)]];
    pronto.replaceChildren(h('div.etichetta', 'Fattura elettronica'), h('ul.documenti-pronto', voci.map(([n, ok]) => h('li', { class: ok ? 'ok' : '' }, ok ? '✓ ' : '○ ', n))),
      h('p.nota', 'Kubo prepara il file FatturaPA (XML). Per mandarlo allo SDI caricalo sul portale Fatture e Corrispettivi dell\'Agenzia delle Entrate o sul tuo intermediario: trovi i passi in docs/DOCUMENTI.md.'));
  }
  disegnaPronto(a); mostraLogo();
  corpo.replaceChildren(avviso, h('div.scheda', h('div.foglio', h('div.etichetta', 'Logo'), logo, h('div', { stile: { height: '18px' } }), griglia,
    h('div', { stile: { marginTop: '18px', display: 'flex', justifyContent: 'flex-end' } }, salva)), h('div.lato-scheda', h('div.foglio', pronto))));
}

async function elencoModelli(corpo, k) {
  const { h, get } = k;
  let l; try { l = await get('/documenti/modelli'); } catch (e) { corpo.replaceChildren(h('div.avviso', e.message)); return; }
  if (!l.length) { corpo.replaceChildren(h('div.vuoto', 'Nessuna sezione con righe da stampare. Aggiungi un modello (negozio, laboratorio, fatture) o una sezione con le righe.')); return; }
  corpo.replaceChildren(h('p.nota', 'Ogni sezione con righe ha il suo documento A4. Cambia testi, colonne e piè di pagina: l\'anteprima si aggiorna mentre scrivi.'),
    h('table.tabella', h('thead', h('tr', h('th', 'Documento'), h('th', 'Modello'), h('th'))), h('tbody', l.map(m => h('tr', { on: { click: () => { location.hash = `#/documenti/modelli/${m.id}`; } } },
      h('td', m.nome), h('td', m.personalizzato ? 'personalizzato' : 'predefinito'), h('td.num', h('a.btn.piccolo', { href: `#/documenti/modelli/${m.id}`, testo: 'Modifica' })))))));
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
      h('input.campo', { value: x.etichetta, placeholder: 'Titolo', on: { input: ev => { x.etichetta = ev.target.value; aggiorna(); } } }),
      h('input.campo.mono', { value: x.valore, placeholder: '{{campo}}', on: { input: ev => { x.valore = ev.target.value; aggiorna(); } } }),
      conAllinea ? h('select.campo', { on: { change: ev => { if (ev.target.value) x.allinea = 'destra'; else delete x.allinea; aggiorna(); } } },
        h('option', { value: '', testo: 'a sinistra', selected: x.allinea !== 'destra' }), h('option', { value: 'destra', testo: 'a destra', selected: x.allinea === 'destra' })) : null,
      h('div.documenti-mosse', h('button.btn.nudo.piccolo', { title: 'Sposta su', testo: '↑', disabled: !i, on: { click: () => { [m[id][i - 1], m[id][i]] = [m[id][i], m[id][i - 1]]; disegna(); aggiorna(); } } }),
        h('button.btn.nudo.piccolo', { title: 'Togli', testo: '×', on: { click: () => { m[id].splice(i, 1); disegna(); aggiorna(); } } })))),
      h('button.btn.piccolo', { testo: '+ Aggiungi', on: { click: () => { m[id].push({ etichetta: '', valore: '' }); disegna(); } } }));
    disegna(); return box;
  };
  const colore = h('input.campo.documenti-colore', { type: 'color', value: m.colore || '#111111', on: { input: () => { m.colore = colore.value; aggiorna(); } } });
  const coloreAzienda = h('input', { type: 'checkbox', checked: !m.colore, on: { change: () => { m.colore = coloreAzienda.checked ? '' : colore.value; aggiorna(); } } });
  const avviso = h('div');
  const salva = h('button.btn.pieno', { testo: 'Salva il modello', disabled: !puo, on: { click: async () => {
    avviso.replaceChildren();
    try { m = { ...(await api('PUT', `/documenti/modelli/${e}`, m)), personalizzato: true }; toast('Modello salvato'); }
    catch (x) { avviso.replaceChildren(h('div.avviso', x.message)); }
  } } });
  const predefinito = h('button.btn.nudo', { testo: 'Torna al predefinito', disabled: !puo, on: { click: async () => {
    if (!confirm('Tornare al modello predefinito? Le modifiche di questo modello si perdono.')) return;
    await api('DELETE', `/documenti/modelli/${e}`); toast('Modello predefinito'); editorModello(corpo, k, e);
  } } });
  // l'anteprima: il documento più recente della sezione, con il modello com'è adesso (non ancora salvato)
  const tavolo = h('div.documenti-tavolo.documenti-tavolo-editor');
  let t;
  function aggiorna() {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!esempio) { tavolo.replaceChildren(h('div.vuoto', `Crea almeno un documento in ${def?.nome?.toLowerCase() || e} per vedere l'anteprima.`)); return; }
      try { const s = await api('POST', `/documenti/anteprima/${e}/${esempio.id}`, m); const f = foglio(k, s.html); tavolo.replaceChildren(f); }
      catch (x) { tavolo.replaceChildren(h('div.avviso', x.message)); }
    }, 350);
  }
  const relazioni = (def?.campi || []).filter(c => c.tipo === 'relazione' && !c.molti).map(c => `{{${c.id}.nome}}`);
  const aiuto = h('details.documenti-aiuto', h('summary', 'Segnaposto che puoi usare'),
    h('p', 'Campi del documento: ', h('code', (def?.campi || []).filter(c => !['righe'].includes(c.tipo)).map(c => `{{${c.id}}}`).join(' '))),
    relazioni.length ? h('p', 'Collegati (ogni loro campo): ', h('code', relazioni.join(' '))) : null,
    h('p', 'La tua azienda: ', h('code', '{{azienda.ragione_sociale}} {{azienda.piva}} {{azienda.iban}} {{azienda.pec}}')),
    h('p', 'Nelle colonne, ogni riga: ', h('code', '{{linea.descrizione}} {{linea.quantita}} {{linea.prezzo}} {{linea.sconto}} {{linea.iva}} {{linea.totale}}'), ' e i campi della riga: ', h('code', '{{riga.campo}}')),
    h('p', 'Totali: ', h('code', '{{totali.imponibile}} {{totali.imposta}} {{totali.totale}}'), ' · oggi: ', h('code', '{{oggi}}')),
    h('p', 'Un pezzo che si vede solo se il campo c\'è: ', h('code', '{{#note}}Note: {{note}}{{/note}}'), '; solo se manca: ', h('code', '{{^scadenza}}Pagamento a vista{{/scadenza}}'), '.'));
  corpo.replaceChildren(avviso, h('div.documenti-editor',
    h('div.foglio.documenti-moduli',
      h('div.documenti-titolo', h('a.btn.nudo.piccolo', { href: '#/documenti/modelli', testo: '←' }), h('b', def?.nome || e), m.personalizzato ? h('span.nota', ' · personalizzato') : null),
      testo('titolo', 'Titolo del documento'),
      h('div.documenti-voce', h('label.etichetta', 'Colore'), h('div.documenti-in-riga', colore, h('label.documenti-spunta', coloreAzienda, 'quello dell\'azienda'))),
      testo('etichettaDestinatario', 'Sopra il destinatario'), testo('destinatario', 'Destinatario', 4),
      elenco('dettagli', 'Dettagli in alto a destra'), elenco('colonne', 'Colonne delle righe', true),
      spunta('riepilogoIva', 'Riepilogo IVA per aliquota'), spunta('prezziIvati', 'I prezzi comprendono l\'IVA (scorporo)'),
      testo('note', 'Note', 3), testo('pagamento', 'Pagamento', 2), testo('piede', 'Piè di pagina', 2), aiuto,
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
    if (cl && !cl.campi.some(c => c.id === 'codice_destinatario') && k.stato.poteri?.schema) {
      try { const r = await k.api('POST', '/documenti/prepara'); if (r.aggiunti?.length) await k.ricaricaSchema(); } catch { /* si riprova al prossimo avvio */ }
    }
  },
  lato: k => (k.stato.poteri?.schema ? [{ href: '#/documenti', icona: 'documento', nome: 'Documenti' }] : []),
  rotte: { documenti: (contenuto, k, a, b) => pagina(contenuto, k, a, b) },
  azioniScheda(def, riga, k) {
    const { h } = k, out = [];
    const f = fattureDi(k.schema), entCliente = f?.campi.find(c => c.id === 'cliente')?.entita;
    if (f && def.id !== 'fatture' && f.puo?.crea && def.campi.some(c => c.tipo === 'relazione' && !c.molti && c.entita === entCliente) && riga.id)
      out.push(h('button.btn', { testo: 'Crea fattura', title: 'Una fattura in bozza con il cliente e le righe di questo documento', on: { click: async ev => {
        ev.target.disabled = true;
        try { const n = await k.api('POST', `/documenti/fattura-da/${def.id}/${riga.id}`); k.toast('Fattura in bozza creata'); location.hash = `#/e/fatture/${n.id}`; }
        catch (e) { k.toast(e.message, true); ev.target.disabled = false; }
      } } }));
    if (def.id === 'fatture' && def.puo?.crea && riga.numero && riga.tipo !== 'TD04' && ['emessa', 'pagata'].includes(riga.stato))
      out.push(h('button.btn', { testo: 'Nota di credito', title: 'Storna questa fattura con una nota di credito in bozza', on: { click: async ev => {
        if (!confirm(`Creare una nota di credito che storna la fattura ${riga.numero}?`)) return;
        ev.target.disabled = true;
        try { const n = await k.api('POST', `/documenti/nota-di-credito/${riga.id}`); k.toast('Nota di credito in bozza creata'); location.hash = `#/e/fatture/${n.id}`; }
        catch (e) { k.toast(e.message, true); ev.target.disabled = false; }
      } } }));
    if (def.id === 'fatture') out.push(h('button.btn', { testo: 'FatturaPA', title: 'Controlla e scarica il file XML per lo SDI', on: { click: () => fatturaPA(riga, k) } }));
    if (stampabile(def)) out.push(h('button.btn', { title: 'Anteprima, stampa e PDF', on: { click: () => apriStampa(def, riga, k) } }, k.icona('documento'), 'Stampa'));
    return out;
  },
};
