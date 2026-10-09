// Le email transazionali: SendGrid, Postmark, Mailgun (multipart), Resend, Amazon SES (MIME intero firmato SigV4).
// Per ognuno: prova, email al cliente, fattura con la stampa HTML e l'XML FatturaPA in allegato; mai una bozza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import { firmaV4 } from '../connettori/_comunica/sigv4.js';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email: 'rossi@cliente.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  const bozza = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-02', righe: [{ descrizione: 'Prova', quantita: 1, prezzo: 10, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return { cl, f: e.json, bozza };
}
const MITT = { mittente_email: 'fatture@bottega.example', mittente_nome: 'Bottega Prova' };

test('email transazionali: cinque servizi, email al cliente e fattura con stampa e XML in allegato, la bozza no', async () => {
  const K = await kubo(['negozio', 'fatture']), arrivi = {};
  const segna = (id, x) => { (arrivi[id] ||= []).push(x); };
  const SES = { chiave: 'AKIA' + 'A'.repeat(16), segreto: 'segreto-ses', regione: 'eu-south-1' };
  const S = await finto({
    // SendGrid
    'GET /v3/scopes': () => ({ scopes: ['mail.send'] }),
    'POST /v3/mail/send': (p, c, { intestazioni }) => { segna('sendgrid', { c, h: intestazioni }); return { stato: 202, intestazioni: { 'X-Message-Id': 'sg-1' }, corpo: '' }; },
    // Postmark
    'GET /server': (p, c, { intestazioni }) => (intestazioni['x-postmark-server-token'] ? { Name: 'Bottega' } : { stato: 401, corpo: {} }),
    'POST /email': (p, c, { intestazioni }) => { segna('postmark', { c, h: intestazioni }); return { ErrorCode: 0, Message: 'OK', MessageID: 'pm-1' }; },
    // Mailgun
    'GET /v3/domains/:d': p => ({ domain: { name: p.d, state: 'active' } }),
    'POST /v3/:d/messages': (p, c, { intestazioni }) => { segna('mailgun', { c, h: intestazioni, d: p.d }); return { id: '<mg-1@mg.bottega.example>', message: 'Queued. Thank you.' }; },
    // Resend
    'GET /domains': () => ({ stato: 401, corpo: { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' } }),
    'POST /emails': (p, c, { intestazioni }) => { segna('resend', { c, h: intestazioni }); return { id: 're-1' }; },
    // Amazon SES: il finto ricalcola la firma
    'GET /v2/email/account': () => ({ ProductionAccessEnabled: false, SendingEnabled: true }),
    'POST /v2/email/outbound-emails': (p, c, { intestazioni }) => {
      const ora = new Date(intestazioni['x-amz-date'].replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'));
      const atteso = firmaV4({ metodo: 'POST', url: `http://${intestazioni.host}/v2/email/outbound-emails`, intestazioni: { 'Content-Type': 'application/json' }, corpo: JSON.stringify(c), regione: SES.regione, servizio: 'ses', chiave: SES.chiave, segreto: SES.segreto, ora });
      if (atteso.Authorization !== intestazioni.authorization) return { stato: 403, corpo: { message: 'SignatureDoesNotMatch' } };
      segna('amazon-ses', { c, h: intestazioni }); return { MessageId: 'ses-1' };
    },
  });
  try {
    const { cl, f, bozza } = await fattura(K);
    await accendi(K, 'sendgrid', { base: S.url, segreti: { chiave: 'SG.abcdefghij1234.ABCDEFGHIJ5678' }, impostazioni: MITT });
    await accendi(K, 'postmark', { base: S.url, segreti: { token: '12345678-1234-1234-1234-123456789abc' }, impostazioni: MITT });
    await accendi(K, 'mailgun', { base: S.url, segreti: { chiave: 'key-prova-mailgun' }, impostazioni: { ...MITT, dominio: 'mg.bottega.example' } });
    await accendi(K, 'resend', { base: S.url, segreti: { chiave: 're_prova12345' }, impostazioni: MITT });
    await accendi(K, 'amazon-ses', { base: S.url, segreti: { segreto: SES.segreto }, impostazioni: { ...MITT, chiave_accesso: SES.chiave, regione: SES.regione } });
    const prove = {};
    for (const id of ['sendgrid', 'postmark', 'mailgun', 'resend', 'amazon-ses']) prove[id] = (await K.chiama('POST', `/api/connettori/${id}/prova`)).json;
    assert.deepEqual(prove, { sendgrid: { ok: true, messaggio: 'mail.send' }, postmark: { ok: true, messaggio: 'Bottega' }, mailgun: { ok: true, messaggio: 'mg.bottega.example (active)' },
      resend: { ok: true, messaggio: 'Chiave di solo invio' }, 'amazon-ses': { ok: true, messaggio: 'sandbox: solo indirizzi verificati · invio attivo' } });
    for (const id of ['sendgrid', 'postmark', 'mailgun', 'resend', 'amazon-ses']) {
      const e = await K.chiama('POST', `/api/connettori/${id}/azioni/manda_email`, { args: { cliente: cl.id, oggetto: 'Ritiro', testo: 'Buongiorno,\nil lavoro è pronto.' } });
      assert.equal(e.stato, 200, `${id} ${JSON.stringify(e.json)}`); assert.equal(e.json.a, 'rossi@cliente.example');
      // la bozza non parte, e il servizio non viene chiamato
      const n = arrivi[id].length;
      assert.match((await K.chiama('POST', `/api/connettori/${id}/azioni/invia_fattura`, { args: { doc: bozza.id }, anteprima: true })).json.avvisi.join(), /bozza/);
      assert.equal((await K.chiama('POST', `/api/connettori/${id}/azioni/invia_fattura`, { args: { doc: bozza.id } })).stato, 502); assert.equal(arrivi[id].length, n);
      const r = await K.chiama('POST', `/api/connettori/${id}/azioni/invia_fattura`, { args: { doc: f.id } });
      assert.equal(r.stato, 200, `${id} ${JSON.stringify(r.json)}`);
    }
    // SendGrid: Bearer, personalizations, due allegati in base64 (stampa e XML)
    const sg = arrivi.sendgrid; assert.equal(sg[0].h.authorization, 'Bearer SG.abcdefghij1234.ABCDEFGHIJ5678');
    assert.deepEqual(sg[0].c.personalizations, [{ to: [{ email: 'rossi@cliente.example', name: 'Rossi srl' }] }]); assert.deepEqual(sg[0].c.from, { email: 'fatture@bottega.example', name: 'Bottega Prova' });
    assert.equal(sg[0].c.content[1].value, '<p>Buongiorno,<br>il lavoro è pronto.</p>');
    const all = sg[1].c.attachments; assert.deepEqual(all.map(a => a.type), ['text/html', 'application/xml']);
    assert.match(Buffer.from(all[1].content, 'base64').toString(), /<ImportoTotaleDocumento>122\.00</); assert.match(sg[1].c.subject, /^Fattura \S+ del 01\/09\/2026$/);
    // Postmark: token nell'intestazione, From con il nome, allegati
    assert.equal(arrivi.postmark[0].c.From, 'Bottega Prova <fatture@bottega.example>'); assert.equal(arrivi.postmark[1].c.Attachments.length, 2); assert.equal(arrivi.postmark[0].c.MessageStream, 'outbound');
    // Mailgun: multipart con i file, Basic api:chiave
    const mg = arrivi.mailgun; assert.equal(mg[0].h.authorization, 'Basic ' + Buffer.from('api:key-prova-mailgun').toString('base64')); assert.match(mg[0].h['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(mg[1].c, /name="attachment"; filename="[^"]+\.xml"\r\nContent-Type: application\/xml/); assert.match(mg[0].c, /name="to"\r\n\r\nRossi srl <rossi@cliente\.example>\r\n/);
    // Resend
    assert.deepEqual(arrivi.resend[0].c.to, ['rossi@cliente.example']); assert.equal(arrivi.resend[1].c.attachments.length, 2);
    // SES: MIME intero, firmato, con gli allegati
    const mime = Buffer.from(arrivi['amazon-ses'][1].c.Content.Raw.Data, 'base64').toString();
    assert.match(mime, /^From: Bottega Prova <fatture@bottega\.example>\r\nTo: rossi@cliente\.example\r\n/); assert.match(mime, /Content-Disposition: attachment; filename="[^"]+\.xml"/);
    assert.match(arrivi['amazon-ses'][0].h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIA[A]{16}\/\d{8}\/eu-south-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    // un segreto sbagliato: SES risponde 403 e l'errore arriva leggibile
    await K.chiama('PUT', '/api/connettori/amazon-ses', { segreti: { segreto: 'sbagliato' } });
    const no = await K.chiama('POST', '/api/connettori/amazon-ses/azioni/manda_email', { args: { cliente: cl.id, oggetto: 'x', testo: 'y' } });
    assert.equal(no.stato, 502); assert.match(no.json.errore, /SignatureDoesNotMatch/);
  } finally { await K.chiudi(); await S.chiudi(); }
});
