// La tesoreria: scadenzario di incassi e pagamenti, file per la banca (Ri.Ba. CBI, SDD pain.008, bonifici pain.001),
// estratto conto (CAMT.053, CBI, CSV) con la riconciliazione, solleciti e previsione di cassa. Rotte:
//   GET/PUT /api/tesoreria/impostazioni     codice SIA, BIC, identificativo creditore SEPA, saldo di partenza, sezione movimenti
//   POST /api/tesoreria/prepara             aggiunge «Movimenti di banca», «Previsioni di cassa» e i campi di pagamento ai clienti/fornitori
//   GET  /api/tesoreria/scadenze?verso&tutte              lo scadenzario (attive dalle fatture, passive dalle fatture ricevute)
//   POST /api/tesoreria/pagamenti { chiavi, data, importo? } · DELETE /api/tesoreria/pagamenti/:chiave
//   GET  /api/tesoreria/termini?termini&data&importo       le rate che darebbero quei termini
//   POST /api/tesoreria/distinte { tipo: riba|sdd|sct, chiavi, data? } · GET /api/tesoreria/distinte
//   GET  /api/tesoreria/distinte/:id/file · POST /api/tesoreria/distinte/:id/incassata { data }
//   POST /api/tesoreria/estratto { nome, dati (base64) }    importa l'estratto conto nella sezione dei movimenti
//   GET  /api/tesoreria/banca                              movimenti da abbinare con le proposte
//   POST /api/tesoreria/abbina { movimento, chiavi } · POST /api/tesoreria/ignora { movimento } · DELETE /api/tesoreria/abbinamenti/:movimento
//   GET  /api/tesoreria/solleciti · POST /api/tesoreria/solleciti { cliente, livello, chiavi }
//   GET  /api/tesoreria/previsione?passo=settimana|mese&periodi
// Tutte le letture passano da dati.js con il ctx di chi chiede; le scritture sulle fatture passano dalle sue regole (stato,
// blocco dopo l'emissione: «pagata» delle rate e lo stato restano permessi).
import { createHash } from 'node:crypto';
import * as R from './tesoreria-regole.js';
import * as F from './tesoreria-file.js';
import { cent, euro } from './documenti-calcoli.js';
import { azienda } from './documenti.js';
import { transazione } from '../db.js';

export const FATTURE = 'fatture', RATE = 'rate_fattura', RICEVUTE = 'fatture_ricevute', MOVIMENTI = 'movimenti_banca', PREVISIONI = 'previsioni_cassa';
const VALIDE = ['emessa', 'inviata', 'pagata'];
// non si incassano: le note di credito e le autofatture (integrazioni TD16-TD19, regolarizzazione TD20, splafonamento TD21,
// estrazioni dal deposito IVA TD22-TD23, autoconsumo TD27, San Marino TD28). TD26 (cessione di beni ammortizzabili) ha un cliente che paga: resta
const SENZA_INCASSO = ['TD04', 'TD16', 'TD17', 'TD18', 'TD19', 'TD20', 'TD21', 'TD22', 'TD23', 'TD27', 'TD28'];
export const oggiIso = () => new Date().toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// ---------- le sezioni che la tesoreria aggiunge ----------
// La sezione dei movimenti è «semplice»: la riempiono l'import dell'estratto conto e i connettori dell'open banking.
// Le colonne che servono alla riconciliazione: data, importo (+ entrata, − uscita), descrizione; facoltative controparte, iban,
// riferimento, id_esterno (per non importare due volte). Lo stato dell'abbinamento lo tiene la tesoreria (_tesoreria_abbinamenti)
// e, se ci sono, lo ricopia nei campi «stato» e «abbinato» della sezione.
export const SEZIONE_MOVIMENTI = { id: MOVIMENTI, nome: 'Movimenti di banca', icona: 'cassa', titolo: 'descrizione', campi: [
  { id: 'data', nome: 'Data', tipo: 'data', obbligatorio: true },
  { id: 'valuta_il', nome: 'Data valuta', tipo: 'data' },
  { id: 'importo', nome: 'Importo', tipo: 'valuta', obbligatorio: true },
  { id: 'descrizione', nome: 'Descrizione', tipo: 'testo' },
  { id: 'controparte', nome: 'Controparte', tipo: 'testo' },
  { id: 'iban', nome: 'IBAN controparte', tipo: 'testo' },
  { id: 'riferimento', nome: 'Riferimento (CRO/TRN)', tipo: 'testo' },
  { id: 'conto', nome: 'Conto', tipo: 'testo' },
  { id: 'fonte', nome: 'Da dove arriva', tipo: 'scelta', opzioni: [{ id: 'camt053', nome: 'CAMT.053' }, { id: 'cbi', nome: 'CBI' }, { id: 'csv', nome: 'CSV / Excel' }, { id: 'openbanking', nome: 'Open banking' }, { id: 'manuale', nome: 'A mano' }] },
  { id: 'id_esterno', nome: 'Id della banca', tipo: 'testo' },
  { id: 'stato', nome: 'Stato', tipo: 'stato', iniziale: 'da_abbinare', opzioni: [{ id: 'da_abbinare', nome: 'Da abbinare', colore: 'giallo' }, { id: 'abbinato', nome: 'Abbinato', colore: 'verde' }, { id: 'ignorato', nome: 'Ignorato', colore: 'grigio' }],
    transizioni: { da_abbinare: ['abbinato', 'ignorato'], abbinato: ['da_abbinare'], ignorato: ['da_abbinare'] } },
  { id: 'abbinato', nome: 'Abbinato a', tipo: 'testo' },
  { id: 'note', nome: 'Note', tipo: 'testo_lungo' }] };
export const SEZIONE_PREVISIONI = { id: PREVISIONI, nome: 'Previsioni di cassa', icona: 'calendario', titolo: 'descrizione', campi: [
  { id: 'descrizione', nome: 'Descrizione', tipo: 'testo', obbligatorio: true },
  { id: 'tipo', nome: 'Tipo', tipo: 'scelta', predefinito: 'uscita', opzioni: [{ id: 'entrata', nome: 'Entrata', colore: 'verde' }, { id: 'uscita', nome: 'Uscita', colore: 'rosso' }] },
  { id: 'importo', nome: 'Importo', tipo: 'valuta', obbligatorio: true },
  { id: 'data', nome: 'Data', tipo: 'data', obbligatorio: true },
  { id: 'ripeti', nome: 'Si ripete', tipo: 'scelta', predefinito: 'no', opzioni: ['no', 'mensile', 'bimestrale', 'trimestrale', 'semestrale', 'annuale'].map(id => ({ id, nome: id[0].toUpperCase() + id.slice(1) })) },
  { id: 'fino_al', nome: 'Fino al', tipo: 'data' },
  { id: 'note', nome: 'Note', tipo: 'testo_lungo' }] };
const CAMPI_CLIENTI = [
  { id: 'termini_pagamento', nome: 'Termini di pagamento', tipo: 'testo' },
  { id: 'iban', nome: 'IBAN (banca d\'appoggio)', tipo: 'testo', valida: 'iban' },
  { id: 'mandato_sdd', nome: 'Mandato SDD (codice)', tipo: 'testo' },
  { id: 'data_mandato', nome: 'Mandato SDD firmato il', tipo: 'data' }];
const CAMPI_FORNITORI = [{ id: 'termini_pagamento', nome: 'Termini di pagamento', tipo: 'testo' }, { id: 'iban', nome: 'IBAN', tipo: 'testo', valida: 'iban' }];

export function prepara(k, { utente = null } = {}) {
  const { db, S } = k, fatto = [];
  for (const s of [SEZIONE_MOVIMENTI, SEZIONE_PREVISIONI]) if (!S.leggi(db, s.id) || S.leggi(db, s.id).archiviata) { S.applica(db, structuredClone(s), { utente }); fatto.push(s.id); }
  for (const [e, campi] of [['clienti', CAMPI_CLIENTI], ['fornitori', CAMPI_FORNITORI]]) {
    const v = S.leggi(db, e); if (!v || v.archiviata) continue;
    const { archiviata, ...def } = v, mancano = campi.filter(c => !def.campi.some(x => x.id === c.id));
    if (mancano.length) { S.applica(db, { ...def, campi: [...def.campi, ...structuredClone(mancano)] }, { utente }); fatto.push(...mancano.map(c => `${e}.${c.id}`)); }
  }
  return { fatto };
}

// ---------- tabelle e impostazioni ----------
const pronte = new WeakSet();
function tabelle(db) {
  if (pronte.has(db)) return; pronte.add(db);
  db.exec(`CREATE TABLE IF NOT EXISTS _tesoreria_pagamenti (id INTEGER PRIMARY KEY, chiave TEXT NOT NULL, data TEXT NOT NULL, importo INTEGER NOT NULL, movimento TEXT, distinta TEXT, utente TEXT, quando TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS _tesoreria_pagamenti_chiave ON _tesoreria_pagamenti(chiave);
    CREATE TABLE IF NOT EXISTS _tesoreria_distinte (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, nome TEXT NOT NULL, creata TEXT NOT NULL, chiavi TEXT NOT NULL, totale INTEGER NOT NULL, file TEXT NOT NULL, utente TEXT, incassata TEXT);
    CREATE TABLE IF NOT EXISTS _tesoreria_abbinamenti (movimento TEXT PRIMARY KEY, sezione TEXT NOT NULL, chiavi TEXT NOT NULL, ignorato INTEGER NOT NULL DEFAULT 0, quando TEXT NOT NULL, utente TEXT);
    CREATE TABLE IF NOT EXISTS _tesoreria_solleciti (id INTEGER PRIMARY KEY, cliente TEXT NOT NULL, data TEXT NOT NULL, livello INTEGER NOT NULL, chiavi TEXT NOT NULL, importo INTEGER NOT NULL, utente TEXT);`);
}
const PREDEFINITE = { sia: '', bic: '', idCreditore: '', saldo: null, saldoData: null, sezioneMovimenti: MOVIMENTI, ritardoClienti: true, sequenzaSdd: 'RCUR' };
export function impostazioni(db, meta) {
  let s = {}; try { s = JSON.parse(meta.leggi(db, 'tesoreria.impostazioni') || '{}'); } catch { s = {}; }
  const out = { ...PREDEFINITE, ...s }, az = azienda(db, meta);
  out.idCreditoreProposto = F.idCreditore(az.codice_fiscale || az.piva);
  return out;
}
export function salvaImpostazioni(db, meta, corpo = {}) {
  let s = {}; try { s = JSON.parse(meta.leggi(db, 'tesoreria.impostazioni') || '{}'); } catch { s = {}; }
  s = { ...PREDEFINITE, ...s };
  const sbagliata = c => { throw new Error(`Impostazione della tesoreria non valida: ${c}`); };
  for (const c of Object.keys(PREDEFINITE)) if (c in corpo) s[c] = corpo[c];
  s.sia = String(s.sia || '').trim().toUpperCase(); if (s.sia && !/^[A-Z0-9]{5}$/.test(s.sia)) sbagliata('sia');
  s.bic = String(s.bic || '').replace(/\s/g, '').toUpperCase(); if (s.bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s.bic)) sbagliata('bic');
  s.idCreditore = String(s.idCreditore || '').replace(/\s/g, '').toUpperCase(); if (s.idCreditore && !F.idCreditoreValido(s.idCreditore)) sbagliata('idCreditore');
  if (s.saldo != null && s.saldo !== '') { s.saldo = Math.round(Number(String(s.saldo).replace(',', '.')) * 100) / 100; if (!Number.isFinite(s.saldo)) sbagliata('saldo'); } else s.saldo = null;
  if (s.saldoData && !DATA.test(s.saldoData)) sbagliata('saldoData');
  if (!/^[a-z0-9_]{1,64}$/.test(String(s.sezioneMovimenti || ''))) sbagliata('sezioneMovimenti');
  if (!['RCUR', 'FRST', 'OOFF'].includes(s.sequenzaSdd)) sbagliata('sequenzaSdd');
  s.ritardoClienti = !!s.ritardoClienti;
  meta.scrivi(db, 'tesoreria.impostazioni', JSON.stringify(s));
  return impostazioni(db, meta);
}

// ---------- i dati, con i permessi di chi chiede ----------
const esiste = (S, db, e) => { const d = S.leggi(db, e); return !!d && !d.archiviata; };
export function tutte(D, db, e, ctx, ordina = []) {
  const out = [];
  for (let pagina = 1; pagina < 400; pagina++) { const r = D.elenca(db, e, { perPagina: 500, pagina, ordina }, ctx); out.push(...r.righe); if (r.righe.length < 500) break; }
  return out;
}
const idDi = x => (x && typeof x === 'object' ? x.id : x) ?? null;
const titoloDi = x => (x && typeof x === 'object' ? x.titolo ?? '' : '');
const mappa = (k, ctx, e) => (esiste(k.S, k.db, e) && k.P.puo(ctx, e, 'leggi') ? new Map(tutte(k.D, k.db, e, ctx).map(r => [r.id, r])) : new Map());
const nomeDoc = (f, tipo) => `${tipo === 'passiva' ? 'Fattura' : f.tipo === 'TD06' ? 'Parcella' : 'Fattura'} ${f.numero || '—'}${f.data ? ` del ${f.data.split('-').reverse().join('/')}` : ''}`;

// Lo scadenzario. Ogni scadenza ha una chiave stabile:
//   «r:<id>» una rata vera (sezione rate_fattura), «f:<id>:<n>» una rata di una fattura senza rate (dalla scadenza, dai termini
//   del cliente o a vista), «p:<id>:<n>» una fattura ricevuta. Pagato = pagamenti registrati qui, oppure rata «pagata», oppure
//   documento «pagata» (segnato a mano o da un'automazione).
export function scadenzario(k, ctx, { oggi = oggiIso() } = {}) {
  const { db, S, D, P } = k; tabelle(db);
  const pagamenti = new Map();
  for (const p of db.prepare('SELECT chiave, data, importo, distinta FROM _tesoreria_pagamenti ORDER BY data').all()) {
    const x = pagamenti.get(p.chiave) || { importo: 0, data: null }; x.importo += p.importo; x.data = p.data; pagamenti.set(p.chiave, x);
  }
  const inDistinta = new Map();
  for (const d of db.prepare('SELECT id, nome, chiavi, incassata FROM _tesoreria_distinte').all()) for (const c of JSON.parse(d.chiavi)) inDistinta.set(c, { id: d.id, nome: d.nome, incassata: d.incassata });
  const out = [];
  const aggiungi = (s, docPagato, docPagatoIl) => {
    const p = pagamenti.get(s.chiave), pagato = docPagato || s.rataPagata ? s.importo : Math.min(s.importo, p?.importo || 0);
    const residuo = s.importo - pagato, scaduta = residuo > 0 && s.data < oggi;
    const { rataPagata, ...resto } = s;
    out.push({ ...resto, pagato, residuo, stato: residuo <= 0 ? 'pagata' : pagato > 0 ? 'parziale' : 'aperta', scaduta, ritardo: scaduta ? R.giorni(s.data, oggi) : 0,
      pagata_il: residuo <= 0 ? p?.data || docPagatoIl || null : null, distinta: inDistinta.get(s.chiave) || null });
  };
  // attive: le fatture emesse (non le note di credito né le autofatture, che non si incassano)
  if (esiste(S, db, FATTURE) && P.puo(ctx, FATTURE, 'leggi')) {
    const clienti = mappa(k, ctx, 'clienti'), rate = new Map();
    if (esiste(S, db, RATE) && P.puo(ctx, RATE, 'leggi')) for (const r of tutte(D, db, RATE, ctx, [{ campo: 'data', dir: 'asc' }])) { const f = idDi(r.fattura); if (f) (rate.get(f) || rate.set(f, []).get(f)).push(r); }
    for (const f of tutte(D, db, FATTURE, ctx, [{ campo: 'data', dir: 'asc' }])) {
      if (!VALIDE.includes(f.stato) || SENZA_INCASSO.includes(f.tipo)) continue;
      const cl = clienti.get(idDi(f.cliente)) || {}, tot = cent(f.netto ?? f.totale);
      if (tot <= 0) continue;
      const base = { verso: 'attiva', origine: { entita: FATTURE, id: f.id }, numero: f.numero || '', dataDoc: f.data, controparte: titoloDi(f.cliente) || cl.nome || '',
        controparteId: idDi(f.cliente), iban: cl.iban || '', modalita: f.modalita || '' };
      const proprie = rate.get(f.id) || [];
      let righe;
      if (proprie.length) righe = proprie.map((r, i) => ({ chiave: `r:${r.id}`, rata: r.id, n: i + 1, di: proprie.length, data: r.data || f.scadenza || f.data, importo: cent(r.importo), rataPagata: !!r.pagata }));
      else if (f.scadenza) righe = [{ chiave: `f:${f.id}:1`, n: 1, di: 1, data: f.scadenza, importo: tot }];
      else {
        const t = R.leggiTermini(cl.termini_pagamento) || R.leggiTermini('RD');
        righe = R.rate(f.data || oggi, tot, t).map((r, _, l) => ({ chiave: `f:${f.id}:${r.n}`, n: r.n, di: l.length, data: r.data, importo: r.importo, termini: t.testo }));
      }
      for (const r of righe) aggiungi({ ...base, ...r, descrizione: nomeDoc(f, 'attiva') + (r.di > 1 ? ` (rata ${r.n}/${r.di})` : '') }, f.stato === 'pagata', f.pagata_il);
    }
  }
  // passive: le fatture ricevute
  if (esiste(S, db, RICEVUTE) && P.puo(ctx, RICEVUTE, 'leggi')) {
    const fornitori = mappa(k, ctx, 'fornitori');
    for (const f of tutte(D, db, RICEVUTE, ctx, [{ campo: 'data', dir: 'asc' }])) {
      if (f.tipo === 'TD04') continue;
      const fo = fornitori.get(idDi(f.fornitore)) || {}, tot = cent(f.netto || f.totale);
      if (tot <= 0) continue;
      const base = { verso: 'passiva', origine: { entita: RICEVUTE, id: f.id }, numero: f.numero || '', dataDoc: f.data, controparte: titoloDi(f.fornitore) || fo.nome || String(f.fornitore || ''),
        controparteId: idDi(f.fornitore), iban: f.iban || fo.iban || '', modalita: f.modalita || '' };
      const righe = f.scadenza ? [{ chiave: `p:${f.id}:1`, n: 1, di: 1, data: f.scadenza, importo: tot }]
        : R.rate(f.data || oggi, tot, R.leggiTermini(fo.termini_pagamento) || R.leggiTermini('RD')).map((r, _, l) => ({ chiave: `p:${f.id}:${r.n}`, n: r.n, di: l.length, data: r.data, importo: r.importo }));
      for (const r of righe) aggiungi({ ...base, ...r, descrizione: nomeDoc(f, 'passiva') + (r.di > 1 ? ` (rata ${r.n}/${r.di})` : '') }, f.stato === 'pagata', f.pagata_il);
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.chiave.localeCompare(b.chiave));
}
export function riepilogo(l) {
  const somma = f => l.filter(f).reduce((s, x) => s + x.residuo, 0);
  return { daIncassare: somma(x => x.verso === 'attiva'), scadutoClienti: somma(x => x.verso === 'attiva' && x.scaduta),
    daPagare: somma(x => x.verso === 'passiva'), scadutoFornitori: somma(x => x.verso === 'passiva' && x.scaduta) };
}

// ---------- pagamenti ----------
// registra incassi o pagamenti; quando un documento è saldato del tutto lo segna «pagata» (con la data dell'ultimo pagamento)
export function registraPagamenti(k, ctx, chiavi, { data = oggiIso(), importo = null, movimento = null, distinta = null } = {}) {
  const { db, D } = k; tabelle(db);
  if (!DATA.test(String(data))) throw new Error('Data non valida');
  const tutteSc = scadenzario(k, ctx), perChiave = new Map(tutteSc.map(s => [s.chiave, s]));
  const scelte = [...new Set(chiavi)].map(c => { const s = perChiave.get(c); if (!s) throw new Error(`Scadenza sconosciuta: ${c}`); return s; });
  if (!scelte.length) throw new Error('Nessuna scadenza scelta');
  if (importo != null && scelte.length > 1) throw new Error('Un importo parziale vale per una scadenza sola');
  // anche un acconto (che non tocca il documento) vuole il permesso di modificare la fattura: chi la vede soltanto non incassa
  for (const e of new Set(scelte.map(s => s.origine.entita))) k.P.verifica(ctx, e, 'modifica');
  return transazione(db, () => {
    const fatte = [];
    for (const s of scelte) {
      if (s.residuo <= 0) continue;
      const quanto = importo != null ? Math.min(Math.round(Number(importo) * 100), s.residuo) : s.residuo;
      if (!(quanto > 0)) throw new Error('Importo non valido');
      db.prepare('INSERT INTO _tesoreria_pagamenti (chiave, data, importo, movimento, distinta, utente, quando) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(s.chiave, data, quanto, movimento, distinta, ctx?.utente?.id ?? null, new Date().toISOString());
      if (s.rata && quanto === s.residuo) D.modifica(db, RATE, s.rata, { pagata: true }, ctx);
      fatte.push({ chiave: s.chiave, importo: euro(quanto) });
    }
    // i documenti saldati del tutto
    const dopo = scadenzario(k, ctx), docs = new Set(scelte.map(s => `${s.origine.entita}:${s.origine.id}`));
    for (const d of docs) {
      const [entita, id] = d.split(':'), sue = dopo.filter(s => s.origine.entita === entita && s.origine.id === id);
      if (!sue.length || sue.some(s => s.residuo > 0)) continue;
      const riga = D.leggi(db, entita, id, ctx, { conRighe: false });
      if (riga.stato !== 'pagata') D.modifica(db, entita, id, { stato: 'pagata', pagata_il: data }, ctx);
    }
    return { fatte };
  });
}
// annulla i pagamenti registrati su una scadenza (un errore, un insoluto) e riapre il documento
// (con «movimento»: solo i pagamenti di quel movimento, per il disabbina; il documento si riapre lo stesso)
export function annullaPagamento(k, ctx, chiave, { movimento = null } = {}) {
  const { db, D } = k; tabelle(db);
  const s = scadenzario(k, ctx).find(x => x.chiave === chiave);
  if (!s) throw new Error(`Scadenza sconosciuta: ${chiave}`);
  k.P.verifica(ctx, s.origine.entita, 'modifica');
  return transazione(db, () => {
    const filtro = movimento == null ? '' : ' AND movimento = ?', par = movimento == null ? [chiave] : [chiave, String(movimento)];
    const toccati = db.prepare(`SELECT DISTINCT movimento, distinta FROM _tesoreria_pagamenti WHERE chiave = ?${filtro}`).all(...par);
    db.prepare(`DELETE FROM _tesoreria_pagamenti WHERE chiave = ?${filtro}`).run(...par);
    // una distinta senza più incassi torna da incassare (altrimenti la stessa ricevuta si ripresenta in una distinta nuova)
    for (const d of new Set(toccati.map(x => x.distinta).filter(Boolean))) if (!db.prepare('SELECT 1 FROM _tesoreria_pagamenti WHERE distinta = ?').get(d)) db.prepare('UPDATE _tesoreria_distinte SET incassata = NULL WHERE id = ?').run(d);
    // un movimento della banca senza più pagamenti dietro torna da abbinare (il disabbina lo fa da sé)
    if (movimento == null) for (const mv of new Set(toccati.map(x => x.movimento).filter(Boolean))) {
      const a = db.prepare('SELECT sezione FROM _tesoreria_abbinamenti WHERE movimento = ?').get(mv);
      if (a && !db.prepare('SELECT 1 FROM _tesoreria_pagamenti WHERE movimento = ?').get(mv)) { db.prepare('DELETE FROM _tesoreria_abbinamenti WHERE movimento = ?').run(mv); ricopia(k, ctx, a.sezione, mv, 'da_abbinare', []); }
    }
    if (s.rata) D.modifica(db, RATE, s.rata, { pagata: false }, ctx);
    const riga = D.leggi(db, s.origine.entita, s.origine.id, ctx, { conRighe: false });
    if (riga.stato === 'pagata') D.modifica(db, s.origine.entita, s.origine.id, s.verso === 'attiva' ? { stato: riga.inviata_il ? 'inviata' : 'emessa', pagata_il: null } : { stato: 'da_pagare', pagata_il: null }, ctx);
    return { ok: true };
  });
}

// ---------- distinte per la banca ----------
function anagrafica(k, ctx, entita, id) {
  if (!id) return {};
  try { return k.D.leggi(k.db, entita, id, ctx, { conRighe: false }); } catch { return {}; }
}
// l'incasso SDD Core: il file arriva in banca almeno un giorno lavorativo prima, quindi mai oggi o prima, e mai in un
// giorno di chiusura di TARGET2 (sabato, domenica, 1/1, 1/5, 25 e 26/12; Venerdì santo e Lunedì dell'Angelo li sposta la banca)
const chiusoTarget = d => { const g = new Date(d + 'T00:00:00Z').getUTCDay(); return g === 0 || g === 6 || ['01-01', '05-01', '12-25', '12-26'].includes(d.slice(5)); };
export function primoIncasso(d, oggi) { let x = d > oggi ? d : R.piuGiorni(oggi, 1); while (chiusoTarget(x)) x = R.piuGiorni(x, 1); return x; }
export function creaDistinta(k, ctx, { tipo, chiavi, data = null, adesso = new Date() }) {
  const { db, meta } = k; tabelle(db);
  if (!['riba', 'sdd', 'sct'].includes(tipo)) throw new Error('Tipo di distinta sconosciuto');
  const imp = impostazioni(db, meta), az0 = azienda(db, meta), perChiave = new Map(scadenzario(k, ctx).map(s => [s.chiave, s]));
  const az = { ...az0, iban: az0.iban || '', bic: imp.bic, idCreditore: imp.idCreditore || imp.idCreditoreProposto };
  const verso = tipo === 'sct' ? 'passiva' : 'attiva', scelte = [];
  for (const c of [...new Set(chiavi)]) {
    const s = perChiave.get(c);
    if (!s || s.verso !== verso) throw new Error(`Scadenza non adatta a questa distinta: ${c}`);
    if (s.residuo <= 0) throw new Error(`«${s.descrizione}» è già pagata`);
    if (s.distinta && !s.distinta.incassata) throw new Error(`«${s.descrizione}» è già nella distinta ${s.distinta.nome}`);
    scelte.push(s);
  }
  if (!scelte.length) throw new Error('Scegli almeno una scadenza');
  k.P.verifica(ctx, verso === 'attiva' ? FATTURE : RICEVUTE, 'modifica');
  const quando = data && DATA.test(data) ? data : null, oggi = adesso.toISOString().slice(0, 10);
  let f;
  if (tipo === 'riba') {
    const ricevute = scelte.map(s => {
      const c = anagrafica(k, ctx, 'clienti', s.controparteId);
      return { importo: s.residuo, scadenza: s.data < oggi ? oggi : s.data, fattura: { numero: s.numero, data: s.dataDoc },
        debitore: { nome: c.nome || s.controparte, cf: c.piva || c.codice_fiscale || '', via: c.via || (typeof c.indirizzo === 'string' ? c.indirizzo : c.indirizzo?.via) || '', cap: c.cap || '', comune: c.comune || '', provincia: c.provincia || '', iban: c.iban || '' } };
    });
    f = F.riba({ az, sia: imp.sia, ricevute, supporto: `KUBO${adesso.toISOString().replace(/\D/g, '').slice(2, 14)}${createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 4).toUpperCase()}`, oggi });
  } else if (tipo === 'sdd') {
    f = F.pain008({ az, adesso, sequenza: imp.sequenzaSdd, incassi: scelte.map(s => {
      const c = anagrafica(k, ctx, 'clienti', s.controparteId);
      return { importo: s.residuo, data: primoIncasso(quando || s.data, oggi), debitore: { nome: c.nome || s.controparte, iban: c.iban || '' }, mandato: { id: c.mandato_sdd, data: c.data_mandato },
        e2e: `${s.numero}-${s.n}`.replace(/\//g, '-'), causale: s.descrizione };
    }) });
  } else {
    f = F.pain001({ az, adesso, bonifici: scelte.map(s => {
      const fo = anagrafica(k, ctx, 'fornitori', s.controparteId);
      return { importo: s.residuo, data: quando || (s.data < oggi ? oggi : s.data), beneficiario: { nome: fo.nome || s.controparte, iban: s.iban || fo.iban || '' },
        e2e: `${s.numero}-${s.n}`.replace(/\//g, '-'), causale: `Saldo fattura ${s.numero} del ${String(s.dataDoc || '').split('-').reverse().join('/')}` };
    }) });
  }
  if (f.errori) return { errori: f.errori };
  const id = createHash('sha256').update(`${tipo}${adesso.toISOString()}${Math.random()}`).digest('hex').slice(0, 16);
  const n = db.prepare('SELECT COUNT(*) AS n FROM _tesoreria_distinte WHERE tipo = ?').get(tipo).n + 1;
  const nome = `${{ riba: 'Ri.Ba.', sdd: 'SDD', sct: 'Bonifici' }[tipo]} n. ${n} del ${oggi.split('-').reverse().join('/')}`;
  db.prepare('INSERT INTO _tesoreria_distinte (id, tipo, nome, creata, chiavi, totale, file, utente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, tipo, nome, adesso.toISOString(), JSON.stringify(scelte.map(s => s.chiave)), f.totale, f.testo, ctx?.utente?.id ?? null);
  return { id, nome, tipo, numero: f.numero, totale: euro(f.totale), file: nomeFile(tipo, oggi, n) };
}
const nomeFile = (tipo, oggi, n) => `${{ riba: 'RIBA', sdd: 'SDD', sct: 'BONIFICI' }[tipo]}_${oggi.replace(/-/g, '')}_${n}.${tipo === 'riba' ? 'txt' : 'xml'}`;
export function distinte(db) {
  tabelle(db);
  return db.prepare('SELECT id, tipo, nome, creata, chiavi, totale, incassata FROM _tesoreria_distinte ORDER BY creata DESC').all()
    .map((d, _, l) => ({ ...d, chiavi: JSON.parse(d.chiavi), totale: euro(d.totale), file: nomeFile(d.tipo, d.creata.slice(0, 10), l.filter(x => x.tipo === d.tipo && x.creata <= d.creata).length) }));
}
export function incassaDistinta(k, ctx, id, { data = oggiIso(), movimento = null } = {}) {
  const { db } = k; tabelle(db);
  const d = db.prepare('SELECT * FROM _tesoreria_distinte WHERE id = ?').get(String(id));
  if (!d) throw new Error('Distinta sconosciuta');
  k.P.verifica(ctx, d.tipo === 'sct' ? RICEVUTE : FATTURE, 'modifica');
  if (!DATA.test(String(data))) throw new Error('Data non valida');
  const aperte = new Set(scadenzario(k, ctx).filter(s => s.residuo > 0).map(s => s.chiave)), chiavi = JSON.parse(d.chiavi).filter(c => aperte.has(c));
  return transazione(db, () => {
    const r = chiavi.length ? registraPagamenti(k, ctx, chiavi, { data, movimento, distinta: d.id }) : { fatte: [] };
    db.prepare('UPDATE _tesoreria_distinte SET incassata = ? WHERE id = ?').run(data, d.id);
    return r;
  });
}

// ---------- movimenti di banca e riconciliazione ----------
const sezioneMovimenti = k => impostazioni(k.db, k.meta).sezioneMovimenti || MOVIMENTI;
export function movimenti(k, ctx) {
  const { db, S, D, P } = k, e = sezioneMovimenti(k); tabelle(db);
  if (!esiste(S, db, e) || !P.puo(ctx, e, 'leggi')) return [];
  const stato = new Map(db.prepare('SELECT movimento, chiavi, ignorato FROM _tesoreria_abbinamenti WHERE sezione = ?').all(e).map(x => [x.movimento, x]));
  return tutte(D, db, e, ctx, [{ campo: 'data', dir: 'desc' }]).map(m => {
    const a = stato.get(m.id);
    return { id: m.id, data: m.data, importo: cent(m.importo), descrizione: m.descrizione || '', controparte: m.controparte || '', iban: F.pulisciIban(m.iban), riferimento: m.riferimento || '',
      stato: a ? (a.ignorato ? 'ignorato' : 'abbinato') : 'da_abbinare', chiavi: a ? JSON.parse(a.chiavi) : [] };
  }).filter(m => m.data && m.importo);
}
export function importaEstratto(k, ctx, buf, nome = '') {
  const { db, S, D, P, meta } = k, e = sezioneMovimenti(k); tabelle(db);
  if (!esiste(S, db, e)) throw new Error('Manca la sezione dei movimenti di banca: prepara la tesoreria');
  P.verifica(ctx, e, 'crea');
  const letto = F.leggiEstratto(buf, nome), def = S.leggi(db, e), ha = c => def.campi.some(x => x.id === c && !x.archiviato);
  const visti = new Set(ha('id_esterno') ? db.prepare(`SELECT ${S.colonna('id_esterno')} AS v FROM ${S.tabella(e)} WHERE archiviato = 0`).all().map(x => x.v).filter(Boolean) : []);
  let importati = 0, doppi = 0; const volte = new Map();
  transazione(db, () => {
    for (const m of letto.movimenti) {
      // due movimenti uguali nello stesso file (due caffè da 1,20 lo stesso giorno) sono due: il secondo prende «-2»;
      // reimportando lo stesso file i suffissi si ripetono e i doppi si riconoscono lo stesso
      let idEst = m.id_esterno;
      if (!idEst) { const h = createHash('sha1').update(`${m.data}|${m.importo}|${m.descrizione}|${m.riferimento}`).digest('hex').slice(0, 20), n = (volte.get(h) || 0) + 1; volte.set(h, n); idEst = n > 1 ? `${h}-${n}` : h; }
      if (visti.has(idEst)) { doppi++; continue; }
      visti.add(idEst);
      const v = { data: m.data, importo: euro(m.importo), descrizione: m.descrizione || m.controparte || '—' };
      for (const c of ['valuta_il', 'controparte', 'iban', 'riferimento', 'conto', 'fonte']) if (ha(c) && m[c]) v[c] = m[c];
      if (ha('id_esterno')) v.id_esterno = idEst;
      D.crea(db, e, v, ctx); importati++;
    }
  });
  // il saldo finale dell'estratto (CAMT: CLBD) diventa il saldo di partenza della previsione, se è più recente
  const fine = letto.saldi.filter(s => s.tipo === 'CLBD' && s.data).sort((a, b) => a.data.localeCompare(b.data)).at(-1), imp = impostazioni(db, meta);
  let saldo = null;
  if (fine && (!imp.saldoData || fine.data >= imp.saldoData) && P.puoSchema(ctx)) { salvaImpostazioni(db, meta, { saldo: euro(fine.importo), saldoData: fine.data }); saldo = { importo: euro(fine.importo), data: fine.data }; }
  return { importati, doppi, scartate: letto.scartate || [], saldo, formato: letto.movimenti[0]?.fonte || null };
}
function ricopia(k, ctx, e, id, stato, chiavi) {
  const def = k.S.leggi(k.db, e), ha = c => def?.campi.some(x => x.id === c && !x.archiviato), v = {};
  if (ha('stato')) v.stato = stato;
  if (ha('abbinato')) v.abbinato = chiavi.join(', ');
  if (Object.keys(v).length) { try { k.D.modifica(k.db, e, id, v, ctx); } catch { /* uno stato con altre transizioni: resta com'è */ } }
}
export function banca(k, ctx, { oggi = oggiIso() } = {}) {
  const { db } = k; tabelle(db);
  const sc = scadenzario(k, ctx, { oggi }), mov = movimenti(k, ctx);
  const aperteDistinte = distinte(db).filter(d => d.tipo !== 'sct' && !d.incassata).map(d => ({ id: d.id, nome: d.nome, totale: cent(d.totale), aperte: d.chiavi.filter(c => sc.find(s => s.chiave === c)?.residuo > 0) }))
    .map(d => ({ ...d, totale: d.aperte.reduce((s, c) => s + sc.find(x => x.chiave === c).residuo, 0) }));
  const daAbbinare = mov.filter(m => m.stato === 'da_abbinare').map(m => ({ ...m, importo: euro(m.importo), proposte: R.proposte(m, sc, aperteDistinte).map(p => ({ ...p, importo: euro(p.importo) })) }));
  return { daAbbinare, abbinati: mov.filter(m => m.stato !== 'da_abbinare').slice(0, 50).map(m => ({ ...m, importo: euro(m.importo) })),
    sezione: sezioneMovimenti(k), haSezione: esiste(k.S, db, sezioneMovimenti(k)) };
}
export function abbina(k, ctx, movimento, chiavi, { distinta = null } = {}) {
  const { db } = k, e = sezioneMovimenti(k); tabelle(db);
  const m = movimenti(k, ctx).find(x => x.id === String(movimento));
  if (!m) throw new Error('Movimento sconosciuto');
  if (m.stato !== 'da_abbinare') throw new Error('Il movimento è già abbinato');
  k.P.verifica(ctx, e, 'modifica');
  const sc = scadenzario(k, ctx), scelte = chiavi.map(c => sc.find(s => s.chiave === c)).filter(Boolean);
  if (scelte.length !== chiavi.length || !scelte.length) throw new Error('Scadenza sconosciuta');
  const verso = m.importo > 0 ? 'attiva' : 'passiva';
  if (scelte.some(s => s.verso !== verso)) throw new Error(verso === 'attiva' ? 'Un\'entrata si abbina agli incassi dai clienti' : 'Un\'uscita si abbina ai pagamenti ai fornitori');
  if (distinta) { const d = db.prepare('SELECT chiavi, incassata FROM _tesoreria_distinte WHERE id = ?').get(String(distinta));
    if (!d || d.incassata || chiavi.some(c => !JSON.parse(d.chiavi).includes(c))) throw new Error('La distinta non corrisponde alle scadenze scelte (o è già incassata)'); }
  const residuo = scelte.reduce((s, x) => s + x.residuo, 0), imp = Math.abs(m.importo);
  if (scelte.length > 1 && imp < residuo) throw new Error('Il movimento non basta a pagare tutte le scadenze scelte: abbinane una alla volta');
  return transazione(db, () => {
    const r = registraPagamenti(k, ctx, chiavi, { data: m.data, movimento: m.id, distinta, importo: scelte.length === 1 && imp < residuo ? euro(imp) : null });
    if (distinta) db.prepare('UPDATE _tesoreria_distinte SET incassata = ? WHERE id = ?').run(m.data, distinta);
    db.prepare('INSERT INTO _tesoreria_abbinamenti (movimento, sezione, chiavi, ignorato, quando, utente) VALUES (?, ?, ?, 0, ?, ?)').run(m.id, e, JSON.stringify(chiavi), new Date().toISOString(), ctx?.utente?.id ?? null);
    ricopia(k, ctx, e, m.id, 'abbinato', chiavi);
    return { ...r, differenza: euro(imp - Math.min(imp, residuo)) };
  });
}
export function ignora(k, ctx, movimento) {
  const { db } = k, e = sezioneMovimenti(k); tabelle(db);
  const m = movimenti(k, ctx).find(x => x.id === String(movimento));
  if (!m) throw new Error('Movimento sconosciuto');
  k.P.verifica(ctx, e, 'modifica');
  db.prepare('INSERT OR REPLACE INTO _tesoreria_abbinamenti (movimento, sezione, chiavi, ignorato, quando, utente) VALUES (?, ?, ?, 1, ?, ?)').run(m.id, e, '[]', new Date().toISOString(), ctx?.utente?.id ?? null);
  ricopia(k, ctx, e, m.id, 'ignorato', []);
  return { ok: true };
}
export function disabbina(k, ctx, movimento) {
  const { db } = k; tabelle(db);
  const a = db.prepare('SELECT * FROM _tesoreria_abbinamenti WHERE movimento = ?').get(String(movimento));
  if (!a) throw new Error('Il movimento non è abbinato');
  k.P.verifica(ctx, a.sezione, 'modifica');
  return transazione(db, () => {
    // solo i pagamenti di questo movimento; il documento si riapre (anche se altri pagamenti restano: non è più saldato)
    const chiavi = db.prepare('SELECT DISTINCT chiave FROM _tesoreria_pagamenti WHERE movimento = ?').all(a.movimento).map(x => x.chiave);
    for (const c of chiavi) annullaPagamento(k, ctx, c, { movimento: a.movimento });
    db.prepare('DELETE FROM _tesoreria_abbinamenti WHERE movimento = ?').run(a.movimento);
    ricopia(k, ctx, a.sezione, a.movimento, 'da_abbinare', []);
    return { ok: true };
  });
}

// ---------- solleciti ----------
export function solleciti(k, ctx, { oggi = oggiIso() } = {}) {
  const { db, meta } = k; tabelle(db);
  const az = azienda(db, meta), perCliente = new Map();
  for (const s of scadenzario(k, ctx, { oggi })) if (s.verso === 'attiva' && s.scaduta && s.controparteId) (perCliente.get(s.controparteId) || perCliente.set(s.controparteId, []).get(s.controparteId)).push(s);
  const out = [];
  for (const [cliente, l] of perCliente) {
    const mandati = db.prepare('SELECT data, livello FROM _tesoreria_solleciti WHERE cliente = ? ORDER BY data').all(cliente);
    const ritardo = Math.max(...l.map(s => s.ritardo)), livello = R.livelloSollecito(ritardo, mandati, oggi);
    const c = anagrafica(k, ctx, 'clienti', cliente);
    out.push({ cliente, nome: l[0].controparte, email: c.pec || c.email || '', ritardo, livello, ultimo: mandati.at(-1) || null, totale: euro(l.reduce((s, x) => s + x.residuo, 0)),
      scadenze: l.map(s => ({ chiave: s.chiave, descrizione: s.descrizione, data: s.data, residuo: euro(s.residuo) })),
      testo: livello > 0 ? R.testoSollecito({ livello, cliente: l[0].controparte, azienda: az.ragione_sociale || '', scadenze: l, iban: az.iban || '', oggi }) : '' });
  }
  return out.sort((a, b) => b.ritardo - a.ritardo);
}
export function registraSollecito(k, ctx, { cliente, livello, chiavi = [], oggi = oggiIso() }) {
  const { db } = k; tabelle(db);
  const s = solleciti(k, ctx, { oggi }).find(x => x.cliente === String(cliente));
  if (!s) throw new Error('Questo cliente non ha scadenze scadute');
  k.P.verifica(ctx, FATTURE, 'modifica');
  const lv = Number(livello) || s.livello;
  if (!(lv >= 1 && lv <= 3)) throw new Error('Livello del sollecito non valido');
  db.prepare('INSERT INTO _tesoreria_solleciti (cliente, data, livello, chiavi, importo, utente) VALUES (?, ?, ?, ?, ?, ?)')
    .run(s.cliente, oggi, lv, JSON.stringify(chiavi.length ? chiavi : s.scadenze.map(x => x.chiave)), cent(s.totale), ctx?.utente?.id ?? null);
  return { ok: true, livello: lv };
}

// ---------- previsione di cassa ----------
// saldo di partenza (impostazioni, o il saldo finale dell'ultimo estratto) + movimenti dopo quella data; poi le scadenze aperte
// (gli incassi spostati del ritardo medio di ogni cliente), le previsioni a mano (affitto, stipendi) e le tasse del modulo fisco
export async function previsioneCassa(k, ctx, { passo = 'settimana', periodi = null, oggi = oggiIso() } = {}) {
  const { db, S, D, P, meta } = k; tabelle(db);
  const imp = impostazioni(db, meta), n = Math.min(Math.max(Number(periodi) || (passo === 'mese' ? 6 : 13), 1), passo === 'mese' ? 24 : 52);
  const sc = scadenzario(k, ctx, { oggi }), voci = [];
  let saldo = imp.saldo != null ? Math.round(imp.saldo * 100) : 0;
  if (imp.saldoData) for (const m of movimenti(k, ctx)) if (m.data > imp.saldoData && m.data <= oggi) saldo += m.importo;
  const ritardi = new Map();
  if (imp.ritardoClienti) {
    const perCl = new Map(); for (const s of sc) if (s.verso === 'attiva' && s.residuo <= 0 && s.controparteId) (perCl.get(s.controparteId) || perCl.set(s.controparteId, []).get(s.controparteId)).push(s);
    for (const [c, l] of perCl) ritardi.set(c, R.ritardoMedio(l));
  }
  for (const s of sc) {
    if (s.residuo <= 0) continue;
    const rit = s.verso === 'attiva' ? ritardi.get(s.controparteId) || 0 : 0;
    let quando = rit ? R.piuGiorni(s.data, rit) : s.data; if (quando < oggi) quando = oggi;
    voci.push({ data: quando, importo: s.verso === 'attiva' ? s.residuo : -s.residuo, tipo: s.verso === 'attiva' ? 'incasso' : 'pagamento', descrizione: `${s.descrizione} · ${s.controparte}`, ritardo: rit || undefined, scaduta: s.scaduta || undefined });
  }
  const fine = passo === 'mese' ? R.fineMese(R.piuMesi(oggi, n - 1)) : R.piuGiorni(oggi, n * 7 + 6);
  if (esiste(S, db, PREVISIONI) && P.puo(ctx, PREVISIONI, 'leggi')) for (const p of tutte(D, db, PREVISIONI, ctx)) {
    if (!p.data || !p.importo) continue;
    for (const d of R.ripeti(p.data, p.ripeti, p.fino_al && p.fino_al < fine ? p.fino_al : fine)) if (d >= oggi) voci.push({ data: d, importo: (p.tipo === 'entrata' ? 1 : -1) * cent(p.importo), tipo: 'previsione', descrizione: p.descrizione });
  }
  // le fatture future dei contratti ricorrenti (modulo ricorrenti): l'incasso alla data della fattura, IVA compresa
  try { const ric = await import('./ricorrenti.js'); for (const v of ric.future(k, ctx, { da: oggi, a: fine })) voci.push({ data: v.data, importo: cent(v.importo), tipo: 'contratto', descrizione: v.descrizione }); }
  catch { /* senza contratti ricorrenti niente */ }
  // le tasse: i versamenti F24 del modulo fisco (se c'è e se chi chiede vede le fatture)
  if (P.puo(ctx, FATTURE, 'leggi') && esiste(S, db, FATTURE)) {
    try {
      const fisco = await import('./fisco.js'), anno = Number(oggi.slice(0, 4));
      for (const a of [anno, anno + 1]) for (const v of fisco.versamenti({ ...k }, ctx, a).voci || []) if (v.data >= oggi && v.data <= fine) voci.push({ data: v.data, importo: -cent(v.importo), tipo: 'tasse', descrizione: `F24 ${v.codice || v.causale || ''}`.trim() });
    } catch { /* senza impostazioni fiscali le tasse non entrano */ }
  }
  const p = R.previsione({ saldo, da: oggi, periodi: n, passo, voci });
  const e = c => euro(c);
  return { saldoIniziale: e(p.saldoIniziale), saldoFinale: e(p.saldoFinale), minimo: { saldo: e(p.minimo.saldo), data: p.minimo.data }, scoperto: p.scoperto, senzaSaldo: imp.saldo == null, saldoData: imp.saldoData,
    periodi: p.periodi.map(x => ({ ...x, entrate: e(x.entrate), uscite: e(x.uscite), saldo: e(x.saldo) })),
    voci: voci.filter(v => v.data <= p.periodi.at(-1).a).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 400).map(v => ({ ...v, importo: e(v.importo) })) };
}

// ---------- Lumi ----------
// «12/2026» vuole proprio quella; «12» quella col numero 12 di qualsiasi anno. Più documenti diversi: si chiede la chiave
const chiNumero = (sc, numero, verso) => { const n = String(numero).trim().toLowerCase(), base = n.split('/')[0];
  return sc.filter(s => s.residuo > 0 && (!verso || s.verso === verso) && (n.includes('/') ? String(s.numero).trim().toLowerCase() === n : String(s.numero).split('/')[0].trim().toLowerCase() === base)); };
const piuDocumenti = l => new Set(l.map(s => `${s.origine.entita}:${s.origine.id}`)).size > 1;
function strumentiLumi(k) {
  const { P } = k;
  const legge = ctx => P.puo(ctx, FATTURE, 'leggi') || P.puo(ctx, RICEVUTE, 'leggi');
  const scrive = ctx => P.puo(ctx, FATTURE, 'modifica') || P.puo(ctx, RICEVUTE, 'modifica');
  const breve = s => ({ chiave: s.chiave, verso: s.verso, descrizione: s.descrizione, controparte: s.controparte, scadenza: s.data, residuo: euro(s.residuo), scaduta: s.scaduta, ritardo_giorni: s.ritardo });
  return [
    { nome: 'tesoreria_scadenzario', tipo: 'leggi', permesso: legge,
      descrizione: 'Lo scadenzario: incassi da clienti (attive) e pagamenti a fornitori (passive) ancora aperti, con totali. Per «chi mi deve pagare», «cosa devo pagare questa settimana», «scaduti».',
      schema: { type: 'object', properties: { verso: { type: 'string', enum: ['attiva', 'passiva', 'tutte'] }, entro_giorni: { type: 'integer', minimum: 0, maximum: 3650 }, solo_scadute: { type: 'boolean' }, controparte: { type: 'string', maxLength: 120 } } },
      esegui: async ({ ctx, args }) => {
        const oggi = oggiIso(), fino = args.entro_giorni != null ? R.piuGiorni(oggi, args.entro_giorni) : null, chi = String(args.controparte || '').toLowerCase();
        const l = scadenzario(k, ctx).filter(s => s.residuo > 0 && (!args.verso || args.verso === 'tutte' || s.verso === args.verso) && (!args.solo_scadute || s.scaduta) && (!fino || s.data <= fino) && (!chi || s.controparte.toLowerCase().includes(chi)));
        const t = riepilogo(l);
        return { totali: Object.fromEntries(Object.entries(t).map(([a, b]) => [a, euro(b)])), scadenze: l.slice(0, 60).map(breve), altre: Math.max(0, l.length - 60) };
      } },
    { nome: 'tesoreria_previsione_cassa', tipo: 'leggi', permesso: legge,
      descrizione: 'Previsione di cassa per settimane o mesi: saldo di partenza, entrate e uscite previste (scadenze, ritardo medio dei clienti, previsioni a mano, F24), punto più basso. Per «ce la faccio a pagare…», «quanta cassa avrò a fine mese».',
      schema: { type: 'object', properties: { passo: { type: 'string', enum: ['settimana', 'mese'] }, periodi: { type: 'integer', minimum: 1, maximum: 52 } } },
      esegui: async ({ ctx, args }) => { const p = await previsioneCassa(k, ctx, args); return { ...p, voci: p.voci.slice(0, 40) }; } },
    { nome: 'tesoreria_solleciti', tipo: 'leggi', permesso: ctx => P.puo(ctx, FATTURE, 'leggi'),
      descrizione: 'I clienti da sollecitare: scadenze scadute, giorni di ritardo, livello del sollecito (1 cortese, 2 fermo, 3 diffida) e il testo pronto della lettera.',
      schema: { type: 'object', properties: {} }, esegui: async ({ ctx }) => ({ solleciti: solleciti(k, ctx).slice(0, 30) }) },
    { nome: 'tesoreria_segna_pagata', tipo: 'scrivi', permesso: scrive,
      descrizione: 'Registra un incasso o un pagamento su una scadenza (chiave dallo scadenzario, oppure il numero della fattura). Senza importo salda tutto il residuo; con l\'importo registra un acconto.',
      schema: { type: 'object', properties: { chiave: { type: 'string', maxLength: 80 }, numero_fattura: { type: 'string', maxLength: 40 }, verso: { type: 'string', enum: ['attiva', 'passiva'] }, data: { type: 'string', maxLength: 10 }, importo: { type: 'number', minimum: 0.01 } } },
      anteprima: async ({ ctx, args }) => {
        const sc = scadenzario(k, ctx), l = args.chiave ? sc.filter(s => s.chiave === args.chiave && s.residuo > 0) : chiNumero(sc, args.numero_fattura || '', args.verso);
        if (!l.length) return { errore: 'Non trovo scadenze aperte con questi dati' };
        if (piuDocumenti(l)) return { errore: 'Più fatture aperte con questo numero: indica la chiave dallo scadenzario' };
        if (l.length > 1 && args.importo) return { errore: 'Più rate aperte: indica la chiave di quella da pagare' };
        const tot = args.importo ? Math.round(args.importo * 100) : l.reduce((s, x) => s + x.residuo, 0);
        return { titolo: l[0].verso === 'attiva' ? 'Registra un incasso' : 'Registra un pagamento', righe: [...l.map(s => [s.descrizione, `${s.controparte} · residuo € ${euro(s.residuo).toFixed(2)}`]),
          ['Importo', `€ ${euro(tot).toFixed(2)}`], ['Data', args.data || oggiIso()]], avvisi: args.importo && tot < l[0].residuo ? ['Acconto: la scadenza resta aperta per la differenza'] : [] };
      },
      esegui: async ({ ctx, args }) => {
        const sc = scadenzario(k, ctx), l = args.chiave ? sc.filter(s => s.chiave === args.chiave && s.residuo > 0) : chiNumero(sc, args.numero_fattura || '', args.verso);
        if (!l.length) throw new Error('Non trovo scadenze aperte con questi dati');
        if (piuDocumenti(l)) throw new Error('Più fatture aperte con questo numero: indica la chiave dallo scadenzario');
        return registraPagamenti(k, ctx, l.map(s => s.chiave), { data: DATA.test(args.data || '') ? args.data : oggiIso(), importo: args.importo ?? null });
      } },
    { nome: 'tesoreria_abbina_movimento', tipo: 'scrivi', permesso: scrive,
      descrizione: 'Abbina un movimento della banca (id dalla pagina Banca o dalla proposta) a una o più scadenze: le segna pagate con la data del movimento. Senza chiavi usa la proposta migliore.',
      schema: { type: 'object', required: ['movimento'], properties: { movimento: { type: 'string', maxLength: 64 }, chiavi: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } } } },
      anteprima: async ({ ctx, args }) => {
        const b = banca(k, ctx), m = b.daAbbinare.find(x => x.id === args.movimento);
        if (!m) return { errore: 'Movimento sconosciuto o già abbinato' };
        const chiavi = args.chiavi?.length ? args.chiavi : m.proposte[0]?.chiavi;
        if (!chiavi?.length) return { errore: 'Nessuna proposta per questo movimento: indica le chiavi delle scadenze' };
        const sc = scadenzario(k, ctx);
        return { titolo: 'Abbina il movimento', righe: [['Movimento', `${m.data} · € ${m.importo.toFixed(2)} · ${m.descrizione}`.slice(0, 200)], ...chiavi.map(c => { const s = sc.find(x => x.chiave === c); return [s?.descrizione || c, s ? `€ ${euro(s.residuo).toFixed(2)} · ${s.controparte}` : '?']; })], avvisi: [] };
      },
      esegui: async ({ ctx, args }) => {
        const m = banca(k, ctx).daAbbinare.find(x => x.id === args.movimento); if (!m) throw new Error('Movimento sconosciuto o già abbinato');
        const p = args.chiavi?.length ? { chiavi: args.chiavi } : m.proposte[0]; if (!p) throw new Error('Nessuna proposta');
        return abbina(k, ctx, args.movimento, p.chiavi, { distinta: p.distinta || null });
      } },
    { nome: 'tesoreria_termini', tipo: 'leggi', permesso: legge,
      descrizione: 'Calcola le rate e le date di scadenza da termini di pagamento all\'italiana (RD, 30 DF, 30/60/90 DFFM, 60 DFFM+10) per una data e un importo.',
      schema: { type: 'object', required: ['termini'], properties: { termini: { type: 'string', maxLength: 40 }, data: { type: 'string', maxLength: 10 }, importo: { type: 'number', minimum: 0 } } },
      esegui: async ({ args }) => ({ rate: R.rate(DATA.test(args.data || '') ? args.data : oggiIso(), Math.round((args.importo || 0) * 100), args.termini).map(r => ({ ...r, importo: euro(r.importo) })) }) },
  ];
}

// ---------- rotte ----------
export default function registra(k) {
  const { r, db, P, meta, serve, ErroreHttp } = k;
  const lettore = ctx => { serve(ctx); if (!P.puo(ctx, FATTURE, 'leggi') && !P.puo(ctx, RICEVUTE, 'leggi') && !P.puoSchema(ctx)) throw new P.ErrorePermesso(); return ctx; };
  const gestore = ctx => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Solo chi può personalizzare cambia le impostazioni della tesoreria'); return ctx; };
  const leggibile = e => { if (e?.stato || e instanceof k.D.ErroreDati || e instanceof P.ErrorePermesso) throw e; throw new ErroreHttp(422, e.message); };
  const prova = f => { try { return f(); } catch (e) { leggibile(e); } };
  const chiavi = c => (Array.isArray(c) ? c.map(String).slice(0, 500) : []);
  const scarica = (res, nome, tipo, dati) => res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': Buffer.byteLength(dati), 'Content-Disposition': `attachment; filename="${nome.replace(/[^\w.-]/g, '_')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(dati);

  r('GET', '/api/tesoreria/impostazioni', ({ ctx }) => {
    lettore(ctx); const az = azienda(db, meta);
    return { ...impostazioni(db, meta), azienda: { iban: az.iban || '', ragione_sociale: az.ragione_sociale || '', piva: az.piva || '' },
      sezioni: { movimenti: esiste(k.S, db, impostazioni(db, meta).sezioneMovimenti), previsioni: esiste(k.S, db, PREVISIONI), fatture: esiste(k.S, db, FATTURE), ricevute: esiste(k.S, db, RICEVUTE) },
      termini: R.TERMINI_COMUNI, puo: { impostazioni: P.puoSchema(ctx) } };
  });
  r('PUT', '/api/tesoreria/impostazioni', ({ ctx, corpo }) => { gestore(ctx); return prova(() => salvaImpostazioni(db, meta, corpo)); });
  r('POST', '/api/tesoreria/prepara', ({ ctx }) => { gestore(ctx); return prepara(k, { utente: ctx.utente.id }); });
  r('GET', '/api/tesoreria/scadenze', ({ ctx, q }) => {
    lettore(ctx); const verso = q.get('verso'), tutteLe = q.get('tutte') === '1';
    const l = scadenzario(k, ctx).filter(s => (!verso || s.verso === verso) && (tutteLe || s.residuo > 0));
    return { riepilogo: Object.fromEntries(Object.entries(riepilogo(l)).map(([a, b]) => [a, euro(b)])), scadenze: l.map(s => ({ ...s, importo: euro(s.importo), pagato: euro(s.pagato), residuo: euro(s.residuo) })) };
  });
  r('POST', '/api/tesoreria/pagamenti', ({ ctx, corpo }) => prova(() => registraPagamenti(k, lettore(ctx), chiavi(corpo.chiavi), { data: corpo.data || oggiIso(), importo: corpo.importo ?? null })));
  r('DELETE', '/api/tesoreria/pagamenti/:chiave', ({ ctx, p }) => prova(() => annullaPagamento(k, lettore(ctx), p.chiave)));
  r('GET', '/api/tesoreria/termini', ({ ctx, q }) => { lettore(ctx); return prova(() => R.rate(DATA.test(q.get('data') || '') ? q.get('data') : oggiIso(), Math.round(Number(q.get('importo') || 0) * 100), q.get('termini') || 'RD').map(x => ({ ...x, importo: euro(x.importo) }))); });
  r('POST', '/api/tesoreria/distinte', ({ ctx, corpo }) => {
    const x = prova(() => creaDistinta(k, lettore(ctx), { tipo: corpo.tipo, chiavi: chiavi(corpo.chiavi), data: corpo.data || null }));
    if (x.errori) throw new ErroreHttp(422, 'Mancano dei dati per il file della banca', { errori: x.errori });
    return x;
  });
  r('GET', '/api/tesoreria/distinte', ({ ctx }) => { lettore(ctx); return distinte(db).filter(d => P.puo(ctx, d.tipo === 'sct' ? RICEVUTE : FATTURE, 'leggi')); });
  r('GET', '/api/tesoreria/distinte/:id/file', ({ ctx, p, res }) => {
    lettore(ctx); const d = distinte(db).find(x => x.id === p.id); if (!d) throw new ErroreHttp(404, 'Distinta sconosciuta');
    P.verifica(ctx, d.tipo === 'sct' ? RICEVUTE : FATTURE, 'leggi');
    const f = db.prepare('SELECT file FROM _tesoreria_distinte WHERE id = ?').get(p.id).file;
    return scarica(res, d.file, d.tipo === 'riba' ? 'text/plain; charset=us-ascii' : 'application/xml; charset=utf-8', f);
  });
  r('POST', '/api/tesoreria/distinte/:id/incassata', ({ ctx, p, corpo }) => prova(() => incassaDistinta(k, lettore(ctx), p.id, { data: corpo.data || oggiIso() })));
  r('POST', '/api/tesoreria/estratto', ({ ctx, corpo }) => {
    lettore(ctx); const b = Buffer.from(String(corpo.dati || ''), 'base64');
    if (!b.length) throw new ErroreHttp(400, 'File vuoto');
    return prova(() => importaEstratto(k, ctx, b, String(corpo.nome || '')));
  });
  r('GET', '/api/tesoreria/banca', ({ ctx }) => banca(k, lettore(ctx)));
  r('POST', '/api/tesoreria/abbina', ({ ctx, corpo }) => prova(() => abbina(k, lettore(ctx), String(corpo.movimento || ''), chiavi(corpo.chiavi), { distinta: corpo.distinta || null })));
  r('POST', '/api/tesoreria/ignora', ({ ctx, corpo }) => prova(() => ignora(k, lettore(ctx), String(corpo.movimento || ''))));
  r('DELETE', '/api/tesoreria/abbinamenti/:movimento', ({ ctx, p }) => prova(() => disabbina(k, lettore(ctx), p.movimento)));
  r('GET', '/api/tesoreria/solleciti', ({ ctx }) => solleciti(k, lettore(ctx)));
  r('POST', '/api/tesoreria/solleciti', ({ ctx, corpo }) => prova(() => registraSollecito(k, lettore(ctx), { cliente: String(corpo.cliente || ''), livello: corpo.livello, chiavi: chiavi(corpo.chiavi) })));
  r('GET', '/api/tesoreria/previsione', async ({ ctx, q }) => previsioneCassa(k, lettore(ctx), { passo: q.get('passo') === 'mese' ? 'mese' : 'settimana', periodi: q.get('periodi') }));
  for (const s of strumentiLumi(k)) k.lumi?.strumento?.(s);
  k.lumi?.istruzioni?.('Tesoreria: per scadenze, incassi, pagamenti, solleciti, banca e cassa futura usa gli strumenti tesoreria_*. Prima di segnare pagata una fattura cerca la scadenza con tesoreria_scadenzario.');
}
