// Rapporto di node --test per GitHub Actions: ogni prova fallita diventa un'annotazione «::error» con file e riga,
// che si legge nella pagina dell'esecuzione (e dalle API, anche senza accesso ai log). Si usa accanto a «spec»:
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//        --test-reporter=./strumenti/rapporto-github.mjs --test-reporter-destination=stdout test/*.test.mjs
import { relative } from 'node:path';

const valore = s => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const proprieta = s => valore(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* rapporto(eventi) {
  let passate = 0, fallite = 0;
  for await (const { type, data } of eventi) {
    if (data?.details?.type === 'suite') continue;
    if (type === 'test:pass') passate++;
    if (type !== 'test:fail') continue;
    fallite++;
    const e = data.details?.error, causa = e?.cause ?? e;
    const testo = `${causa?.message ?? causa ?? 'fallita'}${causa?.stack ? '\n' + String(causa.stack).split('\n').slice(1, 4).join('\n') : ''}`;
    const file = data.file ? relative(process.cwd(), data.file).replace(/\\/g, '/') : '';
    yield `::error file=${proprieta(file)},line=${data.line || 1},title=${proprieta(String(data.name).slice(0, 120))}::${valore(testo.slice(0, 1500))}\n`;
  }
  yield `::notice title=Prove::${passate} passate, ${fallite} fallite (${process.platform}, Node ${process.versions.node})\n`;
}
