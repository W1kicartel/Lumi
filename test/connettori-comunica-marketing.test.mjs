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

test('Airtable: upsert a lotti da 10 su «Kubo ID», solo i campi con lo stesso nome, poi solo le righe cambiate', async () => {
  const K = await kubo(['studio']); const lotti = [];
  const S = await finto({
    'GET /v0/meta/bases/:base/tables': () => ({ tables: [{ id: 'tblClienti', name: 'Clienti', fields: [{ name: 'Kubo ID' }, { name: 'Nome' }, { name: 'Email' }, { name: 'Consenso al trattamento' }] }] }),
    'PATCH /v0/:base/:tabella': (p, c) => { lotti.push(c); return { records: c.records.map((r, i) => ({ id: `rec${lotti.length}_${i}`, fields: r.fields })), createdRecords: c.records.map((r, i) => `rec${lotti.length}_${i}`), updatedRecords: [] }; },
  });
  try {
    for (let i = 1; i <= 12; i++) await K.chiama('POST', '/api/dati/clienti', { nome: `Cliente ${i}`, email: `c${i}@esempio.it`, consenso: i % 2 === 0 });
    await accendi(K, 'airtable', { base: S.url, segreti: { token: 'patFINTO.0123456789abcdef' }, impostazioni: { base: 'appFINTO12345678', tabella: 'clienti', sezione: 'Clienti' } });
    assert.equal((await K.chiama('POST', '/api/connettori/airtable/prova')).json.messaggio, 'Clienti: 4 campi');
    const g = (await K.chiama('POST', '/api/connettori/airtable/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { tabella: 'Clienti', creati: 12, aggiornati: 0, campi: 3 });
    assert.deepEqual(lotti.map(l => l.records.length), [10, 2]);
    assert.deepEqual(lotti[0].performUpsert, { fieldsToMergeOn: ['Kubo ID'] }); assert.equal(lotti[0].typecast, true);
    assert.deepEqual(Object.keys(lotti[0].records[0].fields).sort(), ['Consenso al trattamento', 'Email', 'Kubo ID', 'Nome']);   // «Telefono» non c'è in Airtable: non passa
    assert.equal(S.chiamate.find(c => c.metodo === 'PATCH').intestazioni.authorization, 'Bearer patFINTO.0123456789abcdef');
    assert.equal((await K.chiama('POST', '/api/connettori/airtable/giri/sincronizza')).json.risultato.creati, 0);   // niente di nuovo
    const uno = (await K.chiama('GET', '/api/dati/clienti?perPagina=1')).json.righe[0];
    await pausa(5); await K.chiama('PATCH', `/api/dati/clienti/${uno.id}`, { note: 'cambiato' });
    await K.chiama('POST', '/api/connettori/airtable/giri/sincronizza');
    assert.equal(lotti.at(-1).records.length, 1); assert.equal(lotti.at(-1).records[0].fields['Kubo ID'], uno.id);
    assert.equal(K.nucleo.k('airtable').sincro.remoto('clienti', uno.id) != null, true);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Notion: una pagina per riga con le proprietà del database, la seconda volta PATCH della stessa pagina', async () => {
  const K = await kubo(['studio']); let n = 0;
  const S = await finto({
    'GET /v1/databases/:id': () => ({ title: [{ plain_text: 'Clienti' }], properties: { Nome: { id: 'title', name: 'Nome', type: 'title' }, Email: { id: 'e', name: 'Email', type: 'email' }, Telefono: { id: 't', name: 'Telefono', type: 'phone_number' }, 'Data di nascita': { id: 'd', name: 'Data di nascita', type: 'date' }, Consenso: { id: 'c', name: 'consenso', type: 'checkbox' }, Totale: { id: 'f', name: 'Totale', type: 'formula' } } }),
    'POST /v1/pages': (p, c) => ({ id: `pag-${++n}`, properties: c.properties }),
    'PATCH /v1/pages/:id': (p, c) => ({ id: p.id }),
  });
  try {
    const a = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it', telefono: '+39 333 1111111', nascita: '1990-05-04', consenso: true })).json;
    await accendi(K, 'notion', { base: S.url, segreti: { token: 'ntn_finto0123456789abcdefghij' }, impostazioni: { database: 'https://www.notion.so/bottega/0123456789abcdef0123456789abcdef?v=1', sezione: 'clienti' } });
    const g = (await K.chiama('POST', '/api/connettori/notion/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.equal(g.risultato.creati, 1);
    const post = S.chiamate.find(c => c.metodo === 'POST');
    assert.equal(post.intestazioni['notion-version'], '2022-06-28'); assert.equal(post.intestazioni.authorization, 'Bearer ntn_finto0123456789abcdefghij');
    assert.deepEqual(post.corpo.parent, { database_id: '0123456789abcdef0123456789abcdef' });
    assert.deepEqual(post.corpo.properties.Nome, { title: [{ type: 'text', text: { content: 'Anna Bianchi' } }] });
    assert.deepEqual(post.corpo.properties.Email, { email: 'anna@esempio.it' }); assert.deepEqual(post.corpo.properties['Data di nascita'], { date: { start: '1990-05-04' } });
    assert.deepEqual(post.corpo.properties.Telefono, { phone_number: '+39 333 1111111' }); assert.equal(post.corpo.properties.Totale, undefined);
    await pausa(5); await K.chiama('PATCH', `/api/dati/clienti/${a.id}`, { email: 'anna.b@esempio.it' });
    const g2 = (await K.chiama('POST', '/api/connettori/notion/giri/sincronizza')).json.risultato;
    assert.deepEqual([g2.creati, g2.aggiornati], [0, 1]);
    const patch = S.chiamate.find(c => c.metodo === 'PATCH'); assert.equal(patch.percorso, '/v1/pages/pag-1'); assert.deepEqual(patch.corpo.properties.Email, { email: 'anna.b@esempio.it' });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Mailchimp: solo i clienti con il consenso (PUT per hash md5, tag), uscita immediata, i disiscritti perdono il consenso', async () => {
  const K = await kubo(['studio']); const membri = new Map(), tag = [];
  const S = await finto({
    'GET /3.0/lists/:lista': () => ({ name: 'Newsletter Bottega', stats: { member_count: 3 } }),
    'PUT /3.0/lists/:lista/members/:h': (p, c) => { membri.set(p.h, c); return { id: p.h, email_address: c.email_address, status: c.status_if_new }; },
    'POST /3.0/lists/:lista/members/:h/tags': (p, c) => { tag.push([p.h, c.tags]); return { stato: 204, corpo: '' }; },
    'GET /3.0/lists/:lista/members': (p, c, { q }) => (q.get('status') === 'unsubscribed' ? { members: [{ email_address: 'anna@esempio.it', last_changed: '2026-10-01T10:00:00+00:00' }], total_items: 1 } : { members: [] }),
  });
  const md5 = s => createHash('md5').update(s).digest('hex');
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Maria Bianchi', email: 'Anna@Esempio.it', telefono: '+39 333 1111111', consenso: true });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Verdi', email: 'luca@esempio.it', consenso: false });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Marta Neri', consenso: true });
    await accendi(K, 'mailchimp', { base: S.url, segreti: { chiave: '' + '0123456789abcdef'.repeat(2) + '-us21' }, impostazioni: { lista: 'a1b2c3d4e5' } });
    assert.equal((await K.chiama('POST', '/api/connettori/mailchimp/prova')).json.messaggio, 'Newsletter Bottega: 3 iscritti');
    const g = (await K.chiama('POST', '/api/connettori/mailchimp/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { iscritti: 1, saltati: 2, disiscritti: 1 });
    const h = md5('anna@esempio.it'); assert.deepEqual([...membri.keys()], [h]);
    assert.deepEqual(membri.get(h), { email_address: 'anna@esempio.it', status_if_new: 'subscribed', merge_fields: { FNAME: 'Anna', LNAME: 'Maria Bianchi', PHONE: '+39 333 1111111' } });
    assert.deepEqual(tag[0], [h, [{ name: 'Kubo', status: 'active' }]]);
    const put = S.chiamate.find(c => c.metodo === 'PUT'); assert.equal(put.intestazioni.authorization, 'Basic ' + Buffer.from('kubo:' + '0123456789abcdef'.repeat(2) + '-us21').toString('base64'));
    const dis = S.chiamate.find(c => c.q.status === 'unsubscribed'); assert.ok(dis.q.since_last_changed);
    // Anna si è disiscritta in Mailchimp: in Kubo il consenso è «no» (e la modifica non riparte verso Mailchimp)
    const cliente = async n => (await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe.find(r => r.nome.startsWith(n));
    assert.equal((await cliente('Anna')).consenso, false);
    await pausa(50); await K.nucleo.lavora(); assert.equal(S.chiamate.filter(c => c.metodo === 'PUT').length, 1);
    // un cliente nuovo con il consenso va subito (uscita), con il tag dal campo scelto
    await K.chiama('PUT', '/api/connettori/mailchimp', { impostazioni: { tag_campo: 'note' } });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Sara Blu', email: 'sara@esempio.it', consenso: true, note: 'VIP' });
    await pausa(50); await K.nucleo.lavora();
    assert.ok(membri.has(md5('sara@esempio.it'))); assert.deepEqual(tag.at(-1)[1].map(t => t.name).sort(), ['Kubo', 'VIP']);
    // l'azione per Lumi: un cliente senza consenso non si iscrive
    const luca = await cliente('Luca');
    const ant = (await K.chiama('POST', '/api/connettori/mailchimp/azioni/iscrivi', { args: { cliente: luca.id }, anteprima: true })).json;
    assert.ok(ant.avvisi.some(a => /consenso/.test(a)));
    assert.equal((await K.chiama('POST', '/api/connettori/mailchimp/azioni/iscrivi', { args: { cliente: luca.id } })).stato, 502);
  } finally { await K.chiudi(); await S.chiudi(); }
});
