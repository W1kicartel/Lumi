// Wise Business contro un finto servizio: SCA con il one-time token firmato, estratto del saldo in euro → movimenti della
// tesoreria → proposta della tesoreria → fattura pagata. Nessuna chiamata vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, randomBytes } from 'node:crypto';
import { finto, kubo, accendi } from './connettori-finto.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, prezzo = 100) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara'); await K.chiama('POST', '/api/tesoreria/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo, aliquota: 22 }] })).json;
  return (await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' })).json;
}

test('Wise: SCA firmata con la chiave creata da Kubo, estratto in euro → movimenti della tesoreria → abbinamento → fattura pagata', async () => {
  const K = await kubo(['fatture']); let pubblica = null, ott = null, firmate = 0, numero = '';
  const S = await finto({
    'GET /v2/profiles': (p, c, { intestazioni }) => { assert.equal(intestazioni.authorization, 'Bearer wise-tok'); return [{ id: 101, type: 'PERSONAL' }, { id: 202, type: 'BUSINESS' }]; },
    'GET /v4/profiles/202/balances': () => [{ id: 9001, currency: 'EUR', amount: { value: 1500, currency: 'EUR' } }, { id: 9002, currency: 'USD', amount: { value: 10, currency: 'USD' } }],
    'GET /v1/profiles/202/balance-statements/:saldo/statement.json': (p, c, { q, intestazioni }) => {
      assert.equal(p.saldo, '9001'); assert.equal(q.get('currency'), 'EUR'); assert.equal(q.get('type'), 'COMPACT');
      if (!intestazioni['x-2fa-approval']) { ott = randomBytes(16).toString('hex'); return { stato: 403, intestazioni: { 'x-2fa-approval': ott, 'x-2fa-approval-result': 'REJECTED' }, corpo: {} }; }
      assert.equal(intestazioni['x-2fa-approval'], ott);
      assert.ok(createVerify('RSA-SHA256').update(ott).verify(pubblica, intestazioni['x-signature'], 'base64'), 'firma SCA'); firmate++;
      return { transactions: [
        { type: 'CREDIT', date: '2026-09-20T09:12:00Z', amount: { value: 122, currency: 'EUR' }, details: { type: 'DEPOSIT', description: 'Received money from Rossi srl', senderName: 'ROSSI SRL', paymentReference: `Saldo fattura ${numero}` }, referenceNumber: 'TRANSFER-111' },
        { type: 'DEBIT', date: '2026-09-21T10:00:00Z', amount: { value: -9.9, currency: 'EUR' }, details: { type: 'CARD', description: 'Card transaction', merchant: { name: 'Cartoleria' } }, referenceNumber: 'CARD-222' },
      ] };
    },
  });
  try {
    const f = await fattura(K); numero = f.numero;
    await accendi(K, 'wise', { base: S.url, segreti: { token: 'wise-tok' } });
    assert.equal((await K.chiama('POST', '/api/connettori/wise/prova')).json.ok, true);
    // senza chiave la SCA non passa: l'errore lo dice
    const no = await K.chiama('POST', '/api/connettori/wise/giri/movimenti'); assert.equal(no.json.esito, 'errore'); assert.match(no.json.risultato, /SCA/);
    const ch = await K.chiama('POST', '/api/connettori/wise/azioni/chiavi', { args: {} }); pubblica = ch.json.chiave_pubblica;
    assert.match(pubblica, /BEGIN PUBLIC KEY/); assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/wise')).json).includes('PRIVATE KEY'));
    const g = await K.chiama('POST', '/api/connettori/wise/giri/movimenti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { saldi: 1, nuovi: 2, proposte: 1 }); assert.equal(firmate, 1);
    // l'abbinamento lo propone e lo fa la tesoreria (l'unico motore)
    const m = (await K.chiama('GET', '/api/tesoreria/banca')).json.daAbbinare.find(x => x.proposte.length);
    assert.equal(m.proposte[0].chiavi[0], `f:${f.id}:1`); assert.match(m.descrizione, new RegExp(`Saldo fattura ${numero}`));
    const r = await K.chiama('POST', '/api/tesoreria/abbina', { movimento: m.id, chiavi: m.proposte[0].chiavi });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    const dopo = (await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json; assert.equal(dopo.stato, 'pagata'); assert.equal(dopo.pagata_il, '2026-09-20');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/wise/giri/movimenti')).json.risultato, { saldi: 1, nuovi: 0, proposte: 0 });   // niente doppioni
  } finally { await K.chiudi(); await S.chiudi(); }
});
