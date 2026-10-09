// PROVA: due integrazioni con finti server locali (pagamenti tipo Stripe, e-commerce tipo WooCommerce).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';

attiva();
const ascolta = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
async function gestionale() {
  const srv = creaServer(apri()), base = await ascolta(srv); let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  assert.equal((await chiama('POST', '/api/configura', { azienda: 'Bottega', nome: 'T', email: 't@p.it', password: 'password-lunga', modelli: ['negozio'] })).stato, 200);
  return { srv, base, chiama };
}

// il finto Stripe: corpo «pretty-printed» come quello vero, firma sul corpo grezzo
function firmaStripe(segreto, corpo, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${createHmac('sha256', segreto).update(`${t}.${corpo}`).digest('hex')}`; }
async function mandaStripe(base, segreto, evento, { firma } = {}) {
  const corpo = JSON.stringify(evento, null, 2);
  const r = await fetch(base + '/api/prova-pagamenti/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Stripe-Signature': firma ?? firmaStripe(segreto, corpo), 'User-Agent': 'Stripe/1.0' }, body: corpo });
  return { stato: r.status, json: await r.json().catch(() => null) };
}

test('(a) pagamento in ingresso → vendita pagata', async () => {
  const { srv, base, chiama } = await gestionale();
  try {
    const art = (await chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo: 30, giacenza: 5 })).json;
    const v = await chiama('POST', '/api/dati/vendite', { righe: [{ articolo: art.id, quantita: 2, prezzo: 30 }] });
    assert.equal(v.stato, 200, JSON.stringify(v.json));
    const segreto = 'whsec_provaprovaprova';
    assert.equal((await chiama('PUT', '/api/prova-pagamenti/impostazioni', { segreto })).stato, 200);
    const ev = { id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 6000, amount_received: 6000, currency: 'eur', metadata: { vendita: v.json.id } } } };
    { // anche con X-Lumi (che Stripe non può mettere) il corpo ricostruito non ha la stessa firma del corpo grezzo
      const corpo = JSON.stringify(ev, null, 2), r0 = await fetch(base + '/api/prova-pagamenti/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', 'Stripe-Signature': firmaStripe(segreto, corpo) }, body: corpo });
      console.log('con X-Lumi aggiunta a mano:', r0.status, await r0.text()); }
    const r1 = await mandaStripe(base, segreto, ev); console.log('webhook firmato:', r1.stato, JSON.stringify(r1.json));
    assert.equal(r1.stato, 200);
    assert.equal((await chiama('GET', `/api/dati/vendite/${v.json.id}`)).json.stato, 'pagata');
    assert.equal((await mandaStripe(base, segreto, ev)).json.doppione, true);
    assert.equal((await mandaStripe(base, segreto, { ...ev, id: 'evt_2' }, { firma: 't=1,v1=00' })).stato, 400);
  } finally { srv.close(); }
});

test('(b) WooCommerce: prodotti in entrata, giacenze in uscita', async () => {
  const prodotti = [{ id: 11, sku: 'V1', name: 'Vaso blu', regular_price: '30.00', manage_stock: true, stock_quantity: 7 },
    { id: 12, sku: 'P9', name: 'Piatto', regular_price: '12.50', manage_stock: true, stock_quantity: 3 }];
  const chiamate = [];
  const woo = createServer((req, res) => {
    let b = ''; req.on('data', x => b += x); req.on('end', () => {
      chiamate.push(`${req.method} ${req.url}`);
      if (req.headers.authorization !== 'Basic ' + Buffer.from('ck_x:cs_y').toString('base64')) return res.writeHead(401).end('{}');
      const u = new URL(req.url, 'http://x');
      if (req.method === 'GET' && u.pathname === '/wp-json/wc/v3/products') return res.writeHead(200, { 'Content-Type': 'application/json', 'X-WP-TotalPages': '1' }).end(JSON.stringify(prodotti));
      const m = /^\/wp-json\/wc\/v3\/products\/(\d+)$/.exec(u.pathname);
      if (req.method === 'PUT' && m) { const p = prodotti.find(x => x.id === Number(m[1])); Object.assign(p, JSON.parse(b)); return res.writeHead(200).end(JSON.stringify(p)); }
      res.writeHead(404).end('{}');
    });
  });
  const urlWoo = await ascolta(woo);
  const { srv, chiama } = await gestionale();
  try {
    const gia = (await chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo: 25, giacenza: 5 })).json;
    assert.equal((await chiama('PUT', '/api/prova-negozio/impostazioni', { url: urlWoo, chiave: 'ck_x', segreto: 'cs_y', minuti: 0 })).stato, 200);
    const s = await chiama('POST', '/api/prova-negozio/sincronizza'); console.log('sincronizza:', s.stato, JSON.stringify(s.json));
    assert.equal(s.stato, 200);
    assert.deepEqual(s.json, { creati: 1, aggiornati: 1, uguali: 1 });   // V1 abbinato per codice e aggiornato; P9 creato
    assert.equal((await chiama('GET', `/api/dati/articoli/${gia.id}`)).json.nome, 'Vaso blu');
    await chiama('POST', '/api/prova-negozio/spedisci');
    assert.equal(prodotti[0].stock_quantity, 5, 'la giacenza comanda Lumi: il negozio torna a 5');
    // una vendita in cassa scala il magazzino (automazione del modello) → la giacenza va al negozio
    await chiama('PATCH', `/api/dati/articoli/${gia.id}`, { giacenza: 2 });
    await chiama('POST', '/api/prova-negozio/spedisci');
    assert.equal(prodotti[0].stock_quantity, 2);
    const vend = await chiama('POST', '/api/dati/vendite', { righe: [{ articolo: gia.id, quantita: 1, prezzo: 30 }] });
    await chiama('PATCH', `/api/dati/vendite/${vend.json.id}`, { stato: 'pagata' });
    await chiama('POST', '/api/prova-negozio/spedisci');
    console.log('dopo una vendita in cassa: Lumi', (await chiama('GET', `/api/dati/articoli/${gia.id}`)).json.giacenza, '· negozio', prodotti[0].stock_quantity);
    console.log('registro:', JSON.stringify((await chiama('GET', '/api/prova-negozio/registro')).json.map(x => `${x.verso}:${x.esito}`)));
    console.log('chiamate al finto Woo:', chiamate.join(' | '));
  } finally { srv.close(); woo.close(); }
});
