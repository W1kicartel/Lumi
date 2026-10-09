// Il magazzino: registro dei movimenti da ogni strada, valore al costo, inventario con conte (anche col lettore) e rettifiche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apri, meta } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as P from '../server/permessi.js';
import * as A from '../server/automazioni.js';
import * as M from '../server/modelli.js';
import { creaServer } from '../server/api.js';
import registraMagazzino, * as G from '../server/moduli/magazzino.js';

A.attiva(); G.attivaRegistro(D, S);
class ErroreHttp extends Error { constructor(s, m) { super(m); this.stato = s; } }
function negozio() {
  const db = apri(); M.installa(db, 'negozio');
  const k = { db, S, D, P, A, meta, ErroreHttp };
  const art = (nome, giacenza, costo, extra = {}) => D.crea(db, 'articoli', { nome, giacenza, soglia: 5, costo, prezzo: costo * 2, ...extra });
  return { db, k, art };
}

test('registro dei movimenti: giacenza iniziale, modifica a mano, scarico da una vendita (automazione)', () => {
  const { db, k, art } = negozio();
  const a = art('Quaderno A4', 10, 1.5);
  D.modifica(db, 'articoli', a.id, { giacenza: 12 });
  D.modifica(db, 'articoli', a.id, { prezzo: 4 });   // nessun movimento: la giacenza non cambia
  const v = D.crea(db, 'vendite', { stato: 'aperta', righe: [{ articolo: a.id, quantita: 3, prezzo: 3 }] });
  D.modifica(db, 'vendite', v.id, { stato: 'pagata' });
  const m = G.movimenti(k, null, { sezione: 'articoli', articolo: a.id });
  assert.deepEqual(m.map(x => [x.quantita, x.giacenza, x.origine]).reverse(), [[10, 10, 'iniziale'], [2, 12, 'modifica'], [-3, 9, 'automazione']]);
  assert.equal(m[0].nome, 'Quaderno A4');
});

test('valore del magazzino al costo, per categoria, con negativi e articoli senza costo', () => {
  const { k, art } = negozio();
  art('Quaderno', 10, 1.5, { categoria: 'generale' }); art('Penna', 100, 0.4, { categoria: 'generale' }); art('Zaino', 2, 20);
  art('Gomma', -3, 0.3); art('Omaggio', 4, 0);
  const v = G.valore(k, null, 'articoli');
  assert.equal(v.totale, 95); assert.equal(v.pezzi, 116); assert.equal(v.senzaCosto, 1); assert.deepEqual(v.negativi.map(x => x.nome), ['Gomma']);
  assert.deepEqual(v.categorie.map(c => [c.categoria, c.valore]).slice(0, 2), [['Generale', 55], ['', 40]]);
  assert.throws(() => G.valore(k, null, 'clienti'), /senza giacenza/);
});

test('inventario: apertura, conte a mano e col lettore, chiusura con le rettifiche che rispettano le vendite fatte nel frattempo', () => {
  const { db, k, art } = negozio();
  const a = art('Quaderno', 10, 2, { barcode: '8001234567890' }), b = art('Penna', 50, 0.5, { codice: 'PEN' }), c = art('Zaino', 3, 20);
  const { id } = G.nuovoInventario(k, null, { sezione: 'articoli' });
  assert.throws(() => G.nuovoInventario(k, null, { sezione: 'articoli' }), /già un inventario aperto/);
  G.conta(k, null, id, { codice: '8001234567890' }); G.conta(k, null, id, { codice: '8001234567890' });
  G.conta(k, null, id, { codice: '8001234567890', piu: 6 });   // 8 quaderni letti
  G.conta(k, null, id, { conte: [{ articolo: b.id, contata: 52 }] });
  assert.throws(() => G.conta(k, null, id, { codice: 'NIENTE' }), /Nessun articolo/);
  assert.throws(() => G.conta(k, null, id, { conte: [{ articolo: b.id, contata: -1 }] }), /non valida/);
  // mentre si conta, si vende un quaderno
  D.modifica(db, 'articoli', a.id, { giacenza: 9 });
  const inv = G.inventario(k, null, id);
  assert.equal(inv.contate, 2); assert.equal(inv.differenze, 2); assert.equal(inv.valoreDifferenze, -3);   // −2 × 2 € + 2 × 0,50 €
  const x = G.chiudi(k, null, id);
  assert.deepEqual([x.rettifiche, x.valore], [2, -3]);
  assert.equal(D.leggi(db, 'articoli', a.id).giacenza, 7);   // 9 − 2: la vendita resta
  assert.equal(D.leggi(db, 'articoli', b.id).giacenza, 52); assert.equal(D.leggi(db, 'articoli', c.id).giacenza, 3);   // lo zaino non contato non si tocca
  assert.equal(G.movimenti(k, null, { sezione: 'articoli', articolo: a.id })[0].origine, 'inventario');
  assert.throws(() => G.chiudi(k, null, id), /già chiuso/);
  assert.equal(G.inventari(db)[0].contate, 2);
});

test('strumenti di Lumi e rotte, con i permessi', async () => {
  const strumenti = [];
  const { k, art } = negozio();
  registraMagazzino({ ...k, r: () => {}, serve: x => x, lumi: { strumento: s => strumenti.push(s) } });
  assert.deepEqual(strumenti.map(s => s.nome), ['magazzino_valore', 'magazzino_movimenti', 'magazzino_chiudi_inventario']);
  art('Quaderno', 10, 2);
  assert.equal((await strumenti[0].esegui({ ctx: null, args: {} })).totale, 20);
  const { id } = G.nuovoInventario(k, null, { sezione: 'articoli' });
  const a = await strumenti[2].anteprima({ ctx: null, args: { inventario: id } });
  assert.ok(a.avvisi[0].includes('non contati'));

  const cartella = mkdtempSync(join(tmpdir(), 'lumi-magazzino-')), db = apri(join(cartella, 'lumi.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { json = null; }
    return { stato: r.status, tipo: r.headers.get('content-type'), json, testo: t };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Bottega Esempio', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio'] })).stato, 200);
    assert.deepEqual((await chiama('GET', '/api/magazzino/sezioni')).json.map(s => s.id), ['articoli']);
    const x = (await chiama('POST', '/api/dati/articoli', { nome: 'Quaderno', giacenza: 4, costo: 2.5, barcode: '123' })).json;
    assert.equal((await chiama('GET', '/api/magazzino/valore?sezione=articoli')).json.totale, 10);
    assert.match((await chiama('GET', '/api/magazzino/valore.csv?sezione=articoli')).testo, /Quaderno/);
    assert.equal((await chiama('GET', '/api/magazzino/valore?sezione=clienti')).stato, 400);
    const inv = (await chiama('POST', '/api/magazzino/inventari', { sezione: 'articoli' })).json;
    assert.equal((await chiama('POST', `/api/magazzino/inventari/${inv.id}/conta`, { codice: '123', piu: 5 })).json.contata, 5);
    assert.equal((await chiama('POST', `/api/magazzino/inventari/${inv.id}/chiudi`)).json.rettifiche, 1);
    const m = (await chiama('GET', `/api/magazzino/movimenti?sezione=articoli&articolo=${x.id}`)).json;
    assert.deepEqual(m.map(y => [y.quantita, y.origine, y.utente]), [[1, 'inventario', 'Titolare'], [4, 'iniziale', 'Titolare']]);
    // chi non vede gli articoli non vede il magazzino
    assert.equal((await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { clienti: { leggi: true } } })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Banco', email: 'b@prova.it', password: 'password-lunga-1', ruolo: 'banco' })).stato, 200);
    biscotto = ''; assert.equal((await chiama('POST', '/api/accedi', { email: 'b@prova.it', password: 'password-lunga-1' })).stato, 200);
    assert.deepEqual((await chiama('GET', '/api/magazzino/sezioni')).json, []);
    assert.equal((await chiama('GET', '/api/magazzino/valore?sezione=articoli')).stato, 403);
  } finally { srv.close(); }
});

import * as Q from '../server/moduli/acquisti.js';
test('verifica: vendita fra apertura e conta tolta una volta sola, costo nascosto nell\'inventario, ricevimenti con righe doppie o costo in sola lettura', () => {
  const { db, k } = negozio();
  const fo = D.crea(db, 'fornitori', { nome: 'Grossista' });
  const a = D.crea(db, 'articoli', { codice: 'QUA', nome: 'Quaderno', prezzo: 2, costo: 1, giacenza: 10, soglia: 2, fornitore: fo.id });
  const b = D.crea(db, 'articoli', { codice: 'PEN', barcode: '8001', nome: 'Penna', prezzo: 2, costo: 1, giacenza: 5, soglia: 2, fornitore: fo.id });
  const { id } = G.nuovoInventario(k, null, { sezione: 'articoli' });
  // venduti un quaderno e una penna dopo l'apertura e prima della conta: sullo scaffale sono già 9 e 4
  const v = D.crea(db, 'vendite', { stato: 'aperta', righe: [{ articolo: a.id, quantita: 1, prezzo: 2 }, { articolo: b.id, quantita: 1, prezzo: 2 }] }); D.modifica(db, 'vendite', v.id, { stato: 'pagata' });
  G.conta(k, null, id, { conte: [{ articolo: a.id, contata: 9 }] });
  for (let n = 0; n < 4; n++) G.conta(k, null, id, { codice: '8001' });
  // il ruolo che non vede il costo non lo vede nemmeno nell'inventario
  const banco = { utente: { id: 'u1' }, r: { id: 'banco', entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { leggi: true, crea: true, modifica: true, campi: { costo: 'nascosto' } } } } };
  const inv = G.inventario(k, banco, id); assert.equal(inv.righe[0].costo, null); assert.equal(inv.valoreDifferenze, null);
  G.chiudi(k, null, id);
  assert.equal(D.leggi(db, 'articoli', a.id).giacenza, 9); assert.equal(D.leggi(db, 'articoli', b.id).giacenza, 4);
  // ricevimento: la stessa riga due volte non carica il doppio
  Q.prepara(k);
  const [o] = Q.creaOrdini(k, null, [{ articolo: a.id, quantita: 5 }]); D.modifica(db, 'ordini', o.id, { stato: 'inviato' });
  const riga = D.leggi(db, 'ordini', o.id).righe[0].id;
  assert.throws(() => Q.ricevi(k, null, o.id, { righe: [{ riga, quantita: 3 }, { riga, quantita: 3 }] }), /più volte/);
  assert.equal(D.leggi(db, 'articoli', a.id).giacenza, 9);
  // chi ha il costo in sola lettura riceve lo stesso (il costo medio lo calcola il sistema)
  D.modifica(db, 'righe_ordine', riga, { costo: 3 });
  const mag = { utente: { id: 'u1' }, r: { id: 'magazziniere', entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { leggi: true, crea: true, modifica: true, campi: { costo: 'lettura' } } } } };
  Q.ricevi(k, mag, o.id);
  const dopo = D.leggi(db, 'articoli', a.id); assert.equal(dopo.giacenza, 14); assert.equal(dopo.costo, Math.round((100 * 9 + 300 * 5) / 14) / 100);
});
