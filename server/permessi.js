// Ruoli e permessi. Un ruolo dice, per ogni entità (o «*» per tutte): leggi, crea, modifica, elimina; quali campi sono
// nascosti o in sola lettura; se vede solo le righe che ha creato lui («soloPropri»). Più due poteri: personalizzare lo
// schema e gestire gli utenti. I tre ruoli di base si possono copiare e modificare; il titolare non si può limitare.
//   { id, nome, schema: bool, utenti: bool, entita: { '*': {leggi, crea, modifica, elimina}, articoli: { …, campi: { costo: 'nascosto' } } } }

export const RUOLI_BASE = [
  { id: 'titolare', nome: 'Titolare', schema: true, utenti: true, entita: { '*': { leggi: true, crea: true, modifica: true, elimina: true } } },
  { id: 'collaboratore', nome: 'Collaboratore', schema: false, utenti: false, entita: { '*': { leggi: true, crea: true, modifica: true, elimina: false } } },
  { id: 'lettura', nome: 'Solo lettura', schema: false, utenti: false, entita: { '*': { leggi: true, crea: false, modifica: false, elimina: false } } },
];

export class ErrorePermesso extends Error { constructor(m) { super(m || 'Non hai il permesso'); } }

export function ruolo(db, id) {
  const r = db.prepare('SELECT def FROM _ruoli WHERE id = ?').get(id);
  return r ? JSON.parse(r.def) : RUOLI_BASE.find(x => x.id === id) || RUOLI_BASE[2];
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
