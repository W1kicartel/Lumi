// I connettori della fatturazione (Aruba, Fatture in Cloud) contro finti servizi locali. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finto, kubo, accendi } from './connettori-finto.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, prezzo = 100) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
const PASSIVA = readFileSync(new URL('./documenti/fattura-attesa.xml', import.meta.url));

test('Aruba: un solo accesso, upload dell\'XML in base64, esito scartato segnalato, fatture passive importate una volta', async () => {
  const K = await kubo(['fatture']); let accessi = 0, caricato = null, stato = 'Inviata';
  const S = await finto({
    'POST /auth/signin': (p, c) => { accessi++; assert.equal(c.grant_type, 'password'); assert.equal(c.username, 'ARUBA123'); assert.equal(c.password, 'pw-prova'); return { access_token: 'tok-aruba', refresh_token: 'rt', expires_in: 1800 }; },
    'POST /services/invoice/upload': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'Bearer tok-aruba'); caricato = Buffer.from(c.dataFile, 'base64').toString('utf8'); return { errorCode: '0000', errorDescription: null, uploadFileName: 'IT12345678903_00001.xml.p7m' }; },
    'GET /services/invoice/out/getByFilename': (p, c, { q }) => { assert.equal(q.get('filename'), 'IT12345678903_00001.xml.p7m'); return { filename: q.get('filename'), invoices: [{ number: '1', status: stato, statusDescription: stato === 'Scartata' ? '00404 Fattura duplicata' : '' }] }; },
    'GET /services/invoice/in/findByUsername': (p, c, { q }) => { assert.equal(q.get('username'), 'ARUBA123'); return { errorCode: '0000', content: [{ filename: 'IT01234567897_AB123.xml', invoices: [{ number: 'F-77' }], sender: { description: 'Fornitore Esempio' } }], totalPages: 1 }; },
    'GET /services/invoice/in/getByFilename': (p, c, { q }) => ({ filename: q.get('filename'), file: PASSIVA.toString('base64') }),
  });
  try {
    const f = await fattura(K);
    await accendi(K, 'aruba-fe', { base: S.url, segreti: { password: 'pw-prova' }, impostazioni: { utente: 'ARUBA123' } });
    assert.equal((await K.chiama('POST', '/api/connettori/aruba-fe/prova')).json.ok, true);
    const r = await K.chiama('POST', '/api/connettori/aruba-fe/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.file, 'IT12345678903_00001.xml.p7m');
    assert.match(caricato, /<FatturaElettronica[\s\S]*Riparazione/); assert.equal(accessi, 1);   // la prova e l'invio: un solo accesso
    const dopo = (await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json; assert.equal(dopo.stato, 'inviata');
    assert.equal((await K.chiama('POST', '/api/connettori/aruba-fe/azioni/invia', { args: { fattura: f.id } })).stato, 502);   // già inviata
    assert.deepEqual((await K.chiama('POST', '/api/connettori/aruba-fe/giri/esiti')).json.risultato, { controllate: 1, cambi: [`${f.numero}: Inviata`] });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/aruba-fe/giri/esiti')).json.risultato, { controllate: 1, cambi: [] });
    stato = 'Scartata';
    assert.deepEqual((await K.chiama('POST', '/api/connettori/aruba-fe/giri/esiti')).json.risultato.cambi, [`${f.numero}: Scartata`]);
    assert.equal((await K.chiama('POST', '/api/connettori/aruba-fe/giri/esiti')).json.risultato.controllate, 0);   // lo scarto chiude la storia
    const pag = (await K.chiama('GET', '/api/connettori/aruba-fe')).json;
    assert.ok(pag.registro.some(x => /Scartata|scartata/.test(x.titolo) && /duplicata/.test(x.titolo)), JSON.stringify(pag.registro.slice(0, 3)));
    const g = await K.chiama('POST', '/api/connettori/aruba-fe/giri/passive');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.equal(g.json.risultato.importate, 1);
    assert.equal((await K.chiama('POST', '/api/connettori/aruba-fe/giri/passive')).json.risultato.importate, 0);
    const ric = (await K.chiama('GET', '/api/dati/fatture_ricevute')).json;
    assert.equal((ric.righe || ric).length, 1);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Fatture in Cloud: token manuale, clienti a pagine abbinati per partita IVA, fattura copiata con le aliquote e inviata allo SDI, spese → fatture ricevute', async () => {
  const K = await kubo(['fatture']); let documento = null, inviato = 0;
  const auth = int => assert.equal(int.authorization, 'Bearer fic-manuale');
  const S = await finto({
    'GET /user/companies': (p, c, { intestazioni }) => { auth(intestazioni); return { data: { companies: [{ id: 4242, name: 'Bottega Prova srl' }] } }; },
    'GET /c/4242/entities/clients': (p, c, { q, intestazioni }) => { auth(intestazioni); return q.get('page') === '1'
      ? { current_page: 1, last_page: 2, data: [{ id: 11, name: 'Rossi srl', vat_number: '00743110157', email: 'amministrazione@rossi.example', ei_code: 'ABC1234' }] }
      : { current_page: 2, last_page: 2, data: [{ id: 12, name: 'Verdi snc', vat_number: '01234567897', address_city: 'Bergamo' }] }; },
    'GET /c/4242/info/vat_types': () => ({ data: [{ id: 0, value: 22, is_disabled: false }, { id: 3, value: 10, is_disabled: false }, { id: 21, value: 0, ei_type: 'N2.2', is_disabled: false }] }),
    'POST /c/4242/issued_documents': (p, c) => { documento = c.data; return { data: { id: 9001 } }; },
    'POST /c/4242/issued_documents/:id/e_invoice/send': p => { inviato++; assert.equal(p.id, '9001'); return { data: { name: 'IT12345678903_a1b2c.xml', date: '2026-10-09' } }; },
    'GET /c/4242/received_documents': (p, c, { q }) => { assert.equal(q.get('type'), 'expense');
      return { data: [{ id: 501, type: 'expense', entity: { name: 'Carta & Co srl', vat_number: '07654321095' }, date: '2026-09-20', invoice_number: 'C-55', amount_net: 100, amount_vat: 22, amount_gross: 122, description: 'Cancelleria' }] }; },
  });
  try {
    const f = await fattura(K);
    await accendi(K, 'fatture-in-cloud', { base: S.url, segreti: { token: 'fic-manuale' } });
    assert.equal((await K.chiama('POST', '/api/connettori/fatture-in-cloud/prova')).json.ok, true);
    // Rossi c'è già in Kubo (stessa partita IVA): si abbina e prende email; Verdi è nuovo
    const g = await K.chiama('POST', '/api/connettori/fatture-in-cloud/giri/clienti');
    assert.deepEqual(g.json.risultato, { creati: 1, aggiornati: 1, uguali: 0 }, JSON.stringify(g.json));
    assert.deepEqual((await K.chiama('POST', '/api/connettori/fatture-in-cloud/giri/clienti')).json.risultato, { creati: 0, aggiornati: 0, uguali: 2 });
    const r = await K.chiama('POST', '/api/connettori/fatture-in-cloud/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.documento, 9001); assert.equal(inviato, 1);
    assert.equal(documento.type, 'invoice'); assert.equal(documento.entity.id, 11); assert.equal(documento.entity.vat_number, '00743110157'); assert.equal(documento.date, '2026-09-01');
    assert.deepEqual(documento.items_list, [{ name: 'Riparazione', qty: 1, net_price: 100, discount: 0, vat: { id: 0 } }]);
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json.stato, 'inviata');
    assert.equal((await K.chiama('POST', '/api/connettori/fatture-in-cloud/azioni/invia', { args: { fattura: f.id } })).stato, 502);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/fatture-in-cloud/giri/ricevute')).json.risultato, { importate: 1, gia: 0 });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/fatture-in-cloud/giri/ricevute')).json.risultato, { importate: 0, gia: 1 });
    const ric = (await K.chiama('GET', '/api/dati/fatture_ricevute')).json, x = (ric.righe || ric)[0];
    assert.equal(x.numero, 'C-55'); assert.equal(x.totale, 122); assert.equal(x.fornitore.titolo, 'Carta & Co srl');
  } finally { await K.chiudi(); await S.chiudi(); }
});
