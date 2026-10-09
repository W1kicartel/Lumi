// La voce locale dove non c'è lumi-voce (Windows, Linux, Mac Intel): Parakeet TDT 0.6B v3 di NVIDIA in ONNX (int8) con
// sherpa-onnx (k2-fsa, Apache 2.0), sul processore. Viene da Lode (desktop/voce-onnx.mjs, MIT, stesso autore).
// • sherpa-onnx-node è una dipendenza FACOLTATIVA di Lumi (optionalDependencies, versione esatta): senza, la voce locale
//   non c'è e tutto il resto funziona. L'addon si carica SOLO in un processo a parte (voce-onnx-motore.js): se manca o va
//   in crash, cade quel processo e non Lumi, e il server non si blocca mentre trascrive.
// • Il modello (~640 MB, 4 file) si scarica la prima volta che serve in <dati>/voce-onnx (accanto a lumi.db), da un commit
//   preciso di Hugging Face; ogni file si controlla con l'impronta SHA256 qui sotto mentre arriva, e di nuovo una volta
//   per avvio prima di usarlo. Il download riprende da dove era rimasto (.parziale + Range) e controlla lo spazio.
// • L'audio passa in memoria (Float32Array nel messaggio): niente file.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
export const MOTORE = join(QUI, 'voce-onnx-motore.js');
export const VERSIONE_SHERPA = '1.13.8';   // la stessa, esatta, di optionalDependencies in package.json (lo controllano le prove)
// sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 (csukuangfj, sherpa-onnx) su Hugging Face: URL con il commit, mai «main».
// Impronte di Lode (calcolate il 2 ottobre 2026 sui file scaricati da qui, uguali a quelle che mostra Hugging Face).
const COMMIT = '2bda32ec70b097a55adaa07d9a7173915b43cc78';
export const MODELLO = {
  nome: 'parakeet-tdt-0.6b-v3-int8',
  base: `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${COMMIT}/`,
  file: [
    { nome: 'encoder.int8.onnx', byte: 652184281, sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247' },
    { nome: 'decoder.int8.onnx', byte: 11845275, sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e' },
    { nome: 'joiner.int8.onnx', byte: 6355277, sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3' },
    { nome: 'tokens.txt', byte: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
  ],
};
// il processo della voce arriva a ~1,5 GB mentre trascrive (misure di Lode su M2): sotto 5,5 GiB di memoria non si sceglie
// da solo (LUMI_VOCE=onnx lo forza)
export const MEMORIA_MINIMA = 5.5 * 2 ** 30;
const errore = (testo, codice) => Object.assign(new Error(testo), { codice });

// c'è sherpa-onnx-node? Si guarda solo che si trovi (caricarlo qui vorrebbe dire caricare l'addon nel server)
export function sherpaPresente(cerca = createRequire(import.meta.url).resolve) {
  try { cerca('sherpa-onnx-node'); return true; } catch { return false; }
}
export const fili = (core = availableParallelism()) => Math.max(1, Math.min(4, Math.floor(core / 2)));

/* ---------- il modello sul disco ---------- */
export async function impronta(file) {
  const h = createHash('sha256');
  for await (const pezzo of createReadStream(file, { highWaterMark: 1 << 20 })) h.update(pezzo);
  return h.digest('hex');
}
const SESSIONE = new Map();   // i file già controllati in questo avvio di Lumi: percorso → chi è (disco, inode, misura, date)
const chi = (st, f) => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs, f.sha256].join(':');
const stat = file => { try { return statSync(file); } catch { return null; } };
export const spazioLibero = cartella => { try { const s = statfsSync(cartella); return s.bavail * s.bsize; } catch { return Infinity; } };

// scarica quello che manca, lo verifica e lo mette al suo posto (ogni file passa da <nome>.parziale)
export async function scaricaModello({ cartella, rete = fetch, modello = MODELLO, libero = spazioLibero, margine = 100e6, verificati = SESSIONE }) {
  mkdirSync(cartella, { recursive: true });
  const daFare = [];
  for (const f of modello.file) {
    const dest = join(cartella, f.nome), st = stat(dest);
    if (st && verificati.get(dest) === chi(st, f)) continue;
    verificati.delete(dest);
    const giusta = st && st.size === f.byte && await impronta(dest) === f.sha256;
    if (giusta && chi(stat(dest) || {}, f) === chi(st, f)) { verificati.set(dest, chi(st, f)); continue; }
    if (st) rmSync(dest, { force: true });
    daFare.push(f);
  }
  if (!daFare.length) return { scaricati: 0 };
  const parte = f => { try { return Math.min(statSync(join(cartella, f.nome + '.parziale')).size, f.byte); } catch { return 0; } };
  const serve = daFare.reduce((s, f) => s + f.byte - parte(f), 0);
  if (libero(cartella) < serve + margine) throw errore(`Spazio insufficiente per il modello della voce: servono ${Math.ceil((serve + margine) / 2 ** 20)} MB`, 'spazio');
  for (const f of daFare) {
    const dest = join(cartella, f.nome), tmp = dest + '.parziale';
    let da = parte(f); if (da >= f.byte) { rmSync(tmp, { force: true }); da = 0; }
    let r;
    try { r = await rete(modello.base + f.nome, { redirect: 'follow', headers: { 'User-Agent': 'Lumi', ...(da ? { Range: `bytes=${da}-` } : {}) } }); }
    catch (e) { throw errore(`Modello della voce non scaricato: ${e.message}`, 'rete'); }
    if (r.status === 200) da = 0;
    else if (r.status !== 206 || !String(r.headers.get('content-range') || '').startsWith(`bytes ${da}-`)) {
      try { await r.body?.cancel(); } catch { /* niente */ }
      throw errore(`Modello della voce non scaricato (HTTP ${r.status})`, 'rete');
    }
    const h = createHash('sha256');
    if (da) for await (const pezzo of createReadStream(tmp, { highWaterMark: 1 << 20 })) h.update(pezzo);
    let arrivati = da;
    const conta = new Transform({ transform(pezzo, _, fine) { arrivati += pezzo.length; if (arrivati > f.byte) return fine(errore('file del modello troppo grande', 'impronta')); h.update(pezzo); fine(null, pezzo); } });
    try { await pipeline(Readable.fromWeb(r.body), conta, createWriteStream(tmp, { flags: da ? 'a' : 'w' })); }
    catch (e) { if (e.codice === 'impronta') { rmSync(tmp, { force: true }); throw e; } throw errore(`Modello della voce interrotto: ${e.message}`, 'rete'); }
    if (arrivati !== f.byte || h.digest('hex') !== f.sha256) { rmSync(tmp, { force: true }); throw errore(`Impronta sbagliata per ${f.nome}`, 'impronta'); }
    renameSync(tmp, dest);
    verificati.set(dest, chi(statSync(dest), f));
  }
  return { scaricati: daFare.length };
}

/* ---------- il processo che trascrive ---------- */
// In Node un processo figlio (fork, clone strutturato: il Float32Array passa così com'è). Dentro l'app Electron (il server
// gira nel processo principale e i fusibili spengono runAsNode) un utilityProcess.
export async function processoPredefinito() {
  if (process.versions.electron && process.type === 'browser') {
    const { utilityProcess } = await import('electron');
    return () => {
      const p = utilityProcess.fork(MOTORE, [], { serviceName: 'Lumi voce', stdio: 'ignore' });
      return { manda: m => p.postMessage(m), su: (ev, fn) => p.on(ev === 'messaggio' ? 'message' : 'exit', fn), uccidi: () => p.kill() };
    };
  }
  return () => {
    const p = fork(MOTORE, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    p.unref(); p.channel?.unref?.();   // non tiene acceso Node da solo
    return { manda: m => p.send(m), su: (ev, fn) => p.on(ev === 'messaggio' ? 'message' : 'exit', fn), uccidi: () => p.kill() };
  };
}

// avvia(): processo e addon (se non si carica ci si ferma prima di scaricare 640 MB), modello, riconoscitore.
// trascrivi(audio) → testo. chiudi(): il processo esce, chi aspettava riceve «chiusa».
export function crea({ cartella, avvia: nuovoProcesso, rete, modello = MODELLO, nFili = fili() }) {
  let proc = null, pronto = null, n = 0, fase = null;
  const attese = new Map();
  const chiusa = (id, e, testo) => { const a = attese.get(id); if (!a) return; attese.delete(id); e ? a.ko(e) : a.ok(testo); };
  const chiudiTutte = e => { for (const id of [...attese.keys()]) chiusa(id, e); };
  function avvia() {
    if (pronto) return pronto;
    pronto = (async () => {
      const p = proc = (nuovoProcesso || await processoPredefinito())();
      const aspetta = () => new Promise((ok, ko) => { fase = { ok, ko }; });
      p.su('messaggio', m => {
        if (m?.evento === 'addon' || m?.evento === 'pronto') fase?.ok(m);
        else if (m?.evento === 'errore') fase?.ko(errore(m.errore, m.codice || 'avvio'));
        else if (m?.id && attese.has(m.id)) chiusa(m.id, m.errore ? errore(m.errore, 'audio') : null, m.testo || '');
      });
      p.su('uscita', c => {
        const e = errore(`la voce ONNX si è chiusa (${c})`, proc === p ? 'crash' : 'chiusa'); fase?.ko(e);
        if (proc !== p) return;
        chiudiTutte(e); proc = null; pronto = null;
      });
      const addon = aspetta(); p.manda({ tipo: 'addon' }); await addon;
      await scaricaModello({ cartella, rete, modello });
      if (proc !== p) throw errore('voce chiusa', 'chiusa');
      const caricato = aspetta();
      p.manda({ tipo: 'carica', file: Object.fromEntries(modello.file.map(f => [f.nome.split('.')[0], join(cartella, f.nome)])), fili: nFili });
      await caricato; fase = null;
      return true;
    })();
    pronto.catch(() => { const p = proc; proc = null; pronto = null; try { p?.uccidi(); } catch { /* niente */ } });
    return pronto;
  }
  async function trascrivi(audio) {
    await avvia();
    const id = ++n;
    return new Promise((ok, ko) => {
      attese.set(id, { ok, ko });
      if (!proc) return chiusa(id, errore('voce chiusa', 'crash'));
      try { proc.manda({ tipo: 'trascrivi', id, audio }); } catch (e) { chiusa(id, errore(e.message, 'crash')); }
    });
  }
  const chiudi = () => { const p = proc; proc = null; pronto = null; const e = errore('voce chiusa', 'chiusa'); fase?.ko(e); chiudiTutte(e); try { p?.uccidi(); } catch { /* niente */ } };
  return { avvia, trascrivi, chiudi, attivo: () => !!proc };
}

export const modelloPresente = cartella => MODELLO.file.every(f => existsSync(join(cartella, f.nome)));
