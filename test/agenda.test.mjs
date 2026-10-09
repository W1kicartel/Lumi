import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apri } from '../server/db.js';
import * as D from '../server/dati.js';
import * as M from '../server/modelli.js';
import * as P from '../server/permessi.js';
import { attiva } from '../server/automazioni.js';
import { creaServer } from '../server/api.js';
import { aggrega, mezzanotte, giornoDi, periodo, risolviFiltri, chiaviFra } from '../server/moduli/agenda-aggregati.js';
import { predefinito } from '../server/moduli/agenda.js';
import * as S from '../server/schema.js';
import * as U from '../server/auth.js';

attiva();
const studio = () => {
  const db = apri(); M.installa(db, 'studio');
  const cli = D.crea(db, 'clienti', { nome: 'Anna' }), srv = D.crea(db, 'servizi', { nome: 'Pulizia', durata: 45, prezzo: 60 });
  const app = (quando, prezzo, extra = {}, ctx = null) => D.crea(db, 'appuntamenti', { quando, cliente: cli.id, servizio: srv.id, ...(ctx ? {} : { prezzo, pagato: true }), ...extra }, ctx);
  return { db, cli, srv, app };
};
const ctxDi = (id, r) => ({ utente: { id }, r });

test('date nel fuso Europe/Rome: mezzanotte con l\'ora legale, periodi, chiavi', () => {
  assert.equal(mezzanotte('2026-07-01'), '2026-06-30T22:00:00.000Z');
  assert.equal(mezzanotte('2026-01-15'), '2026-01-14T23:00:00.000Z');
  assert.equal(mezzanotte('2026-03-29'), '2026-03-28T23:00:00.000Z');   // il giorno del cambio d'ora
  assert.equal(mezzanotte('2026-10-25'), '2026-10-24T22:00:00.000Z');
  assert.equal(giornoDi('2026-10-06T22:30:00Z'), '2026-10-07');
  assert.equal(giornoDi('2026-10-07T21:59:00Z'), '2026-10-07');
  const adesso = new Date('2026-10-07T10:00:00Z');
  assert.deepEqual(periodo('settimana', { adesso }), { da: '2026-10-05', a: '2026-10-11', prima: { da: '2026-09-28', a: '2026-10-04' } });
  assert.deepEqual(periodo('mese', { adesso: new Date('2026-03-15T10:00Z') }), { da: '2026-03-01', a: '2026-03-31', prima: { da: '2026-02-01', a: '2026-02-28' } });
  assert.equal(periodo('ultimi_30', { adesso }).da, '2026-09-08');
  assert.deepEqual(chiaviFra('2026-09-28', '2026-10-07', 'settimana'), ['2026-09-28', '2026-10-05']);
  assert.deepEqual(chiaviFra('2026-09-30', '2026-10-01', 'mese'), ['2026-09', '2026-10']);
});

test('aggregati: somme in euro senza errori di virgola, gruppi per giorno nel fuso di Roma, confronto col periodo prima', () => {
  const { db, app } = studio();
  app('2026-10-06T22:30:00Z', 0.1);    // a Roma è già il 7 ottobre, alle 00:30
  app('2026-10-07T21:59:00Z', 0.2);    // 7 ottobre, 23:59
  app('2026-10-07T22:00:00Z', 19.99);  // 8 ottobre, mezzanotte
  app('2026-10-06T10:00:00Z', 5);      // 6 ottobre
  app('2026-10-07T12:00:00Z', 100, { pagato: false });
  const adesso = new Date('2026-10-07T15:00:00Z');
  const r = aggrega(db, { entita: 'appuntamenti', misura: 'somma', campo: 'prezzo', campoData: 'quando', da: '2026-10-06', a: '2026-10-08', per: 'giorno', filtri: [{ campo: 'pagato', op: '=', valore: true }] }, null, { adesso });
  assert.deepEqual(r.valuta, [true]);
  assert.equal(r.totali[0], 25.29);
  assert.deepEqual(r.gruppi.map(g => [g.chiave, g.valori[0]]), [['2026-10-06', 5], ['2026-10-07', 0.3], ['2026-10-08', 19.99]]);
  // «oggi» e il giorno prima
  const oggi = aggrega(db, { entita: 'appuntamenti', misura: 'somma', campo: 'prezzo', campoData: 'quando', periodo: 'oggi', confronta: true, filtri: [{ campo: 'pagato', op: '=', valore: true }] }, null, { adesso });
  assert.equal(oggi.totali[0], 0.3); assert.equal(oggi.prima[0], 5);
  // conta e media, più misure insieme, raggruppate per un campo
  const s = aggrega(db, { entita: 'appuntamenti', misure: [{ misura: 'conta' }, { misura: 'media', campo: 'prezzo' }], per: 'pagato' }, null, { adesso });
  assert.deepEqual(s.totali, [5, 25.06]);
  assert.deepEqual(Object.fromEntries(s.gruppi.map(g => [g.chiave, g.valori[0]])), { si: 4, no: 1 });
  // date relative nei filtri
  const def = S.leggi(db, 'appuntamenti');
  assert.deepEqual(risolviFiltri(def, [{ campo: 'quando', op: '<', valore: '@oggi' }], { adesso }), [{ campo: 'quando', op: '<', valore: '2026-10-06T22:00:00.000Z' }]);
  assert.equal(risolviFiltri(def, [{ campo: 'quando', op: 'periodo', valore: 'oggi' }], { adesso }).length, 2);
});

test('aggregati: le valute dei calcolati (SOMMA delle righe) si sommano in centesimi', () => {
  const db = apri(); M.installa(db, 'negozio');
  const a = D.crea(db, 'articoli', { nome: 'Spilla', prezzo: 0.1, giacenza: 100 });
  for (const p of [0.1, 0.2, 0.7]) D.crea(db, 'vendite', { data: '2026-10-07', righe: [{ articolo: a.id, quantita: 1, prezzo: p }] });
  const r = aggrega(db, { entita: 'vendite', misura: 'somma', campo: 'totale', campoData: 'data', da: '2026-10-01', a: '2026-10-31', per: 'settimana' }, null);
  assert.deepEqual(r.valuta, [true]); assert.equal(r.totali[0], 1);
  assert.deepEqual(r.gruppi.map(g => g.chiave), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.equal(r.gruppi[1].valori[0], 1);
});

test('aggregati: permessi, campi nascosti e «solo i propri»', () => {
  const { db, app } = studio();
  const banco = { id: 'banco', entita: { '*': { leggi: true, crea: true, modifica: true }, appuntamenti: { soloPropri: true, campi: { prezzo: 'nascosto' } }, servizi: { leggi: false } } };
  const u = n => U.creaUtente(db, { nome: n, email: `${n}@prova.it`, password: 'password-lunga', ruolo: 'banco' }).id;
  const io = ctxDi(u('io'), banco), altro = ctxDi(u('altro'), banco);
  app('2026-10-07T09:00:00Z', 10, {}, io); app('2026-10-07T10:00:00Z', 20, {}, io); app('2026-10-07T11:00:00Z', 30, {}, altro); app('2026-10-07T12:00:00Z', 40);
  assert.equal(aggrega(db, { entita: 'appuntamenti', misura: 'conta' }, io).totali[0], 2);
  assert.equal(aggrega(db, { entita: 'appuntamenti', misura: 'conta' }, null).totali[0], 4);
  assert.throws(() => aggrega(db, { entita: 'appuntamenti', misura: 'somma', campo: 'prezzo' }, io), D.ErroreDati);
  assert.throws(() => aggrega(db, { entita: 'appuntamenti', misura: 'conta', per: 'prezzo' }, io), D.ErroreDati);
  assert.throws(() => aggrega(db, { entita: 'appuntamenti', misura: 'conta', filtri: [{ campo: 'prezzo', op: '>', valore: 0 }] }, io), D.ErroreDati);
  assert.throws(() => aggrega(db, { entita: 'servizi', misura: 'conta' }, io), P.ErrorePermesso);
  assert.throws(() => aggrega(db, { entita: 'appuntamenti', misura: 'boh' }, null), D.ErroreDati);
  // «no» su un sì/no conta anche le righe dove non è mai stato impostato (NULL)
  assert.equal(aggrega(db, { entita: 'appuntamenti', misura: 'conta', filtri: [{ campo: 'pagato', op: '=', valore: false }] }, null).totali[0], 3);
  assert.equal(D.elenca(db, 'appuntamenti', { filtri: [{ campo: 'pagato', op: '=', valore: false }] }).totale, 3);
  // si raggruppa solo per campi con valori ripetuti
  assert.throws(() => aggrega(db, { entita: 'appuntamenti', misura: 'conta', per: 'quando' }, null), D.ErroreDati);
});

test('cruscotto predefinito per i tre modelli', () => {
  for (const [m, attesi] of [['negozio', ['Incassato oggi', 'Incassi degli ultimi 30 giorni']], ['laboratorio', ['Preventivi in attesa', 'Commesse aperte']], ['studio', ['Appuntamenti oggi', 'Appuntamenti per settimana']]]) {
    const db = apri(); M.installa(db, m);
    const w = predefinito(db, S), titoli = w.map(x => x.titolo);
    for (const t of attesi) assert.ok(titoli.includes(t), `${m}: manca «${t}»`);
    assert.ok(w.some(x => x.tipo === 'attenzione' && x.voci.length >= 2), m);
    assert.ok(w.some(x => x.tipo === 'ultime'));
    // ogni widget si calcola senza errori
    for (const x of w.filter(x => ['numero', 'grafico'].includes(x.tipo))) aggrega(db, x, null);
  }
});

async function avvia() {
  const srv = creaServer(apri()); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  return { srv, chiama, esci: () => { biscotto = ''; } };
}

test('API: viste salvate per me e per tutti, cruscotto, agenda e aggregati con i permessi', async () => {
  const { srv, chiama, esci } = await avvia();
  try {
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'Studio Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['studio'] })).stato, 200);
    const cli = (await chiama('POST', '/api/dati/clienti', { nome: 'Bruno' })).json, srv1 = (await chiama('POST', '/api/dati/servizi', { nome: 'Visita', durata: 30, prezzo: 50 })).json;
    const ap = (await chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-07T08:00:00Z', cliente: cli.id, servizio: srv1.id, prezzo: 50 })).json;
    // agenda: la durata viene dal servizio, le colonne dal campo utente
    const ag = (await chiama('GET', '/api/agenda/appuntamenti?da=2026-10-05&a=2026-10-11')).json;
    assert.equal(ag.campoData, 'quando'); assert.equal(ag.eventi.length, 1); assert.equal(ag.eventi[0].durata, 30);
    assert.equal(ag.eventi[0].titolo, 'Bruno'); assert.ok(ag.colonne.some(c => c.id === 'con')); assert.equal(ag.persone.length, 1);
    assert.equal((await chiama('GET', '/api/agenda/appuntamenti?da=2026-10-05&a=2027-10-11')).stato, 400);
    assert.equal((await chiama('GET', '/api/agenda/servizi?da=2026-10-05&a=2026-10-11')).stato, 400);
    // viste
    const tutti = await chiama('POST', '/api/viste/appuntamenti', { nome: 'Da incassare', perTutti: true, filtri: [{ campo: 'pagato', op: '=', valore: false }], colonne: ['quando', 'cliente', 'prezzo'], raggruppa: 'stato' });
    assert.equal(tutti.stato, 200); assert.equal(tutti.json.perTutti, true);
    assert.equal((await chiama('POST', '/api/viste/appuntamenti', { nome: 'Le mie', filtri: [] })).json.perTutti, false);
    assert.equal((await chiama('POST', '/api/viste/appuntamenti', { nome: 'Rotta', filtri: [{ campo: 'nonce', op: '=' }] })).stato, 400);
    assert.equal((await chiama('GET', '/api/viste/appuntamenti')).json.length, 2);
    // un collaboratore che non vede i prezzi
    assert.equal((await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { '*': { leggi: true, crea: true, modifica: true }, appuntamenti: { campi: { prezzo: 'nascosto' } } } })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'banco' })).stato, 200);
    esci(); assert.equal((await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' })).stato, 200);
    const sue = (await chiama('GET', '/api/viste/appuntamenti')).json;
    assert.deepEqual(sue.map(v => v.nome), ['Da incassare']);
    assert.deepEqual(sue[0].colonne, ['quando', 'cliente']);
    assert.equal((await chiama('POST', '/api/viste/appuntamenti', { nome: 'Per tutti no', perTutti: true })).stato, 403);
    const mia = (await chiama('POST', '/api/viste/appuntamenti', { nome: 'Mia', filtri: [{ campo: 'stato', op: 'in', valore: ['prenotato'] }] })).json;
    assert.equal((await chiama('PUT', `/api/viste/appuntamenti/${mia.id}`, { ...mia, nome: 'Mia 2' })).json.nome, 'Mia 2');
    assert.equal((await chiama('PUT', `/api/viste/appuntamenti/${mia.id}`, { ...mia, perTutti: true })).stato, 403);
    assert.equal((await chiama('DELETE', `/api/viste/appuntamenti/${tutti.json.id}`)).stato, 403);
    assert.equal((await chiama('DELETE', `/api/viste/appuntamenti/${mia.id}`)).stato, 200);
    // aggregati e cruscotto con i permessi di Giulia
    assert.equal((await chiama('POST', '/api/aggregati', { entita: 'appuntamenti', misura: 'somma', campo: 'prezzo' })).stato, 422);
    assert.equal((await chiama('POST', '/api/aggregati', { entita: 'appuntamenti', misura: 'conta' })).json.totali[0], 1);
    const cr = (await chiama('GET', '/api/cruscotto')).json;
    assert.equal(cr.puoModificare, false);
    assert.ok(!cr.widget.some(w => w.campo === 'prezzo'), 'i widget sui prezzi nascosti non si mostrano a chi non può sistemarli');
    assert.ok(Object.values(cr.dati).every(d => !d.errore));
    const ultime = cr.dati[cr.widget.find(w => w.tipo === 'ultime').id].voci;
    assert.ok(ultime.some(v => v.riga === ap.id)); assert.ok(ultime.every(v => v.prima === undefined && v.dopo === undefined));
    assert.equal((await chiama('PUT', '/api/cruscotto', { widget: [] })).stato, 403);
    // il titolare cambia il cruscotto
    esci(); await chiama('POST', '/api/accedi', { email: 't@prova.it', password: 'password-lunga' });
    const salvato = await chiama('PUT', '/api/cruscotto', { widget: [{ tipo: 'numero', titolo: 'Clienti', entita: 'clienti', misura: 'conta' }] });
    assert.equal(salvato.stato, 200);
    const nuovo = (await chiama('GET', '/api/cruscotto')).json; assert.equal(nuovo.widget.length, 1); assert.equal(nuovo.dati[nuovo.widget[0].id].totali[0], 1);
    assert.equal((await chiama('PUT', '/api/cruscotto', { widget: [{ tipo: 'boh' }] })).stato, 400);
  } finally { srv.close(); }
});

test('API: calendario su un campo «data» e permessi del calendario', async () => {
  const { srv, chiama, esci } = await avvia();
  try {
    await chiama('POST', '/api/configura', { azienda: 'Lab', nome: 'Titolare', email: 't@lab.it', password: 'password-lunga', modelli: ['laboratorio'] });
    await chiama('POST', '/api/dati/commesse', { titolo: 'Anello', consegna: '2026-10-09' });
    await chiama('POST', '/api/dati/commesse', { titolo: 'Collana', consegna: '2026-11-20' });
    const ag = (await chiama('GET', '/api/agenda/commesse?da=2026-10-01&a=2026-10-31')).json;
    assert.equal(ag.tipoData, 'data'); assert.equal(ag.campoData, 'consegna');
    assert.deepEqual(ag.eventi.map(e => [e.titolo, e.inizio]), [['Anello', '2026-10-09']]);
    assert.ok(ag.colonne.some(c => c.id === 'responsabile'));
    assert.equal((await chiama('GET', '/api/agenda/commesse?da=2026-10-01&a=2026-10-31&campo=nonesiste')).json.campoData, 'consegna');
    // chi non vede le commesse non ha né calendario né aggregati né viste
    await chiama('PUT', '/api/ruoli/esterno', { nome: 'Esterno', entita: { '*': { leggi: true }, commesse: { leggi: false } } });
    await chiama('POST', '/api/utenti', { nome: 'Ext', email: 'e@lab.it', password: 'password-ext1', ruolo: 'esterno' });
    esci(); await chiama('POST', '/api/accedi', { email: 'e@lab.it', password: 'password-ext1' });
    assert.equal((await chiama('GET', '/api/agenda/commesse?da=2026-10-01&a=2026-10-31')).stato, 403);
    assert.equal((await chiama('POST', '/api/aggregati', { entita: 'commesse', misura: 'conta' })).stato, 403);
    assert.equal((await chiama('GET', '/api/viste/commesse')).stato, 403);
    const cr = (await chiama('GET', '/api/cruscotto')).json;
    assert.ok(!cr.widget.some(w => w.entita === 'commesse'));
    assert.ok(!cr.dati[cr.widget.find(w => w.tipo === 'attenzione').id].voci.some(v => v.entita === 'commesse'));
    assert.ok(!cr.dati[cr.widget.find(w => w.tipo === 'ultime').id].voci.some(v => v.entita === 'commesse'));
    // chi personalizza ma non vede le commesse salva il cruscotto: i widget sulle commesse non si perdono
    esci(); await chiama('POST', '/api/accedi', { email: 't@lab.it', password: 'password-lunga' });
    const prima = (await chiama('GET', '/api/cruscotto')).json.widget.filter(w => w.entita === 'commesse').map(w => w.id);
    assert.ok(prima.length);
    await chiama('PUT', '/api/ruoli/capo', { nome: 'Capo', schema: true, entita: { '*': { leggi: true }, commesse: { leggi: false } } });
    await chiama('POST', '/api/utenti', { nome: 'Capo', email: 'c@lab.it', password: 'password-capo1', ruolo: 'capo' });
    esci(); await chiama('POST', '/api/accedi', { email: 'c@lab.it', password: 'password-capo1' });
    const suo = (await chiama('GET', '/api/cruscotto')).json; assert.equal(suo.puoModificare, true);
    assert.equal((await chiama('PUT', '/api/cruscotto', { widget: suo.widget.slice(1) })).stato, 200);
    esci(); await chiama('POST', '/api/accedi', { email: 't@lab.it', password: 'password-lunga' });
    const dopo = (await chiama('GET', '/api/cruscotto')).json.widget.map(w => w.id);
    for (const id of prima) assert.ok(dopo.includes(id), `widget ${id} perso`);
    assert.ok(!dopo.includes(suo.widget[0].id));
  } finally { srv.close(); }
});
