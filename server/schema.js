// Lo schema: entità e campi sono dati. Da una definizione si crea o si aggiorna la tabella d_<entità> senza mai perdere
// niente: le colonne hanno l'id stabile del campo (c_<id>), rinominare cambia solo l'etichetta, un campo tolto dalla
// definizione resta «archiviato» (colonna e valori intatti, si ripristina), il cambio di tipo converte e rifiuta se
// qualche valore non si può convertire (a meno di «forza»). Ogni modifica va nel registro.
import { transazione, registra } from './db.js';
import { analizza, nomi, ErroreFormula } from './formule.js';

export class ErroreSchema extends Error {
  constructor(messaggio, dettagli) { super(messaggio); this.dettagli = dettagli; }
}

// sql: tipo della colonna (null = nessuna colonna: calcolato, righe, relazione «molti»)
export const TIPI = {
  testo: { sql: 'TEXT' }, testo_lungo: { sql: 'TEXT' }, email: { sql: 'TEXT' }, telefono: { sql: 'TEXT' }, url: { sql: 'TEXT' },
  codice_a_barre: { sql: 'TEXT' }, indirizzo: { sql: 'TEXT' },
  numero: { sql: 'REAL' }, valuta: { sql: 'INTEGER' }, percentuale: { sql: 'REAL' }, durata: { sql: 'INTEGER' },
  data: { sql: 'TEXT' }, data_ora: { sql: 'TEXT' }, si_no: { sql: 'INTEGER' },
  scelta: { sql: 'TEXT' }, scelta_multipla: { sql: 'TEXT' }, stato: { sql: 'TEXT' },
  relazione: { sql: 'TEXT' }, righe: { sql: null }, file: { sql: 'TEXT' }, immagine: { sql: 'TEXT' },
  calcolato: { sql: null }, contatore: { sql: 'TEXT' }, utente: { sql: 'TEXT' },
};
const ID = /^[a-z][a-z0-9_]{0,39}$/;
const RISERVATI = new Set(['id', 'creato', 'modificato', 'creato_da', 'modificato_da', 'archiviato']);
export const tabella = id => `d_${id}`;
export const colonna = id => `c_${id}`;
export const tabellaMolti = (ent, campo) => `r_${ent}_${campo}`;
export const haColonna = c => !!TIPI[c.tipo]?.sql && !(c.tipo === 'relazione' && c.molti);

export function leggi(db, id) {
  const r = db.prepare('SELECT def, archiviata FROM _entita WHERE id = ?').get(id);
  return r ? { ...JSON.parse(r.def), archiviata: !!r.archiviata } : null;
}
export function elenco(db, { anche_archiviate = false } = {}) {
  return db.prepare(`SELECT def, archiviata FROM _entita ${anche_archiviate ? '' : 'WHERE archiviata = 0'} ORDER BY ordine, id`).all()
    .map(r => ({ ...JSON.parse(r.def), archiviata: !!r.archiviata }));
}
export const campiAttivi = def => def.campi.filter(c => !c.archiviato);
export const campo = (def, id) => def.campi.find(c => c.id === id);
// il campo che dà il nome a una riga (nelle relazioni, nei titoli): quello indicato, o il primo testo
export const campoTitolo = def => campo(def, def.titolo) || campiAttivi(def).find(c => ['testo', 'contatore', 'email'].includes(c.tipo)) || null;

// ---------- validazione ----------
export function valida(db, def, { altre = null } = {}) {
  const err = [];
  const tutte = new Map((altre || elenco(db, { anche_archiviate: true })).map(e => [e.id, e])); tutte.set(def.id, def);
  if (!ID.test(def.id || '')) err.push(`id entità non valido «${def.id}» (minuscole, numeri, _)`);
  if (!def.nome || typeof def.nome !== 'string') err.push('manca il nome');
  if (!Array.isArray(def.campi)) err.push('manca l\'elenco dei campi');
  const visti = new Set();
  for (const c of def.campi || []) {
    const dove = `campo «${c.id}»`;
    if (!ID.test(c.id || '') || RISERVATI.has(c.id)) err.push(`${dove}: id non valido`);
    if (visti.has(c.id)) err.push(`${dove}: id ripetuto`); visti.add(c.id);
    if (!TIPI[c.tipo]) { err.push(`${dove}: tipo sconosciuto «${c.tipo}»`); continue; }
    if (!c.nome) err.push(`${dove}: manca il nome`);
    if (['scelta', 'scelta_multipla', 'stato'].includes(c.tipo)) {
      if (!Array.isArray(c.opzioni) || !c.opzioni.length) err.push(`${dove}: servono le opzioni`);
      else if (c.opzioni.some(o => !o?.id || !o?.nome)) err.push(`${dove}: ogni opzione vuole id e nome`);
      if (c.tipo === 'stato' && c.transizioni) {
        const ids = new Set(c.opzioni.map(o => o.id));
        for (const [da, verso] of Object.entries(c.transizioni)) for (const a of [da, ...verso]) if (!ids.has(a)) err.push(`${dove}: transizione verso uno stato sconosciuto «${a}»`);
      }
    }
    if (c.tipo === 'relazione' && !tutte.has(c.entita)) err.push(`${dove}: entità collegata sconosciuta «${c.entita}»`);
    if (c.tipo === 'righe') {
      const figlia = tutte.get(c.entita);
      if (!figlia) err.push(`${dove}: entità delle righe sconosciuta «${c.entita}»`);
      else { const k = campo(figlia, c.campo); if (!k || k.tipo !== 'relazione' || k.entita !== def.id) err.push(`${dove}: «${c.entita}.${c.campo}» deve essere una relazione verso «${def.id}»`); }
    }
    if (c.tipo === 'contatore' && !c.formato) err.push(`${dove}: manca il formato (es. F-{AAAA}-{N:4})`);
    if (c.tipo === 'calcolato') {
      try {
        for (const n of nomi(analizza(c.formula || ''))) {
          if (n.startsWith('@')) continue;
          const [a, b] = n.split('.'); const k = (def.campi || []).find(x => x.id === a);
          if (!k) { err.push(`${dove}: la formula usa «${n}», che non è un campo`); continue; }
          if (b) {
            const altra = tutte.get(k.entita);
            if (!['righe', 'relazione'].includes(k.tipo) || !altra || !campo(altra, b)) err.push(`${dove}: «${n}» non esiste`);
          }
        }
      } catch (e) { err.push(`${dove}: formula non valida (${e instanceof ErroreFormula ? e.message : e})`); }
    }
  }
  if (def.titolo && !(def.campi || []).some(c => c.id === def.titolo)) err.push(`titolo: campo sconosciuto «${def.titolo}»`);
  return err;
}

// ---------- conversioni per il cambio di tipo ----------
function converti(v, a) {
  if (v == null || v === '') return { ok: true, v: null };
  const s = String(v).trim();
  switch (TIPI[a].sql) {
    case 'REAL': { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? { ok: true, v: n } : { ok: false }; }
    case 'INTEGER': {
      if (a === 'si_no') { const l = s.toLowerCase(); if (['1', 'si', 'sì', 'true', 'vero', 'yes'].includes(l)) return { ok: true, v: 1 }; if (['0', 'no', 'false', 'falso'].includes(l)) return { ok: true, v: 0 }; return { ok: false }; }
      const n = Number(s.replace(',', '.')); if (!Number.isFinite(n)) return { ok: false };
      return { ok: true, v: Math.round(a === 'valuta' ? n * 100 : n) };
    }
    default: return { ok: true, v: s };
  }
}

// ---------- applica una definizione ----------
export function applica(db, nuova, { utente = null, forza = false, ordine = null } = {}) {
  const err = valida(db, nuova); if (err.length) throw new ErroreSchema('Definizione non valida', err);
  return transazione(db, () => {
    const vecchia = leggi(db, nuova.id);
    const def = structuredClone(nuova); delete def.archiviata;
    // i campi spariti restano archiviati (con i loro valori)
    for (const c of vecchia?.campi || []) if (!def.campi.some(x => x.id === c.id)) def.campi.push({ ...c, archiviato: true });
    const T = tabella(def.id);
    db.exec(`CREATE TABLE IF NOT EXISTS ${T} (id TEXT PRIMARY KEY, creato TEXT NOT NULL, modificato TEXT NOT NULL, creato_da TEXT, modificato_da TEXT, archiviato INTEGER NOT NULL DEFAULT 0)`);
    const esistenti = new Set(db.prepare(`PRAGMA table_info(${T})`).all().map(r => r.name));
    const problemi = [];
    for (const c of def.campi) {
      const prima = vecchia?.campi.find(x => x.id === c.id);
      if (haColonna(c) && !esistenti.has(colonna(c.id))) db.exec(`ALTER TABLE ${T} ADD COLUMN ${colonna(c.id)} ${TIPI[c.tipo].sql}`);
      if (c.tipo === 'relazione' && c.molti) db.exec(`CREATE TABLE IF NOT EXISTS ${tabellaMolti(def.id, c.id)} (da TEXT NOT NULL, a TEXT NOT NULL, ordine INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (da, a))`);
      if (c.tipo === 'relazione' && !c.molti) db.exec(`CREATE INDEX IF NOT EXISTS i_${def.id}_${c.id} ON ${T}(${colonna(c.id)})`);
      // cambio di tipo: si convertono i valori (stessa colonna, SQLite tiene qualsiasi tipo)
      if (prima && prima.tipo !== c.tipo && haColonna(prima) && haColonna(c)) {
        const righe = db.prepare(`SELECT id, ${colonna(c.id)} AS v FROM ${T}`).all();
        const nuovi = righe.map(r => ({ id: r.id, da: r.v, ...(prima.tipo === 'valuta' && TIPI[c.tipo].sql !== 'INTEGER' ? converti(r.v == null ? null : r.v / 100, c.tipo) : converti(r.v, c.tipo)) }));
        const ko = nuovi.filter(x => !x.ok);
        if (ko.length && !forza) problemi.push(`campo «${c.id}»: ${ko.length} valori non diventano ${c.tipo} (es. «${ko[0].da}»)`);
        else { const up = db.prepare(`UPDATE ${T} SET ${colonna(c.id)} = ? WHERE id = ?`); for (const x of nuovi) up.run(x.ok ? x.v : null, x.id); }
      }
      // unico: indice parziale sulle righe non archiviate
      const ix = `u_${def.id}_${c.id}`;
      if (haColonna(c) && c.unico && !c.archiviato) {
        try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${ix} ON ${T}(${colonna(c.id)}) WHERE archiviato = 0 AND ${colonna(c.id)} IS NOT NULL`); }
        catch { problemi.push(`campo «${c.id}»: ci sono già valori ripetuti, non può essere unico`); }
      } else db.exec(`DROP INDEX IF EXISTS ${ix}`);
    }
    if (problemi.length) throw new ErroreSchema('La modifica perderebbe dati', problemi);
    const ord = ordine ?? (vecchia ? db.prepare('SELECT ordine FROM _entita WHERE id = ?').get(def.id).ordine : (db.prepare('SELECT MAX(ordine) m FROM _entita').get().m ?? -1) + 1);
    db.prepare('INSERT INTO _entita (id, def, ordine, archiviata) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET def = excluded.def, ordine = excluded.ordine, archiviata = 0')
      .run(def.id, JSON.stringify(def), ord);
    registra(db, { utente, tipo: 'schema', entita: def.id, prima: vecchia, dopo: def });
    return def;
  });
}

export function archiviaEntita(db, id, { utente = null } = {}) {
  const def = leggi(db, id); if (!def) throw new ErroreSchema(`Entità sconosciuta «${id}»`);
  const usata = elenco(db).filter(e => e.id !== id && campiAttivi(e).some(c => ['relazione', 'righe'].includes(c.tipo) && c.entita === id));
  if (usata.length) throw new ErroreSchema('L\'entità è usata da altre', usata.map(e => e.nome));
  db.prepare('UPDATE _entita SET archiviata = 1 WHERE id = ?').run(id);
  registra(db, { utente, tipo: 'schema', entita: id, prima: def, dopo: { archiviata: true } });
}

// più entità insieme (un modello, o una proposta di Lumi): si validano tutte assieme, poi si applicano in ordine
export function applicaTutte(db, defs, opz = {}) {
  return transazione(db, () => {
    const altre = new Map(elenco(db, { anche_archiviate: true }).map(e => [e.id, e]));
    for (const d of defs) altre.set(d.id, d);
    const err = defs.flatMap(d => valida(db, d, { altre: [...altre.values()] }).map(e => `${d.id}: ${e}`));
    if (err.length) throw new ErroreSchema('Definizione non valida', err);
    // prima senza i campi che puntano ad altre (così l'ordine non conta), poi complete
    const rinviati = c => ['relazione', 'righe', 'calcolato'].includes(c.tipo);
    for (const d of defs) if (!leggi(db, d.id)) {
      const campi = d.campi.filter(c => !rinviati(c));
      applica(db, { ...d, campi, titolo: campi.some(c => c.id === d.titolo) ? d.titolo : undefined }, opz);
    }
    return defs.map(d => applica(db, d, opz));
  });
}
