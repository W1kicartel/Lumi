// Solo per la CI, dopo un fallimento: rilancia ogni file di prova da solo e, per quelli che escono male, scrive
// un'annotazione con la coda di quello che hanno stampato (le annotazioni si leggono anche senza accesso ai log).
//   node strumenti/diagnosi-ci.mjs [test/*.test.mjs]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const file = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('test').filter(f => f.endsWith('.test.mjs')).map(f => join('test', f));
const valore = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
let rotti = 0;
for (const f of file) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', f], { encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 2 ** 20 });
  if (r.status === 0) continue;
  rotti++;
  const coda = `uscita ${r.status ?? r.signal}${r.error ? ' ' + r.error.message : ''}\n${(r.stdout || '') + (r.stderr || '')}`.split(/\r?\n/).filter(x => !/^\s*(ok|# (pass|tests|suites|cancelled|skipped|todo|duration_ms))\b/.test(x)).join('\n').slice(-3500);
  console.log(`::error file=${f.replace(/\\/g, '/')},title=diagnosi::${valore(coda)}`);
}
console.log(`::notice title=Diagnosi::${rotti} file su ${file.length} escono male (${process.platform})`);
