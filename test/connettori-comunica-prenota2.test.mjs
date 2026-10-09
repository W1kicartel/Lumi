// Prenotazioni, telefono e riunioni (terzo giro): SimplyBook.me, Aircall, Whereby, Teams (riunioni online).
// Tutti contro finti servizi locali, con il modello «studio» (clienti, servizi, appuntamenti). Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';
import { varianti } from '../connettori/aircall/connettore.js';
import { coda } from './connettori-comunica-coda.mjs';

const appuntamenti = async K => (await K.chiama('GET', '/api/dati/appuntamenti?perPagina=100')).json.righe;
const clienti = async K => (await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe;
const avvisi = (K, id) => K.db.prepare("SELECT titolo FROM _connettori_registro WHERE connettore = ? AND esito = 'avviso' ORDER BY rowid").all(id).map(r => r.titolo);

test('SimplyBook: callback con codice segreto, prenotazione riletta dall\'API → cliente + appuntamento; spostamento, annullamento, giro', async () => {
  const K = await kubo(['studio']), pren = {
    101: { id: '101', code: 'AB12', start_date_time: '2026-10-20 10:00:00', end_date_time: '2026-10-20 10:45:00', event_name: 'Pulizia viso', unit_name: 'Sara', client_name: 'Giulia Verdi', client_email: 'Giulia.Verdi@esempio.it', client_phone: '+393331112222', is_confirm: '1',
      additional_fields: [{ field_title: 'Allergie', value: 'Nichel' }] },
    102: { id: '102', start_date: '2026-10-21 15:30:00', event: 'Manicure', client: 'Laura Gialli', client_email: 'laura.gialli@esempio.it', is_confirm: '1' },
  };
  const S = await finto({
    'POST /login': (p, c) => (c.method === 'getUserToken' && c.params[2] === 'api_user_key_prova' ? { jsonrpc: '2.0', id: c.id, result: 'tok-sb' } : { jsonrpc: '2.0', id: c.id, error: { code: -32600, message: 'Access denied' } }),
    'POST /admin': (p, c, { intestazioni: h }) => {
      if (h['x-user-token'] !== 'tok-sb' || h['x-company-login'] !== 'centrobelle') return { jsonrpc: '2.0', id: c.id, error: { code: -32600, message: 'Invalid token' } };
      if (c.method === 'getBookingDetails') return { jsonrpc: '2.0', id: c.id, result: pren[c.params[0]] || null };
      if (c.method === 'getBookings') return { jsonrpc: '2.0', id: c.id, result: c.params[0].booking_type === 'cancelled' ? [{ ...pren[101], is_confirm: '0' }] : { 102: pren[102] } };
      return { jsonrpc: '2.0', id: c.id, error: { code: -32601, message: 'Method not found' } };
    },
  });
  try {
    await K.chiama('POST', '/api/dati/servizi', { nome: 'Pulizia viso', durata: 45, prezzo: 6000, attivo: true });
    await accendi(K, 'simplybook', { base: S.url, segreti: { chiave: 'api_user_key_prova' }, impostazioni: { azienda: 'centrobelle', utente: 'admin', indirizzo: 'https://kubo.centrobelle.it/' } });
    assert.equal((await K.chiama('POST', '/api/connettori/simplybook/prova')).json.ok, true);
    assert.deepEqual(S.chiamate[0].corpo.params, ['centrobelle', 'admin', 'api_user_key_prova']); assert.equal(S.chiamate[0].intestazioni['x-company-login'], 'centrobelle');
    const codice = K.nucleo.segreto('simplybook', 'codice'); assert.ok(codice?.length >= 20);   // lo genera Kubo
    assert.equal((await K.chiama('POST', '/api/connettori/simplybook/azioni/indirizzo_callback', {})).json.indirizzo, `https://kubo.centrobelle.it/api/connettori/simplybook/in/${codice}`);
    const cb = (id, tipo, company = 'centrobelle') => JSON.stringify({ booking_id: String(id), booking_hash: 'f3a9c1', company, notification_type: tipo });
    // codice sbagliato o mancante → 401
    assert.equal((await manda(K, '/api/connettori/simplybook/in/codice-sbagliato', cb(101, 'create'))).stato, 401);
    assert.equal((await manda(K, '/api/connettori/simplybook/in', cb(101, 'create'))).stato, 401);
    const r = await manda(K, `/api/connettori/simplybook/in/${codice}`, cb(101, 'create'));
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'creato');
    assert.equal(S.chiamate.at(-1).corpo.method, 'getBookingDetails'); assert.deepEqual(S.chiamate.at(-1).corpo.params, ['101']);
    const [cl] = await clienti(K); assert.equal(cl.email, 'giulia.verdi@esempio.it'); assert.equal(cl.nome, 'Giulia Verdi');
    let [a] = await appuntamenti(K);
    assert.equal(a.quando, '2026-10-20T08:00:00.000Z');   // 10:00 a Roma, ora legale
    assert.equal(a.cliente?.id, cl.id); assert.equal(a.servizio?.titolo, 'Pulizia viso'); assert.match(a.note, /Pulizia viso · Sara \(AB12\)/); assert.match(a.note, /Allergie: Nichel/);
    // un'altra azienda, un tipo sconosciuto → ignorati
    assert.match((await manda(K, `/api/connettori/simplybook/in/${codice}`, cb(101, 'create', 'altra'))).json.esito, /^ignorato/);
    assert.match((await manda(K, `/api/connettori/simplybook/in/${codice}`, cb(101, 'new_client'))).json.esito, /^ignorato/);
    // spostamento
    pren[101].start_date_time = '2026-10-22 16:00:00';
    assert.equal((await manda(K, `/api/connettori/simplybook/in/${codice}`, cb(101, 'change'))).json.esito, 'spostato');
    assert.equal((await appuntamenti(K))[0].quando, '2026-10-22T14:00:00.000Z');
    // giro: la prenotazione 102 entra, la 101 annullata si segna
    const g = await K.chiama('POST', '/api/connettori/simplybook/giri/prenotazioni'); assert.equal(g.json.esito, 'ok', JSON.stringify(g.json));
    assert.equal(g.json.risultato.creati, 1); assert.equal(g.json.risultato.annullati, 1);
    const tutti = await appuntamenti(K); assert.equal(tutti.length, 2);
    assert.equal(tutti.find(x => x.quando === '2026-10-21T13:30:00.000Z')?.cliente?.titolo, 'Laura Gialli');
    assert.equal(tutti.find(x => x.quando === '2026-10-22T14:00:00.000Z')?.stato, 'annullato');
    assert.equal((await manda(K, `/api/connettori/simplybook/in/${codice}`, cb(101, 'cancel'))).json.esito, 'uguale');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Aircall: token del webhook, cliente dal numero, avviso di chiamata, chiamata persa, riga nelle note, «Chiama»', async () => {
  assert.ok(varianti('+39 333 123 4567').includes('333 123 4567')); assert.ok(varianti('+39 333 123 4567').includes('+393331234567'));
  const K = await kubo(['studio']);
  const S = await finto({
    'GET /v1/ping': () => ({ ping: 'pong' }),
    'POST /v1/users/:id/calls': p => (p.id === '42' ? { stato: 204, corpo: '' } : { stato: 405, corpo: { message: 'User not available' } }),
  });
  try {
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Rossi', telefono: '333 123 4567', note: 'Cliente dal 2024' })).json;
    await accendi(K, 'aircall', { base: S.url, segreti: { api_token: 'at-prova', token_webhook: 'wh-tok-123' }, impostazioni: { api_id: 'id-prova', utente: '42', numero: '7' } });
    assert.equal((await K.chiama('POST', '/api/connettori/aircall/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, `Basic ${Buffer.from('id-prova:at-prova').toString('base64')}`);
    const ev = (event, data, token = 'wh-tok-123') => JSON.stringify({ resource: 'call', event, timestamp: 1791100000, token, data });
    const chiamata = { id: 9001, direction: 'inbound', status: 'initial', raw_digits: '+39 333 123 4567', started_at: 1791100000, answered_at: null, user: null };
    // token sbagliato, mancante → 401
    assert.equal((await manda(K, '/api/connettori/aircall/in', ev('call.created', chiamata, 'altro'))).stato, 401);
    assert.equal((await manda(K, '/api/connettori/aircall/in', JSON.stringify({ resource: 'call', event: 'call.created', data: chiamata }))).stato, 401);
    const r = await manda(K, '/api/connettori/aircall/in', ev('call.created', chiamata));
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'avvisato: cliente');
    assert.equal((await manda(K, '/api/connettori/aircall/in', ev('call.created', chiamata))).json.doppione, true);
    assert.deepEqual(avvisi(K, 'aircall'), ['Chiama Anna Rossi (+39 333 123 4567)']);
    // finita senza risposta → persa: avviso e riga nelle note
    assert.equal((await manda(K, '/api/connettori/aircall/in', ev('call.ended', { ...chiamata, status: 'done', missed_call_reason: 'agents_did_not_answer', duration: 20 }))).json.esito, 'persa: nota');
    assert.equal(avvisi(K, 'aircall').at(-1), 'Chiamata persa da Anna Rossi (+39 333 123 4567)');
    // una chiamata con risposta, fatta da un collega: riga con la durata e il nome
    const fatta = { id: 9002, direction: 'outbound', status: 'done', raw_digits: '+393331234567', started_at: 1791103600, answered_at: 1791103605, duration: 185, user: { id: 42, name: 'Marta' } };
    assert.equal((await manda(K, '/api/connettori/aircall/in', ev('call.ended', fatta))).json.esito, 'finita: nota');
    const note = (await K.chiama('GET', `/api/dati/clienti/${cl.id}`)).json.note.split('\n');
    assert.equal(note[0], 'Cliente dal 2024'); assert.match(note[1], /Aircall: chiamata persa$/); assert.match(note[2], /Aircall: chiamata fatta, 3 min \(Marta\)$/);
    // un numero sconosciuto: avviso col numero, niente note
    assert.equal((await manda(K, '/api/connettori/aircall/in', ev('call.ended', { ...chiamata, id: 9003, raw_digits: '+39 02 1234567', missed_call_reason: 'out_of_opening_hours' }))).json.esito, 'persa');
    assert.equal(avvisi(K, 'aircall').at(-1), 'Chiamata persa da +39 02 1234567');
    assert.match((await manda(K, '/api/connettori/aircall/in', JSON.stringify({ resource: 'contact', event: 'contact.created', token: 'wh-tok-123', data: { id: 1 } }))).json.esito, /^ignorato/);
    // «Chiama»: anteprima con il numero E.164, poi la chiamata dal telefono dell'utente 42
    const ant = (await K.chiama('POST', '/api/connettori/aircall/azioni/chiama', { args: { cliente: cl.id }, anteprima: true })).json;
    assert.deepEqual(ant.righe, [['Cliente', 'Anna Rossi'], ['Numero', '+393331234567']]); assert.deepEqual(ant.avvisi, []);
    const ch = await K.chiama('POST', '/api/connettori/aircall/azioni/chiama', { args: { cliente: cl.id } }); assert.equal(ch.stato, 200, JSON.stringify(ch.json));
    assert.deepEqual(S.chiamate.at(-1).corpo, { number_id: 7, to: '+393331234567' }); assert.equal(S.chiamate.at(-1).percorso, '/v1/users/42/calls');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Whereby: stanza con prefisso e link di chi ospita nelle note; spostamento → stanza nuova; annullamento → cancellata; automatico', async () => {
  const K = await kubo(['studio']), stanze = new Map(); let n = 0;
  const S = await finto({
    'GET /v1/meetings': () => ({ results: [] }),
    'POST /v1/meetings': (p, c) => { const id = String(++n), u = `https://studio.whereby.com/${c.roomNamePrefix || ''}${id}abc`; stanze.set(id, c);
      return { stato: 201, corpo: { meetingId: id, roomUrl: u, startDate: new Date().toISOString(), endDate: c.endDate, ...(c.fields?.includes('hostRoomUrl') ? { hostRoomUrl: `${u}?roomKey=k${id}` } : {}) } }; },
    'DELETE /v1/meetings/:id': p => { stanze.delete(p.id); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 'whereby', { base: S.url, segreti: { chiave: 'wb-chiave' }, impostazioni: { prefisso: 'StudioRossi' } });
    assert.equal((await K.chiama('POST', '/api/connettori/whereby/prova')).json.ok, true); assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer wb-chiave');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Paolo Blu' })).json;
    const a = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-22T08:00:00.000Z', cliente: cl.id, note: 'Consulenza online' })).json;
    await coda(K); assert.equal(stanze.size, 0);   // senza «automatico» niente stanze da sole
    const ant = (await K.chiama('POST', '/api/connettori/whereby/azioni/crea_riunione', { args: { appuntamento: a.id }, anteprima: true })).json;
    assert.equal(ant.righe[0][1], 'Paolo Blu'); assert.deepEqual(ant.avvisi, []);
    const r = (await K.chiama('POST', '/api/connettori/whereby/azioni/crea_riunione', { args: { appuntamento: a.id } })).json;
    assert.equal(r.link, 'https://studio.whereby.com/studiorossi1abc'); assert.equal(r.ospite, 'https://studio.whereby.com/studiorossi1abc?roomKey=k1');
    assert.deepEqual(stanze.get('1'), { endDate: '2026-10-22T09:00:00.000Z', roomMode: 'normal', fields: ['hostRoomUrl'], roomNamePrefix: 'studiorossi' });
    let note = (await K.chiama('GET', `/api/dati/appuntamenti/${a.id}`)).json.note;
    assert.equal(note, 'Consulenza online\nWhereby: https://studio.whereby.com/studiorossi1abc\nWhereby (link di chi ospita): https://studio.whereby.com/studiorossi1abc?roomKey=k1');
    assert.equal((await K.chiama('POST', '/api/connettori/whereby/azioni/crea_riunione', { args: { appuntamento: a.id } })).json.gia, true);
    // spostato: stanza nuova al posto della vecchia, link nuovi nelle note
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { quando: '2026-10-23T14:00:00.000Z' }); await coda(K);
    assert.deepEqual([...stanze.keys()], ['2']); assert.equal(stanze.get('2').endDate, '2026-10-23T15:00:00.000Z');
    note = (await K.chiama('GET', `/api/dati/appuntamenti/${a.id}`)).json.note;
    assert.equal(note, 'Consulenza online\nWhereby: https://studio.whereby.com/studiorossi2abc\nWhereby (link di chi ospita): https://studio.whereby.com/studiorossi2abc?roomKey=k2');
    // annullato: la stanza si cancella
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { stato: 'annullato' }); await coda(K);
    assert.equal(stanze.size, 0); assert.equal(S.chiamate.at(-1).metodo, 'DELETE');
    // automatico: un appuntamento nuovo prende la sua stanza
    await accendi(K, 'whereby', { base: S.url, segreti: { chiave: 'wb-chiave' }, impostazioni: { automatico: true } });
    const b = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-24T09:00:00.000Z', cliente: cl.id })).json; await coda(K);
    assert.equal(stanze.size, 1); assert.match((await K.chiama('GET', `/api/dati/appuntamenti/${b.id}`)).json.note, /^Whereby: https:\/\/studio\.whereby\.com\/studiorossi3abc\n/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Teams (riunioni): codice del dispositivo, riunione online con il link nelle note, spostata con PATCH, annullata con DELETE', async () => {
  const K = await kubo(['studio']), riunioni = new Map(); let n = 0;
  const S = await finto({
    'POST /:tenant/oauth2/v2.0/devicecode': () => ({ device_code: 'dc-1', user_code: 'TEAM-1234', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900 }),
    'POST /:tenant/oauth2/v2.0/token': (p, c) => (c.device_code === 'dc-1' ? { access_token: 'tok-ms', refresh_token: 'rt-ms', expires_in: 3600 } : { stato: 400, corpo: { error: 'invalid_grant' } }),
    'GET /v1.0/me': () => ({ displayName: 'Dott. Bianchi', userPrincipalName: 'bianchi@studiobianchi.onmicrosoft.com' }),
    'POST /v1.0/me/onlineMeetings': (p, c) => { const id = `MSo${++n}`; riunioni.set(id, { ...c, id, joinWebUrl: `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${id}%40thread.v2/0` }); return { stato: 201, corpo: riunioni.get(id) }; },
    'PATCH /v1.0/me/onlineMeetings/:id': (p, c) => { const m = riunioni.get(p.id); if (!m) return { stato: 404, corpo: {} }; Object.assign(m, c); return m; },
    'DELETE /v1.0/me/onlineMeetings/:id': p => { riunioni.delete(p.id); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 'teams-riunioni', { base: S.url, segreti: { client_id: 'app-5678' } });
    const d = await K.chiama('POST', '/api/connettori/teams-riunioni/oauth/dispositivo'); assert.equal(d.stato, 200, JSON.stringify(d.json)); assert.equal(d.json.codice, 'TEAM-1234');
    assert.equal(S.chiamate[0].percorso, '/organizations/oauth2/v2.0/devicecode'); assert.match(S.chiamate[0].corpo.scope, /OnlineMeetings\.ReadWrite/);
    assert.equal((await K.chiama('POST', '/api/connettori/teams-riunioni/oauth/dispositivo/controlla')).json.collegato, true);
    assert.equal((await K.chiama('POST', '/api/connettori/teams-riunioni/prova')).json.ok, true);
    const sv = (await K.chiama('POST', '/api/dati/servizi', { nome: 'Consulenza', durata: 30 })).json;
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Marco Neri' })).json;
    const a = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-22T08:00:00.000Z', cliente: cl.id, servizio: sv.id })).json;
    await coda(K); assert.equal(riunioni.size, 0);
    const ant = (await K.chiama('POST', '/api/connettori/teams-riunioni/azioni/crea_riunione', { args: { appuntamento: a.id }, anteprima: true })).json;
    assert.equal(ant.righe[0][1], 'Marco Neri · Consulenza'); assert.deepEqual(ant.avvisi, []);
    const r = (await K.chiama('POST', '/api/connettori/teams-riunioni/azioni/crea_riunione', { args: { appuntamento: a.id } })).json;
    assert.equal(r.id, 'MSo1'); assert.equal(S.chiamate.at(-1).intestazioni.authorization, 'Bearer tok-ms');
    assert.deepEqual(S.chiamate.at(-1).corpo, { startDateTime: '2026-10-22T08:00:00.000Z', endDateTime: '2026-10-22T08:30:00.000Z', subject: 'Marco Neri · Consulenza' });
    assert.equal((await K.chiama('GET', `/api/dati/appuntamenti/${a.id}`)).json.note, `Teams: ${riunioni.get('MSo1').joinWebUrl}`);
    // spostato: stessa riunione, orari nuovi
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { quando: '2026-10-23T14:00:00.000Z' }); await coda(K);
    assert.equal(riunioni.size, 1); assert.equal(riunioni.get('MSo1').startDateTime, '2026-10-23T14:00:00.000Z'); assert.equal(riunioni.get('MSo1').endDateTime, '2026-10-23T14:30:00.000Z');
    // annullato: la riunione si cancella
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { stato: 'annullato' }); await coda(K);
    assert.equal(riunioni.size, 0);
  } finally { await K.chiudi(); await S.chiudi(); }
});
