// Rapporto di node --test per GitHub Actions: ogni prova fallita diventa un'annotazione «::error» con file e riga,
// che si legge nella pagina dell'esecuzione (e dalle API, anche senza accesso ai log). Se fallisce un file intero
// (si ferma prima delle prove), l'annotazione porta le ultime righe che quel file ha scritto: lì c'è il motivo vero.
// Si usa accanto a «spec»:
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//        --test-reporter=./strumenti/rapporto-github.mjs --test-reporter-destination=stdout test/*.test.mjs
import { relative } from 'node:path';

const valore = s => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const proprieta = s => valore(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* rapporto(eventi) {
  let passate = 0, fallite = 0;
  const uscite = new Map();   // file → ultime righe scritte (stderr e stdout)
  for await (const { type, data } of eventi) {
    if (type === 'test:stderr' || type === 'test:stdout') {
      const r = uscite.get(data.file) || []; r.push(...String(data.message).split(/\r?\n/).filter(Boolean)); uscite.set(data.file, r.slice(-40));
      continue;
    }
    if (data?.details?.type === 'suite') continue;
    if (type === 'test:pass') passate++;
    if (type !== 'test:fail') continue;
    fallite++;
    const e = data.details?.error, causa = e?.cause ?? e;
    let testo = `${causa?.message ?? causa ?? 'fallita'}${causa?.stack ? '\n' + String(causa.stack).split('\n').slice(1, 4).join('\n') : ''}`;
    const tutto = data.file && (data.name === data.file || /\.test\.mjs$/.test(String(data.name)));
    if (tutto && uscite.get(data.file)?.length) testo += '\n--- ultime righe del file ---\n' + uscite.get(data.file).join('\n');
    const file = data.file ? relative(process.cwd(), data.file).replace(/\\/g, '/') : '';
    yield `::error file=${proprieta(file)},line=${data.line || 1},title=${proprieta(String(data.name).slice(0, 120))}::${valore(testo.slice(-3500))}\n`;
  }
  yield `::notice title=Prove::${passate} passate, ${fallite} fallite (${process.platform}, Node ${process.versions.node})\n`;
}
