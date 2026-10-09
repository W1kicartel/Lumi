// Il kit dei connettori, giro 4: verifiche GET e risposte su misura dei webhook, multipart, OAuth (basic, JSON, senza PKCE,
// valori in più, redirect su misura, device code), indirizzo pubblico, input facoltativi degli strumenti di Lumi,
// k.sincro.scollega, nomi degli strumenti senza collisioni, pulizia di coda ed eventi, controlli di sicurezza.
// Un connettore «di terzi» scritto al volo in una cartella temporanea; i servizi sono finti e locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { istanze } from '../server/moduli/connettori.js';
import { finto } from './connettori-finto.mjs';

// Kubo su file (servono le cartelle dei dati) con i connettori locali { id: sorgente }, accesi e approvati
async function kuboCon(connettori = {}, modelli = ['negozio']) {
  const dir = mkdtempSync(join(tmpdir(), 'kubo-kit-'));
  for (const [id, src] of Object.entries(connettori)) { mkdirSync(join(dir, 'connettori', id), { recursive: true }); writeFileSync(join(dir, 'connettori', id, 'connettore.js'), src); }
  const db = apri(join(dir, 'kubo.db')), srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (m, p, c, h = {}) => {
    const r = await fetch(base + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}), ...h }, body: c ? JSON.stringify(c) : undefined });
    const s = r.headers.get('set-cookie'); if (s) biscotto = s.split(';')[0];
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { } return { stato: r.status, json, testo: t, intestazioni: r.headers };
  };
  await chiama('POST', '/api/configura', { azienda: 'B', nome: 'T', email: 't@esempio.it', password: 'prova-kubo-1', modelli });
  const n = istanze.get(db); await n.pronti;
  for (const id of Object.keys(connettori)) {
    const c = (await chiama('GET', `/api/connettori/${id}`)).json;
    const x = await chiama('PUT', `/api/connettori/${id}`, { attivo: true, somma: c.somma, interni: true }); assert.equal(x.stato, 200, JSON.stringify(x.json));
  }
  return { base, chiama, db, n, dir, esci: () => { biscotto = ''; }, chiudi: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
// una richiesta «da fuori»: niente sessione né X-Kubo
const fuori = (K, m, p, corpo, h = {}) => fetch(K.base + p, { method: m, headers: h, body: corpo }).then(async r => ({ stato: r.status, testo: await r.text(), tipo: r.headers.get('content-type') }));

test('webhook: verifica GET, risposta su misura, stato su misura per la firma sbagliata, multipart con file', async () => {
  const K = await kuboCon({ prova: `export default { id: 'prova', nome: 'Prova', permessi: {},
    impostazioni: [{ id: 'codice', nome: 'Codice', segreto: true, generato: true }],
    entrata: { firma: { tipo: 'token', segreto: 'codice' },
      verificaGet: (q, k) => (q.get('sfida') ? { testo: q.get('sfida') } : { stato: 400, testo: 'manca la sfida' }),
      risposta: ({ esito, q }) => (q.get('validationToken') ? { tipo: 'text/plain', testo: q.get('validationToken') } : { tipo: 'text/xml', testo: '<Response/>' }),
      rispostaFirma: { stato: 403, testo: 'no' },
      gestisci: (ev, k) => { globalThis.eventoProva = ev; return 'ok'; } } };` });
  try {
    const codice = K.n.segreto('prova', 'codice');
    // GET: senza il codice giusto non si arriva alla verifica
    assert.equal((await fuori(K, 'GET', '/api/connettori/prova/in?sfida=x')).stato, 401);
    assert.equal((await fuori(K, 'GET', '/api/connettori/prova/in/sbagliato?sfida=x')).stato, 401);
    const s = await fuori(K, 'GET', `/api/connettori/prova/in/${codice}?sfida=abc123`); assert.equal(s.stato, 200); assert.equal(s.testo, 'abc123'); assert.match(s.tipo, /text\/plain/);
    assert.equal((await fuori(K, 'GET', `/api/connettori/prova/in/${codice}`)).stato, 400);
    // un connettore senza verificaGet: GET non esiste
    assert.equal((await fuori(K, 'GET', '/api/connettori/stripe/in')).stato, 404);
    // firma sbagliata: lo stato che vuole il servizio
    const no = await fuori(K, 'POST', '/api/connettori/prova/in/sbagliato', '{}', { 'Content-Type': 'application/json' }); assert.equal(no.stato, 403); assert.equal(no.testo, 'no');
    // multipart/form-data: i campi in UTF-8, il file solo descritto
    const b = 'XyZ123', corpo = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="nome"\r\n\r\nPerò è così\r\n--${b}\r\nContent-Disposition: form-data; name="foto"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from([0x89, 0x50, 0xff, 0x00]), Buffer.from(`\r\n--${b}--\r\n`)]);
    const r = await fuori(K, 'POST', `/api/connettori/prova/in/${codice}`, corpo, { 'Content-Type': `multipart/form-data; boundary=${b}` });
    assert.equal(r.stato, 200); assert.equal(r.testo, '<Response/>'); assert.match(r.tipo, /text\/xml/);
    assert.equal(globalThis.eventoProva.nome, 'Però è così'); assert.deepEqual(globalThis.eventoProva._file, [{ campo: 'foto', nome: 'a.png', tipo: 'image/png', dimensione: 4 }]);
    // la risposta può dipendere dalla richiesta (Microsoft Graph: validationToken nella query)
    const v = await fuori(K, 'POST', `/api/connettori/prova/in/${codice}?validationToken=tok%20en`, '', { 'Content-Type': 'text/plain' }); assert.equal(v.testo, 'tok en');
    // la pagina dice che c'è la verifica GET
    assert.equal((await K.chiama('GET', '/api/connettori/prova')).json.webhook.verificaGet, true);
  } finally { await K.chiudi(); }
});

