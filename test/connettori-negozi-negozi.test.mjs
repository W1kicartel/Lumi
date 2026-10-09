// I connettori dei negozi online (PrestaShop, Magento, BigCommerce, Wix, Ecwid, Squarespace) contro finti servizi locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

const aspetta = async K => { await new Promise(r => setTimeout(r, 50)); await K.nucleo.lavora(); };
const articolo = async (K, codice) => (await K.chiama('GET', `/api/dati/articoli?q=${encodeURIComponent(codice)}`)).json.righe.find(a => a.codice === codice);

test('PrestaShop: prodotti e combinazioni a pagine, giacenza in XML con l\'oggetto intero, ordini pagati → vendite con il cliente', async () => {
  const K = await kubo(), put = [];
  const scorte = [{ id: 1, id_product: 10, id_product_attribute: 0, quantity: '7' }, { id: 2, id_product: 11, id_product_attribute: 0, quantity: '0' }, { id: 3, id_product: 11, id_product_attribute: 5, quantity: '2' }];
  const S = await finto({
    'GET /api/': () => ({ api: {} }),
    'GET /api/stock_availables': (p, c, { q }) => {
      if (q.get('filter[id_product]')) return { stock_availables: scorte.filter(s => `[${s.id_product}]` === q.get('filter[id_product]') && `[${s.id_product_attribute}]` === q.get('filter[id_product_attribute]')).map(s => ({ ...s, id_shop: 1, id_shop_group: 0, depends_on_stock: '0', out_of_stock: '2', location: '' })) };
      return q.get('limit') === '0,500' ? { stock_availables: scorte } : [];
    },
    // due pagine da 100: la prima piena, la seconda con l'ultimo prodotto
    'GET /api/products': (p, c, { q }) => q.get('limit') === '0,100'
      ? { products: [{ id: 10, reference: 'PS-ANELLO', price: '100.000000', name: [{ id: '1', value: 'Anello' }] }, ...Array.from({ length: 99 }, (_, i) => ({ id: 100 + i, reference: '', price: '1', name: 'senza codice' }))] }
      : q.get('limit') === '100,100' ? { products: [{ id: 11, reference: 'PS-MAGLIA', price: '20', name: [{ id: '1', value: 'Maglia' }] }] } : [],
    'GET /api/combinations': (p, c, { q }) => (q.get('limit') === '0,100' ? { combinations: [{ id: 5, id_product: 11, reference: 'PS-MAGLIA-L', price: '5' }] } : []),
    'PUT /api/stock_availables/:id': (p, c, { intestazioni }) => { put.push({ id: p.id, corpo: c, tipo: intestazioni['content-type'] }); return { stato: 200, corpo: '<prestashop/>' }; },
    'GET /api/orders': (p, c, { q }) => (q.get('limit') === '0,50' ? { orders: [
      { id: 7, reference: 'XKBKNABJK', current_state: '2', id_customer: 3, id_address_delivery: 4, date_upd: '2026-10-09 10:00:00', associations: { order_rows: [{ product_reference: 'PS-MAGLIA-L', product_name: 'Maglia - L', product_quantity: '2', unit_price_tax_incl: '30.500000' }] } },
      { id: 8, reference: 'ANNULLATO', current_state: '6', id_customer: 3, id_address_delivery: 4, date_upd: '2026-10-09 11:00:00', associations: { order_rows: [] } },
    ] } : []),
    'GET /api/customers/:id': () => ({ customer: { id: 3, firstname: 'Giulia', lastname: 'Verdi', email: 'giulia@esempio.it' } }),
    'GET /api/addresses/:id': () => ({ address: { id: 4, address1: 'Via dei Tigli 8', postcode: '40121', city: 'Bologna', phone_mobile: '3331112222' } }),
  });
  try {
    await accendi(K, 'prestashop', { base: S.url, segreti: { chiave: 'CHIAVEFINTA1234567890ABCDEFGHIJK' } });
    assert.equal((await K.chiama('POST', '/api/connettori/prestashop/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Basic ' + Buffer.from('CHIAVEFINTA1234567890ABCDEFGHIJK:').toString('base64'));
    assert.equal(S.chiamate[0].q.output_format, 'JSON');
    const g = await K.chiama('POST', '/api/connettori/prestashop/giri/prodotti');
    assert.deepEqual(g.json.risultato, { creati: 3, aggiornati: 0, uguali: 0 }, JSON.stringify(g.json));
    const anello = await articolo(K, 'PS-ANELLO'), taglia = await articolo(K, 'PS-MAGLIA-L');
    assert.equal(anello.prezzo, 122); assert.equal(anello.giacenza, 7); assert.equal(anello.nome, 'Anello');
    assert.equal(taglia.prezzo, 30.5); assert.equal(taglia.giacenza, 2);
    await aspetta(K); assert.equal(put.length, 0);   // quello che arriva dal negozio non torna indietro
    await K.chiama('PATCH', `/api/dati/articoli/${taglia.id}`, { giacenza: 1 }); await aspetta(K);
    assert.equal(put.length, 1); assert.equal(put[0].id, '3'); assert.equal(put[0].tipo, 'application/xml');
    assert.match(put[0].corpo, /<stock_available><id>3<\/id><id_product>11<\/id_product><id_product_attribute>5<\/id_product_attribute>.*<quantity>1<\/quantity>.*<out_of_stock>2<\/out_of_stock>/);
    const o = await K.chiama('POST', '/api/connettori/prestashop/giri/ordini');
    assert.deepEqual(o.json.risultato, { vendite: 1, ignorati: 1 }, JSON.stringify(o.json));
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe; assert.equal(v.length, 1); assert.equal(v[0].stato, 'pagata'); assert.equal(v[0].totale, 61);
    const cli = (await K.chiama('GET', '/api/dati/clienti?q=giulia')).json.righe[0]; assert.equal(cli.nome, 'Giulia Verdi'); assert.match(cli.indirizzo || cli.via, /Via dei Tigli 8/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/prestashop/giri/ordini')).json.risultato, { vendite: 0, ignorati: 2 });   // niente doppioni
    assert.equal(S.chiamate.filter(c => c.percorso === '/api/orders').at(-1).q['filter[date_upd]'], '[2026-10-09 11:00:00,2999-12-31 23:59:59]');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Magento: searchCriteria a pagine fino a total_count, giacenze MSI nei due sensi, ordini pagati → vendite, spedizione con tracking', async () => {
  const K = await kubo(), su = [], spedizioni = [];
  const S = await finto({
    'GET /rest/V1/store/storeConfigs': () => [{ base_url: 'https://negozio.example/' }],
    'GET /rest/V1/inventory/source-items': () => ({ items: [{ sku: 'MG-TAZZA', source_code: 'default', quantity: 12, status: 1 }], total_count: 1 }),
    'GET /rest/V1/products': (p, c, { q }) => q.get('searchCriteria[currentPage]') === '1'
      ? { items: [{ sku: 'MG-TAZZA', name: 'Tazza', price: 9.5 }, ...Array.from({ length: 99 }, () => ({ sku: '', name: 'x' }))], total_count: 101 }
      : q.get('searchCriteria[currentPage]') === '2' ? { items: [{ sku: 'MG-PIATTO', name: 'Piatto', price: 14, extension_attributes: { stock_item: { qty: 3 } } }], total_count: 101 } : { items: [{ sku: 'RIPETUTO' }], total_count: 101 },
    'POST /rest/V1/inventory/source-items': (p, c) => { su.push(c); return []; },
    'GET /rest/V1/orders': (p, c, { q }) => (q.get('searchCriteria[filter_groups][0][filters][0][condition_type]') === 'gteq' ? { total_count: 2, items: [
      { entity_id: 41, increment_id: '000000041', state: 'processing', updated_at: '2026-10-09 09:00:00', customer_email: 'marco@esempio.it', customer_firstname: 'Marco', customer_lastname: 'Neri',
        extension_attributes: { shipping_assignments: [{ shipping: { address: { street: ['Corso Italia 3'], postcode: '10121', city: 'Torino', region_code: 'TO', telephone: '0110000000' } } }] },
        items: [{ item_id: 1, sku: 'MG-TAZZA', name: 'Tazza', qty_ordered: 2, row_total_incl_tax: 19, discount_amount: 1, product_type: 'configurable' }, { item_id: 2, parent_item_id: 1, sku: 'MG-TAZZA', qty_ordered: 2, row_total_incl_tax: 0 }] },
      { entity_id: 42, increment_id: '000000042', state: 'pending_payment', updated_at: '2026-10-09 09:30:00', items: [] },
    ] } : { items: [], total_count: 0 }),
    'POST /rest/V1/order/:id/ship': (p, c) => { spedizioni.push([p.id, c]); return 77; },
  });
  try {
    await accendi(K, 'magento', { base: S.url, segreti: { token: 'tok-integrazione' } });
    assert.equal((await K.chiama('POST', '/api/connettori/magento/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer tok-integrazione');
    const g = await K.chiama('POST', '/api/connettori/magento/giri/prodotti');
    assert.deepEqual(g.json.risultato, { creati: 2, aggiornati: 0, uguali: 0 }, JSON.stringify(g.json));
    assert.equal(S.chiamate.filter(c => c.percorso === '/rest/V1/products').length, 2);   // si ferma con total_count, non legge la pagina ripetuta
    const tazza = await articolo(K, 'MG-TAZZA'); assert.equal(tazza.giacenza, 12); assert.equal(tazza.prezzo, 9.5);
    assert.equal((await articolo(K, 'MG-PIATTO')).giacenza, 3);
    await aspetta(K); assert.equal(su.length, 0);
    await K.chiama('PATCH', `/api/dati/articoli/${tazza.id}`, { giacenza: 0 }); await aspetta(K);
    assert.deepEqual(su.at(-1), { sourceItems: [{ sku: 'MG-TAZZA', source_code: 'default', quantity: 0, status: 0 }] });
    const o = await K.chiama('POST', '/api/connettori/magento/giri/ordini');
    assert.deepEqual(o.json.risultato, { vendite: 1, ignorati: 1 }, JSON.stringify(o.json));
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe[0]; assert.equal(v.totale, 18); assert.equal(v.pezzi, 2);
    const ant = await K.chiama('POST', '/api/connettori/magento/azioni/spedito', { args: { vendita: v.numero, tracking: 'BRT123', corriere: 'BRT' }, anteprima: true });
    assert.equal(ant.json.righe[1][1], '41', JSON.stringify(ant.json));
    const r = await K.chiama('POST', '/api/connettori/magento/azioni/spedito', { args: { vendita: v.id, tracking: 'BRT123', corriere: 'BRT' } });
    assert.equal(r.json.ok, true, JSON.stringify(r.json)); assert.equal(spedizioni[0][0], '41'); assert.equal(spedizioni[0][1].tracks[0].track_number, 'BRT123');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('BigCommerce: varianti a pagine, giacenza con adjustments/absolute, webhook non firmato col codice nell\'indirizzo → ordine riletto dall\'API', async () => {
  const K = await kubo(), aggiustamenti = [], ganci = [];
  const S = await finto({
    'GET /stores/abc123/v2/store': () => ({ id: 'abc123', name: 'Bottega BC' }),
    'GET /stores/abc123/v3/catalog/products': (p, c, { q }) => (q.get('page') === '1'
      ? { data: [{ id: 1, name: 'Maglia', price: 30, variants: [{ id: 11, sku: 'BC-M-S', price: 30, calculated_price: 30, inventory_level: 4, option_values: [{ label: 'S' }] }, { id: 12, sku: 'BC-M-L', calculated_price: 32, inventory_level: 1, option_values: [{ label: 'L' }] }] }], meta: { pagination: { total_pages: 2, current_page: 1 } } }
      : { data: [{ id: 2, name: 'Cappello', price: 15, variants: [{ id: 21, sku: 'BC-CAP', calculated_price: 15, inventory_level: 9 }] }], meta: { pagination: { total_pages: 2, current_page: 2 } } }),
    'PUT /stores/abc123/v3/inventory/adjustments/absolute': (p, c) => { aggiustamenti.push(c); return { transaction_id: 't1' }; },
    'POST /stores/abc123/v3/hooks': (p, c) => { ganci.push(c); return { data: { id: ganci.length } }; },
    'GET /stores/abc123/v2/orders/:id': p => ({ id: Number(p.id), status_id: p.id === '100' ? 11 : 7, status: p.id === '100' ? 'Awaiting Fulfillment' : 'Awaiting Payment', date_modified: 'Thu, 09 Oct 2026 09:00:00 +0000',
      billing_address: { first_name: 'Sara', last_name: 'Conti', email: 'sara@esempio.it', street_1: 'Via Po 4', zip: '10123', city: 'Torino' } }),
    'GET /stores/abc123/v2/orders/:id/products': () => [{ sku: 'BC-M-L', name: 'Maglia L', quantity: 2, total_inc_tax: '64.0000', applied_discounts: [{ amount: '4.0000' }] }],
  });
  try {
    const pag = await accendi(K, 'bigcommerce', { base: S.url, segreti: { token: 'tok-bc' }, impostazioni: { negozio: 'abc123', sede: 2 } });
    const codice = pag.impostazioni.find(i => i.id === 'codice').valore; assert.ok(codice);
    assert.equal((await K.chiama('POST', '/api/connettori/bigcommerce/prova')).json.messaggio, 'Bottega BC');
    assert.equal(S.chiamate[0].intestazioni['x-auth-token'], 'tok-bc');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/bigcommerce/giri/prodotti')).json.risultato, { creati: 3, aggiornati: 0, uguali: 0 });
    const l = await articolo(K, 'BC-M-L'); assert.equal(l.nome, 'Maglia L'); assert.equal(l.prezzo, 32); assert.equal(l.giacenza, 1);
    await K.chiama('PATCH', `/api/dati/articoli/${l.id}`, { giacenza: 5 }); await aspetta(K);
    assert.deepEqual(aggiustamenti[0], { reason: 'Kubo', items: [{ location_id: 2, variant_id: 12, quantity: 5 }] });
    const w = await K.chiama('POST', '/api/connettori/bigcommerce/azioni/webhook', { args: { indirizzo: 'https://kubo.bottega.example' } });
    assert.equal(w.json.ok, true, JSON.stringify(w.json)); assert.equal(ganci[0].destination, `https://kubo.bottega.example/api/connettori/bigcommerce/in/${codice}`);
    const ev = JSON.stringify({ scope: 'store/order/statusUpdated', store_id: '1', data: { type: 'order', id: 100, status: { previous_status_id: 7, new_status_id: 11 } }, hash: 'h1' });
    assert.equal((await manda(K, '/api/connettori/bigcommerce/in/sbagliato', ev)).stato, 401);
    assert.equal((await manda(K, `/api/connettori/bigcommerce/in/${codice}`, ev)).json.esito, 'vendita creata');
    const ev2 = JSON.stringify({ scope: 'store/order/created', data: { type: 'order', id: 101 } });
    assert.match((await manda(K, `/api/connettori/bigcommerce/in/${codice}`, ev2)).json.esito, /^ignorato/);   // non ancora pagato
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe; assert.equal(v.length, 1); assert.equal(v[0].totale, 60); assert.equal(v[0].cliente.titolo, 'Sara Conti');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Ecwid: prodotti con offset/total, giacenza in uscita, webhook firmato su «eventCreated.eventId» → ordine riletto, doppione', async () => {
  const K = await kubo(), messi = [];
  const S = await finto({
    'GET /api/v3/1234567/profile': () => ({ generalInfo: { storeUrl: 'https://bottega.example' } }),
    'GET /api/v3/1234567/products': (p, c, { q }) => (q.get('offset') === '0' ? { total: 101, count: 1, offset: 0, limit: 100, items: [{ id: 501, sku: 'EC-TAZZA', name: 'Tazza', price: 8, quantity: 10 }] } : { total: 101, count: 1, offset: 100, items: [{ id: 502, sku: 'EC-PIATTO', name: 'Piatto', price: 12, quantity: 2 }] }),
    'PUT /api/v3/1234567/products/:id': (p, c) => { messi.push([p.id, c]); return { updateCount: 1 }; },
    'GET /api/v3/1234567/orders/:id': p => ({ id: p.id, internalId: 900, paymentStatus: 'PAID', email: 'elena@esempio.it', shippingPerson: { name: 'Elena Riva', street: 'Via Verdi 9', city: 'Como', postalCode: '22100', stateOrProvinceCode: 'CO' },
      items: [{ sku: 'EC-TAZZA', name: 'Tazza', quantity: 3, price: 8 }] }),
  });
  try {
    await accendi(K, 'ecwid', { base: S.url, segreti: { token: 'secret_finto', client_secret: 'cs-ecwid' }, impostazioni: { negozio: '1234567' } });
    assert.equal((await K.chiama('POST', '/api/connettori/ecwid/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer secret_finto');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/ecwid/giri/prodotti')).json.risultato, { creati: 2, aggiornati: 0, uguali: 0 });
    const tazza = await articolo(K, 'EC-TAZZA'); await K.chiama('PATCH', `/api/dati/articoli/${tazza.id}`, { giacenza: 7 }); await aspetta(K);
    assert.deepEqual(messi[0], ['501', { quantity: 7, unlimited: false }]);
    const ev = JSON.stringify({ eventId: 'e-1', eventCreated: 1760000000, storeId: 1234567, entityId: 900, eventType: 'order.created', data: { orderId: 'ABC12' } });
    const firma = createHmac('sha256', 'cs-ecwid').update('1760000000.e-1').digest('base64');
    assert.equal((await manda(K, '/api/connettori/ecwid/in', ev, { 'X-Ecwid-Webhook-Signature': 'no' })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/ecwid/in', ev, { 'X-Ecwid-Webhook-Signature': firma })).json.esito, 'vendita creata');
    assert.equal((await manda(K, '/api/connettori/ecwid/in', ev, { 'X-Ecwid-Webhook-Signature': firma })).json.doppione, true);
    const v = (await K.chiama('GET', '/api/dati/vendite')).json.righe; assert.equal(v.length, 1); assert.equal(v[0].totale, 24);
  } finally { await K.chiudi(); await S.chiudi(); }
});
