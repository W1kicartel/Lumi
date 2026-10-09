// I connettori delle spedizioni (Sendcloud, ShippyPro, Packlink, Qapla', corrieri) contro finti servizi locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

// un cliente con l'indirizzo e una sua vendita
async function venditaConCliente(K, { nome = 'Mario Rossi', indirizzo = 'Via Roma 12, 20121 Milano (MI)' } = {}) {
  const c = (await K.chiama('POST', '/api/dati/clienti', { nome, email: 'mario.rossi@esempio.it', telefono: '3330000000', indirizzo })).json;
  const a = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'SP-VASO', prezzo: 40, giacenza: 5 })).json;
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
