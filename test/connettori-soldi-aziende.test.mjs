// VIES e Openapi imprese contro finti servizi: controllo della partita IVA, «compila» che riempie solo i campi vuoti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import { pivaValida, divisa } from '../connettori/_soldi/aziende.js';

test('partita IVA: cifra di controllo e prefisso del Paese', () => {
  assert.equal(pivaValida('01234567897'), true); assert.equal(pivaValida('01234567890'), false); assert.equal(pivaValida('00000000000'), false);
  assert.deepEqual(divisa('it 012.345.678-97'), { paese: 'IT', numero: '01234567897' }); assert.deepEqual(divisa('GR123456789'), { paese: 'EL', numero: '123456789' });
});

test('VIES: controlla (anche la cifra di controllo, senza chiamare), compila il cliente solo nei campi vuoti, servizio del Paese giù', async () => {
  const K = await kubo(['fatture']); let giu = false, chiamate = 0;
  const S = await finto({
    'GET /rest-api/check-status': () => ({ vow: { available: true } }),
    'GET /rest-api/ms/:paese/vat/:numero': p => { chiamate++; if (giu) return { isValid: false, userError: 'MS_UNAVAILABLE' };
      return p.numero === '01234567897' ? { isValid: true, userError: 'VALID', name: 'BOTTEGA ESEMPIO SRL', address: 'VIA DEI MILLE 12 \n20121 MILANO MI\n', requestDate: '2026-10-09' } : { isValid: false, userError: 'INVALID', name: '---', address: '---' }; },
  });
  try {
    await accendi(K, 'vies', { base: S.url });
    assert.equal((await K.chiama('POST', '/api/connettori/vies/prova')).json.ok, true);
    const c1 = await K.chiama('POST', '/api/connettori/vies/azioni/controlla', { args: { piva: '01234567890' } });
    assert.equal(c1.json.valida, false); assert.equal(chiamate, 0);   // cifra di controllo sbagliata: non si chiama nemmeno il VIES
    const c2 = await K.chiama('POST', '/api/connettori/vies/azioni/controlla', { args: { piva: 'IT 01234567897' } });
    assert.equal(c2.json.valida, true); assert.equal(c2.json.nome, 'BOTTEGA ESEMPIO SRL'); assert.equal(c2.json.comune, 'MILANO');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Bottega', tipo: 'azienda', piva: '01234567897', comune: 'Monza' })).json;
    assert.ok(cl.id, JSON.stringify(cl));
    const ant = await K.chiama('POST', '/api/connettori/vies/azioni/compila_cliente', { args: { cliente: cl.id }, anteprima: true });
    assert.equal(ant.stato, 200, JSON.stringify(ant.json)); assert.deepEqual(Object.fromEntries(ant.json.righe), { Via: 'VIA DEI MILLE 12', CAP: '20121', Provincia: 'MI' });
    const r = await K.chiama('POST', '/api/connettori/vies/azioni/compila_cliente', { args: { cliente: cl.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    const dopo = (await K.chiama('GET', `/api/dati/clienti/${cl.id}`)).json;
    assert.equal(dopo.nome, 'Bottega'); assert.equal(dopo.comune, 'Monza'); assert.equal(dopo.via, 'VIA DEI MILLE 12'); assert.equal(dopo.cap, '20121');   // il nome e il comune scritti a mano restano
    giu = true;
    const e = await K.chiama('POST', '/api/connettori/vies/azioni/controlla', { args: { piva: '01234567897' } });
    assert.equal(e.stato, 502); assert.match(JSON.stringify(e.json), /MS_UNAVAILABLE/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Openapi imprese: IT-advanced con il token → PEC, codice destinatario e sede nel fornitore', async () => {
  const K = await kubo(['fatture']);
  const S = await finto({
    'GET /IT-advanced/:piva': (p, c, { intestazioni }) => {
      if (intestazioni.authorization !== 'Bearer tok-imprese') return { stato: 401, corpo: { message: 'no' } };
      if (p.piva !== '07654321095') return { stato: 404, corpo: { data: [], success: false } };
      return { data: [{ companyName: 'FORNITURE ESEMPIO SPA', vatCode: '07654321095', taxCode: '07654321095', activityStatus: 'ATTIVA', pec: 'forniture@pec.esempio.it', sdiCode: 'ABC1234',
        address: { registeredOffice: { streetName: 'VIALE DELLE PROVE 3', town: 'TORINO', province: 'TO', zipCode: '10121' } } }], success: true };
    },
  });
  try {
    await accendi(K, 'openapi-imprese', { base: S.url, segreti: { token: 'tok-imprese' } });
    const f = (await K.chiama('POST', '/api/dati/fornitori', { nome: 'Forniture', piva: '07654321095' })).json;
    const r = await K.chiama('POST', '/api/connettori/openapi-imprese/azioni/compila_fornitore', { args: { fornitore: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    const dopo = (await K.chiama('GET', `/api/dati/fornitori/${f.id}`)).json;
    assert.equal(dopo.pec, 'forniture@pec.esempio.it'); assert.equal(dopo.comune, 'TORINO'); assert.equal(dopo.codice_fiscale, '07654321095'); assert.equal(dopo.nome, 'Forniture');
    const n = await K.chiama('POST', '/api/connettori/openapi-imprese/azioni/controlla', { args: { piva: '01234567897' } });
    assert.equal(n.json.valida, false);
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Cliente', tipo: 'azienda', piva: '07654321095' })).json;
    await K.chiama('POST', '/api/connettori/openapi-imprese/azioni/compila_cliente', { args: { cliente: cl.id } });
    assert.equal((await K.chiama('GET', `/api/dati/clienti/${cl.id}`)).json.codice_destinatario, 'ABC1234');
  } finally { await K.chiudi(); await S.chiudi(); }
});
