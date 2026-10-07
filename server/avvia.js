// Avvio: node server/avvia.js [--porta 4380] [--rete] [--dati <cartella>]
//   --rete  ascolta su tutta la rete locale (gli altri PC e i telefoni si collegano all'indirizzo stampato); senza, solo
//           da questo computer. I dati stanno in <dati>/kubo.db (predefinito: ./dati, o la variabile KUBO_DATI).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { apri } from './db.js';
import { creaServer } from './api.js';
import { attiva } from './automazioni.js';

const arg = process.argv.slice(2), val = (k, d) => { const i = arg.indexOf(k); return i >= 0 ? arg[i + 1] : d; };
const porta = Number(val('--porta', process.env.KUBO_PORTA || 4380)), rete = arg.includes('--rete') || process.env.KUBO_RETE === '1';
const cartella = resolve(val('--dati', process.env.KUBO_DATI || 'dati')); mkdirSync(cartella, { recursive: true });
const db = apri(join(cartella, 'kubo.db')); attiva();
creaServer(db).listen(porta, rete ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Kubo è acceso: http://localhost:${porta}`);
  if (rete) for (const l of Object.values(networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`  dalla rete:  http://${l.address}:${porta}`);
  console.log(`  dati: ${join(cartella, 'kubo.db')}`);
});
