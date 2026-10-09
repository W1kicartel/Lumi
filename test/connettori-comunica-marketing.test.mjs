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

test('HubSpot: cliente → contatto (batch/upsert per email) e azienda con P.IVA, contatti cambiati → clienti, webhook v3 firmato', async () => {
  const { firmaV3 } = await import('../connettori/hubspot/connettore.js');
  const K = await kubo(['negozio']); const upsert = [], aziende = [];
  const contatti = [{ id: '501', properties: { email: 'giulia@esempio.it', firstname: 'Giulia', lastname: 'Rossi', phone: '+39 347 2222222', lastmodifieddate: '2026-10-01T09:00:00.000Z' } }];
  const S = await finto({
    'GET /crm/v3/objects/contacts': () => ({ results: [] }),
    'POST /crm/v3/objects/contacts/batch/upsert': (p, c) => { upsert.push(c); return { status: 'COMPLETE', results: c.inputs.map((x, i) => ({ id: `90${upsert.length}${i}`, properties: { email: x.id }, new: true })) }; },
    'POST /crm/v3/objects/companies': (p, c) => { aziende.push(c); return { id: 'co1', properties: c.properties }; },
    'PATCH /crm/v3/objects/companies/:id': (p, c) => { aziende.push({ ...c, id: p.id }); return { id: p.id }; },
    'POST /crm/v3/objects/contacts/search': (p, c) => ({ total: 1, results: contatti.filter(x => Date.parse(x.properties.lastmodifieddate) > Number(c.filterGroups[0].filters[0].value)) }),
    'POST /crm/v3/objects/contacts/batch/read': (p, c) => ({ results: c.inputs.map(x => ({ id: x.id, properties: { email: 'piero@esempio.it', firstname: 'Piero', lastname: 'Gialli' } })) }),
  });
  try {
    await accendi(K, 'hubspot', { base: S.url, segreti: { token: 'pat-eu1-' + '00000000-1111-2222-3333-444444444444', firma: 'segreto-app' }, impostazioni: { pubblico: 'https://kubo.esempio.it' } });
    assert.equal((await K.chiama('POST', '/api/connettori/hubspot/prova')).json.ok, true);
    // un cliente con la P.IVA: contatto (upsert per email) e azienda
    const c = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Ferramenta Bassi', email: 'Info@Bassi.it', telefono: '+39 02 123456', tipo: 'azienda', piva: '01234567890' })).json;
    await pausa(50); await K.nucleo.lavora();
    assert.deepEqual(upsert[0].inputs[0], { idProperty: 'email', id: 'info@bassi.it', properties: { email: 'info@bassi.it', firstname: 'Ferramenta', lastname: 'Bassi', phone: '+39 02 123456' } });
    assert.equal(S.chiamate.find(x => x.percorso.endsWith('/batch/upsert')).intestazioni.authorization, 'Bearer pat-eu1-' + '00000000-1111-2222-3333-444444444444');
    assert.equal(aziende[0].properties.name, 'Ferramenta Bassi'); assert.match(aziende[0].properties.description, /01234567890/);
    assert.equal(K.nucleo.k('hubspot').sincro.remoto('clienti', c.id), '9010');
    await K.chiama('PATCH', `/api/dati/clienti/${c.id}`, { telefono: '+39 02 654321' }); await pausa(50); await K.nucleo.lavora();
    assert.equal(aziende.at(-1).id, 'co1');   // la seconda volta si aggiorna la stessa azienda
    // HubSpot → Kubo: il contatto cambiato diventa un cliente, e il giro dopo non riscrive niente
    const g = (await K.chiama('POST', '/api/connettori/hubspot/giri/contatti')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 1, aggiornati: 0, uguali: 0 });
    const giulia = (await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe.find(r => r.email === 'giulia@esempio.it');
    assert.equal(giulia.nome, 'Giulia Rossi'); assert.equal(giulia.telefono, '+39 347 2222222');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/hubspot/giri/contatti')).json.risultato, { creati: 0, aggiornati: 0, uguali: 0 });
    await pausa(50); await K.nucleo.lavora(); assert.equal(upsert.length, 2);   // quello che arriva da HubSpot non torna indietro
    // webhook v3: firma giusta → il contatto si rilegge; firma sbagliata o vecchia → 401
    const corpo = JSON.stringify([{ eventId: 77, subscriptionType: 'contact.creation', objectId: 601, occurredAt: Date.now() }]), ts = String(Date.now());
    const firma = firmaV3('segreto-app', 'POST', 'https://kubo.esempio.it/api/connettori/hubspot/in', corpo, ts);
    const ok = await manda(K, '/api/connettori/hubspot/in', corpo, { 'X-HubSpot-Signature-v3': firma, 'X-HubSpot-Request-Timestamp': ts });
    assert.equal(ok.stato, 200, JSON.stringify(ok.json)); assert.match(ok.json.esito, /1 creati/);
    assert.equal((await manda(K, '/api/connettori/hubspot/in', corpo, { 'X-HubSpot-Signature-v3': firma.replace(/^./, 'A'), 'X-HubSpot-Request-Timestamp': ts })).stato, 401);
    const vecchio = String(Date.now() - 6 * 6e4);
    assert.equal((await manda(K, '/api/connettori/hubspot/in', corpo, { 'X-HubSpot-Signature-v3': firmaV3('segreto-app', 'POST', 'https://kubo.esempio.it/api/connettori/hubspot/in', corpo, vecchio), 'X-HubSpot-Request-Timestamp': vecchio })).stato, 401);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Meta Lead Ads: il giro legge i lead nuovi dei moduli e crea i clienti (provenienza, nota), niente doppioni, webhook firmato', async () => {
  const K = await kubo(['professionista']);
  const lead = (id, nome, email, extra = {}) => ({ id, created_time: '2026-10-08T10:00:00+0000', form_id: '1234567890', campaign_name: 'Autunno 2026', ad_name: 'Video 1', platform: 'ig',
    field_data: [{ name: 'full_name', values: [nome] }, { name: 'email', values: [email] }, { name: 'phone_number', values: ['+39333000000' + id.slice(-1)] }, ...Object.entries(extra).map(([n, v]) => ({ name: n, values: [v] }))] });
  const S = await finto({
    'GET /v25.0/:id/leads': (p, c, { q }) => ({ data: JSON.parse(q.get('filtering'))[0].value > 1800000000 ? [] : [lead('L1', 'Paola Ferri', 'paola@esempio.it', { quale_servizio: 'Consulenza' }), lead('L2', 'Mario Già', 'mario@esempio.it')] }),
    'GET /v25.0/:id': p => (p.id === '1234567890' ? { name: 'Richiesta preventivo', leads_count: 2 } : lead(p.id, 'Teo Nuovo', 'teo@esempio.it')),
  });
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Mario Già', email: 'mario@esempio.it' });
    await accendi(K, 'meta-lead', { base: S.url, segreti: { token: 'EAAfinto', segreto_app: 'app-secret' }, impostazioni: { moduli: '1234567890' } });
    assert.equal((await K.chiama('POST', '/api/connettori/meta-lead/prova')).json.messaggio, 'Richiesta preventivo (2 lead)');
    const g = (await K.chiama('POST', '/api/connettori/meta-lead/giri/lead')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 1, presenti: 1 });
    const chiamata = S.chiamate.find(c => c.percorso.endsWith('/leads'));
    assert.equal(chiamata.intestazioni.authorization, 'Bearer EAAfinto'); assert.equal(JSON.parse(chiamata.q.filtering)[0].field, 'time_created'); assert.match(chiamata.q.fields, /field_data/);
    const tutti = (await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe, paola = tutti.find(r => r.email === 'paola@esempio.it');
    assert.equal(tutti.length, 2); assert.equal(paola.nome, 'Paola Ferri'); assert.equal(paola.telefono, '+393330000001'); assert.equal(paola.provenienza, 'social');
    assert.match(paola.note, /Instagram.*«Richiesta preventivo».*«Autunno 2026»/); assert.match(paola.note, /quale servizio: Consulenza/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/meta-lead/giri/lead')).json.risultato, { creati: 0, presenti: 2 });   // gli stessi lead: niente doppioni
    // il webhook: firma dell'App Secret → il lead si rilegge dall'API; senza firma giusta → 401
    const corpo = JSON.stringify({ object: 'page', entry: [{ id: '99', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: 'L3', form_id: '1234567890', page_id: '99' } }] }] });
    assert.equal((await manda(K, '/api/connettori/meta-lead/in', corpo, { 'X-Hub-Signature-256': 'sha256=' + firmaHmacDi('altro', corpo, 'hex') })).stato, 401);
    const ok = await manda(K, '/api/connettori/meta-lead/in', corpo, { 'X-Hub-Signature-256': 'sha256=' + firmaHmacDi('app-secret', corpo, 'hex') });
    assert.equal(ok.stato, 200, JSON.stringify(ok.json)); assert.equal(ok.json.esito, 'creato');
    assert.ok((await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe.some(r => r.email === 'teo@esempio.it'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Recensioni Google: il primo giro segna il punto, poi le nuove diventano avvisi; la risposta con anteprima e PUT …/reply', async () => {
  const K = await kubo(['studio']); let risposta = null;
  const rec = (id, nome, stelle, testo, quando, rr) => ({ name: `accounts/111111/locations/222222/reviews/${id}`, reviewId: id, reviewer: { displayName: nome }, starRating: stelle, comment: testo, createTime: quando, updateTime: quando, ...(rr ? { reviewReply: { comment: rr } } : {}) });
  const tutte = [rec('rev-vecchia1', 'Carla', 'FOUR', 'Bene', '2026-09-01T10:00:00Z', 'Grazie Carla!')];
  const S = await finto({
    'GET /v4/accounts/:a/locations/:l/reviews': () => ({ reviews: [...tutte].sort((a, b) => b.updateTime.localeCompare(a.updateTime)), averageRating: 4.5, totalReviewCount: tutte.length }),
    'PUT /v4/accounts/:a/locations/:l/reviews/:id/reply': (p, c) => { risposta = { id: p.id, ...c }; return { comment: c.comment, updateTime: '2026-10-09T12:00:00Z' }; },
  });
  try {
    await accendi(K, 'google-business', { base: S.url, segreti: { client_id: 'gid', client_secret: 'gsec' }, impostazioni: { account: 'accounts/111111', sede: '222222' } });
    oauthFinto(K, 'google-business');
    assert.equal((await K.chiama('POST', '/api/connettori/google-business/prova')).json.messaggio, '1 recensioni, media 4.5');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/google-business/giri/recensioni')).json.risultato, { nuove: 0, senzaRisposta: 0, media: 4.5, totale: 1 });   // la prima volta niente valanga di avvisi
    tutte.push(rec('rev-nuova22', 'Marco Gialli', 'FIVE', 'Servizio eccellente, torneremo!', '2026-10-08T18:30:00Z'));
    const g = (await K.chiama('POST', '/api/connettori/google-business/giri/recensioni')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.equal(g.risultato.nuove, 1); assert.equal(g.risultato.senzaRisposta, 1);
    const avvisi = K.db.prepare("SELECT titolo FROM _connettori_registro WHERE connettore = 'google-business' AND esito = 'avviso'").all().map(x => x.titolo);
    assert.ok(avvisi.some(t => /Nuova recensione ★★★★★ da Marco Gialli: «Servizio eccellente/.test(t)), JSON.stringify(avvisi));
    assert.equal(S.chiamate.find(c => c.metodo === 'GET').intestazioni.authorization, 'Bearer tok');
    assert.equal(S.chiamate.find(c => c.metodo === 'GET').q.orderBy, 'updateTime desc');
    assert.equal((await K.chiama('POST', '/api/connettori/google-business/giri/recensioni')).json.risultato.nuove, 0);
    // Lumi: le ultime recensioni, poi la bozza di risposta mostrata prima di pubblicare
    const l = (await K.chiama('POST', '/api/connettori/google-business/azioni/recensioni', {})).json;
    assert.equal(l.recensioni[0].id, 'rev-nuova22'); assert.equal(l.recensioni[0].stelle, 5);
    const args = { recensione: 'rev-nuova22', risposta: 'Grazie Marco, a presto!' };
    const ant = (await K.chiama('POST', '/api/connettori/google-business/azioni/rispondi_recensione', { args, anteprima: true })).json;
    assert.match(ant.righe[0][1], /Marco Gialli/); assert.deepEqual(ant.righe[1], ['Risposta', 'Grazie Marco, a presto!']); assert.equal(risposta, null);
    const fatto = (await K.chiama('POST', '/api/connettori/google-business/azioni/rispondi_recensione', { args })).json;
    assert.equal(fatto.pubblicata, true); assert.deepEqual(risposta, { id: 'rev-nuova22', comment: 'Grazie Marco, a presto!' });
    assert.equal((await K.chiama('POST', '/api/connettori/google-business/azioni/rispondi_recensione', { args: { recensione: 'rev-nuova22', risposta: '  ' } })).stato, 502);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Trustpilot: recensioni nuove come avviso (apikey), risposta e invito con il token client_credentials', async () => {
  const K = await kubo(['studio']); const tok = [], inviti = [], risposte = [];
  const rv = (id, nome, stelle, titolo, quando) => ({ id, consumer: { displayName: nome }, stars: stelle, title: titolo, text: titolo, createdAt: quando });
  const tutte = [rv('5f0000000000000000000001', 'Carla', 5, 'Ottimo', '2026-09-01T10:00:00Z')];
  const S = await finto({
    'POST /v1/oauth/oauth-business-users-for-applications/accesstoken': (p, c) => { tok.push(c); return c.grant_type === 'client_credentials' && c.client_id === 'tp-key' && c.client_secret === 'tp-secret' ? { access_token: 'tp-tok', expires_in: 359999 } : { stato: 401, corpo: {} }; },
    'GET /v1/business-units/find': (p, c, { q }) => (q.get('name') === 'bottega.it' ? { id: 'bu123', displayName: 'Bottega' } : { stato: 404, corpo: {} }),
    'GET /v1/business-units/:id/reviews': () => ({ reviews: [...tutte].reverse() }),
    'POST /v1/private/reviews/:id/reply': (p, c) => { risposte.push({ id: p.id, ...c }); return { stato: 201, corpo: {} }; },
    'POST /v1/private/business-units/:id/email-invitations': (p, c, { intestazioni }) => { inviti.push({ bu: p.id, corpo: c, utente: intestazioni['x-business-user-id'] }); return { stato: 202, corpo: {} }; },
  });
  try {
    const anna = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it' })).json;
    await accendi(K, 'trustpilot', { base: S.url, segreti: { chiave: 'tp-key', segreto: 'tp-secret' }, impostazioni: { dominio: 'https://bottega.it/', utente: 'bu-user-1', mittente: 'Bottega' } });
    assert.equal((await K.chiama('POST', '/api/connettori/trustpilot/prova')).json.messaggio, 'Bottega');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/trustpilot/giri/recensioni')).json.risultato, { nuove: 0, senzaRisposta: 0 });
    tutte.push(rv('5f0000000000000000000002', 'Marco', 2, 'Consegna in ritardo', '2026-10-08T09:00:00Z'));
    assert.deepEqual((await K.chiama('POST', '/api/connettori/trustpilot/giri/recensioni')).json.risultato, { nuove: 1, senzaRisposta: 1 });
    assert.equal(S.chiamate.find(c => c.percorso.endsWith('/reviews')).intestazioni.apikey, 'tp-key');
    assert.ok(K.db.prepare("SELECT titolo FROM _connettori_registro WHERE connettore = 'trustpilot' AND esito = 'avviso'").all().some(x => /★★ da Marco: «Consegna in ritardo»/.test(x.titolo)));
    const args = { recensione: '5f0000000000000000000002', risposta: 'Ci scusi Marco, abbiamo rimediato.' };
    assert.match((await K.chiama('POST', '/api/connettori/trustpilot/azioni/rispondi_recensione', { args, anteprima: true })).json.righe[0][1], /Marco/);
    assert.equal((await K.chiama('POST', '/api/connettori/trustpilot/azioni/rispondi_recensione', { args })).json.pubblicata, true);
    assert.deepEqual(risposte[0], { id: '5f0000000000000000000002', message: 'Ci scusi Marco, abbiamo rimediato.', authorBusinessUserId: 'bu-user-1' });
    assert.equal(S.chiamate.find(c => c.percorso.endsWith('/reply')).intestazioni.authorization, 'Bearer tp-tok');
    const inv = (await K.chiama('POST', '/api/connettori/trustpilot/azioni/chiedi_recensione', { args: { cliente: anna.id } })).json;
    assert.equal(inv.invitato, 'anna@esempio.it');
    assert.equal(inviti[0].bu, 'bu123'); assert.equal(inviti[0].utente, 'bu-user-1');
    assert.equal(inviti[0].corpo.consumerName, 'Anna Bianchi'); assert.equal(inviti[0].corpo.referenceNumber, anna.id); assert.equal(inviti[0].corpo.senderName, 'Bottega');
    assert.equal(tok.length, 1);   // il token vale 100 ore: uno solo
  } finally { await K.chiudi(); await S.chiudi(); }
});
