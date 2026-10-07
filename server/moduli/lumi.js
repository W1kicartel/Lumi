// Lumi dentro Kubo: l'assistente che legge e propone con i permessi di chi è collegato.
//   POST /api/lumi                  il server di Lumi (stato, chat in streaming, voce, file): fa da tramite verso Claude
//                                   con la chiave dell'azienda, che non arriva mai al browser
//   GET  /api/lumi/impostazioni     acceso o spento, se c'è la chiave e da dove viene (mai la chiave)
//   PUT  /api/lumi/impostazioni     { chiave?, togliChiave?, attivo?, limite? }: solo il titolare
//   GET  /api/lumi/da-vedere        «cosa richiede attenzione», generato dallo schema e letto con i permessi dell'utente
//   POST /api/lumi/riepilogo        conteggi e somme per filtro e periodo («quanto ho venduto questa settimana»)
//   POST /api/lumi/verifica         prova una modifica dello schema o un'automazione senza applicarla (per la proposta)
// La chiave sta in un file accanto al database (permessi 600) o, se il database è in memoria, nelle impostazioni; senza,
// vale la variabile ANTHROPIC_API_KEY. Il motore di Lumi (lumi/nucleo.js) è quello del progetto Lumi, uguale.
import { readFileSync, writeFileSync, unlinkSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { creaGestore, MODELLO } from './lumi/nucleo.js';

const ORIGINE = 'http://kubo.lumi';   // il nucleo vuole un'origine ammessa: la richiesta la costruiamo noi, dopo la sessione
const CHIAVE = /^sk-[\w-]{10,300}$/;
const SENZA_CHIAVE = 'Lumi non ha ancora la chiave di Claude: il titolare la aggiunge in Gestione → Lumi.';
const GIORNO = 864e5;

export default function registra({ r, db, S, D, P, A, meta, serve, ErroreHttp }) {
  // ---------- impostazioni ----------
  const fileChiave = () => { const l = db.location?.(); return l ? join(dirname(l), 'lumi-chiave') : null; };
  function chiaveSalvata() {
    const f = fileChiave();
    if (f) { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } }
    return meta.leggi(db, 'lumi.chiave') || '';
  }
  function salvaChiave(v) {
    const f = fileChiave();
    if (f) { if (v) { writeFileSync(f, v, { mode: 0o600 }); chmodSync(f, 0o600); } else if (existsSync(f)) unlinkSync(f); }
    else meta.scrivi(db, 'lumi.chiave', v || '');
  }
  const chiave = () => chiaveSalvata() || (process.env.ANTHROPIC_API_KEY || '').trim();
  const acceso = () => meta.leggi(db, 'lumi.attivo') !== '0';
  const limite = () => Number(meta.leggi(db, 'lumi.limite') || process.env.KUBO_LUMI_LIMITE || 20);
  const titolare = ctx => { if (serve(ctx).r.id !== 'titolare') throw new P.ErrorePermesso('Solo il titolare cambia le impostazioni di Lumi'); return ctx; };
  const impostazioni = () => ({ attivo: acceso(), chiave: !!chiave(), fonte: chiaveSalvata() ? 'impostazioni' : chiave() ? 'ambiente' : null,
    limite: limite(), modello: process.env.LUMI_MODELLO || MODELLO, voce: !!process.env.DEEPGRAM_API_KEY });

  r('GET', '/api/lumi/impostazioni', ({ ctx }) => (titolare(ctx), impostazioni()));
  r('PUT', '/api/lumi/impostazioni', ({ ctx, corpo }) => {
    titolare(ctx);
    if (corpo.chiave != null && corpo.chiave !== '') { const k = String(corpo.chiave).trim(); if (!CHIAVE.test(k)) throw new ErroreHttp(400, 'Questa non sembra una chiave di Claude (inizia con «sk-»)'); salvaChiave(k); }
    if (corpo.togliChiave) salvaChiave('');
    if (corpo.attivo != null) meta.scrivi(db, 'lumi.attivo', corpo.attivo ? '1' : '0');
    if (corpo.limite != null) { const n = Math.round(Number(corpo.limite)); if (!(n >= 1 && n <= 600)) throw new ErroreHttp(400, 'Il limite va da 1 a 600 domande al minuto'); meta.scrivi(db, 'lumi.limite', String(n)); }
    return impostazioni();
  });

  // ---------- il tramite verso Claude ----------
  const conti = new Map();   // utente → { da, n }: quante richieste nell'ultimo minuto
  function troppe(id) {
    const ora = Date.now(), c = conti.get(id);
    if (!c || ora - c.da > 6e4) { conti.set(id, { da: ora, n: 1 }); return false; }
    return ++c.n > limite();
  }
  r('POST', '/api/lumi', async ({ ctx, corpo, res }) => {
    serve(ctx);
    const az = corpo.azione, k = chiave();
    if (az === 'stato') return { claude: acceso() && !!k, voce: acceso() && !!k && !!process.env.DEEPGRAM_API_KEY, modello: process.env.LUMI_MODELLO || MODELLO, attivo: acceso(), chiave: !!k };
    if (az === 'elimina-file' && !k) return { ok: true };
    if (!acceso()) throw new ErroreHttp(400, 'Lumi è spento: il titolare lo riaccende in Gestione → Lumi.');
    if (!k) throw new ErroreHttp(400, SENZA_CHIAVE);
    if (az !== 'elimina-file' && troppe(ctx.utente.id)) throw new ErroreHttp(429, 'Troppe domande in poco tempo: riprova fra un minuto.');
    const ctrl = new AbortController(); res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    const gestore = creaGestore({ chiave: k, deepgram: (process.env.DEEPGRAM_API_KEY || '').trim(), modello: process.env.LUMI_MODELLO || MODELLO,
      sforzo: process.env.LUMI_SFORZO || 'low', origini: [ORIGINE], limiteMinuto: 0, anthropicBase: process.env.ANTHROPIC_BASE_URL || undefined, ip: () => ctx.utente.id });
    const rq = new Request(`${ORIGINE}/lumi`, { method: 'POST', signal: ctrl.signal, headers: { origin: ORIGINE, 'content-type': 'application/json' },
      body: JSON.stringify({ ...corpo, azienda: meta.leggi(db, 'azienda') || '' }) });
    const rr = await gestore(rq);
    if ((rr.headers.get('content-type') || '').startsWith('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
      try { for await (const x of rr.body) { if (ctrl.signal.aborted) break; res.write(x); } } catch { /* chi chiedeva se n'è andato */ }
      res.end(); return;
    }
    const j = await rr.json().catch(() => ({}));
    if (!rr.ok) throw new ErroreHttp(rr.status, j.errore || 'Lumi non ha risposto');
    return j;
  });

  // ---------- «Da vedere»: dallo schema, con i permessi di chi guarda ----------
  r('GET', '/api/lumi/da-vedere', ({ ctx }) => daVedere(serve(ctx)));
  function daVedere(ctx) {
    const oggi = new Date().toISOString().slice(0, 10), settimana = new Date(Date.now() - 7 * GIORNO).toISOString(), out = [];
    const conta = (e, filtri) => { try { return D.elenca(db, e, { filtri, perPagina: 1 }, ctx).totale; } catch { return 0; } };
    for (const def of S.elenco(db)) {
      if (def.nascosta || !P.puo(ctx, def.id, 'leggi')) continue;
      const campi = S.campiAttivi(def).filter(c => P.statoCampo(ctx, def.id, c.id) !== 'nascosto');
      const stato = campi.find(c => c.tipo === 'stato'), aperti = stato ? statiAperti(stato) : null;
      const filtroAperti = aperti && aperti.length < stato.opzioni.length ? [{ campo: stato.id, op: 'in', valore: aperti }] : [];
      for (const c of campi) {
        let filtri = null, testo, livello = 'attenzione';
        if (c.tipo === 'calcolato' && booleano(c)) { filtri = [{ campo: c.id, op: '=', valore: true }]; testo = `${def.nome}: ${c.nome.toLowerCase()}`; }
        else if (c.tipo === 'stato') {
          const ini = c.iniziale || c.opzioni[0]?.id; if (!ini || !statiAperti(c).includes(ini)) continue;
          filtri = [{ campo: c.id, op: '=', valore: ini }, { campo: 'modificato', op: '<', valore: settimana }];
          testo = `${def.nome}: ferme su «${c.opzioni.find(o => o.id === ini)?.nome || ini}» da più di una settimana`; livello = 'info';
        } else if (['data', 'data_ora'].includes(c.tipo) && scadenza(c) && !campi.some(x => x.tipo === 'calcolato' && booleano(x) && new RegExp(`\\b${c.id}\\b`).test(x.formula))) {
          filtri = [{ campo: c.id, op: '<', valore: oggi }, ...filtroAperti]; testo = `${def.nome} oltre «${c.nome}»`; livello = 'urgente';
        }
        if (!filtri) continue;
        const n = conta(def.id, filtri); if (n > 0) out.push({ testo, numero: n, livello, entita: def.id, campo: c.id, filtri });
      }
    }
    const peso = { urgente: 0, attenzione: 1, info: 2 };
    return out.sort((a, b) => peso[a.livello] - peso[b.livello] || b.numero - a.numero).slice(0, 12);
  }

  // ---------- riepilogo: conteggi, somme e gruppi ----------
  r('POST', '/api/lumi/riepilogo', ({ ctx, corpo }) => riepilogo(serve(ctx), corpo));
  function riepilogo(ctx, { entita, filtri = [], campo_data, dal, al, somma = [], raggruppa, testo } = {}) {
    const def = S.leggi(db, String(entita || ''));
    if (!def || def.archiviata) throw new ErroreHttp(400, `Sezione sconosciuta «${entita}»`);
    P.verifica(ctx, def.id, 'leggi');
    const campo = id => { const c = S.campo(def, id); if (!c || c.archiviato || P.statoCampo(ctx, def.id, id) === 'nascosto') throw new ErroreHttp(400, `Campo sconosciuto «${id}» in ${def.nome}`); return c; };
    const f = Array.isArray(filtri) ? [...filtri] : [];
    if (dal || al) {
      const cd = campo_data || S.campiAttivi(def).find(c => c.tipo === 'data' || c.tipo === 'data_ora')?.id || 'creato';
      const ora = cd === 'creato' || cd === 'modificato' || campo(cd).tipo === 'data_ora';
      if (dal) f.push({ campo: cd, op: '>=', valore: ora ? new Date(dal + 'T00:00:00').toISOString() : dal });
      if (al) f.push({ campo: cd, op: '<=', valore: ora ? new Date(al + 'T23:59:59.999').toISOString() : al });
    }
    const sommati = (Array.isArray(somma) ? somma : [somma]).filter(Boolean).map(campo), gruppo = raggruppa ? campo(raggruppa) : null;
    const righe = [];
    for (let pagina = 1; pagina <= 20; pagina++) {
      const x = D.elenca(db, def.id, { filtri: f, cerca: testo || '', perPagina: 500, pagina }, ctx);
      righe.push(...x.righe); if (righe.length >= x.totale) break;
    }
    const somme = rr => Object.fromEntries(sommati.map(c => [c.id, Math.round(rr.reduce((t, x) => t + (Number(x[c.id]) || 0), 0) * 100) / 100]));
    const out = { entita: def.id, conteggio: righe.length, somme: somme(righe) };
    if (gruppo) {
      const g = new Map();
      for (const x of righe) { const k = leggibile(gruppo, x[gruppo.id]); (g.get(k) || g.set(k, []).get(k)).push(x); }
      out.gruppi = [...g].map(([valore, rr]) => ({ valore, conteggio: rr.length, somme: somme(rr) })).sort((a, b) => b.conteggio - a.conteggio).slice(0, 30);
    }
    return out;
  }

  // ---------- verifica: la modifica si prova davvero (anche la perdita di dati) e poi si annulla ----------
  r('POST', '/api/lumi/verifica', ({ ctx, corpo }) => {
    if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Non puoi personalizzare il gestionale');
    const errori = [], archivia = [];
    // i campi attivi che sparirebbero dalla definizione: diventerebbero archiviati (anche quelli nascosti a chi propone)
    for (const d of Array.isArray(corpo.entita) ? corpo.entita : []) for (const c of S.leggi(db, d?.id)?.campi || [])
      if (!c.archiviato && !(d.campi || []).some(x => x.id === c.id && !x.archiviato)) archivia.push(`${d.id}.${c.id}`);
    db.exec('SAVEPOINT lumi_prova');
    try {
      const entita = Array.isArray(corpo.entita) ? corpo.entita : [];
      if (entita.length) try { S.applicaTutte(db, entita, { utente: ctx.utente.id }); } catch (e) { errori.push(...(e.dettagli?.length ? e.dettagli : [e.message])); }
      if (corpo.automazione && !errori.length) errori.push(...A.valida(db, corpo.automazione));
    } finally { db.exec('ROLLBACK TO lumi_prova'); db.exec('RELEASE lumi_prova'); }
    return { ok: !errori.length, errori, archivia };
  });
}

// gli stati da cui si esce ancora: senza transizioni dichiarate, quelli che non suonano come una fine
const FINALI = /chius|pagat|consegnat|annullat|restituit|fatt[oa]$|complet|evas|archiv|rifiut|pers[oa]$|concluso|saldat|rientrat|spedit/i;
export function statiAperti(c) {
  if (c.transizioni) return c.opzioni.filter(o => (c.transizioni[o.id] || []).length > 0).map(o => o.id);
  return c.opzioni.filter(o => !FINALI.test(o.id) && !FINALI.test(o.nome)).map(o => o.id);
}
// un calcolato che dà vero/falso: un confronto o una condizione, non un SE(…) che restituisce testo o numeri
export function booleano(c) {
  if (c.formato === 'si_no') return true;
  if (c.formato) return false;
  const f = String(c.formula || '').replace(/"[^"]*"/g, '""');
  return !/^\s*SE\s*\(/i.test(f) && /<=|>=|<>|[<>=]|\b(E|O|NON|AND|OR|NOT)\b/.test(f);
}
// le date che sono una scadenza: «scadenza», «consegna», «entro», «al», «restituzione»…
export const scadenza = c => /scaden|consegn|entro|termin|restitu|ritorn|richiam|^al$|^a$|fino/i.test(c.id) || /scaden|consegn|entro|termin|restitu|ritorn|richiam|^al$|fino al/i.test(c.nome);
function leggibile(c, v) {
  if (v == null || v === '') return '—';
  if (c.tipo === 'relazione') return Array.isArray(v) ? v.map(x => x.titolo).join(', ') : v.titolo ?? String(v);
  if (['scelta', 'stato'].includes(c.tipo)) return c.opzioni?.find(o => o.id === v)?.nome || String(v);
  if (c.tipo === 'scelta_multipla') return (v || []).map(x => c.opzioni?.find(o => o.id === x)?.nome || x).join(', ');
  return String(v);
}
