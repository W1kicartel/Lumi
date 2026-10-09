// Altri SMS ai clienti e notifiche push: Vonage (SMS in form, Unicode, ricevute di consegna col codice segreto e la firma
// «sig»), Aruba SMS (token, Alta qualità con l'alias), SMSHosting (Basic, form, sandbox, credito), ClickSend (status di
// ogni messaggio), Gotify (X-Gotify-Key). Solo finti server locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';
import { FUSO } from '../server/moduli/agenda-aggregati.js';
import { firmaVonage } from '../connettori/vonage/connettore.js';

const domaniAlle = hhZ => `${new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: FUSO })}T${hhZ}:00:00Z`;
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

test('Vonage: firma «sig» come da documentazione (ordine, & e = nei valori, HMAC o MD5 col segreto in coda)', () => {
  const p = { to: '447700900000', text: 'a&b=c', msisdn: '393331234567', timestamp: '1700000000', sig: 'ignorata' }, s = 'segreto-firma';
  const base = '&msisdn=393331234567&text=a_b_c&timestamp=1700000000&to=447700900000';
  assert.equal(firmaVonage(s, p), createHmac('sha256', s).update(base).digest('hex'));
  assert.equal(firmaVonage(s, p, 'sha512'), createHmac('sha512', s).update(base).digest('hex'));
  assert.equal(firmaVonage(s, p, 'md5hash'), createHash('md5').update(base + s).digest('hex'));
});

test('Vonage: SMS in form (Unicode con le emoji, callback col codice), errore per pezzo, credito, promemoria, ricevute e SMS in arrivo', async () => {
  const K = await kubo(['studio']), PUB = 'https://kubo.bottega.example', SEC = 'Abc123SecretXyz';
  const S = await finto({
    'POST /sms/json': (p, c) => (c.text === 'errore' ? { 'message-count': '1', messages: [{ status: '4', 'error-text': 'Bad Credentials' }] }
      : { 'message-count': '1', messages: [{ to: c.to, 'message-id': '0A0000000123ABCD1', status: '0', 'remaining-balance': '3.14', 'message-price': '0.07' }] }),
    'GET /account/get-balance': () => ({ value: 10.28, autoReload: false }),
  });
  try {
    const pag = await accendi(K, 'vonage', { base: S.url, segreti: { segreto: SEC }, impostazioni: { chiave: 'abcd1234', mittente: 'Bottega', pubblico: PUB, promemoria: true } });
    const codice = pag.impostazioni.find(i => i.id === 'webhook').valore; assert.match(codice, /^[\w-]{30,}$/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/vonage/prova')).json, { ok: true, messaggio: 'credito: 10.28 €' });
    assert.equal(S.chiamate[0].intestazioni.authorization, basic('abcd1234', SEC));
    const anna = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', telefono: '333 123 4567' })).json;
    const r = await K.chiama('POST', '/api/connettori/vonage/azioni/manda_sms', { args: { cliente: anna.id, testo: 'Il tuo ordine è pronto 😀' } });
    assert.deepEqual(r.json, { a: '+393331234567', id: '0A0000000123ABCD1', pezzi: 1, credito: '3.14' });
    assert.deepEqual(S.chiamate.find(c => c.percorso === '/sms/json').corpo, { api_key: 'abcd1234', api_secret: SEC, from: 'Bottega', to: '393331234567', text: 'Il tuo ordine è pronto 😀', type: 'unicode', 'client-ref': 'kubo', callback: `${PUB}/api/connettori/vonage/in/${codice}` });
    const no = await K.chiama('POST', '/api/connettori/vonage/azioni/manda_sms', { args: { cliente: anna.id, testo: 'errore' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /Bad Credentials \(stato 4\)/);
    // senza il suo indirizzo, la ricevuta va all'indirizzo pubblico di Kubo nella Libreria
    await K.chiama('PUT', '/api/connettori/vonage', { impostazioni: { pubblico: null } }); await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://kubo.libreria.it' });
    await K.chiama('POST', '/api/connettori/vonage/azioni/manda_sms', { args: { cliente: anna.id, testo: 'Ciao' } });
    assert.equal(S.chiamate.filter(c => c.percorso === '/sms/json').at(-1).corpo.callback, `https://kubo.libreria.it/api/connettori/vonage/in/${codice}`);
    await K.chiama('PUT', '/api/connettori/vonage', { impostazioni: { pubblico: PUB } });
    await K.chiama('POST', '/api/dati/appuntamenti', { quando: domaniAlle('13'), cliente: anna.id });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/vonage/giri/promemoria')).json.risultato, { mandati: 1, senza_numero: 0 });
    const pr = S.chiamate.filter(c => c.percorso === '/sms/json').at(-1).corpo; assert.match(pr.text, /^Promemoria: Anna, ti aspettiamo .+ Bottega$/); assert.equal(pr.type, undefined);
    // la ricevuta di consegna: senza signature secret basta il codice in fondo all'indirizzo
    const H = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const dlr = { msisdn: '393331234567', to: 'Bottega', 'network-code': '22201', messageId: '0A0000000123ABCD1', price: '0.07', status: 'failed', scts: '2601011200', 'err-code': '6', 'message-timestamp': '2026-01-01 12:00:00' };
    assert.equal((await manda(K, '/api/connettori/vonage/in/sbagliato', new URLSearchParams(dlr).toString(), H)).stato, 401);
    assert.equal((await manda(K, `/api/connettori/vonage/in/${codice}`, new URLSearchParams(dlr).toString(), H)).json.esito, 'non consegnato: +393331234567');
    assert.ok((await K.chiama('GET', '/api/connettori/vonage')).json.registro.some(x => /non è stato consegnato \(errore 6\)/.test(x.titolo)));
    // con i webhook firmati serve anche «sig» giusta (form o JSON)
    await K.chiama('PUT', '/api/connettori/vonage', { segreti: { firma: 'sig-segreto' }, impostazioni: { metodo: 'sha256' } });
    const ok = { ...dlr, status: 'delivered', 'err-code': '0', timestamp: String(Math.floor(Date.now() / 1000)), nonce: 'n-1' };
    assert.equal((await manda(K, `/api/connettori/vonage/in/${codice}`, new URLSearchParams(ok).toString(), H)).stato, 401);
    assert.equal((await manda(K, `/api/connettori/vonage/in/${codice}`, new URLSearchParams({ ...ok, sig: firmaVonage('altro', ok) }).toString(), H)).stato, 401);
    const firmata = await manda(K, `/api/connettori/vonage/in/${codice}`, new URLSearchParams({ ...ok, sig: firmaVonage('sig-segreto', ok).toUpperCase() }).toString(), H);
    assert.equal(firmata.json?.esito, 'stato: delivered', JSON.stringify(firmata));
    await K.chiama('PATCH', `/api/dati/clienti/${anna.id}`, { telefono: '333 1234567' });   // scritto all'italiana nella scheda
    const q = { msisdn: '393331234567', to: '447700900000', messageId: '0B000000', text: 'Arrivo alle 17', type: 'text', keyword: 'ARRIVO', 'message-timestamp': '2026-01-01 12:00:00', timestamp: ok.timestamp };
    assert.equal((await manda(K, `/api/connettori/vonage/in/${codice}`, JSON.stringify({ ...q, sig: firmaVonage('sig-segreto', q) }))).json.esito, 'SMS ricevuto da Anna Bianchi');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Aruba SMS: token con le credenziali (una volta), Alta qualità con l\'alias, bassa senza mittente, SMS per tipo nella prova', async () => {
  const K = await kubo(['studio']); let token = 0;
  const S = await finto({
    'GET /API/v1.0/REST/token': (p, c, { intestazioni }) => (intestazioni.authorization === basic('titolare@bottega.example', 'pw-aruba') ? { stato: 200, corpo: `UK${++token};AT${token}` } : { stato: 401, corpo: '' }),
    'POST /API/v1.0/REST/sms': (p, c, { intestazioni }) => (intestazioni.access_token === 'AT1' ? { stato: 201, corpo: { result: 'OK', order_id: 'ORD-7', total_sent: 1, internal_order_id: 'x' } } : { stato: 401, corpo: {} }),
    'GET /API/v1.0/REST/status': () => ({ money: null, sms: [{ type: 'N', quantity: 120 }] }),
  });
  try {
    await accendi(K, 'aruba-sms', { base: S.url, segreti: { password: 'pw-aruba' }, impostazioni: { utente: 'titolare@bottega.example', mittente: 'Bottega' } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/aruba-sms/prova')).json, { ok: true, messaggio: 'N: 120' });
    assert.equal(S.chiamate.find(c => c.percorso === '/API/v1.0/REST/status').q.typeAliases, 'true');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Giulia Rossi', telefono: '+39 340 1112223' })).json;
    const r = await K.chiama('POST', '/api/connettori/aruba-sms/azioni/manda_sms', { args: { cliente: cl.id, testo: 'La visita è confermata' } });
    assert.deepEqual(r.json, { a: '+393401112223', id: 'ORD-7', inviati: 1 });
    const c = S.chiamate.find(x => x.percorso === '/API/v1.0/REST/sms');
    assert.equal(c.intestazioni.user_key, 'UK1');
    assert.deepEqual(c.corpo, { message_type: 'N', message: 'La visita è confermata', recipient: ['+393401112223'], sender: 'Bottega', returnCredits: true });
    await K.chiama('PUT', '/api/connettori/aruba-sms', { impostazioni: { qualita: 'L' } });
    await K.chiama('POST', '/api/connettori/aruba-sms/azioni/manda_sms', { args: { cliente: cl.id, testo: 'Ciao' } });
    assert.deepEqual(S.chiamate.filter(x => x.percorso === '/API/v1.0/REST/sms').at(-1).corpo, { message_type: 'L', message: 'Ciao', recipient: ['+393401112223'], returnCredits: true });
    assert.equal(token, 1);   // il token non scade: chiesto una volta
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('SMSHosting: Basic con le due chiavi, SMS in form senza «+», sandbox, SMS non inserito, credito nella prova', async () => {
  const K = await kubo(['studio']);
  const S = await finto({
    'POST /rest/api/sms/send': (p, c) => (c.text === 'scarta' ? { from: c.from, text: c.text, smsInserted: 0, smsNotInserted: 1, sms: [{ id: null, to: c.to, status: 'NOT_INSERTED', statusDetail: 'BAD_NUMBER' }] }
      : { from: c.from, text: c.text, transactionId: null, smsInserted: 1, smsNotInserted: 0, sms: [{ id: '4815162342', to: c.to, status: 'INSERTED' }] }),
    'GET /rest/api/user': (p, c, { intestazioni }) => (intestazioni.authorization === basic('KEY1', 'SEC1') ? { name: 'Mario', credit: 12.5, italysms: 250 } : { stato: 401, corpo: { errorCode: 401, errorMsg: 'Unauthorized' } }),
  });
  try {
    await accendi(K, 'smshosting', { base: S.url, segreti: { segreto: 'SEC1' }, impostazioni: { chiave: 'KEY1', mittente: 'Bottega', promemoria: true } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/smshosting/prova')).json, { ok: true, messaggio: '250 SMS per l\'Italia · credito 12.50 €' });
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Paolo Neri', telefono: '347 7654321' })).json;
    const r = await K.chiama('POST', '/api/connettori/smshosting/azioni/manda_sms', { args: { cliente: cl.id, testo: 'Il ricambio è arrivato' } });
    assert.deepEqual(r.json, { a: '+393477654321', id: '4815162342', stato: 'INSERTED' });
    const c = S.chiamate.find(x => x.percorso === '/rest/api/sms/send');
    assert.equal(c.intestazioni.authorization, basic('KEY1', 'SEC1'));
    assert.deepEqual(c.corpo, { to: '393477654321', text: 'Il ricambio è arrivato', from: 'Bottega', encoding: 'AUTO' });
    const no = await K.chiama('POST', '/api/connettori/smshosting/azioni/manda_sms', { args: { cliente: cl.id, testo: 'scarta' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /non accettato \(BAD_NUMBER\)/);
    await K.chiama('PUT', '/api/connettori/smshosting', { impostazioni: { prova_finta: true } });
    await K.chiama('POST', '/api/dati/appuntamenti', { quando: domaniAlle('09'), cliente: cl.id });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/smshosting/giri/promemoria')).json.risultato, { mandati: 1, senza_numero: 0 });
    assert.equal(S.chiamate.filter(x => x.percorso === '/rest/api/sms/send').at(-1).corpo.sandbox, 'true');
    await K.chiama('PUT', '/api/connettori/smshosting', { segreti: { segreto: 'sbagliato' } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/smshosting/prova')).json, { ok: false, messaggio: 'chiave API o chiave segreta sbagliate' });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('ClickSend: messages con source e from, status del singolo messaggio, credito nella prova', async () => {
  const K = await kubo(['studio']);
  const S = await finto({
    'POST /v3/sms/send': (p, c) => ({ http_code: 200, response_code: 'SUCCESS', response_msg: 'Messages queued for delivery.',
      data: { total_price: 0.077, total_count: 1, queued_count: 1, messages: [{ to: c.messages[0].to, body: c.messages[0].body, message_id: 'BF7AD270-0DE2-418B-B606-71D527D9C1AE', message_price: '0.0770', status: c.messages[0].body === 'rifiuta' ? 'INVALID_RECIPIENT' : 'SUCCESS' }] } }),
    'GET /v3/account': () => ({ http_code: 200, response_code: 'SUCCESS', data: { user_id: 1, username: 'bottega', balance: '6.70', _currency: { currency_name_short: 'EUR' } } }),
  });
  try {
    await accendi(K, 'clicksend', { base: S.url, segreti: { chiave: 'CK-API-KEY' }, impostazioni: { utente: 'bottega', mittente: 'Bottega' } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/clicksend/prova')).json, { ok: true, messaggio: 'bottega · credito 6.70 EUR' });
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Sara Galli', telefono: '0039 349 5556667' })).json;
    const r = await K.chiama('POST', '/api/connettori/clicksend/azioni/manda_sms', { args: { cliente: cl.id, testo: 'Domani siamo chiusi' } });
    assert.deepEqual(r.json, { a: '+393495556667', id: 'BF7AD270-0DE2-418B-B606-71D527D9C1AE', costo: '0.0770' });
    const c = S.chiamate.find(x => x.percorso === '/v3/sms/send');
    assert.equal(c.intestazioni.authorization, basic('bottega', 'CK-API-KEY'));
    assert.deepEqual(c.corpo, { messages: [{ source: 'kubo', to: '+393495556667', body: 'Domani siamo chiusi', from: 'Bottega' }] });
    const no = await K.chiama('POST', '/api/connettori/clicksend/azioni/manda_sms', { args: { cliente: cl.id, testo: 'rifiuta' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /SMS rifiutato \(INVALID_RECIPIENT\)/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Gotify: X-Gotify-Key, titolo e priorità nella prova, «scrivi» per Lumi, token sbagliato', async () => {
  const K = await kubo(['negozio']), push = [];
  const S = await finto({ 'POST /message': (p, c, { intestazioni }) => (intestazioni['x-gotify-key'] === 'AbCdEf123456'
    ? (push.push(c), { id: push.length, appid: 1, message: c.message, title: c.title, priority: c.priority, date: '2026-10-09T10:00:00Z' })
    : { stato: 401, corpo: { error: 'Unauthorized', errorCode: 401, errorDescription: 'you need to provide a valid access token or user credentials to access this api' } }) });
  try {
    await accendi(K, 'gotify', { base: S.url, segreti: { token: 'AbCdEf123456' }, impostazioni: { server: 'https://gotify.bottega.example', priorita: '8' } });
    assert.equal((await K.chiama('POST', '/api/connettori/gotify/prova')).json.ok, true);
    assert.deepEqual(push[0], { title: 'Kubo', message: 'Kubo è collegato a questo canale.', priority: 8 });
    const s = await K.chiama('POST', '/api/connettori/gotify/azioni/scrivi', { args: { testo: 'Ricordati di chiudere la cassa' } });
    assert.deepEqual(s.json, { inviato: true, id: 2 }); assert.equal(push[1].message, 'Ricordati di chiudere la cassa');
    await K.chiama('PUT', '/api/connettori/gotify', { segreti: { token: 'sbagliato' } });
    const no = await K.chiama('POST', '/api/connettori/gotify/azioni/scrivi', { args: { testo: 'x' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /401: you need to provide a valid access token/);
  } finally { await K.chiudi(); await S.chiudi(); }
});
