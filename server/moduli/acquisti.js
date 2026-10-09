// Gli acquisti: proposta di riordino sotto scorta, ordini ai fornitori creati dalla proposta, ricevimento della merce anche
// in più volte (carico del magazzino e costo medio ponderato), confronto ordinato / ricevuto / fatturato e abbinamento con la
// fattura del fornitore. Rotte:
//   GET/PUT /api/acquisti/impostazioni      le sezioni usate { ordini, righe, articoli, fornitori } e la scorta obiettivo
//   POST /api/acquisti/prepara { articoli? } adatta «Ordini ai fornitori» del negozio, o la crea, con «ricevuta», «parziale», «fattura»
//   GET  /api/acquisti/riordino              gli articoli sotto scorta, con quanto ordinare, per fornitore
//   POST /api/acquisti/ordini { righe: [{ articolo, quantita, fornitore? }] }   un ordine in bozza per fornitore
//   GET  /api/acquisti/arrivo                gli ordini inviati o arrivati in parte, con quello che manca e i ritardi
//   POST /api/acquisti/ordini/:id/ricevi { righe?: [{ riga, quantita }], data?, ddt? }   senza righe: tutto quello che manca
//   GET  /api/acquisti/ordini/:id/confronto  ordinato, ricevuto, fattura abbinata e fatture candidate
//   POST /api/acquisti/ordini/:id/fattura { fattura }       GET /api/acquisti/fatture   ordini ricevuti ancora senza fattura
// Tutto passa da dati.js con il ctx di chi chiede (permessi di ordini e articoli).
import { cent, euro } from './documenti-calcoli.js';
import { transazione } from '../db.js';

const RICEVUTE = 'fatture_ricevute';
const oggiIso = () => new Date().toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const APERTI = ['inviato', 'parziale'];
const idDi = x => (x && typeof x === 'object' ? x.id : x) ?? null;
const titoloDi = x => (x && typeof x === 'object' ? x.titolo ?? '' : '');
const esiste = (S, db, e) => { const d = S.leggi(db, e); return !!d && !d.archiviata; };
const tutte = (D, db, e, ctx, filtri = []) => { const out = []; for (let p = 1; p < 400; p++) { const r = D.elenca(db, e, { filtri, perPagina: 500, pagina: p }, ctx); out.push(...r.righe); if (r.righe.length < 500) break; } return out; };
const num = x => Number(x) || 0;

// ---------- impostazioni e sezioni ----------
const PREDEFINITE = { ordini: 'ordini', righe: 'righe_ordine', articoli: null, fornitori: 'fornitori', scorta: 2 };
export function impostazioni(db, meta) {
  let s = {}; try { s = JSON.parse(meta.leggi(db, 'acquisti.impostazioni') || '{}'); } catch { s = {}; }
  return { ...PREDEFINITE, ...s };
}
export function salvaImpostazioni(db, meta, corpo = {}) {
  const s = impostazioni(db, meta);
  for (const k of Object.keys(PREDEFINITE)) if (k in corpo) s[k] = corpo[k];
  s.scorta = Number(s.scorta); if (!(s.scorta >= 1 && s.scorta <= 12)) throw new Error('La scorta obiettivo va da 1 a 12 volte la soglia');
  for (const k of ['ordini', 'righe', 'articoli', 'fornitori']) if (s[k] != null && !/^[a-z0-9_]{1,64}$/.test(String(s[k]))) throw new Error(`Sezione non valida: ${k}`);
  meta.scrivi(db, 'acquisti.impostazioni', JSON.stringify(s));
  return s;
}
// la sezione del magazzino: quella scelta, oppure la prima con giacenza e soglia (articoli, ricambi, materiali, ingredienti…)
export function sezioneArticoli(k) {
  const { db, S, meta } = k, imp = impostazioni(db, meta);
  if (imp.articoli && esiste(S, db, imp.articoli)) return imp.articoli;
  const c = S.elenco(db).filter(e => !e.archiviata && e.campi.some(x => x.id === 'giacenza' && !x.archiviato));
  return (c.find(e => e.campi.some(x => x.id === 'soglia')) || c[0])?.id || null;
}
const FORNITORI = { id: 'fornitori', nome: 'Fornitori', icona: 'furgone', titolo: 'nome', campi: [
  { id: 'nome', nome: 'Ragione sociale', tipo: 'testo', obbligatorio: true }, { id: 'email', nome: 'Email', tipo: 'email' }, { id: 'telefono', nome: 'Telefono', tipo: 'telefono' },
  { id: 'piva', nome: 'Partita IVA', tipo: 'testo' }, { id: 'giorni_consegna', nome: 'Giorni di consegna', tipo: 'numero' }] };
const STATI = [{ id: 'bozza', nome: 'Bozza', colore: 'grigio' }, { id: 'inviato', nome: 'Inviato', colore: 'blu' }, { id: 'parziale', nome: 'Arrivato in parte', colore: 'giallo' },
  { id: 'arrivato', nome: 'Arrivato', colore: 'verde' }, { id: 'annullato', nome: 'Annullato', colore: 'rosso' }];
const TRANSIZIONI = { bozza: ['inviato', 'annullato'], inviato: ['parziale', 'arrivato', 'annullato'], parziale: ['arrivato', 'annullato'], arrivato: [], annullato: [] };
// «arrivato» a mano carica solo quello che non è già arrivato con i ricevimenti (ricevuta vuota: tutto)
const RESTO = 'SE(VUOTO(ricevuta); quantita; quantita - ricevuta)';
const automazione = ordini => ({ id: `carico_${ordini}`, nome: 'Ordine arrivato: carica il magazzino', entita: ordini, quando: 'campo_cambia', campo: 'stato', a: 'arrivato',
  azioni: [{ tipo: 'aggiorna_collegato', perOgniRiga: 'righe', relazione: 'articolo', campo: 'giacenza', aggiungi: RESTO }] });

export function prepara(k, { articoli = null, utente = null } = {}) {
  const { db, S, A, meta } = k, fatto = [];
  const art = articoli && esiste(S, db, articoli) ? articoli : sezioneArticoli(k);
  if (!art) throw new Error('Serve una sezione con la giacenza (articoli, ricambi, materiali…)');
  if (!esiste(S, db, 'fornitori')) { S.applica(db, structuredClone(FORNITORI), { utente }); fatto.push('fornitori'); }
  const usabile = id => { const d = S.leggi(db, id); return d && !d.archiviata && d.campi.some(c => c.id === 'fornitore' && c.tipo === 'relazione') && d.campi.some(c => c.id === 'righe' && c.tipo === 'righe'); };
  let ordini = 'ordini', righe = 'righe_ordine';
  if (!usabile('ordini')) {
    if (S.leggi(db, 'ordini')) { ordini = 'ordini_acquisto'; righe = 'righe_acquisto'; }
    if (!usabile(ordini)) {
      // le righe prima dell'ordine: applicaTutte completa le sezioni nell'ordine dato, e l'ordine vuole già la relazione delle righe
      S.applicaTutte(db, [
        { id: righe, nome: 'Righe d\'ordine', nascosta: true, titolo: 'articolo', campi: [
          { id: 'ordine', nome: 'Ordine', tipo: 'relazione', entita: ordini, obbligatorio: true }, { id: 'articolo', nome: 'Articolo', tipo: 'relazione', entita: art, obbligatorio: true },
          { id: 'quantita', nome: 'Quantità', tipo: 'numero', predefinito: 1 }, { id: 'costo', nome: 'Costo', tipo: 'valuta' },
          { id: 'totale', nome: 'Totale', tipo: 'calcolato', formula: 'quantita * costo', formato: 'valuta' }] },
        { id: ordini, nome: 'Ordini ai fornitori', icona: 'furgone', titolo: 'numero', campi: [
          { id: 'numero', nome: 'Numero', tipo: 'contatore', formato: 'OF-{AAAA}-{N:3}' }, { id: 'data', nome: 'Data', tipo: 'data', predefinito: '@oggi' },
          { id: 'fornitore', nome: 'Fornitore', tipo: 'relazione', entita: 'fornitori', obbligatorio: true },
          { id: 'stato', nome: 'Stato', tipo: 'stato', iniziale: 'bozza', opzioni: STATI, transizioni: TRANSIZIONI },
          { id: 'consegna_prevista', nome: 'Consegna prevista', tipo: 'data' }, { id: 'righe', nome: 'Articoli', tipo: 'righe', entita: righe, campo: 'ordine' },
          { id: 'totale', nome: 'Totale', tipo: 'calcolato', formula: 'SOMMA(righe.totale)', formato: 'valuta' }, { id: 'note', nome: 'Note', tipo: 'testo_lungo' }] }
      ], { utente });
      fatto.push(ordini, righe);
    }
  }
  // i campi e gli stati che servono agli acquisti, aggiunti senza toccare il resto
  const aggiungi = (id, campi, ritocca = null) => {
    const { archiviata, ...def } = S.leggi(db, id), mancano = campi.filter(c => !def.campi.some(x => x.id === c.id));
    let cambiato = mancano.length > 0; def.campi = [...def.campi, ...mancano];
    if (ritocca) cambiato = ritocca(def) || cambiato;
    if (cambiato) { S.applica(db, def, { utente }); fatto.push(...mancano.map(c => `${id}.${c.id}`)); }
  };
  aggiungi(righe, [{ id: 'ricevuta', nome: 'Quantità ricevuta', tipo: 'numero' }]);
  aggiungi(ordini, [{ id: 'ddt', nome: 'DDT del fornitore', tipo: 'testo' }, ...(esiste(S, db, RICEVUTE) ? [{ id: 'fattura', nome: 'Fattura del fornitore', tipo: 'relazione', entita: RICEVUTE }] : [])], def => {
    const st = def.campi.find(c => c.id === 'stato' && c.tipo === 'stato'); if (!st) return false;
    let c = false;
    for (const o of STATI) if (!st.opzioni.some(x => x.id === o.id)) { st.opzioni = [...st.opzioni, o]; c = true; }
    const tr = { ...(st.transizioni || {}) };
    for (const [da, a] of Object.entries(TRANSIZIONI)) { const u = [...new Set([...(tr[da] || []), ...a])]; if (u.length !== (tr[da] || []).length) { tr[da] = u; c = true; } }
    st.transizioni = tr; return c;
  });
  // l'automazione «arrivato»: quella del negozio carica tutto; adesso carica solo il resto
  const vecchia = A.elenco(db).find(a => a.entita === ordini && a.quando === 'campo_cambia' && a.campo === 'stato' && a.a === 'arrivato');
  if (!vecchia) { A.salva(db, automazione(ordini), { utente }); fatto.push(`automazione ${ordini}`); }
  else if (vecchia.azioni?.some(x => x.tipo === 'aggiorna_collegato' && x.campo === 'giacenza' && x.aggiungi === 'quantita')) {
    const { attiva, ...def } = vecchia;
    A.salva(db, { ...def, azioni: def.azioni.map(x => (x.tipo === 'aggiorna_collegato' && x.campo === 'giacenza' && x.aggiungi === 'quantita' ? { ...x, aggiungi: RESTO } : x)) }, { utente });
    fatto.push(`automazione ${vecchia.id}`);
  }
  salvaImpostazioni(db, meta, { ordini, righe, articoli: art, fornitori: 'fornitori' });
  return { fatto, ordini, righe, articoli: art };
}
const pronti = k => { const imp = impostazioni(k.db, k.meta); if (!esiste(k.S, k.db, imp.ordini) || !imp.articoli) throw new Error('Gli acquisti non sono ancora pronti: prepara gli acquisti'); return imp; };

// ---------- ordini aperti e in arrivo ----------
function ordiniCon(k, ctx, imp, stati) {
  const { db, D } = k;
  return tutte(D, db, imp.ordini, ctx).filter(o => stati.includes(o.stato)).map(o => D.leggi(db, imp.ordini, o.id, ctx));
}
export function inArrivo(k, ctx, { oggi = oggiIso() } = {}) {
  const imp = pronti(k);
  return ordiniCon(k, ctx, imp, APERTI).map(o => {
    const righe = (o.righe || []).map(r => ({ id: r.id, articolo: { id: idDi(r.articolo), nome: titoloDi(r.articolo) }, quantita: num(r.quantita), ricevuta: num(r.ricevuta), manca: Math.max(0, num(r.quantita) - num(r.ricevuta)), costo: num(r.costo) }));
    return { id: o.id, numero: o.numero, data: o.data, stato: o.stato, fornitore: { id: idDi(o.fornitore), nome: titoloDi(o.fornitore) }, consegna_prevista: o.consegna_prevista || null,
      in_ritardo: !!(o.consegna_prevista && o.consegna_prevista < oggi), righe, manca: righe.reduce((s, r) => s + r.manca, 0) };
  }).sort((a, b) => String(a.consegna_prevista || '9').localeCompare(String(b.consegna_prevista || '9')));
}
// quanto è già ordinato e non ancora arrivato, per articolo (anche le bozze: un ordine in preparazione non si propone due volte)
const inArrivoPerArticolo = (k, ctx) => {
  const m = new Map();
  for (const o of ordiniCon(k, ctx, impostazioni(k.db, k.meta), ['bozza', ...APERTI])) for (const r of o.righe || []) { const id = idDi(r.articolo); if (id) m.set(id, (m.get(id) || 0) + Math.max(0, num(r.quantita) - num(r.ricevuta))); }
  return m;
};

// ---------- proposta di riordino ----------
// sotto scorta = giacenza + in arrivo ≤ soglia; si propone di tornare a «scorta» volte la soglia (predefinito 2)
export function riordino(k, ctx) {
  const { db, S, D } = k, imp = pronti(k), def = S.leggi(db, imp.articoli);
  const haFornitore = def.campi.some(c => c.id === 'fornitore' && c.tipo === 'relazione'), arrivo = inArrivoPerArticolo(k, ctx), titolo = S.campoTitolo(def)?.id;
  const righe = [];
  for (const a of tutte(D, db, imp.articoli, ctx)) {
    const soglia = num(a.soglia), giacenza = num(a.giacenza), arr = arrivo.get(a.id) || 0;
    if (!(soglia > 0) || giacenza + arr > soglia) continue;
    righe.push({ articolo: { id: a.id, nome: String(a[titolo] ?? a.nome ?? a.id) }, codice: a.codice || '', giacenza, soglia, in_arrivo: arr,
      proposta: Math.max(1, Math.ceil(soglia * imp.scorta - giacenza - arr)), costo: num(a.costo), fornitore: haFornitore && idDi(a.fornitore) ? { id: idDi(a.fornitore), nome: titoloDi(a.fornitore) } : null });
  }
  const gruppi = new Map();
  for (const r of righe) { const c = r.fornitore?.id || ''; if (!gruppi.has(c)) gruppi.set(c, { fornitore: r.fornitore, righe: [], totale: 0 }); const g = gruppi.get(c); g.righe.push(r); g.totale = euro(cent(g.totale) + cent(r.costo * r.proposta)); }
  return { articoli: imp.articoli, gruppi: [...gruppi.values()].sort((a, b) => (a.fornitore ? 0 : 1) - (b.fornitore ? 0 : 1) || String(a.fornitore?.nome).localeCompare(String(b.fornitore?.nome))) };
}
export function creaOrdini(k, ctx, righe, { oggi = oggiIso() } = {}) {
  const { db, D } = k, imp = pronti(k);
  if (!Array.isArray(righe) || !righe.length) throw new Error('Nessun articolo da ordinare');
  const perFornitore = new Map();
  for (const r of righe) {
    const a = D.leggi(db, imp.articoli, String(r.articolo), ctx, { conRighe: false }), q = Number(r.quantita);
    if (!(q > 0)) throw new Error(`Quantità non valida per «${a.nome || a.id}»`);
    const f = String(r.fornitore || idDi(a.fornitore) || '');
    if (!f) throw new Error(`Manca il fornitore di «${a.nome || a.id}»`);
    (perFornitore.get(f) || perFornitore.set(f, []).get(f)).push({ articolo: a.id, quantita: q, costo: num(a.costo) });
  }
  return transazione(db, () => [...perFornitore].map(([f, l]) => {
    const fo = D.leggi(db, imp.fornitori, f, ctx, { conRighe: false }), gg = num(fo.giorni_consegna);
    const o = D.crea(db, imp.ordini, { fornitore: f, data: oggi, ...(gg ? { consegna_prevista: new Date(Date.parse(oggi) + gg * 864e5).toISOString().slice(0, 10) } : {}), righe: l }, ctx);
    return { id: o.id, numero: o.numero, fornitore: fo.nome, righe: l.length, totale: euro(l.reduce((s, x) => s + cent(x.costo * x.quantita), 0)) };
  }));
}

// ---------- ricevimento della merce ----------
const pronte = new WeakSet();
const tabella = db => { if (pronte.has(db)) return; pronte.add(db); db.exec('CREATE TABLE IF NOT EXISTS _acquisti_ricevimenti (id INTEGER PRIMARY KEY, ordine TEXT NOT NULL, riga TEXT NOT NULL, articolo TEXT, quantita REAL NOT NULL, costo INTEGER, data TEXT NOT NULL, ddt TEXT, utente TEXT, quando TEXT NOT NULL)'); };
// carica la giacenza di quello che è arrivato e aggiorna il costo dell'articolo al costo medio ponderato:
// (giacenza × costo + arrivato × costo d'acquisto) / (giacenza + arrivato); poi l'ordine passa ad «arrivato in parte» o «arrivato»
export function ricevi(k, ctx, ordine, { righe = null, data = oggiIso(), ddt = '' } = {}) {
  const { db, S, D, P } = k, imp = pronti(k); tabella(db);
  if (!DATA.test(String(data))) throw new Error('Data non valida');
  P.verifica(ctx, imp.ordini, 'modifica'); P.verifica(ctx, imp.articoli, 'modifica');
  const o = D.leggi(db, imp.ordini, String(ordine), ctx);
  if (['arrivato', 'annullato'].includes(o.stato)) throw new Error(`L'ordine ${o.numero} è già ${o.stato}`);
  const perId = new Map((o.righe || []).map(r => [r.id, r]));
  const scelte = righe ? righe.map(x => ({ r: perId.get(String(x.riga)), q: Number(x.quantita) })) : (o.righe || []).map(r => ({ r, q: num(r.quantita) - num(r.ricevuta) }));
  if (scelte.some(x => !x.r)) throw new Error('Riga sconosciuta in questo ordine');
  const vere = scelte.filter(x => x.q !== 0);
  if (!vere.length) throw new Error('Niente da ricevere');
  for (const { r, q } of vere) if (!(q > 0) || q > num(r.quantita) - num(r.ricevuta) + 1e-9) throw new Error(`Quantità non valida per «${titoloDi(r.articolo)}»: ne mancano ${num(r.quantita) - num(r.ricevuta)}`);
  const haCosto = S.leggi(db, imp.articoli).campi.some(c => c.id === 'costo' && c.tipo === 'valuta');
  return transazione(db, () => {
    for (const { r, q } of vere) {
      const id = idDi(r.articolo), a = D.leggi(db, imp.articoli, id, ctx, { conRighe: false }), g = num(a.giacenza), costo = num(r.costo);
      const v = { giacenza: g + q };
      if (haCosto && costo > 0) v.costo = g > 0 && num(a.costo) > 0 ? euro(Math.round((cent(a.costo) * g + cent(costo) * q) / (g + q))) : costo;
      D.modifica(db, imp.articoli, id, v, ctx);
      D.modifica(db, imp.righe, r.id, { ricevuta: num(r.ricevuta) + q }, ctx);
      db.prepare('INSERT INTO _acquisti_ricevimenti (ordine, riga, articolo, quantita, costo, data, ddt, utente, quando) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(o.id, r.id, id, q, cent(costo), data, String(ddt || '').slice(0, 60), ctx?.utente?.id ?? null, new Date().toISOString());
    }
    const dopo = D.leggi(db, imp.ordini, o.id, ctx), completo = (dopo.righe || []).every(r => num(r.ricevuta) >= num(r.quantita));
    const cambi = {}; if (ddt) cambi.ddt = [dopo.ddt, ddt].filter(Boolean).join(', ').slice(0, 200);
    if (o.stato === 'bozza') D.modifica(db, imp.ordini, o.id, { stato: 'inviato' }, ctx);
    D.modifica(db, imp.ordini, o.id, { ...cambi, stato: completo ? 'arrivato' : 'parziale' }, ctx);
    return { stato: completo ? 'arrivato' : 'parziale', ricevute: vere.map(x => ({ riga: x.r.id, articolo: titoloDi(x.r.articolo), quantita: x.q })) };
  });
}
export const ricevimenti = (db, ordine) => { tabella(db); return db.prepare('SELECT riga, articolo, quantita, costo, data, ddt FROM _acquisti_ricevimenti WHERE ordine = ? ORDER BY id').all(String(ordine)).map(x => ({ ...x, costo: euro(x.costo || 0) })); };

// ---------- confronto con la fattura del fornitore ----------
// ordinato e ricevuto valgono quantità × costo delle righe; la fattura si confronta con il suo imponibile (senza IVA).
// Tolleranza: 1 € o l'1% (arrotondamenti, spese di trasporto piccole).
const tolleranza = v => Math.max(100, Math.round(Math.abs(v) * 0.01));
export function confronto(k, ctx, ordine) {
  const { db, S, D } = k, imp = pronti(k);
  const o = D.leggi(db, imp.ordini, String(ordine), ctx), righe = o.righe || [];
  const ordinato = righe.reduce((s, r) => s + cent(num(r.quantita) * num(r.costo)), 0), ricevuto = righe.reduce((s, r) => s + cent(num(r.ricevuta) * num(r.costo)), 0);
  const fornitore = idDi(o.fornitore), legate = new Set();
  let candidate = [], fattura = null;
  if (esiste(S, db, RICEVUTE) && k.P.puo(ctx, RICEVUTE, 'leggi')) {
    for (const x of tutte(D, db, imp.ordini, ctx)) if (idDi(x.fattura) && x.id !== o.id) legate.add(idDi(x.fattura));
    const vista = f => { const imponibile = cent(f.imponibile || f.totale), diff = imponibile - ricevuto;
      return { id: f.id, numero: f.numero || '', data: f.data, imponibile: euro(imponibile), totale: euro(cent(f.totale)), differenza: euro(diff), torna: Math.abs(diff) <= tolleranza(ricevuto) }; };
    if (idDi(o.fattura)) { try { fattura = vista(D.leggi(db, RICEVUTE, idDi(o.fattura), ctx, { conRighe: false })); } catch { fattura = null; } }
    candidate = tutte(D, db, RICEVUTE, ctx).filter(f => idDi(f.fornitore) === fornitore && !legate.has(f.id) && f.id !== idDi(o.fattura) && (!o.data || !f.data || f.data >= o.data))
      .map(vista).sort((a, b) => Math.abs(a.differenza) - Math.abs(b.differenza)).slice(0, 10);
  }
  return { ordine: { id: o.id, numero: o.numero, stato: o.stato, fornitore: titoloDi(o.fornitore), data: o.data },
    ordinato: euro(ordinato), ricevuto: euro(ricevuto), da_ricevere: euro(ordinato - ricevuto), fattura, candidate, ricevimenti: ricevimenti(db, o.id),
    righe: righe.map(r => ({ articolo: titoloDi(r.articolo), quantita: num(r.quantita), ricevuta: num(r.ricevuta), costo: num(r.costo) })) };
}
export function abbinaFattura(k, ctx, ordine, fattura) {
  const { db, D } = k, imp = pronti(k);
  const c = confronto(k, ctx, ordine);
  if (!fattura) { D.modifica(db, imp.ordini, c.ordine.id, { fattura: null }, ctx); return { ok: true }; }
  if (!c.candidate.some(x => x.id === String(fattura)) && c.fattura?.id !== String(fattura)) throw new Error('Questa fattura non è del fornitore dell\'ordine, o è già abbinata a un altro ordine');
  D.modifica(db, imp.ordini, c.ordine.id, { fattura: String(fattura) }, ctx);
  return { ok: true, ...confronto(k, ctx, ordine) };
}
// gli ordini con merce arrivata e senza fattura, con la candidata migliore
export function daFatturare(k, ctx) {
  const imp = pronti(k);
  if (!esiste(k.S, k.db, RICEVUTE)) return [];
  return ordiniCon(k, ctx, imp, ['parziale', 'arrivato']).filter(o => !idDi(o.fattura)).map(o => { const c = confronto(k, ctx, o.id); return { ...c.ordine, ricevuto: c.ricevuto, candidata: c.candidate[0] || null }; });
}

// ---------- Lumi ----------
function strumentiLumi(k) {
  const { P, db, meta } = k;
  const ent = () => impostazioni(db, meta);
  const legge = ctx => P.puo(ctx, ent().ordini, 'leggi');
  const scrive = ctx => P.puo(ctx, ent().ordini, 'crea') || P.puo(ctx, ent().ordini, 'modifica');
  return [
    { nome: 'acquisti_riordino', tipo: 'leggi', permesso: legge, descrizione: 'Gli articoli sotto scorta (giacenza più quanto è già in arrivo ≤ soglia), con la quantità proposta, divisi per fornitore. Per «cosa devo ordinare?».',
      schema: { type: 'object', properties: {} }, esegui: async ({ ctx }) => riordino(k, ctx) },
    { nome: 'acquisti_in_arrivo', tipo: 'leggi', permesso: legge, descrizione: 'Gli ordini ai fornitori inviati o arrivati in parte: cosa manca e quali sono in ritardo.',
      schema: { type: 'object', properties: {} }, esegui: async ({ ctx }) => ({ ordini: inArrivo(k, ctx).slice(0, 40) }) },
    { nome: 'acquisti_crea_ordini', tipo: 'scrivi', permesso: scrive,
      descrizione: 'Crea gli ordini ai fornitori in bozza, uno per fornitore. Senza righe usa tutta la proposta di riordino; con le righe, gli articoli (id) e le quantità indicate.',
      schema: { type: 'object', properties: { righe: { type: 'array', maxItems: 200, items: { type: 'object', required: ['articolo', 'quantita'], properties: { articolo: { type: 'string', maxLength: 64 }, quantita: { type: 'number', minimum: 0.001 }, fornitore: { type: 'string', maxLength: 64 } } } } } },
      anteprima: async ({ ctx, args }) => {
        const righe = args.righe?.length ? args.righe : riordino(k, ctx).gruppi.filter(g => g.fornitore).flatMap(g => g.righe.map(r => ({ articolo: r.articolo.id, quantita: r.proposta, nome: r.articolo.nome, fornitore: g.fornitore.nome })));
        if (!righe.length) return { errore: 'Niente da ordinare: nessun articolo sotto scorta con un fornitore' };
        const senza = riordino(k, ctx).gruppi.find(g => !g.fornitore);
        return { titolo: 'Crea gli ordini ai fornitori', righe: righe.slice(0, 40).map(r => [r.nome || r.articolo, `${r.quantita}${r.fornitore ? ' · ' + r.fornitore : ''}`]),
          avvisi: !args.righe?.length && senza ? [`${senza.righe.length} articoli sotto scorta non hanno un fornitore: restano fuori`] : [] };
      },
      esegui: async ({ ctx, args }) => ({ ordini: creaOrdini(k, ctx, args.righe?.length ? args.righe : riordino(k, ctx).gruppi.filter(g => g.fornitore).flatMap(g => g.righe.map(r => ({ articolo: r.articolo.id, quantita: r.proposta })))) }) },
    { nome: 'acquisti_ricevi', tipo: 'scrivi', permesso: scrive,
      descrizione: 'Registra la merce arrivata per un ordine al fornitore (id o numero): carica il magazzino e aggiorna il costo medio. Senza righe riceve tutto quello che manca.',
      schema: { type: 'object', properties: { ordine: { type: 'string', maxLength: 64 }, numero: { type: 'string', maxLength: 40 }, ddt: { type: 'string', maxLength: 60 }, data: { type: 'string', maxLength: 10 },
        righe: { type: 'array', maxItems: 200, items: { type: 'object', required: ['riga', 'quantita'], properties: { riga: { type: 'string', maxLength: 64 }, quantita: { type: 'number', minimum: 0.001 } } } } } },
      anteprima: async ({ ctx, args }) => {
        const o = inArrivo(k, ctx).find(x => x.id === args.ordine || (args.numero && x.numero === args.numero));
        if (!o) return { errore: 'Non trovo un ordine aperto con questi dati' };
        const q = new Map((args.righe || []).map(r => [r.riga, r.quantita]));
        return { titolo: `Ricevi la merce dell'ordine ${o.numero}`, righe: [['Fornitore', o.fornitore.nome], ...o.righe.filter(r => r.manca && (!args.righe || q.has(r.id))).map(r => [r.articolo.nome, `+${args.righe ? q.get(r.id) : r.manca}`]), ...(args.ddt ? [['DDT', args.ddt]] : [])], avvisi: [] };
      },
      esegui: async ({ ctx, args }) => {
        const o = inArrivo(k, ctx).find(x => x.id === args.ordine || (args.numero && x.numero === args.numero)); if (!o) throw new Error('Non trovo un ordine aperto con questi dati');
        return ricevi(k, ctx, o.id, { righe: args.righe?.length ? args.righe : null, data: DATA.test(args.data || '') ? args.data : oggiIso(), ddt: args.ddt || '' });
      } },
  ];
}

// ---------- rotte ----------
export default function registra(k) {
  const { r, db, P, meta, serve, ErroreHttp } = k;
  const leggibile = e => { if (e?.stato || e instanceof k.D.ErroreDati || e instanceof P.ErrorePermesso) throw e; throw new ErroreHttp(422, e.message); };
  const prova = f => { try { return f(); } catch (e) { leggibile(e); } };
  const lettore = ctx => { serve(ctx); if (!P.puo(ctx, impostazioni(db, meta).ordini, 'leggi') && !P.puoSchema(ctx)) throw new P.ErrorePermesso(); return ctx; };
  const gestore = ctx => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Solo chi può personalizzare prepara gli acquisti'); return ctx; };
  r('GET', '/api/acquisti/impostazioni', ({ ctx }) => {
    lettore(ctx); const imp = impostazioni(db, meta);
    return { ...imp, articoliProposti: imp.articoli || sezioneArticoli(k), pronti: esiste(k.S, db, imp.ordini) && !!imp.articoli && k.S.leggi(db, imp.righe)?.campi.some(c => c.id === 'ricevuta'),
      magazzini: k.S.elenco(db).filter(e => !e.archiviata && e.campi.some(c => c.id === 'giacenza')).map(e => ({ id: e.id, nome: e.nome })), puo: { prepara: P.puoSchema(ctx) }, fatture: esiste(k.S, db, RICEVUTE) };
  });
  r('PUT', '/api/acquisti/impostazioni', ({ ctx, corpo }) => { gestore(ctx); return prova(() => salvaImpostazioni(db, meta, { scorta: corpo.scorta })); });
  r('POST', '/api/acquisti/prepara', ({ ctx, corpo }) => { gestore(ctx); return prova(() => prepara(k, { articoli: corpo.articoli || null, utente: ctx.utente.id })); });
  r('GET', '/api/acquisti/riordino', ({ ctx }) => prova(() => riordino(k, lettore(ctx))));
  r('POST', '/api/acquisti/ordini', ({ ctx, corpo }) => prova(() => creaOrdini(k, lettore(ctx), corpo.righe)));
  r('GET', '/api/acquisti/arrivo', ({ ctx }) => prova(() => inArrivo(k, lettore(ctx))));
  r('POST', '/api/acquisti/ordini/:id/ricevi', ({ ctx, p, corpo }) => prova(() => ricevi(k, lettore(ctx), p.id, { righe: Array.isArray(corpo.righe) ? corpo.righe : null, data: corpo.data || oggiIso(), ddt: corpo.ddt || '' })));
  r('GET', '/api/acquisti/ordini/:id/confronto', ({ ctx, p }) => prova(() => confronto(k, lettore(ctx), p.id)));
  r('POST', '/api/acquisti/ordini/:id/fattura', ({ ctx, p, corpo }) => prova(() => abbinaFattura(k, lettore(ctx), p.id, corpo.fattura || null)));
  r('GET', '/api/acquisti/fatture', ({ ctx }) => prova(() => daFatturare(k, lettore(ctx))));
  for (const s of strumentiLumi(k)) k.lumi?.strumento?.(s);
  k.lumi?.istruzioni?.('Acquisti: per «cosa devo ordinare», ordini ai fornitori, merce arrivata e confronto con la fattura del fornitore usa gli strumenti acquisti_*.');
}
