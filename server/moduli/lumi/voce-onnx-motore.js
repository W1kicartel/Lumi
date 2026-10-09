// Il processo che trascrive con Parakeet ONNX (lo avvia ./voce-onnx.js: un Node figlio, o un utilityProcess nell'app
// Electron). Qui, e solo qui, si carica l'addon di sherpa-onnx: se manca o va in crash, cade questo processo. Da Lode
// (desktop/voce-onnx-motore.mjs, MIT, stesso autore). Messaggi, uno alla volta:
//   { tipo: 'addon' }                   → { evento: 'addon', versione }   carica sherpa-onnx-node (niente modello)
//   { tipo: 'carica', file, fili }      → { evento: 'pronto' }            encoder, decoder, joiner, tokens
//   { tipo: 'trascrivi', id, audio }    → { id, testo } | { id, errore }  audio: Float32Array mono 16 kHz
// L'audio oltre i 30 secondi si decodifica a finestre da 20-28 s tagliate nel punto più silenzioso: onnxruntime tiene la
// memoria del picco più alto e non la restituisce.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SR = 16000;

export async function caricaSherpa(sherpa, { file, fili = 2 }) {
  return sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: { transducer: { encoder: file.encoder, decoder: file.decoder, joiner: file.joiner }, tokens: file.tokens, numThreads: fili, provider: 'cpu', debug: 0, modelType: 'nemo_transducer' },
  });
}

export function finestre(n, campioni, { soglia = 30, min = 20, max = 28 } = {}) {
  if (n <= soglia * SR) return [[0, n]];
  const fuori = [], passo = SR / 10; let da = 0;
  while (n - da > soglia * SR) {
    let taglio = da + max * SR, meno = Infinity;
    for (let i = da + min * SR; i + passo <= da + max * SR; i += passo) {
      let e = 0; for (let j = i; j < i + passo; j++) e += campioni[j] * campioni[j];
      if (e < meno) { meno = e; taglio = i + passo / 2; }
    }
    fuori.push([da, taglio]); da = taglio;
  }
  fuori.push([da, n]);
  return fuori;
}

export function servi({ manda, addon = () => require('sherpa-onnx-node'), carica = caricaSherpa }) {
  let sherpa = null, rec = null, lavora = false;
  const coda = [];
  async function gira() {
    if (lavora) return; lavora = true;
    while (coda.length) {
      const { id, audio } = coda.shift();
      try {
        if (!rec) throw new Error('modello non caricato');
        const tutto = audio instanceof Float32Array ? audio : new Float32Array(audio), testi = [];
        for (const [a, b] of finestre(tutto.length, tutto)) {
          const s = rec.createStream();
          s.acceptWaveform({ sampleRate: SR, samples: b - a === tutto.length ? tutto : tutto.slice(a, b) });
          const r = await rec.decodeAsync(s); testi.push(String(r?.text || '').trim());
        }
        manda({ id, testo: testi.filter(Boolean).join(' ') });
      } catch (e) { manda({ id, errore: String(e.message).split('\n')[0] }); }
    }
    lavora = false;
  }
  return async function ricevi(m) {
    if (m?.tipo === 'addon') {
      try { sherpa = addon(); manda({ evento: 'addon', versione: sherpa?.version || '' }); }
      catch (e) { manda({ evento: 'errore', codice: 'addon', errore: `sherpa-onnx non si carica: ${String(e.message).split('\n')[0]}` }); }
    } else if (m?.tipo === 'carica') {
      try { rec = await carica(sherpa, m); manda({ evento: 'pronto' }); }
      catch (e) { manda({ evento: 'errore', codice: 'modello', errore: `il modello di Parakeet non si carica: ${String(e.message).split('\n')[0]}` }); }
    } else if (m?.tipo === 'trascrivi') { coda.push(m); gira(); }
  };
}

if (process.parentPort) {
  const ricevi = servi({ manda: m => process.parentPort.postMessage(m) });
  process.parentPort.on('message', e => ricevi(e.data));
} else if (process.send && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ricevi = servi({ manda: m => process.send(m) });
  process.on('message', ricevi);
  process.on('disconnect', () => process.exit(0));
}
