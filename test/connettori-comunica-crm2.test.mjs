// I connettori di marketing e CRM del terzo giro (MailUp, ActiveCampaign, Zoho CRM) contro finti servizi locali:
// niente rete vera, dati inventati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import { coda } from './connettori-comunica-coda.mjs';

const clienti = async K => (await K.chiama('GET', '/api/dati/clienti?perPagina=100')).json.righe;

test('MailUp: token «password» (Basic) una volta sola, solo i clienti con il consenso nella lista, i disiscritti perdono il consenso, consenso tolto → Unsubscribe', async () => {
  const K = await kubo(['studio']); let n = 76;
  const C = '/API/v1.1/Rest/ConsoleService.svc/Console';
  const S = await finto({
    'POST /Authorization/OAuth/Token': () => ({ access_token: 'tok-mailup', expires_in: 3600, refresh_token: 'r' }),
    [`GET ${C}/User/Lists`]: () => ({ IsPaginated: false, Items: [{ idList: 1, Name: 'Clienti Kubo' }], TotalElementsCount: 1 }),
    [`POST ${C}/List/:lista/Recipient`]: () => ++n,
    [`GET ${C}/List/:lista/Recipients/Unsubscribed`]: () => ({ IsPaginated: true, Items: [{ idRecipient: 77, Email: 'Anna@Esempio.it', Name: 'Anna Maria Bianchi' }], PageNumber: 0, PageSize: 100, TotalElementsCount: 1 }),
    [`DELETE ${C}/List/:lista/Unsubscribe/:id`]: () => ({}),
  });
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Maria Bianchi', email: 'Anna@Esempio.it', telefono: '+39 333 1111111', consenso: true });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Verdi', email: 'luca@esempio.it', consenso: false });
    await accendi(K, 'mailup', { base: S.url, segreti: { password: 'parola-finta', client_secret: 'segreto-finto' }, impostazioni: { utente: 'm12345', client_id: 'cid-0000-1111', lista: '1' } });
    assert.equal((await K.chiama('POST', '/api/connettori/mailup/prova')).json.messaggio, 'Lista «Clienti Kubo»');
    const t = S.chiamate.find(c => c.percorso === '/Authorization/OAuth/Token');
    assert.equal(t.intestazioni.authorization, 'Basic ' + Buffer.from('cid-0000-1111:segreto-finto').toString('base64'));
    assert.deepEqual(t.corpo, { grant_type: 'password', username: 'm12345', password: 'parola-finta' });
    const g = (await K.chiama('POST', '/api/connettori/mailup/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { iscritti: 1, saltati: 1, disiscritti: 1 });
    const iscr = S.chiamate.filter(c => c.metodo === 'POST' && c.percorso.endsWith('/Recipient'));
    assert.equal(iscr.length, 1);
    assert.equal(iscr[0].percorso, `${C}/List/1/Recipient`);
    assert.deepEqual(iscr[0].corpo, { Name: 'Anna Maria Bianchi', Email: 'anna@esempio.it', MobilePrefix: '39', MobileNumber: '3331111111', Fields: [{ Id: 1, Value: 'Anna' }, { Id: 2, Value: 'Maria Bianchi' }] });
    assert.equal(iscr[0].intestazioni.authorization, 'Bearer tok-mailup');
    assert.equal((await clienti(K)).find(r => r.nome === 'Anna Maria Bianchi').consenso, false);
    await coda(K); assert.equal(S.chiamate.filter(c => c.metodo !== 'GET' && c.percorso.startsWith(C)).length, 1);   // il consenso tolto da MailUp non torna indietro
    // in Kubo: un cliente nuovo con il consenso va subito; poi il consenso tolto lo disiscrive dalla lista
    const carla = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Carla Neri', email: 'carla@esempio.it', consenso: true })).json; await coda(K);
    assert.equal(S.chiamate.filter(c => c.metodo === 'POST' && c.percorso.endsWith('/Recipient')).at(-1).corpo.Email, 'carla@esempio.it');
    await K.chiama('PATCH', `/api/dati/clienti/${carla.id}`, { consenso: false }); await coda(K);
    assert.equal(S.chiamate.filter(c => c.metodo === 'DELETE').at(-1)?.percorso, `${C}/List/1/Unsubscribe/78`);
    assert.equal(S.chiamate.filter(c => c.percorso === '/Authorization/OAuth/Token').length, 1);   // il token vale un'ora
    // l'azione per Lumi: anteprima e poi tutto da capo
    assert.equal((await K.chiama('POST', '/api/connettori/mailup/azioni/sincronizza_ora', { args: {}, anteprima: true })).json.titolo, 'Sincronizza con MailUp');
    const a = (await K.chiama('POST', '/api/connettori/mailup/azioni/sincronizza_ora', { args: {} })).json;
    assert.equal(a.risultato?.disiscritti ?? a.disiscritti, 0, JSON.stringify(a));   // Anna è già senza consenso
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('ActiveCampaign: contact/sync con Api-Token, lista (status 1) e tag la prima volta; disiscritti (status 2) → consenso no; consenso tolto → status 2', async () => {
  const K = await kubo(['studio']); let n = 0;
  const S = await finto({
    'GET /api/3/lists/:id': p => (p.id === '3' ? { list: { id: '3', name: 'Clienti Kubo' } } : { stato: 404, corpo: { message: 'No Result found' } }),
    'POST /api/3/contact/sync': (p, c) => ({ stato: 201, corpo: { contact: { id: String(++n), email: c.contact.email } } }),
    'POST /api/3/contactLists': (p, c) => ({ contactList: { ...c.contactList, id: '9' } }),
    'POST /api/3/contactTags': (p, c) => ({ stato: 201, corpo: { contactTag: { ...c.contactTag, id: '5' } } }),
    'GET /api/3/contacts': (p, c, { q }) => (q.get('status') === '2' && q.get('listid') === '3' && q.get('id_greater') === '0' ? { contacts: [{ id: '1', email: 'anna@esempio.it', udate: '2026-10-08T10:00:00-05:00' }], meta: { total: '1' } } : { contacts: [], meta: { total: '0' } }),
  });
  try {
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Anna Maria Bianchi', email: 'Anna@Esempio.it', telefono: '+39 333 1111111', consenso: true });
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Luca Verdi', email: 'luca@esempio.it', consenso: false });
    const chiave = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6';
    await accendi(K, 'activecampaign', { base: S.url, segreti: { token: chiave }, impostazioni: { url: 'https://bottega.api-us1.com', lista: '3', tag: '12' } });
    const p = (await K.chiama('POST', '/api/connettori/activecampaign/prova')).json;
    assert.equal(p.messaggio, 'Lista «Clienti Kubo»'); assert.equal(S.chiamate[0].intestazioni['api-token'], chiave);
    const g = (await K.chiama('POST', '/api/connettori/activecampaign/giri/sincronizza')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { iscritti: 1, saltati: 1, disiscritti: 1 });
    const post = pr => S.chiamate.filter(c => c.metodo === 'POST' && c.percorso === `/api/3/${pr}`).map(c => c.corpo);
    assert.deepEqual(post('contact/sync'), [{ contact: { email: 'anna@esempio.it', firstName: 'Anna', lastName: 'Maria Bianchi', phone: '+39 333 1111111' } }]);
    assert.deepEqual(post('contactLists'), [{ contactList: { list: 3, contact: 1, status: 1 } }]);
    assert.deepEqual(post('contactTags'), [{ contactTag: { contact: '1', tag: '12' } }]);
    assert.equal((await clienti(K)).find(r => r.nome === 'Anna Maria Bianchi').consenso, false);
    await coda(K); assert.equal(post('contactLists').length, 1);   // il consenso tolto da ActiveCampaign non torna indietro
    // in Kubo: Carla nuova con il consenso (sync, lista, tag); cambia il telefono (niente secondo tag); poi il consenso tolto → status 2
    const carla = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Carla Neri', email: 'carla@esempio.it', consenso: true })).json; await coda(K);
    assert.equal(post('contact/sync').at(-1).contact.email, 'carla@esempio.it'); assert.deepEqual(post('contactLists').at(-1), { contactList: { list: 3, contact: 2, status: 1 } });
    await K.chiama('PATCH', `/api/dati/clienti/${carla.id}`, { telefono: '+39 333 2222222' }); await coda(K);
    assert.equal(post('contact/sync').length, 3); assert.equal(post('contactTags').length, 2);
    await K.chiama('PATCH', `/api/dati/clienti/${carla.id}`, { consenso: false }); await coda(K);
    assert.deepEqual(post('contactLists').at(-1), { contactList: { list: 3, contact: 2, status: 2 } }); assert.equal(post('contact/sync').length, 3);
    // la lista sbagliata si vede dalla prova
    await accendi(K, 'activecampaign', { base: S.url, segreti: { token: chiave }, impostazioni: { url: 'https://bottega.api-us1.com', lista: '4' } });
    assert.equal((await K.chiama('POST', '/api/connettori/activecampaign/prova')).json.messaggio, 'La lista 4 non c\'è');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Zoho CRM: data center, token rinnovato, cliente → Contact (upsert per Email) e Account con P.IVA, Contacts cambiati → clienti con If-Modified-Since', async () => {
  const { default: man } = await import('../connettori/zoho-crm/connettore.js');
  assert.equal(man.oauth.token({ imp: { regione: 'eu' }, base: '' }), 'https://accounts.zoho.eu/oauth/v2/token');
  assert.equal(man.oauth.autorizza({ imp: { regione: 'com' }, base: '' }), 'https://accounts.zoho.com/oauth/v2/auth');
  assert.equal(man.oauth.token({ imp: { regione: 'ca' }, base: '' }), 'https://accounts.zohocloud.ca/oauth/v2/token');
  // «accounts-server» del ritorno e «api_domain» del token (k.oauth.extra()) vincono sulla regione, solo se sono domini di Zoho
  const { zbase } = await import('../connettori/zoho-crm/connettore.js'), conX = x => ({ imp: { regione: 'com' }, base: '', oauth: { extra: () => x } });
  assert.deepEqual(man.oauth.conserva, ['accounts-server', 'location', 'api_domain']);
  assert.equal(man.oauth.token(conX({ 'accounts-server': 'https://accounts.zoho.eu' })), 'https://accounts.zoho.eu/oauth/v2/token');
  assert.equal(man.oauth.token(conX({ 'accounts-server': 'https://accounts.zohocloud.ca' })), 'https://accounts.zohocloud.ca/oauth/v2/token');
  assert.equal(man.oauth.token(conX({ 'accounts-server': 'https://accounts.zoho.eu.evil.example' })), 'https://accounts.zoho.com/oauth/v2/token');
  assert.equal(man.oauth.autorizza(conX({ 'accounts-server': 'https://accounts.zoho.eu' })), 'https://accounts.zoho.com/oauth/v2/auth');   // l'autorizzazione resta sulla regione scelta
  assert.equal(zbase(conX({ api_domain: 'https://www.zohoapis.in' })), 'https://www.zohoapis.in/crm/v8');
  assert.equal(zbase(conX({ api_domain: 'https://evil.example/www.zohoapis.in' })), 'https://www.zohoapis.com/crm/v8');
  assert.equal(zbase(conX({})), 'https://www.zohoapis.com/crm/v8');
  const K = await kubo(['negozio']); let n = 0; const upsert = [], aziende = [];
  const contatti = [{ id: '7001', Email: 'Giulia@Esempio.it', First_Name: 'Giulia', Last_Name: 'Rossi', Phone: '+39 347 2222222', Modified_Time: '2026-10-08T10:00:00+02:00' }];
  const S = await finto({
    'POST /oauth/v2/token': () => ({ access_token: 'tok-zoho', expires_in: 3600, api_domain: 'https://www.zohoapis.eu', token_type: 'Bearer' }),
    'GET /crm/v8/Contacts': (p, c, { q, intestazioni }) => {
      const dopo = intestazioni['if-modified-since'], d = q.get('per_page') === '1' ? [] : contatti.filter(x => !dopo || Date.parse(x.Modified_Time) > Date.parse(dopo));
      return d.length ? { data: d, info: { per_page: 200, count: d.length, page: 1, more_records: false } } : { stato: dopo ? 304 : 204, corpo: '' };
    },
    'POST /crm/v8/Accounts/upsert': (p, c) => { aziende.push(c); return { data: [{ code: 'SUCCESS', status: 'success', action: 'insert', details: { id: 'A900' } }] }; },
    'POST /crm/v8/Contacts/upsert': (p, c) => { upsert.push(c); return { data: c.data.map(() => ({ code: 'SUCCESS', status: 'success', action: 'insert', duplicate_field: null, details: { id: `C${++n}` } })) }; },
  });
  try {
    await accendi(K, 'zoho-crm', { base: S.url, segreti: { client_id: '1000.FINTO', client_secret: 'segreto-finto' }, impostazioni: { regione: 'eu' } });
    const u = new URL((await K.chiama('POST', '/api/connettori/zoho-crm/oauth/inizio', { base: 'http://127.0.0.1:9' })).json.url);
    assert.equal(u.origin + u.pathname, `${S.url}/oauth/v2/auth`);
    assert.equal(u.searchParams.get('scope'), 'ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.accounts.ALL'); assert.equal(u.searchParams.get('access_type'), 'offline');
    // il ritorno porta accounts-server e location, il token api_domain: tutto in k.oauth.extra()
    const rz = await K.chiama('GET', `/api/connettori/zoho-crm/oauth/ritorno?state=${u.searchParams.get('state')}&code=c-zoho&location=eu&accounts-server=${encodeURIComponent('https://accounts.zoho.eu')}`);
    assert.match(rz.intestazioni.get('location'), /oauth=ok/);
    assert.deepEqual(K.nucleo.k('zoho-crm').oauth.extra(), { 'accounts-server': 'https://accounts.zoho.eu', location: 'eu', api_domain: 'https://www.zohoapis.eu' });
    // il token salvato è scaduto: si rinnova con il refresh_token sul data center
    K.nucleo.k('zoho-crm').salvaSegreto('_oauth', JSON.stringify({ access_token: 'vecchio', refresh_token: 'r-zoho', scade: Date.now() - 1000 }));
    const p = (await K.chiama('POST', '/api/connettori/zoho-crm/prova')).json;
    assert.equal(p.ok, true, JSON.stringify(p)); assert.match(p.messaggio, /eu/);
    const t = S.chiamate.filter(c => c.percorso === '/oauth/v2/token').at(-1);
    assert.equal(t.corpo.grant_type, 'refresh_token'); assert.equal(t.corpo.refresh_token, 'r-zoho'); assert.equal(t.corpo.client_id, '1000.FINTO');
    // un cliente con la P.IVA: Account e poi Contact collegato
    const c = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Ferramenta Bassi', email: 'Info@Bassi.it', telefono: '+39 02 123456', tipo: 'azienda', piva: '01234567890', indirizzo: 'Via Roma 1, Milano' })).json;
    await coda(K);
    assert.deepEqual(aziende[0], { data: [{ Account_Name: 'Ferramenta Bassi', Phone: '+39 02 123456', Billing_Street: 'Via Roma 1, Milano', Description: 'P.IVA 01234567890' }], duplicate_check_fields: ['Account_Name'], trigger: [] });
    assert.deepEqual(upsert[0], { data: [{ Email: 'info@bassi.it', First_Name: 'Ferramenta', Last_Name: 'Bassi', Phone: '+39 02 123456', Account_Name: { id: 'A900' } }], duplicate_check_fields: ['Email'], trigger: [] });
    assert.equal(S.chiamate.find(x => x.percorso === '/crm/v8/Contacts/upsert').intestazioni.authorization, 'Zoho-oauthtoken tok-zoho');
    assert.equal(K.nucleo.k('zoho-crm').sincro.remoto('clienti', c.id), 'C1');
    // un cliente con un nome solo: va in Last_Name (obbligatorio in Zoho)
    await K.chiama('POST', '/api/dati/clienti', { nome: 'Mario', email: 'mario@esempio.it' }); await coda(K);
    assert.deepEqual(upsert.at(-1).data, [{ Email: 'mario@esempio.it', Last_Name: 'Mario' }]);
    // Zoho → Kubo: il contatto cambiato diventa un cliente; il giro dopo manda If-Modified-Since e non riscrive niente
    const g = (await K.chiama('POST', '/api/connettori/zoho-crm/giri/contatti')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.deepEqual(g.risultato, { creati: 1, aggiornati: 0, uguali: 0 });
    const giulia = (await clienti(K)).find(r => r.email === 'giulia@esempio.it');
    assert.equal(giulia.nome, 'Giulia Rossi'); assert.equal(giulia.telefono, '+39 347 2222222');
    assert.deepEqual((await K.chiama('POST', '/api/connettori/zoho-crm/giri/contatti')).json.risultato, { creati: 0, aggiornati: 0, uguali: 0 });
    assert.equal(S.chiamate.filter(x => x.percorso === '/crm/v8/Contacts' && x.q.per_page === '200').at(-1).intestazioni['if-modified-since'], '2026-10-08T10:00:00+02:00');
    await coda(K); assert.equal(upsert.length, 2);   // quello che arriva da Zoho non torna indietro
    // l'azione per Lumi: tutti i clienti con email in un solo upsert
    assert.equal((await K.chiama('POST', '/api/connettori/zoho-crm/azioni/invia_tutti', { args: {}, anteprima: true })).json.titolo, 'Clienti verso Zoho CRM');
    const a = (await K.chiama('POST', '/api/connettori/zoho-crm/azioni/invia_tutti', { args: {} })).json;
    assert.equal(a.risultato?.contatti ?? a.contatti, 3, JSON.stringify(a)); assert.equal(upsert.at(-1).data.length, 3);
  } finally { await K.chiudi(); await S.chiudi(); }
});
