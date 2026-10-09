// I connettori dei pagamenti europei: Mollie, GoCardless (SEPA), Square. Tutti contro finti servizi locali, nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

let codici = 0;
const vendita = async (K, prezzo = 30, q = 2) => {
  const art = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: `V${++codici}`, prezzo, giacenza: 5 })).json;
  return (await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: art.id, quantita: q, prezzo }] })).json;
};
const fattura = async K => {
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Ferramenta Verdi snc', piva: '01234567897', email: 'conti@verdi.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Assistenza', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  assert.equal((await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' })).stato, 200);
  return { cl, f: (await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json };
};
const leggi = async (K, sem, id) => (await K.chiama('GET', `/api/dati/${sem}/${id}`)).json;
const generato = async (K, id, imp) => (await K.chiama('GET', `/api/connettori/${id}`)).json.impostazioni.find(i => i.id === imp).valore;
const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

test('Mollie: link → webhook con il codice segreto → si rilegge il pagamento → vendita pagata; codice sbagliato 401, doppione', async () => {
  const K = await kubo(), pagamenti = {};
  const S = await finto({
    'POST /v2/payments': (p, c) => { const id = `tr_${Object.keys(pagamenti).length + 1}x`; pagamenti[id] = { ...c, id, status: 'open', _links: { checkout: { href: `https://www.mollie.com/checkout/${id}` } } }; return { stato: 201, corpo: pagamenti[id] }; },
    'GET /v2/payments/:id': p => pagamenti[p.id] || { stato: 404, corpo: { status: 404, detail: 'not found' } },
  });
  try {
    const v = await vendita(K);
    await accendi(K, 'mollie', { base: S.url, segreti: { chiave: 'test_' + 'dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' }, impostazioni: { indirizzo: 'https://kubo.esempio.it/' } });
    const codice = await generato(K, 'mollie', 'webhook'); assert.ok(codice?.length > 20);
    const ant = await K.chiama('POST', '/api/connettori/mollie/azioni/link_vendita', { args: { vendita: v.id }, anteprima: true });
    assert.equal(ant.json.righe[1][1], '60,00 €');
    const l = await K.chiama('POST', '/api/connettori/mollie/azioni/link_vendita', { args: { vendita: v.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.equal(l.json.url, 'https://www.mollie.com/checkout/tr_1x');
    const c = S.chiamate.find(x => x.metodo === 'POST').corpo;
    assert.deepEqual(c.amount, { currency: 'EUR', value: '60.00' }); assert.equal(c.metadata.kubo, `kubo-v-${v.id}`);
    assert.equal(c.webhookUrl, `https://kubo.esempio.it/api/connettori/mollie/in/${codice}`);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'Bearer test_' + 'dHar4XY7LxsDOtmnkVtjNVWXLSlXsM');
    // senza codice o con il codice sbagliato: 401, e Mollie non viene nemmeno chiamato
    const n = S.chiamate.length;
    assert.equal((await manda(K, '/api/connettori/mollie/in', 'id=tr_1x', form)).stato, 401);
    assert.equal((await manda(K, '/api/connettori/mollie/in/sbagliato', 'id=tr_1x', form)).stato, 401);
    assert.equal(S.chiamate.length, n);
    // ancora aperto: ignorato (e non segnato, così il «paid» passa)
    assert.equal((await manda(K, `/api/connettori/mollie/in/${codice}`, 'id=tr_1x', form)).json.esito, 'ignorato: open');
    pagamenti.tr_1x = { ...pagamenti.tr_1x, status: 'paid', paidAt: '2026-10-09T10:00:00+00:00', method: 'creditcard' };
    const r = await manda(K, `/api/connettori/mollie/in/${codice}`, 'id=tr_1x', form);
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'pagata');
    const dopo = await leggi(K, 'vendite', v.id); assert.equal(dopo.stato, 'pagata'); assert.equal(dopo.pagamento, 'carta'); assert.equal(dopo.modificato_da, 'servizio:mollie');
    assert.equal((await manda(K, `/api/connettori/mollie/in/${codice}`, 'id=tr_1x', form)).json.doppione, true);
    // un id che non è un pagamento: ignorato; uno che Mollie non conosce: ignorato, senza errori
    assert.equal((await manda(K, `/api/connettori/mollie/in/${codice}`, 'id=../x', form)).json.esito, 'ignorato');
    assert.equal((await manda(K, `/api/connettori/mollie/in/${codice}`, 'id=tr_nessuno', form)).json.esito, 'ignorato: pagamento sconosciuto');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Mollie: fattura con link, importo diverso avvisa, giro «controlla» senza webhook, POS al terminale', async () => {
  const K = await kubo(['negozio', 'fatture']), pagamenti = {};
  const S = await finto({
    'POST /v2/payments': (p, c) => { const id = `tr_${Object.keys(pagamenti).length + 1}y`; pagamenti[id] = { ...c, id, status: 'open', _links: { checkout: { href: `https://pay.example/${id}` } } }; return { stato: 201, corpo: pagamenti[id] }; },
    'GET /v2/payments/:id': p => pagamenti[p.id],
  });
  try {
    const { f } = await fattura(K), v = await vendita(K, 10, 1);
    await accendi(K, 'mollie', { base: S.url, segreti: { chiave: 'test_' + 'dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' }, impostazioni: { terminale: 'term_7MgL4wea46qkRcoTZjWEH' } });
    const l = await K.chiama('POST', '/api/connettori/mollie/azioni/link_fattura', { args: { fattura: f.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json));
    const c = pagamenti[l.json.id]; assert.equal(c.metadata.kubo, `kubo-f-${f.id}`); assert.equal(c.amount.value, '122.00'); assert.equal(c.webhookUrl, undefined);
    // il POS: method pointofsale con il terminale
    const t = await K.chiama('POST', '/api/connettori/mollie/azioni/terminale', { args: { vendita: v.id } });
    assert.equal(t.stato, 200, JSON.stringify(t.json));
    const pos = pagamenti[t.json.id]; assert.equal(pos.method, 'pointofsale'); assert.equal(pos.terminalId, 'term_7MgL4wea46qkRcoTZjWEH'); assert.equal(pos.amount.value, '10.00');
    // il giro rilegge gli aperti: la fattura pagata con un importo sbagliato avvisa, il POS pagato segna la vendita
    pagamenti[l.json.id] = { ...c, status: 'paid', amount: { currency: 'EUR', value: '100.00' }, paidAt: '2026-10-09T08:00:00Z' };
    pagamenti[t.json.id] = { ...pos, status: 'paid', paidAt: '2026-10-09T08:00:00Z', method: 'pointofsale' };
    const g = await K.chiama('POST', '/api/connettori/mollie/giri/controlla');
    assert.equal(g.stato, 200, JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { pagati: 1, aperti: 1 });
    assert.equal((await leggi(K, 'fatture', f.id)).stato, 'emessa');
    assert.equal((await leggi(K, 'vendite', v.id)).stato, 'pagata');
    assert.deepEqual(K.nucleo.k('mollie').stato.leggi('aperti'), []);   // finiti: non si rileggono più
    // corretto da Mollie, arriva il webhook: la fattura si segna pagata con la data dell'incasso
    pagamenti[l.json.id].amount.value = '122.00';
    const codice = await generato(K, 'mollie', 'webhook');
    assert.equal((await manda(K, `/api/connettori/mollie/in/${codice}`, `id=${l.json.id}`, form)).json.esito, 'pagata');
    const fp = await leggi(K, 'fatture', f.id); assert.equal(fp.stato, 'pagata'); assert.equal(fp.pagata_il, '2026-10-09');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('GoCardless: mandato SEPA dal cliente → webhook firmato collega il mandato → addebito della fattura → confermato dall\'API → pagata', async () => {
  const K = await kubo(['negozio', 'fatture']); let statoPag = 'pending_submission', cliente = null;
  const S = await finto({
    'POST /billing_requests': () => ({ stato: 201, corpo: { billing_requests: { id: 'BRQ0001', status: 'pending' } } }),
    'POST /billing_request_flows': () => ({ stato: 201, corpo: { billing_request_flows: { id: 'BRF0001', authorisation_url: 'https://pay-sandbox.gocardless.com/billing/static/flow?id=BRF0001' } } }),
    'GET /billing_requests/:id': p => ({ billing_requests: { id: p.id, status: 'fulfilled', metadata: { cliente }, links: { mandate_request_mandate: 'MD0001' } } }),
    'POST /payments': (p, c) => ({ stato: 201, corpo: { payments: { id: 'PM0001', status: 'pending_submission', charge_date: '2026-10-14', ...c.payments } } }),
    'GET /mandates/:id': p => ({ mandates: { id: p.id, status: 'active', metadata: { cliente: K.altro } } }),
    'GET /payments/:id': p => p.id === 'PM0001' ? { payments: { id: 'PM0001', status: statoPag, amount: 12200, currency: 'EUR', charge_date: '2026-10-14', metadata: { kubo: K.rif } } } : { stato: 404, corpo: { error: { message: 'not found' } } },
  });
  const firmato = (corpo, s = 'segreto-endpoint-gc') => manda(K, '/api/connettori/gocardless/in', corpo, { 'Webhook-Signature': firmaHmacDi(s, corpo, 'hex') });
  try {
    const { cl, f } = await fattura(K); cliente = cl.id; K.rif = `kubo-f-${f.id}`;
    await accendi(K, 'gocardless', { base: S.url, segreti: { token: 'sandbox_Vj3kLmN0pQrStUvW', webhook: 'segreto-endpoint-gc' } });
    // senza mandato non si addebita
    const ant0 = await K.chiama('POST', '/api/connettori/gocardless/azioni/addebita', { args: { fattura: f.id }, anteprima: true });
    assert.ok(ant0.json.avvisi.some(a => /mandato/.test(a)));
    assert.notEqual((await K.chiama('POST', '/api/connettori/gocardless/azioni/addebita', { args: { fattura: f.id } })).stato, 200);
    // il link per firmare il mandato
    const m = await K.chiama('POST', '/api/connettori/gocardless/azioni/mandato', { args: { cliente: cl.id } });
    assert.equal(m.stato, 200, JSON.stringify(m.json)); assert.match(m.json.url, /^https:\/\/pay-sandbox\.gocardless\.com\//);
    const [br, flow] = S.chiamate.filter(x => x.metodo === 'POST');
    assert.equal(br.intestazioni['gocardless-version'], '2015-07-06'); assert.ok(br.intestazioni['idempotency-key']); assert.equal(br.intestazioni.authorization, 'Bearer sandbox_Vj3kLmN0pQrStUvW');
    assert.deepEqual(br.corpo.billing_requests.mandate_request, { scheme: 'sepa_core', currency: 'EUR', metadata: { cliente: cl.id } });
    assert.equal(flow.corpo.billing_request_flows.links.billing_request, 'BRQ0001'); assert.equal(flow.corpo.billing_request_flows.prefilled_customer.email, 'conti@verdi.example');
    // il webhook: firma sbagliata 401; billing request «fulfilled» → si rilegge e si collega il mandato al cliente
    const ful = JSON.stringify({ events: [{ id: 'EV001', resource_type: 'billing_requests', action: 'fulfilled', links: { billing_request: 'BRQ0001' } }] });
    assert.equal((await firmato(ful, 'altro')).stato, 401);
    assert.equal((await manda(K, '/api/connettori/gocardless/in', ful)).stato, 401);
    const r1 = await firmato(ful); assert.equal(r1.stato, 200, JSON.stringify(r1.json)); assert.equal(r1.json.esito, 'mandato collegato');
    assert.equal(K.nucleo.k('gocardless').sincro.remoto('clienti', cl.id), 'MD0001');
    // l'addebito della fattura con il mandato
    const a = await K.chiama('POST', '/api/connettori/gocardless/azioni/addebita', { args: { fattura: f.id } });
    assert.equal(a.stato, 200, JSON.stringify(a.json)); assert.equal(a.json.id, 'PM0001');
    const pay = S.chiamate.filter(x => x.percorso === '/payments').at(-1).corpo.payments;
    assert.equal(pay.amount, 12200); assert.equal(pay.currency, 'EUR'); assert.equal(pay.links.mandate, 'MD0001'); assert.equal(pay.metadata.kubo, K.rif);
    // «confirmed» nel webhook ma l'API dice ancora pending: si crede all'API
    const conf = id => JSON.stringify({ events: [{ id, resource_type: 'payments', action: 'confirmed', links: { payment: 'PM0001' } }] });
    assert.equal((await firmato(conf('EV002'))).json.esito, 'ignorato: pending_submission');
    assert.equal((await leggi(K, 'fatture', f.id)).stato, 'emessa');
    statoPag = 'confirmed';
    const r2 = await firmato(conf('EV003')); assert.equal(r2.json.esito, 'pagata');
    const fp = await leggi(K, 'fatture', f.id); assert.equal(fp.stato, 'pagata'); assert.equal(fp.pagata_il, '2026-10-14'); assert.equal(fp.modificato_da, 'servizio:gocardless');
    assert.equal((await firmato(conf('EV003'))).json.doppione, true);
    // un addebito fallito avvisa
    const ko = JSON.stringify({ events: [{ id: 'EV004', resource_type: 'payments', action: 'failed', links: { payment: 'PM0002' }, details: { cause: 'insufficient_funds', description: 'Fondi insufficienti' } }] });
    assert.match((await firmato(ko)).json.esito, /PM0002 failed: Fondi insufficienti/);
    // un mandato attivato altrove (dalla dashboard): si rilegge e si collega con il cliente scritto nei suoi metadati; uno annullato avvisa
    K.altro = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Studio Neri' })).json.id;
    const att = JSON.stringify({ events: [{ id: 'EV005', resource_type: 'mandates', action: 'active', links: { mandate: 'MD0002' } }, { id: 'EV006', resource_type: 'creditors', action: 'updated', links: {} }] });
    assert.equal((await firmato(att)).json.esito, 'mandato collegato; ignorato');
    assert.equal(K.nucleo.k('gocardless').sincro.remoto('clienti', K.altro), 'MD0002');
    const ann = JSON.stringify({ events: [{ id: 'EV007', resource_type: 'mandates', action: 'cancelled', links: { mandate: 'MD0002' }, details: { description: 'Il cliente ha revocato il mandato' } }] });
    assert.match((await firmato(ann)).json.esito, /MD0002 cancelled/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Square: link con l\'ordine → webhook firmato (indirizzo + corpo) → pagamento e ordine riletti → vendita pagata; firma sbagliata 401, doppione; Terminal', async () => {
  const K = await kubo(); const pagamenti = {}, ordini = {}, checkout = {};
  const S = await finto({
    'POST /v2/online-checkout/payment-links': (p, c) => { ordini.ORD1 = { id: 'ORD1', ...c.order }; return { payment_link: { id: 'PL1', order_id: 'ORD1', url: 'https://square.link/u/PROVA1' } }; },
    'GET /v2/orders/:id': p => ordini[p.id] ? { order: ordini[p.id] } : { stato: 404, corpo: { errors: [{ detail: 'not found' }] } },
    'GET /v2/payments/:id': p => pagamenti[p.id] ? { payment: pagamenti[p.id] } : { stato: 404, corpo: { errors: [{ detail: 'not found' }] } },
    'POST /v2/terminals/checkouts': (p, c) => { checkout.TC1 = { id: 'TC1', status: 'PENDING', ...c.checkout }; return { checkout: checkout.TC1 }; },
    'GET /v2/terminals/checkouts/:id': p => ({ checkout: checkout[p.id] }),
  });
  const url = 'https://kubo.esempio.es/api/connettori/square/in', chiave = 'firma-square-prova-123';
  const firma = (corpo, u = url, s = chiave) => createHmac('sha256', s).update(u + corpo).digest('base64');
  const firmato = (corpo, f = firma(corpo)) => manda(K, '/api/connettori/square/in', corpo, { 'X-Square-HmacSha256-Signature': f });
  try {
    const v = await vendita(K), v2 = await vendita(K, 15, 1);
    await accendi(K, 'square', { base: S.url, segreti: { token: 'EAAAl_prova_token_sandbox_1234', firma: chiave }, impostazioni: { luogo: 'L8XYZ', indirizzo: 'https://kubo.esempio.es/', terminale: 'device:995CS397A6475287' } });
    const l = await K.chiama('POST', '/api/connettori/square/azioni/link_vendita', { args: { vendita: v.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.equal(l.json.url, 'https://square.link/u/PROVA1');
    const c = S.chiamate[0];
    assert.equal(c.intestazioni['square-version'], '2026-09-16'); assert.equal(c.intestazioni.authorization, 'Bearer EAAAl_prova_token_sandbox_1234');
    assert.ok(c.corpo.idempotency_key); assert.equal(c.corpo.order.location_id, 'L8XYZ'); assert.equal(c.corpo.order.reference_id, `kubo-v-${v.id}`);
    assert.deepEqual(c.corpo.order.line_items[0].base_price_money, { amount: 6000, currency: 'EUR' }); assert.equal(c.corpo.order.line_items[0].quantity, '1');
    // il pagamento arriva: prima APPROVED (ignorato), poi COMPLETED
    pagamenti.PAY1 = { id: 'PAY1', status: 'APPROVED', order_id: 'ORD1', amount_money: { amount: 6000, currency: 'EUR' }, source_type: 'CARD', updated_at: '2026-10-09T09:00:00Z' };
    const ev = (id, tipo = 'payment.updated', ogg = { payment: { id: 'PAY1', status: 'COMPLETED' } }) => JSON.stringify({ merchant_id: 'M1', type: tipo, event_id: id, created_at: '2026-10-09T09:00:00Z', data: { type: tipo.split('.')[0], id: Object.values(ogg)[0].id, object: ogg } });
    const e1 = ev('ev-1');
    // firma sbagliata, firma con un altro indirizzo, firma assente: 401
    assert.equal((await firmato(e1, firma(e1, url, 'altra-chiave'))).stato, 401);
    assert.equal((await firmato(e1, firma(e1, 'https://altro.example/api/connettori/square/in'))).stato, 401);
    assert.equal((await manda(K, '/api/connettori/square/in', e1)).stato, 401);
    assert.equal(S.chiamate.length, 1);   // con la firma sbagliata Square non viene nemmeno richiamato
    assert.equal((await firmato(e1)).json.esito, 'ignorato: APPROVED');   // il corpo dice COMPLETED, l'API no: si crede all'API
    pagamenti.PAY1.status = 'COMPLETED';
    const r = await firmato(ev('ev-2')); assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'pagata');
    const dopo = await leggi(K, 'vendite', v.id); assert.equal(dopo.stato, 'pagata'); assert.equal(dopo.pagamento, 'carta'); assert.equal(dopo.modificato_da, 'servizio:square');
    assert.equal((await firmato(ev('ev-2'))).json.doppione, true);
    assert.equal((await firmato(ev('ev-3', 'payment.created'))).json.esito, 'ignorato: già pagata');
    // lo Square Terminal: checkout con il riferimento, poi terminal.checkout.updated riletto
    const t = await K.chiama('POST', '/api/connettori/square/azioni/terminale', { args: { vendita: v2.id } });
    assert.equal(t.stato, 200, JSON.stringify(t.json)); assert.equal(t.json.id, 'TC1');
    assert.deepEqual(checkout.TC1.device_options, { device_id: 'device:995CS397A6475287' }); assert.equal(checkout.TC1.amount_money.amount, 1500); assert.equal(checkout.TC1.reference_id, `kubo-v-${v2.id}`);
    Object.assign(checkout.TC1, { status: 'COMPLETED', updated_at: '2026-10-09T10:00:00Z' });
    const tc = await firmato(ev('ev-4', 'terminal.checkout.updated', { checkout: { id: 'TC1', status: 'COMPLETED' } }));
    assert.equal(tc.json.esito, 'pagata'); assert.equal((await leggi(K, 'vendite', v2.id)).stato, 'pagata');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('catalogo e testi dei tre connettori: voci, traduzioni e lunghezze', async () => {
  for (const id of ['mollie', 'gocardless', 'square']) {
    const m = (await import(`../connettori/${id}/connettore.js`)).default, c = m.catalogo;
    assert.equal(m.id, id);
    assert.ok(['pagamenti', 'cassa'].includes(c.categoria)); assert.match(c.sito, /^https:\/\//); assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo));
    assert.ok(c.costoNota.length > 20); assert.ok(c.serve.length && c.serve.every(s => s.cosa && s.dove && /^https:\/\//.test(s.link)));
    assert.ok(c.passi.length >= 3 && c.passi.length <= 8); assert.ok(['facile', 'media', 'difficile'].includes(c.difficolta));
    assert.ok(c.zone.length && c.zone.every(z => ['IT', 'UE', 'mondo'].includes(z))); assert.ok(c.fonti.length && c.fonti.every(f => /^https:\/\//.test(f)));
    assert.equal(c.prova, 'finto'); assert.ok(c.parole.length >= 4);
    const en = m.testi.en;
    assert.equal(typeof en['cat.costoNota'], 'string'); assert.equal(en['cat.passi'].length, c.passi.length); assert.equal(en['cat.serve'].length, c.serve.length);
    assert.ok(en['cat.serve'].every(s => s.cosa && s.dove));
    const brevi = ['descrizione', ...m.impostazioni.map(i => `imp.${i.id}`), ...Object.keys(m.azioni).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) for (const b of brevi) assert.ok(m.testi[l]?.[b], `${id} ${l} ${b}`);
  }
});
