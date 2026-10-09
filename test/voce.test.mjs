// La voce locale di Lumi senza il modello vero: un finto lumi-voce (uno script Node con lo stesso protocollo a righe JSON)
// fa la parte di Parakeet. Si provano l'endpoint (autenticazione, X-Lumi, Lumi spento, limiti di dimensione e durata,
// limite al minuto), la fila (una trascrizione alla volta, nello stesso ordine), il processo che cade, i file
// temporanei sempre cancellati, la scelta del motore, il download del modello ONNX con le impronte, il ricampionamento
// del browser e la regola della lingua nelle istruzioni di Lumi. La prova con Parakeet vero è test/voce-vera.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import { scegliMotore, pulisciRimasti, creaVoceLocale, daByte, MAX_BYTE } from '../server/moduli/lumi/voce.js';
import * as ONNX from '../server/moduli/lumi/voce-onnx.js';
import { finestre } from '../server/moduli/lumi/voce-onnx-motore.js';
import { sistema } from '../server/moduli/lumi/nucleo.js';
import { ricampiona, unisci } from '../web/lumi/voce.js';

attiva();
delete process.env.ANTHROPIC_API_KEY; delete process.env.DEEPGRAM_API_KEY; delete process.env.LUMI_DOMANDE_MINUTO; delete process.env.LUMI_VOCE;
const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'lumi-voce-prova-')), temp = join(dir, 'temp'), FINTO = join(dir, 'finto-voce'), REGISTRO = join(dir, 'registro.txt');

// Il finto lumi-voce. Il primo campione dice cosa fare: 7 → cade senza rispondere, 9 → risponde con un errore,
// 5 → ci mette 150 ms. Non cancella il file (lo deve fare il server) e segna nel registro le richieste che si sovrappongono.
const SCRIPT = `#!${process.execPath}
const { readFileSync, appendFileSync } = require('node:fs');
const REG = ${JSON.stringify(REGISTRO)};
let occupato = false, resto = '';
console.log(JSON.stringify({ evento: 'pronto', sec: 0 }));
process.stdin.on('data', b => {
  resto += b; let i;
  while ((i = resto.indexOf('\\n')) >= 0) {
    const j = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1);
    if (occupato) appendFileSync(REG, 'sovrapposte\\n');
    occupato = true;
    const d = readFileSync(j.file), a = new Float32Array(d.buffer, d.byteOffset, d.length / 4);
    appendFileSync(REG, 'richiesta ' + j.id + ' ' + a.length + '\\n');
    if (a[0] === 7) process.exit(3);
    const fine = () => { occupato = false; console.log(JSON.stringify(a[0] === 9 ? { id: j.id, errore: 'audio rotto' } : { id: j.id, testo: ' campioni ' + a.length + ' ', sec: 0 })); };
    a[0] === 5 ? setTimeout(fine, 150) : fine();
  }
});
`;
const audio = (secondi, primo = 0) => { const a = new Float32Array(Math.round(secondi * 16000)); a[0] = primo; return Buffer.from(a.buffer); };
let k;
// il motore finto è uno script con «#!»: Windows non lo esegue direttamente (lì la voce locale è sherpa-onnx, provato a parte)
const SOLO_POSIX = process.platform === 'win32' && 'su Windows il motore finto con #! non si esegue';

async function avvia(db = apri()) {
  const srv = creaServer(db); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; let biscotto = '';
  const chiama = async (metodo, percorso, corpo) => {
    const r = await fetch(base + percorso, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  const voce = async (corpo, { xLumi = true, cookie = true } = {}) => {
    const r = await fetch(base + '/api/lumi/voce/trascrivi', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(xLumi ? { 'X-Lumi': '1' } : {}), ...(cookie && biscotto ? { Cookie: biscotto } : {}) }, body: corpo });
    return { stato: r.status, json: await r.json().catch(() => null) };
  };
  const accedi = (email, password) => { biscotto = ''; return chiama('POST', '/api/accedi', { email, password }); };
  return { srv, chiama, voce, accedi, chiudi: () => new Promise(r => srv.close(r)) };
}

before(async () => {
  writeFileSync(FINTO, SCRIPT); chmodSync(FINTO, 0o755);
  process.env.LUMI_VOCE_BINARIO = FINTO; process.env.LUMI_VOCE_TEMP = temp;
  (await import('node:fs')).mkdirSync(temp);
  k = await avvia();
  assert.equal((await k.chiama('POST', '/api/configura', { azienda: 'Bottega Voce', nome: 'Titolare', email: 'titolare@esempio.it', password: 'prova-lumi-1', modelli: [] })).stato, 200);
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { limite: 600 })).stato, 200);
});
after(async () => {
  await k?.chiudi();
  delete process.env.LUMI_VOCE_BINARIO; delete process.env.LUMI_VOCE_TEMP;
  rmSync(dir, { recursive: true, force: true });
});
const registro = () => (existsSync(REGISTRO) ? readFileSync(REGISTRO, 'utf8') : '');
const nelTemp = () => readdirSync(temp);

test('lo stato di Lumi dice che motore c\'è e, dopo averlo preparato, che la voce locale è pronta', { skip: SOLO_POSIX }, async () => {
  let s = (await k.chiama('POST', '/api/lumi', { azione: 'stato' })).json;
  assert.equal(s.voceMotore, 'mac');
  for (let i = 0; i < 50 && !s.voceLocale; i++) { await new Promise(r => setTimeout(r, 40)); s = (await k.chiama('POST', '/api/lumi', { azione: 'stato' })).json; }
  assert.equal(s.voceLocale, true);
  assert.equal(s.claude, false);   // la voce locale non ha bisogno della chiave di Claude
  assert.equal((await k.chiama('GET', '/api/lumi/impostazioni')).json.voceLocale, 'mac');
});

test('trascrive: il testo torna senza spazi attorno, e il file temporaneo (0600) non resta mai', { skip: SOLO_POSIX }, async () => {
  const r = await k.voce(audio(1));
  assert.equal(r.stato, 200);
  assert.deepEqual(r.json, { testo: 'campioni 16000', motore: 'mac' });
  assert.deepEqual(nelTemp(), []);
  assert.match(registro(), /richiesta \d+ 16000/);
});

test('autenticazione e permessi: senza accesso 401, senza X-Lumi 403, con Lumi spento 400', { skip: SOLO_POSIX }, async () => {
  assert.equal((await k.voce(audio(1), { cookie: false })).stato, 401);
  assert.equal((await k.voce(audio(1), { xLumi: false })).stato, 403);
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { attivo: false })).stato, 200);
  const spento = await k.voce(audio(1));
  assert.equal(spento.stato, 400); assert.match(spento.json.errore, /Lumi è spento/);
  assert.equal((await k.chiama('POST', '/api/lumi', { azione: 'stato' })).json.voceLocale, false);
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { attivo: true })).stato, 200);
  // un collaboratore la usa come chiunque usi Lumi
  assert.equal((await k.chiama('POST', '/api/utenti', { nome: 'Marta', email: 'marta@esempio.it', password: 'prova-marta-1', ruolo: 'collaboratore' })).stato, 200);
  await k.accedi('marta@esempio.it', 'prova-marta-1');
  assert.equal((await k.voce(audio(0.5))).stato, 200);
  await k.accedi('titolare@esempio.it', 'prova-lumi-1');
});

test('limiti: vuoto o non float32 → 400, oltre 60 secondi → 413 (e il corpo non arriva al motore)', { skip: SOLO_POSIX }, async () => {
  const prima = registro();
  assert.equal((await k.voce(Buffer.alloc(0))).stato, 400);
  assert.equal((await k.voce(Buffer.alloc(10))).stato, 400);
  assert.equal(MAX_BYTE, 60 * 16000 * 4);
  const lungo = await k.voce(audio(60.5));
  assert.equal(lungo.stato, 413); assert.match(lungo.json.errore, /60 secondi/);
  assert.equal((await k.voce(audio(60))).stato, 200);   // un minuto esatto passa
  assert.equal(registro().split('\n').length - prima.split('\n').length, 1);
  assert.deepEqual(nelTemp(), []);
});

test('la fila: richieste insieme passano una alla volta, ognuna con la sua risposta', { skip: SOLO_POSIX }, async () => {
  writeFileSync(REGISTRO, '');
  const rr = await Promise.all([0.5, 0.75, 1, 1.25].map(s => k.voce(audio(s, 5))));
  assert.deepEqual(rr.map(r => r.stato), [200, 200, 200, 200]);
  assert.deepEqual(rr.map(r => r.json.testo), ['campioni 8000', 'campioni 12000', 'campioni 16000', 'campioni 20000']);
  assert.doesNotMatch(registro(), /sovrapposte/);
  assert.deepEqual(nelTemp(), []);
});

test('oltre quattro in fila: «occupata» (503), le altre finiscono', { skip: SOLO_POSIX }, async () => {
  const rr = await Promise.all([...Array(7)].map(() => k.voce(audio(0.5, 5))));
  const stati = rr.map(r => r.stato).sort();
  assert.ok(stati.filter(s => s === 200).length >= 4, stati.join());
  assert.ok(stati.includes(503), stati.join());
  assert.match(rr.find(r => r.stato === 503).json.errore, /occupata/);
  assert.deepEqual(nelTemp(), []);
});

test('il motore che sbaglia o cade: 502, file cancellato, e la richiesta dopo riparte con un processo nuovo', { skip: SOLO_POSIX }, async () => {
  const rotto = await k.voce(audio(1, 9));
  assert.equal(rotto.stato, 502); assert.match(rotto.json.errore, /non ha risposto/);
  const caduto = await k.voce(audio(1, 7));
  assert.equal(caduto.stato, 502);
  assert.deepEqual(nelTemp(), []);
  const dopo = await k.voce(audio(1));
  assert.equal(dopo.stato, 200); assert.equal(dopo.json.testo, 'campioni 16000');
});

test('limite al minuto per persona, lo stesso delle domande', { skip: SOLO_POSIX }, async () => {
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { limite: 1 })).stato, 200);
  const rr = [];
  for (let i = 0; i < 3; i++) rr.push((await k.voce(audio(0.5))).stato);
  assert.ok(rr.includes(429), rr.join());
  assert.equal((await k.chiama('PUT', '/api/lumi/impostazioni', { limite: 600 })).stato, 200);
});

test('senza motore la voce locale non c\'è: 503, e lo stato lo dice', async () => {
  delete process.env.LUMI_VOCE_BINARIO; process.env.LUMI_VOCE = 'no';
  const k3 = await avvia();
  try {
    await k3.chiama('POST', '/api/configura', { azienda: 'Senza voce', nome: 'T', email: 't@esempio.it', password: 'prova-lumi-1', modelli: [] });
    const s = (await k3.chiama('POST', '/api/lumi', { azione: 'stato' })).json;
    assert.equal(s.voceLocale, false); assert.equal(s.voceMotore, null);
    const r = await k3.voce(audio(1));
    assert.equal(r.stato, 503); assert.match(r.json.errore, /non c'è/);
  } finally { await k3.chiudi(); process.env.LUMI_VOCE_BINARIO = FINTO; delete process.env.LUMI_VOCE; }
});

test('i messaggi della voce si traducono nella lingua di chi usa Lumi', async () => {
  const L = await import('../server/moduli/lingue.js');
  assert.equal(L.traduci('Audio troppo lungo: al massimo 60 secondi', 'de'), 'Audio zu lang: höchstens 60 Sekunden');
  assert.equal(L.traduci('La voce locale è occupata: riprova fra poco', 'en'), 'Local voice is busy: try again shortly');
});

test('scelta del motore: Mac con chip Apple, programma indicato, Lode in ripiego, ONNX, niente', () => {
  const radice = '/lumi', esiste = f => f === '/lumi/desktop/bin/lumi-voce';
  const base = { radice, env: {}, esiste, sherpa: false, memoria: 16 * 2 ** 30, cartellaModello: '/dati/voce-onnx' };
  assert.deepEqual(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64' }), { motore: 'mac', binario: '/lumi/desktop/bin/lumi-voce' });
  assert.deepEqual(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64', esiste: f => f === '/lumi/bin/lumi-voce' }), { motore: 'mac', binario: '/lumi/bin/lumi-voce' });   // nell'app
  assert.equal(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'x64' }), null);   // Mac Intel: lumi-voce non gira
  assert.equal(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64', env: { LUMI_VOCE: 'no' } }), null);
  assert.equal(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64', env: { NODE_TEST_CONTEXT: 'child' } }), null);
  // il lode-voce di Lode, se Lumi non ha il suo
  assert.deepEqual(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64', esiste: f => f === '/Applications/Lode.app/Contents/Resources/bin/lode-voce' }),
    { motore: 'lode', binario: '/Applications/Lode.app/Contents/Resources/bin/lode-voce' });
  assert.equal(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64', env: { LUMI_VOCE_BINARIO: '/lode/desktop/bin/lode-voce' }, esiste: () => true }).motore, 'lode');
  // un programma indicato vale ovunque
  assert.deepEqual(scegliMotore({ ...base, piattaforma: 'linux', arch: 'x64', env: { LUMI_VOCE_BINARIO: '/x/finto' }, esiste: () => true }), { motore: 'mac', binario: '/x/finto' });
  // altrove: ONNX solo con sherpa-onnx-node, la cartella del modello e abbastanza memoria (o LUMI_VOCE=onnx)
  assert.equal(scegliMotore({ ...base, piattaforma: 'linux', arch: 'x64' }), null);
  assert.deepEqual(scegliMotore({ ...base, piattaforma: 'win32', arch: 'x64', sherpa: true }), { motore: 'onnx', cartella: '/dati/voce-onnx' });
  assert.equal(scegliMotore({ ...base, piattaforma: 'linux', arch: 'x64', sherpa: true, memoria: 4 * 2 ** 30 }), null);
  assert.equal(scegliMotore({ ...base, piattaforma: 'linux', arch: 'x64', sherpa: true, memoria: 4 * 2 ** 30, env: { LUMI_VOCE: 'onnx' } }).motore, 'onnx');
  assert.equal(scegliMotore({ ...base, piattaforma: 'linux', arch: 'x64', sherpa: true, cartellaModello: null }), null);   // database in memoria
  assert.deepEqual(scegliMotore({ ...base, piattaforma: 'darwin', arch: 'arm64', sherpa: true, env: { LUMI_VOCE: 'onnx' } }), { motore: 'onnx', cartella: '/dati/voce-onnx' });
});

test('i file audio lasciati da Lumi chiuso di colpo si tolgono all\'avvio (solo quelli dei processi morti)', () => {
  const d = mkdtempSync(join(dir, 'rimasti-'));
  writeFileSync(join(d, 'lumi-voce-999999-1.f32'), 'x'); writeFileSync(join(d, `lumi-voce-${process.pid}-1.f32`), 'x'); writeFileSync(join(d, 'altro.f32'), 'x');
  assert.equal(pulisciRimasti(d), 1);
  assert.deepEqual(readdirSync(d).sort(), ['altro.f32', `lumi-voce-${process.pid}-1.f32`]);
});

test('creaVoceLocale da sola: senza motore rifiuta, con il finto risponde in ordine, e il riposo chiude il processo', { skip: SOLO_POSIX }, async () => {
  const niente = creaVoceLocale({ scelta: null });
  assert.equal(niente.disponibile(), false);
  await assert.rejects(niente.trascrivi(new Float32Array(10)), /assente/);
  const v = creaVoceLocale({ scelta: { motore: 'mac', binario: FINTO }, temp, riposo: 30 });
  assert.equal(await v.prepara(), true);
  assert.deepEqual(await Promise.all([8000, 9000, 10000].map(n => v.trascrivi(new Float32Array(n)))), ['campioni 8000', 'campioni 9000', 'campioni 10000']);
  assert.equal(v.pronta(), true);
  await new Promise(r => setTimeout(r, 120));   // dopo il riposo il processo si chiude; la prossima frase lo riaccende
  assert.equal(v.pronta(), false);
  assert.equal(await v.trascrivi(new Float32Array(8000)), 'campioni 8000');
  v.chiudi();
  assert.deepEqual(nelTemp(), []);
});

test('Float32Array dai byte del corpo, anche se il Buffer non è allineato', () => {
  const b = Buffer.alloc(13); const f = new Float32Array([0.5, -0.25, 1]); Buffer.from(f.buffer).copy(b, 1);
  assert.deepEqual([...daByte(b.subarray(1))], [0.5, -0.25, 1]);
});

test('il modello ONNX: si scarica con le impronte, riprende, rifiuta i byte sbagliati, non riscarica', async () => {
  const d = mkdtempSync(join(dir, 'onnx-')), giusto = Buffer.from('parakeet finto');
  const modello = { base: 'https://esempio.test/', file: [{ nome: 'tokens.txt', byte: giusto.length, sha256: createHash('sha256').update(giusto).digest('hex') }] };
  let chiamate = 0;
  const rete = async (url, o) => { chiamate++; const da = Number(/bytes=(\d+)-/.exec(o.headers.Range || '')?.[1] || 0); return new Response(giusto.subarray(da), da ? { status: 206, headers: { 'content-range': `bytes ${da}-${giusto.length - 1}/${giusto.length}` } } : { status: 200 }); };
  writeFileSync(join(d, 'tokens.txt.parziale'), giusto.subarray(0, 5));   // un download interrotto a metà
  assert.deepEqual(await ONNX.scaricaModello({ cartella: d, rete, modello, verificati: new Map() }), { scaricati: 1 });
  assert.deepEqual(readFileSync(join(d, 'tokens.txt')), giusto);
  assert.deepEqual(await ONNX.scaricaModello({ cartella: d, rete, modello, verificati: new Map() }), { scaricati: 0 });   // c'è già e torna
  assert.equal(chiamate, 1);
  rmSync(join(d, 'tokens.txt'));
  await assert.rejects(ONNX.scaricaModello({ cartella: d, rete: async () => new Response('byte sbagliati!'), modello, verificati: new Map() }), e => e.codice === 'impronta');
  assert.equal(existsSync(join(d, 'tokens.txt')), false);
  await assert.rejects(ONNX.scaricaModello({ cartella: d, rete, modello, verificati: new Map(), libero: () => 10 }), e => e.codice === 'spazio');
  // il modello vero: quattro file, ~640 MB, da un commit fisso
  assert.equal(ONNX.MODELLO.file.length, 4);
  assert.match(ONNX.MODELLO.base, /\/resolve\/[0-9a-f]{40}\/$/);
  assert.ok(ONNX.MODELLO.file.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
});

test('il motore ONNX con un processo finto: addon, modello, trascrizione in memoria; senza addon si ferma prima del modello', async () => {
  const d = mkdtempSync(join(dir, 'onnx2-')), giusto = Buffer.from('t');
  const modello = { base: 'x/', file: [{ nome: 'tokens.txt', byte: 1, sha256: createHash('sha256').update(giusto).digest('hex') }] };
  writeFileSync(join(d, 'tokens.txt'), giusto);
  const finto = ({ addonOk = true } = {}) => () => {
    const su = {};
    return { su: (ev, f) => { su[ev] = f; }, uccidi: () => su.uscita?.(null),
      manda: m => setTimeout(() => {
        if (m.tipo === 'addon') su.messaggio(addonOk ? { evento: 'addon' } : { evento: 'errore', codice: 'addon', errore: 'manca' });
        else if (m.tipo === 'carica') su.messaggio({ evento: 'pronto' });
        else if (m.tipo === 'trascrivi') su.messaggio({ id: m.id, testo: `ok ${m.audio.length}` });
      }, 1) };
  };
  const m = ONNX.crea({ cartella: d, avvia: finto(), modello, rete: async () => { throw new Error('niente rete'); } });
  assert.equal(await m.trascrivi(new Float32Array(321)), 'ok 321');
  m.chiudi();
  const senza = ONNX.crea({ cartella: d, avvia: finto({ addonOk: false }), modello });
  await assert.rejects(senza.avvia(), e => e.codice === 'addon');
  assert.deepEqual(finestre(16000 * 10, new Float32Array(16000 * 10)), [[0, 160000]]);
  assert.equal(finestre(16000 * 70, new Float32Array(16000 * 70)).length, 3);
});

test('il browser ricampiona a 16 kHz mono e unisce i pezzi fino a un minuto', () => {
  const a48 = new Float32Array(48000).fill(0.5);
  const r = ricampiona(a48, 48000);
  assert.equal(r.length, 16000); assert.ok(Math.abs(r[100] - 0.5) < 1e-6);
  assert.equal(ricampiona(new Float32Array(44100), 44100).length, 16000);
  assert.equal(ricampiona(new Float32Array(16000), 16000).length, 16000);
  // una sinusoide a 1 kHz resta (ampiezza quasi piena), una a 20 kHz si spegne quasi del tutto
  const seno = f => Float32Array.from({ length: 48000 }, (_, i) => Math.sin(2 * Math.PI * f * i / 48000));
  const picco = x => Math.max(...x.slice(100, 15900).map(Math.abs));
  assert.ok(picco(ricampiona(seno(1000), 48000)) > 0.9);
  assert.ok(picco(ricampiona(seno(20000), 48000)) < 0.35);
  assert.deepEqual([...unisci([Float32Array.of(1, 2), Float32Array.of(3, 4, 5)])], [1, 2, 3, 4, 5]);
  assert.deepEqual([...unisci([Float32Array.of(1, 2), Float32Array.of(3, 4, 5)], 3)], [1, 2, 3]);
});

test('Lumi risponde nella lingua di chi gli scrive o parla, in tutte le varianti delle istruzioni', () => {
  assert.match(sistema({ lingua: 'it' }), /Rispondi nella lingua in cui ti scrivono o ti parlano/);
  for (const l of ['en', 'es', 'fr', 'de', 'pt']) assert.match(sistema({ lingua: l }), /Reply in the language the person writes or speaks to you in/);
  assert.match(sistema({ lingua: 'de' }), /When it is unclear, reply in German/);
});

test('sherpa-onnx-node è solo facoltativo, con la versione esatta; lumi-voce finisce nel pacchetto del Mac', () => {
  const p = JSON.parse(readFileSync(join(RADICE, 'package.json'), 'utf8'));
  assert.equal(p.dependencies, undefined);
  assert.deepEqual(p.optionalDependencies, { 'sherpa-onnx-node': ONNX.VERSIONE_SHERPA });
  const d = JSON.parse(readFileSync(join(RADICE, 'desktop', 'package.json'), 'utf8')).build;
  assert.ok(d.mac.extraResources.some(x => x.from === 'bin' && x.to === 'lumi/bin' && x.filter.includes('lumi-voce')));
  assert.equal(d.mac.x64ArchFiles, 'Contents/Resources/lumi/bin/lumi-voce');
  assert.ok(d.mac.extendInfo.NSMicrophoneUsageDescription);
  // il binario compilato non va nel repository
  assert.match(readFileSync(join(RADICE, '.gitignore'), 'utf8'), /^desktop\/bin\/$/m);
  if (process.platform !== 'win32') assert.ok(statSync(join(RADICE, 'desktop', 'voce-mac', 'compila.sh')).mode & 0o100);   // su Windows niente bit di esecuzione
});
