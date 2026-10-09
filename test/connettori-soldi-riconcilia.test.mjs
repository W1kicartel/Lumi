// La riconciliazione comune (connettori/_soldi/banca.js) attraverso Qonto: due fatture con lo stesso importo si
// distinguono col numero nella causale; senza numero il dubbio non diventa una proposta; un'uscita paga una fattura
// ricevuta; la sezione «Movimenti», se l'azienda la crea, riceve i movimenti e la fattura abbinata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };

test('riconciliazione: numero nella causale, importi ambigui, fattura ricevuta, sezione Movimenti', async () => {
  const K = await kubo(['fatture']); let movimenti = [];
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
    // la sezione facoltativa «Movimenti», creata dall'azienda
    const sez = await K.chiama('PUT', '/api/schema/movimenti', { id: 'movimenti', nome: 'Movimenti', campi: [{ id: 'data', nome: 'Data', tipo: 'data' }, { id: 'importo', nome: 'Importo', tipo: 'valuta' },
      { id: 'descrizione', nome: 'Descrizione', tipo: 'testo' }, { id: 'controparte', nome: 'Controparte', tipo: 'testo' }, { id: 'conto', nome: 'Conto', tipo: 'testo' }, { id: 'fattura', nome: 'Fattura', tipo: 'relazione', entita: 'fatture' }] });
    assert.equal(sez.stato, 200, JSON.stringify(sez.json));
    movimenti = [
      { id: 't1', amount: 122, side: 'credit', settled_at: '2026-09-20T10:00:00Z', label: 'ROSSI SRL', reference: `Saldo fattura n. ${f2.numero} del 01/09`, status: 'completed', currency: 'EUR' },
      { id: 't2', amount: 122, side: 'credit', settled_at: '2026-09-21T10:00:00Z', label: 'ROSSI SRL', reference: 'Bonifico', status: 'completed', currency: 'EUR' },
      { id: 't3', amount: 61, side: 'debit', settled_at: '2026-09-22T10:00:00Z', label: 'Carta & Co srl', reference: 'Pagamento fattura C-55', status: 'completed', currency: 'EUR' },
      { id: 't4', amount: 1122, side: 'credit', settled_at: '2026-09-23T10:00:00Z', label: 'Altro', reference: `fattura ${f1.numero}`, status: 'completed', currency: 'EUR' },
    ];
    await accendi(K, 'qonto', { base: S.url, segreti: { chiave: 'segreto' }, impostazioni: { login: 'bottega-1234' } });
    const g = await K.chiama('POST', '/api/connettori/qonto/giri/movimenti');
    assert.equal(g.json.esito, 'ok', JSON.stringify(g.json)); assert.deepEqual(g.json.risultato, { nuovi: 4, proposte: 2 });
    const pr = (await K.chiama('POST', '/api/connettori/qonto/azioni/proposte', { args: {} })).json.proposte;
    assert.deepEqual(pr.map(p => [p.movimento, p.fattura, p.sezione]), [['t1', f2.id, 'fatture'], ['t3', ric.id, 'fatture_ricevute']]);
    for (const m of ['t1', 't3']) assert.equal((await K.chiama('POST', '/api/connettori/qonto/azioni/riconcilia', { args: { movimento: m } })).stato, 200);
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f2.id}`)).json.stato, 'pagata');
    assert.equal((await K.chiama('GET', `/api/dati/fatture/${f1.id}`)).json.stato, 'emessa');   // t2 senza numero e t4 con l'importo sbagliato: nessuna proposta
    const r = (await K.chiama('GET', `/api/dati/fatture_ricevute/${ric.id}`)).json; assert.equal(r.stato, 'pagata'); assert.equal(r.pagata_il, '2026-09-22');
    assert.equal((await K.chiama('POST', '/api/connettori/qonto/azioni/riconcilia', { args: { movimento: 't1' } })).stato, 502);   // già applicata
    const righe = (await K.chiama('GET', '/api/dati/movimenti')).json, l = righe.righe || righe;
    assert.equal(l.length, 4); assert.equal(l.find(x => x.descrizione?.includes('Saldo'))?.fattura?.id, f2.id);
    assert.equal(l.find(x => x.descrizione?.includes('C-55'))?.importo, -61);
  } finally { await K.chiudi(); await S.chiudi(); }
});
