// I connettori dei negozi online (PrestaShop, Magento, BigCommerce, Wix, Ecwid, Squarespace) contro finti servizi locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
