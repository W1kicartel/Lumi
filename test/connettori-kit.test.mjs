// Il kit dei connettori, giro 4: verifiche GET e risposte su misura dei webhook, multipart, OAuth (basic, JSON, senza PKCE,
// valori in più, redirect su misura, device code), indirizzo pubblico, input facoltativi degli strumenti di Lumi,
// k.sincro.scollega, nomi degli strumenti senza collisioni, pulizia di coda ed eventi, controlli di sicurezza.
// Un connettore «di terzi» scritto al volo in una cartella temporanea; i servizi sono finti e locali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { istanze } from '../server/moduli/connettori.js';
import { finto } from './connettori-finto.mjs';

// Kubo su file (servono le cartelle dei dati) con i connettori locali { id: sorgente }, accesi e approvati
async function kuboCon(connettori = {}, modelli = ['negozio']) {
  const dir = mkdtempSync(join(tmpdir(), 'kubo-kit-'));
  for (const [id, src] of Object.entries(connettori)) { mkdirSync(join(dir, 'connettori', id), { recursive: true }); writeFileSync(join(dir, 'connettori', id, 'connettore.js'), src); }
  const db = apri(join(dir, 'kubo.db')), srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (m, p, c, h = {}) => {
    const r = await fetch(base + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}), ...h }, body: c ? JSON.stringify(c) : undefined });
    const s = r.headers.get('set-cookie'); if (s) biscotto = s.split(';')[0];
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { } return { stato: r.status, json, testo: t, intestazioni: r.headers };
  };
  await chiama('POST', '/api/configura', { azienda: 'B', nome: 'T', email: 't@esempio.it', password: 'prova-kubo-1', modelli });
  const n = istanze.get(db); await n.pronti;
  for (const id of Object.keys(connettori)) {
    const c = (await chiama('GET', `/api/connettori/${id}`)).json;
    const x = await chiama('PUT', `/api/connettori/${id}`, { attivo: true, somma: c.somma, interni: true }); assert.equal(x.stato, 200, JSON.stringify(x.json));
  }
  return { base, chiama, db, n, dir, esci: () => { biscotto = ''; }, chiudi: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
// una richiesta «da fuori»: niente sessione né X-Kubo
const fuori = (K, m, p, corpo, h = {}) => fetch(K.base + p, { method: m, headers: h, body: corpo }).then(async r => ({ stato: r.status, testo: await r.text(), tipo: r.headers.get('content-type') }));

test('webhook: verifica GET, risposta su misura, stato su misura per la firma sbagliata, multipart con file', async () => {
  const K = await kuboCon({ prova: `export default { id: 'prova', nome: 'Prova', permessi: {},
    impostazioni: [{ id: 'codice', nome: 'Codice', segreto: true, generato: true }],
    entrata: { firma: { tipo: 'token', segreto: 'codice' },
      verificaGet: (q, k) => (q.get('sfida') ? { testo: q.get('sfida') } : { stato: 400, testo: 'manca la sfida' }),
      risposta: ({ esito, q }) => (q.get('validationToken') ? { tipo: 'text/plain', testo: q.get('validationToken') } : { tipo: 'text/xml', testo: '<Response/>' }),
      rispostaFirma: { stato: 403, testo: 'no' },
      gestisci: (ev, k) => { globalThis.eventoProva = ev; return 'ok'; } } };` });
  try {
    const codice = K.n.segreto('prova', 'codice');
    // GET: senza il codice giusto non si arriva alla verifica
    assert.equal((await fuori(K, 'GET', '/api/connettori/prova/in?sfida=x')).stato, 401);
    assert.equal((await fuori(K, 'GET', '/api/connettori/prova/in/sbagliato?sfida=x')).stato, 401);
    const s = await fuori(K, 'GET', `/api/connettori/prova/in/${codice}?sfida=abc123`); assert.equal(s.stato, 200); assert.equal(s.testo, 'abc123'); assert.match(s.tipo, /text\/plain/);
    assert.equal((await fuori(K, 'GET', `/api/connettori/prova/in/${codice}`)).stato, 400);
    // un connettore senza verificaGet: GET non esiste
    assert.equal((await fuori(K, 'GET', '/api/connettori/stripe/in')).stato, 404);
    // firma sbagliata: lo stato che vuole il servizio
    const no = await fuori(K, 'POST', '/api/connettori/prova/in/sbagliato', '{}', { 'Content-Type': 'application/json' }); assert.equal(no.stato, 403); assert.equal(no.testo, 'no');
    // multipart/form-data: i campi in UTF-8, il file solo descritto
    const b = 'XyZ123', corpo = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="nome"\r\n\r\nPerò è così\r\n--${b}\r\nContent-Disposition: form-data; name="foto"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from([0x89, 0x50, 0xff, 0x00]), Buffer.from(`\r\n--${b}--\r\n`)]);
    const r = await fuori(K, 'POST', `/api/connettori/prova/in/${codice}`, corpo, { 'Content-Type': `multipart/form-data; boundary=${b}` });
    assert.equal(r.stato, 200); assert.equal(r.testo, '<Response/>'); assert.match(r.tipo, /text\/xml/);
    assert.equal(globalThis.eventoProva.nome, 'Però è così'); assert.deepEqual(globalThis.eventoProva._file, [{ campo: 'foto', nome: 'a.png', tipo: 'image/png', dimensione: 4 }]);
    // la risposta può dipendere dalla richiesta (Microsoft Graph: validationToken nella query)
    const v = await fuori(K, 'POST', `/api/connettori/prova/in/${codice}?validationToken=tok%20en`, '', { 'Content-Type': 'text/plain' }); assert.equal(v.testo, 'tok en');
    // la pagina dice che c'è la verifica GET
    assert.equal((await K.chiama('GET', '/api/connettori/prova')).json.webhook.verificaGet, true);
  } finally { await K.chiudi(); }
});


test('OAuth: client_secret_basic, corpo JSON, senza PKCE, valori del ritorno e del token in k.oauth.extra(), redirect su misura, device code', async () => {
  const chiamate = [];
  const S = await finto({
    'POST /token': (p, c, { intestazioni }) => {
      chiamate.push({ c, auth: intestazioni.authorization, tipo: intestazioni['content-type'] });
      if (c.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') return chiamate.filter(x => x.c.device_code).length < 2 ? { stato: 400, corpo: { error: 'authorization_pending' } } : { access_token: 'at-dev', expires_in: 3600 };
      return { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, api_domain: 'https://www.zohoapis.eu' };
    },
    'POST /device': (p, c) => { chiamate.push({ c, device: true }); return { data: { device_code: 'dc-1', user_code: 'ABCD-1234', verification_uri: 'https://servizio.example/device', interval: 1, expires_in: 300 } }; },
  });
  const K = await kuboCon({ conto: `export default { id: 'conto', nome: 'Conto', permessi: {},
    impostazioni: [{ id: 'client_id', nome: 'Id', segreto: true }, { id: 'client_secret', nome: 'Segreto', segreto: true }, { id: 'runame', nome: 'RuName' }],
    oauth: { autorizza: k => k.base + '/auth', token: k => k.base + '/token', dispositivo: k => k.base + '/device', scope: 'contabilita', basic: true, corpo: 'json', pkce: false,
      conserva: ['realmId', 'api_domain'], redirect: k => k.imp.runame || null },
    azioni: { extra: { nome: 'Extra', esegui: async (_, k) => ({ extra: k.oauth.extra(), token: await k.oauth.token() }) } } };` });
  try {
    K.n.perProva('conto', { base: S.url });
    assert.equal((await K.chiama('PUT', '/api/connettori/conto', { segreti: { client_id: 'cid', client_secret: 'csec' } })).stato, 200);
    const pag = (await K.chiama('GET', '/api/connettori/conto')).json.oauth; assert.equal(pag.dispositivo, true); assert.equal(pag.ritorno, '/api/connettori/conto/oauth/ritorno');
    const u = new URL((await K.chiama('POST', '/api/connettori/conto/oauth/inizio', { base: K.base })).json.url);
    assert.equal(u.searchParams.get('code_challenge'), null); assert.equal(u.searchParams.get('redirect_uri'), `${K.base}/api/connettori/conto/oauth/ritorno`);
    const r = await fetch(`${K.base}/api/connettori/conto/oauth/ritorno?state=${u.searchParams.get('state')}&code=cod-1&realmId=9130`, { redirect: 'manual' });
    assert.match(r.headers.get('location'), /oauth=ok/);
    const t = chiamate.at(-1); assert.equal(t.auth, 'Basic ' + Buffer.from('cid:csec').toString('base64')); assert.match(t.tipo, /json/);
    assert.deepEqual(t.c, { grant_type: 'authorization_code', code: 'cod-1', redirect_uri: `${K.base}/api/connettori/conto/oauth/ritorno` });   // niente segreto né verificatore nel corpo
    const x = (await K.chiama('POST', '/api/connettori/conto/azioni/extra', { args: {} })).json;
    assert.deepEqual(x.extra, { realmId: '9130', api_domain: 'https://www.zohoapis.eu' }); assert.equal(x.token, 'at-1');
    // il redirect_uri su misura (il RuName di eBay) vale per l'autorizzazione e per lo scambio del codice
    await K.chiama('PUT', '/api/connettori/conto', { impostazioni: { runame: 'Bottega-Kubo-PRD-abc' } });
    const u2 = new URL((await K.chiama('POST', '/api/connettori/conto/oauth/inizio', { base: K.base })).json.url); assert.equal(u2.searchParams.get('redirect_uri'), 'Bottega-Kubo-PRD-abc');
    await fetch(`${K.base}/api/connettori/conto/oauth/ritorno?state=${u2.searchParams.get('state')}&code=cod-2`, { redirect: 'manual' });
    assert.equal(chiamate.at(-1).c.redirect_uri, 'Bottega-Kubo-PRD-abc');
    assert.equal((await K.chiama('POST', '/api/connettori/conto/azioni/extra', { args: {} })).json.extra.realmId, '9130');   // resta dopo un nuovo collegamento
    // device code: la risposta dentro «data» (Fatture in Cloud), il client_id nel corpo JSON, poi l'attesa e il collegamento
    const d = (await K.chiama('POST', '/api/connettori/conto/oauth/dispositivo')).json;
    assert.deepEqual(d, { codice: 'ABCD-1234', indirizzo: 'https://servizio.example/device', intervallo: 2, scade: 300 });
    assert.deepEqual(chiamate.find(c => c.device).c, { client_id: 'cid', scope: 'contabilita' });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/conto/oauth/dispositivo/controlla')).json, { attesa: true });
    assert.deepEqual((await K.chiama('POST', '/api/connettori/conto/oauth/dispositivo/controlla')).json, { collegato: true });
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('indirizzo pubblico unico (k.pubblico), input facoltativi negli strumenti di Lumi, k.sincro.scollega', async () => {
  const K = await kuboCon({ pub: `export default { id: 'pub', nome: 'Pub', permessi: { clienti: { leggi: true } },
    impostazioni: [{ id: 'codice', nome: 'Codice', segreto: true, generato: true }],
    entrata: { firma: { tipo: 'token', segreto: 'codice' }, gestisci: () => 'ok' },
    azioni: { nota: { nome: 'Nota', su: 'clienti', lumi: true, input: { riga: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' }, testo: { tipo: 'testo', nome: 'Il testo', facoltativo: true } },
      esegui: async ({ riga, testo }, k) => ({ cliente: riga.id, testo: testo ?? null, pubblico: k.pubblico }) } } };` });
  try {
    assert.equal((await K.chiama('GET', '/api/connettori/impostazioni')).json.pubblico, '');
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'ftp://kubo.bottega.it' })).stato, 400);
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://kubo.bottega.it/' })).json.pubblico, 'https://kubo.bottega.it');
    const pag = (await K.chiama('GET', '/api/connettori/pub')).json; assert.equal(pag.webhook.url, 'https://kubo.bottega.it/api/connettori/pub/in'); assert.equal(pag.pubblico, 'https://kubo.bottega.it');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi' })).json;
    const x = (await K.chiama('POST', '/api/connettori/pub/azioni/nota', { args: { riga: cl.id } })).json;
    assert.deepEqual(x, { cliente: cl.id, testo: null, pubblico: 'https://kubo.bottega.it' });
    const s = (await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.find(t => t.nome === 'connettore_pub_nota');
    assert.ok(s, 'strumento'); if (s.schema) assert.deepEqual(s.schema.required, ['riga']);
    // scollega: per remoto, per riga, tutta la sezione
    const k = K.n.k('pub'); k.sincro.collega('clienti', cl.id, 'x1'); k.sincro.collega('clienti', 'altra', 'x2'); k.sincro.collega('clienti', 'terza', 'x3');
    assert.equal(k.sincro.scollega('clienti', { remoto: 'x1' }), 1); assert.equal(k.sincro.locale('clienti', 'x1'), null);
    assert.equal(k.sincro.scollega('clienti', { riga: 'altra' }), 1); assert.equal(k.sincro.remoto('clienti', 'altra'), null);
    assert.equal(k.sincro.scollega('clienti'), 1);
    // un collaboratore non cambia l'indirizzo pubblico
    await K.chiama('POST', '/api/utenti', { nome: 'C', email: 'c@esempio.it', password: 'password-lunga', ruolo: 'collaboratore' });
    K.esci(); await K.chiama('POST', '/api/accedi', { email: 'c@esempio.it', password: 'password-lunga' });
    assert.equal((await K.chiama('PUT', '/api/connettori/impostazioni', { pubblico: 'https://altro.example' })).stato, 403);
  } finally { await K.chiudi(); }
});

test('sicurezza: nomi degli strumenti senza collisioni, URL dei ponti mascherati, accesso solo sul sito base, codici corti, CR/LF, pulizia', async () => {
  const S = await finto({ 'POST /v1/link': () => ({ ok: 1 }), 'POST /altro/hook': () => ({ ok: 1 }), 'POST /hooks/catch/123/abc': () => ({ ok: 1 }) });
  const K = await kuboCon({}, ['negozio']);
  const accendiQui = async (id, imp, segreti = {}) => { K.n.perProva(id, {}); const r = await K.chiama('PUT', `/api/connettori/${id}`, { interni: true, impostazioni: imp, segreti, attivo: true }); assert.equal(r.stato, 200, JSON.stringify(r.json)); return r.json; };
  try {
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi' })).json;
    // http con la ricetta «crm_link», la copia http-crm con la ricetta «link»: due strumenti, ognuno al suo connettore
    await accendiQui('http', { base: `${S.url}/v1`, accesso: 'bearer', ricette: [{ id: 'crm_link', nome: 'Link', tipo: 'azione', sezione: 'clienti', metodo: 'POST', percorso: '/link' },
      { id: 'fuori', nome: 'Fuori', tipo: 'azione', sezione: 'clienti', metodo: 'POST', percorso: `${S.url.replace('127.0.0.1', 'localhost')}/altro/hook` }] }, { chiave: 'tok-segreto' });
    assert.equal((await K.chiama('POST', '/api/connettori/http/copie', { nome: 'crm' })).stato, 200);
    await accendiQui('http-crm', { base: `${S.url}/v1`, ricette: [{ id: 'link', nome: 'Link copia', tipo: 'azione', sezione: 'clienti', metodo: 'POST', percorso: '/link' }] });
    const nomi = (await K.chiama('GET', '/api/lumi/strumenti')).json.strumenti.map(x => x.nome);
    assert.ok(nomi.includes('connettore_http_crm_link') && nomi.includes('connettore_http__crm_link'), nomi.filter(n => /http/.test(n)).join());
    assert.equal((await K.chiama('POST', '/api/lumi/strumenti/connettore_http__crm_link/anteprima', { args: { riga: cl.id } })).json.titolo, 'Link copia');
    assert.equal((await K.chiama('POST', '/api/lumi/strumenti/connettore_http_crm_link/anteprima', { args: { riga: cl.id } })).json.titolo, 'Link');
    // deterministici e mai oltre 64 caratteri
    assert.equal(K.n.nomeLumi('http-crm', 'link'), 'connettore_http__crm_link');
    const lungo = K.n.nomeLumi('connettore-con-un-nome-davvero-lungo', 'azione_con_un_nome_altrettanto_lungo');
    assert.ok(lungo.length <= 64 && /_[0-9a-f]{8}$/.test(lungo)); assert.equal(K.n.nomeLumi('connettore-con-un-nome-davvero-lungo', 'azione_con_un_nome_altrettanto_lungo'), lungo);
    assert.notEqual(K.n.nomeLumi('http', 'a-b'), K.n.nomeLumi('http', 'a_b'));
    // l'accesso (Bearer) va solo al sito base: la ricetta con un indirizzo completo altrove parte senza, finché il titolare non lo dice
    const chiama = async () => { await K.chiama('POST', '/api/connettori/http/azioni/fuori', { args: { riga: cl.id } }); return S.chiamate.at(-1); };
    assert.equal((await chiama()).intestazioni.authorization, undefined);
    await K.chiama('POST', '/api/connettori/http/azioni/crm_link', { args: { riga: cl.id } }); assert.equal(S.chiamate.at(-1).intestazioni.authorization, 'Bearer tok-segreto');
    const imp = (await K.chiama('GET', '/api/connettori/http')).json.impostazioni.find(i => i.id === 'ricette').valore;
    await K.chiama('PUT', '/api/connettori/http', { impostazioni: { ricette: imp.map(r => (r.id === 'fuori' ? { ...r, conAccesso: true } : r)) } });
    assert.equal((await chiama()).intestazioni.authorization, 'Bearer tok-segreto');
    // CR/LF nelle intestazioni in più: rifiutate al salvataggio
    assert.equal((await K.chiama('PUT', '/api/connettori/http', { impostazioni: { intestazioni: { 'X-Prova': 'a\r\nX-Altro: b' } } })).stato, 400);
    assert.equal((await K.chiama('PUT', '/api/connettori/http', { impostazioni: { intestazioni: { 'X-Prova': 'una riga' } } })).stato, 200);
    // codici in fondo all'indirizzo scelti dal titolare: almeno 16 caratteri
    const corto = await K.chiama('PUT', '/api/connettori/http', { segreti: { codice: 'corto' } }); assert.equal(corto.stato, 400); assert.match(corto.json.errore, /16/);
    assert.equal((await K.chiama('PUT', '/api/connettori/http', { segreti: { codice: 'un-codice-abbastanza-lungo' } })).stato, 200);
    // un ponte (Zapier): l'indirizzo dell'hook lo vede solo il titolare
    await accendiQui('zapier', { ricette: [{ id: 'zap', nome: 'Zap', tipo: 'azione', sezione: 'clienti', metodo: 'POST', percorso: `${S.url}/hooks/catch/123/abc` }] });
    const tit = (await K.chiama('POST', '/api/connettori/zapier/azioni/zap', { args: { riga: cl.id }, anteprima: true })).json;
    assert.match(tit.righe[1][1], /\/hooks\/catch\/123\/abc$/);
    await K.chiama('POST', '/api/utenti', { nome: 'C', email: 'c@esempio.it', password: 'password-lunga', ruolo: 'collaboratore' });
    K.esci(); await K.chiama('POST', '/api/accedi', { email: 'c@esempio.it', password: 'password-lunga' });
    const col = await K.chiama('POST', '/api/connettori/zapier/azioni/zap', { args: { riga: cl.id }, anteprima: true });
    assert.equal(col.stato, 200, JSON.stringify(col.json)); assert.equal(col.json.righe[1][1], `${S.url}/…`); assert.ok(!JSON.stringify(col.json).includes('/hooks/catch'));
    // pulizia: consegne finite da più di 30 giorni, eventi da più di 90
    const vecchio = new Date(Date.now() - 40 * 864e5).toISOString(), antico = new Date(Date.now() - 100 * 864e5).toISOString(), ora = new Date().toISOString();
    for (const [stato, quando] of [['fatto', vecchio], ['fatto', ora], ['fallito', vecchio]]) K.db.prepare("INSERT INTO _connettori_coda (connettore, tipo, corpo, stato, prossimo, creato, aggiornato) VALUES ('http', 'x', '{}', ?, 0, ?, ?)").run(stato, quando, quando);
    for (const [c, quando] of [['a', antico], ['b', vecchio]]) K.db.prepare("INSERT INTO _connettori_eventi (connettore, chiave, quando) VALUES ('http', ?, ?)").run(c, quando);
    assert.deepEqual(K.n.pota(), { coda: 1, eventi: 1 });
    assert.equal(K.db.prepare("SELECT COUNT(*) n FROM _connettori_coda WHERE connettore = 'http' AND tipo = 'x'").get().n, 2);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('pagina: i permessi «*» sono «tutte le sezioni»', async () => {
  const K = await kuboCon({ tutto: `export default { id: 'tutto', nome: 'Tutto', permessi: { '*': { leggi: true } } };` });
  try {
    const p = (await K.chiama('GET', '/api/connettori/tutto')).json.permessi;
    assert.deepEqual(p, [{ entita: '*', tutte: true, leggi: true }]);
  } finally { await K.chiudi(); }
});
