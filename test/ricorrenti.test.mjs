// I contratti ricorrenti: periodi arretrati, fatture in bozza o emesse, fine del contratto, previsione di cassa, Lumi, rotte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apri, meta } from '../server/db.js';
import * as S from '../server/schema.js';
import * as D from '../server/dati.js';
import * as P from '../server/permessi.js';
import * as M from '../server/modelli.js';
import { creaServer } from '../server/api.js';
import registraRicorrenti, * as C from '../server/moduli/ricorrenti.js';
import * as T from '../server/moduli/tesoreria.js';
import { attivaFatture, completaClienti } from '../server/moduli/documenti.js';

attivaFatture(D);
class ErroreHttp extends Error { constructor(s, m) { super(m); this.stato = s; } }
function gestionale() {
  const db = apri(); M.installa(db, 'fatture'); completaClienti(db, S);
  const k = { db, S, D, P, meta, ErroreHttp };
  C.prepara(k);
  const cl = D.crea(db, 'clienti', { nome: 'Condominio Aurora', codice_destinatario: '0000000' });
  return { db, k, cl };
}

test('periodi dovuti: arretrati fino a oggi, fine contratto, sospesi fuori', () => {
  assert.deepEqual(C.periodi({ stato: 'attivo', periodicita: 'trimestrale', prossima: '2026-04-01' }, '2026-10-09').map(p => [p.da, p.a]), [['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30'], ['2026-10-01', '2026-12-31']]);
  assert.equal(C.periodi({ stato: 'attivo', periodicita: 'mensile', prossima: '2026-01-31', fino_al: '2026-03-31' }, '2026-10-09').length, 3);
  assert.deepEqual(C.periodi({ stato: 'sospeso', periodicita: 'mensile', prossima: '2026-01-01' }, '2026-10-09'), []);
  assert.equal(C.periodi({ stato: 'attivo', periodicita: 'mensile', prossima: '2020-01-01' }, '2026-10-09').length, 24);   // al massimo 24
});

test('genera: una fattura per periodo arretrato, poi la data va avanti; emesse con il numero; alla fine il contratto si chiude', () => {
  const { db, k, cl } = gestionale();
  const c1 = D.crea(db, C.CONTRATTI, { cliente: cl.id, descrizione: 'Manutenzione ascensore', importo: 150, periodicita: 'mensile', prossima: '2026-09-01' });
  const c2 = D.crea(db, C.CONTRATTI, { cliente: cl.id, descrizione: 'Canone software', importo: 600, periodicita: 'annuale', prossima: '2026-10-01', fino_al: '2026-12-31', emetti: 'emessa' });
  assert.equal(C.dovuti(k, null, { oggi: '2026-10-09' }).reduce((s, c) => s + c.periodi.length, 0), 3);
  const g = C.genera(k, null, { oggi: '2026-10-09' });
  assert.equal(g.fatte.length, 3);
  const fatture = D.elenca(db, 'fatture', { perPagina: 50 }).righe;
  const mie = g.fatte.filter(x => x.contratto === c1.id), f1 = D.leggi(db, 'fatture', mie[0].fattura);
  assert.equal(f1.stato, 'bozza'); assert.equal(f1.data, '2026-09-01'); assert.match(f1.righe[0].descrizione, /Manutenzione ascensore - periodo dal 01\/09\/2026 al 30\/09\/2026/);
  assert.equal(f1.riferimento, `Contratto ${D.leggi(db, C.CONTRATTI, c1.id).numero}`);
  const emessa = fatture.find(f => f.stato === 'emessa'); assert.ok(emessa.numero);
  assert.equal(D.leggi(db, C.CONTRATTI, c1.id).prossima, '2026-11-01'); assert.equal(D.leggi(db, C.CONTRATTI, c1.id).stato, 'attivo');
  assert.equal(D.leggi(db, C.CONTRATTI, c2.id).stato, 'chiuso');   // il prossimo periodo cade dopo «fino al»
  assert.equal(C.genera(k, null, { oggi: '2026-10-09' }).fatte.length, 0);   // la seconda volta niente
  assert.equal(D.leggi(db, C.CONTRATTI, c1.id).ultima_fattura.id, mie[1].fattura);
});

test('previsione di cassa: le fatture future dei contratti entrano come incassi, IVA compresa', async () => {
  const { db, k, cl } = gestionale();
  D.crea(db, C.CONTRATTI, { cliente: cl.id, descrizione: 'Pulizie', importo: 100, periodicita: 'mensile', prossima: '2026-11-01' });
  const p = await T.previsioneCassa(k, null, { passo: 'mese', periodi: 3, oggi: '2026-10-09' });
  assert.deepEqual(p.periodi.map(x => x.entrate), [0, 122, 122]);
  assert.ok(p.voci.every(v => v.tipo === 'contratto'));
  assert.throws(() => C.prepara({ db: apri(), S, D, P, meta }), /modello «Fatture/);
});

test('strumenti di Lumi e rotte', async () => {
  const strumenti = [];
  const { db, k, cl } = gestionale();
  registraRicorrenti({ ...k, r: () => {}, serve: x => x, lumi: { strumento: s => strumenti.push(s) } });
  assert.deepEqual(strumenti.map(s => s.nome), ['ricorrenti_dovuti', 'ricorrenti_genera']);
  D.crea(db, C.CONTRATTI, { cliente: cl.id, descrizione: 'Canone', importo: 50, periodicita: 'mensile', prossima: '2026-01-01', fino_al: '2026-02-28' });
  const a = await strumenti[1].anteprima({ ctx: null, args: {} });
  assert.equal(a.righe.length, 2); assert.match(a.righe[0][1], /bozza/);
  assert.equal((await strumenti[1].esegui({ ctx: null, args: {} })).fatte.length, 2);
  assert.equal((await strumenti[1].anteprima({ ctx: null, args: {} })).errore, 'Nessuna fattura dovuta adesso');

  const cartella = mkdtempSync(join(tmpdir(), 'kubo-ricorrenti-')), db2 = apri(join(cartella, 'kubo.db'));
  const srv = creaServer(db2); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Studio Esempio', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['fatture'] })).stato, 200);
    assert.equal((await chiama('GET', '/api/ricorrenti/impostazioni')).json.pronti, false);
    assert.deepEqual((await chiama('POST', '/api/ricorrenti/prepara')).json.fatto, [C.CONTRATTI]);
    const c = (await chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl' })).json;
    await chiama('POST', `/api/dati/${C.CONTRATTI}`, { cliente: c.id, descrizione: 'Assistenza', importo: 80, periodicita: 'mensile', prossima: '2026-01-15', fino_al: '2026-03-15' });
    assert.equal((await chiama('GET', '/api/ricorrenti/dovuti')).json[0].periodi.length, 3);
    assert.equal((await chiama('POST', '/api/ricorrenti/genera', {})).json.fatte.length, 3);
    assert.equal((await chiama('PUT', '/api/ricorrenti/impostazioni', { automatico: true })).json.automatico, true);
  } finally { srv.close(); }
});
