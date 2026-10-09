import { pathToFileURL } from 'node:url';
// Prova di carico (non fa parte di npm test): 50.000 articoli, 50.000 vendite con 200.000 righe, 10 persone collegate.
//   node test/carico.mjs                       questo ramo
//   node test/carico.mjs --radice ../altro     un'altra copia di Lumi (per esempio main, per il «prima»)
//   LUMI_SENZA_SQL=1 node test/carico.mjs      questo ramo senza il percorso SQL dei calcolati e senza indici
// Stampa per ogni prova il tempo di una richiesta da sola (mediana di 5) e con 10 persone insieme (la più lenta di 10).
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

const arg = process.argv.slice(2), radice = resolve(arg.includes('--radice') ? arg[arg.indexOf('--radice') + 1] : join(import.meta.dirname, '..'));
const ARTICOLI = Number(process.env.ARTICOLI || 50000), VENDITE = Number(process.env.VENDITE || 50000), RIGHE_PER = 4, PERSONE = 10;
const { apri, nuovoId } = await import(pathToFileURL(join(radice, 'server/db.js')).href);
const { creaServer } = await import(pathToFileURL(join(radice, 'server/api.js')).href);
const { attiva } = await import(pathToFileURL(join(radice, 'server/automazioni.js')).href);
attiva();

const cartella = mkdtempSync(join(tmpdir(), 'lumi-carico-')), db = apri(join(cartella, 'lumi.db'));
const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
async function chiama(metodo, percorso, corpo, biscotto) {
  const r = await fetch(base + percorso, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) } });
  const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`${percorso}: ${r.status} ${JSON.stringify(j)}`);
  return { j, biscotto: r.headers.get('set-cookie')?.split(';')[0] };
}
const t0 = performance.now();
const { biscotto: titolare } = await chiama('POST', '/api/configura', { azienda: 'Carico', nome: 'Titolare', email: 't@carico.it', password: 'password-carico-1', modelli: ['negozio'] });

// ---------- i dati, direttamente in SQL (con D.crea ci vorrebbero minuti) ----------
const giorno = i => new Date(Date.UTC(2025, 0, 1) + (i % 640) * 864e5).toISOString().slice(0, 10);
db.exec('BEGIN');
const ora = new Date().toISOString(), cat = JSON.parse(db.prepare("SELECT def FROM _entita WHERE id = 'articoli'").get().def).campi.find(c => c.id === 'categoria')?.opzioni?.map(o => o.id) || [null];
const ia = db.prepare('INSERT INTO d_articoli (id, creato, modificato, archiviato, c_codice, c_nome, c_categoria, c_prezzo, c_costo, c_iva, c_giacenza, c_soglia) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 22, ?, ?)');
const arts = [];
for (let i = 0; i < ARTICOLI; i++) { const id = nuovoId(); arts.push(id); ia.run(id, ora, ora, `A${String(i).padStart(6, '0')}`, `Articolo ${i} ${['vaso', 'piatto', 'tazza', 'ciotola', 'lampada'][i % 5]}`, cat[i % cat.length], 500 + (i * 37) % 20000, 200 + (i * 13) % 9000, (i * 7) % 40, (i * 3) % 12); }
const iv = db.prepare("INSERT INTO d_vendite (id, creato, modificato, archiviato, c_numero, c_data, c_stato, c_pagamento) VALUES (?, ?, ?, 0, ?, ?, ?, 'carta')");
const ir = db.prepare('INSERT INTO d_righe_vendita (id, creato, modificato, archiviato, c_vendita, c_articolo, c_quantita, c_prezzo, c_sconto) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)');
for (let i = 0; i < VENDITE; i++) {
  const id = nuovoId(), g = giorno(i), quando = g + 'T10:00:00.000Z'; iv.run(id, quando, quando, `V-${i}`, g, ['pagata', 'pagata', 'aperta', 'annullata'][i % 4]);
  for (let k = 0; k < RIGHE_PER; k++) ir.run(nuovoId(), quando, quando, id, arts[(i * 7 + k) % ARTICOLI], 1 + ((i + k) % 3), 300 + ((i * 11 + k) % 5000), (k % 2) * 10);
}
db.exec('COMMIT');
console.log(`dati pronti in ${Math.round(performance.now() - t0)} ms: ${ARTICOLI} articoli, ${VENDITE} vendite, ${VENDITE * RIGHE_PER} righe`);

const persone = [titolare];
for (let i = 1; i < PERSONE; i++) {
  await chiama('POST', '/api/utenti', { nome: `Persona ${i}`, email: `p${i}@carico.it`, password: `password-persona-${i}`, ruolo: 'collaboratore' }, titolare);
  persone.push((await chiama('POST', '/api/accedi', { email: `p${i}@carico.it`, password: `password-persona-${i}` })).biscotto);
}

const f = x => encodeURIComponent(JSON.stringify(x));
const prove = [
  ['lista articoli (pagina 1)', 'GET', '/api/dati/articoli'],
  ['lista articoli, pagina 500', 'GET', '/api/dati/articoli?p=500'],
  ['ricerca «tazza 12»', 'GET', '/api/dati/articoli?q=' + encodeURIComponent('tazza 12')],
  ['filtro calcolato: da riordinare', 'GET', '/api/dati/articoli?f=' + f([{ campo: 'da_riordinare', op: '=', valore: true }])],
  ['vendite per totale (calcolato)', 'GET', '/api/dati/vendite?o=totale:desc'],
  ['filtro calcolato: totale > 100 €', 'GET', '/api/dati/vendite?f=' + f([{ campo: 'totale', op: '>', valore: 100 }])],
  ['aggregato: incassi per mese, un anno', 'POST', '/api/aggregati', { entita: 'vendite', misura: 'somma', campo: 'totale', per: 'mese', da: '2025-01-01', a: '2025-12-31', filtri: [{ campo: 'stato', op: '=', valore: 'pagata' }] }],
  ['cruscotto completo', 'GET', '/api/cruscotto'],
  ['Lumi riepilogo: venduto nel 2025', 'POST', '/api/lumi/riepilogo', { entita: 'vendite', dal: '2025-01-01', al: '2025-12-31', somma: ['totale'], raggruppa: 'stato' }],
];
const risultati = [];
for (const [nome, metodo, percorso, corpo] of prove) {
  let esito = '';
  const una = async b => { const t = performance.now(); try { const r = await chiama(metodo, percorso, corpo, b); esito ||= r.j?.totale != null ? `totale ${r.j.totale}` : r.j?.conteggio != null ? `conteggio ${r.j.conteggio}` : ''; } catch (e) { esito = 'ERRORE ' + e.message.slice(0, 80); } return performance.now() - t; };
  const sole = []; for (let i = 0; i < 5; i++) sole.push(await una(titolare));
  const insieme = await Promise.all(persone.map(b => una(b)));
  sole.sort((a, b) => a - b);
  risultati.push({ prova: nome, 'sola (ms)': Math.round(sole[2]), '10 insieme, la più lenta (ms)': Math.round(Math.max(...insieme)), esito });
}
console.table(risultati);
// il cruscotto widget per widget (per capire dove va il tempo)
const cr = (await chiama('GET', '/api/cruscotto', null, titolare)).j, widget = [];
for (const w of cr.widget) { const t = performance.now(); await chiama('POST', '/api/cruscotto/anteprima', w, titolare).catch(() => null); widget.push({ widget: w.titolo, tipo: w.tipo, ms: Math.round(performance.now() - t) }); }
console.table(widget);
srv.close(); db.close(); rmSync(cartella, { recursive: true, force: true });
process.exit(0);
