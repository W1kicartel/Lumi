// PROVA (ramo prova-integrazioni): un servizio di pagamenti tipo Stripe. Quando arriva «payment_intent.succeeded» con
// metadata.vendita = <id>, la vendita passa a «pagata». Scritto usando SOLO il contratto dei moduli, per misurare gli attriti.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLLERANZA = 300;   // secondi: come Stripe, contro il replay

// firma stile Stripe: «Stripe-Signature: t=<tempo>,v1=<hex HMAC-SHA256(segreto, "<t>.<corpo grezzo>")>»
export function verificaFirma(intestazione, grezzo, segreto, ora = Date.now()) {
  const parti = Object.fromEntries(String(intestazione || '').split(',').map(x => x.split('=').map(s => s.trim())));
  const t = Number(parti.t), v1 = parti.v1 || '';
  if (!t || !v1 || Math.abs(ora / 1000 - t) > TOLLERANZA) return false;
  const atteso = createHmac('sha256', segreto).update(`${t}.${grezzo}`).digest('hex');
  return atteso.length === v1.length && timingSafeEqual(Buffer.from(atteso), Buffer.from(v1));
}

export default function registra({ r, db, D, meta, serve, ErroreHttp }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _provapag_eventi (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, vendita TEXT, esito TEXT NOT NULL, quando TEXT NOT NULL)`);
  // ATTRITO: nessun archivio dei segreti per servizio. meta è in chiaro nel database (e quindi nel backup zip).
  const segreto = () => meta.leggi(db, 'provapag.segreto') || '';
  r('PUT', '/api/prova-pagamenti/impostazioni', ({ ctx, corpo }) => {
    if (serve(ctx).r.id !== 'titolare' || ctx.viaToken) throw new ErroreHttp(403, 'Solo il titolare');
    if (!/^whsec_[\w-]{8,}$/.test(String(corpo.segreto || ''))) throw new ErroreHttp(400, 'Segreto del webhook non valido');
    meta.scrivi(db, 'provapag.segreto', String(corpo.segreto)); return { ok: true };
  });
  r('GET', '/api/prova-pagamenti/registro', ({ ctx }) => { serve(ctx); return db.prepare('SELECT * FROM _provapag_eventi ORDER BY quando DESC LIMIT 100').all(); });

  // il webhook in ingresso. ATTRITO: senza ritocchi al motore qui non si arriva (X-Lumi obbligatoria) e il corpo grezzo
  // non c'è: «grezzo» esiste solo con la patch di prova in api.js (opzione { pubblica: true, grezzo: true }).
  r('POST', '/api/prova-pagamenti/webhook', ({ req, corpo, grezzo }) => {
    const s = segreto(); if (!s) throw new ErroreHttp(503, 'Pagamenti non configurati');
    const testo = grezzo != null ? grezzo.toString('utf8') : JSON.stringify(corpo);   // senza patch: si prova a ricostruirlo (fallisce)
    if (!verificaFirma(req.headers['stripe-signature'], testo, s)) throw new ErroreHttp(400, 'Firma non valida');
    const ev = grezzo != null ? JSON.parse(testo) : corpo;
    if (db.prepare('SELECT 1 FROM _provapag_eventi WHERE id = ?').get(String(ev.id))) return { ok: true, doppione: true };   // idempotenza
    let esito = 'ignorato', vendita = null;
    if (ev.type === 'payment_intent.succeeded') {
      vendita = String(ev.data?.object?.metadata?.vendita || '');
      try {
        const v = D.leggi(db, 'vendite', vendita, null);
        const importo = (ev.data.object.amount_received ?? ev.data.object.amount) / 100;
        if (!v) esito = 'vendita sconosciuta';
        else if (Math.abs((v.totale || 0) - importo) > 0.005) esito = `importo diverso: ${importo} invece di ${v.totale}`;
        // ATTRITO: ctx = null = «sistema» senza permessi; nel registro risulta «nessuno», non «Stripe»
        else { D.modifica(db, 'vendite', vendita, { stato: 'pagata', pagamento: 'carta' }, null); esito = 'pagata'; }
      } catch (e) { esito = 'errore: ' + e.message; }
    }
    db.prepare('INSERT INTO _provapag_eventi (id, tipo, vendita, esito, quando) VALUES (?, ?, ?, ?, ?)').run(String(ev.id), String(ev.type), vendita, esito, new Date().toISOString());
    return { ok: true, esito };
  }, { pubblica: true, grezzo: true });
}
