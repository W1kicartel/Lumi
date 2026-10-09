// Klarna (HPP sopra Klarna Payments) e Axerve (ex GestPay) contro finti servizi locali. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, gestionale, accendi, manda } from './connettori-finto.mjs';
import { pubblicoDi } from '../connettori/_soldi/comuni.js';

const vendita = async (K, prezzo = 30, q = 2) => {
  const art = (await K.chiama('POST', '/api/dati/articoli', { nome: 'Vaso', codice: 'V1', prezzo, giacenza: 5 })).json;
  return (await K.chiama('POST', '/api/dati/vendite', { righe: [{ articolo: art.id, quantita: q, prezzo }] })).json;
};
const stato = async (K, id) => (await K.chiama('GET', `/api/dati/vendite/${id}`)).json.stato;
const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, prezzo = 100) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
const BASIC = 'Basic ' + Buffer.from('K123_abc:pw-prova').toString('base64');

test('Klarna: sessione KP + HPP, ritorno riletto dall\'API (sessione → ordine → cattura) → vendita pagata; falsi e doppioni non fanno niente', async () => {
  const K = await gestionale(); let kp = null, hpp = null, hppStato = 'WAITING', ordine = 'AUTHORIZED', catture = [];
  const S = await finto({
    'GET /payments/v1/sessions/:id': () => ({ stato: 404, corpo: { error_code: 'NOT_FOUND' } }),
    'POST /payments/v1/sessions': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, BASIC); kp = c; return { session_id: 'kp-sess-0001', client_token: 'x', payment_method_categories: [] }; },
    'POST /hpp/v1/sessions': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, BASIC); hpp = c; return { session_id: 'hpp-sess-0001', redirect_url: 'https://pay.playground.klarna.com/eu/hpp/payments/abc', session_url: 'x' }; },
    'GET /hpp/v1/sessions/:id': p => p.id === 'hpp-sess-0001' ? { session_id: p.id, status: hppStato, ...(hppStato === 'COMPLETED' ? { order_id: 'ord-0001', klarna_reference: 'R1' } : {}) } : { stato: 404, corpo: {} },
    'GET /ordermanagement/v1/orders/:id': p => ({ order_id: p.id, status: ordine, fraud_status: 'ACCEPTED', order_amount: 6000, remaining_authorized_amount: ordine === 'AUTHORIZED' ? 6000 : 0, captured_amount: ordine === 'CAPTURED' ? 6000 : 0, purchase_currency: 'EUR', merchant_reference1: kp.merchant_reference1 }),
    'POST /ordermanagement/v1/orders/:id/captures': (p, c, { intestazioni }) => { catture.push({ id: p.id, c, chiave: intestazioni['klarna-idempotency-key'] }); ordine = 'CAPTURED'; return { stato: 201, corpo: '' }; },
  });
  try {
    const v = await vendita(K);
    // niente indirizzo nel connettore: vale quello pubblico di Lumi della Libreria
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://lumi.esempio.it' })).stato, 200);
    await accendi(K, 'klarna', { base: S.url, segreti: { password: 'pw-prova' }, impostazioni: { utente: 'K123_abc' } });
    assert.equal((await K.chiama('POST', '/api/connettori/klarna/prova')).json.ok, true);
    const l = await K.chiama('POST', '/api/connettori/klarna/azioni/link_vendita', { args: { vendita: v.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.equal(l.json.url, 'https://pay.playground.klarna.com/eu/hpp/payments/abc');
    assert.equal(kp.order_amount, 6000); assert.equal(kp.purchase_currency, 'EUR'); assert.equal(kp.merchant_reference1, `lumi-v-${v.id}`); assert.equal(kp.order_lines[0].total_amount, 6000);
    assert.equal(hpp.payment_session_url, `${S.url}/payments/v1/sessions/kp-sess-0001`); assert.equal(hpp.options.place_order_mode, 'CAPTURE_ORDER');
    assert.equal(hpp.merchant_urls.success, 'https://lumi.esempio.it/api/connettori/klarna/pub/ritorno?sid={{session_id}}');
    const ritorno = sid => fetch(`${K.base}/api/connettori/klarna/pub/ritorno?sid=${sid}`).then(r => r.text());
    // un sid inventato non tocca l'API; quello vero ancora in attesa non incassa
    const prima = S.chiamate.length;
    assert.match(await ritorno('hpp-falsa-9999'), /in verifica/); assert.equal(S.chiamate.length, prima);
    assert.match(await ritorno('hpp-sess-0001'), /in verifica/); assert.equal(await stato(K, v.id), 'aperta');
    // completata: l'ordine è autorizzato → Lumi lo cattura una volta sola → pagata
    hppStato = 'COMPLETED';
    assert.match(await ritorno('hpp-sess-0001'), /Pagamento ricevuto/);
    assert.equal(await stato(K, v.id), 'pagata');
    assert.equal(catture.length, 1); assert.equal(catture[0].c.captured_amount, 6000); assert.equal(catture[0].chiave, 'lumi-cattura-ord-0001');
    // il cliente ricarica la pagina, il giro ripassa: niente doppioni
    assert.match(await ritorno('hpp-sess-0001'), /in verifica/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/klarna/giri/controlla')).json.risultato, { controllati: 0, pagati: 0 });
    assert.equal(catture.length, 1);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Klarna senza indirizzo pubblico: il giro trova l\'ordine già catturato dalla HPP → fattura pagata', async () => {
  const K = await gestionale(['fatture']); let kp = null, hpp = null;
  const S = await finto({
    'POST /payments/v1/sessions': (p, c) => { kp = c; return { session_id: 'kp-sess-0002' }; },
    'POST /hpp/v1/sessions': (p, c) => { hpp = c; return { session_id: 'hpp-sess-0002', redirect_url: 'https://pay.playground.klarna.com/eu/hpp/payments/def' }; },
    'GET /hpp/v1/sessions/:id': p => ({ session_id: p.id, status: 'COMPLETED', order_id: 'ord-0002' }),
    'GET /ordermanagement/v1/orders/:id': p => ({ order_id: p.id, status: 'CAPTURED', fraud_status: 'ACCEPTED', order_amount: kp.order_amount, captured_amount: kp.order_amount, purchase_currency: 'EUR' }),
  });
  try {
    const f = await fattura(K);
    await accendi(K, 'klarna', { base: S.url, segreti: { password: 'pw-prova' }, impostazioni: { utente: 'K123_abc' } });
    const l = await K.chiama('POST', '/api/connettori/klarna/azioni/link_fattura', { args: { fattura: f.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json)); assert.equal(kp.order_amount, 12200); assert.deepEqual(hpp.merchant_urls, {});
    const g = (await K.chiama('POST', '/api/connettori/klarna/giri/controlla')).json.risultato;
    assert.deepEqual(g, { controllati: 1, pagati: 1 });
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json.stato, 'pagata');
    assert.equal(S.chiamate.filter(c => c.percorso.endsWith('/captures')).length, 0);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Axerve: payment/create con apikey, link alla pagina pagam, esito riletto con payment/detail → vendita pagata; falsi e doppioni non fanno niente', async () => {
  const K = await gestionale(); let creato = null, risultato = '';
  const S = await finto({
    'POST /api/v1/payment/create': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'apikey chiave-prova'); creato = c;
      return { error: { code: '0', description: 'request correctly processed' }, payload: { paymentToken: 'Tok123abc', paymentID: '0000000001', userRedirect: { href: '' } } }; },
    'POST /api/v1/payment/detail': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'apikey chiave-prova');
      if (c.shopTransactionID !== creato?.shopTransactionID) return { error: { code: '1110', description: 'transaction not found' }, payload: null };
      return { error: { code: '0', description: 'ok' }, payload: { transactionResult: risultato, transactionState: risultato === 'OK' ? 'MOV' : '', shopTransactionID: c.shopTransactionID, paymentID: '0000000001', amount: creato.amount, currency: 'EUR' } }; },
  });
  try {
    const v = await vendita(K);
    // l'indirizzo del connettore vince su quello della Libreria
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://altro.esempio.it' })).stato, 200);
    await accendi(K, 'axerve', { base: S.url, segreti: { chiave: 'chiave-prova' }, impostazioni: { shop: 'GESPAY12345', indirizzo: 'https://lumi.esempio.it' } });
    assert.equal((await K.chiama('POST', '/api/connettori/axerve/prova')).json.ok, true);
    const l = await K.chiama('POST', '/api/connettori/axerve/azioni/link_vendita', { args: { vendita: v.id } });
    assert.equal(l.stato, 200, JSON.stringify(l.json));
    assert.equal(l.json.url, 'https://sandbox.gestpay.net/pagam/pagam.aspx?a=GESPAY12345&b=Tok123abc');
    assert.equal(creato.amount, '60.00'); assert.equal(creato.currency, 'EUR'); assert.equal(creato.shopLogin, 'GESPAY12345');
    const t = creato.shopTransactionID; assert.match(t, /^K[0-9A-Z]+$/);
    assert.equal(creato.responseURLs.serverNotificationURL, `https://lumi.esempio.it/api/connettori/axerve/pub/esito?t=${t}`);
    const esito = q => fetch(`${K.base}/api/connettori/axerve/pub/esito?${q}`).then(r => r.text());
    // un codice inventato non tocca l'API; quello vero ancora da pagare non incassa (anche se l'URL dice OK)
    const prima = S.chiamate.length;
    assert.match(await esito('t=KFALSO123456&a=GESPAY12345&esito=OK'), /in verifica/); assert.equal(S.chiamate.length, prima);
    assert.match(await esito(`t=${t}&esito=OK`), /in verifica/); assert.equal(await stato(K, v.id), 'aperta');
    // pagato: la notifica server-to-server in POST rilegge e incassa
    risultato = 'OK';
    const r = await manda(K, `/api/connettori/axerve/in?t=${t}`, new URLSearchParams({ a: 'GESPAY12345', b: 'Tok123abc' }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.esito, 'pagata');
    assert.equal(await stato(K, v.id), 'pagata'); assert.equal((await K.chiama('GET', `/api/dati/vendite/${v.id}`)).json.pagamento, 'carta');
    // la stessa notifica è un doppione; il ritorno del cliente mostra solo la pagina
    assert.equal((await manda(K, `/api/connettori/axerve/in?t=${t}`, '', { 'Content-Type': 'application/x-www-form-urlencoded' })).json.doppione, true);
    assert.match(await esito(`t=${t}`), /in verifica|Pagamento ricevuto/);
    assert.equal(S.chiamate.filter(c => c.percorso.endsWith('/detail')).length, 3);   // prova, in attesa, pagato
    assert.deepEqual((await K.chiama('POST', '/api/connettori/axerve/giri/controlla')).json.risultato, { controllati: 0, pagati: 0 });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Axerve senza indirizzo pubblico: KO non incassa, il giro trova il pagamento OK → fattura pagata', async () => {
  const K = await gestionale(['fatture']); const creati = [], esiti = {};
  const S = await finto({
    'POST /api/v1/payment/create': (p, c) => { creati.push(c); return { error: { code: '0' }, payload: { paymentToken: `Tok${creati.length}`, paymentID: `00${creati.length}`, userRedirect: { href: `https://ecomm.esempio/redirect/${creati.length}` } } }; },
    'POST /api/v1/payment/detail': (p, c) => ({ error: { code: '0' }, payload: { transactionResult: esiti[c.shopTransactionID] || '', shopTransactionID: c.shopTransactionID, amount: creati.find(x => x.shopTransactionID === c.shopTransactionID).amount, currency: 'EUR' } }),
  });
  try {
    const f = await fattura(K);
    await accendi(K, 'axerve', { base: S.url, segreti: { chiave: 'chiave-prova' }, impostazioni: { shop: 'GESPAY12345' } });
    const l1 = await K.chiama('POST', '/api/connettori/axerve/azioni/link_fattura', { args: { fattura: f.id } });
    assert.equal(l1.stato, 200, JSON.stringify(l1.json)); assert.equal(l1.json.url, 'https://ecomm.esempio/redirect/1'); assert.equal(creati[0].responseURLs, undefined); assert.equal(creati[0].amount, '122.00');
    esiti[creati[0].shopTransactionID] = 'KO';
    assert.deepEqual((await K.chiama('POST', '/api/connettori/axerve/giri/controlla')).json.risultato, { controllati: 1, pagati: 0 });
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json.stato, 'emessa');
    // secondo tentativo, pagato
    await K.chiama('POST', '/api/connettori/axerve/azioni/link_fattura', { args: { fattura: f.id } });
    esiti[creati[1].shopTransactionID] = 'OK';
    assert.deepEqual((await K.chiama('POST', '/api/connettori/axerve/giri/controlla')).json.risultato, { controllati: 1, pagati: 1 });
    const dopo = (await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json; assert.equal(dopo.stato, 'pagata'); assert.ok(dopo.pagata_il);
  } finally { await K.chiudi(); await S.chiudi(); }
});

// il contratto del catalogo lo controlla connettori-soldi-catalogo.test.mjs; qui il minimo per chi lancia solo questo file
test('Klarna e Axerve: il nucleo li carica, catalogo e testi in tutte le lingue', async () => {
  const K = await gestionale(['negozio', 'fatture']);
  try {
    const l = (await K.chiama('GET', '/api/connettori')).json;
    for (const id of ['klarna', 'axerve']) {
      const x = l.find(c => c.id === id); assert.ok(x && !x.rotto, `${id}: ${x?.rotto}`);
      const man = (await import(`../connettori/${id}/connettore.js`)).default, c = man.catalogo, en = man.testi.en;
      assert.equal(c.categoria, 'pagamenti'); assert.ok(c.passi.length >= 3 && c.passi.length <= 8);
      assert.equal(en['cat.passi'].length, c.passi.length); assert.equal(en['cat.serve'].length, c.serve.length);
      const chiavi = ['descrizione', ...man.impostazioni.map(i => `imp.${i.id}`), ...Object.keys(man.azioni).map(a => `az.${a}`), ...Object.keys(man.pianificati).map(g => `giro.${g}`)];
      for (const lingua of ['en', 'es', 'fr', 'de', 'pt']) for (const k of chiavi) assert.ok(man.testi[lingua][k], `${id}: manca ${lingua}.${k}`);
    }
  } finally { await K.chiudi(); }
});

test('pubblicoDi: l\'indirizzo del connettore, se no quello https della Libreria (k.pubblico), senza barra finale', () => {
  assert.equal(pubblicoDi({ imp: { indirizzo: 'https://lumi.esempio.it/' }, pubblico: 'https://altro.esempio.it' }), 'https://lumi.esempio.it');
  assert.equal(pubblicoDi({ imp: { indirizzo: '' }, pubblico: 'https://lumi.esempio.it' }), 'https://lumi.esempio.it');
  assert.equal(pubblicoDi({ imp: {}, pubblico: 'http://192.168.1.20:8080' }), '');   // i servizi di pagamento vogliono https
  assert.equal(pubblicoDi({ imp: {}, pubblico: '' }), '');
  assert.equal(pubblicoDi({ imp: { altro: 'https://k.esempio.it' }, pubblico: '' }, 'altro'), 'https://k.esempio.it');
});
