// Ruoli e permessi. Un ruolo dice, per ogni entità (o «*» per tutte): leggi, crea, modifica, elimina; quali campi sono
// nascosti o in sola lettura; se vede solo le righe che ha creato lui («soloPropri»). Più due poteri: personalizzare lo
// schema e gestire gli utenti. I tre ruoli di base si possono copiare e modificare; il titolare non si può limitare.
//   { id, nome, schema: bool, utenti: bool, entita: { '*': {leggi, crea, modifica, elimina}, articoli: { …, campi: { costo: 'nascosto' } } } }

export const RUOLI_BASE = [
  { id: 'titolare', nome: 'Titolare', schema: true, utenti: true, entita: { '*': { leggi: true, crea: true, modifica: true, elimina: true } } },
  { id: 'collaboratore', nome: 'Collaboratore', schema: false, utenti: false, entita: { '*': { leggi: true, crea: true, modifica: true, elimina: false } } },
  { id: 'lettura', nome: 'Solo lettura', schema: false, utenti: false, entita: { '*': { leggi: true, crea: false, modifica: false, elimina: false } } },
];

import * as S from './schema.js';
import { analizza, nomi } from './formule.js';

export class ErrorePermesso extends Error { constructor(m) { super(m || 'Non hai il permesso'); } }

export function ruolo(db, id) {
  const r = db.prepare('SELECT def FROM _ruoli WHERE id = ?').get(id);
  return nascondiDerivati(db, r ? JSON.parse(r.def) : RUOLI_BASE.find(x => x.id === id) || RUOLI_BASE[2]);
}
// un calcolato che usa un campo nascosto lo rivelerebbe (margine = prezzo - costo dice il costo): si nasconde anche lui,
// come i calcolati che usano un campo nascosto delle righe o della riga collegata. Si ripete finché non cambia più niente.
export function nascondiDerivati(db, r) {
  if (!r || r.id === 'titolare' || !Object.values(r.entita || {}).some(x => Object.values(x?.campi || {}).includes('nascosto') || x?.leggi === false)) return r;
  const out = structuredClone(r), defs = new Map(S.elenco(db).map(d => [d.id, d]));
  const st = (e, c) => regola(out, e).campi[c];
  for (let giro = 0, cambiato = true; cambiato && giro <= defs.size * 50; giro++) {   // ogni giro nasconde almeno un campo: finisce
    cambiato = false;
    for (const d of defs.values()) for (const c of S.campiAttivi(d)) {
      if (c.tipo !== 'calcolato' || st(d.id, c.id) === 'nascosto') continue;
      let usati; try { usati = [...nomi(analizza(c.formula || ''))]; } catch { continue; }
      const svela = usati.some(n => {
        const [a, b] = n.split('.'); if (st(d.id, a) === 'nascosto') return true;
        // un campo delle righe o della riga collegata: nascosto, o di una sezione che il ruolo non può leggere
        const k = b && S.campo(d, a); return !!(k && ['righe', 'relazione'].includes(k.tipo) && (st(k.entita, b) === 'nascosto' || !regola(out, k.entita).leggi));
      });
      if (svela) { out.entita ||= {}; out.entita[d.id] ||= {}; out.entita[d.id].campi = { ...(out.entita[d.id].campi || {}), [c.id]: 'nascosto' }; cambiato = true; }
    }
  }
  return out;
}
export function salvaRuolo(db, def) {
  if (def.id === 'titolare') throw new ErrorePermesso('Il ruolo del titolare non si modifica');
  db.prepare('INSERT INTO _ruoli (id, def) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET def = excluded.def').run(def.id, JSON.stringify(def));
}
export function ruoli(db) {
  const propri = db.prepare('SELECT def FROM _ruoli').all().map(r => JSON.parse(r.def));
  return [...RUOLI_BASE.filter(b => !propri.some(p => p.id === b.id)), ...propri];
}

// regola effettiva per un'entità: quella specifica sopra quella generale
function regola(r, entita) {
  const g = r.entita?.['*'] || {}, s = r.entita?.[entita] || {};
  return { leggi: !!(s.leggi ?? g.leggi), crea: !!(s.crea ?? g.crea), modifica: !!(s.modifica ?? g.modifica), elimina: !!(s.elimina ?? g.elimina),
    soloPropri: !!(s.soloPropri ?? g.soloPropri), campi: { ...(g.campi || {}), ...(s.campi || {}) } };
}

// ctx = { utente: {id, ruolo}, r: ruolo } oppure null = sistema (automazioni, modelli: può tutto)
export function puo(ctx, entita, azione) {
  if (!ctx) return true;
  if (ctx.r.id === 'titolare') return true;
  return regola(ctx.r, entita)[azione];
}
export function verifica(ctx, entita, azione) { if (!puo(ctx, entita, azione)) throw new ErrorePermesso(`Non hai il permesso di ${{ leggi: 'vedere', crea: 'creare', modifica: 'modificare', elimina: 'eliminare' }[azione]} in «${entita}»`); }
export function soloPropri(ctx, entita) { return !!ctx && ctx.r.id !== 'titolare' && regola(ctx.r, entita).soloPropri; }
// 'nascosto' | 'lettura' | null
export function statoCampo(ctx, entita, campo) { if (!ctx || ctx.r.id === 'titolare') return null; return regola(ctx.r, entita).campi[campo] || null; }
export const puoSchema = ctx => !ctx || ctx.r.id === 'titolare' || !!ctx.r.schema;
export const puoUtenti = ctx => !ctx || ctx.r.id === 'titolare' || !!ctx.r.utenti;
