// La voce locale dell'assistente: Parakeet TDT 0.6B v3 di NVIDIA, sul computer dove gira Lumi. Gratis, senza mandare l'audio fuori,
// e in una qualsiasi delle 25 lingue europee del modello, riconosciuta da sola (niente lingua fissa).
// Due motori, con lo stesso contratto (trascrivi(Float32Array mono 16 kHz) → testo):
//   • 'mac'  il programma lumi-voce (desktop/voce-mac, Swift + FluidAudio, sul Neural Engine), solo Mac con chip Apple.
//            Si cerca in LUMI_VOCE_BINARIO, poi accanto al server (desktop/bin in sviluppo, Resources/lumi/bin nell'app).
//   • 'lode' in ripiego il lode-voce di Lode (stesso protocollo), se Lumi non ha il suo. Attenzione: lode-voce filtra i
//            token sull'alfabeto latino (è fatto per l'italiano): le lingue in cirillico e il greco escono storpiate.
//   • 'onnx' altrove (Windows, Linux, Mac Intel): sherpa-onnx-node (dipendenza FACOLTATIVA, optionalDependencies) con il
//            modello int8 ONNX, ~640 MB scaricati al primo uso con le impronte fissate (./voce-onnx.js).
// Senza nessuno dei tre la voce locale semplicemente non c'è: il server parte lo stesso e il browser usa Deepgram o la
// voce del browser. LUMI_VOCE=no la spegne del tutto.
// Regole (come in Lode): un processo solo, avviato al primo uso e chiuso dopo un po' di riposo; una trascrizione alla
// volta, le altre in fila (al massimo maxCoda, poi «occupata»). Per lumi-voce l'audio passa da un file temporaneo 0600
// che si cancella SEMPRE: alla risposta, all'errore, se il processo cade, all'uscita; all'avvio si tolgono quelli
// lasciati da Lumi chiuso di colpo.
import { spawn as spawnNode } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir, totalmem } from 'node:os';
import { join, basename, posix } from 'node:path';
import * as ONNX from './voce-onnx.js';

export const SR = 16000;
export const MAX_SECONDI = 60;
export const MAX_BYTE = MAX_SECONDI * SR * 4;   // float32: 3.840.000 byte, sotto il limite di 5 MB dei corpi di Lumi

const cancella = f => { try { rmSync(f, { force: true }); } catch { /* niente */ } };
const errore = (messaggio, codice) => Object.assign(new Error(messaggio), { codice });

// i file audio rimasti quando Lumi si è chiuso di colpo: solo quelli di processi che non ci sono più
export function pulisciRimasti(dir = tmpdir()) {
  let nomi = []; try { nomi = readdirSync(dir); } catch { return 0; }
  let tolti = 0;
  for (const nome of nomi) {
    const m = nome.match(/^lumi-voce-(\d+)-\d+\.f32$/); if (!m) continue;
    let vivo = +m[1] === process.pid; if (!vivo) try { process.kill(+m[1], 0); vivo = true; } catch (e) { vivo = e.code === 'EPERM'; }
    if (!vivo) { cancella(join(dir, nome)); tolti++; }
  }
  return tolti;
}

// dove può essere il programma: prima quello indicato, poi quello di Lumi, poi quello di Lode
export function candidati({ radice, env = process.env, casa = homedir() }) {
  const l = [];
  if (env.LUMI_VOCE_BINARIO) l.push({ file: env.LUMI_VOCE_BINARIO, tipo: basename(env.LUMI_VOCE_BINARIO) === 'lode-voce' ? 'lode' : 'mac', indicato: true });
  // lumi-voce e lode-voce ci sono solo sul Mac: percorsi con «/» anche quando questo codice gira altrove (le prove su Windows)
  l.push({ file: posix.join(radice, 'desktop', 'bin', 'lumi-voce'), tipo: 'mac' }, { file: posix.join(radice, 'bin', 'lumi-voce'), tipo: 'mac' });
  for (const app of ['/Applications/Lode.app', posix.join(casa, 'Applications', 'Lode.app')]) l.push({ file: posix.join(app, 'Contents', 'Resources', 'bin', 'lode-voce'), tipo: 'lode' });
  return l;
}

// quale motore: 'mac' | 'lode' (con il loro file) | 'onnx' | null
export function scegliMotore({ piattaforma = process.platform, arch = process.arch, env = process.env, radice, esiste = existsSync, sherpa = ONNX.sherpaPresente(), memoria = totalmem(), cartellaModello }) {
  const v = String(env.LUMI_VOCE || '').toLowerCase();
  if (['no', '0', 'spenta', 'off'].includes(v)) return null;
  const mela = piattaforma === 'darwin' && arch === 'arm64';
  // nelle prove (node --test) conta solo il programma indicato con LUMI_VOCE_BINARIO: mai il Parakeet vero di questo computer
  if (env.NODE_TEST_CONTEXT && !env.LUMI_VOCE_BINARIO) return null;
  if (v !== 'onnx') for (const c of candidati({ radice, env })) {
    if (!esiste(c.file)) continue;
    if (c.indicato || mela) return { motore: c.tipo, binario: c.file };   // un programma indicato a mano vale ovunque (le prove)
  }
  if (sherpa && cartellaModello && (memoria >= ONNX.MEMORIA_MINIMA || v === 'onnx')) return { motore: 'onnx', cartella: cartellaModello };
  return null;
}

// il processo lumi-voce (o lode-voce): righe JSON su stdin e stdout
export function creaHelper({ binario, temp = tmpdir(), spawn = spawnNode }) {
  let proc = null, pronto = null, n = 0, resto = '';
  const attese = new Map();   // id → { ok, ko, file }
  pulisciRimasti(temp);
  const chiusa = (id, e, testo) => { const a = attese.get(id); if (!a) return; attese.delete(id); cancella(a.file); e ? a.ko(e) : a.ok(testo); };
  const chiudiTutte = e => { for (const id of [...attese.keys()]) chiusa(id, e); };
  function avvia() {
    if (pronto) return pronto;
    pronto = new Promise((ok, ko) => {
      let p;
      try { p = proc = spawn(binario, [], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { pronto = null; return ko(errore(e.message, 'avvio')); }
      // il processo non tiene acceso Node da solo (lo tiene il server HTTP; nelle prove, la richiesta in corso)
      p.unref?.(); for (const x of [p.stdin, p.stdout, p.stderr]) x?.unref?.();
      p.stderr?.on('data', () => { });   // i log di FluidAudio
      p.stdin.on('error', () => { });    // processo già chiuso: lo dice «exit»
      p.on('error', e => { ko(errore(e.message, 'avvio')); });
      p.stdout.on('data', b => {
        resto += b.toString(); let i;
        while ((i = resto.indexOf('\n')) >= 0) {
          const riga = resto.slice(0, i); resto = resto.slice(i + 1);
          let j; try { j = JSON.parse(riga); } catch { continue; }
          if (j.evento === 'pronto') ok(true);
          else if (j.evento === 'errore') ko(errore(j.errore, 'avvio'));
          else if (j.id && attese.has(j.id)) chiusa(j.id, j.errore ? errore(j.errore, 'audio') : null, j.testo || '');
        }
      });
      p.on('exit', c => {
        const e = errore(`lumi-voce si è chiuso (${c})`, 'crash'); ko(e);
        if (proc !== p) return;   // chiuso a riposo: ne è già partito un altro
        chiudiTutte(e); proc = null; pronto = null; resto = '';
      });
    });
    pronto.catch(() => { });
    return pronto;
  }
  async function trascrivi(audio) {
    await avvia();
    const id = String(++n), file = join(temp, `lumi-voce-${process.pid}-${id}.f32`);
    try { writeFileSync(file, Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength), { mode: 0o600 }); } catch (e) { cancella(file); throw e; }
    return new Promise((ok, ko) => {
      attese.set(id, { ok, ko, file });
      if (!proc) return chiusa(id, errore('lumi-voce chiuso', 'crash'));
      try { proc.stdin.write(JSON.stringify({ id, file }) + '\n'); } catch (e) { chiusa(id, errore(e.message, 'crash')); }
    });
  }
  const chiudi = () => { const p = proc; proc = null; pronto = null; resto = ''; chiudiTutte(errore('lumi-voce chiuso', 'chiusa')); try { p?.stdin.end(); p?.kill(); } catch { /* niente */ } };
  return { avvia, trascrivi, chiudi, attivo: () => !!proc, attese: () => attese.size };
}

// La voce locale vista da lumi.js: il motore scelto, la fila, il riposo.
//   disponibile()  c'è un motore su questo computer
//   pronta()       il motore è acceso e ha il modello in memoria (lo stato di Lumi lo dice al browser)
//   prepara()      lo accende in sottofondo (il browser lo chiede quando apre Lumi), senza aspettare
//   trascrivi(a)   Float32Array mono 16 kHz → testo, in fila
export function creaVoceLocale({ scelta = null, temp, spawn, avviaOnnx, rete, riposo = 10 * 6e4, maxCoda = 4 } = {}) {
  const motore = scelta?.motore || null;
  let eng = null, pronta = false, preparando = null, timer = null, fila = Promise.resolve(), inFila = 0, ultimoErrore = null;
  const nuovo = () => {
    if (motore === 'mac' || motore === 'lode') return creaHelper({ binario: scelta.binario, temp, spawn });
    if (motore === 'onnx') return ONNX.crea({ cartella: scelta.cartella, avvia: avviaOnnx, rete });
    return null;
  };
  const motoreDi = () => (eng ||= nuovo());
  function aRiposo() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!inFila) chiudi(); }, riposo); timer.unref?.();
  }
  function prepara() {
    if (!motore) return Promise.resolve(false);
    if (pronta) { aRiposo(); return Promise.resolve(true); }
    if (preparando) return preparando;
    preparando = motoreDi().avvia().then(() => { pronta = true; ultimoErrore = null; aRiposo(); return true; },
      e => { ultimoErrore = e; eng?.chiudi(); eng = null; return false; }).finally(() => { preparando = null; });
    return preparando;
  }
  function trascrivi(audio) {
    if (!motore) return Promise.reject(errore('voce locale assente', 'assente'));
    if (inFila >= maxCoda) return Promise.reject(errore('voce locale occupata', 'occupata'));
    inFila++; clearTimeout(timer);
    const giro = fila.then(async () => {
      const e = motoreDi();
      try { const testo = await e.trascrivi(audio); pronta = true; return String(testo || '').trim(); }
      catch (x) { if (x.codice === 'crash' || x.codice === 'avvio') { pronta = false; eng = null; try { e.chiudi(); } catch { /* niente */ } } throw x; }
    });
    fila = giro.catch(() => { }).finally(() => { if (--inFila === 0) aRiposo(); });
    return giro;
  }
  function chiudi() { clearTimeout(timer); pronta = false; const e = eng; eng = null; e?.chiudi(); }
  return {
    motore, disponibile: () => !!motore, pronta: () => pronta, prepara, trascrivi, chiudi,
    stato: () => ({ motore, pronta, inFila, errore: ultimoErrore?.message || null }),
  };
}

// i byte di un corpo (float32 little-endian) → Float32Array allineato (il Buffer di Node può non esserlo)
export function daByte(buf) {
  const copia = new Uint8Array(buf.length); copia.set(buf);
  return new Float32Array(copia.buffer);
}
