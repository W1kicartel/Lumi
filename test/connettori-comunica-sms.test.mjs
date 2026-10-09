// I connettori di email e SMS ai clienti: Brevo (email, SMS, lista dei contatti con il consenso, webhook delle
// disiscrizioni), Twilio (SMS, firma X-Twilio-Signature col vettore ufficiale), Skebby (token, SMS, crediti),
// e il promemoria degli appuntamenti del giorno dopo. Solo finti server locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';
import { FUSO } from '../server/moduli/agenda-aggregati.js';
import { firmaTwilio } from '../connettori/twilio/connettore.js';
import { e164 } from '../connettori/_comunica/telefono.js';
import { pezzi } from '../connettori/_comunica/sms.js';

const domaniAlle = hhZ => `${new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: FUSO })}T${hhZ}:00:00Z`;

test('numeri E.164 e lunghezza degli SMS', () => {
  assert.equal(e164('333 123 4567'), '+393331234567'); assert.equal(e164('0039 333-1234567'), '+393331234567');
  assert.equal(e164('02 1234567'), '+39021234567'); assert.equal(e164('+44 7700 900123'), '+447700900123'); assert.equal(e164('abc'), null);
  assert.equal(e164('0612345678', '33'), '+33612345678');
  assert.deepEqual(pezzi('x'.repeat(160)), { caratteri: 160, pezzi: 1, unicode: false });
  assert.deepEqual(pezzi('x'.repeat(161)), { caratteri: 161, pezzi: 2, unicode: false });
  assert.equal(pezzi('Ciao 😀').unicode, true); assert.equal(pezzi('Costo 5€').caratteri, 9);   // € vale due caratteri GSM
});

test('Brevo: email e SMS al cliente, lista dei contatti solo con il consenso (e solo i cambiati), promemoria, disiscrizione dal webhook', async () => {
  const K = await kubo(['studio']), CH = 'xkeysib-' + 'a1'.repeat(30) + '-AbCdEfGh12345678';
  const S = await finto({
    'GET /account': () => ({ email: 'titolare@bottega.example', plan: [{ type: 'free' }] }),
    'POST /smtp/email': () => ({ stato: 201, corpo: { messageId: '<m1@smtp-relay.mailin.fr>' } }),
    'POST /transactionalSMS/send': () => ({ stato: 201, corpo: { messageId: 1511882900176220 } }),
    'POST /contacts/import': () => ({ stato: 202, corpo: { processId: 78 } }),
  });
  try {
    const pag = await accendi(K, 'brevo', { base: S.url, segreti: { chiave: CH }, impostazioni: { mittente_email: 'info@bottega.example', mittente_nome: 'Bottega', mittente_sms: 'Bottega', lista: 4, promemoria: true } });
    assert.match((await K.chiama('POST', '/api/connettori/brevo/prova')).json.messaggio, /titolare@bottega\.example · free/);
    assert.equal(S.chiamate[0].intestazioni['api-key'], CH);
    const anna = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it', telefono: '333 123 4567', consenso: true })).json;
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Neri', email: 'luca@esempio.it', consenso: false });
    // «manda un'email ad Anna»: anteprima, poi invio
    const ant = (await K.chiama('POST', '/api/connettori/brevo/azioni/manda_email', { args: { cliente: anna.id, oggetto: 'Ordine pronto', testo: 'Ciao Anna,\nil tuo ordine è pronto.' }, anteprima: true })).json;
    assert.deepEqual(ant.avvisi, []); assert.equal(ant.righe[0][1], 'Anna Bianchi <anna@esempio.it>');
    const em = await K.chiama('POST', '/api/connettori/brevo/azioni/manda_email', { args: { cliente: anna.id, oggetto: 'Ordine pronto', testo: 'Ciao Anna,\nil tuo ordine è pronto.' } });
    assert.equal(em.stato, 200, JSON.stringify(em.json));
    const ce = S.chiamate.find(c => c.percorso === '/smtp/email').corpo;
    assert.deepEqual(ce.sender, { email: 'info@bottega.example', name: 'Bottega' }); assert.equal(ce.to[0].email, 'anna@esempio.it'); assert.equal(ce.htmlContent, '<p>Ciao Anna,<br>il tuo ordine è pronto.</p>');
    // «manda un SMS ad Anna per dire che l'ordine è pronto»
    const s = await K.chiama('POST', '/api/connettori/brevo/azioni/manda_sms', { args: { cliente: anna.id, testo: 'Il tuo ordine è pronto' } });
    assert.equal(s.json.a, '+393331234567');
    assert.deepEqual(S.chiamate.find(c => c.percorso === '/transactionalSMS/send').corpo, { sender: 'Bottega', recipient: '393331234567', content: 'Il tuo ordine è pronto', type: 'transactional', tag: 'kubo', unicodeEnabled: false });
    // la lista: solo Anna (Luca non ha il consenso); il secondo giro non rimanda niente
    const g = await K.chiama('POST', '/api/connettori/brevo/giri/contatti'); assert.deepEqual(g.json.risultato, { mandati: 1 }, JSON.stringify(g.json));
    const imp = S.chiamate.find(c => c.percorso === '/contacts/import').corpo;
    assert.deepEqual(imp, { jsonBody: [{ email: 'anna@esempio.it', attributes: { FIRSTNAME: 'Anna', LASTNAME: 'Bianchi', SMS: '+393331234567' } }], listIds: [4], updateExistingContacts: true, emptyContactsAttributes: false });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/brevo/giri/contatti')).json.risultato, { mandati: 0 });
    // promemoria: l'appuntamento di domani, una volta sola
    await K.chiama('POST', '/api/dati/appuntamenti', { quando: domaniAlle('13'), cliente: anna.id });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/brevo/giri/promemoria')).json.risultato, { mandati: 1, senza_numero: 0 });
    assert.match(S.chiamate.filter(c => c.percorso === '/transactionalSMS/send').at(-1).corpo.content, /^Promemoria: Anna, ti aspettiamo .+ Bottega$/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/brevo/giri/promemoria')).json.risultato, { mandati: 0, senza_numero: 0 });
    // il webhook delle disiscrizioni: codice segreto in fondo all'indirizzo
    const codice = pag.impostazioni.find(i => i.id === 'webhook').valore, ev = JSON.stringify({ event: 'unsubscribed', email: 'anna@esempio.it', 'message-id': '<m1>' });
    assert.equal((await manda(K, '/api/connettori/brevo/in/sbagliato', ev)).stato, 401);
    assert.equal((await manda(K, `/api/connettori/brevo/in/${codice}`, ev)).json.esito, 'consenso tolto: Anna Bianchi');
    assert.equal((await K.chiama('GET', `/api/dati/clienti/${anna.id}`)).json.consenso, false);
    assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/brevo')).json).includes(CH));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Twilio: vettore ufficiale della firma, SMS con lo StatusCallback, stato della consegna firmato, SMS in arrivo', async () => {
  // https://www.twilio.com/docs/usage/security#validating-requests
  assert.equal(firmaTwilio('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' }), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  const K = await kubo(['studio']), SID = 'AC' + '0a'.repeat(16), TOK = 'f0'.repeat(16), PUB = 'https://kubo.bottega.example';
  const S = await finto({
    'POST /2010-04-01/Accounts/:sid/Messages.json': (p, c) => ({ stato: 201, corpo: { sid: 'SM' + '1'.repeat(32), status: 'queued', to: c.To } }),
    'GET /2010-04-01/Accounts/:sid.json': p => ({ sid: p.sid, friendly_name: 'Bottega', status: 'active' }),
  });
  try {
    await accendi(K, 'twilio', { base: S.url, segreti: { token: TOK }, impostazioni: { sid: SID, mittente: '+15005550006', pubblico: PUB } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/twilio/prova')).json, { ok: true, messaggio: 'Bottega (active)' });
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Marco Verdi', telefono: '347 7654321' })).json;
    const r = await K.chiama('POST', '/api/connettori/twilio/azioni/manda_sms', { args: { cliente: cl.id, testo: 'La tua auto è pronta' } });
    assert.equal(r.json.a, '+393477654321'); assert.equal(r.json.stato, 'queued');
    const c = S.chiamate.find(x => x.metodo === 'POST');
    assert.equal(c.percorso, `/2010-04-01/Accounts/${SID}/Messages.json`); assert.equal(c.intestazioni.authorization, 'Basic ' + Buffer.from(`${SID}:${TOK}`).toString('base64'));
    assert.deepEqual(c.corpo, { To: '+393477654321', Body: 'La tua auto è pronta', From: '+15005550006', StatusCallback: `${PUB}/api/connettori/twilio/in` });
    // lo stato della consegna, firmato sull'indirizzo pubblico
    const p = { MessageSid: 'SM' + '1'.repeat(32), MessageStatus: 'undelivered', To: '+393477654321', ErrorCode: '30003', AccountSid: SID }, corpo = new URLSearchParams(p).toString(), H = { 'Content-Type': 'application/x-www-form-urlencoded' };
    assert.equal((await manda(K, '/api/connettori/twilio/in', corpo, { ...H, 'X-Twilio-Signature': firmaTwilio(TOK, 'https://altro.example/api/connettori/twilio/in', p) })).stato, 401);
    const ok = await manda(K, '/api/connettori/twilio/in', corpo, { ...H, 'X-Twilio-Signature': firmaTwilio(TOK, `${PUB}/api/connettori/twilio/in`, p) });
    assert.equal(ok.json.esito, 'non consegnato: +393477654321', JSON.stringify(ok.json));
    assert.ok((await K.chiama('GET', '/api/connettori/twilio')).json.registro.some(x => /non è stato consegnato \(errore 30003\)/.test(x.titolo)));
    // un SMS in arrivo da un cliente (numero scritto all'italiana nella scheda)
    const q = { MessageSid: 'SM' + '2'.repeat(32), SmsStatus: 'received', From: '+393477654321', To: '+15005550006', Body: 'Passo alle 18' }, cq = new URLSearchParams(q).toString();
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { telefono: '3477654321' });
    assert.equal((await manda(K, '/api/connettori/twilio/in', cq, { ...H, 'X-Twilio-Signature': firmaTwilio(TOK, `${PUB}/api/connettori/twilio/in`, q) })).json.esito, 'SMS ricevuto da Marco Verdi');
    // senza indirizzo pubblico la firma non si può verificare: 401
    await K.chiama('PUT', '/api/connettori/twilio', { impostazioni: { pubblico: null } });
    assert.equal((await manda(K, '/api/connettori/twilio/in', cq, { ...H, 'X-Twilio-Signature': firmaTwilio(TOK, `${PUB}/api/connettori/twilio/in`, q) })).stato, 401);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Skebby: token con le credenziali (una volta), SMS di alta qualità con il mittente, crediti nella prova, cliente senza numero', async () => {
  const K = await kubo(['negozio']); let token = 0;
  const S = await finto({
    'GET /API/v1.0/REST/token': (p, c, { intestazioni }) => (intestazioni.authorization === 'Basic ' + Buffer.from('titolare@bottega.example:pw-skebby').toString('base64') ? { stato: 200, corpo: `UK${++token};AT${token}` } : { stato: 401, corpo: '' }),
    'POST /API/v1.0/REST/sms': (p, c, { intestazioni }) => (intestazioni.access_token === 'AT1' ? { stato: 201, corpo: { result: 'OK', order_id: 'ORD-1', total_sent: 1, remaining_credits: 99 } } : { stato: 401, corpo: {} }),
    'GET /API/v1.0/REST/status': () => ({ money: null, sms: [{ type: 'GP', quantity: 99 }, { type: 'SI', quantity: 0 }] }),
  });
  try {
    await accendi(K, 'skebby', { base: S.url, segreti: { password: 'pw-skebby' }, impostazioni: { utente: 'titolare@bottega.example', mittente: 'Bottega' } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/skebby/prova')).json, { ok: true, messaggio: 'GP: 99 · SI: 0' });
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Giulia Rossi', telefono: '+39 340 1112223' })).json;
    const r = await K.chiama('POST', '/api/connettori/skebby/azioni/manda_sms', { args: { cliente: cl.id, testo: 'Il vaso che aspettavi è arrivato' } });
    assert.deepEqual(r.json, { a: '+393401112223', id: 'ORD-1', crediti: 99 });
    const c = S.chiamate.find(x => x.percorso === '/API/v1.0/REST/sms');
    assert.equal(c.intestazioni.user_key, 'UK1');
    assert.deepEqual(c.corpo, { message_type: 'GP', message: 'Il vaso che aspettavi è arrivato', recipient: ['+393401112223'], sender: 'Bottega', returnCredits: true });
    assert.equal(token, 1);   // il token non scade: chiesto una volta
    const senza = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Senza Numero' })).json;
    assert.deepEqual((await K.chiama('POST', '/api/connettori/skebby/azioni/manda_sms', { args: { cliente: senza.id, testo: 'x' }, anteprima: true })).json.avvisi, ['Il cliente non ha un numero di telefono valido']);
    assert.equal((await K.chiama('POST', '/api/connettori/skebby/azioni/manda_sms', { args: { cliente: senza.id, testo: 'x' } })).stato, 502);
  } finally { await K.chiudi(); await S.chiudi(); }
});
