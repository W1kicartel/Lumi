// Kubo dentro l'app desktop: lo stesso server di server/, acceso nel processo principale (Electron, o Node nei test).
// «radice» è la cartella con server/, web/ e modelli/ (nel pacchetto: resources/kubo; in sviluppo: la cartella sopra).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ascolta = (srv, porta, host) => new Promise((ok, no) => {
  const errore = e => { srv.off('listening', fatto); no(e); }, fatto = () => { srv.off('error', errore); ok(srv.address().port); };
  srv.once('error', errore); srv.once('listening', fatto); srv.listen(porta, host);
});

// accende Kubo: i dati in <cartella>/kubo.db; con «rete» anche gli altri dispositivi della rete locale lo raggiungono.
// Se la porta è occupata (un altro programma, o un altro Kubo) prova le dieci dopo.
export async function accendi({ radice, cartella, porta = 4380, rete = true }) {
  mkdirSync(cartella, { recursive: true });
  const carica = f => import(pathToFileURL(join(radice, 'server', f)).href);
  const [{ apri }, { creaServer }, { attiva }] = await Promise.all([carica('db.js'), carica('api.js'), carica('automazioni.js')]);
  const db = apri(join(cartella, 'kubo.db')); attiva();
  const srv = creaServer(db), host = rete ? '0.0.0.0' : '127.0.0.1';
  let usata = null;
  for (let p = porta, i = 0; usata == null; p++, i++) {
    try { usata = await ascolta(srv, p, host); }
    catch (e) { if (e.code !== 'EADDRINUSE' || i >= 10 || porta === 0) { db.close(); throw e; } }
  }
  return { server: srv, db, porta: usata, rete, url: `http://127.0.0.1:${usata}/`, cartella,
    chiudi: () => new Promise(fatto => { srv.closeAllConnections?.(); srv.close(() => { try { db.close(); } catch {} fatto(); }); }) };
}
