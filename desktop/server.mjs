// Lumi dentro l'app desktop: lo stesso server di server/, acceso nel processo principale (Electron, o Node nei test).
// «radice» è la cartella con server/, web/ e modelli/ (nel pacchetto: resources/lumi; in sviluppo: la cartella sopra).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ascolta = (srv, porta, host) => new Promise((ok, no) => {
  const errore = e => { srv.off('listening', fatto); no(e); }, fatto = () => { srv.off('error', errore); ok(srv.address().port); };
  srv.once('error', errore); srv.once('listening', fatto); srv.listen(porta, host);
});

// accende Lumi: i dati in <cartella>/lumi.db; con «rete» anche gli altri dispositivi della rete locale lo raggiungono.
// Se la porta è occupata (un altro programma, o un'altra copia di Lumi) prova le dieci dopo.
export async function accendi({ radice, cartella, porta = 4380, rete = true }) {
  mkdirSync(cartella, { recursive: true });
  const carica = f => import(pathToFileURL(join(radice, 'server', f)).href);
  const [{ apri }, { creaServer }, { attiva }, { fileDatabase }] = await Promise.all([carica('db.js'), carica('api.js'), carica('automazioni.js'), carica('ambiente.js')]);
  const db = apri(fileDatabase(cartella)); attiva();   // lumi.db (o il kubo.db di prima)
  const srv = creaServer(db), host = rete ? '0.0.0.0' : '127.0.0.1';
  let usata = null;
  for (let p = porta, i = 0; usata == null; p++, i++) {
    try { usata = await ascolta(srv, p, host); }
    catch (e) { if (e.code !== 'EADDRINUSE' || i >= 10 || porta === 0) { db.close(); throw e; } }
  }
  return { server: srv, db, porta: usata, rete, url: `http://127.0.0.1:${usata}/`, cartella,
    chiudi: () => new Promise(fatto => { srv.closeAllConnections?.(); srv.close(() => { try { db.close(); } catch {} fatto(); }); }) };
}
