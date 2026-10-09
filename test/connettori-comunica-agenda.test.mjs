// I connettori dell'agenda: CalDAV (iCloud, Nextcloud…), Outlook (Microsoft Graph), Calendly, Cal.com.
// Tutti contro finti servizi locali, con il modello «studio» (clienti, servizi, appuntamenti). Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';
import { leggiIcs, vevento, sposta, spiega, dataIcs } from '../connettori/_comunica/caldav.js';
import { firmaCalendly, firmaCalendlyDi } from '../connettori/calendly/connettore.js';

const pausa = ms => new Promise(r => setTimeout(r, ms));
const coda = async K => { await pausa(50); await K.nucleo.lavora(); };
const appuntamenti = async K => (await K.chiama('GET', '/api/dati/appuntamenti?perPagina=100')).json.righe;
const clienti = async K => (await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe;

test('ICS: righe piegate, TZID, UTC, tutto il giorno, caratteri protetti, invitati; vevento piegato a 75 ottetti; sposta tiene il resto', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE', 'TZID:Europe/Rome', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:ev-1@esempio', 'DTSTART;TZID=Europe/Rome:20261010T100000', 'DTEND;TZID=Europe/Rome:20261010T103000',
    'SUMMARY:Visita\\, controllo', ' annuale', 'DESCRIPTION:riga uno\\nriga due', 'ATTENDEE;CN="Rossi: Anna";PARTSTAT=ACCEPTED:mailto:Anna@Esempio.it',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DESCRIPTION:promemoria', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:ev-2', 'DTSTART:20261225T090000Z', 'DTEND:20261225T100000Z', 'SUMMARY:Natale', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:ev-3', 'DTSTART;VALUE=DATE:20261101', 'SUMMARY:Ferie', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const [a, b, c] = leggiIcs(ics);
  assert.equal(a.uid, 'ev-1@esempio'); assert.equal(a.titolo, 'Visita, controlloannuale'); assert.equal(a.descrizione, 'riga uno\nriga due');
  assert.equal(a.inizio, '2026-10-10T08:00:00.000Z'); assert.equal(a.fine, '2026-10-10T08:30:00.000Z');   // ora legale: +2
  assert.deepEqual(a.partecipanti, [{ email: 'anna@esempio.it', nome: 'Rossi: Anna' }]);
  assert.equal(b.inizio, '2026-12-25T09:00:00.000Z'); assert.equal(c.tutto, true);
  assert.equal(dataIcs('20261210T100000', { TZID: 'Europe/Rome' }).iso, '2026-12-10T09:00:00.000Z');   // ora solare: +1
  assert.equal(dataIcs('20261210T100000', { TZID: 'W. Europe Standard Time' }, 'Europe/Rome').iso, '2026-12-10T09:00:00.000Z');   // fuso di Windows → quello di Kubo
  const v = vevento({ uid: 'kubo-1@kubo', inizio: '2026-10-10T08:00:00Z', fine: '2026-10-10T09:00:00Z', titolo: 'Àèìòù '.repeat(30), descrizione: 'a;b,c\nd' });
  assert.ok(v.split('\r\n').every(l => Buffer.byteLength(l) <= 75)); assert.ok(v.endsWith('END:VCALENDAR\r\n'));
  const [x] = leggiIcs(v); assert.equal(x.titolo, 'Àèìòù '.repeat(30)); assert.equal(x.descrizione, 'a;b,c\nd'); assert.equal(x.inizio, '2026-10-10T08:00:00.000Z');
  const s = sposta(ics, '2026-10-11T07:00:00Z', '2026-10-11T08:00:00Z'), [y, z] = leggiIcs(s);
  assert.equal(y.inizio, '2026-10-11T07:00:00.000Z'); assert.equal(y.fine, '2026-10-11T08:00:00.000Z'); assert.equal(y.partecipanti.length, 1);
  assert.equal(z.inizio, '2026-12-25T09:00:00.000Z'); assert.ok(spiega(s).includes('DTSTART:19701025T030000'));   // VTIMEZONE e secondo evento intatti
});

test('Calendly: firma giusta, sbagliata, scaduta; prenotazione → cliente + appuntamento con servizio; spostamento; annullamento; registra il webhook', async () => {
  const K = await kubo(['studio']); let iscritto = null;
  const S = await finto({
    'GET /users/me': () => ({ resource: { uri: 'https://api.calendly.com/users/U1', name: 'Studio Bianchi', current_organization: 'https://api.calendly.com/organizations/O1' } }),
    'POST /webhook_subscriptions': (p, c) => { iscritto = c; return { stato: 201, corpo: { resource: { uri: 'https://api.calendly.com/webhook_subscriptions/W1' } } }; },
  });
  try {
    await K.chiama('POST', '/api/dati/servizi', { nome: 'Pulizia dei denti', durata: 45, prezzo: 8000, attivo: true });
    await accendi(K, 'calendly', { base: S.url, segreti: { token: 'pat_prova' }, impostazioni: { indirizzo: 'https://kubo.studiobianchi.it' } });
    const chiave = K.nucleo.segreto('calendly', 'firma'); assert.ok(chiave?.length >= 20);   // la genera Kubo
    const ev = (evento, p) => JSON.stringify({ event: evento, created_at: '2026-10-09T10:00:00.000000Z', payload: p });
    const prenota = ev('invitee.created', { uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1', email: 'Giulia.Verdi@esempio.it', name: 'Giulia Verdi', status: 'active',
      scheduled_event: { uri: 'https://api.calendly.com/scheduled_events/E1', name: 'Pulizia dei denti', start_time: '2026-10-20T08:00:00.000000Z', end_time: '2026-10-20T08:45:00.000000Z' },
      questions_and_answers: [{ question: 'Allergie?', answer: 'Nessuna' }], old_invitee: null, rescheduled: false });
    // la firma: sbagliata, scaduta (10 minuti fa), su un corpo diverso → 401
    assert.equal((await manda(K, '/api/connettori/calendly/in', prenota, { 'Calendly-Webhook-Signature': firmaCalendlyDi('altra-chiave', prenota) })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/calendly/in', prenota, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, prenota, Math.floor(Date.now() / 1000) - 600) })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/calendly/in', prenota, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, prenota + ' ') })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/calendly/in', prenota)).stato, 401);
    assert.equal(firmaCalendly('t=abc,v1=00', Buffer.from(prenota), chiave), false);
    const r = await manda(K, '/api/connettori/calendly/in', prenota, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, prenota) });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'creato');
    assert.equal((await manda(K, '/api/connettori/calendly/in', prenota, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, prenota) })).json.doppione, true);
    const [cl] = await clienti(K); assert.equal(cl.email, 'giulia.verdi@esempio.it'); assert.equal(cl.nome, 'Giulia Verdi');
    let [a] = await appuntamenti(K);
    assert.equal(a.quando, '2026-10-20T08:00:00.000Z'); assert.equal(a.cliente?.id, cl.id); assert.equal(a.servizio?.titolo, 'Pulizia dei denti');
    assert.match(a.note, /Allergie\?: Nessuna/); assert.equal(a.modificato_da || a.creato_da, 'servizio:calendly');
    // spostamento: Calendly annulla il vecchio invitato (rescheduled) e ne crea uno nuovo con old_invitee
    const via = ev('invitee.canceled', { uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1', email: 'giulia.verdi@esempio.it', rescheduled: true, scheduled_event: { start_time: '2026-10-20T08:00:00Z' } });
    assert.match((await manda(K, '/api/connettori/calendly/in', via, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, via) })).json.esito, /^ignorato/);
    const nuovo = ev('invitee.created', { uri: 'https://api.calendly.com/scheduled_events/E2/invitees/I2', email: 'giulia.verdi@esempio.it', name: 'Giulia Verdi', old_invitee: 'https://api.calendly.com/scheduled_events/E1/invitees/I1',
      scheduled_event: { name: 'Pulizia dei denti', start_time: '2026-10-22T13:30:00.000000Z' } });
    assert.equal((await manda(K, '/api/connettori/calendly/in', nuovo, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, nuovo) })).json.esito, 'spostato');
    const tutti = await appuntamenti(K); assert.equal(tutti.length, 1); assert.equal(tutti[0].quando, '2026-10-22T13:30:00.000Z'); assert.equal((await clienti(K)).length, 1);
    const annulla = ev('invitee.canceled', { uri: 'https://api.calendly.com/scheduled_events/E2/invitees/I2', rescheduled: false, cancellation: { reason: 'impegno' } });
    assert.equal((await manda(K, '/api/connettori/calendly/in', annulla, { 'Calendly-Webhook-Signature': firmaCalendlyDi(chiave, annulla) })).json.esito, 'annullato');
    assert.equal((await appuntamenti(K))[0].stato, 'annullato');
    // registra il webhook: anteprima, poi la sottoscrizione con la chiave di firma di Kubo
    const ant = await K.chiama('POST', '/api/connettori/calendly/azioni/registra_webhook', { args: {}, anteprima: true });
    assert.equal(ant.json.righe[0][1], 'https://kubo.studiobianchi.it/api/connettori/calendly/in');
    const reg = await K.chiama('POST', '/api/connettori/calendly/azioni/registra_webhook', { args: {} }); assert.equal(reg.stato, 200, JSON.stringify(reg.json));
    assert.deepEqual(iscritto.events, ['invitee.created', 'invitee.canceled']); assert.equal(iscritto.signing_key, chiave); assert.equal(iscritto.scope, 'user');
    assert.equal(iscritto.organization, 'https://api.calendly.com/organizations/O1'); assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer pat_prova');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Cal.com: firma esadecimale, cliente già presente trovato per email, spostamento con rescheduleUid, annullamento', async () => {
  const K = await kubo(['studio']);
  try {
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Marco Neri', email: 'marco.neri@esempio.it' })).json;
    await accendi(K, 'cal-com', {});
    const segreto = K.nucleo.segreto('cal-com', 'segreto');
    const ev = (t, p) => JSON.stringify({ triggerEvent: t, createdAt: '2026-10-09T10:00:00.000Z', payload: p });
    const crea = ev('BOOKING_CREATED', { uid: 'bk-1', title: 'Consulenza tra Studio e Marco Neri', startTime: '2026-10-21T15:00:00Z', endTime: '2026-10-21T15:30:00Z', additionalNotes: 'Porto le lastre',
      attendees: [{ email: 'Marco.Neri@esempio.it', name: 'Marco Neri', timeZone: 'Europe/Rome' }] });
    assert.equal((await manda(K, '/api/connettori/cal-com/in', crea, { 'X-Cal-Signature-256': firmaHmacDi('sbagliato', crea, 'hex') })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/cal-com/in', crea, { 'X-Cal-Signature-256': firmaHmacDi(segreto, crea, 'base64') })).stato, 401);
    const r = await manda(K, '/api/connettori/cal-com/in', crea, { 'X-Cal-Signature-256': firmaHmacDi(segreto, crea, 'hex') });
    assert.equal(r.json?.esito, 'creato', JSON.stringify(r.json));
    assert.equal((await clienti(K)).length, 1);   // trovato, non duplicato
    let [a] = await appuntamenti(K); assert.equal(a.cliente?.id, cl.id); assert.match(a.note, /Porto le lastre/);
    const sposta = ev('BOOKING_RESCHEDULED', { uid: 'bk-2', rescheduleUid: 'bk-1', startTime: '2026-10-23T09:00:00Z', attendees: [{ email: 'marco.neri@esempio.it', name: 'Marco Neri' }] });
    assert.equal((await manda(K, '/api/connettori/cal-com/in', sposta, { 'X-Cal-Signature-256': firmaHmacDi(segreto, sposta, 'hex') })).json.esito, 'spostato');
    const tutti = await appuntamenti(K); assert.equal(tutti.length, 1); assert.equal(tutti[0].quando, '2026-10-23T09:00:00.000Z');
    const via = ev('BOOKING_CANCELLED', { uid: 'bk-2', startTime: '2026-10-23T09:00:00Z' });
    assert.equal((await manda(K, '/api/connettori/cal-com/in', via, { 'X-Cal-Signature-256': firmaHmacDi(segreto, via, 'hex') })).json.esito, 'annullato');
    assert.equal((await appuntamenti(K))[0].stato, 'annullato');
    const ping = ev('PING', {}); assert.match((await manda(K, '/api/connettori/cal-com/in', ping, { 'X-Cal-Signature-256': firmaHmacDi(segreto, ping, 'hex') })).json.esito, /^ignorato/);
  } finally { await K.chiudi(); }
});

test('Outlook: codice del dispositivo sul tenant scelto, appuntamenti → eventi (crea, sposta, annulla), delta → appuntamenti senza eco', async () => {
  const K = await kubo(['studio']), eventi = new Map(); let n = 0, giro = 0;
  const S = await finto({
    'POST /:tenant/oauth2/v2.0/devicecode': (p, c) => ({ device_code: 'dc-1', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900 }),
    'POST /:tenant/oauth2/v2.0/token': (p, c) => (c.device_code === 'dc-1' ? { access_token: 'tok-ms', refresh_token: 'rt-ms', expires_in: 3600 } : { stato: 400, corpo: { error: 'invalid_grant' } }),
    'GET /v1.0/me/calendar': () => ({ name: 'Calendario' }),
    'POST /v1.0/me/events': (p, c) => { const id = `AAMk-${++n}`; eventi.set(id, { ...c, id, changeKey: `ck-${id}-1` }); return { stato: 201, corpo: eventi.get(id) }; },
    'PATCH /v1.0/me/events/:id': (p, c) => { const e = eventi.get(p.id); if (!e) return { stato: 404, corpo: {} }; Object.assign(e, c, { changeKey: e.changeKey + '+' }); return e; },
    'DELETE /v1.0/me/events/:id': p => { eventi.delete(p.id); return { stato: 204, corpo: '' }; },
    'GET /v1.0/me/calendarView/delta': (p, c, { q }) => {
      giro++;
      if (q.get('$skiptoken') === 'pag2') return { value: [...eventi.values()], '@odata.deltaLink': `${S.url}/v1.0/me/calendarView/delta?$deltatoken=d1` };
      if (q.get('$deltatoken') === 'd1') { eventi.delete('AAMk-1'); return { value: [
        { id: 'AAMk-esterno', changeKey: 'ck-x-2', subject: 'Visita Laura', start: { dateTime: '2026-10-24T10:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-24T11:00:00.0000000', timeZone: 'UTC' } },
        { id: 'AAMk-1', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': `${S.url}/v1.0/me/calendarView/delta?$deltatoken=d2` }; }
      return { value: [
        { id: 'AAMk-esterno', changeKey: 'ck-x-1', subject: 'Visita Laura', bodyPreview: 'prima visita', isAllDay: false, start: { dateTime: '2026-10-23T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-23T15:00:00.0000000', timeZone: 'UTC' },
          attendees: [{ emailAddress: { name: 'Laura Gialli', address: 'laura.gialli@esempio.it' }, type: 'required' }] },
        { id: 'AAMk-solo', changeKey: 'ck-s', subject: 'Commercialista', start: { dateTime: '2026-10-25T10:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-25T11:00:00.0000000', timeZone: 'UTC' } },
        { id: 'AAMk-ferie', changeKey: 'ck-f', subject: 'Ferie', isAllDay: true, start: { dateTime: '2026-11-01T00:00:00.0000000', timeZone: 'UTC' } }],
        '@odata.nextLink': `${S.url}/v1.0/me/calendarView/delta?$skiptoken=pag2` };
    },
  });
  try {
    await accendi(K, 'outlook', { base: S.url, segreti: { client_id: 'app-1234' }, impostazioni: { tenant: 'consumers' } });
    const d = await K.chiama('POST', '/api/connettori/outlook/oauth/dispositivo'); assert.equal(d.stato, 200, JSON.stringify(d.json)); assert.equal(d.json.codice, 'ABCD-EFGH');
    assert.equal(S.chiamate[0].percorso, '/consumers/oauth2/v2.0/devicecode'); assert.equal(S.chiamate[0].corpo.client_id, 'app-1234'); assert.match(S.chiamate[0].corpo.scope, /Calendars\.ReadWrite/);
    assert.equal((await K.chiama('POST', '/api/connettori/outlook/oauth/dispositivo/controlla')).json.collegato, true);
    assert.equal((await K.chiama('POST', '/api/connettori/outlook/prova')).json.ok, true);
    // Kubo → Outlook
    const sv = (await K.chiama('POST', '/api/dati/servizi', { nome: 'Igiene', durata: 30 })).json;
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Paolo Blu', email: 'paolo.blu@esempio.it' })).json;
    const a = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-22T08:00:00.000Z', cliente: cl.id, servizio: sv.id, note: 'Portare referto' })).json;
    await coda(K);
    const e1 = eventi.get('AAMk-1'); assert.ok(e1, JSON.stringify(S.chiamate.at(-1)));
    assert.equal(e1.subject, 'Paolo Blu · Igiene'); assert.deepEqual(e1.start, { dateTime: '2026-10-22T08:00:00', timeZone: 'UTC' }); assert.deepEqual(e1.end, { dateTime: '2026-10-22T08:30:00', timeZone: 'UTC' });
    assert.equal(e1.body.content, 'Portare referto'); assert.equal(S.chiamate.at(-1).intestazioni.authorization, 'Bearer tok-ms'); assert.ok(!e1.attendees);   // nessun invito parte al cliente
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { quando: '2026-10-22T09:00:00.000Z' }); await coda(K);
    assert.equal(eventi.get('AAMk-1').start.dateTime, '2026-10-22T09:00:00'); assert.equal(eventi.size, 1);
    // Outlook → Kubo: il primo giro (due pagine) porta l'evento esterno con il cliente; il nostro torna ma non si duplica
    const g = await K.chiama('POST', '/api/connettori/outlook/giri/sincronizza'); assert.equal(g.json.esito, 'ok', JSON.stringify(g.json));
    assert.equal(g.json.risultato.creati, 1); assert.equal(g.json.risultato.uguali, 1);
    assert.equal(g.json.risultato.saltati, 1);   // senza invitati: nel modello «studio» il cliente è obbligatorio, l'evento resta solo in Outlook
    assert.equal(S.chiamate.find(c => c.percorso.endsWith('/delta')).intestazioni.prefer, 'outlook.timezone="UTC", odata.maxpagesize=50');
    let tutti = await appuntamenti(K); assert.equal(tutti.length, 2);
    const est = tutti.find(x => x.id !== a.id); assert.equal(est.quando, '2026-10-23T14:00:00.000Z'); assert.match(est.note, /Visita Laura/);
    assert.equal((await clienti(K)).find(c => c.email === 'laura.gialli@esempio.it')?.nome, 'Laura Gialli');
    await coda(K); assert.equal(eventi.size, 1);   // l'appuntamento arrivato da Outlook non ci torna (anti-eco)
    // il secondo giro riparte dal deltaLink: l'esterno spostato, il nostro cancellato in Outlook → annullato in Kubo
    const g2 = await K.chiama('POST', '/api/connettori/outlook/giri/sincronizza'); assert.deepEqual(g2.json.risultato, { creati: 0, spostati: 1, annullati: 1, uguali: 0, saltati: 0 });
    assert.equal(S.chiamate.filter(c => c.percorso.endsWith('/delta')).at(-1).q.$deltatoken, 'd1');
    tutti = await appuntamenti(K); assert.equal(tutti.find(x => x.id === est.id).quando, '2026-10-24T10:00:00.000Z'); assert.equal(tutti.find(x => x.id === a.id).stato, 'annullato');
    await coda(K); assert.equal(eventi.size, 0);   // l'annullamento arrivato da Outlook non riparte
    // riaperto in Kubo: l'evento tolto da Outlook si ricrea; annullato in Kubo: si toglie
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { stato: 'confermato' }); await coda(K);
    assert.ok(eventi.has('AAMk-2'), JSON.stringify([...eventi.keys()]));
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { stato: 'annullato' }); await coda(K);
    assert.ok(!eventi.has('AAMk-2')); assert.equal(S.chiamate.at(-1).metodo, 'DELETE');
    assert.ok(giro >= 3);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('CalDAV: scoperta del calendario (principal → home → calendari), PUT con If-None-Match/If-Match, REPORT con ETag senza eco, spostamenti e cancellazioni nei due sensi', async () => {
  const K = await kubo(['studio']), cal = new Map(); let v = 0;
  const ms = x => ({ stato: 207, intestazioni: { 'Content-Type': 'application/xml; charset=utf-8' }, corpo: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${x}</d:multistatus>` });
  const metti = (nome, ics) => cal.set(nome, { ics, etag: `"e${++v}"` });
  metti('esterno.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:ext-1@icloud', 'DTSTART;TZID=Europe/Rome:20261020T100000', 'DTEND;TZID=Europe/Rome:20261020T110000', 'SUMMARY:Controllo Sara',
    'ATTENDEE;CN=Sara Viola:mailto:sara.viola@esempio.it', 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  const S = await finto({
    'PROPFIND /': () => ms('<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'),
    'PROPFIND /123/principal/': () => ms('<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>/123/calendars/</d:href></cal:calendar-home-set></d:prop></d:propstat></d:response>'),
    'PROPFIND /123/calendars/': () => ms('<d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
      + '<d:response><d:href>/123/calendars/promemoria/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Promemoria</d:displayname><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>'
      + '<d:response><d:href>/123/calendars/casa/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Studio &amp; casa</d:displayname><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>'),
    'REPORT /123/calendars/casa/': () => ms([...cal].map(([n, x]) => `<d:response><d:href>/123/calendars/casa/${n}</d:href><d:propstat><d:prop><d:getetag>${x.etag.replace(/"/g, '&quot;')}</d:getetag><cal:calendar-data><![CDATA[${x.ics}]]></cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')),
    'GET /123/calendars/casa/:nome': p => (cal.has(p.nome) ? { stato: 200, intestazioni: { 'Content-Type': 'text/calendar', ETag: cal.get(p.nome).etag }, corpo: cal.get(p.nome).ics } : { stato: 404, corpo: '' }),
    'PUT /123/calendars/casa/:nome': (p, c, { intestazioni: h }) => {
      const x = cal.get(p.nome);
      if (h['if-none-match'] === '*' && x) return { stato: 412, corpo: '' };
      if (h['if-match'] && (!x || x.etag !== h['if-match'])) return { stato: 412, corpo: '' };
      metti(p.nome, c); return { stato: x ? 204 : 201, intestazioni: { ETag: cal.get(p.nome).etag }, corpo: '' };
    },
    'DELETE /123/calendars/casa/:nome': (p, c, { intestazioni: h }) => { const x = cal.get(p.nome); if (!x) return { stato: 404, corpo: '' }; if (h['if-match'] && h['if-match'] !== x.etag) return { stato: 412, corpo: '' }; cal.delete(p.nome); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 'caldav', { segreti: { password: 'abcd-efgh-ijkl-mnop' }, impostazioni: { server: S.url + '/', utente: 'anna@esempio.it' } });
    const p = await K.chiama('POST', '/api/connettori/caldav/prova'); assert.equal(p.json.ok, true, JSON.stringify(p.json)); assert.equal(p.json.messaggio, 'Studio & casa');
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Basic ' + Buffer.from('anna@esempio.it:abcd-efgh-ijkl-mnop').toString('base64'));
    assert.equal(S.chiamate[0].intestazioni.depth, '0'); assert.match(S.chiamate[0].corpo, /current-user-principal/);
    // calendario → Kubo: l'evento esterno diventa un appuntamento con il cliente dall'invitato
    const g = await K.chiama('POST', '/api/connettori/caldav/giri/sincronizza'); assert.equal(g.json.esito, 'ok', JSON.stringify(g.json));
    assert.deepEqual(g.json.risultato, { creati: 1, spostati: 0, annullati: 0, uguali: 0, saltati: 0 });
    const rep = S.chiamate.find(c => c.metodo === 'REPORT'); assert.equal(rep.intestazioni.depth, '1'); assert.match(rep.corpo, /<c:time-range start="\d{8}T\d{6}Z" end="\d{8}T\d{6}Z"\/>/);
    let [est] = await appuntamenti(K); assert.equal(est.quando, '2026-10-20T08:00:00.000Z'); assert.match(est.note, /Controllo Sara/);
    assert.equal((await clienti(K)).find(c => c.nome === 'Sara Viola')?.email, 'sara.viola@esempio.it');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/caldav/giri/sincronizza')).json.risultato, { creati: 0, spostati: 0, annullati: 0, uguali: 1, saltati: 0 });
    // Kubo → calendario: un appuntamento nuovo è un PUT con If-None-Match: *; il giro dopo lo rivede con lo stesso ETag (niente eco)
    const ugo = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Ugo Rosa' })).json;
    const a = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: '2026-10-21T07:30:00.000Z', cliente: ugo.id, note: 'Prima visita' })).json; await coda(K);
    const put = S.chiamate.filter(c => c.metodo === 'PUT').at(-1); assert.ok(put, JSON.stringify((await K.chiama('GET', '/api/connettori/caldav')).json.registro.slice(0, 3))); assert.equal(put.percorso, `/123/calendars/casa/kubo-${a.id}.ics`); assert.equal(put.intestazioni['if-none-match'], '*');
    assert.match(put.intestazioni['content-type'], /text\/calendar/); const [mio] = leggiIcs(put.corpo);
    assert.equal(mio.uid, `kubo-${a.id}@kubo`); assert.equal(mio.inizio, '2026-10-21T07:30:00.000Z'); assert.equal(mio.fine, '2026-10-21T08:30:00.000Z'); assert.equal(mio.descrizione, 'Prima visita'); assert.equal(mio.titolo, 'Ugo Rosa');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/caldav/giri/sincronizza')).json.risultato, { creati: 0, spostati: 0, annullati: 0, uguali: 2, saltati: 0 });
    assert.equal((await appuntamenti(K)).length, 2);
    // spostato in Kubo un evento nato nel calendario: cambia solo DTSTART/DTEND, con If-Match; invitato e promemoria restano
    const etagPrima = cal.get('esterno.ics').etag;
    await K.chiama('PATCH', `/api/dati/appuntamenti/${est.id}`, { quando: '2026-10-20T09:00:00.000Z' }); await coda(K);
    const put2 = S.chiamate.filter(c => c.metodo === 'PUT').at(-1); assert.equal(put2.percorso, '/123/calendars/casa/esterno.ics'); assert.equal(put2.intestazioni['if-match'], etagPrima);
    const [sp] = leggiIcs(cal.get('esterno.ics').ics); assert.equal(sp.inizio, '2026-10-20T09:00:00.000Z'); assert.equal(sp.partecipanti[0].email, 'sara.viola@esempio.it'); assert.match(cal.get('esterno.ics').ics, /TRIGGER:-PT30M/);
    // spostato nel calendario (nuovo ETag) → spostato in Kubo; cancellato nel calendario (404) → annullato
    metti('esterno.ics', cal.get('esterno.ics').ics.replace('DTSTART:20261020T090000Z', 'DTSTART:20261027T090000Z'));
    assert.deepEqual((await K.chiama('POST', '/api/connettori/caldav/giri/sincronizza')).json.risultato, { creati: 0, spostati: 1, annullati: 0, uguali: 1, saltati: 0 });
    assert.equal((await K.chiama('GET', `/api/dati/appuntamenti/${est.id}`)).json.quando, '2026-10-27T09:00:00.000Z');
    await coda(K); assert.equal(S.chiamate.filter(c => c.metodo === 'PUT').length, 2);   // lo spostamento arrivato dal calendario non riparte
    cal.delete('esterno.ics');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/caldav/giri/sincronizza')).json.risultato, { creati: 0, spostati: 0, annullati: 1, uguali: 1, saltati: 0 });
    assert.equal((await K.chiama('GET', `/api/dati/appuntamenti/${est.id}`)).json.stato, 'annullato');
    // annullato in Kubo → DELETE con If-Match
    await K.chiama('PATCH', `/api/dati/appuntamenti/${a.id}`, { stato: 'annullato' }); await coda(K);
    const del = S.chiamate.filter(c => c.metodo === 'DELETE').at(-1); assert.equal(del.percorso, `/123/calendars/casa/kubo-${a.id}.ics`); assert.ok(del.intestazioni['if-match']); assert.equal(cal.size, 0);
    const l = await K.chiama('POST', '/api/connettori/caldav/azioni/calendari', { args: {} }); assert.deepEqual(l.json.calendari.map(c => c.nome), ['Studio & casa']);
  } finally { await K.chiudi(); await S.chiudi(); }
});
