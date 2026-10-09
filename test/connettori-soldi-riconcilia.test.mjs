// I movimenti dei connettori bancari (connettori/_soldi/banca.js) attraverso Qonto: entrano in «Movimenti di banca» della
// tesoreria con id_esterno (niente doppioni), e l'abbinamento lo fa la tesoreria, l'unico motore: il numero nella causale
// distingue due fatture con lo stesso importo, un'uscita paga una fattura ricevuta. Senza la sezione il giro si ferma e lo dice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, gestionale, accendi } from './connettori-finto.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };

test('banca → tesoreria: movimenti in «Movimenti di banca» senza doppioni, abbinamento della tesoreria', async () => {
  const K = await gestionale(['fatture']); let movimenti = [];
  const S = await finto({
    'GET /v2/organization': () => ({ organization: { bank_accounts: [{ id: 'conto-1', slug: 'bottega-1', iban: 'IT00X0000000000000000000001', status: 'active' }] } }),
    'GET /v2/transactions': () => ({ transactions: movimenti, meta: { next_page: null } }),
  });
  try {
    assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
    await K.chiama('POST', '/api/documenti/prepara');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234' })).json;
    const nuova = async () => { const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
      return (await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' })).json; };
    const f1 = await nuova(), f2 = await nuova();
    const forn = (await K.chiama('POST', '/api/dati/fornitori', { nome: 'Carta & Co srl', piva: '07654321095' })).json;
    const ric = (await K.chiama('POST', '/api/dati/fatture_ricevute', { fornitore: forn.id, numero: 'C-55', data: '2026-09-10', imponibile: 50, imposta: 11, totale: 61 })).json;
    assert.ok(ric.id, JSON.stringify(ric));
    movimenti = [
      { id: 't1', amount: 122, side: 'credit', settled_at: '2026-09-20T10:00:00Z', label: 'ROSSI SRL', reference: `Saldo fattura n. ${f2.numero} del 01/09`, status: 'completed', currency: 'EUR' },
      { id: 't2', amount: 122, side: 'credit', settled_at: '2026-09-21T10:00:00Z', label: 'ROSSI SRL', reference: 'Bonifico', status: 'completed', currency: 'EUR' },
      { id: 't3', amount: 61, side: 'debit', settled_at: '2026-09-22T10:00:00Z', label: 'Carta & Co srl', reference: 'Pagamento fattura C-55', status: 'completed', currency: 'EUR' },
      { id: 't4', amount: 1122, side: 'credit', settled_at: '2026-09-23T10:00:00Z', label: 'Altro', reference: `fattura ${f1.numero}`, status: 'completed', currency: 'EUR' },
    ];
    await accendi(K, 'qonto', { base: S.url, segreti: { chiave: 'segreto' }, impostazioni: { login: 'bottega-1234' } });
    // senza la sezione della tesoreria il giro si ferma (e il cursore non avanza: i movimenti arriveranno dopo)
    const no = await K.chiama('POST', '/api/connettori/qonto/giri/movimenti');
    assert.equal(no.json.esito, 'errore'); assert.match(no.json.risultato, /Movimenti di banca/);
    assert.equal((await K.chiama('POST', '/api/tesoreria/prepara')).stato, 200);
    const g = await K.chiama('POST', '/api/connettori/qonto/giri/movimenti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.equal(g.json.risultato.nuovi, 4);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/qonto/giri/movimenti')).json.risultato, { nuovi: 0, proposte: 0 });   // niente doppioni
    const l = (await K.chiama('GET', '/api/dati/movimenti_banca?perPagina=50')).json.righe;
    assert.equal(l.length, 4); assert.deepEqual(l.map(x => x.id_esterno).sort(), ['t1', 't2', 't3', 't4']);
    assert.ok(l.every(x => x.fonte === 'openbanking' && x.conto === 'IT00X0000000000000000000001'));
    assert.equal(l.find(x => x.id_esterno === 't3').importo, -61);
    // le proposte sono quelle della tesoreria: t1 → f2 (numero nella causale) prima di f1, t3 → la fattura ricevuta
    const b = (await K.chiama('GET', '/api/tesoreria/banca')).json, m = id => b.daAbbinare.find(x => x.id === l.find(y => y.id_esterno === id).id);
    assert.equal(b.daAbbinare.length, 4);
    assert.equal(m('t1').proposte[0].chiavi[0], `f:${f2.id}:1`, JSON.stringify(m('t1').proposte));
    assert.equal(m('t3').proposte[0].chiavi[0], `p:${ric.id}:1`, JSON.stringify(m('t3').proposte));
    for (const id of ['t1', 't3']) assert.equal((await K.chiama('POST', '/api/tesoreria/abbina', { movimento: m(id).id, chiavi: m(id).proposte[0].chiavi })).stato, 200);
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f2.id}`)).json.stato, 'pagata');
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f1.id}`)).json.stato, 'emessa');
    const r = (await K.chiama('GET', `/api/dati/fatture_ricevute/${ric.id}`)).json; assert.equal(r.stato, 'pagata'); assert.equal(r.pagata_il, '2026-09-22');
    // il connettore non ha più azioni sue per abbinare: un solo strumento di Lumi (tesoreria_abbina_movimento)
    assert.equal((await K.chiama('POST', '/api/connettori/qonto/azioni/riconcilia', { args: { movimento: 't1' } })).stato, 404);
    const lumi = (await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.map(x => x.nome);
    assert.ok(lumi.includes('tesoreria_abbina_movimento')); assert.ok(!lumi.some(x => /^connettore_qonto_(riconcilia|proposte)/.test(x)));
  } finally { await K.chiudi(); await S.chiudi(); }
});
