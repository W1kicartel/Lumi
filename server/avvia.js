// Avvio: node server/avvia.js [--porta 4380] [--rete] [--dati <cartella>]
//   --rete  ascolta su tutta la rete locale (gli altri PC e i telefoni si collegano all'indirizzo stampato); senza, solo
//           da questo computer. I dati stanno in <dati>/lumi.db (predefinito: ./dati, o la variabile LUMI_DATI).
import { VARIABILI_VECCHIE, fileDatabase } from './ambiente.js';   // per primo: copia le KUBO_* deprecate nelle LUMI_*
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { apri } from './db.js';
import { creaServer } from './api.js';
import { attiva } from './automazioni.js';

const arg = process.argv.slice(2), val = (k, d) => { const i = arg.indexOf(k); return i >= 0 ? arg[i + 1] : d; };
const porta = Number(val('--porta', process.env.LUMI_PORTA || 4380)), rete = arg.includes('--rete') || process.env.LUMI_RETE === '1';
const cartella = resolve(val('--dati', process.env.LUMI_DATI || 'dati')); mkdirSync(cartella, { recursive: true });
const file = fileDatabase(cartella), db = apri(file); attiva();
creaServer(db).listen(porta, rete ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Lumi è acceso: http://localhost:${porta}`);
  if (rete) for (const l of Object.values(networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`  dalla rete:  http://${l.address}:${porta}`);
  console.log(`  dati: ${file}`);
  if (VARIABILI_VECCHIE.length) console.warn(`  attenzione: ${VARIABILI_VECCHIE.join(', ')} sono nomi vecchi (deprecati): usa LUMI_…`);
});
