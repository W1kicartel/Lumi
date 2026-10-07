// Il percorso SQL dei calcolati: le formule semplici diventano espressioni SQLite, così filtri e ordinamenti sui calcolati
// restano nel database (con LIMIT e OFFSET) invece di leggere fino a 5000 righe in memoria, e gli aggregati leggono solo le
// colonne che servono. Si traduce solo quello che dà lo stesso risultato del motore delle formule (formule.js):
//   numeri, testo, VERO/FALSO · campi della riga (valuta in euro, sì/no, testo) · altri calcolati traducibili
//   + - * / · confronti fra numeri o fra testi · E O NON · SE(cond; a; b) · ASS · ARROTONDA(x; cifre) · OGGI() · GIORNI(a; b)
//   SOMMA(righe.x) → sottoquery sulle righe figlie · relazione.campo → sottoquery sulla riga collegata
// Tutto il resto (%, ^, CONTA, testo & numeri…) torna null e dati.js usa la strada di prima, in memoria.
// Anche gli indici: data, data e ora, stato e (archiviato, creato) per ogni entità, creati la prima volta che servono.
import * as S from '../schema.js';
import { analizza } from '../formule.js';
import { orologio } from '../formule.js';

const testo = s => `'${String(s).replace(/'/g, "''")}'`;
const vero = x => (x.tipo === 't' ? `(${x.sql} <> '' AND ${x.sql} <> '0')` : `(COALESCE(${x.sql}, 0) <> 0)`);
const oggi = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: orologio.fuso || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
const CONFRONTI = { '=': '=', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
let alias = 0;

// → { sql, tipo: 'n' | 't' | 'b' } oppure null (non traducibile)
export function traduci(db, def, formula, tab = S.tabella(def.id), prof = 0) {
  if (prof > 4) return null;
  let albero; try { albero = analizza(formula); } catch { return null; }
  if (albero.t === 'nome') return null;   // un campo da solo: il motore restituisce null dove SQL darebbe 0
  return nodo(db, def, albero, tab, prof);
}
function campoSql(db, def, id, tab, prof) {
  const c = S.campo(def, id); if (!c || c.archiviato) return null;
  const col = `${tab}.${S.colonna(c.id)}`;
  if (['numero', 'percentuale', 'durata'].includes(c.tipo)) return { sql: `COALESCE(${col}, 0)`, tipo: 'n' };
  if (c.tipo === 'valuta') return { sql: `(COALESCE(${col}, 0) / 100.0)`, tipo: 'n' };
  if (c.tipo === 'si_no') return { sql: `COALESCE(${col}, 0)`, tipo: 'b' };
  if (['testo', 'testo_lungo', 'email', 'telefono', 'url', 'codice_a_barre', 'indirizzo', 'scelta', 'stato', 'data', 'data_ora', 'contatore', 'utente'].includes(c.tipo)) return { sql: `COALESCE(${col}, '')`, tipo: 't' };
  if (c.tipo === 'calcolato') return traduci(db, def, c.formula || '', tab, prof + 1);
  return null;
}
function nodo(db, def, n, tab, prof) {
  const giu = x => nodo(db, def, x, tab, prof);
  switch (n.t) {
    case 'val':
      if (typeof n.v === 'number') return Number.isFinite(n.v) ? { sql: String(n.v), tipo: 'n' } : null;
      if (typeof n.v === 'boolean') return { sql: n.v ? '1' : '0', tipo: 'b' };
      return { sql: testo(n.v), tipo: 't' };
    case 'nome': {
      if (n.v === '@oggi') return { sql: testo(oggi()), tipo: 't' };
      if (n.v.startsWith('@')) return null;
      const [a, b] = n.v.split('.');
      if (!b) return campoSql(db, def, a, tab, prof);
      const k = S.campo(def, a);   // relazione.campo: solo colonne vere (il motore non calcola i calcolati della riga collegata)
      if (k?.tipo !== 'relazione' || k.molti || k.archiviato) return null;
      const altra = S.leggi(db, k.entita), x = altra && S.campo(altra, b); if (!x || x.tipo === 'calcolato' || !S.haColonna(x)) return null;
      const al = `k${++alias}`, v = campoSql(db, altra, b, al, prof); if (!v) return null;
      return { sql: `(CASE WHEN ${tab}.${S.colonna(a)} IS NULL THEN NULL ELSE (SELECT ${v.sql} FROM ${S.tabella(k.entita)} ${al} WHERE ${al}.id = ${tab}.${S.colonna(a)}) END)`, tipo: v.tipo };
    }
    case 'un': {
      const x = giu(n.e); if (!x) return null;
      if (n.op === 'not') return { sql: `(NOT ${vero(x)})`, tipo: 'b' };
      if (x.tipo === 't') return null;
      return n.op === '-' ? { sql: `(-${x.sql})`, tipo: 'n' } : x;
    }
    case 'bin': {
      const a = giu(n.a), b = giu(n.b); if (!a || !b) return null;
      if (n.op === 'and' || n.op === 'or') return { sql: `(${vero(a)} ${n.op === 'and' ? 'AND' : 'OR'} ${vero(b)})`, tipo: 'b' };
      const numeri = a.tipo !== 't' && b.tipo !== 't';
      if (['+', '-', '*'].includes(n.op)) return numeri ? { sql: `(${a.sql} ${n.op} ${b.sql})`, tipo: 'n' } : null;
      if (n.op === '/') return numeri ? { sql: `(${a.sql} * 1.0 / NULLIF(${b.sql}, 0))`, tipo: 'n' } : null;
      if (n.op === '&') return a.tipo === 't' && b.tipo === 't' ? { sql: `(${a.sql} || ${b.sql})`, tipo: 't' } : null;
      if (CONFRONTI[n.op]) {
        if (numeri) return { sql: `(COALESCE(${a.sql}, 0) ${CONFRONTI[n.op]} COALESCE(${b.sql}, 0))`, tipo: 'b' };
        if (a.tipo === 't' && b.tipo === 't') return { sql: `(${a.sql} ${CONFRONTI[n.op]} ${b.sql})`, tipo: 'b' };
      }
      return null;
    }
    case 'fn': {
      const f = n.f;
      if (f === 'SE' || f === 'IF') {
        const c = n.arg[0] && giu(n.arg[0]), x = n.arg[1] && giu(n.arg[1]), y = n.arg[2] ? giu(n.arg[2]) : { sql: "''", tipo: 't' };
        if (!c || !x || !y || (x.tipo === 't') !== (y.tipo === 't')) return null;
        return { sql: `(CASE WHEN ${vero(c)} THEN ${x.sql} ELSE ${y.sql} END)`, tipo: x.tipo === y.tipo ? x.tipo : 'n' };
      }
      if ((f === 'ASS' || f === 'ABS') && n.arg.length === 1) { const x = giu(n.arg[0]); return x && x.tipo !== 't' ? { sql: `ABS(${x.sql})`, tipo: 'n' } : null; }
      // ARROTONDA come Math.round del motore (metà verso l'alto, anche per i negativi): floor(x·k + 0,5) / k, con floor fatto a mano
      if ((f === 'ARROTONDA' || f === 'ROUND') && n.arg.length >= 1 && n.arg.length <= 2) {
        const x = giu(n.arg[0]), cifre = n.arg[1] ? (n.arg[1].t === 'val' && typeof n.arg[1].v === 'number' ? n.arg[1].v : null) : 0;
        if (!x || x.tipo === 't' || cifre == null || !Number.isInteger(cifre) || Math.abs(cifre) > 8) return null;
        const k = String(10 ** cifre), v = `(COALESCE(${x.sql}, 0) * ${k} + 0.5)`;
        return { sql: `((CAST(${v} AS INTEGER) - (${v} < CAST(${v} AS INTEGER))) / (${k} * 1.0))`, tipo: 'n' };
      }
      if ((f === 'OGGI' || f === 'TODAY') && !n.arg.length) return { sql: testo(oggi()), tipo: 't' };
      if ((f === 'GIORNI' || f === 'DAYS') && n.arg.length === 2) {
        const x = giu(n.arg[0]), y = giu(n.arg[1]); if (x?.tipo !== 't' || y?.tipo !== 't') return null;
        return { sql: `CAST(ROUND(julianday(NULLIF(${y.sql}, '')) - julianday(NULLIF(${x.sql}, ''))) AS INTEGER)`, tipo: 'n' };
      }
      if (f === 'SOMMA' || f === 'SUM') {
        const parti = n.arg.map(x => {
          if (x.t !== 'nome' || !x.v.includes('.')) { const y = giu(x); return y && y.tipo !== 't' ? y.sql : null; }
          const [a, b] = x.v.split('.'), k = S.campo(def, a); if (k?.tipo !== 'righe' || k.archiviato) return null;
          const figlia = S.leggi(db, k.entita); if (!figlia) return null;
          const al = `r${++alias}`, v = campoSql(db, figlia, b, al, prof + 1); if (!v || v.tipo === 't') return null;
          return `(SELECT COALESCE(SUM(${v.sql}), 0) FROM ${S.tabella(k.entita)} ${al} WHERE ${al}.${S.colonna(k.campo)} = ${tab}.id AND ${al}.archiviato = 0)`;
        });
        return parti.length && parti.every(Boolean) ? { sql: `(${parti.join(' + ')})`, tipo: 'n' } : null;
      }
      return null;
    }
  }
  return null;
}

// gli indici che servono alle liste e agli aggregati, una volta per forma dell'entità
const fatti = new WeakMap();
export function indici(db, def) {
  if (!fatti.has(db)) fatti.set(db, new Set());
  const T = S.tabella(def.id), cols = S.campiAttivi(def).filter(c => S.haColonna(c) && ['data', 'data_ora', 'stato'].includes(c.tipo)).map(c => c.id);
  const chiave = def.id + ':' + cols.join(','); if (fatti.get(db).has(chiave)) return; fatti.get(db).add(chiave);
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS x_${def.id}__creato ON ${T}(archiviato, creato DESC, id DESC)`);
    for (const c of cols) db.exec(`CREATE INDEX IF NOT EXISTS x_${def.id}_${c} ON ${T}(${S.colonna(c)})`);
  } catch { /* una tabella appena cambiata: si riprova la prossima volta */ fatti.get(db).delete(chiave); }
}

// collega il percorso SQL a dati.js (KUBO_SENZA_SQL=1 lo spegne: serve a misurare il prima e dopo in test/carico.mjs)
export function installaSql(db, { D }) {
  if (!D.estensioni || process.env.KUBO_SENZA_SQL === '1') return;
  D.estensioni.sqlCalcolato = (dbx, def, c) => traduci(dbx, def, c.formula || '');
  D.estensioni.indici = indici;
}
