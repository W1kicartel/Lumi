// PROVA (ramo prova-integrazioni): un e-commerce tipo WooCommerce. Articoli e giacenze nei due sensi.
//   dal negozio: i prodotti (sku → codice) entrano o si aggiornano negli articoli di Kubo (giro pianificato + «sincronizza ora»)
//   verso il negozio: quando in Kubo cambia la giacenza di un articolo abbinato, PUT stock_quantity (coda in uscita)
// Regola dei conflitti: per la giacenza comanda Kubo (la cassa scala il magazzino); dal negozio arrivano i prodotti nuovi,
// nome e prezzo. Scritto usando SOLO il contratto dei moduli, per misurare gli attriti.
const PREFISSO = 'provaneg.';

export default function registra({ r, db, D, S, meta, serve, ErroreHttp }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _provaneg_mappa (articolo TEXT PRIMARY KEY, remoto TEXT NOT NULL UNIQUE, giacenza REAL, aggiornato TEXT);
    CREATE TABLE IF NOT EXISTS _provaneg_coda (id INTEGER PRIMARY KEY AUTOINCREMENT, articolo TEXT NOT NULL, remoto TEXT NOT NULL, giacenza REAL,
      stato TEXT NOT NULL DEFAULT 'attesa', tentativi INTEGER NOT NULL DEFAULT 0, errore TEXT, creato TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _provaneg_registro (id INTEGER PRIMARY KEY AUTOINCREMENT, quando TEXT NOT NULL, verso TEXT NOT NULL, esito TEXT NOT NULL, dettagli TEXT);`);
  // ATTRITO: impostazioni e segreti di nuovo a mano in meta (in chiaro), con la stessa validazione riscritta ogni volta
  const imp = k => meta.leggi(db, PREFISSO + k) || '';
  const log = (verso, esito, dettagli) => db.prepare('INSERT INTO _provaneg_registro (quando, verso, esito, dettagli) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), verso, esito, JSON.stringify(dettagli ?? null).slice(0, 2000));

  // ATTRITO: sicurezza-rete.invia() tronca la risposta a 4 KB e non fa GET con corpo JSON grande: per un'API si usa fetch,
  // e si perde la protezione SSRF (qui l'indirizzo lo sceglie il titolare, ma andrebbe comunque controllato).
  async function chiama(metodo, percorso, corpo) {
    const base = imp('url').replace(/\/+$/, ''), auth = 'Basic ' + Buffer.from(`${imp('chiave')}:${imp('segreto')}`).toString('base64');
    const rr = await fetch(`${base}/wp-json/wc/v3${percorso}`, { method: metodo, signal: AbortSignal.timeout(15000),
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Kubo-Connettore/0' }, body: corpo ? JSON.stringify(corpo) : undefined });
    if (!rr.ok) throw new Error(`${metodo} ${percorso}: ${rr.status} ${(await rr.text()).slice(0, 200)}`);
    return { json: await rr.json(), pagine: Number(rr.headers.get('x-wp-totalpages') || 1) };
  }

  let ineco = false;   // ATTRITO: per non rimandare al negozio ciò che arriva dal negozio serve un flag a mano (nessuna «origine» negli eventi)
  async function scarica() {
    const n = { creati: 0, aggiornati: 0, uguali: 0 };
    for (let p = 1, tot = 1; p <= tot && p <= 50; p++) {
      const { json, pagine } = await chiama('GET', `/products?per_page=100&page=${p}`); tot = pagine;
      for (const pr of json) {
        const m = db.prepare('SELECT * FROM _provaneg_mappa WHERE remoto = ?').get(String(pr.id));
        // ATTRITO: nessuna mappatura dei campi dichiarata; e i nomi dei campi dipendono dallo schema (l'utente li può rinominare)
        const valori = { nome: pr.name, prezzo: Number(pr.regular_price || pr.price || 0) };
        ineco = true;
        try {
          let id = m?.articolo;
          if (!id) {
            const t = S.leggi(db, 'articoli'); if (!t) throw new Error('Manca la sezione «articoli»');
            id = db.prepare(`SELECT id FROM ${S.tabella('articoli')} WHERE ${S.colonna('codice')} = ? AND archiviato = 0`).get(String(pr.sku || ''))?.id;
            if (!id) { id = D.crea(db, 'articoli', { ...valori, codice: pr.sku || `woo-${pr.id}`, giacenza: pr.stock_quantity ?? 0 }, null).id; n.creati++; }
            db.prepare('INSERT INTO _provaneg_mappa (articolo, remoto, giacenza, aggiornato) VALUES (?, ?, ?, ?)').run(id, String(pr.id), pr.stock_quantity ?? null, new Date().toISOString());
          }
          const a = D.leggi(db, 'articoli', id, null);
          if (a.nome !== valori.nome || a.prezzo !== valori.prezzo) { D.modifica(db, 'articoli', id, valori, null); n.aggiornati++; } else n.uguali++;
          // la giacenza comanda Kubo: se il negozio è diverso, lo si riallinea
          if (pr.manage_stock && pr.stock_quantity !== a.giacenza) accoda(id, String(pr.id), a.giacenza);
        } finally { ineco = false; }
      }
    }
    log('dal negozio', 'ok', n); spedisciPresto(); return n;
  }

  const accoda = (articolo, remoto, giacenza) => db.prepare('INSERT INTO _provaneg_coda (articolo, remoto, giacenza, creato) VALUES (?, ?, ?, ?)').run(articolo, remoto, giacenza, new Date().toISOString());
  // nella stessa transazione della modifica (come i webhook di import-api.js): se la vendita si annulla, non parte niente
  D.ascolta((ev, dbEv) => {
    if (dbEv !== db || ev.entita !== 'articoli' || ev.tipo !== 'modifica' || ineco) return;
    if (ev.prima?.giacenza === ev.dopo?.giacenza) return;
    const m = db.prepare('SELECT remoto FROM _provaneg_mappa WHERE articolo = ?').get(ev.id); if (!m) return;
    accoda(ev.id, m.remoto, ev.dopo.giacenza); spedisciPresto();
  });
  // ATTRITO: la coda con tentativi è una copia ridotta di quella dei webhook (import-api.js): non c'è una coda riusabile
  let occupato = false, presto = null;
  function spedisciPresto() { if (!presto) presto = setTimeout(() => { presto = null; spedisci(); }, 20); presto.unref?.(); }
  async function spedisci() {
    if (occupato || !imp('url')) return; occupato = true;
    try {
      for (let i = 0; i < 100; i++) {
        const c = db.prepare(`SELECT * FROM _provaneg_coda WHERE stato = 'attesa' ORDER BY id LIMIT 1`).get(); if (!c) break;
        // solo l'ultima giacenza per articolo conta: le precedenti si saltano
        db.prepare(`UPDATE _provaneg_coda SET stato = 'superata' WHERE articolo = ? AND stato = 'attesa' AND id < (SELECT MAX(id) FROM _provaneg_coda WHERE articolo = ? AND stato = 'attesa')`).run(c.articolo, c.articolo);
        const u = db.prepare(`SELECT * FROM _provaneg_coda WHERE articolo = ? AND stato = 'attesa' ORDER BY id DESC LIMIT 1`).get(c.articolo);
        try {
          await chiama('PUT', `/products/${u.remoto}`, { manage_stock: true, stock_quantity: u.giacenza });
          db.prepare(`UPDATE _provaneg_coda SET stato = 'ok', tentativi = tentativi + 1 WHERE id = ?`).run(u.id);
          db.prepare('UPDATE _provaneg_mappa SET giacenza = ?, aggiornato = ? WHERE articolo = ?').run(u.giacenza, new Date().toISOString(), u.articolo);
          log('verso il negozio', 'ok', { articolo: u.articolo, giacenza: u.giacenza });
        } catch (e) {
          const t = u.tentativi + 1;
          db.prepare(`UPDATE _provaneg_coda SET stato = ?, tentativi = ?, errore = ? WHERE id = ?`).run(t >= 5 ? 'fallita' : 'attesa', t, String(e.message).slice(0, 300), u.id);
          log('verso il negozio', 'errore', { articolo: u.articolo, errore: e.message }); break;   // si riprova al prossimo giro
        }
      }
    } finally { occupato = false; }
  }

  r('PUT', '/api/prova-negozio/impostazioni', ({ ctx, corpo }) => {
    if (serve(ctx).r.id !== 'titolare' || ctx.viaToken) throw new ErroreHttp(403, 'Solo il titolare');
    for (const k of ['url', 'chiave', 'segreto', 'minuti']) if (corpo[k] != null) meta.scrivi(db, PREFISSO + k, String(corpo[k]));
    pianifica(); return { ok: true };
  });
  r('POST', '/api/prova-negozio/sincronizza', async ({ ctx }) => { serve(ctx); try { return await scarica(); } catch (e) { log('dal negozio', 'errore', e.message); throw new ErroreHttp(502, e.message); } });
  r('POST', '/api/prova-negozio/spedisci', async ({ ctx }) => { serve(ctx); await spedisci(); return db.prepare(`SELECT stato, COUNT(*) n FROM _provaneg_coda GROUP BY stato`).all(); });
  r('GET', '/api/prova-negozio/registro', ({ ctx }) => { serve(ctx); return db.prepare('SELECT * FROM _provaneg_registro ORDER BY id DESC LIMIT 100').all(); });

  // ATTRITO: nessun pianificatore. setInterval in memoria: niente «ultimo giro», niente recupero dopo uno spegnimento,
  // niente orari («alle 3 di notte»), e i test devono ricordarsi di non lasciarlo acceso (unref).
  let giro = null;
  function pianifica() {
    clearInterval(giro); const min = Number(imp('minuti') || 0);
    if (min > 0 && imp('url')) giro = setInterval(() => scarica().catch(e => log('dal negozio', 'errore', e.message)), min * 6e4).unref();
  }
  pianifica(); setInterval(spedisci, 30e3).unref();
}
