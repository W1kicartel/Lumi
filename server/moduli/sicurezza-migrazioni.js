// Migrazioni dello schema che sistemano i dati senza perderne. Questo file non registra rotte: esporta funzioni.
//   unificaIndirizzo: i clienti dei modelli di settore hanno un campo libero «Indirizzo»; la fattura elettronica aggiunge
//   via, CAP, comune e provincia. Due indirizzi nella stessa scheda confondono: il testo libero si scompone nei campi
//   nuovi (solo dove sono vuoti) e il campo vecchio si archivia (colonna e valori restano, si ripristina da Personalizza).
import { registra } from '../db.js';

// «Via Roma 1, 20121 Milano (MI)» · «Via Roma 1\n20121 Milano MI» · «Piazza Duomo 2 - 20121 - Milano» → { via, cap, comune, provincia }
export function scomponiIndirizzo(testo) {
  const t = String(testo ?? '').replace(/\r/g, '').trim(); if (!t) return null;
  const m = /^(.*?)[\s,;\n-]*\b(\d{5})\b[\s,;-]*([^,;\n(]+?)\s*(?:\(\s*([A-Za-z]{2})\s*\)|[\s,-]+([A-Za-z]{2}))?\s*(?:[,;\n]\s*(?:italia|it))?\s*$/i.exec(t);
  if (!m) return { via: t.split('\n')[0].trim().slice(0, 200), cap: '', comune: '', provincia: '' };
  const via = m[1].replace(/[\s,;\n-]+$/, '').replace(/\n+/g, ', ').trim();
  return { via: (via || t.split('\n')[0]).slice(0, 200), cap: m[2], comune: m[3].trim().slice(0, 100), provincia: (m[4] || m[5] || '').toUpperCase() };
}

// def: l'entità dei clienti, già con via/cap/comune/provincia. Restituisce quante righe ha completato (0 se non serve).
export function unificaIndirizzo(db, S, entita, { utente = null } = {}) {
  const def = S.leggi(db, entita); if (!def) return 0;
  const vecchio = def.campi.find(c => c.id === 'indirizzo' && !c.archiviato && ['indirizzo', 'testo', 'testo_lungo'].includes(c.tipo));
  const nuovi = ['via', 'cap', 'comune', 'provincia'].map(id => def.campi.find(c => c.id === id && !c.archiviato));
  if (!vecchio || nuovi.some(c => !c)) return 0;
  const T = S.tabella(entita), col = S.colonna;
  const righe = db.prepare(`SELECT id, ${col('indirizzo')} AS t, ${col('via')} AS via, ${col('cap')} AS cap, ${col('comune')} AS comune, ${col('provincia')} AS provincia FROM ${T} WHERE ${col('indirizzo')} IS NOT NULL AND TRIM(${col('indirizzo')}) <> ''`).all();
  const up = db.prepare(`UPDATE ${T} SET ${col('via')} = ?, ${col('cap')} = ?, ${col('comune')} = ?, ${col('provincia')} = ? WHERE id = ?`);
  let n = 0;
  for (const r of righe) {
    if (r.via) continue;   // chi ha già l'indirizzo nuovo non si tocca
    const x = scomponiIndirizzo(r.t); if (!x) continue;
    up.run(x.via, r.cap || x.cap || null, r.comune || x.comune || null, r.provincia || x.provincia || null, r.id); n++;
    registra(db, { utente, tipo: 'migrazione', entita, riga: r.id, prima: { indirizzo: r.t }, dopo: { via: x.via, cap: r.cap || x.cap, comune: r.comune || x.comune, provincia: r.provincia || x.provincia } });
  }
  // il campo libero si archivia (non si cancella): i valori restano nella colonna
  const { archiviata, ...d } = S.leggi(db, entita);
  S.applica(db, { ...d, campi: d.campi.filter(c => c.id !== 'indirizzo'), titolo: d.titolo === 'indirizzo' ? undefined : d.titolo }, { utente });
  return n;
}
