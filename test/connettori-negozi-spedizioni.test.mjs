// I connettori delle spedizioni (Sendcloud, ShippyPro, Packlink, Qapla', corrieri) contro finti servizi locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

// un cliente con l'indirizzo e una sua vendita
let nArticoli = 0;
async function venditaConCliente(K, { nome = 'Mario Rossi', indirizzo = 'Via Roma 12, 20121 Milano (MI)' } = {}) {
  const c = (await K.chiama('POST', '/api/dati/clienti', { nome, email: 'mario.rossi@esempio.it', telefono: '3330000000', indirizzo })).json;
  const a = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: `SP-VASO-${++nArticoli}`, prezzo: 40, giacenza: 5 })).json;
  return (await K.chiama('POST', '/api/dati/vendite', { cliente: c.id, righe: [{ articolo: a.id, quantita: 1, prezzo: 40 }] })).json;
}

test('Sendcloud: etichetta dalla vendita (indirizzo scomposto), webhook firmato → stato sulla vendita, «dov\'è il pacco di Rossi?»', async () => {
  const K = await kubo(), pacchi = [];
  let stato = { id: 1000, message: 'Ready to send' };
  const S = await finto({
    'GET /api/v2/user': () => ({ user: { company_name: 'Bottega' } }),
    'POST /api/v3/shipments/announce': (p, c) => { pacchi.push(c); return pacchi.filter(x => x.external_reference_id === c.external_reference_id).length > 1
      ? { stato: 409, corpo: { data: { id: 'sh1', carrier: { code: 'brt' }, parcels: [{ id: 555, tracking_number: '3SABC123', status: { code: 'READY_TO_SEND', message: 'Ready to send' } }] } } }
      : { stato: 201, corpo: { data: { id: 'sh1', carrier: { code: 'brt', name: 'BRT' }, parcels: [{ id: 555, tracking_number: '3SABC123', tracking_url: 'https://tracking.example/3SABC123', status: { code: 'READY_TO_SEND', message: 'Ready to send' }, documents: [{ type: 'label', link: 'https://panel.example/documents/555' }] }] } } }; },
    'GET /api/v2/parcels/:id': p => ({ parcel: { id: Number(p.id), tracking_number: '3SABC123', carrier: { code: 'brt' }, status: stato, tracking_url: 'https://tracking.example/3SABC123' } }),
  });
  try {
    await accendi(K, 'sendcloud', { base: S.url, segreti: { chiave_pubblica: 'pub', chiave_segreta: 'sec' }, impostazioni: { mittente: 42, opzione: 'brt:standard' } });
    assert.equal((await K.chiama('POST', '/api/connettori/sendcloud/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Basic ' + Buffer.from('pub:sec').toString('base64'));
    const v = await venditaConCliente(K);
    const ant = await K.chiama('POST', '/api/connettori/sendcloud/azioni/etichetta', { args: { vendita: v.numero }, anteprima: true });
    assert.equal(ant.json.righe[1][1], 'Mario Rossi, Via Roma 12, 20121 Milano', JSON.stringify(ant.json));
    const r = await K.chiama('POST', '/api/connettori/sendcloud/azioni/etichetta', { args: { vendita: v.numero, peso: 2.5 } });
    assert.equal(r.json.tracking, '3SABC123', JSON.stringify(r.json));
    assert.equal(r.json.etichetta, 'https://panel.example/documents/555');
    assert.deepEqual(pacchi[0], { from_address: { sender_address_id: 42 }, to_address: { name: 'Mario Rossi', address_line_1: 'Via Roma', house_number: '12', postal_code: '20121', city: 'Milano', country_code: 'IT', state_province_code: 'IT-MI', phone_number: '3330000000', email: 'mario.rossi@esempio.it' },
      ship_with: { type: 'shipping_option_code', properties: { shipping_option_code: 'brt:standard' } }, parcels: [{ weight: { value: '2.5', unit: 'kg' } }], order_number: String(v.numero), total_order_price: { value: '40', currency: 'EUR' }, external_reference_id: `kubo-${v.id}-0` });
    assert.match((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.note, /Spedizione BRT 3SABC123: Ready to send/);
    // il corriere consegna: Sendcloud avvisa con il webhook firmato
    const ev = JSON.stringify({ action: 'parcel_status_changed', timestamp: 1760000000, parcel: { id: 555, tracking_number: '3SABC123', status: { id: 11, message: 'Delivered' }, carrier: { code: 'brt' } } });
    assert.equal((await manda(K, '/api/connettori/sendcloud/in', ev, { 'Sendcloud-Signature': firmaHmacDi('altro', ev, 'hex') })).stato, 401);
    const w = await manda(K, '/api/connettori/sendcloud/in', ev, { 'Sendcloud-Signature': firmaHmacDi('sec', ev, 'hex') });
    assert.equal(w.json.esito, 'spedizione: Delivered', JSON.stringify(w.json));
    assert.match((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.note, /Spedizione BRT 3SABC123: Delivered/);
    assert.equal((await manda(K, '/api/connettori/sendcloud/in', ev, { 'Sendcloud-Signature': firmaHmacDi('sec', ev, 'hex') })).json.doppione, true);
    // Lumi: «dov'è il pacco di Rossi?»
    stato = { id: 3, message: 'En route to sorting center' };
    const d = await K.chiama('POST', '/api/connettori/sendcloud/azioni/dove', { args: { chi: 'Rossi' } });
    assert.equal(d.json.stato, 'En route to sorting center', JSON.stringify(d.json)); assert.equal(d.json.tracking, '3SABC123');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Qapla\': pushShipment dalla vendita, stato con getShipment sulla vendita, webhook col codice segreto, giro delle non consegnate', async () => {
  const K = await kubo(), spinte = []; let consegnato = false;
  const S = await finto({
    'GET /1.2/getShipments/': (p, c, { q }) => (q.get('apiKey') === 'qk' ? { getShipments: { result: 'OK', shipments: [] } } : { getShipments: { result: 'KO', error: 'apiKey non valida' } }),
    'POST /1.2/pushShipment/': (p, c) => { spinte.push(c); return { pushShipment: { result: 'OK', count: 1, shipments: [{ result: 'OK', id: 77, url: 'https://track.example/abc', courier: 'BRT', trackingNumber: c.pushShipment[0].trackingNumber }] } }; },
    'GET /1.2/getShipment/': (p, c, { q }) => ({ getShipment: { result: 'OK', shipments: [{ id: 77, trackingNumber: q.get('trackingNumber'), url: 'https://track.example/abc', courier: { code: 'BRT', name: 'BRT' }, isDelivered: consegnato,
      status: { date: '2026-10-09 10:00:00', place: 'Bologna', status: consegnato ? 'Consegnata' : 'In transito', qaplaStatus: { id: consegnato ? 6 : 3, status: consegnato ? 'Consegnata' : 'In transito' } } }] } }),
  });
  try {
    const pag = await accendi(K, 'qapla', { base: S.url, segreti: { chiave: 'qk' } });
    const codice = pag.impostazioni.find(i => i.id === 'codice').valore;
    assert.equal((await K.chiama('POST', '/api/connettori/qapla/prova')).json.ok, true);
    const v = await venditaConCliente(K, { nome: 'Anna Ferri', indirizzo: 'Viale Europa 33, 40121 Bologna BO' });
    const r = await K.chiama('POST', '/api/connettori/qapla/azioni/traccia', { args: { vendita: v.numero, tracking: 'BRT0001', corriere: 'brt' } });
    assert.equal(r.json.tracciamento, 'https://track.example/abc', JSON.stringify(r.json));
    const x = spinte[0]; assert.equal(x.apiKey, 'qk');
    assert.deepEqual({ ...x.pushShipment[0], shipDate: 'oggi' }, { reference: String(v.numero), trackingNumber: 'BRT0001', courier: 'BRT', shipDate: 'oggi', name: 'Anna Ferri', email: 'mario.rossi@esempio.it', telephone: '3330000000',
      street: 'Viale Europa 33', city: 'Bologna', ZIP: '40121', state: 'BO', country: 'IT', amount: 40, language: 'it' });
    const d = await K.chiama('POST', '/api/connettori/qapla/azioni/dove', { args: { chi: 'Ferri' } });
    assert.equal(d.json.stato, 'In transito', JSON.stringify(d.json)); assert.equal(d.json.dove, 'Bologna');
    consegnato = true;
    assert.equal((await manda(K, '/api/connettori/qapla/in/sbagliato', JSON.stringify({ trackingNumber: 'BRT0001' }))).stato, 401);
    assert.equal((await manda(K, `/api/connettori/qapla/in/${codice}`, JSON.stringify({ trackingNumber: 'BRT0001' }))).json.esito, 'spedizione: Consegnata');
    assert.match((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.note, /Spedizione BRT BRT0001: Consegnata/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/qapla/giri/stati')).json.risultato, { lette: 0, consegnate: 0 });   // consegnata: esce dal giro
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Packlink PRO: bozza dalla vendita con Authorization, evento col codice segreto → spedizione riletta e tracking sulla vendita', async () => {
  const K = await kubo(), bozze = []; let stato = 'AWAITING_COMPLETION';
  const S = await finto({
    'GET /v1/users/me': (p, c, { intestazioni }) => (intestazioni.authorization === 'pk-finta' ? { email: 'spedizioni@bottega.example' } : { stato: 401, corpo: {} }),
    'POST /v1/shipments': (p, c) => { bozze.push(c); return { reference: 'IT2026PRO0001' }; },
    'GET /v1/shipments/:rif': p => ({ reference: p.rif, state: stato, carrier: 'GLS', tracking_codes: stato === 'AWAITING_COMPLETION' ? [] : ['GLS99887766'] }),
    'GET /v1/shipments/:rif/track': () => [{ description: 'In consegna', city: 'Parma', timestamp: 1760000000 }],
  });
  try {
    const pag = await accendi(K, 'packlink', { base: S.url, segreti: { chiave: 'pk-finta' }, impostazioni: { servizio: 20945, mittente_nome: 'Bottega', mittente_via: 'Via del Corso 1', mittente_cap: '00186', mittente_comune: 'Roma' } });
    const codice = pag.impostazioni.find(i => i.id === 'codice').valore;
    assert.equal((await K.chiama('POST', '/api/connettori/packlink/prova')).json.messaggio, 'spedizioni@bottega.example');
    const v = await venditaConCliente(K, { nome: 'Luca De Santis', indirizzo: 'Borgo Parmigianino 7, 43121 Parma (PR)' });
    const r = await K.chiama('POST', '/api/connettori/packlink/azioni/bozza', { args: { vendita: v.numero, peso: 3 } });
    assert.equal(r.json.riferimento, 'IT2026PRO0001', JSON.stringify(r.json));
    assert.deepEqual(bozze[0].to, { name: 'Luca', surname: 'De Santis', street1: 'Borgo Parmigianino 7', zip_code: '43121', city: 'Parma', country: 'IT', phone: '3330000000', email: 'mario.rossi@esempio.it' });
    assert.equal(bozze[0].service_id, 20945); assert.deepEqual(bozze[0].packages, [{ weight: 3, width: 20, height: 10, length: 30 }]); assert.equal(bozze[0].from.zip_code, '00186');
    stato = 'IN_TRANSIT';
    const ev = JSON.stringify({ event: 'shipment.tracking.update', datetime: '2026-10-09 10:00:00', data: { shipment_reference: 'IT2026PRO0001' } });
    assert.equal((await manda(K, '/api/connettori/packlink/in/no', ev)).stato, 401);
    assert.equal((await manda(K, `/api/connettori/packlink/in/${codice}`, ev)).json.esito, 'spedizione: In viaggio');
    assert.match((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.note, /Spedizione GLS GLS99887766: In viaggio/);
    const d = await K.chiama('POST', '/api/connettori/packlink/azioni/dove', { args: { chi: 'De Santis' } });
    assert.equal(d.json.stato, 'In viaggio', JSON.stringify(d.json)); assert.match(d.json.ultimo, /In consegna Parma/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('DHL: spedizione Express con Basic e conto, tracking unificato con DHL-API-Key sulla vendita, giro delle aperte', async () => {
  const K = await kubo(), spedizioni = []; let codice = 'transit';
  const S = await finto({
    'POST /mydhlapi/test/shipments': (p, c, { intestazioni }) => { spedizioni.push({ c, auth: intestazioni.authorization }); return { shipmentTrackingNumber: '1234567890', trackingUrl: 'https://track.example/1234567890', documents: [{ typeCode: 'label', imageFormat: 'PDF', content: 'JVBERi0x' }] }; },
    'GET /track/shipments': (p, c, { q, intestazioni }) => (intestazioni['dhl-api-key'] !== 'dk' ? { stato: 401, corpo: {} } : q.get('trackingNumber') === '00340434292135100186' ? { stato: 404, corpo: { detail: 'No shipment' } }
      : { shipments: [{ id: q.get('trackingNumber'), status: { statusCode: codice, status: codice === 'delivered' ? 'DELIVERED' : 'TRANSIT', description: codice === 'delivered' ? 'Consegnato' : 'In transito', location: { address: { addressLocality: 'Milano' } } } }] }),
  });
  try {
    await accendi(K, 'dhl', { base: S.url, segreti: { chiave_tracking: 'dk', utente: 'u-dhl', password: 'p-dhl' }, impostazioni: { conto: '123456789', ambiente: 'prova', mittente_nome: 'Bottega', mittente_via: 'Via Torino 5', mittente_cap: '20123', mittente_comune: 'Milano' } });
    assert.equal((await K.chiama('POST', '/api/connettori/dhl/prova')).json.ok, true);
    const v = await venditaConCliente(K, { nome: 'Irene Costa', indirizzo: 'Via Cavour 21, 00184 Roma (RM)' });
    const r = await K.chiama('POST', '/api/connettori/dhl/azioni/spedisci', { args: { vendita: v.numero } });
    assert.equal(r.json.tracking, '1234567890', JSON.stringify(r.json)); assert.equal(r.json.etichetta, 'data:application/pdf;base64,JVBERi0x');
    const x = spedizioni[0]; assert.equal(x.auth, 'Basic ' + Buffer.from('u-dhl:p-dhl').toString('base64'));
    assert.deepEqual(x.c.accounts, [{ typeCode: 'shipper', number: '123456789' }]); assert.equal(x.c.productCode, 'N');
    assert.deepEqual(x.c.customerDetails.receiverDetails.postalAddress, { postalCode: '00184', cityName: 'Roma', countryCode: 'IT', addressLine1: 'Via Cavour 21', provinceCode: 'RM' });
    const d = await K.chiama('POST', '/api/connettori/dhl/azioni/dove', { args: { chi: 'Costa' } });
    assert.equal(d.json.stato, 'In transito', JSON.stringify(d.json)); assert.equal(d.json.dove, 'Milano');
    codice = 'delivered';
    assert.deepEqual((await K.chiama('POST', '/api/connettori/dhl/giri/stati')).json.risultato, { lette: 1, consegnate: 1 });
    assert.match((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.note, /Spedizione DHL 1234567890: Consegnato/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/dhl/giri/stati')).json.risultato, { lette: 0, consegnate: 0 });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('UPS e FedEx: token client credentials (Basic per UPS, form per FedEx), tracking collegato alla vendita, consegnato esce dal giro', async () => {
  const K = await kubo(); let consegnato = false;
  const S = await finto({
    'POST /security/v1/oauth/token': (p, c, { intestazioni }) => (intestazioni.authorization === 'Basic ' + Buffer.from('ups-id:ups-sec').toString('base64') && c.grant_type === 'client_credentials' ? { access_token: 'ups-tok', expires_in: '14399' } : { stato: 401, corpo: {} }),
    'GET /api/track/v1/details/:n': (p, c, { intestazioni }) => (intestazioni.authorization !== 'Bearer ups-tok' || !intestazioni.transid || intestazioni.transactionsrc !== 'Kubo' ? { stato: 401, corpo: {} }
      : { trackResponse: { shipment: [{ package: [{ trackingNumber: p.n, currentStatus: { description: consegnato ? 'Consegnato' : 'In transito', type: consegnato ? 'D' : 'I' }, activity: [{ location: { address: { city: 'Napoli' } }, status: { type: consegnato ? 'D' : 'I' }, date: '20261009' }] }] }] } }),
    'POST /oauth/token': (p, c) => (c.client_id === 'fx-id' && c.client_secret === 'fx-sec' ? { access_token: 'fx-tok', expires_in: 3599 } : { stato: 401, corpo: {} }),
    'POST /track/v1/trackingnumbers': (p, c, { intestazioni }) => (intestazioni.authorization !== 'Bearer fx-tok' ? { stato: 401, corpo: {} }
      : { output: { completeTrackResults: [{ trackingNumber: c.trackingInfo[0].trackingNumberInfo.trackingNumber, trackResults: [{ latestStatusDetail: { code: 'IT', statusByLocale: 'In transito', scanLocation: { city: 'Bologna' } } }] }] } }),
  });
  try {
    await accendi(K, 'ups', { base: S.url, segreti: { client_id: 'ups-id', client_secret: 'ups-sec' } });
    await accendi(K, 'fedex', { base: S.url, segreti: { client_id: 'fx-id', client_secret: 'fx-sec' } });
    assert.equal((await K.chiama('POST', '/api/connettori/ups/prova')).json.ok, true); assert.equal((await K.chiama('POST', '/api/connettori/fedex/prova')).json.ok, true);
    const v = await venditaConCliente(K, { nome: 'Rocco Esposito', indirizzo: 'Via Toledo 100, 80134 Napoli (NA)' });
    const c = await K.chiama('POST', '/api/connettori/ups/azioni/collega', { args: { vendita: v.numero, tracking: '1Z 999 AA1 01 2345 6784' } });
    assert.equal(c.json.tracking, '1Z999AA10123456784', JSON.stringify(c.json)); assert.equal(c.json.dove, 'Napoli');
    assert.equal((await K.chiama('POST', '/api/connettori/ups/azioni/dove', { args: { chi: 'Esposito' } })).json.stato, 'In transito');
    consegnato = true;
    assert.deepEqual((await K.chiama('POST', '/api/connettori/ups/giri/stati')).json.risultato, { lette: 1, consegnate: 1 });
    assert.match((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.note, /Spedizione UPS 1Z999AA10123456784: Consegnato/);
    const v2 = await venditaConCliente(K, { nome: 'Nadia Galli' });
    const f = await K.chiama('POST', '/api/connettori/fedex/azioni/collega', { args: { vendita: v2.numero, tracking: '794843185271' } });
    assert.equal(f.json.stato, 'In transito', JSON.stringify(f.json)); assert.equal(f.json.consegnato, false);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/fedex/giri/stati')).json.risultato, { lette: 1, consegnate: 0 });
  } finally { await K.chiudi(); await S.chiudi(); }
});
