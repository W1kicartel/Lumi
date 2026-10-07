// App desktop, rete, backup e aggiornamenti: QR (riletto da un lettore scritto qui, indipendente), codici di rete,
// rotazione, backup e ripristino che non perde dati, caricamento di un backup, aggiornamenti con un finto server,
// e Kubo acceso «come nell'app desktop» senza finestre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import * as Q from '../server/moduli/desktop-qr.js';
import * as R from '../server/moduli/desktop-rete.js';
import * as B from '../server/moduli/desktop-backup.js';
import { confronta, controlla } from '../server/moduli/desktop-aggiorna.js';
import { accendi } from '../desktop/kubo.mjs';

attiva();
const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'kubo-desktop-')));

// ---------- un lettore di QR minimo, scritto da capo: formato, maschera, ordine a serpente, blocchi, Reed-Solomon ----------
const BLOCCHI = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] };
function leggiQR(righe) {
  const m = righe.map(r => [...r].map(Number)), n = m.length, v = (n - 17) / 4;
  assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, 'dimensione');
  // il formato dalla prima copia (bit 14 → 0), confrontato con tutte le 32 parole valide
  const letti = [m[8][0], m[8][1], m[8][2], m[8][3], m[8][4], m[8][5], m[8][7], m[8][8], m[7][8], m[5][8], m[4][8], m[3][8], m[2][8], m[1][8], m[0][8]];
  const formato = letti.reduce((a, b) => (a << 1) | b, 0);
  const seconda = [...Array(7)].map((_, i) => m[n - 1 - i][8]).concat([...Array(8)].map((_, i) => m[8][n - 8 + i])).reduce((a, b) => (a << 1) | b, 0);
  assert.equal(formato, seconda, 'le due copie del formato coincidono');
  const maschera = [...Array(8).keys()].find(k => Q.bitFormato(k) === formato); assert.notEqual(maschera, undefined, 'formato M valido');
  // le zone fisse ricostruite a mano per questa versione
  const fisso = Array.from({ length: n }, () => new Array(n).fill(false)), segna = (r, c) => { if (r >= 0 && c >= 0 && r < n && c < n) fisso[r][c] = true; };
  for (const [a, b] of [[0, 0], [0, n - 8], [n - 8, 0]]) for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) segna(a + r, b + c);
  const al = v === 1 ? [] : (() => { const ult = n - 7, k = Math.floor(v / 7) + 2, passo = v === 32 ? 26 : Math.ceil((ult - 6) / (k - 1) / 2) * 2; const l = [6]; for (let i = k - 2; i >= 0; i--) l.splice(1, 0, ult - i * passo); return [...new Set(l)].sort((a, b) => a - b); })();
  for (const r of al) for (const c of al) if (!fisso[r][c]) for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) segna(r + dr, c + dc);
  for (let i = 0; i < n; i++) { segna(6, i); segna(i, 6); }
  for (let i = 0; i < 9; i++) { segna(8, i); segna(i, 8); } for (let i = 0; i < 8; i++) { segna(8, n - 1 - i); segna(n - 1 - i, 8); }
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { segna(i, n - 11 + j); segna(n - 11 + j, i); }
  const bit = [];
  for (let c = n - 1; c > 0; c -= 2) { if (c === 6) c--; const su = ((c + 1) & 2) === 0;
    for (let k = 0; k < n; k++) { const r = su ? n - 1 - k : k; for (const x of [c, c - 1]) if (!fisso[r][x]) bit.push(m[r][x] ^ (Q.MASCHERE[maschera](r, x) ? 1 : 0)); } }
  const parole = []; for (let i = 0; i + 8 <= bit.length; i += 8) parole.push(bit.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const [nc, gruppi] = BLOCCHI[v], blocchi = gruppi.flatMap(([b, d]) => Array.from({ length: b }, () => ({ d, dati: [], cor: [] })));
  let i = 0; const lung = Math.max(...blocchi.map(b => b.d));
  for (let k = 0; k < lung; k++) for (const b of blocchi) if (k < b.d) b.dati.push(parole[i++]);
  for (let k = 0; k < nc; k++) for (const b of blocchi) b.cor.push(parole[i++]);
  for (const b of blocchi) {   // ogni blocco intero è un multiplo del generatore: le sindromi sono zero
    const tutto = [...b.dati, ...b.cor];
    for (let s = 0; s < nc; s++) { let a = 1; for (let e = 0; e < s; e++) a = Q.per(a, 2); assert.equal(tutto.reduce((acc, x) => Q.per(acc, a) ^ x, 0), 0, 'sindrome'); }
  }
  const dati = blocchi.flatMap(b => b.dati), flusso = dati.flatMap(x => [...x.toString(2).padStart(8, '0')].map(Number));
  const leggi = (da, quanti) => flusso.slice(da, da + quanti).reduce((a, b) => (a << 1) | b, 0);
  assert.equal(leggi(0, 4), 0b0100, 'modo byte'); const lc = v < 10 ? 8 : 16, len = leggi(4, lc);
  return { versione: v, testo: Buffer.from([...Array(len)].map((_, k) => leggi(4 + lc + 8 * k, 8))).toString('utf8') };
}

test('QR: valori noti della norma (Reed-Solomon, formato, versione) e testi riletti da un lettore indipendente', () => {
  // l'esempio classico «HELLO WORLD» 1-M: i 16 byte di dati danno questi 10 di correzione
  assert.deepEqual(Q.correzione([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.deepEqual([...Array(8).keys()].map(k => Q.bitFormato(k).toString(2)), ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000']);
  const v7 = Q.struttura(7); assert.equal(v7.n, 45);
  // i 18 bit di versione 7 (0x07C94) nell'angolo in basso a sinistra: riga n-11+i%3, colonna i/3
  const letti = [...Array(18).keys()].map(i => v7.m[v7.n - 11 + (i % 3)][Math.floor(i / 3)]).reverse().join('');
  assert.equal(parseInt(letti, 2), 0x07c94);
  for (const t of ['http://192.168.1.20:4380/', 'https://kubo.esempio.it/', 'x', 'Città: perché sì ✓', 'http://10.0.0.5:4380/#/accedi?da=telefono&x=' + 'a'.repeat(120), 'z'.repeat(213)]) {
    const q = Q.codiceQR(t); assert.equal(q.righe.length, 17 + 4 * q.versione);
    assert.deepEqual(leggiQR(q.righe), { versione: q.versione, testo: t });
    for (let k = 0; k < 8; k++) assert.equal(leggiQR(Q.codiceQR(t, { maschera: k }).righe).testo, t, `maschera ${k}`);
  }
  assert.equal(Q.codiceQR('http://192.168.1.20:4380/').versione, 2);
  assert.throws(() => Q.codiceQR('z'.repeat(214)), /troppo lungo/);
});

test('rete: codice da dettare avanti e indietro, indirizzi scritti come capita', () => {
  const c = R.codiceDa('192.168.1.20', 4380); assert.match(c, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
  assert.deepEqual(R.daCodice(c), { ip: '192.168.1.20', porta: 4380 }); assert.deepEqual(R.daCodice(c.toLowerCase().replace(/-/g, ' ')), { ip: '192.168.1.20', porta: 4380 });
  assert.deepEqual(R.daCodice(R.codiceDa('255.255.255.255', 65535)), { ip: '255.255.255.255', porta: 65535 }); assert.equal(R.daCodice('ciao'), null);
  assert.equal(R.indirizzoDa(c), 'http://192.168.1.20:4380'); assert.equal(R.indirizzoDa('192.168.1.7'), 'http://192.168.1.7:4380');
  assert.equal(R.indirizzoDa('ufficio.local:5000'), 'http://ufficio.local:5000'); assert.equal(R.indirizzoDa('https://kubo.esempio.it/x'), 'https://kubo.esempio.it');
  assert.throws(() => R.indirizzoDa('')); assert.throws(() => R.indirizzoDa('ftp://x')); assert.throws(() => R.indirizzoDa('http://a:b@c'));
  assert.deepEqual(R.indirizziLocali({ en0: [{ family: 'IPv4', address: '8.8.4.4', internal: false }, { family: 'IPv4', address: '192.168.1.9', internal: false }], lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    x: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '169.254.3.3', internal: false }] }), ['192.168.1.9', '8.8.4.4']);
});

test('rotazione: 7 giornalieri, 4 settimanali, 12 mensili; manuali sempre; altri tipi gli ultimi N', () => {
  const ora = new Date(2026, 9, 7, 3, 0, 0), l = [];
  for (let g = 0; g < 500; g++) { const d = new Date(ora); d.setDate(d.getDate() - g); l.push({ nome: B.nomePer(d, 'giornaliero'), tipo: 'giornaliero', quando: d.toISOString() }); }
  for (let g = 0; g < 3; g++) { const d = new Date(ora.getTime() - g * 36e5 - 6e4); l.push({ nome: B.nomePer(d, 'giornaliero'), tipo: 'giornaliero', quando: d.toISOString() }); }   // più copie lo stesso giorno
  for (let g = 0; g < 15; g++) { const d = new Date(ora.getTime() - g * 6e4 - 1); l.push({ nome: B.nomePer(d, 'modifica'), tipo: 'modifica', quando: d.toISOString() }); }
  const manuale = { nome: B.nomePer(new Date(2024, 0, 1), 'manuale'), tipo: 'manuale', quando: new Date(2024, 0, 1).toISOString() }; l.push(manuale);
  const tieni = B.daTenere(l), g = l.filter(b => b.tipo === 'giornaliero' && tieni.has(b.nome)).map(b => new Date(b.quando)).sort((a, b) => b - a);
  for (let i = 0; i < 7; i++) assert.equal(g[i].getDate(), new Date(2026, 9, 7 - i).getDate(), 'gli ultimi 7 giorni, uno al giorno');
  assert.equal(g[0].getTime(), ora.getTime(), 'del giorno si tiene il più recente');
  assert.ok(g.length <= 7 + 4 + 12 && g.length >= 12 + 7 - 1, `quanti: ${g.length}`);
  const mesi = new Set(g.map(d => `${d.getFullYear()}-${d.getMonth()}`)); assert.equal(mesi.size, 12, 'un backup per ognuno degli ultimi 12 mesi');
  assert.ok(g.at(-1) > new Date(2025, 9, 1), 'niente più vecchio di 12 mesi');
  assert.equal(l.filter(b => b.tipo === 'modifica' && tieni.has(b.nome)).length, 10); assert.ok(tieni.has(manuale.nome));
  // sui file veri: la rotazione cancella e la seconda volta non toglie altro
  const c = temp(); for (const b of l.slice(0, 40)) writeFileSync(join(c, b.nome), 'x');
  writeFileSync(join(c, 'altro-file.db'), 'non mio');
  const tolti = B.ruota(c); assert.ok(tolti.length > 0); assert.deepEqual(B.ruota(c), []); assert.ok(existsSync(join(c, 'altro-file.db')), 'i file non di Kubo non si toccano');
});

test('allegati incrementali: si copia solo il nuovo o il cambiato, niente si cancella', () => {
  const da = temp(), a = temp();
  mkdirSync(join(da, 'articoli', 'R1'), { recursive: true }); mkdirSync(join(da, '_tmp'), { recursive: true });
  writeFileSync(join(da, 'articoli', 'R1', 'F1'), 'uno'); writeFileSync(join(da, '_tmp', 'X'), 'mezzo');
  assert.deepEqual(B.copiaAllegati(da, a), { copiati: 1, byte: 3 }); assert.ok(!existsSync(join(a, '_tmp')));
  assert.equal(B.copiaAllegati(da, a).copiati, 0, 'la seconda volta niente');
  writeFileSync(join(da, 'articoli', 'R1', 'F1'), 'uno cambiato'); writeFileSync(join(da, 'articoli', 'R1', 'F2'), 'due');
  assert.equal(B.copiaAllegati(da, a).copiati, 2); assert.equal(readFileSync(join(a, 'articoli', 'R1', 'F1'), 'utf8'), 'uno cambiato');
});

// ---------- il server con un database su file ----------
async function avvia() {
  const cartella = temp(), db = apri(join(cartella, 'kubo.db')), srv = creaServer(db);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo, { grezzo = false } = {}) => {
    const r = await fetch(base + percorso, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined, headers: { 'Content-Type': 'application/json', 'X-Kubo': '1', ...(biscotto ? { Cookie: biscotto } : {}) } });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, intestazioni: r.headers, json: grezzo ? null : await r.json().catch(() => null), dati: grezzo ? Buffer.from(await r.arrayBuffer()) : null };
  };
  const r = await chiama('POST', '/api/configura', { azienda: 'Bottega Prova', nome: 'Titolare', email: 't@prova.it', password: 'password-lunga', modelli: ['negozio'] });
  assert.equal(r.stato, 200, JSON.stringify(r.json));
  return { cartella, db, srv, chiama, biscotto: () => biscotto, usa: b => { biscotto = b; }, chiudi: () => new Promise(r => { srv.closeAllConnections(); srv.close(r); }) };
}
const nomi = async (k) => (await k.chiama('GET', '/api/dati/clienti?n=100')).json.righe.map(x => x.nome).sort();

test('backup e ripristino: copia coerente, ripristino con copia di sicurezza, nessun dato perso, sessione salva', async () => {
  const k = await avvia();
  try {
    assert.equal((await k.chiama('POST', '/api/dati/clienti', { nome: 'Prima Srl' })).stato, 200);
    const fatto = await k.chiama('POST', '/api/backup'); assert.equal(fatto.stato, 200, JSON.stringify(fatto.json));
    const nome = fatto.json.backup.nome; assert.match(nome, B.NOME); assert.equal(fatto.json.backup.tipo, 'manuale');
    assert.equal(fatto.json.cartella, join(k.cartella, 'backup'));
    // il file è un database sano, con dentro la riga
    const copia = new DatabaseSync(join(k.cartella, 'backup', nome), { readOnly: true });
    assert.equal(copia.prepare('SELECT COUNT(*) n FROM d_clienti').get().n, 1); copia.close();
    assert.equal((await k.chiama('POST', '/api/dati/clienti', { nome: 'Dopo Spa' })).stato, 200);
    assert.deepEqual(await nomi(k), ['Dopo Spa', 'Prima Srl']);
    // si scarica
    const giu = await k.chiama('GET', `/api/backup/file/${nome}`, null, { grezzo: true });
    assert.equal(giu.stato, 200); assert.equal(giu.dati.subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await k.chiama('GET', '/api/backup/file/..%2Fkubo.db')).stato, 404);
    // senza conferma non parte
    assert.equal((await k.chiama('POST', '/api/backup/ripristina', { nome })).stato, 400);
    const rip = await k.chiama('POST', '/api/backup/ripristina', { nome, conferma: true }); assert.equal(rip.stato, 200, JSON.stringify(rip.json));
    assert.equal(rip.json.azienda, 'Bottega Prova'); assert.match(rip.json.sicurezza, /-sicurezza\.db$/);
    // la sessione di chi ha ripristinato vale ancora, e i dati sono quelli del backup
    assert.deepEqual(await nomi(k), ['Prima Srl']);
    // si continua a lavorare sullo stesso database
    assert.equal((await k.chiama('POST', '/api/dati/clienti', { nome: 'Terza Snc' })).stato, 200);
    // e niente è perso: la copia di sicurezza ha «Dopo Spa», e ripristinarla la riporta
    const rip2 = await k.chiama('POST', '/api/backup/ripristina', { nome: rip.json.sicurezza, conferma: true }); assert.equal(rip2.stato, 200, JSON.stringify(rip2.json));
    assert.deepEqual(await nomi(k), ['Dopo Spa', 'Prima Srl']);
    // tutto sul file vero: un'altra connessione vede lo stesso
    const altra = new DatabaseSync(join(k.cartella, 'kubo.db'), { readOnly: true });
    assert.equal(altra.prepare('SELECT COUNT(*) n FROM d_clienti').get().n, 2); altra.close();
    const el = (await k.chiama('GET', '/api/backup')).json.elenco; assert.equal(el.filter(b => b.tipo === 'sicurezza').length, 2);
  } finally { await k.chiudi(); k.db.close(); }
});

test('backup: solo il titolare; cartella esterna validata; prima di cambiare lo schema una copia', async () => {
  const k = await avvia();
  try {
    assert.equal((await k.chiama('POST', '/api/utenti', { nome: 'Commessa', email: 'c@prova.it', password: 'password-lunga', ruolo: 'collaboratore' })).stato, 200);
    const tit = k.biscotto(); k.usa('');
    assert.equal((await k.chiama('POST', '/api/accedi', { email: 'c@prova.it', password: 'password-lunga' })).stato, 200);
    for (const [m, p] of [['GET', '/api/backup'], ['POST', '/api/backup'], ['POST', '/api/backup/ripristina'], ['PUT', '/api/backup/cartella'], ['POST', '/api/backup/carica'], ['PUT', '/api/aggiornamenti']])
      assert.equal((await k.chiama(m, p, m === 'GET' ? undefined : {})).stato, 403, `${m} ${p}`);
    assert.equal((await k.chiama('GET', '/api/desktop/rete')).stato, 200, 'gli indirizzi li vede chiunque ha l\'accesso');
    k.usa(tit);
    assert.equal((await k.chiama('PUT', '/api/backup/cartella', { cartella: 'relativa/x' })).stato, 400);
    assert.equal((await k.chiama('PUT', '/api/backup/cartella', { cartella: join(k.cartella, 'file') })).stato, 400, 'non dentro i dati');
    const fuori = temp(), su = await k.chiama('PUT', '/api/backup/cartella', { cartella: join(fuori, 'sotto', '..', 'Kubo') });
    assert.equal(su.stato, 200, JSON.stringify(su.json)); assert.equal(su.json.cartella, join(fuori, 'Kubo')); assert.equal(su.json.elenco.length, 1, 'una prima copia subito');
    // prima di una modifica allo schema: una copia «modifica»
    const def = (await k.chiama('GET', '/api/schema')).json.find(e => e.id === 'clienti');
    const ok = await k.chiama('PUT', '/api/schema/clienti', { ...def, campi: [...def.campi, { id: 'nota_prova', nome: 'Nota', tipo: 'testo' }] }); assert.equal(ok.stato, 200, JSON.stringify(ok.json));
    const el = (await k.chiama('GET', '/api/backup')).json.elenco; assert.equal(el.filter(b => b.tipo === 'modifica').length, 1);
    const prima = new DatabaseSync(join(fuori, 'Kubo', el.find(b => b.tipo === 'modifica').nome), { readOnly: true });
    assert.ok(!JSON.parse(prima.prepare("SELECT def FROM _entita WHERE id = 'clienti'").get().def).campi.some(c => c.id === 'nota_prova'), 'la copia è di prima della modifica'); prima.close();
    // si torna alla cartella accanto ai dati
    assert.equal((await k.chiama('PUT', '/api/backup/cartella', { cartella: '' })).json.esterna, false);
  } finally { await k.chiudi(); k.db.close(); }
});

test('carica un backup da fuori: a pezzi, controllato, poi ripristinabile; un file qualsiasi è rifiutato', async () => {
  const sorgente = await avvia(); let buf;
  try { await sorgente.chiama('POST', '/api/dati/clienti', { nome: 'Da Un Altro PC' }); const b = (await sorgente.chiama('POST', '/api/backup')).json.backup;
    buf = readFileSync(join(sorgente.cartella, 'backup', b.nome)); } finally { await sorgente.chiudi(); sorgente.db.close(); }
  const k = await avvia();
  try {
    const manda = async (dati) => {
      const a = await k.chiama('POST', '/api/backup/carica', { nome: 'x.db', dimensione: dati.length }); if (a.stato !== 200) return a;
      let da = 0, ult; const passo = Math.ceil(dati.length / 3);
      while (da < dati.length) { const p = dati.subarray(da, da + passo); ult = await k.chiama('POST', `/api/backup/carica/${a.json.id}`, { da, pezzo: p.toString('base64') }); if (ult.stato !== 200) return ult; da += p.length; }
      return ult;
    };
    const male = await manda(Buffer.alloc(4096, 7)); assert.equal(male.stato, 400); assert.match(male.json.errore, /non è un backup/);
    const su = await manda(buf); assert.equal(su.stato, 200, JSON.stringify(su.json)); assert.equal(su.json.completo, true); assert.match(su.json.nome, /-caricato\.db$/);
    assert.equal(su.json.info.azienda, 'Bottega Prova');
    const rip = await k.chiama('POST', '/api/backup/ripristina', { nome: su.json.nome, conferma: true }); assert.equal(rip.stato, 200, JSON.stringify(rip.json));
    // la sessione di questo PC non esiste nel backup dell'altro: si rientra con l'utente di lì
    const dopo = await k.chiama('GET', '/api/dati/clienti'); assert.equal(dopo.stato, 401);
    assert.equal((await k.chiama('POST', '/api/accedi', { email: 't@prova.it', password: 'password-lunga' })).stato, 200);
    assert.deepEqual(await nomi(k), ['Da Un Altro PC']);
    assert.ok(!readdirSync(join(k.cartella)).some(f => f.startsWith('.ripristino-')), 'nessun file provvisorio lasciato');
  } finally { await k.chiudi(); k.db.close(); }
});

test('aggiornamenti: confronto delle versioni e controllo con un finto server, senza mai installare', async () => {
  assert.equal(confronta('v0.2.0', '0.1.9'), 1); assert.equal(confronta('0.10.0', '0.9.9'), 1); assert.equal(confronta('1.0.0', '1.0.0'), 0);
  assert.equal(confronta('1.0.0-beta.1', '1.0.0'), -1); assert.equal(confronta('0.1.0', '0.1.1'), -1);
  let risposta = { tag_name: 'v0.3.0', name: 'Kubo 0.3', html_url: 'https://github.com/W1kicartel/kubo/releases/tag/v0.3.0', body: 'Novità', draft: false, prerelease: false }, stato = 200, chieste = 0;
  const finto = createServer((req, res) => { chieste++; assert.match(req.headers['user-agent'], /^Kubo\//); res.writeHead(stato, { 'Content-Type': 'application/json' }).end(JSON.stringify(risposta)); });
  await new Promise(r => finto.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${finto.address().port}/latest`;
  try {
    const x = await controlla('0.1.0', { url }); assert.equal(x.nuova, true); assert.equal(x.ultima.versione, '0.3.0'); assert.equal(x.ultima.url, risposta.html_url);
    assert.equal((await controlla('0.3.0', { url })).nuova, false);
    risposta = { ...risposta, html_url: 'javascript:alert(1)' }; assert.equal((await controlla('0.1.0', { url })).ultima.url, 'https://github.com/W1kicartel/kubo/releases');
    stato = 500; await assert.rejects(controlla('0.1.0', { url }), /500/);
    // dal server: il titolare lo accende, il controllo passa dal finto server, l'esito resta salvato
    stato = 200; process.env.KUBO_AGGIORNAMENTI_URL = url;
    const k = await avvia();
    try {
      const su = await k.chiama('PUT', '/api/aggiornamenti', { attivo: true }); assert.equal(su.stato, 200, JSON.stringify(su.json));
      assert.equal(su.json.attivo, true); assert.equal(su.json.esito.nuova, true); assert.ok(chieste >= 5);
      stato = 404; const giu = await k.chiama('POST', '/api/aggiornamenti/controlla'); assert.match(giu.json.esito.errore, /404/);
    } finally { await k.chiudi(); k.db.close(); delete process.env.KUBO_AGGIORNAMENTI_URL; }
  } finally { finto.close(); }
});

test('modalità desktop: Kubo si accende come nell\'app (senza finestre), porta occupata → la successiva, si spegne pulito', async () => {
  const cartella = temp(), occupa = createServer(); await new Promise(r => occupa.listen(0, '127.0.0.1', r)); const porta = occupa.address().port;
  const k = await accendi({ radice: RADICE, cartella, porta, rete: false });
  try {
    assert.ok(k.porta > porta && k.porta <= porta + 10); assert.ok(existsSync(join(cartella, 'kubo.db')));
    const s = await (await fetch(k.url + 'api/stato')).json(); assert.equal(s.configurato, false);
    const pagina = await (await fetch(k.url)).text(); assert.match(pagina, /<div id="app">/);
    const ok = await fetch(k.url + 'api/configura', { method: 'POST', headers: { 'X-Kubo': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ azienda: 'Desktop', nome: 'T', email: 'd@prova.it', password: 'password-lunga', modelli: [] }) });
    assert.equal(ok.status, 200);
    const rete = await (await fetch(k.url + 'api/desktop/rete', { headers: { Cookie: ok.headers.get('set-cookie').split(';')[0] } })).json();
    assert.equal(rete.inRete, false); assert.equal(rete.porta, k.porta);
  } finally { await k.chiudi(); occupa.close(); }
  // si riaccende sugli stessi dati
  const di_nuovo = await accendi({ radice: RADICE, cartella, porta: 0, rete: false });
  try { assert.equal((await (await fetch(di_nuovo.url + 'api/stato')).json()).azienda, 'Desktop'); } finally { await di_nuovo.chiudi(); }
});
