import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';

attiva();
async function avvia() {
  const srv = creaServer(apri()); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo, { senzaIntestazione = false } = {}) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', ...(senzaIntestazione ? {} : { 'X-Lumi': '1' }), ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  return { srv, chiama, esci: () => { biscotto = ''; } };
}

test('configurazione, accesso, permessi e dati via API', async () => {
  const { srv, chiama, esci } = await avvia();
  try {
    assert.equal((await chiama('GET', '/api/stato')).json.configurato, false);
    assert.equal((await chiama('GET', '/api/schema')).stato, 401);
    const c = await chiama('POST', '/api/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio'] });
    assert.equal(c.stato, 200, JSON.stringify(c.json));
    assert.equal((await chiama('POST', '/api/configura', { azienda: 'x' })).stato, 409);
    const schema = (await chiama('GET', '/api/schema')).json; assert.ok(schema.some(e => e.id === 'articoli'));
    assert.equal((await chiama('POST', '/api/dati/clienti', { nome: 'X' }, { senzaIntestazione: true })).stato, 403);
    const art = (await chiama('POST', '/api/dati/articoli', { nome: 'Vaso', prezzo: 30, costo: 10, giacenza: 4 })).json;
    const err = await chiama('POST', '/api/dati/clienti', { email: 'no' }); assert.equal(err.stato, 422); assert.ok(err.json.campi.email);
    // un collaboratore che non vede il costo e non può eliminare
    assert.equal((await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { campi: { costo: 'nascosto' } } } })).stato, 200);
    assert.equal((await chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'banco' })).stato, 200);
    esci(); assert.equal((await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'sbagliata' })).stato, 401);
    assert.equal((await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' })).stato, 200);
    const visto = (await chiama('GET', `/api/dati/articoli/${art.id}`)).json; assert.equal(visto.costo, undefined); assert.equal(visto.prezzo, 30);
    assert.equal((await chiama('GET', '/api/dati/articoli?f=' + encodeURIComponent(JSON.stringify([{ campo: 'costo', op: '>', valore: 0 }])))).stato, 422);
    assert.equal((await chiama('DELETE', `/api/dati/articoli/${art.id}`)).stato, 403);
    assert.equal((await chiama('PUT', '/api/schema/articoli', { id: 'articoli' })).stato, 403);
    assert.equal((await chiama('GET', '/api/dati/articoli?q=vaso')).json.totale, 1);
  } finally { srv.close(); }
});
