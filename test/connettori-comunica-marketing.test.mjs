// I connettori di produttività, marketing e recensioni contro finti servizi locali: niente rete vera, dati inventati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';

const pausa = ms => new Promise(r => setTimeout(r, ms));
const oauthFinto = (K, id) => K.nucleo.k(id).salvaSegreto('_oauth', JSON.stringify({ access_token: 'tok', refresh_token: 'r', scade: Date.now() + 36e5 }));

test('Fogli Google: la sezione scelta nella scheda (intestazioni = nomi dei campi), la scheda mancante si crea, giro e azione', async () => {
  const K = await kubo(['studio']); const schede = new Set(); let scritto = null;
  const S = await finto({
    'GET /v4/spreadsheets/:id': p => ({ properties: { title: 'Clienti Bottega' } }),
    'POST /v4/spreadsheets/:id/values/:range': p => (schede.has(decodeURIComponent(p.range).replace(/:clear$/, '')) ? {} : { stato: 400, corpo: { error: { message: 'Unable to parse range' } } }),
    'POST /v4/spreadsheets/:id': (p, c) => { schede.add(`'${c.requests[0].addSheet.properties.title}'`); return { replies: [{}] }; },
    'PUT /v4/spreadsheets/:id/values/:range': (p, c) => { scritto = c; return { updatedCells: c.values.flat().length }; },
  });
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it', consenso: true });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Verdi', telefono: '+39 333 0000000' });
    await accendi(K, 'google-sheets', { base: S.url, segreti: { client_id: 'gid', client_secret: 'gsec' }, impostazioni: { sezione: 'clienti', foglio: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' } });
    oauthFinto(K, 'google-sheets');
    assert.equal((await K.chiama('POST', '/api/connettori/google-sheets/prova')).json.messaggio, 'Clienti Bottega');
    const ant = (await K.chiama('POST', '/api/connettori/google-sheets/azioni/esporta_ora', { anteprima: true })).json;
    assert.deepEqual(ant.righe.find(r => r[0] === 'Righe'), ['Righe', '2']);
    const g = (await K.chiama('POST', '/api/connettori/google-sheets/giri/esporta')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.equal(g.risultato.righe, 2); assert.equal(g.risultato.scheda, 'Clienti');
    assert.deepEqual(scritto.values[0], ['Nome', 'Telefono', 'Email', 'Data di nascita', 'Consenso al trattamento', 'Note']);
    assert.ok(scritto.values.some(r => r[0] === 'Anna Bianchi' && r[2] === 'anna@esempio.it' && r[4] === true));
    const put = S.chiamate.find(c => c.metodo === 'PUT');
    assert.equal(put.q.valueInputOption, 'RAW'); assert.equal(put.intestazioni.authorization, 'Bearer tok');
    assert.ok(S.chiamate.some(c => c.percorso.endsWith(':batchUpdate') || c.corpo?.requests));   // la scheda «Clienti» non c'era: creata
    const a = (await K.chiama('POST', '/api/connettori/google-sheets/azioni/esporta_ora', {})).json;   // la seconda volta la scheda c'è
    assert.equal(a.righe, 2); assert.equal(S.chiamate.filter(c => c.corpo?.requests).length, 1);
  } finally { await K.chiudi(); await S.chiudi(); }
});
