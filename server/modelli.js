// I modelli di settore (cartella modelli/): entità, automazioni e viste pronte da installare in un gestionale vuoto o
// da aggiungere a uno esistente (le entità con lo stesso id non si toccano).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './schema.js';
import * as A from './automazioni.js';
import { transazione, meta } from './db.js';

const CARTELLA = join(dirname(fileURLToPath(import.meta.url)), '..', 'modelli');
export function elenco() {
  return readdirSync(CARTELLA).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(CARTELLA, f), 'utf8')))
    .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0))   // «ordine»: i modelli aggiuntivi (es. fatture) vanno dopo quelli di settore
    .map(m => ({ id: m.id, nome: m.nome, descrizione: m.descrizione, entita: m.entita.filter(e => !e.nascosta).map(e => e.nome) }));
}
export function leggi(id) {
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('Modello sconosciuto');
  return JSON.parse(readFileSync(join(CARTELLA, id + '.json'), 'utf8'));
}
export function installa(db, id, { utente = null } = {}) {
  const m = leggi(id);
  return transazione(db, () => {
    const nuove = m.entita.filter(e => !S.leggi(db, e.id));
    S.applicaTutte(db, nuove, { utente });
    for (const a of m.automazioni || []) if (nuove.some(e => e.id === a.entita)) A.salva(db, a, { utente });
    const installati = JSON.parse(meta.leggi(db, 'modelli') || '[]'); if (!installati.includes(id)) installati.push(id);
    meta.scrivi(db, 'modelli', JSON.stringify(installati));
    return { entita: nuove.map(e => e.id), saltate: m.entita.filter(e => !nuove.includes(e)).map(e => e.id) };
  });
}
