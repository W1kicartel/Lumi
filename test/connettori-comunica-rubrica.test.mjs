// I clienti nella rubrica del telefono: CardDAV (iCloud, Nextcloud: la rubrica si trova da sola, vCard 3.0) e
// Google Contatti (People API: crea, aggiorna con l'etag, rilegge se il contatto è cambiato sul telefono).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import { vcard } from '../connettori/_comunica/rubrica.js';
import { coda } from './connettori-comunica-coda.mjs';

const xml = corpo => ({ stato: 207, intestazioni: { 'Content-Type': 'application/xml; charset=utf-8' }, corpo: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">${corpo}</d:multistatus>` });

test('vCard 3.0: nome, cellulare internazionale, email, caratteri speciali', () => {
  assert.equal(vcard({ id: 'X1', nome: 'Rossi, Anna; srl', n: 'Rossi,', cg: 'Anna; srl', tel: '+393331234567', email: 'a@b.it', azienda: 'Clienti Kubo' }),
    'BEGIN:VCARD\r\nVERSION:3.0\r\nPRODID:-//Kubo//Rubrica//IT\r\nUID:kubo-X1\r\nFN:Rossi\\, Anna\\; srl\r\nN:Anna\\; srl;Rossi\\,;;;\r\nTEL;TYPE=CELL:+393331234567\r\nEMAIL;TYPE=INTERNET:a@b.it\r\nCATEGORIES:Clienti Kubo\r\nEND:VCARD\r\n');
});

test('CardDAV: trova la rubrica (principal → home → addressbook), scrive i clienti nuovi e cambiati, giro di tutti', async () => {
  const K = await kubo(['negozio']), schede = {};
  const S = await finto({
    'PROPFIND /': () => xml('<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>'),
    'PROPFIND /123/principal/': () => xml('<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>/123/carddavhome/</d:href></card:addressbook-home-set></d:prop></d:propstat></d:response>'),
    'PROPFIND /123/carddavhome/': () => xml('<d:response><d:href>/123/carddavhome/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
      + '<d:response><d:href>/123/carddavhome/card/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Contatti</d:displayname></d:prop></d:propstat></d:response>'),
    'PUT /123/carddavhome/card/:file': (p, c, { intestazioni }) => (intestazioni.authorization === 'Basic ' + Buffer.from('anna@icloud.example:abcd-efgh-ijkl-mnop').toString('base64') ? (schede[p.file] = c, { stato: 201, corpo: '' }) : { stato: 401, corpo: '' }),
  });
  try {
    await accendi(K, 'carddav', { base: S.url, segreti: { password: 'abcd-efgh-ijkl-mnop' }, impostazioni: { utente: 'anna@icloud.example' } });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/carddav/prova')).json, { ok: true, messaggio: `${S.url}/123/carddavhome/card/` });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/carddav/azioni/rubriche', { args: {} })).json.rubriche, [{ url: `${S.url}/123/carddavhome/card/`, nome: 'Contatti' }]);
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Ferri', telefono: '347 000 1111' })).json; await coda(K);
    assert.match(schede[`kubo-${cl.id}.vcf`], /\r\nFN:Luca Ferri\r\nN:Ferri;Luca;;;\r\nTEL;TYPE=CELL:\+393470001111\r\n/);
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { email: 'luca@esempio.it' }); await coda(K);
    assert.match(schede[`kubo-${cl.id}.vcf`], /EMAIL;TYPE=INTERNET:luca@esempio\.it/);
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Senza recapiti' });
    const g = await K.chiama('POST', '/api/connettori/carddav/giri/tutti'); assert.deepEqual(g.json.risultato, { scritti: 1, saltati: 1 }, JSON.stringify(g.json));
    assert.deepEqual((await K.chiama('POST', '/api/connettori/carddav/giri/tutti')).json.risultato, { scritti: 0, saltati: 0 });
    // password sbagliata: errore leggibile nel registro, il giro non si blocca in silenzio
    await K.chiama('PUT', '/api/connettori/carddav', { segreti: { password: 'sbagliata' } });
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { telefono: '347 000 2222' }); await coda(K);
    assert.ok((await K.chiama('GET', '/api/connettori/carddav')).json.registro.some(x => x.esito === 'avviso' && /non è stata salvata \(HTTP 401\)/.test(x.dettagli || '')));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Google Contatti: crea il contatto, aggiorna con l\'etag, rilegge se è cambiato sul telefono', async () => {
  const K = await kubo(['negozio']), contatti = {}; let n = 0;
  const S = await finto({
    'POST /v1/:azione': (p, c, { intestazioni }) => {
      if (p.azione !== 'people:createContact' || intestazioni.authorization !== 'Bearer tok-g') return { stato: 400, corpo: {} };
      const rn = `people/c${++n}`; contatti[rn] = { ...c, etag: `e${n}-1` }; return { resourceName: rn, etag: contatti[rn].etag };
    },
    'GET /v1/people/:rn': p => (contatti[`people/${p.rn}`] ? { resourceName: `people/${p.rn}`, etag: contatti[`people/${p.rn}`].etag } : { stato: 404, corpo: {} }),
    'PATCH /v1/people/:rn': (p, c, { q }) => {
      const rn = `people/${p.rn.replace(/:updateContact$/, '')}`, x = contatti[rn]; if (!x) return { stato: 404, corpo: {} };
      if (c.etag !== x.etag) return { stato: 400, corpo: { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'Request person.etag is different than the current person.etag.' } } };
      contatti[rn] = { ...c, etag: x.etag.replace(/-(\d+)$/, (_, d) => `-${Number(d) + 1}`), campi: q.get('updatePersonFields') }; return { resourceName: rn, etag: contatti[rn].etag };
    },
  });
  try {
    await accendi(K, 'google-contatti', { base: S.url, segreti: { client_id: 'cid', client_secret: 'cs' } });
    K.nucleo.k('google-contatti').salvaSegreto('_oauth', JSON.stringify({ access_token: 'tok-g', refresh_token: 'r', scade: Date.now() + 36e5 }));
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Marta Riva', telefono: '3200001111', email: 'marta@esempio.it' })).json; await coda(K);
    assert.deepEqual(contatti['people/c1'].names, [{ givenName: 'Marta', familyName: 'Riva' }]); assert.deepEqual(contatti['people/c1'].phoneNumbers, [{ value: '+393200001111', type: 'mobile' }]);
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { telefono: '3200002222' }); await coda(K);
    assert.equal(contatti['people/c1'].phoneNumbers[0].value, '+393200002222'); assert.equal(contatti['people/c1'].etag, 'e1-2'); assert.equal(contatti['people/c1'].campi, 'names,phoneNumbers,emailAddresses,biographies');
    contatti['people/c1'].etag = 'e1-9';   // modificato sul telefono
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { email: 'marta.riva@esempio.it' }); await coda(K);
    assert.equal(contatti['people/c1'].emailAddresses[0].value, 'marta.riva@esempio.it'); assert.equal(contatti['people/c1'].etag, 'e1-10');
    assert.equal(n, 1);   // sempre lo stesso contatto
    // tolto dalla rubrica sul telefono: il legame si scioglie (k.sincro.scollega) e il contatto si ricrea, senza righe finte
    delete contatti['people/c1'];
    await K.chiama('PATCH', `/api/dati/clienti/${cl.id}`, { telefono: '3200003333' }); await coda(K);
    assert.equal(n, 2); assert.equal(contatti['people/c2'].phoneNumbers[0].value, '+393200003333');
    assert.deepEqual(K.db.prepare("SELECT riga, remoto FROM _connettori_mappa WHERE connettore = 'google-contatti'").all().map(x => ({ ...x })), [{ riga: String(cl.id), remoto: 'people/c2' }]);
  } finally { await K.chiudi(); await S.chiudi(); }
});
