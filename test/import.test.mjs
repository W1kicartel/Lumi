import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import * as F from '../server/moduli/import-formati.js';
import { ATTESE, firma } from '../server/moduli/import-api.js';
import { nomeSicuro } from '../server/moduli/import-file.js';

attiva();
ATTESE.splice(0, ATTESE.length, 0.05, 0.05);   // nei test i nuovi tentativi dei webhook non aspettano minuti

async function avvia() {
  const srv = creaServer(apri()); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo, { token, grezzo = false, senzaIntestazione = false } = {}) => {
    const r = await fetch(base + percorso, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined,
      headers: { 'Content-Type': 'application/json', ...(senzaIntestazione || token ? {} : { 'X-Kubo': '1' }), ...(token ? { Authorization: `Bearer ${token}` } : biscotto ? { Cookie: biscotto } : {}) } });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, intestazioni: r.headers, json: grezzo ? null : await r.json().catch(() => null), dati: grezzo ? Buffer.from(await r.arrayBuffer()) : null };
  };
  const carica = async (nome, buf, tipo = '') => {
    const a = await chiama('POST', '/api/file/carica', { nome, tipo, dimensione: buf.length }); assert.equal(a.stato, 200, JSON.stringify(a.json));
    let da = 0, ult; const passo = 7;   // pezzi piccoli apposta, per provare il caricamento a pezzi
    while (da < buf.length) { const p = buf.subarray(da, da + Math.max(passo, Math.ceil(buf.length / 3))); ult = await chiama('POST', `/api/file/carica/${a.json.id}`, { da, pezzo: p.toString('base64') }); assert.equal(ult.stato, 200, JSON.stringify(ult.json)); da += p.length; }
    assert.equal(ult.json.completo, true); return ult.json.file;
  };
  const configura = () => chiama('POST', '/api/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio'] });
  return { srv, chiama, carica, configura, esci: () => { biscotto = ''; } };
}
const aspetta = async (f, ms = 4000) => { const fine = Date.now() + ms; while (Date.now() < fine) { const x = await f(); if (x) return x; await new Promise(r => setTimeout(r, 25)); } return f(); };

test('formati: numeri, date e sì/no all\'italiana, tipi indovinati, abbinamento', () => {
  assert.equal(F.numeroIt('1.234,50'), 1234.5); assert.equal(F.numeroIt('€ 12'), 12); assert.equal(F.numeroIt('1.234'), 1234); assert.equal(F.numeroIt('-3,5'), -3.5);
  assert.equal(F.numeroIt('1,234.50'), 1234.5); assert.ok(Number.isNaN(F.numeroIt('dodici')));
  assert.deepEqual(F.dataIt('31/12/2026'), { data: '2026-12-31', ora: null }); assert.equal(F.dataIt('31/02/2026'), null); assert.equal(F.dataIt('5.1.26').data, '2026-01-05');
  assert.equal(F.dataIt('31/12/2026 14:30').ora, '14:30'); assert.equal(F.dataIt(46022).data, '2025-12-31');
  assert.equal(F.siNo('Sì'), true); assert.equal(F.siNo('no'), false); assert.equal(F.siNo('forse'), undefined);
  assert.equal(F.indovinaTipo('Prezzo', ['1,50', '€ 2']).tipo, 'valuta'); assert.equal(F.indovinaTipo('CAP', ['00100', '20121']).tipo, 'testo');
  assert.equal(F.indovinaTipo('Nato il', ['01/02/1990', '3/4/1985']).tipo, 'data'); assert.equal(F.indovinaTipo('Mail', ['a@b.it']).tipo, 'email');
  assert.equal(F.indovinaTipo('Privacy', ['sì', 'no', 'sì']).tipo, 'si_no');
  const s = F.indovinaTipo('Tipo', ['privato', 'azienda', 'privato', 'privato', 'azienda', 'azienda']); assert.equal(s.tipo, 'scelta'); assert.equal(s.opzioni.length, 2);
  assert.deepEqual(F.proponiAbbinamento(['E-mail', 'Ragione sociale', 'Cell.', 'Boh'], [{ id: 'nome', nome: 'Nome' }, { id: 'email', nome: 'Email' }, { id: 'telefono', nome: 'Telefono' }]),
    { 'E-mail': 'email', 'Ragione sociale': 'nome', 'Cell.': 'telefono', Boh: null });
  assert.equal(nomeSicuro('../../etc/passwd'), 'passwd'); assert.equal(nomeSicuro('..'), 'file'); assert.equal(nomeSicuro('a\u0000b<>.txt'), 'a_b__.txt');
});

test('formati: CSV con virgolette, separatori e Windows-1252; xlsx scritto e riletto; xlsx «di Excel» con stringhe condivise e date', () => {
  const t = F.leggiTabella(Buffer.from('Nome;Note;Prezzo\r\n"Rossi; Mario";"dice ""ciao""\nva";"1.234,50"\r\n\r\nVerdi;;3\r\n'));
  assert.deepEqual(t.intestazioni, ['Nome', 'Note', 'Prezzo']); assert.deepEqual(t.righe, [['Rossi; Mario', 'dice "ciao"\nva', '1.234,50'], ['Verdi', '', '3']]);
  assert.equal(F.leggiTabella(Buffer.from('a,b\n1,2\n')).righe[0][1], '2');
  assert.equal(F.leggiTabella(Buffer.from([0x43, 0x69, 0x74, 0x74, 0xe0, 0x0a, 0x46, 0x6f, 0x72, 0x6c, 0xec])).righe[0][0], 'Forlì');   // Windows-1252
  assert.deepEqual(F.leggiTabella(Buffer.from('X;X;\n1;2;3\n')).intestazioni, ['X', 'X (2)', 'Colonna 3']);
  assert.equal(F.leggiTabella(Buffer.from(F.scriviCsv(['f'], [['=1+1']]))).righe[0][0], '=1+1');   // l'apostrofo di protezione va e torna
  const x = F.scriviXlsx(['Nome', 'Prezzo', 'Data', 'Ok'], [['Vaso <blu> & co', { euro: 12.5 }, { data: '2026-12-31' }, true], ['Tazza', null, null, false]]);
  assert.deepEqual(F.leggiTabella(x), { intestazioni: ['Nome', 'Prezzo', 'Data', 'Ok'], righe: [['Vaso <blu> & co', 12.5, '2026-12-31', 'Sì'], ['Tazza', null, null, 'No']] });
  // come lo salva Excel: stringhe condivise (anche «ricche»), prefissi x:, stile con data predefinita (14) e propria (164), celle saltate
  const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const excel = F.scriviZip([
    { nome: 'xl/workbook.xml', dati: `<x:workbook ${ns} xmlns:r="r"><x:sheets><x:sheet name="Clienti" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', dati: '<Relationships><Relationship Id="rId7" Target="worksheets/foglio.xml"/></Relationships>' },
    { nome: 'xl/sharedStrings.xml', dati: `<x:sst ${ns}><x:si><x:t>Nome</x:t></x:si><x:si><x:r><x:t>Ann</x:t></x:r><x:r><x:t xml:space="preserve">a &amp; co</x:t></x:r></x:si><x:si><x:t>Nato</x:t></x:si><x:si><x:t>Ultima</x:t></x:si></x:sst>` },
    { nome: 'xl/styles.xml', dati: `<x:styleSheet ${ns}><x:numFmts><x:numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></x:numFmts><x:cellXfs count="3"><x:xf numFmtId="0"/><x:xf numFmtId="14"/><x:xf numFmtId="164"/></x:cellXfs></x:styleSheet>` },
    { nome: 'xl/worksheets/foglio.xml', dati: `<x:worksheet ${ns}><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>2</x:v></x:c><x:c r="D1" t="s"><x:v>3</x:v></x:c></x:row>
      <x:row r="3"><x:c r="A3" t="s"><x:v>1</x:v></x:c><x:c r="C3" s="1"><x:v>46022</x:v></x:c><x:c r="D3" s="2"><x:v>46022.5</x:v></x:c></x:row></x:sheetData></x:worksheet>` },
  ]);
  assert.deepEqual(F.leggiTabella(excel), { intestazioni: ['Nome', 'Colonna 2', 'Nato', 'Ultima'], righe: [['Anna & co', null, '2025-12-31', '2025-12-31T12:00:00']] });
  assert.throws(() => F.leggiTabella(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), /\.xls/);
});

test('import: anteprima, abbinamento, doppioni, errori, prova senza salvare, nuova sezione; export riletto', async () => {
  const { srv, chiama, carica, configura } = await avvia();
  try {
    assert.equal((await configura()).stato, 200);
    await chiama('POST', '/api/dati/clienti', { nome: 'Anna Bianchi', email: 'anna@esempio.it' });
    const csv = 'Ragione sociale;E-mail;Cell.;Tipo;Privacy\r\nAnna Bianchi Srl;ANNA@esempio.it;333 1;azienda;sì\r\nLuca Verdi;luca@esempio.it;;privato;no\r\nSenza Tipo;x@esempio.it;;marziano;sì\r\n;;;;\r\nLuca Verdi bis;luca@esempio.it;;privato;forse\r\nMarta;marta@esempio.it;;Privato;x\r\n';
    const f = await carica('clienti.csv', Buffer.from(csv, 'latin1'), 'text/csv');
    const a = (await chiama('POST', '/api/import/anteprima', { caricamento: f.id, entita: 'clienti' })).json;
    assert.equal(a.totale, 5); assert.equal(a.abbinamento['E-mail'], 'email'); assert.equal(a.abbinamento['Ragione sociale'], 'nome'); assert.equal(a.abbinamento['Cell.'], 'telefono');
    const corpo = { caricamento: f.id, entita: 'clienti', abbinamento: { ...a.abbinamento, Tipo: 'tipo', Privacy: { nuovo: true, tipo: 'si_no' } }, doppioni: { campo: 'email', modo: 'aggiorna' } };
    const prova = (await chiama('POST', '/api/import/esegui', { ...corpo, prova: true })).json;
    assert.equal(prova.prova, true); assert.equal((await chiama('GET', '/api/dati/clienti')).json.totale, 1);   // la prova non salva niente…
    assert.ok(!(await chiama('GET', '/api/schema')).json.find(e => e.id === 'clienti').campi.some(c => c.id === 'privacy'));   // …nemmeno il campo nuovo
    const e = (await chiama('POST', '/api/import/esegui', corpo)).json;
    assert.deepEqual([e.create, e.aggiornate, e.erroriTotali], [2, 1, 2], JSON.stringify(e));
    assert.match(e.errori[0].messaggio, /marziano/); assert.equal(e.errori[0].riga, 4); assert.match(e.errori[1].messaggio, /forse/);
    const clienti = (await chiama('GET', '/api/dati/clienti?n=50')).json.righe;
    const anna = clienti.find(c => c.email === 'anna@esempio.it'); assert.equal(anna.nome, 'Anna Bianchi Srl'); assert.equal(anna.privacy, true); assert.equal(anna.tipo, 'azienda');
    assert.equal(clienti.find(c => c.nome === 'Marta').tipo, 'privato');
    // con «salta» i doppioni restano come sono
    const s = (await chiama('POST', '/api/import/esegui', { ...corpo, abbinamento: { ...a.abbinamento, Tipo: null }, doppioni: { campo: 'email', modo: 'salta' } })).json;
    assert.equal(s.create, 1); assert.equal(s.saltate, 4);   // «Senza Tipo» ora entra (Tipo non abbinato), 4 doppioni saltati
    // un foglio Excel come nuova sezione, con i tipi indovinati
    const x = F.scriviXlsx(['Targa', 'Modello', 'Prezzo al giorno', 'Revisione', 'Disponibile'], [['AB123CD', 'Panda', { euro: 35 }, { data: '2026-03-01' }, true], ['EF456GH', 'Ducato', { euro: 80.5 }, { data: '2026-07-15' }, false]]);
    const fx = await carica('mezzi.xlsx', x);
    const n = (await chiama('POST', '/api/import/esegui', { caricamento: fx.id, nuova: { nome: 'Noleggi' }, abbinamento: {} })).json;
    assert.equal(n.create, 2, JSON.stringify(n)); assert.equal(n.entita, 'noleggi');
    const def = (await chiama('GET', '/api/schema')).json.find(e => e.id === 'noleggi');
    assert.deepEqual(def.campi.map(c => c.tipo), ['testo', 'testo', 'valuta', 'data', 'si_no']); assert.equal(def.titolo, 'targa');
    const ducato = (await chiama('GET', '/api/dati/noleggi?q=Ducato')).json.righe[0]; assert.equal(ducato.prezzo_al_giorno, 80.5); assert.equal(ducato.revisione, '2026-07-15'); assert.equal(ducato.disponibile, false);
    // export: xlsx e csv con i filtri della lista, riletti
    const ex = await chiama('GET', '/api/import/esporta/clienti?formato=xlsx&q=verdi', null, { grezzo: true });
    assert.equal(ex.stato, 200); assert.match(ex.intestazioni.get('content-disposition'), /Clienti/);
    const riletto = F.leggiTabella(ex.dati); assert.equal(riletto.righe.length, 1); assert.equal(riletto.righe[0][riletto.intestazioni.indexOf('Email')], 'luca@esempio.it');
    assert.equal(riletto.righe[0][riletto.intestazioni.indexOf('Privacy')], 'No');
    const ec = await chiama('GET', '/api/import/esporta/noleggi?formato=csv&o=prezzo_al_giorno:desc', null, { grezzo: true });
    const rc = F.leggiTabella(ec.dati); assert.deepEqual(rc.righe.map(r => r[2]), ['80,50', '35,00']); assert.equal(rc.righe[0][3], '15/07/2026');
    // e il file esportato si reimporta da sé: stessi valori, nessun doppione
    const fe = await carica('noleggi.csv', ec.dati);
    const re = (await chiama('POST', '/api/import/esegui', { caricamento: fe.id, entita: 'noleggi', abbinamento: (await chiama('POST', '/api/import/anteprima', { caricamento: fe.id, entita: 'noleggi' })).json.abbinamento, doppioni: { campo: 'targa', modo: 'aggiorna' } })).json;
    assert.deepEqual([re.create, re.aggiornate, re.erroriTotali], [0, 2, 0], JSON.stringify(re));
    // il modello da compilare: solo le intestazioni dei campi importabili
    const vu = F.leggiTabella((await chiama('GET', '/api/import/esporta/noleggi?vuoto=1', null, { grezzo: true })).dati);
    assert.deepEqual(vu, { intestazioni: ['Targa', 'Modello', 'Prezzo al giorno', 'Revisione', 'Disponibile'], righe: [] });
    // OpenAPI dallo schema
    const oa = (await chiama('GET', '/api/openapi.json')).json;
    assert.equal(oa.openapi, '3.0.3'); assert.ok(oa.paths['/api/dati/noleggi'].post); assert.equal(oa.components.schemas.noleggi.properties.revisione.format, 'date');
    // il caricamento di un altro non si usa
    assert.equal((await chiama('POST', '/api/import/anteprima', { caricamento: '0'.repeat(17) })).stato, 404);
  } finally { srv.close(); }
});

test('allegati: caricamento a pezzi, permessi della riga e dei campi, nomi pericolosi', async () => {
  const { srv, chiama, carica, configura, esci } = await avvia();
  try {
    await configura();
    const def = (await chiama('GET', '/api/schema')).json.find(e => e.id === 'articoli');
    const pulita = { ...def, campi: [...def.campi.map(({ sola_lettura, ...c }) => c), { id: 'scheda', nome: 'Scheda tecnica', tipo: 'file' }] }; delete pulita.puo; delete pulita.archiviata;
    { const x = await chiama('PUT', '/api/schema/articoli', pulita); assert.equal(x.stato, 200, JSON.stringify(x.json)); }
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const foto = await carica('../../foto vaso.png', png, 'image/png'); assert.equal(foto.nome, 'foto vaso.png');
    const doc = await carica('scheda.html', Buffer.from('<script>alert(1)</script>'), 'text/html');
    const art = await chiama('POST', '/api/dati/articoli', { nome: 'Vaso', foto: [foto], scheda: [doc] }); assert.equal(art.stato, 200, JSON.stringify(art.json));
    const url = art.json.foto[0].url; assert.match(url, /^\/api\/file\/articoli\/[0-9A-Z]{17}\/foto\/[0-9A-Z]{17}$/);
    const img = await chiama('GET', url, null, { grezzo: true });
    assert.equal(img.stato, 200); assert.deepEqual(img.dati, png); assert.equal(img.intestazioni.get('content-type'), 'image/png'); assert.match(img.intestazioni.get('content-security-policy'), /sandbox/);
    const html = await chiama('GET', art.json.scheda[0].url, null, { grezzo: true });
    assert.equal(html.intestazioni.get('content-type'), 'application/octet-stream'); assert.match(html.intestazioni.get('content-disposition'), /^attachment/);   // mai HTML in linea
    assert.equal((await chiama('POST', '/api/dati/articoli', { nome: 'Finto', foto: [{ id: '0'.repeat(17), nome: 'x.png' }] })).stato, 422);   // un file mai caricato
    assert.equal((await chiama('POST', '/api/dati/articoli', { nome: 'Finto', foto: [{ id: '../../x' }] })).stato, 422);
    assert.equal((await chiama('POST', '/api/dati/articoli', { nome: 'Finto', foto: [doc] })).stato, 422);   // un .html non è un'immagine
    for (const p of [`/api/file/articoli/${art.json.id}/foto/..%2F..%2Fkubo.db`, `/api/file/articoli/..%2F..%2Fx/foto/${foto.id}`, `/api/file/articoli/${art.json.id}/nome/${foto.id}`])
      assert.equal((await chiama('GET', p, null, { grezzo: true })).stato, 404, p);
    assert.equal((await chiama('POST', '/api/file/carica', { nome: 'grosso.bin', dimensione: 26 * 1024 * 1024 })).stato, 413);
    // un ruolo che non vede la foto, uno che vede solo i propri
    await chiama('PUT', '/api/ruoli/banco', { nome: 'Banco', entita: { '*': { leggi: true, crea: true, modifica: true }, articoli: { campi: { foto: 'nascosto' } } } });
    await chiama('PUT', '/api/ruoli/propri', { nome: 'Propri', entita: { '*': { leggi: true, crea: true, modifica: true, soloPropri: true } } });
    await chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'banco' });
    await chiama('POST', '/api/utenti', { nome: 'Piero', email: 'p@prova.it', password: 'password-piero', ruolo: 'propri' });
    esci(); assert.equal((await chiama('GET', url, null, { grezzo: true })).stato, 401);
    await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' });
    assert.equal((await chiama('GET', url, null, { grezzo: true })).stato, 404);
    assert.equal((await chiama('GET', art.json.scheda[0].url, null, { grezzo: true })).stato, 200);
    // Giulia non può usare un caricamento di Piero
    esci(); await chiama('POST', '/api/accedi', { email: 'p@prova.it', password: 'password-piero' });
    assert.equal((await chiama('GET', art.json.scheda[0].url, null, { grezzo: true })).stato, 422);   // «solo i propri»: la riga non c'è
    const suo = await carica('mio.png', png, 'image/png');
    esci(); await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' });
    assert.equal((await chiama('POST', '/api/dati/articoli', { nome: 'Rubato', scheda: [suo] })).stato, 422);
  } finally { srv.close(); }
});

test('token personali: Bearer con i permessi del ruolo, mostrato una volta, revoca e scadenza', async () => {
  const { srv, chiama, configura, esci } = await avvia();
  try {
    await configura();
    await chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'collaboratore' });
    esci(); await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' });
    const t = (await chiama('POST', '/api/token', { nome: 'Sito', giorni: 30 })).json;
    assert.match(t.token, /^kubo_/); assert.ok(t.scade);
    const elenco = (await chiama('GET', '/api/token')).json; assert.equal(elenco.length, 1); assert.equal(elenco[0].token, undefined); assert.equal(elenco[0].inizio, t.token.slice(0, 9));
    const c = await chiama('POST', '/api/dati/clienti', { nome: 'Dal sito' }, { token: t.token }); assert.equal(c.stato, 200);   // niente X-Kubo con il Bearer
    assert.equal(c.json.creato_da, (await chiama('GET', '/api/stato')).json.utente.id);
    assert.equal((await chiama('DELETE', `/api/dati/clienti/${c.json.id}`, null, { token: t.token })).stato, 403);   // il collaboratore non elimina
    assert.equal((await chiama('POST', '/api/token', { nome: 'Altro' }, { token: t.token })).stato, 403);
    assert.equal((await chiama('GET', '/api/webhook', null, { token: t.token })).stato, 403);
    assert.equal((await chiama('GET', '/api/dati/clienti', null, { token: 'kubo_sbagliato' })).stato, 401);
    assert.equal((await chiama('DELETE', `/api/token/${t.id}`)).stato, 200);
    assert.equal((await chiama('GET', '/api/dati/clienti', null, { token: t.token })).stato, 401);
    const vecchio = (await chiama('POST', '/api/token', { nome: 'Scaduto', giorni: 0.00000001 })).json;
    await new Promise(r => setTimeout(r, 10));
    assert.equal((await chiama('GET', '/api/dati/clienti', null, { token: vecchio.token })).stato, 401);
  } finally { srv.close(); }
});

test('webhook: firma HMAC, tentativi con attesa, registro delle consegne, solo il titolare', async () => {
  const ricevute = []; let rispondi = 500;
  const finto = createServer((req, res) => { let b = ''; req.on('data', x => { b += x; }); req.on('end', () => { ricevute.push({ h: req.headers, corpo: b }); res.writeHead(rispondi).end('ok'); rispondi = 200; }); });
  await new Promise(r => finto.listen(0, '127.0.0.1', r));
  const { srv, chiama, configura } = await avvia();
  try {
    await configura();
    assert.equal((await chiama('PUT', '/api/webhook/nuovo', { url: 'ftp://x' })).stato, 400);
    const w = (await chiama('PUT', '/api/webhook/nuovo', { nome: 'Contabilità', url: `http://127.0.0.1:${finto.address().port}/kubo`, entita: ['clienti'], eventi: ['crea', 'modifica'] })).json;
    assert.match(w.segreto, /^whsec_/);
    const c = (await chiama('POST', '/api/dati/clienti', { nome: 'Marta' })).json;
    await chiama('POST', '/api/dati/fornitori', { nome: 'Non interessa' });
    const ok = await aspetta(async () => (await chiama('GET', `/api/webhook/${w.id}/consegne`)).json.find(x => x.stato === 'ok'));
    assert.ok(ok, 'la consegna arriva dopo il secondo tentativo'); assert.equal(ok.tentativi, 2); assert.equal(ok.codice, 200);
    assert.equal(ricevute.length, 2);
    const { h, corpo } = ricevute[1], j = JSON.parse(corpo);
    assert.equal(h['x-kubo-firma'], firma(w.segreto, h['x-kubo-tempo'], corpo)); assert.equal(h['x-kubo-evento'], 'clienti.crea');
    assert.equal(j.id, c.id); assert.equal(j.dati.nome, 'Marta'); assert.equal(j.consegna, ok.id);
    await chiama('DELETE', `/api/dati/clienti/${c.id}`);   // «elimina» non è fra gli eventi scelti
    await chiama('POST', `/api/webhook/${w.id}/prova`);
    await aspetta(() => ricevute.length >= 3);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(ricevute.map(x => x.h['x-kubo-evento']), ['clienti.crea', 'clienti.crea', 'prova']);
    // senza risposta: dopo i tentativi la consegna è «fallita», e si può riprovare a mano
    const w2 = (await chiama('PUT', '/api/webhook/nuovo', { url: 'http://127.0.0.1:9/chiuso' })).json;
    await chiama('POST', '/api/dati/clienti', { nome: 'Luca' });
    const ko = await aspetta(async () => (await chiama('GET', `/api/webhook/${w2.id}/consegne`)).json.find(x => x.stato === 'fallita'));
    assert.ok(ko); assert.equal(ko.tentativi, ATTESE.length + 1);
    await chiama('POST', '/api/utenti', { nome: 'Giulia', email: 'g@prova.it', password: 'password-giulia', ruolo: 'collaboratore' });
    await chiama('POST', '/api/esci'); await chiama('POST', '/api/accedi', { email: 'g@prova.it', password: 'password-giulia' });
    assert.equal((await chiama('GET', '/api/webhook')).stato, 403);
    assert.equal((await chiama('GET', '/api/import/backup', null, { grezzo: true })).stato, 403);
  } finally { srv.close(); finto.close(); }
});

test('backup: uno zip con la copia coerente del database e gli allegati', async () => {
  const cartella = mkdtempSync(join(tmpdir(), 'kubo-prova-')), db = apri(join(cartella, 'kubo.db'));
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(base + '/api/configura', { method: 'POST', headers: { 'X-Kubo': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ azienda: 'B', nome: 'T', email: 't@p.it', password: 'password-lunga', modelli: ['negozio'] }) });
    const Cookie = r.headers.get('set-cookie').split(';')[0], H = { 'X-Kubo': '1', 'Content-Type': 'application/json', Cookie };
    await fetch(base + '/api/dati/clienti', { method: 'POST', headers: H, body: JSON.stringify({ nome: 'Nel backup' }) });
    const b = await fetch(base + '/api/import/backup', { headers: { Cookie } });
    assert.equal(b.status, 200); assert.match(b.headers.get('content-disposition'), /kubo-backup-.*\.zip/);
    const z = F.leggiZip(Buffer.from(await b.arrayBuffer())); assert.ok(z.nomi.includes('kubo.db') && z.nomi.includes('LEGGIMI.txt'));
    const copia = join(cartella, 'copia.db'); writeFileSync(copia, z.leggi('kubo.db'));
    const d2 = new DatabaseSync(copia); assert.equal(d2.prepare("SELECT c_nome n FROM d_clienti").get().n, 'Nel backup'); d2.close();
  } finally { srv.close(); }
});
