// Scalapay (rate), Xero e QuickBooks (contabilità) contro finti servizi locali. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, gestionale, accendi } from './connettori-finto.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, { prezzo = 100, quantita = 1, data = new Date().toISOString().slice(0, 10) } = {}) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Mario Rossi', piva: '00743110157', email: 'mario@esempio.it', telefono: '+393331234567', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data, scadenza: data, righe: [{ descrizione: 'Riparazione', quantita, prezzo, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
const leggi = async (K, id) => (await K.chiama('GET', `/api/dati/fatture/${id}`)).json;

test('Scalapay: ordine con il cliente, conferma dal ritorno del cliente → cattura → fattura pagata; il giro cattura gli ordini confermati', async () => {
  const K = await gestionale(['fatture']); const ordini = [], catture = [];
  const S = await finto({
    'POST /v2/orders': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'Bearer chiave-test'); ordini.push(c); return { token: `TK${ordini.length}AB`, checkoutUrl: `https://portal.integration.scalapay.com/checkout/TK${ordini.length}AB`, expires: '2026-10-10T10:00:00Z' }; },
    'POST /v2/payments/capture': (p, c) => { catture.push(c); const o = ordini[Number(c.token.slice(2, -2)) - 1]; return { token: c.token, status: 'APPROVED', totalAmount: o.totalAmount, merchantReference: c.merchantReference }; },
    'GET /v2/payments/:token': p => (p.token === 'lumi-prova' ? { stato: 404, corpo: { message: 'not found' } } : { token: p.token, status: 'authorized', captureStatus: 'pending', totalAmount: ordini[1].totalAmount, orderDetails: { merchantReference: ordini[1].merchantReference } }),
  });
  try {
    const f = await fattura(K), f2 = await fattura(K, { prezzo: 50 });
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://lumi.esempio.it' })).stato, 200);   // l'indirizzo pubblico della Libreria: il connettore non ha il suo
    await accendi(K, 'scalapay', { base: S.url, segreti: { chiave: 'chiave-test' }, impostazioni: { rate: '4' } });
    assert.equal((await K.chiama('POST', '/api/connettori/scalapay/prova')).json.ok, true);
    const pre = await K.chiama('POST', '/api/connettori/scalapay/azioni/link_fattura', { args: { fattura: f.id }, anteprima: true });
    assert.equal(pre.stato, 200, JSON.stringify(pre.json)); assert.deepEqual(pre.json.righe[1], ['Importo', '122,00 €']);
    const l = await K.chiama('POST', '/api/connettori/scalapay/azioni/link_fattura', { args: { fattura: f.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.equal(l.json.url, 'https://portal.integration.scalapay.com/checkout/TK1AB');
    const o = ordini[0];
    assert.deepEqual(o.totalAmount, { amount: '122.00', currency: 'EUR' }); assert.equal(o.merchantReference, `lumi-f-${f.id}`); assert.equal(o.product, 'pay-in-4');
    assert.deepEqual(o.consumer, { givenNames: 'Mario', surname: 'Rossi', email: 'mario@esempio.it', phoneNumber: '+393331234567' });
    assert.equal(o.shipping.postcode, '10121'); assert.equal(o.items[0].price.amount, '122.00');
    assert.equal(o.merchant.redirectConfirmUrl, 'https://lumi.esempio.it/api/connettori/scalapay/pub/conferma');
    // un token che Lumi non ha creato non si cattura; il cliente che annulla non cattura
    const pub = q => fetch(`${K.base}/api/connettori/scalapay/pub/conferma?${q}`).then(async r => ({ stato: r.status, testo: await r.text() }));
    assert.match((await pub('orderToken=ALTRO99&status=SUCCESS')).testo, /in verifica/);
    assert.match((await pub('annullato=1&orderToken=TK1AB&status=FAILURE')).testo, /non è stato completato/);
    assert.equal(catture.length, 0); assert.equal((await leggi(K, f.id)).stato, 'emessa');
    const ok = await pub('orderToken=TK1AB&status=SUCCESS');
    assert.equal(ok.stato, 200); assert.match(ok.testo, /Pagamento ricevuto/);
    assert.deepEqual(catture[0], { token: 'TK1AB', merchantReference: `lumi-f-${f.id}` });
    const dopo = await leggi(K, f.id); assert.equal(dopo.stato, 'pagata'); assert.ok(dopo.pagata_il);
    // il secondo ordine: il cliente non torna (app sul PC), il giro lo trova autorizzato e lo cattura
    await K.chiama('POST', '/api/connettori/scalapay/azioni/link_fattura', { args: { fattura: f2.id } });
    const g = await K.chiama('POST', '/api/connettori/scalapay/giri/controlla');
    assert.deepEqual(g.json.risultato, { controllati: 1, pagati: 1 }); assert.equal(catture[1].token, 'TK2AB');
    assert.equal((await leggi(K, f2.id)).stato, 'pagata');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/scalapay/giri/controlla')).json.risultato, { controllati: 0, pagati: 0 });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Xero: OAuth con il kit (PKCE, ritorno, token con Basic), organizzazione da /connections, fattura esportata ACCREC e collegata; il giro porta le nuove', async () => {
  const K = await gestionale(['fatture']); const scambi = [], fatture = [];
  const S = await finto({
    'POST /connect/token': (p, c, { intestazioni }) => { scambi.push({ ...c, auth: intestazioni.authorization }); return { access_token: 'xero-at', refresh_token: 'xero-rt', expires_in: 1800, token_type: 'Bearer' }; },
    'GET /connections': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'Bearer xero-at'); return [{ id: 'c1', tenantId: 'tenant-123', tenantType: 'ORGANISATION', tenantName: 'Studio Prova' }]; },
    'GET /api.xro/2.0/Organisation': () => ({ Organisations: [{ Name: 'Studio Prova' }] }),
    'POST /api.xro/2.0/Invoices': (p, c, { intestazioni }) => {
      assert.equal(intestazioni['xero-tenant-id'], 'tenant-123'); assert.equal(intestazioni.authorization, 'Bearer xero-at'); assert.ok(intestazioni['idempotency-key']);
      fatture.push(c.Invoices[0]); const x = c.Invoices[0];
      return { Invoices: [{ InvoiceID: `inv-${fatture.length}`, InvoiceNumber: x.InvoiceNumber, Contact: { ContactID: 'cont-1', Name: x.Contact.Name } }] };
    },
  });
  try {
    const f = await fattura(K, { prezzo: 40, quantita: 3 });
    await accendi(K, 'xero', { base: S.url, segreti: { client_id: 'xid', client_secret: 'xsec' }, impostazioni: { iva: '22=OUTPUT2, 10=TAX002' } });
    const ini = (await K.chiama('POST', '/api/connettori/xero/oauth/inizio', { base: K.base })).json, u = new URL(ini.url);
    assert.equal(u.origin + u.pathname, 'https://login.xero.com/identity/connect/authorize');
    assert.equal(u.searchParams.get('scope'), 'offline_access accounting.invoices accounting.contacts'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const rit = await fetch(`${K.base}/api/connettori/xero/oauth/ritorno?code=codice-1&state=${u.searchParams.get('state')}`, { redirect: 'manual' });
    assert.match(rit.headers.get('location'), /oauth=ok/);
    assert.equal(scambi[0].grant_type, 'authorization_code'); assert.equal(scambi[0].code, 'codice-1'); assert.ok(scambi[0].code_verifier);
    // client_secret_basic: id e segreto nell'intestazione, non nel corpo
    assert.equal(scambi[0].auth, 'Basic ' + Buffer.from('xid:xsec').toString('base64')); assert.equal(scambi[0].client_id, undefined); assert.equal(scambi[0].client_secret, undefined);
    assert.equal((await K.chiama('POST', '/api/connettori/xero/prova')).json.ok, true);
    const pre = await K.chiama('POST', '/api/connettori/xero/azioni/esporta', { args: { fattura: f.id }, anteprima: true });
    assert.equal(pre.stato, 200, JSON.stringify(pre.json)); assert.deepEqual(pre.json.avvisi, []);
    const e = await K.chiama('POST', '/api/connettori/xero/azioni/esporta', { args: { fattura: f.id } });
    assert.equal(e.stato, 200, JSON.stringify(e.json)); assert.equal(e.json.id, 'inv-1');
    const x = fatture[0];
    assert.equal(x.Type, 'ACCREC'); assert.equal(x.Status, 'AUTHORISED'); assert.equal(x.CurrencyCode, 'EUR'); assert.equal(x.LineAmountTypes, 'Exclusive');
    assert.equal(x.InvoiceNumber, f.numero); assert.equal(x.Reference, `lumi-f-${f.id}`); assert.equal(x.Date, f.data);
    assert.deepEqual(x.Contact, { Name: 'Mario Rossi', TaxNumber: '00743110157', EmailAddress: 'mario@esempio.it' });
    assert.deepEqual(x.LineItems, [{ Description: 'Riparazione', Quantity: 3, UnitAmount: 40, AccountCode: '200', TaxType: 'OUTPUT2' }]);
    // già esportata: la seconda volta no
    const di = await K.chiama('POST', '/api/connettori/xero/azioni/esporta', { args: { fattura: f.id } });
    assert.notEqual(di.stato, 200); assert.equal(fatture.length, 1);
    // il giro: la nuova fattura sì, la vecchia no; il cliente ora va per ContactID
    const f2 = await fattura(K, { prezzo: 10 });
    const g = await K.chiama('POST', '/api/connettori/xero/giri/esporta');
    assert.deepEqual(g.json.risultato, { esportate: 1, ricevute: 0, errori: 0 }, JSON.stringify(g.json));
    assert.equal(fatture.length, 2); assert.equal(fatture[1].Reference, `lumi-f-${f2.id}`);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/xero/giri/esporta')).json.risultato, { esportate: 0, ricevute: 0, errori: 0 });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('QuickBooks: OAuth con il kit (Basic), realm dal ritorno (vince sull\'impostazione, che resta facoltativa), cliente cercato e creato, fattura con righe SalesItemLineDetail e minorversion', async () => {
  const K = await gestionale(['fatture']); const scambi = [], query = [], clienti = [], fatture = [];
  const S = await finto({
    'POST /oauth2/v1/tokens/bearer': (p, c, { intestazioni }) => { scambi.push({ ...c, auth: intestazioni.authorization }); return { access_token: 'qb-at', refresh_token: 'qb-rt', expires_in: 3600, x_refresh_token_expires_in: 8726400, token_type: 'bearer' }; },
    'GET /v3/company/:realm/companyinfo/:id': p => { assert.equal(p.realm, '9130350000000000'); assert.equal(p.id, p.realm); return { CompanyInfo: { CompanyName: 'Sandbox Company', Id: p.id } }; },
    'GET /v3/company/:realm/query': (p, c, { q, intestazioni }) => { assert.equal(p.realm, '9130350000000000'); assert.equal(q.get('minorversion'), '75'); assert.equal(intestazioni.accept, 'application/json'); query.push(q.get('query')); return { QueryResponse: {}, time: '2026-10-09T10:00:00Z' }; },
    'POST /v3/company/:realm/customer': (p, c) => { clienti.push(c); return { Customer: { Id: '58', DisplayName: c.DisplayName } }; },
    'POST /v3/company/:realm/invoice': (p, c, { q, intestazioni }) => { assert.equal(q.get('minorversion'), '75'); assert.equal(intestazioni.authorization, 'Bearer qb-at'); fatture.push(c); return { Invoice: { Id: `${129 + fatture.length}`, DocNumber: c.DocNumber } }; },
  });
  try {
    const f = await fattura(K, { prezzo: 25, quantita: 2 });
    await accendi(K, 'quickbooks', { base: S.url, segreti: { client_id: 'qid', client_secret: 'qsec' }, impostazioni: { articolo: '7' } });
    // né collegato né incollato: manca il Company ID; incollato (vecchio modo): si va avanti fino al token che manca
    assert.match((await K.chiama('POST', '/api/connettori/quickbooks/prova')).json.messaggio, /Company ID/);
    await K.chiama('PUT', '/api/connettori/quickbooks', { impostazioni: { realm: '4620816365000000' } });
    assert.doesNotMatch(String((await K.chiama('POST', '/api/connettori/quickbooks/prova')).json.messaggio), /Company ID/);
    const ini = (await K.chiama('POST', '/api/connettori/quickbooks/oauth/inizio', { base: K.base })).json, u = new URL(ini.url);
    assert.equal(u.origin + u.pathname, 'https://appcenter.intuit.com/connect/oauth2'); assert.equal(u.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
    const rit = await fetch(`${K.base}/api/connettori/quickbooks/oauth/ritorno?code=qcode&state=${u.searchParams.get('state')}&realmId=9130350000000000`, { redirect: 'manual' });
    assert.match(rit.headers.get('location'), /oauth=ok/); assert.equal(scambi[0].grant_type, 'authorization_code'); assert.equal(scambi[0].client_secret, undefined);
    assert.equal(scambi[0].auth, 'Basic ' + Buffer.from('qid:qsec').toString('base64'));
    // il realmId del ritorno (9130…) vince su quello incollato (4620…): le rotte finte controllano 9130…
    const pr = (await K.chiama('POST', '/api/connettori/quickbooks/prova')).json; assert.equal(pr.ok, true, JSON.stringify(pr));
    const e = await K.chiama('POST', '/api/connettori/quickbooks/azioni/esporta', { args: { fattura: f.id } });
    assert.equal(e.stato, 200, JSON.stringify(e.json)); assert.equal(e.json.id, '130');
    assert.equal(query[0], "select * from Customer where DisplayName = 'Mario Rossi'");
    assert.equal(clienti[0].DisplayName, 'Mario Rossi'); assert.equal(clienti[0].PrimaryEmailAddr.Address, 'mario@esempio.it'); assert.equal(clienti[0].BillAddr.PostalCode, '10121');
    const x = fatture[0];
    assert.deepEqual(x.CustomerRef, { value: '58' }); assert.equal(x.DocNumber, f.numero); assert.equal(x.TxnDate, f.data); assert.equal(x.PrivateNote, `lumi-f-${f.id}`);
    assert.deepEqual(x.Line, [{ DetailType: 'SalesItemLineDetail', Amount: 50, Description: 'Riparazione', SalesItemLineDetail: { ItemRef: { value: '7' }, Qty: 2, UnitPrice: 25 } }]);
    // la seconda fattura dello stesso cliente: niente nuova ricerca, il cliente è collegato; il giro non riesporta la prima
    const f2 = await fattura(K, { prezzo: 10 });
    const g = await K.chiama('POST', '/api/connettori/quickbooks/giri/esporta');
    assert.equal(g.json.risultato.esportate, 1, JSON.stringify(g.json)); assert.equal(fatture.length, 2); assert.equal(fatture[1].PrivateNote, `lumi-f-${f2.id}`);
    assert.equal(query.length, 2);   // f2 ha un cliente nuovo (la funzione di prova ne crea uno ogni volta): cercato anche lui
    assert.equal((await K.chiama('POST', '/api/connettori/quickbooks/azioni/esporta', { args: { fattura: f.id } })).stato !== 200, true);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('catalogo e testi di Scalapay, Xero e QuickBooks', async () => {
  for (const id of ['scalapay', 'xero', 'quickbooks']) {
    const m = (await import(`../connettori/${id}/connettore.js`)).default, c = m.catalogo;
    assert.equal(m.id, id); assert.equal(c.categoria, id === 'scalapay' ? 'pagamenti' : 'contabilita');
    assert.match(c.sito, /^https:\/\//); assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo)); assert.ok(c.costoNota.length > 20);
    assert.ok(c.serve.length && c.serve.every(s => s.cosa && s.dove && /^https:\/\//.test(s.link)));
    assert.ok(c.passi.length >= 3 && c.passi.length <= 8); assert.ok(['facile', 'media', 'difficile'].includes(c.difficolta));
    assert.ok(c.zone.length && c.zone.every(z => ['IT', 'UE', 'mondo'].includes(z))); assert.ok(c.fonti.length && c.fonti.every(f => /^https:\/\//.test(f)));
    assert.equal(c.prova, 'finto'); assert.ok(c.parole.length >= 4);
    const en = m.testi.en;
    assert.ok(en['cat.costoNota'].length > 20); assert.equal(en['cat.passi'].length, c.passi.length); assert.equal(en['cat.serve'].length, c.serve.length);
    assert.ok(en['cat.serve'].every(s => s.cosa && s.dove));
    const brevi = ['descrizione', ...m.impostazioni.map(i => `imp.${i.id}`), ...Object.keys(m.azioni).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) for (const b of brevi) assert.ok(m.testi[l]?.[b], `${id} ${l} ${b}`);
    for (const [a, d] of Object.entries(m.azioni)) if (d.lumi) { assert.match(`connettore_${id}_${a}`, /^[a-z0-9_]{1,64}$/); assert.ok(d.descrizione); if (d.scrive) assert.equal(typeof d.proponi, 'function'); }
  }
});

test('Xero: con «passive» acceso il giro porta anche le fatture ricevute come ACCPAY; regola dei tax type', async () => {
  const { tipoIva } = await import('../connettori/xero/connettore.js');
  assert.equal(tipoIva('22=OUTPUT2, 10=TAX002, *=NONE', 10), 'TAX002'); assert.equal(tipoIva('22=OUTPUT2, *=NONE', 4), 'NONE'); assert.equal(tipoIva('OUTPUT', 22), 'OUTPUT'); assert.equal(tipoIva('', 22), undefined);
  const K = await gestionale(['fatture']); const doc = [];
  const S = await finto({
    'POST /connect/token': () => ({ access_token: 'xero-at', refresh_token: 'xero-rt', expires_in: 1800 }),
    'GET /connections': () => [{ tenantId: 'tenant-9', tenantType: 'ORGANISATION' }],
    'POST /api.xro/2.0/Invoices': (p, c) => { doc.push(c.Invoices[0]); return { Invoices: [{ InvoiceID: `inv-${doc.length}`, Contact: { ContactID: 'f-1' } }] }; },
  });
  try {
    const fo = (await K.chiama('POST', '/api/dati/fornitori', { nome: 'Carta Srl', piva: '01234567897' })).json;
    const ri = await K.chiama('POST', '/api/dati/fatture_ricevute', { fornitore: fo.id, numero: 'A/77', data: new Date().toISOString().slice(0, 10), imponibile: 80, aliquota: 22, imposta: 17.6, totale: 97.6 });
    assert.equal(ri.stato, 200, JSON.stringify(ri.json));
    await accendi(K, 'xero', { base: S.url, segreti: { client_id: 'xid', client_secret: 'xsec' }, impostazioni: { passive: true, iva_acquisti: '22=INPUT2' } });
    const u = new URL((await K.chiama('POST', '/api/connettori/xero/oauth/inizio', { base: K.base })).json.url);
    await fetch(`${K.base}/api/connettori/xero/oauth/ritorno?code=c&state=${u.searchParams.get('state')}`, { redirect: 'manual' });
    const g = await K.chiama('POST', '/api/connettori/xero/giri/esporta');
    assert.deepEqual(g.json.risultato, { esportate: 0, ricevute: 1, errori: 0 }, JSON.stringify(g.json));
    const x = doc[0];
    assert.equal(x.Type, 'ACCPAY'); assert.equal(x.InvoiceNumber, 'A/77'); assert.deepEqual(x.Contact, { Name: 'Carta Srl', TaxNumber: '01234567897' });
    assert.deepEqual(x.LineItems, [{ Description: 'Fattura A/77 Carta Srl', Quantity: 1, UnitAmount: 80, AccountCode: '400', TaxType: 'INPUT2' }]);
    assert.equal((await K.chiama('POST', '/api/connettori/xero/giri/esporta')).json.risultato.ricevute, 0);
  } finally { await K.chiudi(); await S.chiudi(); }
});
