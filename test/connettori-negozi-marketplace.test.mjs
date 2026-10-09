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
