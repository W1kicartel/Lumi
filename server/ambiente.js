// Lumi prima si chiamava Kubo. Qui, e solo qui, si leggono ancora i nomi vecchi delle installazioni di prova:
//   • le variabili d'ambiente KUBO_* (DEPRECATE): valgono come LUMI_* se il LUMI_* corrispondente non c'è.
//     Si copiano una volta, quando questo file si carica (lo importano server/avvia.js e server/api.js);
//   • il database: <dati>/lumi.db, ma se c'è solo il kubo.db di prima lo si rinomina, o lo si usa così com'è se forse è aperto.
// Le tabelle interne di SQLite (_meta, _utenti, …) non hanno mai avuto il nome nel titolo: non c'è niente da migrare.
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// KUBO_X → LUMI_X (KUBO_LUMI_LIMITE → LUMI_DOMANDE_MINUTO), senza mai coprire un LUMI_* già scritto. Torna i nomi vecchi
// usati (per un avviso all'avvio).
const RINOMINATE = { KUBO_LUMI_LIMITE: 'LUMI_DOMANDE_MINUTO' };
export function variabiliVecchie(env = process.env) {
  const usate = [];
  for (const k of Object.keys(env)) {
    if (!k.startsWith('KUBO_')) continue;
    const nuovo = RINOMINATE[k] || 'LUMI_' + k.slice(5);
    if (env[nuovo] === undefined) { env[nuovo] = env[k]; usate.push(k); }
  }
  return usate;
}
export const VARIABILI_VECCHIE = variabiliVecchie();

// il file del database nella cartella dei dati. Con il solo kubo.db: lo si rinomina in lumi.db se è chiuso (né -wal,
// né -shm, né -journal accanto: SQLite li toglie quando l'ultima connessione si chiude bene); se no lo si usa com'è.
export function fileDatabase(cartella) {
  const nuovo = join(cartella, 'lumi.db'), vecchio = join(cartella, 'kubo.db');
  if (existsSync(nuovo) || !existsSync(vecchio)) return nuovo;
  if (['-wal', '-shm', '-journal'].some(s => existsSync(vecchio + s))) return vecchio;
  try { renameSync(vecchio, nuovo); return nuovo; } catch { return vecchio; }
}
