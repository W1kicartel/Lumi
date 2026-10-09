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
    await accendi(K, 'satispay', { base: S.url, segreti: { codice: 'ABC123' }, impostazioni: { indirizzo: 'https://kubo.esempio.it' } });
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
