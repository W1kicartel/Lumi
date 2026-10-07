// L'avvio guidato e i dati d'esempio (la logica è in avvio-piano.js). Rotte:
//   GET    /api/avvio/domande     le domande, i settori e le risposte tipiche di ogni settore (prima del primo accesso)
//   POST   /api/avvio/piano       { risposte } → cosa verrà preparato: sezioni, modelli, campi spenti (non scrive niente)
//   POST   /api/avvio/configura   { azienda, nome, email, password, risposte } → il primo avvio, al posto di /api/configura
//   GET    /api/avvio/stato       { giro, esempi }: il giro guidato da fare e quante righe d'esempio ci sono
//   POST   /api/avvio/giro        { fatto } il giro guidato è finito (o lo si vuole rivedere)
//   POST   /api/avvio/esempi      mette i dati d'esempio · DELETE /api/avvio/esempi li toglie tutti (solo il titolare)
import { transazione } from '../db.js';
import { DOMANDE, SETTORI, tipiche, piano, installaPiano, mettiEsempi, togliEsempi, quantiEsempi, tabelle } from './avvio-piano.js';

export default function registra({ r, db, U, P, meta, serve, ErroreHttp, manda, primoAvvio }) {
  tabelle(db);
  const titolare = ctx => { if (serve(ctx).r.id !== 'titolare') throw new P.ErrorePermesso('Solo il titolare può farlo'); return ctx; };
  const cookie = token => `kubo=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`;

  r('GET', '/api/avvio/domande', () => ({ domande: DOMANDE, tipiche: Object.fromEntries(SETTORI.map(s => [s.id, tipiche(s.id)])) }));
  r('POST', '/api/avvio/piano', ({ corpo }) => { if (U.quanti(db) > 0) throw new ErroreHttp(409, 'Già configurato'); return piano(corpo?.risposte || {}, db); });
  r('POST', '/api/avvio/configura', ({ corpo, risposta, req, ip }) => {
    if (U.quanti(db) > 0) throw new ErroreHttp(409, 'Già configurato');
    primoAvvio(ip, corpo?.codice);   // da un altro computer serve il codice stampato nel log
    const { azienda, nome, email, password, risposte = {} } = corpo || {};
    if (!String(azienda || '').trim()) throw new ErroreHttp(400, 'Manca il nome dell\'azienda');
    const pl = piano(risposte, db);
    // tutto o niente: se il titolare non va (password corta, email sbagliata) non resta niente a metà
    // un errore sul titolare è un 400, non un 401: l'interfaccia altrimenti salterebbe alla pagina d'accesso
    const fatto = transazione(db, () => {
      let t; try { t = U.creaUtente(db, { nome: String(nome || '').trim(), email: String(email || '').trim(), password: String(password || ''), ruolo: 'titolare' }); }
      catch (e) { throw e instanceof U.ErroreAccesso ? new ErroreHttp(400, e.message) : e; }
      meta.scrivi(db, 'azienda', String(azienda).trim().slice(0, 120));
      const ctx = { utente: t, r: P.ruolo(db, 'titolare') };
      const esito = installaPiano(db, pl, { utente: t.id });
      if (pl.esempi) esito.esempi = mettiEsempi(db, ctx);
      meta.scrivi(db, 'avvio.giro', t.id);
      return esito;
    });
    const s = U.accedi(db, { email: String(email).trim(), password: String(password) }, req.headers['user-agent']);
    risposta.intestazioni['Set-Cookie'] = cookie(s.token);
    return { utente: s.utente, sezioni: pl.sezioni, persone: fatto.persone, esempi: fatto.esempi?.creati || 0 };
  });

  r('GET', '/api/avvio/stato', ({ ctx }) => { serve(ctx); return { giro: meta.leggi(db, 'avvio.giro') === ctx.utente.id, esempi: quantiEsempi(db), titolare: ctx.r.id === 'titolare' }; });
  r('POST', '/api/avvio/giro', ({ ctx, corpo }) => { serve(ctx); meta.scrivi(db, 'avvio.giro', corpo?.fatto === false ? ctx.utente.id : ''); return { ok: true }; });
  r('POST', '/api/avvio/esempi', ({ ctx }) => {
    titolare(ctx); if (quantiEsempi(db)) throw new ErroreHttp(409, 'I dati d\'esempio ci sono già');
    // con un webhook acceso le righe finte arriverebbero anche agli altri programmi (e lì non si tolgono con un clic)
    let webhook = []; try { webhook = db.prepare('SELECT def FROM _import_webhook').all().filter(w => JSON.parse(w.def).attivo !== false); } catch { /* modulo assente */ }
    if (webhook.length) throw new ErroreHttp(409, 'Hai dei webhook attivi: i dati d\'esempio arriverebbero anche lì. Sospendili da «API e integrazioni», poi riprova.');
    const x = mettiEsempi(db, ctx); manda({ tipo: 'avviso', testo: 'Dati d\'esempio aggiunti', chiave: 'esempi-aggiunti' }); return x;
  });
  r('DELETE', '/api/avvio/esempi', ({ ctx }) => { titolare(ctx); const x = togliEsempi(db); manda({ tipo: 'avviso', testo: 'Dati d\'esempio tolti', chiave: 'esempi-tolti' }); return x; });
}
