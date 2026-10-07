// I connettori: nucleo (rotte pubbliche, segreti cifrati, identità di servizio, anti-eco, coda, pianificatore, mappe, OAuth)
// e i connettori ufficiali, tutti contro finti servizi locali. Nessuna chiamata vera in rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaStripeDi, firmaHmacDi } from './connettori-finto.mjs';
import { TESTI } from '../server/moduli/connettori-lingue.js';
import { prossimo } from '../server/moduli/connettori.js';

const vendita = async (K, prezzo = 30, q = 2) => {
  const art = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo, giacenza: 5 })).json;
  return (await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: art.id, quantita: q, prezzo }] })).json;
};

test('Stripe: webhook firmato → vendita pagata, «Stripe» nella storia, idempotenza, firma sbagliata, segreti mai fuori', async () => {
  const K = await kubo();
  try {
    const v = await vendita(K);
    await accendi(K, 'stripe', { segreti: { chiave: 'sk_test_abc123', firma: 'whsec_provaprova' } });
    // una Checkout Session completata ma non ancora incassata (bonifico SEPA) non segna pagata la vendita
    const sepa = JSON.stringify({ id: 'evt_0', type: 'checkout.session.completed', data: { object: { id: 'cs_0', payment_status: 'unpaid', amount_total: 6000, currency: 'eur', metadata: { vendita: v.id } } } });
    assert.equal((await manda(K, '/api/connettori/stripe/in', sepa, { 'Stripe-Signature': firmaStripeDi('whsec_provaprova', sepa) })).json.esito, 'ignorato');
    assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.stato, 'aperta');
    const ev = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount_received: 6000, currency: 'eur', metadata: { vendita: v.id } } } };
    const corpo = JSON.stringify(ev, null, 2);
    assert.equal((await manda(K, '/api/connettori/stripe/in', corpo, { 'Stripe-Signature': 't=1,v1=00' })).stato, 401);
    const r = await manda(K, '/api/connettori/stripe/in', corpo, { 'Stripe-Signature': firmaStripeDi('whsec_provaprova', corpo) });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'pagata');
    const dopo = (await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json; assert.equal(dopo.stato, 'pagata'); assert.equal(dopo.modificato_da, 'servizio:stripe');
    const storia = (await K.chiama('GET', `/api/dati/vendite/${v.id}/storia`)).json; assert.equal(storia[0].chi, 'Stripe');
    assert.equal((await manda(K, '/api/connettori/stripe/in', corpo, { 'Stripe-Signature': firmaStripeDi('whsec_provaprova', corpo) })).json.doppione, true);
    // i segreti: mai nella pagina, cifrati nel database
    const pag = (await K.chiama('GET', '/api/connettori/stripe')).json;
    assert.ok(!JSON.stringify(pag).includes('sk_test_abc123')); assert.equal(pag.impostazioni.find(i => i.id === 'chiave').salvato, true);
    const grezzi = JSON.stringify(K.db.prepare('SELECT * FROM _connettori_segreti').all()); assert.ok(!grezzi.includes('sk_test_abc123') && !grezzi.includes('whsec_'));
    // l'identità di servizio non è una persona e ha solo i permessi dichiarati
    assert.ok(!(await K.chiama('GET', '/api/utenti')).json.some(u => u.id.startsWith('servizio:')));
    assert.throws(() => K.nucleo.k('stripe').dati.crea('articoli', { nome: 'x' }));
  } finally { await K.chiudi(); }
});

test('Stripe: link di pagamento dall\'azione (il finto Stripe riceve il form), spento = 404', async () => {
  const K = await K0(), S = await finto({ 'POST /v1/checkout/sessions': (p, c) => ({ id: 'cs_1', url: `https://pay.example/${c['metadata[vendita]']}` }) });
  try {
    const v = await vendita(K);
    await accendi(K, 'stripe', { base: S.url, segreti: { chiave: 'sk_test_abc', firma: 'whsec_x1' } });
    const ant = await K.chiama('POST', '/api/connettori/stripe/azioni/link_pagamento', { args: { vendita: v.id }, anteprima: true });
    assert.equal(ant.json.righe[1][1], '60,00 €');
    const r = await K.chiama('POST', '/api/connettori/stripe/azioni/link_pagamento', { args: { vendita: v.id } });
    assert.equal(r.json.url, `https://pay.example/${v.id}`);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer sk_test_abc'); assert.equal(S.chiamate[0].corpo['line_items[0][price_data][unit_amount]'], '6000');
    await K.chiama('PUT', '/api/connettori/stripe', { attivo: false });
    assert.equal((await manda(K, '/api/connettori/stripe/in', '{}')).stato, 404);
  } finally { await K.chiudi(); await S.chiudi(); }
});
const K0 = () => kubo();

test('cataloghi dei messaggi dei connettori: stesse chiavi e parametri nelle sei lingue', () => {
  const par = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const l of ['en', 'es', 'fr', 'de', 'pt']) {
    assert.deepEqual(Object.keys(TESTI[l]).sort(), Object.keys(TESTI.it).sort(), l);
    for (const k of Object.keys(TESTI.it)) assert.deepEqual(par(TESTI[l][k]), par(TESTI.it[k]), `${l} ${k}`);
  }
});

test('pianificatore: «ogni» e «alle» nel fuso', () => {
  const t = Date.parse('2026-10-07T10:00:00Z');
  assert.equal(prossimo({ ogni: '15m' }, t), t + 15 * 6e4);
  assert.equal(new Date(prossimo({ alle: '03:00' }, t, 'Europe/Rome')).toISOString(), '2026-10-08T01:00:00.000Z');
  // il giorno del ritorno all'ora solare (25 ottobre 2026): le 9 sono le 8:00 UTC, non le 7:00; e il cambio di marzo
  assert.equal(new Date(prossimo({ alle: '09:00' }, Date.parse('2026-10-25T01:00:00Z'), 'Europe/Rome')).toISOString(), '2026-10-25T08:00:00.000Z');
  assert.equal(new Date(prossimo({ alle: '09:00' }, Date.parse('2026-03-29T00:30:00Z'), 'Europe/Rome')).toISOString(), '2026-03-29T07:00:00.000Z');
});

test('SumUp: il webhook senza firma non basta, si rilegge il checkout dall\'API', async () => {
  const K = await kubo(); let stato = 'PENDING', ref = '';
  const S = await finto({ 'GET /v0.1/checkouts/:id': p => ({ id: p.id, status: stato, amount: 60, currency: 'EUR', checkout_reference: ref }) });
  try {
    const v = await vendita(K); ref = `kubo-${v.id}`;
    await accendi(K, 'sumup', { base: S.url, segreti: { chiave: 'sup_sk_x' } });
    const ev = JSON.stringify({ event_type: 'CHECKOUT_STATUS_CHANGED', id: 'chk_1' });
    assert.match((await manda(K, '/api/connettori/sumup/in', ev)).json.esito, /ignorato/);   // un falso «pagato» non passa: l'API dice PENDING
    assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.stato, 'aperta');
    stato = 'PAID';
    assert.equal((await manda(K, '/api/connettori/sumup/in', ev)).json.esito, 'pagata');
    assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.stato, 'pagata');
    assert.equal(S.chiamate.at(-1).intestazioni.authorization, 'Bearer sup_sk_x');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('WooCommerce: prodotti a pagine, giacenza in uscita senza eco, ordine firmato → vendita, mappa resistente alle rinomine', async () => {
  const K = await kubo(), put = [];
  const prodotti = [[{ id: 11, sku: 'V1', name: 'Vaso blu', regular_price: '30.00', stock_quantity: 7 }], [{ id: 12, sku: 'P9', name: 'Piatto', regular_price: '12.50', stock_quantity: 3 }]];
  const S = await finto({
    'GET /wp-json/wc/v3/products': (p, c, { q }) => ({ stato: 200, intestazioni: { 'X-WP-TotalPages': '2' }, corpo: prodotti[Number(q.get('page') || 1) - 1] }),
    'PUT /wp-json/wc/v3/products/:id': (p, c) => { put.push([p.id, c.stock_quantity]); return { id: p.id }; },
  });
  try {
    await accendi(K, 'woocommerce', { base: S.url, segreti: { ck: 'ck_x', cs: 'cs_y', webhook: 'segreto-woo' } });
    // l'utente rinomina «Giacenza» in «Pezzi in negozio»: l'id del campo non cambia, la mappa regge
    const def = (await K.chiama('GET', '/api/schema')).json.find(e => e.id === 'articoli');
    def.campi.find(c => c.id === 'giacenza').nome = 'Pezzi in negozio';
    assert.equal((await K.chiama('PUT', '/api/schema/articoli', def)).stato, 200);
    const g = await K.chiama('POST', '/api/connettori/woocommerce/giri/prodotti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { creati: 2, aggiornati: 0, uguali: 0 });
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Basic ' + Buffer.from('ck_x:cs_y').toString('base64'));
    assert.equal(S.chiamate.filter(c => c.metodo === 'GET').length, 2);
    await K.nucleo.lavora(); assert.equal(put.length, 0);   // quello che arriva dal sito non torna indietro
    assert.deepEqual((await K.chiama('POST', '/api/connettori/woocommerce/giri/prodotti')).json.risultato, { creati: 0, aggiornati: 0, uguali: 2 });
    const vaso = (await K.chiama('GET', '/api/dati/articoli?q=V1')).json.righe[0]; assert.equal(vaso.giacenza, 7); assert.equal(vaso.prezzo, 30);
    // Kubo cambia la giacenza due volte: in coda conta solo l'ultima
    await K.chiama('PATCH', `/api/dati/articoli/${vaso.id}`, { giacenza: 6 }); await K.chiama('PATCH', `/api/dati/articoli/${vaso.id}`, { giacenza: 4 });
    await new Promise(r => setTimeout(r, 50)); await K.nucleo.lavora();
    assert.deepEqual(put.at(-1), ['11', 4]); assert.ok(put.length <= 2);
    // ordine dal sito, firmato
    // «price» è senza IVA: la vendita porta il pagato (totale della riga + IVA), 2 × 12,50 ivato = 25
    const ordine = JSON.stringify({ id: 501, number: '501', status: 'processing', line_items: [{ sku: 'P9', quantity: 2, price: 10.2459, total: '20.49', total_tax: '4.51' }] });
    assert.equal((await manda(K, '/api/connettori/woocommerce/in', ordine, { 'X-WC-Webhook-Signature': 'sbagliata' })).stato, 401);
    const r = await manda(K, '/api/connettori/woocommerce/in', ordine, { 'X-WC-Webhook-Signature': firmaHmacDi('segreto-woo', ordine), 'X-WC-Webhook-Delivery-ID': 'd1' });
    assert.equal(r.json.esito, 'vendita creata', JSON.stringify(r.json));
    const vendite = (await K.chiama('GET', '/api/dati/vendite')).json.righe; assert.equal(vendite.length, 1); assert.equal(vendite[0].stato, 'pagata'); assert.equal(vendite[0].totale, 25);
    // il ping di creazione del webhook (form-urlencoded) non rompe niente
    const ping = 'webhook_id=7';
    assert.equal((await manda(K, '/api/connettori/woocommerce/in', ping, { 'Content-Type': 'application/x-www-form-urlencoded', 'X-WC-Webhook-Signature': firmaHmacDi('segreto-woo', ping) })).json.esito, 'ignorato');
    const pag = (await K.chiama('GET', '/api/connettori/woocommerce')).json;
    assert.equal(pag.mappe.find(m => m.sem === 'articoli').campi.find(c => c.sem === 'giacenza').campo, 'giacenza');
    assert.ok(pag.registro.some(x => x.verso === 'entrata' && x.esito === 'ok'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Shopify: client credentials con token che scade e si rinnova, GraphQL a pagine, inventorySetQuantities, webhook', async () => {
  const K = await kubo(); let token = 0; const mut = [];
  const S = await finto({
    'POST /admin/oauth/access_token': (p, c) => (c.grant_type === 'client_credentials' && c.client_secret === 'shpss_x' ? { access_token: `shpat_${++token}`, expires_in: token === 1 ? 30 : 86399, scope: 'read_products' } : { stato: 401, corpo: {} }),
    'POST /admin/api/2026-07/graphql.json': (p, c, { intestazioni }) => {
      if (!/^shpat_/.test(intestazioni['x-shopify-access-token'])) return { stato: 401, corpo: {} };
      if (c.query.includes('productVariants')) return { data: { productVariants: c.variables.dopo ? { nodes: [{ id: 'gid://shopify/ProductVariant/2', sku: 'B2', price: '9.90', inventoryQuantity: 4, product: { title: 'Borsa' } }], pageInfo: { hasNextPage: false, endCursor: 'b' } }
        : { nodes: [{ id: 'gid://shopify/ProductVariant/1', sku: 'A1', price: '20.00', inventoryQuantity: 2, product: { title: 'Anello' } }], pageInfo: { hasNextPage: true, endCursor: 'a' } } } };
      if (c.query.includes('productVariant(id')) return { data: { productVariant: { inventoryItem: { id: 'gid://shopify/InventoryItem/9' } } } };
      if (c.query.includes('inventorySetQuantities')) { mut.push(c); return { data: { inventorySetQuantities: { userErrors: [] } } }; }
      return { data: { shop: { name: 'Bottega' } } };
    },
  });
  try {
    await accendi(K, 'shopify', { base: S.url, segreti: { client_id: 'cid', client_secret: 'shpss_x' }, impostazioni: { negozio: 'bottega', posizione: 'gid://shopify/Location/1' } });
    assert.equal((await K.chiama('POST', '/api/connettori/shopify/prova')).json.ok, true);
    const g = await K.chiama('POST', '/api/connettori/shopify/giri/prodotti'); assert.deepEqual(g.json.risultato, { creati: 2, aggiornati: 0, uguali: 0 }, JSON.stringify(g.json));
    assert.equal(token, 2);   // il primo token durava 30 s: il nucleo ne ha chiesto uno nuovo prima di usarlo
    const a = (await K.chiama('GET', '/api/dati/articoli?q=A1')).json.righe[0];
    await K.chiama('PATCH', `/api/dati/articoli/${a.id}`, { giacenza: 1 }); await new Promise(r => setTimeout(r, 50)); await K.nucleo.lavora();
    assert.equal(mut.length, 1); assert.equal(mut[0].variables.input.quantities[0].quantity, 1); assert.equal(mut[0].variables.input.quantities[0].changeFromQuantity, null); assert.ok(mut[0].query.includes('@idempotent'));
    const o = JSON.stringify({ id: 9001, name: '#1001', financial_status: 'paid', line_items: [{ sku: 'B2', quantity: 1, price: '9.90' }] });
    const r = await manda(K, '/api/connettori/shopify/in', o, { 'X-Shopify-Hmac-Sha256': firmaHmacDi('shpss_x', o), 'X-Shopify-Topic': 'orders/create', 'X-Shopify-Webhook-Id': 'w1' });
    assert.equal(r.json.esito, 'vendita creata', JSON.stringify(r.json));
    assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/shopify')).json).includes('shpat_'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, { email = 'rossi@cliente.example', scadenza } = {}) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', ...(scadenza ? { scadenza } : {}), righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}

test('Openapi SDI: invio dell\'XML di Kubo, notifica di scarto dal callback con il codice segreto, passive', async () => {
  const K = await kubo(['negozio', 'fatture']);
  const S = await finto({ 'POST /invoices': (p, c) => (typeof c === 'string' && c.includes('<ImportoTotaleDocumento>122.00<') ? { success: true, data: { uuid: 'u-1' } } : { stato: 400, corpo: { message: 'xml' } }) });
  try {
    const f = await fattura(K);
    const pag = await accendi(K, 'openapi-sdi', { base: S.url, segreti: { token: 'tok_x' } });
    // una bozza non va allo SDI: l'anteprima lo dice e l'invio si ferma prima di chiamare il servizio
    const bozza = (await K.chiama('POST', '/api/dati/fatture', { cliente: f.cliente.id, data: '2026-09-02', righe: [{ descrizione: 'Prova', quantita: 1, prezzo: 10, aliquota: 22 }] })).json;
    assert.equal((await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: bozza.id }, anteprima: true })).json.avvisi.length, 1);
    assert.equal((await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: bozza.id } })).stato, 502); assert.equal(S.chiamate.length, 0);
    const codice = pag.impostazioni.find(i => i.id === 'callback').valore; assert.ok(codice.length > 20);
    const ant = (await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: f.id }, anteprima: true })).json; assert.equal(ant.avvisi.length, 0);
    const r = await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.uuid, 'u-1'); assert.match(r.json.file, /^IT12345678903_\w{5}\.xml$/);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer tok_x'); assert.equal(S.chiamate[0].intestazioni['content-type'], 'application/xml');
    assert.equal((await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: f.id } })).stato, 502);   // già inviata
    const ns = JSON.stringify({ event: 'customer-notification', data: { invoice_uuid: 'u-1', notification: { type: 'NS', message: 'Codice destinatario errato' } } });
    assert.equal((await manda(K, '/api/connettori/openapi-sdi/in/sbagliato', ns)).stato, 401);
    assert.equal((await manda(K, '/api/connettori/openapi-sdi/in', ns)).stato, 401);
    assert.match((await manda(K, `/api/connettori/openapi-sdi/in/${codice}`, ns)).json.esito, /scartata/);
    assert.match((await manda(K, `/api/connettori/openapi-sdi/in/${codice}`, JSON.stringify({ event: 'supplier-invoice', data: { uuid: 'p-1', invoice: { sender: { business_name: 'Fornitore spa' } } } }))).json.esito, /passiva/);
    // una persona in sola lettura non può inviare
    await K.chiama('POST', '/api/utenti', { nome: 'Lia', email: 'lia@esempio.it', password: 'password-lunga', ruolo: 'lettura' });
    await K.chiama('POST', '/api/esci'); await K.chiama('POST', '/api/accedi', { email: 'lia@esempio.it', password: 'password-lunga' });
    assert.equal((await K.chiama('POST', '/api/connettori/openapi-sdi/azioni/invia', { args: { fattura: f.id } })).stato, 403);
    assert.deepEqual((await K.chiama('GET', '/api/connettori/azioni')).json, []);
    assert.equal((await K.chiama('GET', '/api/connettori/openapi-sdi')).stato, 403);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Email e PEC: fattura per email con l\'XML in allegato e promemoria delle scadute (finto server SMTP)', async () => {
  const { createServer } = await import('node:net');
  const posta = [];
  const smtp = createServer(s => {
    s.write('220 finto ESMTP\r\n'); let dati = false, buf = '', cur = { rcpt: [] };
    s.on('data', x => { buf += x; let i;
      while (dati ? (i = buf.indexOf('\r\n.\r\n')) >= 0 : (i = buf.indexOf('\r\n')) >= 0) {
        if (dati) { cur.dati = buf.slice(0, i); buf = buf.slice(i + 5); dati = false; posta.push(cur); cur = { rcpt: [] }; s.write('250 ok\r\n'); continue; }
        const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^EHLO/.test(l)) s.write('250-finto\r\n250 AUTH PLAIN\r\n'); else if (/^AUTH PLAIN/.test(l)) { cur.auth = Buffer.from(l.slice(11), 'base64').toString(); s.write('235 ok\r\n'); }
        else if (/^MAIL/.test(l)) s.write('250 ok\r\n'); else if (/^RCPT/.test(l)) { cur.rcpt.push(l); s.write('250 ok\r\n'); } else if (l === 'DATA') { dati = true; s.write('354 vai\r\n'); }
        else if (l === 'QUIT') { s.end('221 ciao\r\n'); } else s.write('500 ?\r\n');
      } });
  });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  const K = await kubo(['negozio', 'fatture']);
  try {
    const f = await fattura(K, { scadenza: '2026-09-15' });
    await accendi(K, 'posta', { segreti: { password: 'pw-casella' }, impostazioni: { host: '127.0.0.1', porta: smtp.address().port, sicurezza: 'nessuna', utente: 'info@bottega.example', mittente: 'Bottega <info@bottega.example>' } });
    assert.equal((await K.chiama('POST', '/api/connettori/posta/prova')).json.ok, true);
    const r = await K.chiama('POST', '/api/connettori/posta/azioni/invia_fattura', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.a, 'rossi@cliente.example');
    const m = posta.at(-1); assert.match(m.rcpt[0], /rossi@cliente\.example/); assert.equal(m.auth, '\0info@bottega.example\0pw-casella');
    assert.match(m.dati, /filename="IT12345678903_\w{5}\.xml"/);
    const g = await K.chiama('POST', '/api/connettori/posta/giri/promemoria'); assert.deepEqual(g.json.risultato, { mandati: 1 }, JSON.stringify(g.json));
    assert.deepEqual((await K.chiama('POST', '/api/connettori/posta/giri/promemoria')).json.risultato, { mandati: 0 });   // una volta sola
    // senza il consenso alla rete interna il server locale si rifiuta
    await K.chiama('PUT', '/api/connettori/posta', { interni: false });
    assert.equal((await K.chiama('POST', '/api/connettori/posta/prova')).json.ok, false);
  } finally { await K.chiudi(); smtp.close(); }
});

test('Calendario: feed .ics con il codice segreto, Google Calendar con OAuth (PKCE, ritorno, rinnovo del token)', async () => {
  const K = await kubo(['studio']); let scambi = [];
  const S = await finto({
    'POST /token': (p, c) => { scambi.push(c); return c.grant_type === 'authorization_code' ? { access_token: 'ya29.a', refresh_token: 'r1', expires_in: 1 } : { access_token: 'ya29.b', expires_in: 3600 }; },
    'POST /calendar/v3/calendars/primary/events': (p, c) => ({ id: 'g1', summary: c.summary }),
    'PATCH /calendar/v3/calendars/primary/events/:id': p => ({ id: p.id }),
  });
  try {
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna; Bianchi' })).json;
    const ap = (await K.chiama('POST', '/api/dati/appuntamenti', { quando: new Date(Date.now() + 864e5).toISOString(), cliente: cl.id })).json;
    const pag = await accendi(K, 'calendario', { base: S.url, segreti: { client_id: 'gid', client_secret: 'gsec' } });
    const codice = pag.impostazioni.find(i => i.id === 'feed').valore;
    assert.equal((await fetch(`${K.base}/api/connettori/calendario/pub/agenda.ics?t=no`)).status, 404);
    const ics = await (await fetch(`${K.base}/api/connettori/calendario/pub/agenda.ics?t=${codice}`)).text();
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /SUMMARY:Anna\\; Bianchi/); assert.match(ics, new RegExp(`UID:${ap.id}@kubo`));
    // OAuth: inizio (con PKCE) → il servizio rimanda a «ritorno» con code e state → token salvato cifrato
    const ini = (await K.chiama('POST', '/api/connettori/calendario/oauth/inizio', { base: K.base })).json;
    const u = new URL(ini.url); assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('access_type'), 'offline');
    const rit = await fetch(`${K.base}/api/connettori/calendario/oauth/ritorno?code=c1&state=${u.searchParams.get('state')}`, { redirect: 'manual' });
    assert.equal(rit.status, 302); assert.match(rit.headers.get('location'), /oauth=ok/);
    assert.equal(scambi[0].code_verifier.length, 43);
    assert.match((await fetch(`${K.base}/api/connettori/calendario/oauth/ritorno?code=c1&state=${u.searchParams.get('state')}`, { redirect: 'manual' })).headers.get('location'), /oauth=scaduto/);   // lo state vale una volta
    // un appuntamento spostato va a Google; il token durava 1 s e si rinnova con il refresh token
    await K.chiama('PATCH', `/api/dati/appuntamenti/${ap.id}`, { quando: new Date(Date.now() + 2 * 864e5).toISOString() });
    await new Promise(r => setTimeout(r, 50)); await K.nucleo.lavora();
    assert.ok(scambi.some(c => c.grant_type === 'refresh_token' && c.refresh_token === 'r1'));
    assert.ok(S.chiamate.some(c => c.percorso === '/calendar/v3/calendars/primary/events' && c.intestazioni.authorization === 'Bearer ya29.b'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('nucleo: un connettore di terzi si attiva solo con la sua somma, SSRF, pianificatore che recupera un giro perso', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs'), { join } = await import('node:path'), { tmpdir } = await import('node:os');
  const { apri } = await import('../server/db.js'), { creaServer } = await import('../server/api.js'), { istanze } = await import('../server/moduli/connettori.js');
  const dir = mkdtempSync(join(tmpdir(), 'kubo-conn-')); mkdirSync(join(dir, 'connettori', 'mio'), { recursive: true });
  writeFileSync(join(dir, 'connettori', 'mio', 'connettore.js'), `export default { id: 'mio', nome: 'Mio', impostazioni: [{ id: 'url', nome: 'Url', tipo: 'url' }], permessi: { clienti: { leggi: true } },
    pianificati: { conta: { ogni: '1h', async giro(k) { const n = (k.stato.leggi('n') || 0) + 1; k.stato.scrivi('n', n); return { n }; } } } };`);
  const db = apri(join(dir, 'kubo.db')), srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (m, p, c) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: c ? JSON.stringify(c) : undefined }); const s = r.headers.get('set-cookie'); if (s) biscotto = s.split(';')[0]; return { stato: r.status, json: await r.json().catch(() => null) }; };
  try {
    await chiama('POST', '/api/configura', { azienda: 'B', nome: 'T', email: 't@esempio.it', password: 'prova-kubo-1', modelli: ['negozio'] });
    const n = istanze.get(db); await n.pronti;
    const mio = (await chiama('GET', '/api/connettori')).json.find(c => c.id === 'mio'); assert.equal(mio.origine, 'locale'); assert.match(mio.somma, /^[0-9a-f]{64}$/);
    assert.equal((await chiama('PUT', '/api/connettori/mio', { attivo: true })).stato, 409);
    assert.equal((await chiama('PUT', '/api/connettori/mio', { attivo: true, somma: mio.somma })).stato, 200);
    // SSRF: un indirizzo della rete interna non si salva senza il consenso per questo connettore
    assert.equal((await chiama('PUT', '/api/connettori/mio', { impostazioni: { url: 'http://192.168.1.10/x' } })).stato, 400);
    assert.equal((await chiama('PUT', '/api/connettori/mio', { interni: true, impostazioni: { url: 'http://192.168.1.10/x' } })).stato, 200);
    await assert.rejects(n.k('stripe').http.get('http://127.0.0.1:9/'), /interna/);
    // primo passaggio: il giro «ogni» parte subito; poi Kubo «resta spento» 5 ore: al riavvio un solo giro di recupero
    await n.pianificatore(); assert.equal(n.k('mio').stato.leggi('n'), 1);
    await n.pianificatore(Date.now() + 5 * 36e5); assert.equal(n.k('mio').stato.leggi('n'), 2);
    await n.pianificatore(Date.now() + 5 * 36e5); assert.equal(n.k('mio').stato.leggi('n'), 2);
    // la chiave dei segreti sta in un file 600 accanto ai dati
    await chiama('PUT', '/api/connettori/stripe', { segreti: { chiave: 'sk_test_zzz' } });
    const { statSync } = await import('node:fs'); assert.equal(statSync(join(dir, 'connettori-chiave')).mode & 0o777, 0o600);
    // solo il titolare
    await chiama('POST', '/api/utenti', { nome: 'C', email: 'c@esempio.it', password: 'password-lunga', ruolo: 'collaboratore' });
    biscotto = ''; await chiama('POST', '/api/accedi', { email: 'c@esempio.it', password: 'password-lunga' });
    assert.equal((await chiama('GET', '/api/connettori')).stato, 403);
    assert.equal((await chiama('PUT', '/api/connettori/stripe', { attivo: true })).stato, 403);
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
