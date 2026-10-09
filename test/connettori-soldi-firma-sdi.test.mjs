// I connettori di firma e fatturazione elettronica (Yousign, A-Cube, Invoicetronic), contro finti servizi locali.
// Nessuna chiamata vera in rete, nessuna chiave vera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';
import * as X from '../server/moduli/documenti-xml.js';
import yousign from '../connettori/yousign/connettore.js';
import acube from '../connettori/acube/connettore.js';
import invoicetronic from '../connettori/invoicetronic/connettore.js';

const LINGUE = ['en', 'es', 'fr', 'de', 'pt'];
test('catalogo e testi: le voci obbligatorie, le traduzioni di passi e serve, le cinque lingue', () => {
  for (const m of [yousign, acube, invoicetronic]) {
    const c = m.catalogo, n = m.id;
    assert.ok(['firma', 'fatturazione'].includes(c.categoria), n); assert.match(c.sito, /^https:\/\//, n);
    assert.ok(['gratis', 'a-consumo', 'abbonamento', 'contratto'].includes(c.costo), n); assert.ok(c.costoNota.length > 10, n);
    assert.ok(c.serve.length >= 1 && c.serve.every(s => s.cosa && s.dove && /^https:\/\//.test(s.link)), n);
    assert.ok(c.passi.length >= 3 && c.passi.length <= 8, n); assert.ok(['facile', 'media', 'difficile'].includes(c.difficolta), n);
    assert.ok(c.zone.length && c.zone.every(z => ['IT', 'UE', 'mondo'].includes(z)), n); assert.ok(c.fonti.length && c.fonti.every(f => /^https:\/\//.test(f)), n);
    assert.equal(c.prova, 'finto'); assert.ok(c.parole.length >= 3, n);
    const en = m.testi.en; assert.equal(en['cat.passi'].length, c.passi.length, n); assert.equal(en['cat.serve'].length, c.serve.length, n);
    assert.ok(en['cat.serve'].every(s => s.cosa && s.dove), n); assert.ok(en['cat.costoNota'], n);
    const chiavi = ['descrizione', ...m.impostazioni.map(i => `imp.${i.id}`), ...Object.keys(m.azioni || {}).map(a => `az.${a}`), ...Object.keys(m.pianificati || {}).map(g => `giro.${g}`)];
    for (const l of LINGUE) for (const ch of chiavi) assert.ok(m.testi[l]?.[ch], `${n} ${l} ${ch}`);
  }
});

// ---------- Yousign ----------
const preventivo = async (K, cliente, oggetto = 'Sito web') => (await K.chiama('POST', '/api/dati/preventivi', { cliente, oggetto, voci: [{ descrizione: 'Progetto grafico', quantita: 1, prezzo: 800 }, { descrizione: 'Sviluppo', quantita: 2, prezzo: 450 }] })).json;
const firmaYs = (s, corpo) => `sha256=${firmaHmacDi(s, corpo, 'hex')}`;

test('Yousign: manda in firma (richiesta, PDF in multipart, firmatario, attivazione), webhook firmato → accettato, replay, firma sbagliata', async () => {
  const K = await kubo(['professionista']);
  const S = await finto({
    'POST /signature_requests': () => ({ id: 'sr-1', status: 'draft' }),
    'POST /signature_requests/:id/documents': () => ({ id: 'doc-1', nature: 'signable_document' }),
    'POST /signature_requests/:id/signers': () => ({ id: 'sig-1' }),
    'POST /signature_requests/:id/activate': () => ({ id: 'sr-1', status: 'ongoing' }),
  });
  try {
    const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Studio Verdi', referente: 'Giulia Maria Verdi', email: 'giulia@verdi.example' })).json;
    const p = await preventivo(K, cl.id); assert.ok(p?.id, JSON.stringify(p)); assert.equal(p.stato, 'bozza');
    await accendi(K, 'yousign', { base: S.url, segreti: { chiave: 'ys_prova_123', webhook: 'segreto-ys' } });
    const ant = (await K.chiama('POST', '/api/connettori/yousign/azioni/firma', { args: { preventivo: p.id }, anteprima: true })).json;
    assert.equal(ant.righe[2][1], 'giulia@verdi.example'); assert.equal(ant.avvisi.length, 0);
    const r = await K.chiama('POST', '/api/connettori/yousign/azioni/firma', { args: { preventivo: p.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.id, 'sr-1'); assert.equal(r.json.firmatario, 'giulia@verdi.example');
    assert.deepEqual(S.chiamate.map(c => c.percorso), ['/signature_requests', '/signature_requests/sr-1/documents', '/signature_requests/sr-1/signers', '/signature_requests/sr-1/activate']);
    assert.ok(S.chiamate.every(c => c.intestazioni.authorization === 'Bearer ys_prova_123'));
    const [sr, doc, sig] = S.chiamate;
    assert.equal(sr.corpo.delivery_mode, 'email'); assert.equal(sr.corpo.timezone, 'Europe/Rome'); assert.equal(sr.corpo.external_id, `kubo-p-${p.id}`);
    assert.match(doc.intestazioni['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(doc.corpo, /name="file"; filename="[\w.-]+\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.4/); assert.match(doc.corpo, /name="nature"\r\n\r\nsignable_document\r\n/);
    assert.match(doc.corpo, /Progetto grafico/); assert.match(doc.corpo, /Firma per accettazione/);
    assert.deepEqual(sig.corpo.info, { first_name: 'Giulia', last_name: 'Maria Verdi', email: 'giulia@verdi.example', locale: 'it' });
    assert.equal(sig.corpo.signature_level, 'electronic_signature'); assert.equal(sig.corpo.fields[0].document_id, 'doc-1'); assert.equal(sig.corpo.fields[0].type, 'signature');
    assert.ok(sig.corpo.fields[0].page >= 1 && sig.corpo.fields[0].y > 0);
    assert.equal((await K.chiama('GET', `/api/dati/preventivi/${p.id}`)).json.stato, 'inviato');
    assert.equal((await K.chiama('POST', '/api/connettori/yousign/azioni/firma', { args: { preventivo: p.id } })).stato, 502);   // già in firma
    // il webhook: firma sbagliata 401, buona → accettato da «Yousign», di nuovo → doppione
    const corpo = JSON.stringify({ event_id: 'ev-1', event_name: 'signature_request.done', event_time: '1760000000', sandbox: true, data: { signature_request: { id: 'sr-1', status: 'done', external_id: `kubo-p-${p.id}` } } });
    assert.equal((await manda(K, '/api/connettori/yousign/in', corpo, { 'X-Yousign-Signature-256': firmaYs('altro', corpo) })).stato, 401);
    assert.equal((await manda(K, '/api/connettori/yousign/in', corpo)).stato, 401);
    const w = await manda(K, '/api/connettori/yousign/in', corpo, { 'X-Yousign-Signature-256': firmaYs('segreto-ys', corpo) });
    assert.equal(w.stato, 200, JSON.stringify(w.json)); assert.match(w.json.esito, /accettato/);
    const dopo = (await K.chiama('GET', `/api/dati/preventivi/${p.id}`)).json; assert.equal(dopo.stato, 'accettato'); assert.equal(dopo.modificato_da, 'servizio:yousign');
    assert.equal((await manda(K, '/api/connettori/yousign/in', corpo, { 'X-Yousign-Signature-256': firmaYs('segreto-ys', corpo) })).json.doppione, true);
    // un rifiuto riconosciuto dall'external_id porta il preventivo a «rifiutato»; un evento qualunque è ignorato
    const p2 = await preventivo(K, cl.id, 'Logo');
    const no = JSON.stringify({ event_id: 'ev-2', event_name: 'signature_request.declined', data: { signature_request: { id: 'sr-9', status: 'declined', external_id: `kubo-p-${p2.id}`, decline_information: { reason: 'Prezzo alto' } } } });
    assert.match((await manda(K, '/api/connettori/yousign/in', no, { 'X-Yousign-Signature-256': firmaYs('segreto-ys', no) })).json.esito, /rifiutato/);
    assert.equal((await K.chiama('GET', `/api/dati/preventivi/${p2.id}`)).json.stato, 'rifiutato');
    const altro = JSON.stringify({ event_id: 'ev-3', event_name: 'signer.notified', data: {} });
    assert.equal((await manda(K, '/api/connettori/yousign/in', altro, { 'X-Yousign-Signature-256': firmaYs('segreto-ys', altro) })).json.esito, 'ignorato');
    // chi firma si può indicare: senza email (né nel cliente né indicata) l'anteprima avvisa e l'invio si ferma prima di chiamare Yousign
    const muto = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Bar Centrale' })).json, p3 = await preventivo(K, muto.id, 'Insegna'), n = S.chiamate.length;
    assert.match((await K.chiama('POST', '/api/connettori/yousign/azioni/firma', { args: { preventivo: p3.id }, anteprima: true })).json.avvisi.join(), /email/);
    assert.equal((await K.chiama('POST', '/api/connettori/yousign/azioni/firma', { args: { preventivo: p3.id } })).stato, 502); assert.equal(S.chiamate.length, n);
    assert.equal((await K.chiama('POST', '/api/connettori/yousign/azioni/firma', { args: { preventivo: p3.id, email: 'marco@bar.example', nome: 'Marco Neri' } })).stato, 200);
    assert.deepEqual(S.chiamate.at(-2).corpo.info, { first_name: 'Marco', last_name: 'Neri', email: 'marco@bar.example', locale: 'it' });
    assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/yousign')).json).includes('ys_prova_123'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

// ---------- fatture (come in connettori.test.mjs) ----------
const AZ = { ragione_sociale: 'Bottega Prova srl', piva: '12345678903', codice_fiscale: '12345678903', regime: 'RF01', via: 'Via dei Mille 10', cap: '20121', comune: 'Milano', provincia: 'MI', email: 'info@bottega.example', iban: 'IT60X0542811101000000123456', aliquota: 22 };
async function fattura(K) {
  assert.equal((await K.chiama('PUT', '/api/documenti/azienda', AZ)).stato, 200);
  await K.chiama('POST', '/api/documenti/prepara');
  const cl = (await K.chiama('POST', '/api/dati/clienti', { nome: 'Rossi srl', piva: '00743110157', via: 'Corso Italia 5', cap: '10121', comune: 'Torino', provincia: 'TO', codice_destinatario: 'ABC1234', email: 'rossi@cliente.example' })).json;
  const f = (await K.chiama('POST', '/api/dati/fatture', { cliente: cl.id, data: '2026-09-01', righe: [{ descrizione: 'Riparazione', quantita: 1, prezzo: 100, aliquota: 22 }] })).json;
  const e = await K.chiama('PATCH', `/api/dati/fatture/${f.id}`, { stato: 'emessa' }); assert.equal(e.stato, 200, JSON.stringify(e.json));
  return e.json;
}
// una fattura passiva: un fornitore inventato che fattura alla Bottega
const FORNITORE = { ragione_sociale: 'Carta & Penne srl', piva: '00743110157', regime: 'RF01', via: 'Via Torino 3', cap: '10121', comune: 'Torino', provincia: 'TO', iban: 'IT60X0542811101000000123456' };
const NOI = { nome: AZ.ragione_sociale, piva: AZ.piva, codice_destinatario: '0000000', via: AZ.via, cap: AZ.cap, comune: AZ.comune, provincia: AZ.provincia };
const passiva = (numero = 'A-77') => X.xml(FORNITORE, { stato: 'emessa', numero, data: '2026-09-15', righe: [{ descrizione: 'Risme di carta', quantita: 10, prezzo: 4.5, aliquota: 22 }] }, NOI).xml;
const ricevute = K => K.db.prepare('SELECT COUNT(*) n FROM d_fatture_ricevute WHERE archiviato = 0').get().n;

test('A-Cube: login JWT in memoria, invio dell\'XML, esiti SDI dal webhook con il codice segreto, passive scaricate e importate', async () => {
  const K = await kubo(['negozio', 'fatture']); let login = 0;
  const S = await finto({
    'POST /login': (p, c) => (c.email === 'amm@bottega.example' && c.password === 'pw-prova' ? { token: `jwt-${++login}` } : { stato: 401, corpo: { message: 'credenziali' } }),
    'POST /invoices': (p, c, { intestazioni }) => (intestazioni.authorization !== 'Bearer jwt-1' ? { stato: 401, corpo: {} }
      : typeof c === 'string' && c.includes('<ImportoTotaleDocumento>122.00<') ? { stato: 202, corpo: { uuid: 'a-1' } } : { stato: 400, corpo: { detail: 'xml' } }),
    'GET /invoices/:uuid': (p, c, { intestazioni }) => (p.uuid === 'p-1' && intestazioni.accept === 'application/xml' && intestazioni.authorization === 'Bearer jwt-1'
      ? { stato: 200, intestazioni: { 'Content-Type': 'application/xml' }, corpo: passiva() } : { stato: 404, corpo: {} }),
  });
  try {
    const f = await fattura(K);
    const pag = await accendi(K, 'acube', { base: S.url, segreti: { password: 'pw-prova' }, impostazioni: { email: 'amm@bottega.example' } });
    const codice = pag.impostazioni.find(i => i.id === 'callback').valore; assert.ok(codice.length > 20);
    const r = await K.chiama('POST', '/api/connettori/acube/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.uuid, 'a-1'); assert.match(r.json.file, /^IT12345678903_\w{5}\.xml$/);
    const inv = S.chiamate.find(c => c.percorso === '/invoices'); assert.equal(inv.intestazioni['content-type'], 'application/xml');
    assert.equal(login, 1); assert.deepEqual(S.chiamate[0].corpo, { email: 'amm@bottega.example', password: 'pw-prova' });
    assert.equal((await K.chiama('POST', '/api/connettori/acube/azioni/invia', { args: { fattura: f.id } })).stato, 502);   // già inviata
    // la notifica di scarto: senza codice o con quello sbagliato 401, con il codice → scartata, di nuovo → doppione
    const ns = JSON.stringify({ notification: { uuid: 'n-1', invoice_uuid: 'a-1', type: 'NS', message: 'Codice destinatario errato', created_at: '2026-09-02T10:00:00Z' } });
    assert.equal((await manda(K, '/api/connettori/acube/in/sbagliato?evento=customer-notification', ns)).stato, 401);
    assert.equal((await manda(K, '/api/connettori/acube/in', ns)).stato, 401);
    const e1 = await manda(K, `/api/connettori/acube/in/${codice}?evento=customer-notification`, ns); assert.equal(e1.stato, 200, JSON.stringify(e1.json)); assert.match(e1.json.esito, /scartata/);
    assert.equal((await manda(K, `/api/connettori/acube/in/${codice}?evento=customer-notification`, ns)).json.doppione, true);
    // senza «?evento=» si riconosce dalla forma: una consegna
    assert.match((await manda(K, `/api/connettori/acube/in/${codice}`, JSON.stringify({ notification: { uuid: 'n-2', invoice_uuid: 'a-1', type: 'RC' } }))).json.esito, /consegnata/);
    // la passiva: si scarica l'XML e si importa, con il fornitore nuovo; il replay è un doppione
    const sup = JSON.stringify({ uuid: 'p-1', created_at: '2026-09-16T08:00:00Z', sender: { business_name: 'Carta & Penne srl' } });
    const e2 = await manda(K, `/api/connettori/acube/in/${codice}?evento=supplier-invoice`, sup); assert.equal(e2.stato, 200, JSON.stringify(e2.json)); assert.match(e2.json.esito, /passiva importata: A-77/);
    assert.equal(ricevute(K), 1); assert.equal(K.db.prepare("SELECT COUNT(*) n FROM d_fornitori WHERE c_piva = '00743110157'").get().n, 1);
    assert.equal((await manda(K, `/api/connettori/acube/in/${codice}?evento=supplier-invoice`, sup)).json.doppione, true);
    // con l'XML già nel corpo non serve scaricarlo
    const prima = S.chiamate.length;
    const e3 = await manda(K, `/api/connettori/acube/in/${codice}?evento=supplier-invoice`, JSON.stringify({ uuid: 'p-2', payload: passiva('A-78') }));
    assert.match(e3.json.esito, /A-78/); assert.equal(S.chiamate.length, prima); assert.equal(ricevute(K), 2);
    assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/acube')).json).includes('pw-prova'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

test('A-Cube: un 401 con il JWT in memoria fa rifare il login una volta; password sbagliata = errore chiaro', async () => {
  const K = await kubo(['negozio', 'fatture']); let login = 0;
  const S = await finto({
    'POST /login': (p, c) => (c.password === 'pw-prova' ? { token: `jwt-${++login}` } : { stato: 401, corpo: {} }),
    'POST /invoices': (p, c, { intestazioni }) => (intestazioni.authorization === `Bearer jwt-${login}` && login > 1 ? { uuid: `a-${login}` } : { stato: 401, corpo: {} }),
  });
  try {
    const f = await fattura(K);
    await accendi(K, 'acube', { base: S.url, segreti: { password: 'pw-prova' }, impostazioni: { email: 'amm@bottega.example' } });
    const r = await K.chiama('POST', '/api/connettori/acube/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.uuid, 'a-2'); assert.equal(login, 2);
    await accendi(K, 'acube', { segreti: { password: 'sbagliata' } });
    const p = await K.chiama('POST', '/api/connettori/acube/prova');
    assert.equal(p.json.ok, false, JSON.stringify(p.json)); assert.match(p.json.messaggio, /email e password/); assert.ok(!JSON.stringify(p.json).includes('sbagliata'));
  } finally { await K.chiudi(); await S.chiudi(); }
});

// ---------- Invoicetronic ----------
test('Invoicetronic: invio con Basic (chiave come utente), giri pianificati di esiti e passive con il cursore', async () => {
  const K = await kubo(['negozio', 'fatture']), basic = `Basic ${Buffer.from('ik_test_prova:').toString('base64')}`;
  const S = await finto({
    'POST /send/xml': (p, c, { intestazioni }) => (intestazioni.authorization === basic && typeof c === 'string' && c.includes('<ImportoTotaleDocumento>122.00<') ? { stato: 201, corpo: { id: 501, file_name: 'x.xml' } } : { stato: 401, corpo: {} }),
    'GET /update': (p, c, { q, intestazioni }) => (intestazioni.authorization !== basic ? { stato: 401, corpo: {} } : q.get('page') !== '1' ? [] : [
      { id: 11, send_id: 501, state: 'Inviato', last_update: '2026-09-02T09:00:00Z' },
      { id: 12, send_id: 501, state: 'Scartato', description: 'Codice destinatario non valido', last_update: '2026-09-02T10:00:00Z' },
      { id: 13, send_id: 999, state: 'Consegnato' }]),
    'GET /receive': (p, c, { q }) => (q.get('include_payload') !== 'true' || q.get('page') !== '1' ? [] : [
      { id: 70, file_name: 'IT00743110157_00A77.xml', encoding: 'Base64', payload: Buffer.from(passiva('A-77')).toString('base64') },
      { id: 71, file_name: 'IT00743110157_00A78.xml', encoding: 'Xml', payload: passiva('A-78') }]),
  });
  try {
    const f = await fattura(K);
    await accendi(K, 'invoicetronic', { base: S.url, segreti: { chiave: 'ik_test_prova' } });
    const r = await K.chiama('POST', '/api/connettori/invoicetronic/azioni/invia', { args: { fattura: f.id } });
    assert.equal(r.stato, 200, JSON.stringify(r.json)); assert.equal(r.json.id, 501);
    assert.equal(S.chiamate[0].percorso, '/send/xml'); assert.equal(S.chiamate[0].intestazioni['content-type'], 'application/xml');
    assert.equal((await K.chiama('POST', '/api/connettori/invoicetronic/azioni/invia', { args: { fattura: f.id } })).stato, 502);   // già inviata
    const g = await K.chiama('POST', '/api/connettori/invoicetronic/giri/esiti');
    assert.deepEqual(g.json.risultato, { esiti: 2, ignote: 1 }, JSON.stringify(g.json));
    const avvisi = K.db.prepare("SELECT * FROM _connettori_registro WHERE connettore = 'invoicetronic'").all().map(x => JSON.stringify(x)).join('\n');
    assert.match(avvisi, /scartata: Codice destinatario non valido/);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/invoicetronic/giri/esiti')).json.risultato, { esiti: 0, ignote: 0 });   // il cursore: niente due volte
    const p = await K.chiama('POST', '/api/connettori/invoicetronic/giri/passive');
    assert.deepEqual(p.json.risultato, { importate: 2, saltate: 0, errori: 0 }, JSON.stringify(p.json)); assert.equal(ricevute(K), 2);
    assert.deepEqual((await K.chiama('POST', '/api/connettori/invoicetronic/giri/passive')).json.risultato, { importate: 0, saltate: 0, errori: 0 });
    assert.ok(!JSON.stringify((await K.chiama('GET', '/api/connettori/invoicetronic')).json).includes('ik_test_prova'));
  } finally { await K.chiudi(); await S.chiudi(); }
});
