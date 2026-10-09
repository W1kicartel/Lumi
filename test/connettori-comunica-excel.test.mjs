// Excel per il web (Microsoft Graph, API workbook): il foglio si crea se manca, si svuota (usedRange → clear) e si
// riscrive dalla cella A1, con le colonne in lettere giuste. Solo un finto Graph locale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import { colonna } from '../connettori/excel-online/connettore.js';

test('Excel: lettere delle colonne', () => {
  assert.deepEqual([1, 26, 27, 52, 702, 703].map(colonna), ['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
});

test('Excel: crea il foglio, scrive intestazioni e righe, al giro dopo svuota l\'area usata e riscrive', async () => {
  const K = await kubo(['negozio']), fogli = {};
  const nome = p => decodeURIComponent(/worksheets\('([^']*)'\)/.exec(p)?.[1] || '');
  // il finto registra la chiamata prima di rispondere: S.chiamate.at(-1) dice di quale foglio si parla
  const S = await finto({
    'GET /v1.0/me/drive/root:/Kubo/Kubo.xlsx:/workbook/worksheets.*/usedRange': () => { const f = fogli[nome(S.chiamate.at(-1).percorso)]; return f ? { address: `'${f.nome}'!${f.area}` } : { stato: 404, corpo: { error: { code: 'ItemNotFound', message: 'The requested resource doesn\'t exist.' } } }; },
    'POST /v1.0/me/drive/root:/Kubo/Kubo.xlsx:/workbook/worksheets/add': (p, c) => { fogli[c.name] = { nome: c.name, area: 'A1' }; return { name: c.name }; },
    'POST /v1.0/me/drive/root:/Kubo/Kubo.xlsx:/workbook/worksheets.*/clear': () => ({ stato: 204, corpo: '' }),
    'PATCH /v1.0/me/drive/root:/Kubo/Kubo.xlsx:/workbook/worksheets.*': (p, c) => ({ address: 'ok', values: c.values }),
    'GET /v1.0/me/drive/root:/Kubo/Kubo.xlsx': () => ({ name: 'Kubo.xlsx', webUrl: 'https://onedrive.example/Kubo.xlsx' }),
  });
  try {
    await accendi(K, 'excel-online', { base: S.url, segreti: { client_id: 'app-1234' }, impostazioni: { sezione: 'clienti', tenant: 'consumers' } });
    K.nucleo.k('excel-online').salvaSegreto('_oauth', JSON.stringify({ access_token: 'tok-ms', refresh_token: 'r', scade: Date.now() + 36e5 }));
    assert.deepEqual((await K.chiama('POST', '/api/connettori/excel-online/prova')).json, { ok: true, messaggio: 'Kubo.xlsx' });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', telefono: '3331234567' });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Marco Verdi', email: 'marco@esempio.it' });
    const ant = (await K.chiama('POST', '/api/connettori/excel-online/azioni/esporta_ora', { args: {}, anteprima: true })).json;
    assert.deepEqual(ant.righe.slice(2), [['Foglio', 'Clienti'], ['Righe', '2']]);
    const r = await K.chiama('POST', '/api/connettori/excel-online/azioni/esporta_ora', { args: {} });
    assert.deepEqual(r.json, { scheda: 'Clienti', righe: 2 }, JSON.stringify(r.json));
    const scrivi = S.chiamate.filter(c => c.metodo === 'PATCH'), w = scrivi.at(-1);
    assert.match(decodeURIComponent(w.percorso), /worksheets\('Clienti'\)\/range\(address='A1:[A-Z]+3'\)$/);
    assert.equal(w.corpo.values[0][0], 'Nome'); assert.deepEqual(w.corpo.values.slice(1).map(x => x[0]), ['Anna Bianchi', 'Marco Verdi']);
    assert.ok(w.corpo.values.every(x => x.length === w.corpo.values[0].length && x.every(v => ['string', 'number', 'boolean'].includes(typeof v))));
    assert.equal(w.intestazioni.authorization, 'Bearer tok-ms');
    // il giro dopo: il foglio c'è, l'area usata si svuota prima di riscrivere
    fogli.Clienti.area = 'A1:H3';
    assert.equal((await K.chiama('POST', '/api/connettori/excel-online/giri/esporta')).json.esito, 'ok');
    const pul = S.chiamate.filter(c => /\/clear$/.test(c.percorso)).at(-1);
    assert.match(decodeURIComponent(pul.percorso), /range\(address='A1:H3'\)\/clear$/); assert.deepEqual(pul.corpo, { applyTo: 'Contents' });
  } finally { await K.chiudi(); await S.chiudi(); }
});
