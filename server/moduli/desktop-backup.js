// I backup: una copia coerente del database (VACUUM INTO: si prende anche mentre si lavora, senza fermare niente) in una
// cartella backup/ accanto ai dati, oppure in una cartella scelta dal titolare (un disco esterno, una cartella sincronizzata).
//   kubo-2026-10-07-21-50-03-giornaliero.db   tipi: giornaliero, modifica (prima di schema o import), manuale, sicurezza
//                                              (prima di un ripristino), caricato (portato da fuori)
// Gli allegati (<dati>/file) vanno in <backup>/allegati in modo incrementale: si copia solo quello che manca o è cambiato,
// e non si cancella mai niente, così anche un backup vecchio ritrova i suoi file.
// Rotazione dei giornalieri come restic: il più recente di ognuno degli ultimi 7 giorni, 4 settimane e 12 mesi.
import { DatabaseSync, backup as copiaPagine } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, renameSync, rmSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cartellaFile } from './import-file.js';
import { apri } from '../db.js';

export const NOME = /^kubo-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(giornaliero|modifica|manuale|sicurezza|caricato)\.db$/;
export const TIENI = { giornalieri: 7, settimanali: 4, mensili: 12, modifica: 10, sicurezza: 5, caricato: 5 };

export const fileDb = db => db.prepare('PRAGMA database_list').all().find(x => x.name === 'main')?.file || '';
const due = n => String(n).padStart(2, '0');
export const nomePer = (d, tipo) => `kubo-${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}-${due(d.getHours())}-${due(d.getMinutes())}-${due(d.getSeconds())}-${tipo}.db`;
const giorno = d => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
// la settimana ISO (lunedì-domenica) come «anno-numero»
function settimana(d) { const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const a = new Date(t.getFullYear(), 0, 4); return `${t.getFullYear()}-${1 + Math.round(((t - a) / 864e5 - 3 + ((a.getDay() + 6) % 7)) / 7)}`; }

// la cartella dei backup: quella scelta (impostazione «backup.cartella»), altrimenti <dati>/backup
export function cartellaPredefinita(db) { const f = fileDb(db); return f ? join(dirname(f), 'backup') : ''; }
export const cartellaBackup = (db, meta) => meta.leggi(db, 'backup.cartella') || cartellaPredefinita(db);

// una cartella scelta dal titolare: percorso assoluto, normalizzato, scrivibile, e mai dentro la cartella dei dati
export function validaCartella(db, testo) {
  const t = String(testo || '').trim(); if (!t) return '';
  if (!isAbsolute(t)) throw new Error('Scrivi il percorso completo della cartella (per esempio /Volumes/Disco/Kubo o D:\\Backup\\Kubo)');
  const c = resolve(t), dati = dirname(fileDb(db) || '.');
  if ((c + sep).startsWith(dati + sep) && c !== join(dati, 'backup')) throw new Error('Scegli una cartella fuori da quella dei dati');
  try { mkdirSync(c, { recursive: true }); const prova = join(c, `.kubo-prova-${randomBytes(4).toString('hex')}`); writeFileSync(prova, 'ok'); rmSync(prova); }
  catch { throw new Error('In quella cartella non si riesce a scrivere: controlla che il disco sia collegato'); }
  return c;
}

export function elenco(cartella) {
  let l = []; try { l = readdirSync(cartella); } catch { return []; }
  return l.map(nome => { const m = nome.match(NOME); if (!m) return null; let s; try { s = statSync(join(cartella, nome)); } catch { return null; }
    return { nome, tipo: m[7], quando: new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString(), dimensione: s.size }; })
    .filter(Boolean).sort((a, b) => b.quando.localeCompare(a.quando) || b.nome.localeCompare(a.nome));
}

// quali backup restano: per i giornalieri il più recente di ogni giorno / settimana / mese, fino ai limiti; per gli altri
// tipi gli ultimi N; i manuali tutti (li ha voluti la persona)
export function daTenere(lista, limiti = TIENI) {
  const tieni = new Set(), ord = [...lista].sort((a, b) => b.quando.localeCompare(a.quando));
  const gfs = [['giornalieri', giorno], ['settimanali', settimana], ['mensili', d => giorno(d).slice(0, 7)]];
  for (const [k, chiave] of gfs) {
    let ultimo = null, n = 0;
    for (const b of ord.filter(b => b.tipo === 'giornaliero')) { if (n >= limiti[k]) break; const c = chiave(new Date(b.quando)); if (c !== ultimo) { tieni.add(b.nome); ultimo = c; n++; } }
  }
  for (const t of ['modifica', 'sicurezza', 'caricato']) ord.filter(b => b.tipo === t).slice(0, limiti[t]).forEach(b => tieni.add(b.nome));
  ord.filter(b => b.tipo === 'manuale').forEach(b => tieni.add(b.nome));
  return tieni;
}
export function ruota(cartella, limiti) {
  const l = elenco(cartella), tieni = daTenere(l, limiti), tolti = [];
  for (const b of l) if (!tieni.has(b.nome)) { try { rmSync(join(cartella, b.nome), { force: true }); tolti.push(b.nome); } catch {} }
  return tolti;
}

// gli allegati, in modo incrementale: copia solo i file nuovi o cambiati (dimensione o data diverse)
export function copiaAllegati(da, a) {
  let copiati = 0, byte = 0;
  const giro = (d, rel) => { let l = []; try { l = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of l) {
      if (rel === '' && x.name === '_tmp') continue;   // i caricamenti a metà non servono
      const p = join(d, x.name), q = join(a, rel, x.name);
      if (x.isDirectory()) { giro(p, join(rel, x.name)); continue; }
      if (!x.isFile()) continue;
      const s = statSync(p); let t = null; try { t = statSync(q); } catch {}
      if (t && t.size === s.size && Math.floor(t.mtimeMs) >= Math.floor(s.mtimeMs)) continue;
      mkdirSync(dirname(q), { recursive: true }); copyFileSync(p, q); copiati++; byte += s.size;
    } };
  giro(da, ''); return { copiati, byte };
}

// una copia adesso. Il file si scrive con un nome provvisorio e si rinomina solo quando è completo.
export function copia(db, cartella, tipo = 'manuale', ora = new Date()) {
  if (!cartella) throw new Error('Questo database non ha una cartella (è in memoria)');
  mkdirSync(cartella, { recursive: true });
  let nome = nomePer(ora, tipo); for (let i = 1; existsSync(join(cartella, nome)); i++) nome = nomePer(new Date(ora.getTime() + i * 1000), tipo);
  const prov = join(cartella, `.${nome}.${randomBytes(4).toString('hex')}.tmp`);
  try { db.exec(`VACUUM INTO '${prov.replaceAll("'", "''")}'`); renameSync(prov, join(cartella, nome)); }
  finally { rmSync(prov, { force: true }); }
  const allegati = copiaAllegati(cartellaFile(db), join(cartella, 'allegati'));
  return { ...elenco(cartella).find(b => b.nome === nome), allegati };
}

// un file è un backup di Kubo sano? (integrità, tabelle del motore, almeno un titolare attivo)
export function verifica(percorso, { versioneMax = Infinity } = {}) {
  let d; try { d = new DatabaseSync(percorso, { readOnly: true }); } catch { throw new Error('Il file non è un database di Kubo'); }
  try {
    let ok; try { ok = d.prepare('PRAGMA integrity_check').get(); } catch { throw new Error('Il file non è un database di Kubo'); }
    if (Object.values(ok)[0] !== 'ok') throw new Error('Il backup è rovinato: scegline un altro');
    const tab = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(x => x.name));
    if (!['_meta', '_entita', '_utenti', '_sessioni', '_registro'].every(t => tab.has(t))) throw new Error('Il file non è un database di Kubo');
    const v = d.prepare('PRAGMA user_version').get().user_version;
    if (v > versioneMax) throw new Error('Il backup viene da una versione di Kubo più nuova: aggiorna Kubo prima di ripristinarlo');
    const titolari = d.prepare("SELECT COUNT(*) n FROM _utenti WHERE ruolo = 'titolare' AND attivo = 1").get().n;
    if (!titolari) throw new Error('Nel backup non c\'è un titolare attivo: non si potrebbe più entrare');
    return { azienda: d.prepare("SELECT valore FROM _meta WHERE chiave = 'azienda'").get()?.valore ?? null,
      utenti: d.prepare('SELECT COUNT(*) n FROM _utenti').get().n, sezioni: d.prepare('SELECT COUNT(*) n FROM _entita WHERE archiviata = 0').get().n, versione: v };
  } finally { d.close(); }
}

// Il ripristino, senza fermare il server: 1) si controlla il file; 2) copia di sicurezza di adesso; 3) il backup si prepara
// in un file a parte (con le tabelle dei moduli arrivati dopo, vuote, e la sessione di chi ripristina, se esiste lì);
// 4) le sue pagine si copiano dentro il database vivo con l'API di backup di SQLite, in un colpo solo: le connessioni
// aperte vedono il contenuto nuovo alla lettura dopo; 5) tornano gli allegati che mancano.
export async function ripristina(db, percorso, { cartella, token = null } = {}) {
  const versioneMax = db.prepare('PRAGMA user_version').get().user_version;
  const info = verifica(percorso, { versioneMax });
  const vivo = fileDb(db); if (!vivo) throw new Error('Questo database è in memoria');
  const sicurezza = copia(db, cartella, 'sicurezza');
  // il file preparato sta in una cartella provvisoria: apri() di db.js gli fa le migrazioni del motore che mancano (un backup
  // di una versione vecchia) e la sua copia «prima di migrare» resta lì dentro e se ne va con lei
  const tmp = join(dirname(vivo), `.ripristino-${randomBytes(6).toString('hex')}`), prep = join(tmp, 'kubo.db');
  try {
    mkdirSync(tmp);
    const src = new DatabaseSync(percorso, { readOnly: true });
    try { src.exec(`VACUUM INTO '${prep.replaceAll("'", "''")}'`); } finally { src.close(); }
    const p = apri(prep);
    try {
      const ci = new Set(p.prepare('SELECT name FROM sqlite_master').all().map(x => x.name));
      for (const x of db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE '\\_%' ESCAPE '\\' AND sql IS NOT NULL ORDER BY type = 'table' DESC").all())
        if (!ci.has(x.name)) p.exec(x.sql);
      const s = token && db.prepare('SELECT * FROM _sessioni WHERE token = ?').get(String(token));
      if (s && p.prepare('SELECT 1 FROM _utenti WHERE id = ? AND attivo = 1').get(s.utente))
        p.prepare('INSERT OR REPLACE INTO _sessioni (token, utente, scade, agente) VALUES (?, ?, ?, ?)').run(s.token, s.utente, s.scade, s.agente);
      // le impostazioni dei backup e delle versioni restano quelle di adesso: altrimenti la cartella dei backup (con la copia
      // di sicurezza appena fatta) potrebbe tornare quella di allora, o quella di un altro computer per un backup caricato
      p.exec("DELETE FROM _meta WHERE chiave LIKE 'backup.%' OR chiave LIKE 'aggiornamenti.%'");
      for (const m of db.prepare("SELECT chiave, valore FROM _meta WHERE chiave LIKE 'backup.%' OR chiave LIKE 'aggiornamenti.%'").all())
        p.prepare('INSERT INTO _meta (chiave, valore) VALUES (?, ?)').run(m.chiave, m.valore);
      p.exec(`PRAGMA user_version = ${Math.max(versioneMax, p.prepare('PRAGMA user_version').get().user_version)}`);
      await copiaPagine(p, vivo, { rate: 1e9 });
    } finally { p.close(); }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const da = join(dirname(percorso), 'allegati');   // gli allegati della cartella del backup (può essere quella accanto ai dati)
  const allegati = existsSync(da) ? copiaAllegatiMancanti(da, cartellaFile(db)) : 0;
  return { ...info, sicurezza: sicurezza.nome, allegati };
}
// al ripristino: i file che il database vuole e che mancano tornano dalla copia; quelli che ci sono non si toccano
function copiaAllegatiMancanti(da, a) {
  let n = 0;
  const giro = (d, rel) => { let l = []; try { l = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of l) { const p = join(d, x.name), q = join(a, rel, x.name);
      if (x.isDirectory()) giro(p, join(rel, x.name)); else if (x.isFile() && !existsSync(q)) { mkdirSync(dirname(q), { recursive: true }); copyFileSync(p, q); n++; } } };
  giro(da, ''); return n;
}
