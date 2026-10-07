// Automazioni: «quando succede X (e la condizione è vera), fai Y». Sono dati (tabella _automazioni), come lo schema.
//   { id, nome, entita, quando: 'creato'|'modificato'|'salvato'|'eliminato'|'campo_cambia', campo?, a?, se?: formula,
//     azioni: [
//       { tipo: 'imposta', campo, formula }                                  sulla stessa riga
//       { tipo: 'aggiorna_collegato', relazione, campo, aggiungi | formula, perOgniRiga? }   es. scala il magazzino
//       { tipo: 'crea', entita, valori: { campo: formula } }                  es. crea un promemoria
//       { tipo: 'avvisa', testo: formula }                                    un avviso per tutti (evento in tempo reale)
//     ] }
// Le formule vedono i valori della riga (dopo la modifica), «prima.campo» per i valori di prima, e nelle azioni per ogni
// riga figlia i campi della riga. Girano come «sistema» (senza permessi), con un limite di 5 livelli contro i cicli.
import { calcola, analizza } from './formule.js';
import * as D from './dati.js';
import * as S from './schema.js';
import { transazione, nuovoId, registra } from './db.js';

export function elenco(db) { return db.prepare('SELECT def, attiva FROM _automazioni').all().map(r => ({ ...JSON.parse(r.def), attiva: !!r.attiva })); }
export function salva(db, def, { utente = null } = {}) {
  const errori = valida(db, def); if (errori.length) throw new S.ErroreSchema('Automazione non valida', errori);
  const id = def.id || nuovoId(); const pulita = { ...def, id }; delete pulita.attiva;
  db.prepare('INSERT INTO _automazioni (id, def, attiva) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET def = excluded.def, attiva = excluded.attiva').run(id, JSON.stringify(pulita), def.attiva === false ? 0 : 1);
  registra(db, { utente, tipo: 'automazione', entita: def.entita, riga: id, dopo: pulita });
  return { ...pulita, attiva: def.attiva !== false };
}
export function elimina(db, id) { db.prepare('DELETE FROM _automazioni WHERE id = ?').run(id); }

export function valida(db, a) {
  const e = [], def = S.leggi(db, a.entita);
  if (!def) return [`entità sconosciuta «${a.entita}»`];
  if (!['creato', 'modificato', 'salvato', 'eliminato', 'campo_cambia'].includes(a.quando)) e.push(`«quando» non valido: ${a.quando}`);
  if (a.quando === 'campo_cambia' && !S.campo(def, a.campo)) e.push(`campo sconosciuto «${a.campo}»`);
  const formula = (f, dove) => { try { analizza(f); } catch (x) { e.push(`${dove}: ${x.message}`); } };
  if (a.se) formula(a.se, 'condizione');
  if (!Array.isArray(a.azioni) || !a.azioni.length) e.push('servono delle azioni');
  for (const [i, x] of (a.azioni || []).entries()) {
    const dove = `azione ${i + 1}`;
    if (x.tipo === 'imposta') { if (!S.campo(def, x.campo)) e.push(`${dove}: campo sconosciuto «${x.campo}»`); formula(x.formula, dove); }
    else if (x.tipo === 'aggiorna_collegato') {
      let base = def;
      if (x.perOgniRiga) { const r = S.campo(def, x.perOgniRiga); if (r?.tipo !== 'righe') { e.push(`${dove}: «${x.perOgniRiga}» non è un campo righe`); continue; } base = S.leggi(db, r.entita); }
      const rel = S.campo(base, x.relazione);
      if (rel?.tipo !== 'relazione') { e.push(`${dove}: «${x.relazione}» non è una relazione`); continue; }
      if (!S.campo(S.leggi(db, rel.entita), x.campo)) e.push(`${dove}: «${rel.entita}.${x.campo}» non esiste`);
      formula(x.aggiungi ?? x.formula ?? '', dove);
    } else if (x.tipo === 'crea') { if (!S.leggi(db, x.entita)) e.push(`${dove}: entità sconosciuta «${x.entita}»`); for (const f of Object.values(x.valori || {})) formula(String(f), dove); }
    else if (x.tipo === 'avvisa') formula(x.testo, dove);
    else e.push(`${dove}: tipo sconosciuto «${x.tipo}»`);
  }
  return e;
}

let profondita = 0;
const avvisi = [];
export const suAvviso = f => avvisi.push(f);

function scatta(a, ev) {
  if (a.entita !== ev.entita) return false;
  switch (a.quando) {
    case 'creato': return ev.tipo === 'crea';
    case 'modificato': return ev.tipo === 'modifica';
    case 'salvato': return ev.tipo === 'crea' || ev.tipo === 'modifica';
    case 'eliminato': return ev.tipo === 'elimina';
    case 'campo_cambia': {
      if (!['crea', 'modifica'].includes(ev.tipo)) return false;
      const p = norm(ev.prima?.[a.campo]), d = norm(ev.dopo?.[a.campo]);
      return p !== d && (a.a === undefined || d === a.a);
    }
  }
  return false;
}
const norm = v => (v && typeof v === 'object' && 'id' in v ? v.id : v ?? null);

export function esegui(db, a, ev) {
  const valori = { ...(ev.dopo || ev.prima), prima: ev.prima || {} };
  for (const [k, v] of Object.entries(valori)) if (v && typeof v === 'object' && 'id' in v && 'titolo' in v) valori[k] = v.id;
  if (a.se && !calcola(a.se, { valori })) return;
  for (const x of a.azioni) {
    if (x.tipo === 'imposta') D.modifica(db, ev.entita, ev.id, { [x.campo]: calcola(x.formula, { valori }) }, null, { interno: true });
    if (x.tipo === 'crea') D.crea(db, x.entita, Object.fromEntries(Object.entries(x.valori || {}).map(([k, f]) => [k, calcola(String(f), { valori })])), null, { interno: true });
    if (x.tipo === 'avvisa') { const t = String(calcola(x.testo, { valori }) ?? ''); for (const f of avvisi) f({ testo: t, entita: ev.entita, id: ev.id, automazione: a.nome }); }
    if (x.tipo === 'aggiorna_collegato') {
      const righe = x.perOgniRiga ? (D.leggi(db, ev.entita, ev.id, null)[x.perOgniRiga] || []) : [ev.dopo || ev.prima];
      for (const r of righe) {
        const v = { ...valori, ...r }; for (const [k, y] of Object.entries(v)) if (y && typeof y === 'object' && 'id' in y && 'titolo' in y) v[k] = y.id;
        const idColl = norm(r[x.relazione]); if (!idColl) continue;
        const ent = (x.perOgniRiga ? S.campo(S.leggi(db, S.campo(S.leggi(db, ev.entita), x.perOgniRiga).entita), x.relazione) : S.campo(S.leggi(db, ev.entita), x.relazione)).entita;
        const coll = D.leggi(db, ent, idColl, null, { conRighe: false });
        v[x.relazione] = coll;
        const nuovo = x.aggiungi != null ? Number(coll[x.campo] || 0) + Number(calcola(String(x.aggiungi), { valori: v }) || 0) : calcola(x.formula, { valori: v });
        D.modifica(db, ent, idColl, { [x.campo]: nuovo }, null, { interno: true });
      }
    }
  }
}

// collega le automazioni al motore dei dati: girano nella stessa transazione della modifica che le fa scattare
export function attiva() {
  return D.ascolta((ev, db) => {
    if (profondita >= 5) return;
    const tutte = elenco(db).filter(a => a.attiva && scatta(a, ev)); if (!tutte.length) return;
    profondita++;
    try { transazione(db, () => { for (const a of tutte) esegui(db, a, ev); }); }
    finally { profondita--; }
  });
}
