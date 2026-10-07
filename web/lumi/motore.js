// Copiato da github.com/W1kicartel/lumi (MIT, © W1kicartel). Adattamento per Kubo: «strumenti» può essere una funzione,
// riletta a ogni giro (lo schema cambia mentre si parla: una sezione nuova porta i suoi strumenti).
// Il motore di Lumi, senza DOM: la conversazione con Claude (in streaming, attraverso il server dell'azienda), gli
// strumenti dell'host, le proposte con «Conferma / Annulla», i file, lo schermo condiviso. L'interfaccia (interfaccia.js)
// gli passa un adattatore `ui` e lui la chiama; le prove (test/motore.mjs) gli passano un adattatore finto e un fetch finto.
//
// Le regole che contano:
// • gli strumenti di LETTURA girano qui, nel browser dell'host, con i permessi di chi è collegato: il modello vede solo
//   quello che l'host restituisce;
// • gli strumenti di SCRITTURA sono proposte: il modello chiede, l'host prepara il riepilogo (proponi), la persona
//   conferma o annulla, e solo dopo la conferma l'host esegue (esegui). Il modello non scrive mai da solo;
// • la storia mandata al modello resta sempre valida: ogni tool_use seguito dal suo tool_result. Se un giro fallisce si
//   torna a com'era prima della domanda.
import { oscura, raccogliNomi, aggiungiNome } from './privacy.js';
import { leggiFile, base64 } from './file.js';

// lo strumento che l'interfaccia offre da sola: una scheda con una cifra o un elenco nel pannello
export const MOSTRA = {
  nome: 'mostra',
  descrizione: 'Shows a card in the panel: "numero" for one key figure (valore, nota), "elenco" for a short list of rows (titolo, nota, valore). After it, comment in one short sentence. / Mostra una scheda nel pannello: "numero" per una cifra chiave, "elenco" per poche righe. Dopo, commenta in una frase.',
  schema: { type: 'object', properties: {
    tipo: { type: 'string', enum: ['numero', 'elenco'] }, titolo: { type: 'string', maxLength: 120 },
    valore: { type: 'string', maxLength: 60 }, nota: { type: 'string', maxLength: 200 },
    righe: { type: 'array', maxItems: 12, items: { type: 'object', properties: { titolo: { type: 'string' }, nota: { type: 'string' }, valore: { type: 'string' } } } },
  }, required: ['tipo'] },
};
const NOME_OK = /^[a-zA-Z0-9_-]{1,64}$/;

// una conferma è SOLO una di queste risposte, intera (punteggiatura a parte): «manda solo a Maria» non conferma niente
// anche in spagnolo, francese, tedesco e portoghese (le lingue di Kubo): sí, oui, ja, sim… / non, nein, não…
const SI = /^(s[iìí]|ok(ay)?|conferm[aoi]|confermo|vai|procedi|certo|fallo|esatto|d'accordo|yes|yep|yeah|sure|confirm|go ahead|do it|vale|claro|confirmo|confirmar|confirme|oui|confirmer|d’accord|ja|genau|bestätigen|sim|pode)( pure)?[\s,.!]*$/i;
const NO = /^(no|annulla|lascia (stare|perdere)|aspetta|stop|fermati|ferma|non farlo|niente|meglio di no|cancel|nope|don'?t|wait|never ?mind|cancelar|mejor no|non|annuler|nein|abbrechen|lieber nicht|não|nao|melhor não)[\s,.!]*$/i;
export const eSi = t => SI.test(String(t).trim());
export const eNo = t => NO.test(String(t).trim());

/* ---------- un controllo piccolo di JSON Schema: con lo streaming degli input l'API non li valida più ---------- */
export function controllaSchema(v, s, dove = 'input') {
  if (!s || typeof s !== 'object') return '';
  const tipi = s.type ? [].concat(s.type) : null;
  const tipo = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (tipi && !tipi.some(t => t === tipo || (t === 'integer' && Number.isInteger(v)) || (t === 'number' && tipo === 'number' && Number.isFinite(v)))) return `${dove}: expected ${tipi.join('|')}`;
  if (s.enum && !s.enum.some(x => x === v)) return `${dove}: must be one of ${s.enum.join(', ')}`;
  if (tipo === 'string') { if (s.maxLength != null && v.length > s.maxLength) return `${dove}: longer than ${s.maxLength}`; if (s.minLength != null && v.length < s.minLength) return `${dove}: shorter than ${s.minLength}`; }
  if (tipo === 'number') { if (s.minimum != null && v < s.minimum) return `${dove}: below ${s.minimum}`; if (s.maximum != null && v > s.maximum) return `${dove}: above ${s.maximum}`; }
  if (tipo === 'array') {
    if (s.minItems != null && v.length < s.minItems) return `${dove}: fewer than ${s.minItems} items`;
    if (s.maxItems != null && v.length > s.maxItems) return `${dove}: more than ${s.maxItems} items`;
    if (s.items) for (let i = 0; i < v.length; i++) { const e = controllaSchema(v[i], s.items, `${dove}[${i}]`); if (e) return e; }
  }
  if (tipo === 'object') {
    for (const k of s.required || []) if (!(k in v)) return `${dove}.${k}: missing`;
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) { const e = controllaSchema(x, s.properties[k], `${dove}.${k}`); if (e) return e; }
      else if (s.additionalProperties === false) return `${dove}.${k}: not allowed`;
    }
  }
  return '';
}

// controlla e mette in forma gli strumenti dell'host; lancia un errore chiaro a chi integra
export function preparaStrumenti(lista = []) {
  const visti = new Set(), out = [];
  for (const s of [...lista, MOSTRA]) {
    if (!s || !NOME_OK.test(s.nome || '')) throw new TypeError(`Lumi: tool name «${s?.nome}» must match ${NOME_OK}`);
    if (visti.has(s.nome)) { if (s === MOSTRA) continue; throw new TypeError(`Lumi: tool «${s.nome}» defined twice`); }
    const scrive = typeof s.proponi === 'function' || typeof s.esegui === 'function';
    if (scrive && (typeof s.proponi !== 'function' || typeof s.esegui !== 'function')) throw new TypeError(`Lumi: write tool «${s.nome}» needs both proponi() and esegui()`);
    if (!scrive && s !== MOSTRA && typeof s.leggi !== 'function') throw new TypeError(`Lumi: tool «${s.nome}» needs leggi() (read) or proponi() + esegui() (write)`);
    visti.add(s.nome);
    out.push({ ...s, scrive, schema: s.schema || { type: 'object', properties: {} } });
  }
  return out;
}

/* ---------- il motore ---------- */
export function creaMotore(op, ui = {}) {
  const t = op.t, f = op.fetch || ((...a) => fetch(...a));
  let strumenti = preparaStrumenti(typeof op.strumenti === 'function' ? op.strumenti() : op.strumenti);
  let perNome = new Map(strumenti.map(s => [s.nome, s]));
  const rileggiStrumenti = () => { if (typeof op.strumenti !== 'function') return; try { strumenti = preparaStrumenti(op.strumenti()); perNome = new Map(strumenti.map(s => [s.nome, s])); } catch (e) { console.error(e); } };
  const nomiSensibili = new Set(); let nomiHost = [];
  const M = {
    storia: [], inCorso: false, attesa: null, controller: null, stop: false, ciclo: null, serie: Promise.resolve(),
    allegati: [], fileIds: [], servizio: null, finitoIl: 0, ultimoUso: 0, proponendo: false, gen: 0, avvisato: false,
  };
  const U = new Proxy(ui, { get: (o, k) => (typeof o[k] === 'function' ? o[k].bind(o) : () => undefined) });

  /* ---------- schermo condiviso ---------- */
  let condiviso = !!(typeof op.privacy?.inNegozio === 'function' ? false : op.privacy?.inNegozio);
  const schermoCondiviso = () => (typeof op.privacy?.inNegozio === 'function' ? !!op.privacy.inNegozio() : condiviso);
  async function nomi() {
    const extra = typeof op.privacy?.nomi === 'function' ? await op.privacy.nomi().catch(() => []) : op.privacy?.nomi || [];
    const n = new Set(nomiSensibili); for (const x of extra || []) aggiungiNome(n, x);
    return n;
  }
  // quello che si dice a voce o compare nella pillola: in modalità schermo condiviso senza nomi, importi, telefoni
  async function pubblico(testo) {
    const s = String(testo ?? '').replace(/\*\*/g, '');
    return schermoCondiviso() ? oscura(s, { nomi: await nomi(), lingua: t.lingua }) : s;
  }
  function pubblicoSubito(testo) {
    const s = String(testo ?? '').replace(/\*\*/g, '');
    if (!schermoCondiviso()) return s;
    const n = new Set(nomiSensibili);
    let extra = op.privacy?.nomi;
    // una funzione che risponde subito con un array va bene anche qui; se restituisce una promessa vale la volta dopo
    if (typeof extra === 'function') { try { extra = extra(); } catch (e) { extra = []; } if (extra && typeof extra.then === 'function') { extra.then(v => { nomiHost = v || []; }, () => {}); extra = nomiHost; } }
    if (Array.isArray(extra)) for (const x of extra) aggiungiNome(n, x);
    return oscura(s, { nomi: n, lingua: t.lingua });
  }

  /* ---------- rete ---------- */
  async function chiama(corpo, { signal } = {}) {
    const extra = typeof op.intestazioni === 'function' ? await op.intestazioni() : op.intestazioni || {};
    // elimina-file parte anche mentre la pagina si chiude (pagehide): keepalive la lascia arrivare
    return f(op.server, { method: 'POST', signal, keepalive: corpo.azione === 'elimina-file', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(corpo) });
  }
  async function chiamaJson(corpo) {
    const r = await chiama(corpo); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.errore || `HTTP ${r.status}`);
    return j;
  }
  async function servizio() {
    if (!op.server) M.servizio = { claude: false, voce: false, locale: typeof op.locale === 'function' };
    else try { M.servizio = await chiamaJson({ azione: 'stato' }); } catch (e) { M.servizio = { claude: false, voce: false, irraggiungibile: true }; }
    U.servizio(M.servizio);
    return M.servizio;
  }
  const puoChattare = () => !!M.servizio?.claude;

  /* ---------- domande in fila: una conversazione col modello alla volta ---------- */
  function chiedi(testo, opz = {}) {
    testo = String(testo || '').trim();
    if (!testo && !M.allegati.some(a => a.stato === 'pronto')) return Promise.resolve();
    M.ultimoUso = Date.now();
    if (testo && M.attesa && !M.attesa.inCorso) return rispostaAllaProposta(testo, opz);
    if (M.inCorso && !M.attesa && !M.proponendo) interrompi();
    M.serie = M.serie.then(async () => {
      for (let i = 0; i < 200 && M.proponendo && !M.attesa; i++) await pausa(25);
      if (testo && M.attesa && !M.attesa.inCorso) return rispostaAllaProposta(testo, opz);
      while (M.inCorso) { if (!M.attesa) interrompi(); await M.ciclo?.catch(() => {}); if (M.attesa) return; }
      return chiediOra(testo, opz);
    }).catch(e => console.error(e));
    return M.serie;
  }
  // una proposta aspetta: «sì» o «no» bastano; qualsiasi altra cosa la lascia non confermata e diventa la nuova domanda
  function rispostaAllaProposta(testo, opz) {
    if (eSi(testo)) return conferma();
    if (eNo(testo)) return annulla();
    if (!opz.daVoce) U.domanda(testo, { dentroProposta: true });
    return annulla(`The person did not confirm the proposal and asked instead: «${testo}». Answer this request.`);
  }

  async function chiediOra(testo, { daVoce = false } = {}) {
    const pronti = M.allegati.filter(a => a.stato === 'pronto');
    if (!testo && !pronti.length) return;
    if (!op.server) return chiediLocale(testo, { daVoce });
    if (!puoChattare()) { U.domanda(testo, { daVoce }); U.fisso(t('risposta.irraggiungibile'), { errore: true }); return; }
    if (M.storia.length > 80 || JSON.stringify(M.storia).length > 600000) ricomincia(true);
    U.domanda(testo || t('file.etichetta', { n: pronti.length, nome: pronti[0]?.nome }), { daVoce, allegati: pronti });
    const domanda = testo || t('file.domanda', { n: pronti.length });
    const n0 = M.storia.length;
    const blocchi = [];
    const ctx = await contesto();
    if (ctx) blocchi.push({ type: 'text', text: `<contesto>\n${ctx}\n</contesto>` });
    blocchi.push(...blocchiAllegati(pronti), { type: 'text', text: domanda });
    M.storia.push({ role: 'user', content: blocchi });
    M.allegati = M.allegati.filter(a => a.stato !== 'pronto'); U.allegati(M.allegati);
    M.ciclo = ciclo(n0); return M.ciclo;
  }
  async function contesto() {
    const adesso = new Date();
    const righe = [`${t.lingua === 'it' ? 'Adesso' : 'Now'}: ${adesso.toLocaleString(t.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (${adesso.toISOString().slice(0, 10)})`];
    if (schermoCondiviso()) righe.push(t.lingua === 'it' ? 'Schermo condiviso: ci sono clienti davanti allo schermo.' : 'Shared screen: customers can see the screen.');
    try { const c = typeof op.contesto === 'function' ? await op.contesto() : op.contesto; if (c) righe.push(String(c).slice(0, 8000)); } catch (e) { console.error(e); }
    return righe.join('\n');
  }
  function blocchiAllegati(lista) {
    return lista.flatMap(a => a.modo === 'carica' ? [a.tipo === 'application/pdf'
      ? { type: 'document', source: { type: 'file', file_id: a.fileId }, title: a.nome }
      : { type: 'image', source: { type: 'file', file_id: a.fileId } }, { type: 'text', text: `(file: «${a.nome}»)` }]
      : [{ type: 'text', text: `<file name="${a.nome.replace(/"/g, '')}" type="${a.descrizione}">\n${a.testo}\n</file>` }]);
  }

  /* ---------- il giro con il modello ---------- */
  const visibile = c => (c || []).some(b => (b.type === 'text' && b.text?.trim()) || b.type === 'tool_use');
  async function ciclo(n0) {
    M.inCorso = true; M.stop = false; const g = M.gen; let mostrato = false, completo = false;
    try {
      for (let giro = 0; giro < 14; giro++) {
        if (M.stop) break;
        const esito = await turnoModello(); if (g !== M.gen) return;
        if (!esito) break;
        mostrato ||= esito.mostrato;
        if (esito.stop === 'refusal') { U.fisso(t('risposta.rifiuto'), { errore: true }); break; }
        if (!visibile(esito.contenuto)) { completo = true; if (!mostrato) U.fisso(t('risposta.vuota'), { errore: true }); break; }
        const usi = esito.contenuto.filter(b => b.type === 'tool_use');
        if (usi.length && esito.stop === 'max_tokens') { U.fisso(t('risposta.lunga'), { errore: true }); break; }
        M.storia.push({ role: 'assistant', content: esito.contenuto });
        if (esito.stop === 'pause_turn') continue;
        if (!usi.length) { completo = true; break; }
        const risultati = [];
        for (const u of usi) {
          let r;
          try { r = await strumento(u.name, u.input); } catch (e) { console.error(e); r = { errore: true, dati: { errore: String(e.message || e) } }; }
          if (g !== M.gen) return;
          mostrato ||= r.mostrato;
          risultati.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.dati ?? {}), ...(r.errore ? { is_error: true } : {}) });
        }
        M.storia.push({ role: 'user', content: risultati });
        completo = true;   // da qui la storia è valida anche se ci si ferma (l'ultimo messaggio sono i risultati)
      }
    } finally {
      if (g === M.gen) {
        if (!completo && M.storia.length > n0) M.storia.length = n0;
        M.inCorso = false; M.finitoIl = Date.now(); U.riposo();
      }
    }
  }
  async function turnoModello(tentativo = 0) {
    rileggiStrumenti();
    const ctrl = new AbortController(); M.controller = ctrl;
    U.pensa(t('campo.attimo'));
    let risposta = null, fine = null, r;
    const corpo = { azione: 'chat', messaggi: M.storia, strumenti: strumenti.map(s => ({ nome: s.nome, descrizione: (s.scrive ? '[PROPOSAL: runs only after the person confirms] ' : '') + (s.descrizione || ''), schema: s.schema })),
      azienda: op.nome, lingua: t.lingua, schermoCondiviso: schermoCondiviso(), istruzioni: op.istruzioni || '' };
    try { r = await chiama(corpo, { signal: ctrl.signal }); }
    catch (e) { if (ctrl.signal.aborted) return null; U.fisso(t('risposta.irraggiungibile'), { errore: true }); return null; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); U.fisso(j.errore || t('risposta.errore', { stato: r.status }), { errore: true }); return null; }
    try {
      for await (const ev of eventiSSE(r.body)) {
        if (ev.t === 'testo') { if (!risposta) { risposta = U.risposta() || { aggiungi() {}, fine() {}, interrotta() {} }; } risposta.aggiungi(ev.d); }
        else if (ev.t === 'strumento') { if (!risposta) U.pensa(etichetta(ev.nome)); }
        else if (ev.t === 'fine') fine = ev;
        else if (ev.t === 'errore') {
          risposta?.interrotta();
          if (ev.ripeti && tentativo < 1 && !ctrl.signal.aborted) return turnoModello(tentativo + 1);
          U.fisso(ev.messaggio || t('risposta.interrotta'), { errore: true }); return null;
        }
      }
    } catch (e) {
      risposta?.interrotta();
      if (ctrl.signal.aborted) return null;
      U.fisso(t('risposta.interrotta'), { errore: true }); return null;
    }
    if (ctrl.signal.aborted) { risposta?.interrotta(); return null; }
    if (risposta) await risposta.fine();
    if (!fine) { U.fisso(t('risposta.interrotta'), { errore: true }); return null; }
    return { stop: fine.stop, contenuto: fine.contenuto, mostrato: !!risposta };
  }
  const etichetta = nome => (nome === 'mostra' ? t('pensa.mostro') : perNome.get(nome)?.scrive ? t('pensa.preparo') : t('pensa.leggo'));

  /* ---------- strumenti ---------- */
  async function strumento(nome, input) {
    const s = perNome.get(nome);
    if (!s) return { errore: true, dati: { errore: 'unknown tool' } };
    const sbaglio = controllaSchema(input ?? {}, s.schema);
    if (sbaglio) return { errore: true, dati: { errore: 'INVALID_INPUT: ' + sbaglio } };
    if (nome === 'mostra' && !s.leggi && !s.scrive) { U.riposo(); U.mostra(input); await pausa(120); return { dati: { mostrato: true }, mostrato: true }; }
    if (!s.scrive) {
      U.pensa(etichetta(nome));
      const dati = await s.leggi(input ?? {});
      raccogliNomi(dati, nomiSensibili);
      return { dati: dati ?? {} };
    }
    // scrittura: prima la proposta (il riepilogo lo prepara l'host), poi la decisione della persona, poi l'host esegue
    U.riposo(); M.proponendo = true;
    try {
      const p = await s.proponi(input ?? {});
      if (!p || p.errore) return { errore: true, dati: { errore: p?.errore || 'proposal not possible' } };
      raccogliNomi(p, nomiSensibili);
      const scheda = U.proposta({ titolo: p.titolo || t('conferma.titolo'), righe: (p.righe || []).slice(0, 12), nota: p.nota || '' }) || {};
      const decisione = await new Promise(res => { M.attesa = { scheda, risolvi: x => { M.attesa = null; res(x); }, esegui: () => s.esegui(input ?? {}) }; M.proponendo = false; });
      return { dati: decisione, mostrato: true };
    } finally { M.proponendo = false; }
  }
  async function conferma() {
    const a = M.attesa; if (!a || a.inCorso) return; a.inCorso = true;
    U.confermato(a.scheda);
    let esito;
    try { esito = await a.esegui(); } catch (e) { esito = { errore: String(e.message || e) }; }
    if (esito?.errore) { await U.esito({ testo: t('esito.errore', { errore: esito.errore }), no: true }, a.scheda); a.risolvi({ esito: 'errore', errore: esito.errore }); return; }
    await U.esito({ testo: esito?.testo || t('esito.fatto'), nota: esito?.nota || '' }, a.scheda);
    a.risolvi({ esito: 'confermato', risultato: esito ?? {} });
  }
  async function annulla(nota) {
    const a = M.attesa; if (!a || a.inCorso) return; a.inCorso = true;
    await U.esito({ testo: t('esito.annullato'), nota: t('esito.annullatoNota'), no: true }, a.scheda);
    a.risolvi(nota ? { esito: 'non_confermato', nota } : { esito: 'annullato' });
  }

  /* ---------- senza server: un riconoscitore locale (la demo) ---------- */
  async function chiediLocale(testo, { daVoce }) {
    U.domanda(testo, { daVoce });
    if (!M.avvisato) { M.avvisato = true; U.avviso(t('avviso.collega')); }
    M.inCorso = true; const g = M.gen;
    try {
      const r = typeof op.locale === 'function' ? await op.locale(testo, { lingua: t.lingua }) : null;
      if (g !== M.gen) return;
      if (!r) { U.fisso(t('risposta.nonCapito', { esempi: (op.esempi || []).slice(0, 3).map(x => `«${x}»`).join(', ') || '—' })); return; }
      let dati = null;
      if (r.strumento) { const x = await strumento(r.strumento.nome, r.strumento.args || {}); dati = x.dati; if (g !== M.gen) return; }
      const scheda = typeof r.mostra === 'function' ? r.mostra(dati) : r.mostra;
      if (scheda && !controllaSchema(scheda, MOSTRA.schema)) { U.mostra(scheda); await pausa(120); }
      const testoRisposta = typeof r.testo === 'function' ? r.testo(dati) : r.testo;
      if (testoRisposta) {
        const h = U.risposta() || { aggiungi() {}, fine() {} };
        // a pezzi, come lo streaming vero: l'interfaccia è la stessa
        for (const pezzo of String(testoRisposta).match(/\S+\s*/g) || []) { h.aggiungi(pezzo); await pausa(18); if (M.stop) { h.interrotta?.(); return; } }
        await h.fine();
      }
    } finally { if (g === M.gen) { M.inCorso = false; M.finitoIl = Date.now(); U.riposo(); } }
  }

  /* ---------- interrompere e ricominciare ---------- */
  function interrompi() { M.stop = true; M.controller?.abort(); U.zitto(); }
  function ricomincia(avvisa) {
    M.gen++; M.controller?.abort(); M.stop = true; U.zitto();
    M.attesa?.risolvi({ esito: 'annullato' });
    const tieni = new Set(M.allegati.map(a => a.fileId).filter(Boolean));
    const via = M.fileIds.filter(id => !tieni.has(id));
    if (via.length && op.server) chiama({ azione: 'elimina-file', ids: via }).catch(() => {});
    M.fileIds = [...tieni];
    M.storia = []; M.attesa = null; M.inCorso = false; M.proponendo = false; M.serie = Promise.resolve();
    U.ricominciato();
    if (avvisa) U.fisso(t('risposta.ricomincio'));
  }

  /* ---------- file ---------- */
  async function aggiungiFile(lista) {
    lista = [...(lista || [])]; if (!lista.length) return;
    if (!puoChattare()) { U.avviso(t('file.nonDisponibile')); return; }
    const nuovi = lista.slice(0, 6).map(file => ({ file, nome: file.name || 'file', stato: 'carica', icona: /pdf/i.test(file.type) ? 'pdf' : /^image/.test(file.type) ? 'foto' : 'doc' }));
    M.allegati.push(...nuovi); U.allegati(M.allegati);
    await Promise.all(nuovi.map(async a => {
      try {
        const l = await leggiFile(a.file, { lingua: t.lingua }); Object.assign(a, l);
        if (l.modo === 'carica') { const j = await chiamaJson({ azione: 'file', nome: l.nome, tipo: l.tipo, base64: await base64(l.blob) }); a.fileId = j.id; M.fileIds.push(j.id); }
        a.stato = 'pronto'; delete a.file; delete a.blob;
      } catch (e) { a.stato = 'errore'; a.errore = e.message; }
      U.allegati(M.allegati);
    }));
  }
  function togliAllegato(a) { M.allegati = M.allegati.filter(x => x !== a); U.allegati(M.allegati); }
  function eliminaFile() { if (M.fileIds.length && op.server) { chiama({ azione: 'elimina-file', ids: M.fileIds }).catch(() => {}); M.fileIds = []; } }

  return {
    M, strumenti, chiedi, conferma, annulla, interrompi, ricomincia, servizio, aggiungiFile, togliAllegato, eliminaFile,
    gettoneVoce: () => chiamaJson({ azione: 'voce' }),
    pubblico, pubblicoSubito, schermoCondiviso,
    impostaSchermoCondiviso(v) { condiviso = !!v; U.schermo?.(condiviso); },
    puoChattare, strumento,
  };
}

/* ---------- server-sent events: «data: {...}\n\n» ---------- */
export async function* eventiSSE(corpo) {
  const lettore = corpo.getReader(), dec = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      const { value, done } = await lettore.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const riga = buf.slice(0, i); buf = buf.slice(i + 2);
        const dati = riga.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
        if (dati) yield JSON.parse(dati);
      }
    }
  } finally { try { lettore.releaseLock(); } catch (e) { /* già chiuso */ } }
}
const pausa = ms => new Promise(r => setTimeout(r, ms));
