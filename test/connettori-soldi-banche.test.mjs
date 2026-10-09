// Le banche (Enable Banking, Qonto, Revolut Business) contro finti servizi locali: il collegamento, i movimenti a pagine,
// la proposta di abbinamento con una fattura emessa e la riconciliazione. Il finto servizio controlla anche l'accesso
// (JWT RS256 verificato con la chiave pubblica, la chiave API di Qonto). Nessuna chiamata vera in rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { finto, kubo, accendi } from './connettori-finto.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const json64 = s => JSON.parse(Buffer.from(s, 'base64url').toString());
// un JWT RS256 valido per la chiave pubblica del test → { testa, corpo } oppure null
function jwtValido(t) {
  const [a, b, f] = String(t || '').split('.'); if (!f) return null;
  if (!verify('RSA-SHA256', Buffer.from(`${a}.${b}`), publicKey, Buffer.from(f, 'base64url'))) return null;
  return { testa: json64(a), corpo: json64(b) };
}

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
// una fattura emessa da 122,00 € (100 + IVA 22%)
async function fattura(K) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Verdi Arredi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Mobile su misura', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  assert.equal(e.json.totale, 122); assert.ok(e.json.numero);
  return e.json;
}
// dalla proposta alla fattura pagata, con la data del movimento
async function riconcilia(K, id, f, data) {
  const pr = (await K.chiama('POST', `/api/connettori/${id}/azioni/proposte`, { args: {} })).json.proposte;
  assert.equal(pr.length, 1, JSON.stringify(pr)); assert.equal(pr[0].fattura, f.id); assert.match(pr[0].motivo, /numero nella causale/);
  const ant = (await K.chiama('POST', `/api/connettori/${id}/azioni/riconcilia`, { args: { movimento: pr[0].movimento }, anteprima: true })).json;
  assert.equal(ant.avvisi.length, 0, JSON.stringify(ant));
  const r = await K.chiama('POST', `/api/connettori/${id}/azioni/riconcilia`, { args: { movimento: pr[0].movimento } });
  assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.fattura, f.id);
  const dopo = (await K.chiama('GET', `/api/dati/fatture/${f.id}`)).json; assert.equal(dopo.stato, 'pagata'); assert.equal(dopo.pagata_il, data);
  assert.equal(dopo.modificato_da, `servizio:${id}`);
  assert.equal((await K.chiama('POST', `/api/connettori/${id}/azioni/proposte`, { args: {} })).json.proposte.length, 0);
}

test('catalogo delle banche: categoria, guida, fonti e traduzioni complete', async () => {
  for (const id of ['enable-banking', 'qonto', 'revolut-business']) {
    const m = (await import(`../connettori/${id}/connettore.js`)).default, c = m.catalogo;
    assert.equal(m.id, id); assert.equal(c.categoria, 'banche'); assert.equal(c.prova, 'finto');
    assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo)); assert.ok(['facile', 'media', 'difficile'].includes(c.difficolta));
    assert.ok(c.passi.length >= 3 && c.passi.length <= 8, id); assert.ok(c.serve.length && c.fonti.length && c.parole.length && c.zone.length);
    assert.ok(c.zone.every(z => ['IT', 'UE', 'mondo'].includes(z))); assert.ok([c.sito, ...c.fonti, ...c.serve.map(s => s.link)].every(u => /^https:\/\//.test(u)));
    assert.equal(m.testi.en['cat.passi'].length, c.passi.length, id); assert.equal(m.testi.en['cat.serve'].length, c.serve.length, id); assert.ok(m.testi.en['cat.costoNota']);
    const chiavi = ['descrizione', ...m.impostazioni.map(i => `imp.${i.id}`), ...Object.keys(m.azioni).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) for (const ch of chiavi) assert.ok(m.testi[l]?.[ch], `${id} ${l} ${ch}`);
  }
});

test('Enable Banking: JWT RS256, consenso con state, sessione, movimenti a pagine → proposta → fattura pagata', async () => {
  const K = await kubo(['fatture']); let f = null, sessioni = 0;
  // il finto Enable Banking: ogni chiamata deve portare un JWT valido dell'applicazione «app-prova»
  const accesso = h => { const j = jwtValido(String(h.authorization || '').replace(/^Bearer /, ''));
    return j && j.testa.alg === 'RS256' && j.testa.kid === 'app-prova' && j.corpo.iss === 'enablebanking.com' && j.corpo.aud === 'api.enablebanking.com' && j.corpo.exp - j.corpo.iat <= 86400 && j.corpo.exp > Date.now() / 1000; };
  const no = { stato: 401, corpo: { message: 'JWT non valido' } };
  const S = await finto({
    'GET /application': (p, c, { intestazioni }) => (accesso(intestazioni) ? { name: 'Kubo prova' } : no),
    'GET /aspsps': (p, c, { intestazioni, q }) => (accesso(intestazioni) ? { aspsps: [{ name: 'Banca Finta', country: q.get('country'), bic: 'FINTITMM', psu_types: ['business'], maximum_consent_validity: 15552000 }] } : no),
    'POST /auth': (p, c, { intestazioni }) => (accesso(intestazioni) ? { url: `https://banca.example/consenso?state=${c.state}`, authorization_id: 'au-1' } : no),
    'POST /sessions': (p, c, { intestazioni }) => { if (!accesso(intestazioni) || c.code !== 'cod-1') return no; sessioni++;
      return { session_id: 'ses-1', accounts: [{ uid: 'conto-1', account_id: { iban: 'IT02L1234512345123456789012' }, name: 'Conto aziendale' }], aspsp: { name: 'Banca Finta', country: 'IT' }, access: { valid_until: new Date(Date.now() + 90 * 864e5).toISOString() } }; },
    'GET /accounts/:uid/transactions': (p, c, { intestazioni, q }) => {
      if (!accesso(intestazioni) || p.uid !== 'conto-1' || !q.get('date_from')) return no;
      if (!q.get('continuation_key')) return { transactions: [
        { entry_reference: 'e1', transaction_amount: { amount: '122.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-09-20', value_date: '2026-09-20', remittance_information: [`Saldo fattura n. ${f.numero}`], debtor: { name: 'Verdi Arredi srl' } },
        { entry_reference: 'e2', transaction_amount: { amount: '45.10', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-09-21', remittance_information: ['Bolletta luce'], creditor: { name: 'Energia spa' } },
      ], continuation_key: 'pag-2' };
      return { transactions: [
        { entry_reference: 'e3', transaction_amount: { amount: '122.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'PDNG', booking_date: '2026-09-22', remittance_information: ['In arrivo'] },
        { transaction_id: 't4', transaction_amount: { amount: '9.99', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-09-23', remittance_information: ['Rimborso'] },
      ] };
    },
  });
  try {
    f = await fattura(K);
    await accendi(K, 'enable-banking', { base: S.url, segreti: { chiave_privata: PEM }, impostazioni: { applicazione: 'app-prova', banca: 'Banca Finta', paese: 'IT' } });
    assert.equal((await K.chiama('POST', '/api/connettori/enable-banking/prova')).json.ok, true);
    assert.equal((await K.chiama('POST', '/api/connettori/enable-banking/azioni/banche', { args: {} })).json.banche[0].giorni, 180);
    // il giro prima del collegamento non chiama la banca
    assert.equal((await K.chiama('POST', '/api/connettori/enable-banking/giri/movimenti')).json.risultato, 'conto non collegato');
    assert.equal((await K.chiama('POST', '/api/connettori/enable-banking/azioni/collega', { args: { indirizzo: 'javascript:x' } })).stato, 502);
    const c = await K.chiama('POST', '/api/connettori/enable-banking/azioni/collega', { args: { indirizzo: K.base } });
    assert.equal(c.stato, 200, JSON.stringify(c.json)); assert.match(c.json.url, /^https:\/\/banca\.example\/consenso/);
    const auth = S.chiamate.find(x => x.percorso === '/auth').corpo;
    assert.equal(auth.redirect_url, `${K.base}/api/connettori/enable-banking/pub/ritorno`); assert.deepEqual(auth.aspsp, { name: 'Banca Finta', country: 'IT' }); assert.equal(auth.psu_type, 'business');
    assert.ok(Date.parse(auth.access.valid_until) > Date.now() + 170 * 864e5);
    // lo state sbagliato non apre la sessione; quello giusto sì, una volta sola
    const ritorno = q => fetch(`${K.base}/api/connettori/enable-banking/pub/ritorno?${q}`).then(async r => ({ stato: r.status, testo: await r.text() }));
    assert.match((await ritorno('code=cod-1&state=sbagliato')).testo, /scaduto/); assert.equal(sessioni, 0);
    const ok = await ritorno(`code=cod-1&state=${encodeURIComponent(auth.state)}`); assert.equal(ok.stato, 200); assert.match(ok.testo, /Conto collegato/); assert.equal(sessioni, 1);
    assert.match((await ritorno(`code=cod-1&state=${encodeURIComponent(auth.state)}`)).testo, /scaduto/); assert.equal(sessioni, 1);
    // i movimenti: due pagine, il PDNG resta fuori; l'entrata da 122 € con il numero nella causale diventa una proposta
    const g = await K.chiama('POST', '/api/connettori/enable-banking/giri/movimenti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { nuovi: 3, proposte: 1 });
    assert.equal(S.chiamate.filter(x => x.percorso === '/accounts/conto-1/transactions').length, 2);
    assert.equal(S.chiamate.filter(x => x.percorso === '/accounts/conto-1/transactions')[1].q.continuation_key, 'pag-2');
    await riconcilia(K, 'enable-banking', f, '2026-09-20');
    // un secondo giro non porta doppioni
    assert.deepEqual((await K.chiama('POST', '/api/connettori/enable-banking/giri/movimenti')).json.risultato, { nuovi: 0, proposte: 0 });
    // il consenso sta per scadere: avviso nel registro; scaduto: niente chiamate
    const k = K.nucleo.k('enable-banking'), s = k.stato.leggi('sessione');
    k.stato.scrivi('sessione', { ...s, scade: new Date(Date.now() + 3 * 864e5).toISOString() });
    await K.chiama('POST', '/api/connettori/enable-banking/giri/movimenti');
    assert.ok((await K.chiama('GET', '/api/connettori/enable-banking')).json.registro.some(r => /consenso della banca scade fra 3 giorni/.test(r.titolo + r.dettagli)));
    k.stato.scrivi('sessione', { ...s, scade: new Date(Date.now() - 1000).toISOString() }); const prima = S.chiamate.length;
    assert.equal((await K.chiama('POST', '/api/connettori/enable-banking/giri/movimenti')).json.risultato, 'consenso scaduto'); assert.equal(S.chiamate.length, prima);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Qonto: chiave «login:segreto», conti attivi, movimenti a pagine dal giorno giusto → proposta → fattura pagata', async () => {
  const K = await kubo(['fatture']); let f = null;
  const no = { stato: 401, corpo: { errors: [{ detail: 'chiave non valida' }] } }, ok = h => h.authorization === 'bottega-1234:sk-prova-qonto';
  const S = await finto({
    'GET /v2/organization': (p, c, { intestazioni }) => (ok(intestazioni) ? { organization: { slug: 'bottega-1234', bank_accounts: [
      { id: 'ba-1', slug: 'bottega-1234-bank-account-1', iban: 'FR7616798000010000000000001', status: 'active', name: 'Principale', balance: 1000, currency: 'EUR' },
      { id: 'ba-2', slug: 'bottega-1234-bank-account-2', iban: 'FR7616798000010000000000002', status: 'closed' }] } } : no),
    'GET /v2/transactions': (p, c, { intestazioni, q }) => {
      if (!ok(intestazioni) || q.get('bank_account_id') !== 'ba-1' || q.get('status[]') !== 'completed' || !q.get('settled_at_from')) return no;
      if (q.get('page') === '1') return { transactions: [
        { id: 'uuid-1', transaction_id: 'bottega-1234-t-1', amount: 122, amount_cents: 12200, side: 'credit', settled_at: '2026-09-25T09:12:00.000Z', label: 'Verdi Arredi srl', reference: `Fattura ${f.numero} del 01/09/2026`, status: 'completed', currency: 'EUR' },
      ], meta: { current_page: 1, next_page: 2, total_pages: 2 } };
      return { transactions: [
        { id: 'uuid-2', transaction_id: 'bottega-1234-t-2', amount: 18.3, side: 'debit', settled_at: '2026-09-26T10:00:00.000Z', label: 'Cartoleria', reference: 'Carta', status: 'completed', currency: 'EUR' },
      ], meta: { current_page: 2, next_page: null, total_pages: 2 } };
    },
  });
  try {
    f = await fattura(K);
    await accendi(K, 'qonto', { base: S.url, segreti: { chiave: 'sk-prova-qonto' }, impostazioni: { login: 'bottega-1234' } });
    assert.equal((await K.chiama('POST', '/api/connettori/qonto/prova')).json.ok, true);
    assert.equal(S.chiamate[0].intestazioni.authorization, 'bottega-1234:sk-prova-qonto');   // niente Basic, niente Bearer
    assert.deepEqual((await K.chiama('POST', '/api/connettori/qonto/azioni/conti', { args: {} })).json.conti.map(c => c.nome), ['Principale']);
    const g = await K.chiama('POST', '/api/connettori/qonto/giri/movimenti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { nuovi: 2, proposte: 1 });
    const tr = S.chiamate.filter(x => x.percorso === '/v2/transactions'); assert.equal(tr.length, 2); assert.deepEqual(tr.map(x => x.q.page), ['1', '2']);
    assert.ok(Date.parse(tr[0].q.settled_at_from) < Date.now() - 29 * 864e5);
    await riconcilia(K, 'qonto', f, '2026-09-25');
    // il giro dopo riparte da pochi giorni fa e non porta doppioni
    assert.deepEqual((await K.chiama('POST', '/api/connettori/qonto/giri/movimenti')).json.risultato, { nuovi: 0, proposte: 0 });
    assert.ok(Date.parse(S.chiamate.filter(x => x.percorso === '/v2/transactions').at(-1).q.settled_at_from) > Date.now() - 4 * 864e5);
    // la chiave sbagliata: il giro finisce in errore con il messaggio di Qonto
    await accendi(K, 'qonto', { segreti: { chiave: 'sbagliata' } });
    const e = (await K.chiama('POST', '/api/connettori/qonto/giri/movimenti')).json; assert.equal(e.esito, 'errore'); assert.match(e.risultato, /401.*chiave non valida/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Revolut Business: consenso, codice → token con client_assertion JWT, rinnovo, movimenti a pagine → proposta → fattura pagata', async () => {
  const K = await kubo(['fatture']); let f = null; const token = [];
  const asserzione = c => { const j = c?.client_assertion_type === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' && jwtValido(c.client_assertion);
    return j && j.testa.alg === 'RS256' && j.corpo.iss === '127.0.0.1' && j.corpo.sub === 'cli-prova' && j.corpo.aud === 'https://revolut.com' && j.corpo.exp > Date.now() / 1000; };
  const no = { stato: 401, corpo: { message: 'non autorizzato' } }, ok = h => /^Bearer acc-[12]$/.test(h.authorization || '');
  const riempi = Array.from({ length: 999 }, (_, i) => ({ id: `rifiutato-${i}`, type: 'card_payment', state: 'declined', created_at: '2026-09-27T10:00:00.000Z', legs: [{ leg_id: 'l', amount: -1, currency: 'EUR' }] }));
  const S = await finto({
    'POST /auth/token': (p, c) => {
      if (!asserzione(c)) return { stato: 401, corpo: { error: 'invalid_client', error_description: 'asserzione non valida' } };
      token.push(c.grant_type);
      if (c.grant_type === 'authorization_code' && c.code === 'oa_sand_1') return { access_token: 'acc-1', token_type: 'bearer', expires_in: 30, refresh_token: 'ref-1' };   // quasi scaduto: il primo uso lo rinnova
      if (c.grant_type === 'refresh_token' && c.refresh_token === 'ref-1') return { access_token: 'acc-2', token_type: 'bearer', expires_in: 2399 };
      return { stato: 400, corpo: { error: 'invalid_grant' } };
    },
    'GET /accounts': (p, c, { intestazioni }) => (ok(intestazioni) ? [{ id: 'acc-eur', name: 'Principale', balance: 500, currency: 'EUR', state: 'active' }] : no),
    'GET /transactions': (p, c, { intestazioni, q }) => {
      if (!ok(intestazioni) || !q.get('from') || q.get('count') !== '1000') return no;
      if (!q.get('to')) return [
        { id: 'tx-1', type: 'transfer', state: 'completed', created_at: '2026-09-28T08:00:00.000Z', completed_at: '2026-09-28T08:00:05.000Z', reference: `Pagamento fatt. ${f.numero}`,
          legs: [{ leg_id: 'g-1', account_id: 'acc-eur', amount: 122, currency: 'EUR', description: 'Payment from Verdi Arredi srl' }] },
        ...riempi];
      if (q.get('to') !== '2026-09-27T10:00:00.000Z') return no;
      return [{ id: 'tx-2', type: 'card_payment', state: 'completed', created_at: '2026-09-26T12:00:00.000Z', completed_at: '2026-09-26T12:00:00.000Z', merchant: { name: 'Benzinaio' },
        legs: [{ leg_id: 'g-2', account_id: 'acc-eur', amount: -60.5, currency: 'EUR', description: 'Benzinaio' }] }];
    },
  });
  try {
    f = await fattura(K);
    await accendi(K, 'revolut-business', { base: S.url, segreti: { chiave_privata: PEM }, impostazioni: { client_id: 'cli-prova', ambiente: 'sandbox' } });
    assert.equal((await K.chiama('POST', '/api/connettori/revolut-business/giri/movimenti')).json.risultato, 'conto non collegato');
    const c = await K.chiama('POST', '/api/connettori/revolut-business/azioni/collega', { args: { indirizzo: K.base } });
    assert.equal(c.stato, 200, JSON.stringify(c.json));
    const u = new URL(c.json.url); assert.equal(u.origin + u.pathname, 'https://sandbox-business.revolut.com/app-confirm');
    assert.equal(u.searchParams.get('client_id'), 'cli-prova'); assert.equal(u.searchParams.get('redirect_uri'), `${K.base}/api/connettori/revolut-business/pub/ritorno`); assert.equal(u.searchParams.get('response_type'), 'code');
    const ritorno = q => fetch(`${K.base}/api/connettori/revolut-business/pub/ritorno?${q}`).then(r => r.text());
    assert.match(await ritorno('code=oa_sand_1&state=altro'), /scaduto/); assert.equal(token.length, 0);
    assert.match(await ritorno(`code=oa_sand_1&state=${u.searchParams.get('state')}`), /Conto collegato/); assert.deepEqual(token, ['authorization_code']);
    // il codice di rinnovo è un segreto: salvato (cifrato), mai nella pagina
    const pag = (await K.chiama('GET', '/api/connettori/revolut-business')).json;
    assert.equal(pag.impostazioni.find(i => i.id === 'rinnovo').salvato, true); assert.ok(!JSON.stringify(pag).includes('ref-1'));
    assert.ok(!JSON.stringify(K.db.prepare('SELECT * FROM _connettori_segreti').all()).includes('ref-1'));
    // il token del consenso dura meno di un minuto: si rinnova con il refresh_token e una nuova asserzione, poi resta in memoria
    assert.deepEqual((await K.chiama('POST', '/api/connettori/revolut-business/azioni/conti', { args: {} })).json.conti.map(x => x.nome), ['Principale']);
    assert.deepEqual(token, ['authorization_code', 'refresh_token']); assert.equal(S.chiamate.at(-1).intestazioni.authorization, 'Bearer acc-2');
    const g = await K.chiama('POST', '/api/connettori/revolut-business/giri/movimenti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { nuovi: 2, proposte: 1 });
    assert.equal(S.chiamate.filter(x => x.percorso === '/transactions').length, 2);
    await riconcilia(K, 'revolut-business', f, '2026-09-28');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/revolut-business/giri/movimenti')).json.risultato, { nuovi: 0, proposte: 0 });
    assert.deepEqual(token, ['authorization_code', 'refresh_token']);
    // un rinnovo rifiutato: avviso di ricollegare
    K.nucleo.k('revolut-business').salvaSegreto('rinnovo', 'ref-scaduto');
    assert.equal((await K.chiama('POST', '/api/connettori/revolut-business/giri/movimenti')).json.esito, 'errore');
    assert.ok((await K.chiama('GET', '/api/connettori/revolut-business')).json.registro.some(r => /ricollega il conto/.test(r.titolo + r.dettagli)));
    assert.deepEqual(token, ['authorization_code', 'refresh_token', 'refresh_token']);
  } finally { await K.chiudi(); await S.chiudi(); }
});
