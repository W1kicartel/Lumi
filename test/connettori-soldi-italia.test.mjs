// I connettori italiani della fatturazione e della contabilità (Fattura24, Reviso) contro finti servizi locali. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, righe = [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }], extra = {}) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi & Figli srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email: 'amm@rossi.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe, ...extra })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return { f: e.json, cl };
}
const xml = corpo => ({ stato: 200, intestazioni: { 'Content-Type': 'text/xml; charset=utf-8' }, corpo });
const campo = (x, n) => new RegExp(`<${n}>([^<]*)</${n}>`).exec(x)?.[1];

test('Fattura24: TestKey, SaveDocument FE form-encoded con cliente, righe, natura e pagamento; collegata, niente doppioni', async () => {
  const K = await kubo(['fatture']); const salvati = [];
  const S = await finto({
    'POST /api/v0.3/TestKey': (p, c) => xml(c.apiKey === 'f24-prova' ? '<root><returnCode>1</returnCode><description>Complimenti, la tua API KEY è corretta.</description></root>' : '<root><returnCode>-1</returnCode><description>API KEY non valida</description></root>'),
    // la risposta come nell'esempio ufficiale, con il tag di chiusura sbagliato di docNumber
    'POST /api/v0.3/SaveDocument': (p, c) => { assert.equal(c.apiKey, 'f24-prova'); salvati.push(c.xml); return xml(`<root><returnCode>0</returnCode><description>Operazione completata con successo</description><docId>953921</docId><docNumber>7/2026<docNumber></root>`); },
  });
  try {
    const { f } = await fattura(K, [{ descrizione: 'Riparazione <urgente>', quantita: 2, prezzo: 50, aliquota: 22 }, { descrizione: 'Spese anticipate', quantita: 1, prezzo: 10, aliquota: 0, natura: 'N1' }]);
    await accendi(K, 'fattura24', { base: S.url + '/api/v0.3', segreti: { chiave: 'f24-prova' } });
    assert.equal((await K.chiama('POST', '/api/connettori/fattura24/prova')).json.ok, true);
    const r = await K.chiama('POST', '/api/connettori/fattura24/azioni/crea', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.documento, '953921'); assert.equal(r.json.numero, '7/2026');
    assert.equal(salvati.length, 1); const x = salvati[0];
    assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?><Fattura24><Document><DocumentType>FE<\/DocumentType>/);
    assert.equal(campo(x, 'CustomerName'), 'Rossi &amp; Figli srl'); assert.equal(campo(x, 'CustomerVatCode'), '00743110157'); assert.equal(campo(x, 'FeDestinationCode'), 'ABC1234');
    assert.equal(campo(x, 'CustomerCity'), 'Torino'); assert.equal(campo(x, 'CustomerProvince'), 'TO'); assert.equal(campo(x, 'CustomerCountry'), 'IT'); assert.equal(campo(x, 'Date'), '2026-09-01');
    assert.equal(campo(x, 'TotalWithoutTax'), '110.00'); assert.equal(campo(x, 'VatAmount'), '22.00'); assert.equal(campo(x, 'Total'), '132.00'); assert.equal(campo(x, 'FePaymentCode'), 'MP05');
    assert.match(x, /<Row><Description>Riparazione &lt;urgente&gt;<\/Description><Qty>2<\/Qty><Um\/><Price>50\.00<\/Price><VatCode>22<\/VatCode><VatDescription>22%<\/VatDescription><\/Row>/);
    assert.match(x, /<Row><Description>Spese anticipate<\/Description><Qty>1<\/Qty><Um\/><Price>10\.00<\/Price><VatCode>0<\/VatCode><VatDescription>N1<\/VatDescription><FeVatNature>N1<\/FeVatNature><\/Row>/);
    assert.match(x, /<Payments><Payment><Date>2026-09-01<\/Date><Amount>132\.00<\/Amount><Paid>false<\/Paid><\/Payment><\/Payments>/);
    // la fattura non è ancora allo SDI: lo stato in Kubo non cambia; il secondo invio si rifiuta senza chiamare
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json.stato, 'emessa');
    assert.equal((await K.chiama('POST', '/api/connettori/fattura24/azioni/crea', { args: { fattura: f.id } })).stato, 502); assert.equal(salvati.length, 1);
    // una chiave sbagliata: la prova lo dice
    await accendi(K, 'fattura24', { base: S.url + '/api/v0.3', segreti: { chiave: 'sbagliata' } });
    const p = (await K.chiama('POST', '/api/connettori/fattura24/prova')).json; assert.equal(p.ok, false);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Fattura24: un errore dell\'API (returnCode negativo) non collega la fattura; la ritenuta si rifiuta prima di chiamare', async () => {
  const K = await kubo(['fatture']); let n = 0;
  const S = await finto({ 'POST /api/v0.3/SaveDocument': () => { n++; return xml('<root><returnCode>-12</returnCode><description>Codice destinatario non valido</description></root>'); } });
  try {
    const { f } = await fattura(K);
    await accendi(K, 'fattura24', { base: S.url + '/api/v0.3', segreti: { chiave: 'f24-prova' } });
    const r = await K.chiama('POST', '/api/connettori/fattura24/azioni/crea', { args: { fattura: f.id } });
    assert.equal(r.stato, 502); assert.match(JSON.stringify(r.json), /Codice destinatario non valido/); assert.equal(n, 1);
    const { f: g } = await fattura(K, undefined, { ritenuta: 20 });
    const r2 = await K.chiama('POST', '/api/connettori/fattura24/azioni/crea', { args: { fattura: g.id } });
    assert.equal(r2.stato, 502); assert.match(JSON.stringify(r2.json), /ritenuta/); assert.equal(n, 1);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Reviso: i due token, cliente cercato per partita IVA e creato, bozza con le righe, registrata a scelta; niente doppioni; il giro esporta le nuove', async () => {
  const K = await kubo(['fatture']); const clienti = [], bozze = [], registrate = [], cercati = [];
  const tok = int => { assert.equal(int['x-appsecrettoken'], 'app-prova'); assert.equal(int['x-agreementgranttoken'], 'grant-prova'); };
  const S = await finto({
    'GET /self': (p, c, { intestazioni }) => { tok(intestazioni); return { agreementNumber: 123456, company: { name: 'Bottega Prova srl' } }; },
    'GET /customers': (p, c, { q, intestazioni }) => { tok(intestazioni); cercati.push(q.get('filter')); return { collection: clienti.filter(x => `vatNumber$eq:${x.vatNumber}` === q.get('filter')), pagination: { results: 0 } }; },
    'POST /customers': (p, c, { intestazioni }) => { tok(intestazioni); const o = { ...c, customerNumber: 100 + clienti.length }; clienti.push(o); return o; },
    'POST /v2/invoices/drafts': (p, c, { intestazioni }) => { tok(intestazioni); bozze.push(c); return { ...c, id: 70 + bozze.length }; },
    'POST /v2/invoices/booked': (p, c) => { registrate.push(c); return { bookedInvoiceNumber: 5000 + registrate.length }; },
  });
  try {
    const { f } = await fattura(K, [{ descrizione: 'Riparazione', quantita: 2, prezzo: 100, sconto: 10, aliquota: 22 }], { scadenza: '2026-10-01' });
    await accendi(K, 'reviso', { base: S.url, segreti: { app: 'app-prova', contratto: 'grant-prova' }, impostazioni: { gruppo: 2, pagamento: 3, zona: 1, iva: '22=V22, 10=V10' } });
    assert.equal((await K.chiama('POST', '/api/connettori/reviso/prova')).json.ok, true);
    const r = await K.chiama('POST', '/api/connettori/reviso/azioni/esporta', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.bozza, 71); assert.equal(r.json.registrata, null);
    assert.deepEqual(cercati, ['vatNumber$eq:00743110157']);
    assert.equal(clienti.length, 1); const c = clienti[0];
    assert.equal(c.name, 'Rossi & Figli srl'); assert.equal(c.currency, 'EUR'); assert.deepEqual(c.customerGroup, { customerGroupNumber: 2 }); assert.deepEqual(c.paymentTerms, { paymentTermsNumber: 3 });
    assert.deepEqual(c.vatZone, { vatZoneNumber: 1 }); assert.equal(c.vatNumber, '00743110157'); assert.equal(c.city, 'Torino'); assert.equal(c.email, 'amm@rossi.example');
    const b = bozze[0];
    assert.equal(b.date, '2026-09-01'); assert.equal(b.dueDate, '2026-10-01'); assert.equal(b.currency, 'EUR'); assert.deepEqual(b.customer, { customerNumber: 100 }); assert.deepEqual(b.paymentTerms, { paymentTermsNumber: 3 });
    assert.equal(b.recipient.name, 'Rossi & Figli srl'); assert.deepEqual(b.recipient.vatZone, { vatZoneNumber: 1 }); assert.match(b.references.other, /^Kubo /);
    assert.deepEqual(b.lines, [{ lineNumber: 1, description: 'Riparazione', quantity: 2, unitNetPrice: 90, vatAccount: { vatCode: 'V22' } }]);
    assert.equal(registrate.length, 0);
    assert.equal((await K.chiama('POST', '/api/connettori/reviso/azioni/esporta', { args: { fattura: f.id } })).stato, 502); assert.equal(bozze.length, 1);
    // con «registra»: il cliente collegato non si cerca di nuovo, la bozza si registra con il suo id
    const { f: g } = await fattura(K);
    await accendi(K, 'reviso', { base: S.url, segreti: { app: 'app-prova', contratto: 'grant-prova' }, impostazioni: { registra: true, giorni: 3650 } });
    const r2 = await K.chiama('POST', '/api/connettori/reviso/azioni/esporta', { args: { fattura: g.id } });
    assert.equal(r2.stato, 200, JSON.stringify(r2.json)); assert.equal(r2.json.registrata, 5001); assert.deepEqual(registrate, [{ id: 72 }]);
    // il secondo «Rossi» (stessa partita IVA, riga nuova in Kubo) si trova in Reviso e non si ricrea
    assert.equal(clienti.length, 1); assert.equal(bozze[1].customer.customerNumber, 100);
    // il giro: una fattura nuova, le due già esportate saltate
    const { f: h } = await fattura(K);
    const giro = await K.chiama('POST', '/api/connettori/reviso/giri/esporta');
    assert.deepEqual(giro.json.risultato, { esportate: 1, errori: 0 }, JSON.stringify(giro.json)); assert.equal(bozze.length, 3);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/reviso/giri/esporta')).json.risultato, { esportate: 0, errori: 0 });
    assert.ok(h.id);
  } finally { await K.chiudi(); await S.chiudi(); }
});

// il contratto del catalogo (lo stesso di connettori-soldi-catalogo), qui per i due connettori nuovi
test('catalogo e testi: Fattura24 e Reviso', async () => {
  for (const id of ['fattura24', 'reviso']) {
    const m = (await import(`../connettori/${id}/connettore.js`)).default, c = m.catalogo, en = m.testi.en;
    assert.equal(m.id, id); assert.equal(c.prova, 'finto'); assert.ok(c.passi.length >= 3 && c.passi.length <= 8);
    assert.equal(en['cat.passi'].length, c.passi.length); assert.equal(en['cat.serve'].length, c.serve.length); assert.ok(en['cat.costoNota'].length > 20);
    assert.ok([...c.fonti, c.sito, ...c.serve.map(s => s.link)].every(u => /^https:\/\/\S+$/.test(u)));
    const chiavi = ['descrizione', ...m.impostazioni.map(i => `imp.${i.id}`), ...Object.keys(m.azioni || {}).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) for (const k of chiavi) assert.ok(m.testi[l]?.[k], `${id}: manca ${l}.${k}`);
    for (const a of Object.values(m.azioni)) if (a.lumi) { assert.ok(a.descrizione); if (a.scrive) assert.equal(typeof a.proponi, 'function'); }
  }
});
