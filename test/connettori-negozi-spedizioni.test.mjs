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
    'POST /api/v2/parcels': (p, c) => { pacchi.push(c.parcel); return { parcel: { id: 555, tracking_number: '3SABC123', tracking_url: 'https://tracking.example/3SABC123', carrier: { code: 'brt' }, status: stato, label: { label_printer: 'https://panel.example/labels/555' } } }; },
    'GET /api/v2/parcels/:id': p => ({ parcel: { id: Number(p.id), tracking_number: '3SABC123', carrier: { code: 'brt' }, status: stato, tracking_url: 'https://tracking.example/3SABC123' } }),
  });
  try {
    await accendi(K, 'sendcloud', { base: S.url, segreti: { chiave_pubblica: 'pub', chiave_segreta: 'sec' }, impostazioni: { metodo: 8 } });
    assert.equal((await K.chiama('POST', '/api/connettori/sendcloud/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Basic ' + Buffer.from('pub:sec').toString('base64'));
    const v = await venditaConCliente(K);
    const ant = await K.chiama('POST', '/api/connettori/sendcloud/azioni/etichetta', { args: { vendita: v.numero }, anteprima: true });
    assert.equal(ant.json.righe[1][1], 'Mario Rossi, Via Roma 12, 20121 Milano', JSON.stringify(ant.json));
    const r = await K.chiama('POST', '/api/connettori/sendcloud/azioni/etichetta', { args: { vendita: v.numero, peso: 2.5 } });
    assert.equal(r.json.tracking, '3SABC123', JSON.stringify(r.json));
    assert.deepEqual({ ...pacchi[0], email: undefined }, { name: 'Mario Rossi', address: 'Via Roma', house_number: '12', city: 'Milano', postal_code: '20121', country: 'IT', country_state: 'MI', telephone: '3330000000', email: undefined,
      order_number: String(v.numero), weight: '2.500', request_label: true, total_order_value: '40', total_order_value_currency: 'EUR', shipment: { id: 8 } });
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
