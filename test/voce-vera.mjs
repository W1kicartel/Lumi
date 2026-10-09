// La prova VERA della voce locale, su un Mac con chip Apple e lumi-voce compilato (desktop/voce-mac/compila.sh):
//   node test/voce-vera.mjs
// Genera tre frasi con la sintesi del Mac («say» scrive in un file: dagli altoparlanti non esce niente, il microfono non
// si usa), in russo (Milena), tedesco (Anna) e italiano (Alice); le converte in float32 mono 16 kHz con afconvert; accende
// Lumi vero in una cartella temporanea, fa il primo avvio, e le manda a POST /api/lumi/voce/trascrivi. Controlla che
// il testo contenga le parole attese. L'audio generato resta nella cartella temporanea, che alla fine si cancella.
// Non è in «npm test»: serve il Mac, il programma compilato e il modello (~460 MB, scaricato da FluidAudio al primo uso).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRASI = [
  { lingua: 'russo', voce: 'Milena', testo: 'Покажи мне продажи за эту неделю.', attese: ['продаж', 'недел'] },
  { lingua: 'tedesco', voce: 'Anna', testo: 'Wie viele Kunden haben wir heute?', attese: ['kunden', 'heute'] },
  { lingua: 'italiano', voce: 'Alice', testo: 'Aggiungi la taglia agli articoli del magazzino.', attese: ['taglia', 'articoli', 'magazzino'] },
];
const PORTA = 4380 + 100 + Math.floor(Math.random() * 400);
const dir = mkdtempSync(join(tmpdir(), 'lumi-voce-vera-'));
let server = null;
const fine = codice => { try { server?.kill(); } catch { /* niente */ } rmSync(dir, { recursive: true, force: true }); process.exit(codice); };
setTimeout(() => { console.error('PROVA SCADUTA (5 minuti)'); fine(2); }, 5 * 6e4).unref();

// il blocco «data» di un WAV in float32: i byte sono già float32 little-endian
function datiWav(file) {
  const b = readFileSync(file); let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4), n = b.readUInt32LE(i + 4);
    if (id === 'data') return b.subarray(i + 8, i + 8 + n);
    i += 8 + n + (n % 2);
  }
  throw new Error('WAV senza dati');
}

try {
  const audio = FRASI.map((f, i) => {
    const aiff = join(dir, `prova-${i}.aiff`), wav = join(dir, `prova-${i}.wav`);
    execFileSync('say', ['-v', f.voce, '-o', aiff, f.testo]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEF32@16000', '-c', '1', aiff, wav]);
    return datiWav(wav);
  });
  server = spawn(process.execPath, [join(RADICE, 'server', 'avvia.js'), '--porta', String(PORTA), '--dati', join(dir, 'dati')], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, NODE_ENV: 'test', NODE_TEST_CONTEXT: '' } });
  await new Promise((ok, ko) => { server.stdout.on('data', b => { if (/acceso/.test(String(b))) ok(); }); server.on('exit', c => ko(new Error('server chiuso ' + c))); });
  const base = `http://127.0.0.1:${PORTA}`;
  const r = await fetch(base + '/api/configura', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lumi': '1' }, body: JSON.stringify({ azienda: 'Prova voce', nome: 'Titolare', email: 'titolare@prova.test', password: 'prova-voce-locale', modelli: [] }) });
  const cookie = String(r.headers.get('set-cookie')).split(';')[0];
  const h = { 'X-Lumi': '1', Cookie: cookie };
  // lo stato accende la voce in sottofondo: si aspetta che sia pronta (al massimo 3 minuti, se il modello va scaricato)
  const t0 = Date.now(); let s;
  for (;;) {
    s = await (await fetch(base + '/api/lumi', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ azione: 'stato' }) })).json();
    if (s.voceLocale || !s.voceMotore || Date.now() - t0 > 18e4) break;
    await new Promise(ok => setTimeout(ok, 1000));
  }
  console.log(`motore: ${s.voceMotore}, pronta: ${s.voceLocale} dopo ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!s.voceLocale) throw new Error('la voce locale non è pronta: ' + JSON.stringify(s));
  let errori = 0;
  for (const [i, f] of FRASI.entries()) {
    const t = Date.now();
    const x = await fetch(base + '/api/lumi/voce/trascrivi', { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: audio[i] });
    const j = await x.json();
    const testo = String(j.testo || '').toLowerCase(), mancano = f.attese.filter(p => !testo.includes(p));
    const ok = x.ok && !mancano.length; if (!ok) errori++;
    console.log(`${ok ? 'OK ' : 'NO '} ${f.lingua.padEnd(8)} ${(audio[i].length / 64000).toFixed(1)} s audio, ${Date.now() - t} ms → «${j.testo ?? j.errore}»${mancano.length ? ` (mancano: ${mancano.join(', ')})` : ''}`);
  }
  console.log(errori ? `PROVA VOCE: ${errori} su ${FRASI.length} sbagliate` : 'PROVA VOCE OK');
  fine(errori ? 1 : 0);
} catch (e) { console.error('PROVA VOCE FALLITA:', e.message); fine(1); }
