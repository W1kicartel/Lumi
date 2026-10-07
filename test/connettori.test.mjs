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
});
