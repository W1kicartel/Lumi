// Aspetta che la coda dei connettori si svuoti, con un limite. Il lavoro parte da solo dopo una scrittura (setImmediate):
// se è ancora in corso quando il test chiama lavora(), quella torna subito e le asserzioni arriverebbero prima del servizio.
export async function coda(K, ms = 4000) {
  const fine = Date.now() + ms;
  for (;;) {
    await new Promise(r => setTimeout(r, 20)); await K.nucleo.lavora();
    const n = K.db.prepare("SELECT COUNT(*) n FROM _connettori_coda WHERE stato = 'attesa' AND prossimo <= ?").get(Date.now()).n;
    if (!n || Date.now() > fine) return n;
  }
}
