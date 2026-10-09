// I connettori dei pagamenti italiani (Satispay, PayPal, Nexi XPay) contro finti servizi locali. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createVerify, createHash as h } from 'node:crypto';
import { finto, kubo, accendi, manda } from './connettori-finto.mjs';

const vendita = async (K, prezzo = 30, q = 2) => {
  const art = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo, giacenza: 5 })).json;
  return (await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: art.id, quantita: q, prezzo }] })).json;
};
const stato = async (K, id) => (await K.chiama('GET', `/api/dati/vendite/${id}`)).json.stato;

test('Satispay: attivazione con il codice (RSA), link firmato, callback riletto dall\'API → vendita pagata', async () => {
  const K = await kubo(); let pubblica = null, stato_ = 'PENDING', firmeOk = 0;
  // il finto Satispay controlla la firma HTTP con la chiave pubblica ricevuta all'attivazione
  const verifica = (metodo, percorso, q, int, corpo) => {
    const testo = corpo && typeof corpo === 'object' ? JSON.stringify(corpo) : '';
    assert.equal(int.digest, 'SHA-256=' + createHash('sha256').update(testo).digest('base64'));
    const m = /keyId="([^"]+)", algorithm="rsa-sha256", headers="\(request-target\) host date digest", signature="([^"]+)"/.exec(int.authorization);
    assert.ok(m, int.authorization); assert.equal(m[1], 'kid-1');
    const qs = new URLSearchParams(q).toString(), s = `(request-target): ${metodo} ${percorso}${qs ? '?' + qs : ''}\nhost: ${int.host}\ndate: ${int.date}\ndigest: ${int.digest}`;
    assert.ok(createVerify('RSA-SHA256').update(s).verify(pubblica, m[2], 'base64'), 'firma RSA'); firmeOk++;
  };
  let pagamento = null;
  const S = await finto({
    'POST /g_business/v1/authentication_keys': (p, c) => { assert.equal(c.token, 'ABC123'); pubblica = c.public_key; return { key_id: 'kid-1' }; },
    'POST /g_business/v1/payments': (p, c, { intestazioni }) => { verifica('post', '/g_business/v1/payments', {}, intestazioni, c); pagamento = { id: 'pay-0001', ...c }; return { id: 'pay-0001', status: 'PENDING', code_identifier: 'S6Y-PAY--X', redirect_url: 'https://online.satispay.com/pay/pay-0001' }; },
    'GET /g_business/v1/payments/:id': (p, c, { intestazioni }) => { verifica('get', `/g_business/v1/payments/${p.id}`, {}, intestazioni, null);
      return { id: p.id, type: 'TO_BUSINESS', status: stato_, amount_unit: pagamento.amount_unit, currency: 'EUR', external_code: pagamento.external_code, insert_date: '2026-10-09T10:00:00.000Z' }; },
  });
  try {
    const v = await vendita(K);
    // niente indirizzo nel connettore: per il callback vale l'indirizzo pubblico di Kubo della Libreria
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://kubo.esempio.it' })).stato, 200);
    await accendi(K, 'satispay', { base: S.url, segreti: { codice: 'ABC123' } });
    const a = await K.chiama('POST', '/api/connettori/satispay/azioni/attiva', { args: {} }); assert.equal(a.stato, 200, JSON.stringify(a.json)); assert.equal(a.json.key_id, 'kid-1');
    const pag = (await K.chiama('GET', '/api/connettori/satispay')).json;
    assert.ok(!JSON.stringify(pag).includes('PRIVATE KEY')); assert.equal(pag.impostazioni.find(i => i.id === 'codice').salvato, false);   // il codice vale una volta: tolto
    const l = await K.chiama('POST', '/api/connettori/satispay/azioni/link_vendita', { args: { vendita: v.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.equal(l.json.url, 'https://online.satispay.com/pay/pay-0001');
    assert.equal(pagamento.amount_unit, 6000); assert.equal(pagamento.external_code, `kubo-v-${v.id}`); assert.match(pagamento.callback_url, /^https:\/\/kubo\.esempio\.it\/api\/connettori\/satispay\/pub\/callback\?payment_id=\{uuid\}&c=/);
    const codice = new URL(pagamento.callback_url.replace('{uuid}', 'x')).searchParams.get('c');
    // callback con il codice sbagliato: 404; giusto ma pagamento ancora PENDING: niente
    assert.equal((await fetch(`${K.base}/api/connettori/satispay/pub/callback?payment_id=pay-0001&c=sbagliato`)).status, 404);
    assert.equal((await fetch(`${K.base}/api/connettori/satispay/pub/callback?payment_id=pay-0001&c=${codice}`)).status, 200);
    assert.equal(await stato(K, v.id), 'aperta');
    stato_ = 'ACCEPTED';
    assert.equal((await fetch(`${K.base}/api/connettori/satispay/pub/callback?payment_id=pay-0001&c=${codice}`)).status, 200);
    assert.equal(await stato(K, v.id), 'pagata');
    assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.pagamento, 'carta');
    // il giro non trova più niente da controllare
    assert.deepEqual((await K.chiama('POST', '/api/connettori/satispay/giri/controlla')).json.risultato, { controllati: 0, pagati: 0 });
    assert.ok(firmeOk >= 3);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('PayPal: token client credentials, ordine con custom_id, webhook verificato da PayPal, ordine approvato → catturato → vendita pagata', async () => {
  const K = await kubo(); let ordine = null, catturato = 0, token = 0;
  const S = await finto({
    'POST /v1/oauth2/token': (p, c, { intestazioni }) => { token++; assert.equal(intestazioni.authorization, 'Basic ' + Buffer.from('cid:sec').toString('base64')); assert.equal(c.grant_type, 'client_credentials'); return { access_token: 'A21', expires_in: 32400 }; },
    'POST /v2/checkout/orders': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'Bearer A21'); assert.ok(intestazioni['paypal-request-id']); ordine = c; return { id: '5O190127TN364715T', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T' }] }; },
    'POST /v1/notifications/verify-webhook-signature': (p, c) => ({ verification_status: c.transmission_sig === 'firma-buona' && c.webhook_id === 'WH-1' && c.webhook_event?.id ? 'SUCCESS' : 'FAILURE' }),
    'GET /v2/checkout/orders/:id': p => ({ id: p.id, status: 'APPROVED', purchase_units: [{ custom_id: ordine.purchase_units[0].custom_id }] }),
    'POST /v2/checkout/orders/:id/capture': (p, c, { intestazioni }) => { catturato++; assert.equal(intestazioni['paypal-request-id'], `kubo-cattura-${p.id}`);
      return { id: p.id, status: 'COMPLETED', purchase_units: [{ custom_id: ordine.purchase_units[0].custom_id, payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: ordine.purchase_units[0].amount.value, currency_code: 'EUR' }, create_time: '2026-10-09T09:00:00Z' }] } }] }; },
  });
  try {
    const v = await vendita(K, 12.5, 2);
    await accendi(K, 'paypal', { base: S.url, segreti: { client_id: 'cid', segreto: 'sec' }, impostazioni: { webhook_id: 'WH-1' } });
    assert.equal((await K.chiama('POST', '/api/connettori/paypal/prova')).json.ok, true);
    const l = await K.chiama('POST', '/api/connettori/paypal/azioni/link_vendita', { args: { vendita: v.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.match(l.json.url, /checkoutnow\?token=5O190127TN364715T/);
    assert.deepEqual(ordine.purchase_units[0].amount, { currency_code: 'EUR', value: '25.00' }); assert.equal(ordine.purchase_units[0].custom_id, `kubo-v-${v.id}`);
    assert.equal(token, 1);   // il token resta in memoria finché vale: la prova e il link ne chiedono uno solo
    const ev = JSON.stringify({ id: 'WH-EV-1', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: '5O190127TN364715T', status: 'APPROVED' } });
    const h = sig => ({ 'PAYPAL-AUTH-ALGO': 'SHA256withRSA', 'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1', 'PAYPAL-TRANSMISSION-ID': 't1', 'PAYPAL-TRANSMISSION-SIG': sig, 'PAYPAL-TRANSMISSION-TIME': new Date().toISOString() });
    assert.equal((await manda(K, '/api/connettori/paypal/in', ev, h('falsa'))).stato, 401);
    const r = await manda(K, '/api/connettori/paypal/in', ev, h('firma-buona'));
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'pagata'); assert.equal(catturato, 1);
    assert.equal(await stato(K, v.id), 'pagata');
    assert.equal((await manda(K, '/api/connettori/paypal/in', ev, h('firma-buona'))).json.doppione, true);
    // la cattura completata che arriva dopo non cambia niente
    const ev2 = JSON.stringify({ id: 'WH-EV-2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1', status: 'COMPLETED', custom_id: `kubo-v-${v.id}`, amount: { value: '25.00', currency_code: 'EUR' } } });
    assert.match((await manda(K, '/api/connettori/paypal/in', ev2, h('firma-buona'))).json.esito, /già pagata/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, prezzo = 100) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}

test('Nexi XPay: link con il MAC, esito server-to-server con MAC verificato → fattura pagata con la data, ritorno del cliente', async () => {
  const { macEsito } = await import('../connettori/nexi-xpay/connettore.js');
  const K = await kubo(['fatture']);
  try {
    const f = await fattura(K);
    await accendi(K, 'nexi-xpay', { segreti: { chiave: 'chiave-mac-prova' }, impostazioni: { alias: 'ALIAS_WEB_00012345' } });
    // l'indirizzo è facoltativo: senza (né qui né nella Libreria, né un http) niente link; con quello https della Libreria sì
    const no = await K.chiama('POST', '/api/connettori/nexi-xpay/azioni/link_fattura', { args: { fattura: f.id } });
    assert.notEqual(no.stato, 200); assert.match(JSON.stringify(no.json), /indirizzo pubblico https di Kubo/);
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'http://192.168.1.20:8080' })).stato, 200);
    assert.match(JSON.stringify((await K.chiama('POST', '/api/connettori/nexi-xpay/azioni/link_fattura', { args: { fattura: f.id } })).json), /indirizzo pubblico https di Kubo/);
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://kubo.esempio.it' })).stato, 200);
    const l = await K.chiama('POST', '/api/connettori/nexi-xpay/azioni/link_fattura', { args: { fattura: f.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json));
    const u = new URL(l.json.url), p = Object.fromEntries(u.searchParams);
    assert.equal(u.origin + u.pathname, 'https://int-ecommerce.nexi.it/ecomm/ecomm/DispatcherServlet');
    assert.equal(p.importo, '12200'); assert.equal(p.divisa, 'EUR'); assert.equal(p.urlpost, 'https://kubo.esempio.it/api/connettori/nexi-xpay/in');
    assert.equal(p.mac, createHash('sha1').update(`codTrans=${p.codTrans}divisa=EUR` + `importo=12200chiave-mac-prova`).digest('hex'));
    const es = { alias: p.alias, importo: '12200', divisa: 'EUR', codTrans: p.codTrans, esito: 'OK', data: '20260915', orario: '101500', codAut: 'TESTOK' };
    const corpo = m => new URLSearchParams({ ...es, mac: m }).toString(), form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    assert.equal((await manda(K, '/api/connettori/nexi-xpay/in', corpo('0'.repeat(40)), form)).stato, 401);
    const r = await manda(K, '/api/connettori/nexi-xpay/in', corpo(macEsito(es, 'chiave-mac-prova')), form);
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'pagata');
    const dopo = (await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json; assert.equal(dopo.stato, 'pagata'); assert.equal(dopo.pagata_il, '2026-09-15');
    assert.equal((await manda(K, '/api/connettori/nexi-xpay/in', corpo(macEsito(es, 'chiave-mac-prova')), form)).json.doppione, true);
    // il cliente torna sulla pagina di cortesia con gli stessi parametri: niente doppio incasso
    const g = await fetch(`${K.base}/api/connettori/nexi-xpay/pub/esito?${new URLSearchParams({ ...es, mac: macEsito(es, 'chiave-mac-prova') })}`);
    assert.equal(g.status, 200); assert.match(await g.text(), /Pagamento ricevuto/);
  } finally { await K.chiudi(); }
});
