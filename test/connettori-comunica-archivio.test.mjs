// I connettori di archivio cloud (Google Drive, Dropbox, OneDrive, S3, WebDAV) contro finti servizi locali:
// la fattura salvata (stampa HTML + XML FatturaPA) nella cartella dell'anno, il backup notturno con la rotazione,
// la firma AWS SigV4 controllata con i vettori ufficiali e dal finto S3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi } from './connettori-finto.mjs';
import { firmaV4 } from '../connettori/_comunica/sigv4.js';
import { coda } from './connettori-comunica-coda.mjs';

const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K, { stato = 'emessa' } = {}) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email: 'rossi@cliente.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  if (stato === 'bozza') return f;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
const collega = (K, id) => K.nucleo.k(id).salvaSegreto('_oauth', JSON.stringify({ access_token: 'tok', refresh_token: 'r', scade: Date.now() + 36e5 }));

test('SigV4: i vettori ufficiali AWS (get-vanilla e GET Object di S3)', () => {
  const a = firmaV4({ url: 'https://example.amazonaws.com/', regione: 'us-east-1', servizio: 'service', chiave: 'AKIDEXAMPLE', segreto: 'wJalrXUtnFEMI/' + 'K7MDENG+bPxRfiCYEXAMPLEKEY', ora: new Date('2015-08-30T12:36:00Z') });
  assert.equal(a.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(a['x-amz-date'], '20150830T123600Z'); assert.equal(a['x-amz-content-sha256'], undefined);
  const b = firmaV4({ url: 'https://examplebucket.s3.amazonaws.com/test.txt', intestazioni: { Range: 'bytes=0-9' }, regione: 'us-east-1', servizio: 's3', chiave: 'AKIA' + 'IOSFODNN7EXAMPLE', segreto: 'wJalrXUtnFEMI/' + 'K7MDENG/bPxRfiCYEXAMPLEKEY', ora: new Date('2013-05-24T00:00:00Z') });
  assert.equal(b.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIA' + 'IOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(b['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('Google Drive: la fattura in Kubo/Fatture/2026 (cartelle create una volta, multipart, un secondo salvataggio aggiorna)', async () => {
  const K = await kubo(['negozio', 'fatture']), voci = [];   // il Drive finto: { id, name, parent, cartella, corpo }
  const nome = q => /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'"), padre = q => /'([^']+)' in parents/.exec(q)?.[1];
  const S = await finto({
    'GET /drive/v3/files': (p, c, { q }) => { const x = q.get('q'), n = nome(x), pa = padre(x), solo = /mimeType = 'application\/vnd.google-apps.folder'/.test(x);
      return { files: voci.filter(v => v.parent === pa && (!n || v.name === n) && (!solo || v.cartella) && (!/mimeType != /.test(x) || !v.cartella)).map(v => ({ id: v.id, name: v.name })) }; },
    'POST /drive/v3/files': (p, c) => { const v = { id: `c${voci.length + 1}`, name: c.name, parent: c.parents[0], cartella: true }; voci.push(v); return { id: v.id }; },
    'POST /upload/drive/v3/files': (p, c) => { const m = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(c)[1]), v = { id: `f${voci.length + 1}`, name: m.name, parent: m.parents[0], corpo: c }; voci.push(v); return { id: v.id }; },
    'PATCH /upload/drive/v3/files/:id': (p, c) => { voci.find(v => v.id === p.id).corpo = c; return { id: p.id }; },
  });
  try {
    await accendi(K, 'google-drive', { base: S.url, segreti: { client_id: 'c', client_secret: 's' } });
    const f = await fattura(K);
    // non collegato: l'anteprima lo dice
    assert.match((await K.chiama('POST', '/api/connettori/google-drive/azioni/salva_documento', { args: { fattura: f.id }, anteprima: true })).json.avvisi[0], /non è ancora collegato/);
    collega(K, 'google-drive');
    const ant = (await K.chiama('POST', '/api/connettori/google-drive/azioni/salva_documento', { args: { fattura: f.id }, anteprima: true })).json;
    assert.deepEqual(ant.avvisi, []); assert.deepEqual(ant.righe[1], ['Cartella', 'Kubo/Fatture/2026']); assert.match(ant.righe[2][1], /\.html, .*\.xml$/);
    assert.equal(S.chiamate.length, 0);   // l'anteprima non tocca Drive
    const r = await K.chiama('POST', '/api/connettori/google-drive/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.cartella, 'Kubo/Fatture/2026'); assert.equal(r.json.file.length, 2);
    assert.deepEqual(voci.filter(v => v.cartella).map(v => v.name), ['Kubo', 'Fatture', '2026']);
    const file = voci.filter(v => !v.cartella); assert.equal(file.length, 2); assert.ok(file.every(v => v.parent === 'c3'));
    const up = S.chiamate.find(c => c.percorso === '/upload/drive/v3/files');
    assert.equal(up.q.uploadType, 'multipart'); assert.match(up.intestazioni['content-type'], /^multipart\/related; boundary=/); assert.equal(up.intestazioni.authorization, 'Bearer tok');
    assert.match(file[0].corpo, /<html/i); assert.match(file[1].corpo, /FatturaElettronica/); assert.match(file[1].corpo, /Content-Type: application\/xml/);
    // di nuovo: stesse cartelle, i file si aggiornano con PATCH
    assert.equal((await K.chiama('POST', '/api/connettori/google-drive/azioni/salva_documento', { args: { fattura: f.id } })).stato, 200);
    assert.equal(voci.length, 5); assert.equal(S.chiamate.filter(c => c.metodo === 'PATCH').length, 2);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Dropbox: fattura con Dropbox-API-Arg, backup notturno che tiene gli ultimi N', async () => {
  const K = await kubo(['negozio', 'fatture']), caricati = [], tolti = [];
  const vecchi = ['kubo-2026-01-01-02-30-00.db', 'kubo-2026-01-02-02-30-00.db', 'kubo-2026-01-03-02-30-00.db', 'appunti.txt'];
  const S = await finto({
    'POST /2/files/upload': (p, c, { intestazioni }) => { const a = JSON.parse(intestazioni['dropbox-api-arg']); caricati.push({ ...a, corpo: c, tipo: intestazioni['content-type'] }); return { id: `id:${caricati.length}`, name: a.path.split('/').pop() }; },
    'POST /2/files/list_folder': (p, c) => (c.path === '/Kubo/Backup' ? { entries: [{ '.tag': 'folder', name: 'vecchi', path_lower: '/kubo/backup/vecchi' }, ...vecchi.map(n => ({ '.tag': 'file', name: n, path_lower: `/kubo/backup/${n}` }))], has_more: true, cursor: 'c1' } : { stato: 409, corpo: { error_summary: 'path/not_found/' } }),
    'POST /2/files/list_folder/continue': () => ({ entries: caricati.filter(x => x.path.startsWith('/Kubo/Backup/')).map(x => ({ '.tag': 'file', name: x.path.split('/').pop(), path_lower: x.path.toLowerCase() })), has_more: false }),
    'POST /2/files/delete_v2': (p, c) => { tolti.push(c.path); return { metadata: {} }; },
  });
  try {
    await accendi(K, 'dropbox', { base: S.url, segreti: { client_id: 'app' }, impostazioni: { tieni: 2 } });
    collega(K, 'dropbox');
    const f = await fattura(K);
    const r = await K.chiama('POST', '/api/connettori/dropbox/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    assert.equal(caricati.length, 2); assert.match(caricati[0].path, /^\/Kubo\/Fatture\/2026\/.+\.html$/); assert.equal(caricati[0].mode, 'overwrite'); assert.equal(caricati[0].tipo, 'application/octet-stream');
    assert.match(caricati[1].path, /\.xml$/);
    // il backup: una copia vera del database, poi restano i 2 più recenti (quello appena caricato e il 3 gennaio)
    const g = (await K.chiama('POST', '/api/connettori/dropbox/giri/backup')).json;
    assert.equal(g.esito, 'ok', JSON.stringify(g)); assert.match(g.risultato.caricato, /^kubo-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/); assert.ok(g.risultato.byte > 1000);
    const b = caricati.at(-1); assert.equal(b.path, `/Kubo/Backup/${g.risultato.caricato}`); assert.ok(b.corpo.startsWith('SQLite format 3'));
    assert.deepEqual(tolti.sort(), ['/kubo/backup/kubo-2026-01-01-02-30-00.db', '/kubo/backup/kubo-2026-01-02-02-30-00.db']); assert.equal(g.risultato.tolti, 2);
    // backup spento: niente
    await K.chiama('PUT', '/api/connettori/dropbox', { impostazioni: { backup: false } });
    assert.equal((await K.chiama('POST', '/api/connettori/dropbox/giri/backup')).json.risultato.saltato, 'backup spento');
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('OneDrive: device code verso il tenant, la fattura emessa si salva da sola (uscita), la bozza no', async () => {
  const K = await kubo(['negozio', 'fatture']), messi = [];
  const S = await finto({
    'POST /devicecode': (p, c) => ({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900, _scope: c.scope }),
    'POST /token': (p, c) => (c.grant_type === 'urn:ietf:params:oauth:grant-type:device_code' && c.device_code === 'dc' && !c.client_secret ? { access_token: 'tok', refresh_token: 'r', expires_in: 3600 } : { stato: 400, corpo: { error: 'invalid_grant' } }),
    'PUT /v1.0/me/drive/root\\:/:a/:b/:c/:d/content': (p, c, { intestazioni }) => { messi.push({ via: decodeURIComponent(`${p.a}/${p.b}/${p.c}/${p.d}/content`), tipo: intestazioni['content-type'], auth: intestazioni.authorization, corpo: c }); return { stato: 201, corpo: { id: `i${messi.length}` } }; },
  });
  try {
    await accendi(K, 'onedrive', { base: S.url, segreti: { client_id: 'app' }, impostazioni: { automatico: true } });
    const d = await K.chiama('POST', '/api/connettori/onedrive/oauth/dispositivo'); assert.equal(d.stato, 200, JSON.stringify(d.json)); assert.equal(d.json.codice, 'ABCD-1234');
    assert.equal(S.chiamate[0].corpo.scope, 'Files.ReadWrite offline_access'); assert.equal(S.chiamate[0].corpo.client_id, 'app');
    assert.equal((await K.chiama('POST', '/api/connettori/onedrive/oauth/dispositivo/controlla')).json.collegato, true);
    const b = await fattura(K, { stato: 'bozza' }); await coda(K);
    assert.equal(messi.length, 0);   // la bozza non parte
    assert.equal((await K.chiama('PATCH', `/api/dati/fatture/${b.id}`, { stato: 'emessa' })).stato, 200); await coda(K);
    assert.equal(messi.length, 2, JSON.stringify(S.chiamate.map(c => c.percorso)));
    assert.match(messi[0].via, /^Kubo\/Fatture\/2026\/.+\.html:\/content$/); assert.equal(messi[0].auth, 'Bearer tok'); assert.match(messi[0].tipo, /^text\/html/);
    assert.match(messi[1].via, /\.xml:\/content$/); assert.match(messi[1].corpo, /FatturaElettronica/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('S3: PUT path-style con firma SigV4 verificata dal finto, backup con ListObjectsV2 e DeleteObject', async () => {
  const K = await kubo(['negozio', 'fatture']), oggetti = new Map(), firme = [];
  const verifica = (metodo, percorso, q, h, corpo) => {
    const url = `${S.url}${percorso}${Object.keys(q).length ? '?' + new URLSearchParams(q) : ''}`, d = h['x-amz-date'];
    const ora = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
    const atteso = firmaV4({ metodo, url, intestazioni: h['content-type'] ? { 'Content-Type': h['content-type'] } : {}, hashCorpo: h['x-amz-content-sha256'], regione: 'eu-south-1', servizio: 's3', chiave: 'AKIAKUBO', segreto: 'segretissimo', ora });
    firme.push(h.authorization === atteso.Authorization && (corpo === null || h['x-amz-content-sha256'] === firmaV4({ url, corpo, regione: 'x', servizio: 's3', chiave: 'a', segreto: 'b' })['x-amz-content-sha256']));
  };
  const S = await finto({
    'PUT /archivio/:a/:b/:c/:d': (p, c, { intestazioni: h }) => { const k = [p.a, p.b, p.c, decodeURIComponent(p.d)].join('/'); verifica('PUT', `/archivio/${p.a}/${p.b}/${p.c}/${p.d}`, {}, h, k.endsWith('.db') ? null : c); oggetti.set(k, c); return { stato: 200, corpo: '' }; },
    'PUT /archivio/:a/:b/:d': (p, c, { intestazioni: h }) => { verifica('PUT', `/archivio/${p.a}/${p.b}/${p.d}`, {}, h, null); oggetti.set([p.a, p.b, decodeURIComponent(p.d)].join('/'), c); return { stato: 200, corpo: '' }; },
    'GET /archivio': (p, c, { q, intestazioni: h }) => { verifica('GET', '/archivio', Object.fromEntries(q), h, ''); const pre = q.get('prefix') || '';
      return { stato: 200, intestazioni: { 'Content-Type': 'application/xml' }, corpo: `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${[...oggetti.keys(), 'Kubo/Backup/kubo-2025-12-31-02-30-00.db', 'Kubo/Backup/vecchi/kubo-2020-01-01-02-30-00.db'].filter(x => x.startsWith(pre)).map(x => `<Contents><Key>${x}</Key></Contents>`).join('')}</ListBucketResult>` }; },
    'DELETE /archivio/:a/:b/:c': (p, c, { intestazioni: h }) => { verifica('DELETE', `/archivio/${p.a}/${p.b}/${p.c}`, {}, h, ''); oggetti.delete([p.a, p.b, p.c].join('/')); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 's3', { base: S.url, segreti: { chiave: 'AKIAKUBO', segreto: 'segretissimo' }, impostazioni: { bucket: 'archivio', regione: 'eu-south-1', tieni: 1 } });
    assert.equal((await K.chiama('POST', '/api/connettori/s3/prova')).json.ok, true);
    const f = await fattura(K);
    const r = await K.chiama('POST', '/api/connettori/s3/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    const chiavi = [...oggetti.keys()]; assert.equal(chiavi.length, 2); assert.ok(chiavi.every(c => c.startsWith('Kubo/Fatture/2026/')));
    const put = S.chiamate.find(c => c.metodo === 'PUT'); assert.match(put.intestazioni.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAKUBO\/\d{8}\/eu-south-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    const g = (await K.chiama('POST', '/api/connettori/s3/giri/backup')).json; assert.equal(g.esito, 'ok', JSON.stringify(g));
    assert.ok(oggetti.has(`Kubo/Backup/${g.risultato.caricato}`)); assert.equal(g.risultato.tolti, 1);   // il 2025 se ne va, la sottocartella non si tocca
    assert.ok(S.chiamate.some(c => c.metodo === 'DELETE' && c.percorso === '/archivio/Kubo/Backup/kubo-2025-12-31-02-30-00.db'));
    assert.ok(firme.length >= 5); assert.ok(firme.every(Boolean), JSON.stringify(firme));
    // una firma sbagliata (altro segreto) non coincide
    assert.notEqual(firmaV4({ url: `${S.url}/archivio`, regione: 'eu-south-1', servizio: 's3', chiave: 'AKIAKUBO', segreto: 'altro' }).Authorization, put.intestazioni.authorization);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('WebDAV: Basic, MKCOL delle cartelle mancanti dopo un 409, PROPFIND per la rotazione dei backup', async () => {
  const K = await kubo(['negozio', 'fatture']), cartelle = new Set(['/dav']), file = new Map(), tolti = [];
  const su = p => p.replace(/\/+$/, '').split('/').slice(0, -1).join('/');
  const S = await finto({
    'MKCOL /dav/:a/': p => { cartelle.add(`/dav/${p.a}`); return { stato: 201, corpo: '' }; },
    'MKCOL /dav/:a/:b/': p => (cartelle.has(`/dav/${p.a}/${p.b}`) ? { stato: 405, corpo: '' } : (cartelle.add(`/dav/${p.a}/${p.b}`), { stato: 201, corpo: '' })),
    'MKCOL /dav/:a/:b/:c/': p => { cartelle.add(`/dav/${p.a}/${p.b}/${p.c}`); return { stato: 201, corpo: '' }; },
    'PUT /dav/:a/:b/:c/:d': (p, c, { intestazioni }) => { const x = `/dav/${p.a}/${p.b}/${p.c}/${p.d}`; if (intestazioni.authorization !== 'Basic ' + Buffer.from('anna:app-pass').toString('base64')) return { stato: 401, corpo: '' };
      if (!cartelle.has(su(x))) return { stato: 409, corpo: '' }; file.set(decodeURIComponent(x), c); return { stato: 201, corpo: '' }; },
    'PUT /dav/:a/:b/:c': (p, c) => { const x = `/dav/${p.a}/${p.b}/${p.c}`; if (!cartelle.has(su(x))) return { stato: 409, corpo: '' }; file.set(decodeURIComponent(x), c); return { stato: 201, corpo: '' }; },
    'PROPFIND /dav/:a/:b/': (p, c, { intestazioni }) => { assert.equal(intestazioni.depth, '1');
      const r = (h, cart) => `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:resourcetype>${cart ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`;
      const dentro = [...file.keys(), '/dav/Kubo/Backup/kubo-2026-01-01-02-30-00.db'].filter(x => su(x) === `/dav/${p.a}/${p.b}`);
      return { stato: 207, intestazioni: { 'Content-Type': 'application/xml' }, corpo: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${r(`/dav/${p.a}/${p.b}/`, true)}${r(`/dav/${p.a}/${p.b}/vecchi/`, true)}${dentro.map(x => r(x.split('/').map(encodeURIComponent).join('/'))).join('')}</d:multistatus>` }; },
    'DELETE /dav/:a/:b/:c': p => { tolti.push(`/dav/${p.a}/${p.b}/${decodeURIComponent(p.c)}`); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 'webdav', { base: `${S.url}/dav/`, segreti: { password: 'app-pass' }, impostazioni: { indirizzo: 'https://cloud.esempio.it/remote.php/dav/files/anna/', utente: 'anna', tieni: 1 } });
    const f = await fattura(K);
    const r = await K.chiama('POST', '/api/connettori/webdav/azioni/salva_documento', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json));
    assert.ok(cartelle.has('/dav/Kubo/Fatture/2026'));
    assert.deepEqual(S.chiamate.filter(c => c.metodo === 'MKCOL').map(c => c.percorso), ['/dav/Kubo/', '/dav/Kubo/Fatture/', '/dav/Kubo/Fatture/2026/']);
    assert.equal([...file.keys()].filter(x => x.startsWith('/dav/Kubo/Fatture/2026/')).length, 2);
    const g = (await K.chiama('POST', '/api/connettori/webdav/giri/backup')).json; assert.equal(g.esito, 'ok', JSON.stringify(g));
    assert.ok(file.has(`/dav/Kubo/Backup/${g.risultato.caricato}`)); assert.ok(file.get(`/dav/Kubo/Backup/${g.risultato.caricato}`).startsWith('SQLite format 3'));
    assert.deepEqual(tolti, ['/dav/Kubo/Backup/kubo-2026-01-01-02-30-00.db']);
    // password sbagliata: un messaggio chiaro
    await K.chiama('PUT', '/api/connettori/webdav', { segreti: { password: 'no' } });
    const e = await K.chiama('POST', '/api/connettori/webdav/azioni/salva_documento', { args: { fattura: f.id } });
    assert.notEqual(e.stato, 200); assert.match(e.json.errore, /password per app/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Un\'altra sezione con righe (preventivi abbinati a «documenti»): solo la stampa in Kubo/Preventivi/<anno>', async () => {
  const K = await kubo(['professionista']), caricati = [];
  const S = await finto({ 'POST /2/files/upload': (p, c, { intestazioni }) => { caricati.push({ ...JSON.parse(intestazioni['dropbox-api-arg']), corpo: c }); return { id: 'id:1' }; } });
  try {
    await accendi(K, 'dropbox', { base: S.url, segreti: { client_id: 'app' } });
    assert.equal((await K.chiama('PUT', '/api/connettori/dropbox', { mappe: { entita: { documenti: 'preventivi' } } })).stato, 200);
    collega(K, 'dropbox');
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Studio Verdi' })).json;
    const pv = (await K.chiama('POST', '/api/dati/preventivi', { cliente: cl.id, data: '2025-11-20', oggetto: 'Sito nuovo', voci: [{ descrizione: 'Progetto', quantita: 1, prezzo: 800 }] })).json;
    assert.ok(pv.id, JSON.stringify(pv));
    const ant = (await K.chiama('POST', '/api/connettori/dropbox/azioni/salva_altro', { args: { documento: pv.id }, anteprima: true })).json;
    assert.deepEqual(ant.righe[1], ['Cartella', 'Kubo/Preventivi/2025']);
    const r = await K.chiama('POST', '/api/connettori/dropbox/azioni/salva_altro', { args: { documento: pv.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(caricati.length, 1);
    assert.match(caricati[0].path, /^\/Kubo\/Preventivi\/2025\/.+\.html$/); assert.match(caricati[0].corpo, /Sito nuovo|Progetto/);
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('Google Drive: un backup oltre 5 MB passa dal caricamento resumable (Location + PUT), poi la rotazione', async () => {
  const K = await kubo(['negozio']), voci = [{ id: 'c1', name: 'Kubo', parent: 'root', cartella: true }, { id: 'c2', name: 'Backup', parent: 'c1', cartella: true },
    { id: 'v1', name: 'kubo-2026-01-01-02-30-00.db', parent: 'c2' }, { id: 'v2', name: 'kubo-2026-01-02-02-30-00.db', parent: 'c2' }], tolti = [];
  const S = await finto({
    'GET /drive/v3/files': (p, c, { q }) => { const x = q.get('q'), n = /name = '([^']*)'/.exec(x)?.[1], pa = /'([^']+)' in parents/.exec(x)?.[1];
      return { files: voci.filter(v => v.parent === pa && (!n || v.name === n) && (!/mimeType = 'application\/vnd.google-apps.folder'/.test(x) || v.cartella) && (!/mimeType != /.test(x) || !v.cartella)).map(v => ({ id: v.id, name: v.name })) }; },
    'POST /upload/drive/v3/files': (p, c, { q, intestazioni }) => { assert.equal(q.get('uploadType'), 'resumable'); assert.ok(Number(intestazioni['x-upload-content-length']) > 5 * 1048576);
      voci.push({ id: 'nuovo', name: c.name, parent: c.parents[0] }); return { stato: 200, intestazioni: { Location: `${S.url}/sessione/nuovo` }, corpo: '' }; },
    'PUT /sessione/:id': (p, c) => { voci.find(v => v.id === p.id).corpo = c; return { id: p.id }; },
    'DELETE /drive/v3/files/:id': p => { tolti.push(p.id); return { stato: 204, corpo: '' }; },
  });
  try {
    await accendi(K, 'google-drive', { base: S.url, segreti: { client_id: 'c', client_secret: 's' }, impostazioni: { tieni: 2 } }); collega(K, 'google-drive');
    K.db.exec('CREATE TABLE zavorra (b BLOB); INSERT INTO zavorra VALUES (randomblob(6000000))');
    const g = (await K.chiama('POST', '/api/connettori/google-drive/giri/backup')).json; assert.equal(g.esito, 'ok', JSON.stringify(g));
    assert.ok(g.risultato.byte > 6e6); assert.ok(voci.find(v => v.id === 'nuovo').corpo.startsWith('SQLite format 3'));
    assert.deepEqual(tolti, ['v1']);
  } finally { await K.chiudi(); await S.chiudi(); }
});
