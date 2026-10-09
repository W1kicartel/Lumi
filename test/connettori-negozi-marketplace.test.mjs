// I connettori dei marketplace (Amazon, eBay, Etsy) contro finti servizi locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

const aspetta = async K => { await new Promise(r => setTimeout(r, 50)); await K.nucleo.lavora(); };
const nuovoArticolo = async (K, codice, giacenza = 5, prezzo = 20) => (await K.chiama('POST', '/api/dati/articoli', { nome: codice, codice, prezzo, giacenza })).json;

test('Amazon SP-API: LWA con refresh token (niente SigV4), offerte collegate per SKU, ordini a pagine con NextToken, giacenza con patch, conferma spedizione', async () => {
  const K = await kubo(), patch = [], conferme = []; let token = 0;
  const S = await finto({
    'POST /auth/o2/token': (p, c) => (c.grant_type === 'refresh_token' && c.refresh_token === 'Atzr|finto' && c.client_secret === 'segreto-lwa' ? { access_token: `Atza|${++token}`, expires_in: 3600, token_type: 'bearer' } : { stato: 400, corpo: { error: 'invalid_grant' } }),
    'GET /sellers/v1/marketplaceParticipations': () => ({ payload: [{ marketplace: { id: 'APJ6JRA9NG5V4' } }] }),
    'GET /listings/2021-08-01/items/:venditore': (p, c, { q }) => (q.get('pageToken')
      ? { items: [{ sku: 'AMZ-SCONOSCIUTO', summaries: [{ productType: 'LUGGAGE' }] }] }
      : { items: [{ sku: 'AMZ-BORSA', summaries: [{ productType: 'HANDBAG' }] }], pagination: { nextToken: 'p2' } }),
    'PATCH /listings/2021-08-01/items/:venditore/:sku': (p, c, { q }) => { patch.push({ ...p, mercato: q.get('marketplaceIds'), c }); return { sku: p.sku, status: 'ACCEPTED', issues: [] }; },
    'GET /orders/v0/orders': (p, c, { q }) => (q.get('NextToken') ? { payload: { Orders: [{ AmazonOrderId: '402-0000002-0000002', OrderStatus: 'Pending', LastUpdateDate: '2026-10-09T08:00:00Z' }] } }
      : { payload: { Orders: [{ AmazonOrderId: '402-0000001-0000001', OrderStatus: 'Unshipped', LastUpdateDate: '2026-10-09T07:00:00Z' }], NextToken: 'n2' } }),
    'GET /orders/v0/orders/:id/orderItems': () => ({ payload: { OrderItems: [{ OrderItemId: 'oi1', SellerSKU: 'AMZ-BORSA', Title: 'Borsa', QuantityOrdered: 2, ItemPrice: { CurrencyCode: 'EUR', Amount: '100.00' }, PromotionDiscount: { CurrencyCode: 'EUR', Amount: '10.00' } }] } }),
    'POST /orders/v0/orders/:id/shipmentConfirmation': (p, c) => { conferme.push([p.id, c]); return { stato: 204, corpo: '' }; },
  });
  try {
    const borsa = await nuovoArticolo(K, 'AMZ-BORSA', 4, 45);
    await accendi(K, 'amazon', { base: S.url, segreti: { client_id: 'amzn1.application-oa2-client.finto', client_secret: 'segreto-lwa', refresh_token: 'Atzr|finto' }, impostazioni: { venditore: 'A1BCDEFGHIJKL' } });
    assert.equal((await K.chiama('POST', '/api/connettori/amazon/prova')).json.ok, true);
    const chiamata = S.chiamate.find(c => c.percorso === '/sellers/v1/marketplaceParticipations');
    assert.equal(chiamata.intestazioni['x-amz-access-token'], 'Atza|1'); assert.equal(chiamata.intestazioni.authorization, undefined);   // niente firma SigV4
    const g = await K.chiama('POST', '/api/connettori/amazon/giri/offerte');
    assert.deepEqual(g.json.risultato, { collegati: 1, sconosciuti: 1 }, JSON.stringify(g.json));
    await K.chiama('PATCH', `/api/dati/articoli/${borsa.id}`, { giacenza: 3 }); await aspetta(K);
    assert.equal(patch.length, 1); assert.equal(patch[0].sku, 'AMZ-BORSA'); assert.equal(patch[0].mercato, 'APJ6JRA9NG5V4');
    assert.deepEqual(patch[0].c, { productType: 'HANDBAG', patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 3 }] }] });
    const o = await K.chiama('POST', '/api/connettori/amazon/giri/ordini');
    assert.deepEqual(o.json.risultato, { vendite: 1, ignorati: 1 }, JSON.stringify(o.json));
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe[0]; assert.equal(v.totale, 90); assert.equal(v.stato, 'pagata');
    assert.equal(token, 1);   // un token solo per tutte le chiamate: dura un'ora
    const r = await K.chiama('POST', '/api/connettori/amazon/azioni/spedito', { args: { vendita: v.numero, tracking: 'GLS777', corriere: 'GLS' } });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(conferme[0][0], '402-0000001-0000001'); assert.deepEqual(conferme[0][1].packageDetail.orderItems, [{ orderItemId: 'oi1', quantity: 2 }]);
    assert.equal(conferme[0][1].packageDetail.trackingNumber, 'GLS777');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('eBay: refresh token con Basic, inventario collegato per SKU con «next», ordini pagati → vendite, bulkUpdatePriceQuantity, spedizione', async () => {
  const K = await kubo(), qta = [], spediti = [];
  const S = await finto({
    'POST /identity/v1/oauth2/token': (p, c, { intestazioni }) => (intestazioni.authorization === 'Basic ' + Buffer.from('app-id:cert-id').toString('base64') && c.grant_type === 'refresh_token' && c.scope.includes('sell.inventory')
      ? { access_token: 'v^1.1#utente', expires_in: 7200, token_type: 'User Access Token' } : { stato: 401, corpo: { error: 'invalid_client' } }),
    'GET /sell/inventory/v1/inventory_item': (p, c, { q }) => (q.get('offset') === '0' ? { inventoryItems: [{ sku: 'EB-LAMPADA' }], next: 'https://api.ebay.com/sell/inventory/v1/inventory_item?limit=100&offset=100', total: 2 } : { inventoryItems: [{ sku: 'EB-ALTRO' }], total: 2 }),
    'POST /sell/inventory/v1/bulk_update_price_quantity': (p, c) => { qta.push(c); return { responses: [{ statusCode: 200, sku: c.requests[0].sku }] }; },
    'GET /sell/fulfillment/v1/order': (p, c, { q }) => (q.get('limit') === '1' ? { total: 2, orders: [] } : { total: 2, orders: [
      { orderId: '12-34567-89012', orderPaymentStatus: 'PAID', lastModifiedDate: '2026-10-09T08:00:00.000Z', lineItems: [{ lineItemId: 'li1', sku: 'EB-LAMPADA', title: 'Lampada', quantity: 1, lineItemCost: { value: '35.00' }, appliedPromotions: [{ discountAmount: { value: '5.00' } }] }] },
      { orderId: '12-00000-00000', orderPaymentStatus: 'PENDING', lastModifiedDate: '2026-10-09T08:10:00.000Z', lineItems: [] },
    ] }),
    'GET /sell/fulfillment/v1/order/:id': p => ({ orderId: p.id, lineItems: [{ lineItemId: 'li1', quantity: 1 }] }),
    'POST /sell/fulfillment/v1/order/:id/shipping_fulfillment': (p, c) => { spediti.push([p.id, c]); return { stato: 201, corpo: {} }; },
  });
  try {
    const lampada = await nuovoArticolo(K, 'EB-LAMPADA', 6, 30);
    await accendi(K, 'ebay', { base: S.url, segreti: { client_id: 'app-id', client_secret: 'cert-id', refresh_token: 'v^1.1#refresh' } });
    assert.equal((await K.chiama('POST', '/api/connettori/ebay/prova')).json.ok, true);
    const c = S.chiamate.find(x => x.percorso === '/sell/fulfillment/v1/order');
    assert.equal(c.intestazioni.authorization, 'Bearer v^1.1#utente'); assert.equal(c.intestazioni['x-ebay-c-marketplace-id'], 'EBAY_IT');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/ebay/giri/offerte')).json.risultato, { collegati: 1, sconosciuti: 1 });
    await K.chiama('PATCH', `/api/dati/articoli/${lampada.id}`, { giacenza: 2 }); await aspetta(K);
    assert.deepEqual(qta.at(-1), { requests: [{ sku: 'EB-LAMPADA', shipToLocationAvailability: { quantity: 2 } }] });
    const o = await K.chiama('POST', '/api/connettori/ebay/giri/ordini');
    assert.deepEqual(o.json.risultato, { vendite: 1, ignorati: 1 }, JSON.stringify(o.json));
    assert.match(S.chiamate.filter(x => x.percorso === '/sell/fulfillment/v1/order').at(-1).q.filter, /^lastmodifieddate:\[.+\.\.\]$/);
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe[0]; assert.equal(v.totale, 30);
    const r = await K.chiama('POST', '/api/connettori/ebay/azioni/spedito', { args: { vendita: v.numero, tracking: 'POS123', corriere: 'Poste Italiane' } });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.deepEqual(spediti[0][1].lineItems, [{ lineItemId: 'li1', quantity: 1 }]); assert.equal(spediti[0][1].shippingCarrierCode, 'POSTE_ITALIANE');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Etsy: OAuth PKCE del nucleo, x-api-key con il segreto condiviso, ricevute pagate → vendite con il cliente, inventario riscritto, tracking', async () => {
  const K = await kubo(), scambi = [], inventari = [], tracking = [];
  const inventario = { products: [{ product_id: 1, sku: 'ET-COLLANA', is_deleted: false, offerings: [{ offering_id: 9, quantity: 4, is_enabled: true, price: { amount: 2500, divisor: 100, currency_code: 'EUR' } }], property_values: [] },
    { product_id: 2, sku: 'ET-ALTRA', offerings: [{ offering_id: 10, quantity: 1, is_enabled: true, price: { amount: 1000, divisor: 100 } }], property_values: [{ property_id: 200, property_name: 'Colore', value_ids: [1], values: ['Blu'], scale_id: null }] }],
    price_on_property: [], quantity_on_property: [], sku_on_property: [200] };
  const S = await finto({
    'POST /v3/public/oauth/token': (p, c) => { scambi.push(c); return c.client_id === 'kstr' && !c.client_secret ? { access_token: '123.etsy', refresh_token: '123.rinnovo', expires_in: 3600, token_type: 'Bearer' } : { stato: 400, corpo: { error: 'invalid_grant' } }; },
    'GET /v3/application/users/me': () => ({ user_id: 123, shop_id: 456 }),
    'GET /v3/application/shops/456/listings': () => ({ count: 1, results: [{ listing_id: 777, inventory: inventario }] }),
    'GET /v3/application/listings/777/inventory': () => inventario,
    'PUT /v3/application/listings/777/inventory': (p, c) => { inventari.push(c); return inventario; },
    'GET /v3/application/shops/456/receipts': () => ({ count: 1, results: [{ receipt_id: 3001, name: 'Lucia Bruni', first_line: 'Via Garibaldi 5', zip: '50123', city: 'Firenze', state: 'FI', is_paid: true, status: 'Paid', updated_timestamp: 1760000000,
      transactions: [{ sku: 'ET-COLLANA', title: 'Collana', quantity: 1, price: { amount: 2500, divisor: 100 } }] }] }),
    'POST /v3/application/shops/456/receipts/:id/tracking': (p, c) => { tracking.push([p.id, c]); return { receipt_id: Number(p.id) }; },
  });
  try {
    const collana = await nuovoArticolo(K, 'ET-COLLANA', 4, 25);
    await accendi(K, 'etsy', { base: S.url, segreti: { keystring: 'kstr', shared_secret: 'ssec' } });
    const u = new URL((await K.chiama('POST', '/api/connettori/etsy/oauth/inizio', { base: K.base })).json.url);
    assert.equal(u.origin + u.pathname, 'https://www.etsy.com/oauth/connect'); assert.equal(u.searchParams.get('client_id'), 'kstr'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.match(u.searchParams.get('scope'), /listings_w/);
    const rit = await fetch(`${K.base}/api/connettori/etsy/oauth/ritorno?code=c1&state=${u.searchParams.get('state')}`, { redirect: 'manual' });
    assert.match(rit.headers.get('location'), /oauth=ok/); assert.equal(scambi[0].code_verifier.length, 43);
    assert.equal((await K.chiama('POST', '/api/connettori/etsy/prova')).json.ok, true);
    const me = S.chiamate.find(c => c.percorso === '/v3/application/users/me');
    assert.equal(me.intestazioni['x-api-key'], 'kstr:ssec'); assert.equal(me.intestazioni.authorization, 'Bearer 123.etsy');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/etsy/giri/offerte')).json.risultato, { collegati: 1, sconosciuti: 1 });
    await K.chiama('PATCH', `/api/dati/articoli/${collana.id}`, { giacenza: 2 }); await aspetta(K);
    assert.equal(inventari.length, 1, JSON.stringify((await K.chiama('GET', '/api/connettori/etsy')).json.registro.slice(0, 3)));
    assert.deepEqual(inventari[0].products[0], { sku: 'ET-COLLANA', property_values: [], offerings: [{ price: 25, quantity: 2, is_enabled: true }] });
    assert.equal(inventari[0].products[1].offerings[0].quantity, 1); assert.deepEqual(inventari[0].sku_on_property, [200]);
    const o = await K.chiama('POST', '/api/connettori/etsy/giri/ordini'); assert.deepEqual(o.json.risultato, { vendite: 1, ignorati: 0 }, JSON.stringify(o.json));
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe[0]; assert.equal(v.totale, 25); assert.equal(v.cliente.titolo, 'Lucia Bruni');
    const r = await K.chiama('POST', '/api/connettori/etsy/azioni/spedito', { args: { vendita: v.numero, tracking: 'SDA555', corriere: 'SDA' } });
    assert.equal(r.json.ok, true, JSON.stringify(r.json)); assert.deepEqual(tracking[0], ['3001', { tracking_code: 'SDA555', carrier_name: 'SDA' }]);
  } finally { await K.chiudi(); await S.chiudi(); }
});
