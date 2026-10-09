// Il magazzino: registro dei movimenti (ogni cambio di giacenza, da qualsiasi parte arrivi), inventario fisico con le conte
// (anche col lettore di codici a barre) e le rettifiche, valore del magazzino al costo. Rotte:
//   GET  /api/magazzino/sezioni                       le sezioni con la giacenza (articoli, ricambi, materiali…)
//   GET  /api/magazzino/valore?sezione                valore per articolo e per categoria, giacenze negative, sotto scorta
//   GET  /api/magazzino/valore.csv?sezione            lo stesso in CSV (per il commercialista: rimanenze finali)
//   GET  /api/magazzino/movimenti?sezione&articolo&da&a   il registro dei movimenti
//   GET/POST /api/magazzino/inventari { sezione, nome }  · GET /api/magazzino/inventari/:id
//   POST /api/magazzino/inventari/:id/conta { conte: [{ articolo, contata }] } oppure { codice, piu }   (il lettore: +1 a ogni lettura)
//   POST /api/magazzino/inventari/:id/chiudi          applica le rettifiche delle righe contate
// Il registro si scrive da solo: un ascoltatore di dati.js guarda ogni scrittura su una sezione con il campo «giacenza».
import { cent, euro } from './documenti-calcoli.js';
import { scriviCsv } from './import-formati.js';
import { transazione } from '../db.js';

const oggiIso = () => new Date().toISOString().slice(0, 10);
const num = x => Number(x) || 0;
const esiste = (S, db, e) => { const d = S.leggi(db, e); return !!d && !d.archiviata; };
const conGiacenza = (S, db, e) => { const d = S.leggi(db, e); return !!d && !d.archiviata && d.campi.some(c => c.id === 'giacenza' && !c.archiviato); };
const tutte = (D, db, e, ctx) => { const out = []; for (let p = 1; p < 400; p++) { const r = D.elenca(db, e, { perPagina: 500, pagina: p }, ctx); out.push(...r.righe); if (r.righe.length < 500) break; } return out; };
const pronte = new WeakSet();
function tabelle(db) {
  if (pronte.has(db)) return; pronte.add(db);
  db.exec(`CREATE TABLE IF NOT EXISTS _magazzino_movimenti (id INTEGER PRIMARY KEY, sezione TEXT NOT NULL, articolo TEXT NOT NULL, quando TEXT NOT NULL, quantita REAL NOT NULL, giacenza REAL, origine TEXT, utente TEXT);
    CREATE INDEX IF NOT EXISTS _magazzino_movimenti_articolo ON _magazzino_movimenti(sezione, articolo, quando);
    CREATE TABLE IF NOT EXISTS _magazzino_inventari (id INTEGER PRIMARY KEY, sezione TEXT NOT NULL, nome TEXT NOT NULL, creato TEXT NOT NULL, chiuso TEXT, utente TEXT);
    CREATE TABLE IF NOT EXISTS _magazzino_conte (inventario INTEGER NOT NULL, articolo TEXT NOT NULL, attesa REAL NOT NULL, contata REAL, costo INTEGER, contato_da TEXT, PRIMARY KEY (inventario, articolo));`);
}

// ---------- registro dei movimenti ----------
// origine: «inventario» (rettifica), «automazione» (scritture interne: vendite, ordini arrivati, consumi), «modifica» (a mano o API)
let causa = null, attivo = false;
export function attivaRegistro(D, S) {
  if (attivo) return; attivo = true;
  D.ascolta((ev, db, ctx) => {
    if (!['crea', 'modifica'].includes(ev.tipo) || !ev.dopo) return;
    const prima = ev.tipo === 'crea' ? 0 : num(ev.prima?.giacenza), dopo = num(ev.dopo.giacenza);
    if (prima === dopo || !('giacenza' in ev.dopo) || !conGiacenza(S, db, ev.entita)) return;
    tabelle(db);
    db.prepare('INSERT INTO _magazzino_movimenti (sezione, articolo, quando, quantita, giacenza, origine, utente) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ev.entita, String(ev.id), new Date().toISOString(), dopo - prima, dopo, causa || (ev.tipo === 'crea' ? 'iniziale' : ev.interno ? 'automazione' : 'modifica'), ctx?.utente?.id ?? null);
  });
}
export function movimenti(k, ctx, { sezione, articolo = null, da = null, a = null, limite = 500 } = {}) {
  const { db, S, P } = k; tabelle(db);
  if (!conGiacenza(S, db, sezione)) throw new Error('Sezione senza giacenza');
  P.verifica(ctx, sezione, 'leggi');
  const w = ['sezione = ?'], v = [sezione];
  if (articolo) { w.push('articolo = ?'); v.push(String(articolo)); }
  if (da) { w.push('quando >= ?'); v.push(da); }
  if (a) { w.push('quando <= ?'); v.push(`${a}T99`); }
  const righe = db.prepare(`SELECT articolo, quando, quantita, giacenza, origine, utente FROM _magazzino_movimenti WHERE ${w.join(' AND ')} ORDER BY quando DESC, id DESC LIMIT ?`).all(...v, Math.min(5000, limite));
  const def = S.leggi(db, sezione), t = S.campoTitolo(def)?.id || 'nome', nomi = new Map();
  for (const r of righe) if (!nomi.has(r.articolo)) { const x = db.prepare(`SELECT ${S.colonna(t)} AS n FROM ${S.tabella(sezione)} WHERE id = ?`).get(r.articolo); nomi.set(r.articolo, x?.n ?? r.articolo); }
  const persone = new Map(db.prepare('SELECT id, nome FROM _utenti').all().map(u => [u.id, u.nome]));
  return righe.map(r => ({ ...r, nome: String(nomi.get(r.articolo)), utente: persone.get(r.utente) || null }));
}

// ---------- valore del magazzino ----------
// al costo dell'articolo (che gli acquisti tengono al costo medio ponderato); per categoria se la sezione ne ha una
export function valore(k, ctx, sezione) {
  const { db, S, D } = k;
  if (!conGiacenza(S, db, sezione)) throw new Error('Sezione senza giacenza');
  const def = S.leggi(db, sezione), t = S.campoTitolo(def)?.id || 'nome', cat = def.campi.find(c => c.id === 'categoria' && !c.archiviato);
  const nomeCat = v => (cat?.opzioni?.find(o => o.id === v)?.nome ?? v) || '';
  const articoli = tutte(D, db, sezione, ctx).map(a => ({ id: a.id, nome: String(a[t] ?? ''), codice: a.codice || '', categoria: nomeCat(a.categoria), giacenza: num(a.giacenza), soglia: num(a.soglia),
    costo: num(a.costo), valore: euro(cent(num(a.costo) * Math.max(0, num(a.giacenza)))) }));
  const perCategoria = new Map();
  for (const a of articoli) { const c = perCategoria.get(a.categoria) || { categoria: a.categoria, articoli: 0, pezzi: 0, valore: 0 }; c.articoli++; c.pezzi += Math.max(0, a.giacenza); c.valore = euro(cent(c.valore) + cent(a.valore)); perCategoria.set(a.categoria, c); }
  return { sezione, totale: euro(articoli.reduce((s, a) => s + cent(a.valore), 0)), pezzi: articoli.reduce((s, a) => s + Math.max(0, a.giacenza), 0),
    senzaCosto: articoli.filter(a => a.giacenza > 0 && !a.costo).length, negativi: articoli.filter(a => a.giacenza < 0).map(a => ({ id: a.id, nome: a.nome, giacenza: a.giacenza })),
    sottoScorta: articoli.filter(a => a.soglia > 0 && a.giacenza <= a.soglia).length, categorie: [...perCategoria.values()].sort((a, b) => b.valore - a.valore),
    articoli: articoli.sort((a, b) => b.valore - a.valore) };
}

// ---------- inventario fisico ----------
export function nuovoInventario(k, ctx, { sezione, nome = '' }) {
  const { db, S, D, P } = k; tabelle(db);
  if (!conGiacenza(S, db, sezione)) throw new Error('Sezione senza giacenza');
  P.verifica(ctx, sezione, 'modifica');
  if (db.prepare('SELECT 1 FROM _magazzino_inventari WHERE sezione = ? AND chiuso IS NULL').get(sezione)) throw new Error('C\'è già un inventario aperto per questa sezione: chiudilo prima');
  return transazione(db, () => {
    const id = db.prepare('INSERT INTO _magazzino_inventari (sezione, nome, creato, utente) VALUES (?, ?, ?, ?)').run(sezione, String(nome || `Inventario del ${oggiIso().split('-').reverse().join('/')}`).slice(0, 80), new Date().toISOString(), ctx?.utente?.id ?? null).lastInsertRowid;
    const ins = db.prepare('INSERT INTO _magazzino_conte (inventario, articolo, attesa, costo) VALUES (?, ?, ?, ?)');
    for (const a of tutte(D, db, sezione, ctx)) ins.run(id, a.id, num(a.giacenza), cent(a.costo));
    return { id: Number(id) };
  });
}
export function inventari(db) { tabelle(db); return db.prepare('SELECT i.id, i.sezione, i.nome, i.creato, i.chiuso, COUNT(c.articolo) AS righe, COUNT(c.contata) AS contate FROM _magazzino_inventari i LEFT JOIN _magazzino_conte c ON c.inventario = i.id GROUP BY i.id ORDER BY i.id DESC').all(); }
function testa(db, id) { tabelle(db); const i = db.prepare('SELECT * FROM _magazzino_inventari WHERE id = ?').get(Number(id)); if (!i) throw new Error('Inventario sconosciuto'); return i; }
export function inventario(k, ctx, id) {
  const { db, S, P } = k, i = testa(db, id);
  P.verifica(ctx, i.sezione, 'leggi');
  const def = S.leggi(db, i.sezione), t = S.campoTitolo(def)?.id || 'nome', ha = c => def.campi.some(x => x.id === c && !x.archiviato);
  const sel = [`a.${S.colonna(t)} AS nome`, ha('codice') ? `a.${S.colonna('codice')} AS codice` : "'' AS codice", ha('barcode') ? `a.${S.colonna('barcode')} AS barcode` : "'' AS barcode", `a.${S.colonna('giacenza')} AS giacenza`];
  const righe = db.prepare(`SELECT c.articolo, c.attesa, c.contata, c.costo, ${sel.join(', ')} FROM _magazzino_conte c LEFT JOIN ${S.tabella(i.sezione)} a ON a.id = c.articolo WHERE c.inventario = ? ORDER BY nome`).all(i.id)
    .map(r => ({ articolo: r.articolo, nome: String(r.nome ?? ''), codice: r.codice || '', barcode: r.barcode || '', attesa: r.attesa, contata: r.contata, giacenza: num(r.giacenza),
      differenza: r.contata == null ? null : r.contata - r.attesa, valore: r.contata == null ? null : euro(Math.round((r.contata - r.attesa) * (r.costo || 0))) }));
  const contate = righe.filter(r => r.contata != null);
  return { ...i, righe, contate: contate.length, differenze: contate.filter(r => r.differenza).length, valoreDifferenze: euro(contate.reduce((s, r) => s + cent(r.valore), 0)) };
}
// le conte: un numero per articolo, oppure +1 (o +piu) per articolo trovato dal codice o dal codice a barre (il lettore)
export function conta(k, ctx, id, { conte = null, codice = null, piu = 1 } = {}) {
  const { db, S, P } = k, i = testa(db, id);
  if (i.chiuso) throw new Error('Questo inventario è già chiuso');
  P.verifica(ctx, i.sezione, 'modifica');
  const agg = db.prepare('UPDATE _magazzino_conte SET contata = ?, contato_da = ? WHERE inventario = ? AND articolo = ?');
  if (codice != null) {
    const def = S.leggi(db, i.sezione), campi = ['barcode', 'codice'].filter(c => def.campi.some(x => x.id === c && !x.archiviato));
    const trovato = campi.map(c => db.prepare(`SELECT id FROM ${S.tabella(i.sezione)} WHERE archiviato = 0 AND ${S.colonna(c)} = ?`).get(String(codice).trim())).find(Boolean);
    if (!trovato) throw new Error(`Nessun articolo con il codice «${codice}»`);
    const r = db.prepare('SELECT contata FROM _magazzino_conte WHERE inventario = ? AND articolo = ?').get(i.id, trovato.id);
    if (!r) throw new Error('Articolo nuovo, non presente quando è iniziato l\'inventario');
    agg.run(num(r.contata) + num(piu), ctx?.utente?.id ?? null, i.id, trovato.id);
    return { articolo: trovato.id, contata: num(r.contata) + num(piu) };
  }
  if (!Array.isArray(conte) || !conte.length) throw new Error('Nessuna conta');
  transazione(db, () => { for (const c of conte) {
    const q = c.contata === null || c.contata === '' ? null : Number(c.contata);
    if (q != null && !(q >= 0)) throw new Error('Quantità contata non valida');
    if (!agg.run(q, ctx?.utente?.id ?? null, i.id, String(c.articolo)).changes) throw new Error('Articolo non presente in questo inventario');
  } });
  return { ok: true, conte: conte.length };
}
// chiude: per ogni riga contata la giacenza si corregge della differenza fra contato e atteso (al momento dell'apertura),
// così le vendite e i carichi fatti mentre si contava restano giusti. Le righe non contate non si toccano.
export function chiudi(k, ctx, id) {
  const { db, D, P } = k, i = testa(db, id);
  if (i.chiuso) throw new Error('Questo inventario è già chiuso');
  P.verifica(ctx, i.sezione, 'modifica');
  const inv = inventario(k, ctx, id), rettifiche = inv.righe.filter(r => r.contata != null && r.differenza);
  return transazione(db, () => {
    causa = 'inventario';
    try {
      for (const r of rettifiche) { const a = D.leggi(db, i.sezione, r.articolo, ctx, { conRighe: false }); D.modifica(db, i.sezione, r.articolo, { giacenza: num(a.giacenza) + r.differenza }, ctx); }
    } finally { causa = null; }
    db.prepare('UPDATE _magazzino_inventari SET chiuso = ? WHERE id = ?').run(new Date().toISOString(), i.id);
    return { rettifiche: rettifiche.length, valore: inv.valoreDifferenze, contate: inv.contate };
  });
}

// ---------- Lumi ----------
function strumentiLumi(k) {
  const { P, db, S } = k;
  const sezioni = () => S.elenco(db).filter(e => !e.archiviata && e.campi.some(c => c.id === 'giacenza')).map(e => e.id);
  const prima = ctx => sezioni().find(e => P.puo(ctx, e, 'leggi'));
  return [
    { nome: 'magazzino_valore', tipo: 'leggi', permesso: ctx => !!prima(ctx), descrizione: 'Il valore del magazzino al costo (totale, per categoria, gli articoli che valgono di più), le giacenze negative e quanti articoli sono sotto scorta.',
      schema: { type: 'object', properties: { sezione: { type: 'string', maxLength: 64 } } },
      esegui: async ({ ctx, args }) => { const v = valore(k, ctx, args.sezione || prima(ctx)); return { ...v, articoli: v.articoli.slice(0, 30) }; } },
    { nome: 'magazzino_movimenti', tipo: 'leggi', permesso: ctx => !!prima(ctx), descrizione: 'Il registro dei movimenti di magazzino di un articolo (id) o di tutta la sezione: carichi, scarichi, rettifiche d\'inventario, con chi e quando.',
      schema: { type: 'object', properties: { sezione: { type: 'string', maxLength: 64 }, articolo: { type: 'string', maxLength: 64 } } },
      esegui: async ({ ctx, args }) => ({ movimenti: movimenti(k, ctx, { sezione: args.sezione || prima(ctx), articolo: args.articolo || null, limite: 60 }) }) },
    { nome: 'magazzino_chiudi_inventario', tipo: 'scrivi', permesso: ctx => sezioni().some(e => P.puo(ctx, e, 'modifica')),
      descrizione: 'Chiude l\'inventario fisico aperto: corregge le giacenze degli articoli contati della differenza fra contato e atteso.',
      schema: { type: 'object', required: ['inventario'], properties: { inventario: { type: 'integer', minimum: 1 } } },
      anteprima: async ({ ctx, args }) => {
        const inv = inventario(k, ctx, args.inventario);
        if (inv.chiuso) return { errore: 'Questo inventario è già chiuso' };
        const d = inv.righe.filter(r => r.differenza);
        return { titolo: `Chiudi «${inv.nome}»`, righe: [['Articoli contati', `${inv.contate} di ${inv.righe.length}`], ...d.slice(0, 30).map(r => [r.nome, `${r.differenza > 0 ? '+' : ''}${r.differenza}`]), ['Valore delle differenze', `€ ${inv.valoreDifferenze.toFixed(2)}`]],
          avvisi: inv.contate < inv.righe.length ? [`${inv.righe.length - inv.contate} articoli non contati restano come sono`] : [] };
      },
      esegui: async ({ ctx, args }) => chiudi(k, ctx, args.inventario) },
  ];
}

// ---------- rotte ----------
export default function registra(k) {
  const { r, db, S, D, P, serve, ErroreHttp } = k;
  attivaRegistro(D, S);
  const leggibile = e => { if (e?.stato || e instanceof D.ErroreDati || e instanceof P.ErrorePermesso) throw e; throw new ErroreHttp(422, e.message); };
  const prova = f => { try { return f(); } catch (e) { leggibile(e); } };
  const sezione = (ctx, q) => { serve(ctx); const s = q.get('sezione'); if (!s || !conGiacenza(S, db, s)) throw new ErroreHttp(400, 'Sezione senza giacenza'); P.verifica(ctx, s, 'leggi'); return s; };
  r('GET', '/api/magazzino/sezioni', ({ ctx }) => { serve(ctx); return S.elenco(db).filter(e => !e.archiviata && e.campi.some(c => c.id === 'giacenza' && !c.archiviato) && P.puo(ctx, e.id, 'leggi')).map(e => ({ id: e.id, nome: e.nome, modifica: P.puo(ctx, e.id, 'modifica') })); });
  r('GET', '/api/magazzino/valore', ({ ctx, q }) => prova(() => valore(k, ctx, sezione(ctx, q))));
  r('GET', '/api/magazzino/valore.csv', ({ ctx, q, res }) => {
    const v = prova(() => valore(k, ctx, sezione(ctx, q)));
    const csv = scriviCsv(['Codice', 'Articolo', 'Categoria', 'Giacenza', 'Costo', 'Valore'], v.articoli.map(a => [a.codice, a.nome, a.categoria, a.giacenza, a.costo, a.valore]));
    const b = Buffer.from(typeof csv === 'string' ? csv : csv.toString());
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': b.length, 'Content-Disposition': `attachment; filename="magazzino_${v.sezione}_${oggiIso()}.csv"`, 'Cache-Control': 'no-store' }).end(b);
  });
  r('GET', '/api/magazzino/movimenti', ({ ctx, q }) => prova(() => movimenti(k, ctx, { sezione: sezione(ctx, q), articolo: q.get('articolo'), da: q.get('da'), a: q.get('a') })));
  r('GET', '/api/magazzino/inventari', ({ ctx }) => { serve(ctx); return inventari(db).filter(i => P.puo(ctx, i.sezione, 'leggi')); });
  r('POST', '/api/magazzino/inventari', ({ ctx, corpo }) => { serve(ctx); return prova(() => nuovoInventario(k, ctx, { sezione: String(corpo.sezione || ''), nome: corpo.nome })); });
  r('GET', '/api/magazzino/inventari/:id', ({ ctx, p }) => { serve(ctx); return prova(() => inventario(k, ctx, p.id)); });
  r('POST', '/api/magazzino/inventari/:id/conta', ({ ctx, p, corpo }) => { serve(ctx); return prova(() => conta(k, ctx, p.id, { conte: corpo.conte || null, codice: corpo.codice ?? null, piu: corpo.piu ?? 1 })); });
  r('POST', '/api/magazzino/inventari/:id/chiudi', ({ ctx, p }) => { serve(ctx); return prova(() => chiudi(k, ctx, p.id)); });
  for (const s of strumentiLumi(k)) k.lumi?.strumento?.(s);
  void esiste;
}
