// Il database: un file SQLite (node:sqlite, nessuna dipendenza) in modalità WAL. Le tabelle di sistema iniziano con «_»,
// quelle dei dati con «d_» (una per entità, vedi schema.js), quelle delle relazioni molti-a-molti con «r_».
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MIGRAZIONI = [
  // 1: il motore
  `CREATE TABLE _meta (chiave TEXT PRIMARY KEY, valore TEXT);
   CREATE TABLE _entita (id TEXT PRIMARY KEY, def TEXT NOT NULL, ordine INTEGER NOT NULL DEFAULT 0, archiviata INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE _ruoli (id TEXT PRIMARY KEY, def TEXT NOT NULL);
   CREATE TABLE _utenti (id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, hash TEXT NOT NULL,
     ruolo TEXT NOT NULL, attivo INTEGER NOT NULL DEFAULT 1, pin TEXT, creato TEXT NOT NULL);
   CREATE TABLE _sessioni (token TEXT PRIMARY KEY, utente TEXT NOT NULL REFERENCES _utenti(id) ON DELETE CASCADE, scade TEXT NOT NULL, agente TEXT);
   CREATE TABLE _registro (id INTEGER PRIMARY KEY AUTOINCREMENT, quando TEXT NOT NULL, utente TEXT, tipo TEXT NOT NULL,
     entita TEXT, riga TEXT, prima TEXT, dopo TEXT);
   CREATE INDEX _registro_riga ON _registro(entita, riga);
   CREATE TABLE _numeratori (serie TEXT NOT NULL, anno INTEGER NOT NULL, ultimo INTEGER NOT NULL, PRIMARY KEY (serie, anno));
   CREATE TABLE _viste (id TEXT PRIMARY KEY, entita TEXT NOT NULL, utente TEXT, def TEXT NOT NULL);
   CREATE TABLE _automazioni (id TEXT PRIMARY KEY, def TEXT NOT NULL, attiva INTEGER NOT NULL DEFAULT 1);`,
];

export function apri(percorso = ':memory:') {
  const db = new DatabaseSync(percorso);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const v = db.prepare('PRAGMA user_version').get().user_version;
  // prima di migrare un database che ha già dati: una copia in backup/ (la vede la pagina Backup, server/moduli/desktop.js)
  if (v > 0 && v < MIGRAZIONI.length && percorso !== ':memory:') {
    const d = new Date(), z = n => String(n).padStart(2, '0'), cartella = join(dirname(percorso), 'backup'); mkdirSync(cartella, { recursive: true });
    db.exec(`VACUUM INTO '${join(cartella, `kubo-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}-modifica.db`).replaceAll("'", "''")}'`);
  }
  for (let i = v; i < MIGRAZIONI.length; i++) {
    transazione(db, () => { db.exec(MIGRAZIONI[i]); db.exec(`PRAGMA user_version = ${i + 1}`); });
  }
  return db;
}

// transazione annidabile (SAVEPOINT): se la funzione lancia, si annulla tutto
let livello = 0;
export function transazione(db, f) {
  const nome = `t${livello++}`;
  db.exec(`SAVEPOINT ${nome}`);
  try { const r = f(); db.exec(`RELEASE ${nome}`); return r; }
  catch (e) { db.exec(`ROLLBACK TO ${nome}`); db.exec(`RELEASE ${nome}`); throw e; }
  finally { livello--; }
}

export const meta = {
  leggi: (db, k) => db.prepare('SELECT valore FROM _meta WHERE chiave = ?').get(k)?.valore ?? null,
  scrivi: (db, k, v) => db.prepare('INSERT INTO _meta (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore').run(k, v),
};

export function registra(db, { utente = null, tipo, entita = null, riga = null, prima = null, dopo = null }) {
  db.prepare('INSERT INTO _registro (quando, utente, tipo, entita, riga, prima, dopo) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), utente, tipo, entita, riga, prima == null ? null : JSON.stringify(prima), dopo == null ? null : JSON.stringify(dopo));
}

// id brevi, ordinabili nel tempo (stile ULID, base 32 Crockford)
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
import { randomBytes } from 'node:crypto';
// monotoni: nello stesso millisecondo la parte casuale cresce di uno, così le righe create insieme restano in ordine
let ultimo = { t: 0, r: null };
export function nuovoId() {
  const ora = Date.now(); let r;
  if (ora <= ultimo.t && ultimo.r) { r = ultimo.r.slice(); for (let i = 7; i >= 0; i--) { if (r[i] < 31) { r[i]++; break; } r[i] = 0; } }
  else r = [...randomBytes(8)].map(x => x % 32);
  ultimo = { t: Math.max(ora, ultimo.t), r };
  let t = ultimo.t, s = '';
  for (let i = 0; i < 9; i++) { s = B32[t % 32] + s; t = Math.floor(t / 32); }
  for (const x of r) s += B32[x];
  return s;
}
