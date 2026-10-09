// Gli acquisti: preparazione sul negozio e su un modello senza ordini, riordino sotto scorta, ordini dalla proposta,
// ricevimenti parziali con carico e costo medio, «arrivato» a mano senza doppi carichi, confronto con la fattura, Lumi, rotte.
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
import registraAcquisti, * as Q from '../server/moduli/acquisti.js';

A.attiva();
class ErroreHttp extends Error { constructor(s, m) { super(m); this.stato = s; } }
function negozio() {
  const db = apri(); M.installa(db, 'negozio'); M.installa(db, 'fatture');
  const k = { db, S, D, P, A, meta, ErroreHttp };
  const fo = D.crea(db, 'fornitori', { nome: 'Grossista Nord srl', giorni_consegna: 5 }), fo2 = D.crea(db, 'fornitori', { nome: 'Carta e Penne snc' });
  const art = (nome, giacenza, soglia, costo, fornitore = fo.id) => D.crea(db, 'articoli', { codice: nome.slice(0, 3).toUpperCase(), nome, prezzo: costo * 2, costo, giacenza, soglia, fornitore });
  return { db, k, fo, fo2, art };
}
const giacenza = (db, id) => D.leggi(db, 'articoli', id).giacenza;

test('prepara sul negozio: usa «Ordini ai fornitori», aggiunge ricevuta, stati e fattura, e corregge l\'automazione «arrivato»', () => {
  const { k, db } = negozio();
  const p = Q.prepara(k);
  assert.equal(p.ordini, 'ordini'); assert.equal(p.righe, 'righe_ordine'); assert.equal(p.articoli, 'articoli');
  assert.ok(p.fatto.includes('righe_ordine.ricevuta') && p.fatto.includes('ordini.fattura'));
  const st = S.leggi(db, 'ordini').campi.find(c => c.id === 'stato');
  assert.ok(st.opzioni.some(o => o.id === 'parziale')); assert.ok(st.transizioni.inviato.includes('parziale'));
  assert.match(A.elenco(db).find(a => a.id === 'carico_ordine').azioni[0].aggiungi, /ricevuta/);
  assert.deepEqual(Q.prepara(k).fatto, []);   // la seconda volta non cambia niente
});

test('riordino sotto scorta, ordini dalla proposta (uno per fornitore), niente doppie proposte', () => {
  const { k, db, fo, fo2, art } = negozio(); Q.prepara(k);
  const a1 = art('Quaderno A4', 2, 10, 1.5), a2 = art('Penna blu', 0, 20, 0.4, fo2.id); art('Gomma', 30, 10, 0.3); art('Matita', 1, 0, 0.2);
  const r = Q.riordino(k, null);
  assert.deepEqual(r.gruppi.map(g => [g.fornitore.nome, g.righe.map(x => [x.articolo.nome, x.proposta])]), [['Carta e Penne snc', [['Penna blu', 40]]], ['Grossista Nord srl', [['Quaderno A4', 18]]]]);
  assert.equal(r.gruppi[1].totale, 27);
  const ordini = Q.creaOrdini(k, null, r.gruppi.flatMap(g => g.righe.map(x => ({ articolo: x.articolo.id, quantita: x.proposta }))), { oggi: '2026-10-09' });
  assert.equal(ordini.length, 2);
  const o1 = D.leggi(db, 'ordini', ordini.find(o => o.fornitore === 'Grossista Nord srl').id);
  assert.equal(o1.stato, 'bozza'); assert.equal(o1.consegna_prevista, '2026-10-14'); assert.equal(o1.righe[0].costo, 1.5); assert.match(o1.numero, /^OF-\d{4}-\d{3}$/);
  assert.equal(Q.riordino(k, null).gruppi.length, 0);   // già ordinati: non si ripropongono
  assert.throws(() => Q.creaOrdini(k, null, [{ articolo: art('Senza', 0, 5, 1, null).id, quantita: 3 }]), /Manca il fornitore/);
  void a1; void a2; void fo;
});

test('ricevimenti parziali: carico, costo medio ponderato, «arrivato in parte», poi «arrivato» senza doppio carico', () => {
  const { k, db, fo, art } = negozio(); Q.prepara(k);
  const a = art('Quaderno A4', 10, 5, 1);
  const o = D.crea(db, 'ordini', { fornitore: fo.id, stato: 'bozza', righe: [{ articolo: a.id, quantita: 30, costo: 2 }] });
  const riga = D.leggi(db, 'ordini', o.id).righe[0].id;
  assert.throws(() => Q.ricevi(k, null, o.id, { righe: [{ riga, quantita: 31 }] }), /ne mancano 30/);
  const x = Q.ricevi(k, null, o.id, { righe: [{ riga, quantita: 10 }], data: '2026-10-09', ddt: 'DDT 77' });
  assert.equal(x.stato, 'parziale'); assert.equal(giacenza(db, a.id), 20);
  assert.equal(D.leggi(db, 'articoli', a.id).costo, 1.5);   // (10 × 1 + 10 × 2) / 20
  assert.equal(D.leggi(db, 'ordini', o.id).stato, 'parziale'); assert.equal(D.leggi(db, 'ordini', o.id).ddt, 'DDT 77');
  assert.equal(Q.inArrivo(k, null)[0].manca, 20);
  Q.ricevi(k, null, o.id, { ddt: 'DDT 81' });   // il resto
  assert.equal(giacenza(db, a.id), 40); assert.equal(D.leggi(db, 'ordini', o.id).stato, 'arrivato');   // l'automazione non ricarica
  assert.equal(Q.ricevimenti(db, o.id).length, 2);
  assert.throws(() => Q.ricevi(k, null, o.id), /già arrivato/);
  // «arrivato» messo a mano dopo un ricevimento parziale: l'automazione carica solo il resto
  const o2 = D.crea(db, 'ordini', { fornitore: fo.id, stato: 'bozza', righe: [{ articolo: a.id, quantita: 8, costo: 1.5 }] });
  Q.ricevi(k, null, o2.id, { righe: [{ riga: D.leggi(db, 'ordini', o2.id).righe[0].id, quantita: 3 }] });
  assert.equal(giacenza(db, a.id), 43);
  D.modifica(db, 'ordini', o2.id, { stato: 'arrivato' });
  assert.equal(giacenza(db, a.id), 48);
  // e un ordine arrivato tutto a mano carica tutto, come prima
  const o3 = D.crea(db, 'ordini', { fornitore: fo.id, stato: 'inviato', righe: [{ articolo: a.id, quantita: 2, costo: 1.5 }] });
  D.modifica(db, 'ordini', o3.id, { stato: 'arrivato' });
  assert.equal(giacenza(db, a.id), 50);
});

test('confronto ordinato / ricevuto / fatturato e abbinamento con la fattura del fornitore', () => {
  const { k, db, fo, fo2, art } = negozio(); Q.prepara(k);
  const a = art('Quaderno A4', 0, 5, 1);
  const o = D.crea(db, 'ordini', { fornitore: fo.id, data: '2026-10-01', stato: 'inviato', righe: [{ articolo: a.id, quantita: 100, costo: 2 }] });
  Q.ricevi(k, null, o.id, { righe: [{ riga: D.leggi(db, 'ordini', o.id).righe[0].id, quantita: 60 }] });
  const giusta = D.crea(db, 'fatture_ricevute', { fornitore: fo.id, numero: 'A/55', data: '2026-10-05', imponibile: 120.5, totale: 147.01 });
  D.crea(db, 'fatture_ricevute', { fornitore: fo.id, numero: 'A/56', data: '2026-10-06', imponibile: 300, totale: 366 });
  const altra = D.crea(db, 'fatture_ricevute', { fornitore: fo2.id, numero: '9', data: '2026-10-05', imponibile: 120, totale: 146.4 });
  const c = Q.confronto(k, null, o.id);
  assert.deepEqual([c.ordinato, c.ricevuto, c.da_ricevere], [200, 120, 80]);
  assert.equal(c.candidate[0].id, giusta.id); assert.equal(c.candidate[0].differenza, 0.5); assert.equal(c.candidate[0].torna, true); assert.equal(c.candidate[1].torna, false);
  assert.equal(Q.daFatturare(k, null)[0].candidata.id, giusta.id);
  assert.throws(() => Q.abbinaFattura(k, null, o.id, altra.id), /non è del fornitore/);
  Q.abbinaFattura(k, null, o.id, giusta.id);
  assert.equal(Q.confronto(k, null, o.id).fattura.numero, 'A/55'); assert.equal(Q.daFatturare(k, null).length, 0);
});

test('un modello senza ordini (laboratorio): crea fornitori, ordini e righe sui materiali', () => {
  const db = apri(); M.installa(db, 'laboratorio');
  const k = { db, S, D, P, A, meta, ErroreHttp };
  const p = Q.prepara(k);
  assert.equal(p.articoli, 'materiali'); assert.ok(p.fatto.includes('fornitori') && p.fatto.includes('ordini'));
  assert.equal(S.leggi(db, 'righe_ordine').campi.find(c => c.id === 'articolo').entita, 'materiali');
  const fo = D.crea(db, 'fornitori', { nome: 'Legnami Rossi' });
  const m = D.crea(db, 'materiali', { nome: 'Rovere 2 cm', giacenza: 1, soglia: 4, costo: 30 });
  assert.equal(Q.riordino(k, null).gruppi[0].fornitore, null);   // i materiali non hanno il fornitore: lo si sceglie
  const [o] = Q.creaOrdini(k, null, [{ articolo: m.id, quantita: 7, fornitore: fo.id }]);
  Q.ricevi(k, null, o.id);
  assert.equal(D.leggi(db, 'materiali', m.id).giacenza, 8); assert.equal(D.leggi(db, 'ordini', o.id).stato, 'arrivato');
});

test('strumenti di Lumi e rotte', async () => {
  const strumenti = [];
  const { k, art, fo } = negozio(); Q.prepara(k);
  registraAcquisti({ ...k, r: () => {}, serve: x => x, lumi: { strumento: s => strumenti.push(s), istruzioni: () => {} } });
  assert.deepEqual(strumenti.map(s => s.nome), ['acquisti_riordino', 'acquisti_in_arrivo', 'acquisti_crea_ordini', 'acquisti_ricevi']);
  art('Quaderno A4', 1, 10, 1.5);
  const prendi = n => strumenti.find(s => s.nome === n);
  const a = await prendi('acquisti_crea_ordini').anteprima({ ctx: null, args: {} });
  assert.equal(a.titolo, 'Crea gli ordini ai fornitori'); assert.deepEqual(a.righe[0], ['Quaderno A4', '19 · Grossista Nord srl']);
  const { ordini } = await prendi('acquisti_crea_ordini').esegui({ ctx: null, args: {} });
  D.modifica(k.db, 'ordini', ordini[0].id, { stato: 'inviato' });
  const arr = await prendi('acquisti_in_arrivo').esegui({ ctx: null });
  assert.equal(arr.ordini[0].manca, 19);
  const v = await prendi('acquisti_ricevi').anteprima({ ctx: null, args: { numero: ordini[0].numero, ddt: 'DDT 5' } });
  assert.ok(v.righe.some(r => r[1] === '+19'));
  await prendi('acquisti_ricevi').esegui({ ctx: null, args: { numero: ordini[0].numero } });
  assert.equal(D.leggi(k.db, 'ordini', ordini[0].id).stato, 'arrivato');
  void fo;

  const cartella = mkdtempSync(join(tmpdir(), 'lumi-acquisti-')), db = apri(join(cartella, 'lumi.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Bottega Esempio', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio'] })).stato, 200);
    assert.equal((await chiama('GET', '/api/acquisti/riordino')).stato, 422);   // non ancora pronti
    assert.equal((await chiama('GET', '/api/acquisti/impostazioni')).json.articoliProposti, 'articoli');
    assert.equal((await chiama('POST', '/api/acquisti/prepara', {})).stato, 200);
    const f = (await chiama('POST', '/api/dati/fornitori', { nome: 'Grossista Nord srl' })).json;
    await chiama('POST', '/api/dati/articoli', { nome: 'Quaderno', giacenza: 0, soglia: 3, costo: 1, fornitore: f.id });
    const r = (await chiama('GET', '/api/acquisti/riordino')).json;
    assert.equal(r.gruppi[0].righe[0].proposta, 6);
    const o = (await chiama('POST', '/api/acquisti/ordini', { righe: [{ articolo: r.gruppi[0].righe[0].articolo.id, quantita: 6 }] })).json;
    assert.equal((await chiama('POST', `/api/acquisti/ordini/${o[0].id}/ricevi`, { ddt: 'DDT 1' })).json.stato, 'arrivato');
    assert.equal((await chiama('GET', `/api/acquisti/ordini/${o[0].id}/confronto`)).json.ricevuto, 6);
    assert.equal((await chiama('POST', `/api/acquisti/ordini/${o[0].id}/ricevi`, {})).stato, 422);
    assert.ok((await chiama('GET', '/api/lumi/strumenti')).json.strumenti.some(s => s.nome === 'acquisti_ricevi'));
  } finally { srv.close(); }
});

test('verifica: «arrivato» a mano carica il resto e lo segna ricevuto (anche dopo un ricevimento parziale)', async () => {
  const { db, k, art } = negozio(); Q.prepara(k);
  registraAcquisti({ ...k, r: () => {}, serve: x => x, lumi: { strumento: () => {}, istruzioni: () => {} } });
  const a = art('Gomma', 0, 2, 1), b = art('Righello', 0, 2, 1);
  const [o] = Q.creaOrdini(k, null, [{ articolo: a.id, quantita: 4 }]); D.modifica(db, 'ordini', o.id, { stato: 'inviato' });
  D.modifica(db, 'ordini', o.id, { stato: 'arrivato' }); await Promise.resolve();
  assert.equal(giacenza(db, a.id), 4); assert.equal(Q.confronto(k, null, o.id).ricevuto, 4);
  const [o2] = Q.creaOrdini(k, null, [{ articolo: b.id, quantita: 10 }]); D.modifica(db, 'ordini', o2.id, { stato: 'inviato' });
  Q.ricevi(k, null, o2.id, { righe: [{ riga: D.leggi(db, 'ordini', o2.id).righe[0].id, quantita: 4 }] });
  D.modifica(db, 'ordini', o2.id, { stato: 'arrivato' }); await Promise.resolve();
  assert.equal(giacenza(db, b.id), 10); assert.equal(Q.confronto(k, null, o2.id).ricevuto, 10);
  D.modifica(db, 'ordini', o2.id, { stato: 'arrivato', ddt: 'DDT 7' }); await Promise.resolve(); assert.equal(giacenza(db, b.id), 10);
});
