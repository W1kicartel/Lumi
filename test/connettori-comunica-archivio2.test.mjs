// Archivi e attività in più (Box, pCloud, ClickUp, Microsoft To Do, Google Tasks) contro finti servizi locali:
// la fattura salvata nella cartella dell'anno, il backup notturno con la rotazione, i compiti da Lumi e dalle righe nuove.
// Niente rete vera, dati inventati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, gestionale, accendi } from './connettori-finto.mjs';
import { coda } from './connettori-comunica-coda.mjs';
import pcloud from '../connettori/pcloud/connettore.js';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email: 'rossi@cliente.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
const collega = (K, id) => K.nucleo.k(id).salvaSegreto('_oauth', JSON.stringify({ access_token: 'tok', refresh_token: 'r', scade: Date.now() + 36e5 }));
// i campi di un corpo multipart/form-data: [{ nome, file, tipo, valore }]
const parti = corpo => [...corpo.matchAll(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?\r\n(?:Content-Type: ([^\r]+)\r\n)?\r\n([\s\S]*?)\r\n--/g)].map(m => ({ nome: m[1], file: m[2], tipo: m[3], valore: m[4] }));
const VECCHI = ['lumi-2026-01-01-02-30-00.db', 'lumi-2026-01-02-02-30-00.db', 'lumi-2026-01-03-02-30-00.db'];

test('Box: cartelle per id (il 409 dà quella che c\'è), fattura multipart, nuova versione se il file c\'è, backup con rotazione', async () => {
  const K = await gestionale(['negozio', 'fatture']);
  // il Box finto: cartelle e file per id, la radice è «0»; Lumi/Backup c'è già con tre backup vecchi e un appunto
  const voci = [{ id: 'd1', name: 'Lumi', parent: '0', cartella: true }, { id: 'd2', name: 'Backup', parent: 'd1', cartella: true },
    ...[...VECCHI, 'appunti.txt'].map((n, i) => ({ id: `v${i}`, name: n, parent: 'd2' }))];
  let n = 0; const versioni = [], tolti = [];
  const S = await finto({
    'POST /2.0/folders': (p, c) => {
      const c0 = voci.find(v => v.cartella && v.parent === c.parent.id && v.name === c.name);
      if (c0) return { stato: 409, corpo: { type: 'error', status: 409, code: 'item_name_in_use', context_info: { conflicts: [{ type: 'folder', id: c0.id, name: c0.name }] } } };
      const v = { id: `d${100 + ++n}`, name: c.name, parent: c.parent.id, cartella: true }; voci.push(v); return { stato: 201, corpo: { type: 'folder', id: v.id } };
    },
    'POST /api/2.0/files/content': (p, c) => {
      const [a, f] = parti(c), at = JSON.parse(a.valore), x = voci.find(v => !v.cartella && v.parent === at.parent.id && v.name === at.name);
      if (x) return { stato: 409, corpo: { type: 'error', status: 409, code: 'item_name_in_use', context_info: { conflicts: { type: 'file', id: x.id } } } };
      const v = { id: `f${++n}`, name: at.name, parent: at.parent.id, file: f }; voci.push(v); return { stato: 201, corpo: { total_count: 1, entries: [{ type: 'file', id: v.id, name: v.name }] } };
    },
    'POST /api/2.0/files/:id/content': (p, c) => { versioni.push({ id: p.id, attributi: JSON.parse(parti(c)[0].valore) }); return { total_count: 1, entries: [{ type: 'file', id: p.id }] }; },
    'GET /2.0/folders/:id/items': p => { const e = voci.filter(v => v.parent === p.id).map(v => ({ type: v.cartella ? 'folder' : 'file', id: v.id, name: v.name })); return { total_count: e.length, entries: e, offset: 0, limit: 1000 }; },
    'DELETE /2.0/files/:id': p => { tolti.push(voci.find(v => v.id === p.id).name); voci.splice(voci.findIndex(v => v.id === p.id), 1); return { stato: 204, corpo: '' }; },
    'GET /2.0/users/me': () => ({ type: 'user', id: '11446498', login: 'titolare@bottega.example' }),
  });
  try {
    await accendi(K, 'box', { base: S.url, segreti: { client_id: 'cid', client_secret: 'sec' }, impostazioni: { tieni: 2 } });
    const ub = new URL((await K.chiama('POST', '/api/connettori/box/oauth/inizio', { base: K.base })).json.url);   // Box non ha PKCE
    assert.equal(ub.origin + ub.pathname, 'https://account.box.com/api/oauth2/authorize'); assert.equal(ub.searchParams.get('code_challenge'), null);
    assert.equal((await K.chiama('POST', '/api/connettori/box/prova')).json.ok, false);   // non ancora collegato
    collega(K, 'box');
    assert.equal((await K.chiama('POST', '/api/connettori/box/prova')).json.messaggio, 'titolare@bottega.example');
    const f = await fattura(K);
    const r = await K.chiama('POST', '/api/connettori/box/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.cartella, 'Lumi/Fatture/2026');
    // «Lumi» c'era (409 con l'id), Fatture e 2026 sono nuove
    const anno = voci.find(v => v.name === '2026'), fatture = voci.find(v => v.name === 'Fatture');
    assert.equal(fatture.parent, 'd1'); assert.equal(anno.parent, fatture.id);
    const file = voci.filter(v => v.parent === anno.id); assert.deepEqual(file.map(v => v.name.split('.').pop()), ['html', 'xml']);
    const up = S.chiamate.find(c => c.percorso === '/api/2.0/files/content');
    assert.match(up.intestazioni['content-type'], /^multipart\/form-data; boundary=lumi/); assert.equal(up.intestazioni.authorization, 'Bearer tok');
    const [a, b] = parti(up.corpo); assert.equal(a.nome, 'attributes'); assert.equal(b.nome, 'file'); assert.equal(b.file, file[0].name); assert.match(b.tipo, /^text\/html/); assert.match(b.valore, /<html/i);
    assert.match(file[1].file.valore, /FatturaElettronica/);
    // di nuovo: nessun doppione, due nuove versioni sui file che ci sono
    assert.equal((await K.chiama('POST', '/api/connettori/box/azioni/salva_documento', { args: { fattura: f.id } })).stato, 200);
    assert.equal(voci.filter(v => v.parent === anno.id).length, 2); assert.deepEqual(versioni.map(v => v.id), file.map(v => v.id));
    assert.equal(versioni[0].attributi.name, file[0].name);
    // il backup: caricato in Lumi/Backup, poi restano i 2 più recenti (il nuovo e il 3 gennaio); l'appunto non si tocca
    const g = (await K.chiama('POST', '/api/connettori/box/giri/backup')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.match(g.risultato.caricato, /^lumi-[\d-]+\.db$/); assert.equal(g.risultato.tolti, 2);
    const nuovo = voci.find(v => v.name === g.risultato.caricato); assert.equal(nuovo.parent, 'd2'); assert.ok(nuovo.file.valore.startsWith('SQLite format 3'));
    assert.deepEqual(tolti.sort(), VECCHI.slice(0, 2)); assert.ok(voci.some(v => v.name === 'appunti.txt'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('pCloud: regione UE/USA, codice scambiato su oauth2_token (token senza scadenza), cartelle create un livello alla volta, backup', async () => {
  // la regione decide l'host, anche per lo scambio del codice
  assert.equal(pcloud.oauth.token({ imp: {} }), 'https://eapi.pcloud.com/oauth2_token');
  assert.equal(pcloud.oauth.token({ imp: { regione: 'api.pcloud.com' } }), 'https://api.pcloud.com/oauth2_token');   // un collegamento di prima
  // l'host del ritorno dell'autorizzazione (hostname, in k.oauth.extra()) vince, ma solo se è uno dei due di pCloud
  const conX = (hostname, regione) => ({ imp: regione ? { regione } : {}, oauth: { extra: () => ({ hostname }) } });
  assert.equal(pcloud.oauth.token(conX('api.pcloud.com')), 'https://api.pcloud.com/oauth2_token');
  assert.equal(pcloud.oauth.token(conX('eapi.pcloud.com', 'api.pcloud.com')), 'https://eapi.pcloud.com/oauth2_token');
  assert.equal(pcloud.oauth.token(conX('evil.example')), 'https://eapi.pcloud.com/oauth2_token');
  assert.equal(pcloud.oauth.pkce, false); assert.deepEqual(pcloud.oauth.conserva, ['hostname']); assert.ok(!pcloud.impostazioni.some(i => i.id === 'regione'));
  const K = await gestionale(['negozio', 'fatture']);
  const cartelle = new Map([['/', 0], ['/Lumi', 11], ['/Lumi/Backup', 12]]), file = [...VECCHI, 'appunti.txt'].map((n, i) => ({ fileid: 500 + i, name: n, folderid: 12 }));
  let n = 100; const tolti = [];
  const S = await finto({
    'POST /oauth2_token': (p, c) => (c.code === 'codice-1' && c.client_id === 'cid' && c.client_secret === 'sec' ? { result: 0, access_token: 'tokpc', token_type: 'bearer', uid: 42, locationid: 2 } : { result: 2012, error: 'Invalid code.' }),
    'GET /userinfo': (p, c, { intestazioni }) => (intestazioni.authorization === 'Bearer tokpc' ? { result: 0, email: 'titolare@bottega.example', locationid: 2 } : { result: 2000, error: 'Log in failed.' }),
    'GET /createfolderifnotexists': (p, c, { q }) => {
      const via = q.get('path'), padre = via.replace(/\/[^/]+$/, '') || '/';
      if (!cartelle.has(padre)) return { result: 2002, error: 'A component of parent directory does not exist.' };
      if (!cartelle.has(via)) cartelle.set(via, ++n);
      return { result: 0, created: true, metadata: { folderid: cartelle.get(via), name: via.split('/').pop(), isfolder: true } };
    },
    'POST /uploadfile': (p, c, { q }) => { const [f] = parti(c), x = { fileid: ++n, name: q.get('filename'), folderid: Number(q.get('folderid')), parte: f }; file.push(x); return { result: 0, fileids: [x.fileid], metadata: [{ name: x.name, fileid: x.fileid }] }; },
    'GET /listfolder': (p, c, { q }) => { const id = cartelle.get(q.get('path')); if (id == null) return { result: 2005, error: 'Directory does not exist.' };
      return { result: 0, metadata: { folderid: id, contents: file.filter(f => f.folderid === id).map(f => ({ name: f.name, fileid: f.fileid, isfolder: false })) } }; },
    'GET /deletefile': (p, c, { q }) => { const i = file.findIndex(f => f.fileid === Number(q.get('fileid'))); tolti.push(file[i].name); file.splice(i, 1); return { result: 0 }; },
  });
  try {
    await accendi(K, 'pcloud', { base: S.url, segreti: { client_id: 'cid', client_secret: 'sec' }, impostazioni: { tieni: 2 } });
    // il giro OAuth: l'autorizzazione su my.pcloud.com, il ritorno scambia il codice; il token non scade
    const ini = (await K.chiama('POST', '/api/connettori/pcloud/oauth/inizio', { base: K.base })).json, u = new URL(ini.url);
    assert.equal(u.origin + u.pathname, 'https://my.pcloud.com/oauth2/authorize'); assert.equal(u.searchParams.get('client_id'), 'cid');
    const rit = await K.chiama('GET', `/api/connettori/pcloud/oauth/ritorno?code=codice-1&state=${u.searchParams.get('state')}&locationid=2&hostname=eapi.pcloud.com`);
    assert.equal(rit.stato, 302); assert.match(rit.intestazioni.get('location'), /oauth=ok$/);
    assert.equal(u.searchParams.get('code_challenge'), null); assert.equal(S.chiamate.find(c => c.percorso === '/oauth2_token').corpo.code_verifier, undefined);   // niente PKCE
    assert.deepEqual(K.nucleo.k('pcloud').oauth.extra(), { hostname: 'eapi.pcloud.com' });
    const { tipo, collegato, scade, rinnovo } = (await K.chiama('GET', '/api/connettori/pcloud')).json.oauth; assert.deepEqual({ tipo, collegato, scade, rinnovo }, { tipo: 'codice', collegato: true, scade: null, rinnovo: false });
    assert.equal((await K.chiama('POST', '/api/connettori/pcloud/prova')).json.messaggio, 'titolare@bottega.example');
    const f = await fattura(K);
    const r = await K.chiama('POST', '/api/connettori/pcloud/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    assert.deepEqual(S.chiamate.filter(c => c.percorso === '/createfolderifnotexists').map(c => c.q.path), ['/Lumi', '/Lumi/Fatture', '/Lumi/Fatture/2026', '/Lumi', '/Lumi/Fatture', '/Lumi/Fatture/2026']);
    const su = file.filter(x => x.folderid === cartelle.get('/Lumi/Fatture/2026')); assert.equal(su.length, 2);
    assert.match(su[0].name, /\.html$/); assert.equal(su[0].parte.file, su[0].name); assert.match(su[0].parte.valore, /<html/i); assert.match(su[1].parte.valore, /FatturaElettronica/);
    const up = S.chiamate.find(c => c.percorso === '/uploadfile');
    assert.equal(up.intestazioni.authorization, 'Bearer tokpc'); assert.equal(up.q.nopartial, '1'); assert.equal(up.q.access_token, undefined);   // il token non va nell'indirizzo
    // il backup e la rotazione: restano il nuovo e il 3 gennaio, l'appunto resta
    const g = (await K.chiama('POST', '/api/connettori/pcloud/giri/backup')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.equal(g.risultato.tolti, 2);
    assert.deepEqual(tolti.sort(), VECCHI.slice(0, 2)); assert.ok(file.find(x => x.name === g.risultato.caricato && x.folderid === 12).parte.valore.startsWith('SQLite format 3'));
    // un errore di pCloud (HTTP 200 con result ≠ 0) diventa un messaggio chiaro
    cartelle.delete('/');
    const e = await K.chiama('POST', '/api/connettori/pcloud/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(e.stato, 502); assert.match(JSON.stringify(e.json), /errore 2002/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('ClickUp: token pk_ così com\'è, Lumi crea il compito con la scadenza in millisecondi, un\'attività nuova diventa un compito una volta', async () => {
  const K = await gestionale(['professionista']); let n = 0;
  const S = await finto({
    'GET /api/v2/list/:id': p => (p.id === '901234567' ? { id: p.id, name: 'Lavori' } : { stato: 404, corpo: { err: 'List not found', ECODE: 'SUBCAT_016' } }),
    'POST /api/v2/list/:id/task': (p, c) => ({ id: `86a${++n}`, name: c.name, url: `https://app.clickup.com/t/86a${n}` }),
  });
  try {
    const token = 'pk_' + '12345678_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    await accendi(K, 'clickup', { base: S.url, segreti: { token }, impostazioni: { lista: '901234567', da_attivita: true, pubblico: 'https://lumi.bottega.it' } });
    assert.equal((await K.chiama('POST', '/api/connettori/clickup/prova')).json.messaggio, 'Lista «Lavori»');
    assert.equal(S.chiamate[0].intestazioni.authorization, token);   // senza «Bearer»
    const args = { nome: 'Ordinare il materiale', note: 'Viti e tasselli', scadenza: '20/10/2026' };
    const ant = (await K.chiama('POST', '/api/connettori/clickup/azioni/crea_compito', { args, anteprima: true })).json;
    assert.deepEqual(ant.righe[1], ['Scadenza', '2026-10-20']); assert.deepEqual(ant.avvisi, []); assert.equal(S.chiamate.length, 1);
    const a = (await K.chiama('POST', '/api/connettori/clickup/azioni/crea_compito', { args })).json;
    assert.equal(a.ok, true); assert.equal(a.id, '86a1'); assert.equal(a.link, 'https://app.clickup.com/t/86a1');
    const t = S.chiamate.find(c => c.metodo === 'POST');
    assert.equal(t.percorso, '/api/v2/list/901234567/task'); assert.equal(t.intestazioni.authorization, token);
    assert.deepEqual(t.corpo, { name: 'Ordinare il materiale', description: 'Viti e tasselli', due_date: Date.parse('2026-10-20T12:00:00Z'), due_date_time: false });
    // una scadenza a parole non passa: lo dice l'anteprima
    assert.match((await K.chiama('POST', '/api/connettori/clickup/azioni/crea_compito', { args: { nome: 'X', scadenza: 'venerdì' }, anteprima: true })).json.avvisi[0], /non chiara/);
    // un'attività nuova → un compito con note e link; modificarla non ne crea un altro
    const riga = (await K.chiama('POST', '/api/dati/attivita', { titolo: 'Preparare l\'offerta', scadenza: '2026-10-22', note: 'Per lo studio Bianchi' })).json;
    await coda(K);
    const u = S.chiamate.filter(c => c.metodo === 'POST').at(-1).corpo;
    assert.equal(u.name, 'Preparare l\'offerta'); assert.equal(u.due_date, Date.parse('2026-10-22T12:00:00Z'));
    assert.ok(u.description.includes(`https://lumi.bottega.it/#/e/attivita/${riga.id}`));
    assert.equal(K.nucleo.k('clickup').sincro.remoto('attivita', riga.id), '86a2');
    await K.chiama('PATCH', `/api/dati/attivita/${riga.id}`, { note: 'cambiata' }); await coda(K);
    assert.equal(S.chiamate.filter(c => c.metodo === 'POST').length, 2);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Microsoft To Do: device code verso il tenant con Tasks.ReadWrite, la lista per nome o la predefinita, dueDateTime nel fuso di Lumi', async () => {
  const K = await gestionale(['professionista']), messi = [];
  const S = await finto({
    'POST /consumers/oauth2/v2.0/devicecode': () => ({ device_code: 'dc', user_code: 'WXYZ-9876', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900 }),
    'POST /consumers/oauth2/v2.0/token': (p, c) => (c.grant_type === 'urn:ietf:params:oauth:grant-type:device_code' && c.device_code === 'dc' ? { access_token: 'tokms', refresh_token: 'r', expires_in: 3600 } : { stato: 400, corpo: { error: 'invalid_grant' } }),
    'GET /v1.0/me/todo/lists': () => ({ value: [{ id: 'AAMkL1', displayName: 'Attività', wellknownListName: 'defaultList' }, { id: 'AAMkL2', displayName: 'Negozio', wellknownListName: 'none' }] }),
    'POST /v1.0/me/todo/lists/:id/tasks': (p, c, { intestazioni }) => { messi.push({ lista: p.id, corpo: c, auth: intestazioni.authorization }); return { stato: 201, corpo: { id: `AAMkT${messi.length}`, title: c.title } }; },
  });
  try {
    await accendi(K, 'microsoft-todo', { base: S.url, segreti: { client_id: 'app' }, impostazioni: { tenant: 'consumers', da_attivita: true } });
    // non collegato: l'anteprima lo dice
    assert.match((await K.chiama('POST', '/api/connettori/microsoft-todo/azioni/crea_compito', { args: { titolo: 'Prova' }, anteprima: true })).json.avvisi.join(), /non è ancora collegato/);
    const d = await K.chiama('POST', '/api/connettori/microsoft-todo/oauth/dispositivo'); assert.equal(d.stato, 200, JSON.stringify(d.json)); assert.equal(d.json.codice, 'WXYZ-9876');
    assert.equal(S.chiamate[0].corpo.scope, 'offline_access Tasks.ReadWrite'); assert.equal(S.chiamate[0].corpo.client_id, 'app');
    assert.equal((await K.chiama('POST', '/api/connettori/microsoft-todo/oauth/dispositivo/controlla')).json.collegato, true);
    assert.equal((await K.chiama('POST', '/api/connettori/microsoft-todo/prova')).json.messaggio, 'Lista «Attività»');
    const a = (await K.chiama('POST', '/api/connettori/microsoft-todo/azioni/crea_compito', { args: { titolo: 'Rinnovare l\'assicurazione', scadenza: '2026-10-30', lista: 'negozio', note: 'Polizza del furgone' } })).json;
    assert.equal(a.ok, true); assert.equal(a.id, 'AAMkT1'); assert.equal(a.lista, 'Negozio');
    assert.equal(messi[0].lista, 'AAMkL2'); assert.equal(messi[0].auth, 'Bearer tokms');
    assert.deepEqual(messi[0].corpo, { title: 'Rinnovare l\'assicurazione', body: { content: 'Polizza del furgone', contentType: 'text' }, dueDateTime: { dateTime: '2026-10-30T00:00:00', timeZone: K.nucleo.k('microsoft-todo').fuso() } });
    // una lista che non c'è: errore chiaro, nessun compito
    const x = await K.chiama('POST', '/api/connettori/microsoft-todo/azioni/crea_compito', { args: { titolo: 'X', lista: 'Ufficio' } });
    assert.equal(x.stato, 502); assert.match(JSON.stringify(x.json), /Ufficio/); assert.equal(messi.length, 1);
    // un'attività nuova va nella lista predefinita
    const riga = (await K.chiama('POST', '/api/dati/attivita', { titolo: 'Inventario di fine mese', scadenza: '2026-10-31' })).json;
    await coda(K);
    assert.equal(messi.length, 2); assert.equal(messi[1].lista, 'AAMkL1'); assert.equal(messi[1].corpo.title, 'Inventario di fine mese'); assert.equal(messi[1].corpo.dueDateTime.dateTime, '2026-10-31T00:00:00');
    assert.equal(K.nucleo.k('microsoft-todo').sincro.remoto('attivita', riga.id), 'AAMkT2');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Google Tasks: la lista per nome o @default, due in RFC 3339 (conta la data), un\'attività nuova diventa un compito', async () => {
  const K = await gestionale(['professionista']), messi = [];
  const S = await finto({
    'GET /tasks/v1/users/@me/lists': () => ({ kind: 'tasks#taskLists', items: [{ id: 'MDEx', title: 'I miei compiti' }, { id: 'MDEy', title: 'Bottega' }] }),
    'POST /tasks/v1/lists/:id/tasks': (p, c, { intestazioni }) => { messi.push({ lista: decodeURIComponent(p.id), corpo: c, auth: intestazioni.authorization }); return { id: `tk${messi.length}`, title: c.title, webViewLink: `https://tasks.google.com/task/tk${messi.length}` }; },
  });
  try {
    await accendi(K, 'google-tasks', { base: S.url, segreti: { client_id: 'c', client_secret: 's' }, impostazioni: { da_attivita: true } });
    assert.match((await K.chiama('POST', '/api/connettori/google-tasks/azioni/crea_compito', { args: { titolo: 'Prova' }, anteprima: true })).json.avvisi.join(), /non è ancora collegato/);
    collega(K, 'google-tasks');
    assert.equal((await K.chiama('POST', '/api/connettori/google-tasks/prova')).json.messaggio, '2 liste');
    const ant = (await K.chiama('POST', '/api/connettori/google-tasks/azioni/crea_compito', { args: { titolo: 'Chiamare il commercialista', scadenza: '2026-10-15', lista: 'Bottega' }, anteprima: true })).json;
    assert.deepEqual(ant.avvisi, []); assert.deepEqual(ant.righe[2], ['Lista', 'Bottega']);
    const a = (await K.chiama('POST', '/api/connettori/google-tasks/azioni/crea_compito', { args: { titolo: 'Chiamare il commercialista', scadenza: '2026-10-15', lista: 'bottega', note: 'Per il 730' } })).json;
    assert.equal(a.ok, true); assert.equal(a.id, 'tk1'); assert.equal(a.lista, 'Bottega'); assert.equal(a.link, 'https://tasks.google.com/task/tk1');
    assert.equal(messi[0].lista, 'MDEy'); assert.equal(messi[0].auth, 'Bearer tok');
    assert.deepEqual(messi[0].corpo, { title: 'Chiamare il commercialista', notes: 'Per il 730', due: '2026-10-15T00:00:00.000Z' });
    // un'attività nuova va in @default, senza cercare le liste
    const prima = S.chiamate.length;
    const riga = (await K.chiama('POST', '/api/dati/attivita', { titolo: 'Rinnovo del dominio', scadenza: '2026-11-02', note: 'Scade il .it' })).json;
    await coda(K);
    assert.equal(messi.length, 2); assert.equal(messi[1].lista, '@default'); assert.equal(S.chiamate.length, prima + 1);
    assert.equal(messi[1].corpo.due, '2026-11-02T00:00:00.000Z'); assert.match(messi[1].corpo.notes, /Scade il \.it/);
    assert.equal(K.nucleo.k('google-tasks').sincro.remoto('attivita', riga.id), 'tk2');
  } finally { await K.chiudi(); await S.chiudi(); }
});
