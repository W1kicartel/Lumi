// L'assistente Lumi: legge e propone con i permessi di chi è collegato.
//   POST /api/lumi                  il server di Lumi (stato, chat in streaming, voce, file): fa da tramite verso Claude
//                                   con la chiave dell'azienda, che non arriva mai al browser
//   GET  /api/lumi/impostazioni     acceso o spento, se c'è la chiave e da dove viene (mai la chiave)
//   PUT  /api/lumi/impostazioni     { chiave?, togliChiave?, attivo?, limite? }: solo il titolare
//   GET  /api/lumi/da-vedere        «cosa richiede attenzione», generato dallo schema e letto con i permessi dell'utente
//   POST /api/lumi/riepilogo        conteggi e somme per filtro e periodo («quanto ho venduto questa settimana»)
//   POST /api/lumi/verifica         prova una modifica dello schema o un'automazione senza applicarla (per la proposta)
//   POST /api/lumi/voce/trascrivi   la voce locale (Parakeet v3 su questo computer, lumi/voce.js): corpo float32 little-endian
//                                   mono 16 kHz (application/octet-stream), al massimo 60 secondi → { testo, motore }
// La chiave sta in un file accanto al database (permessi 600) o, se il database è in memoria, nelle impostazioni; senza,
// vale la variabile ANTHROPIC_API_KEY. Il motore dell'assistente (lumi/nucleo.js) viene dal progetto Lumi per le aziende.
import { readFileSync, writeFileSync, unlinkSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creaGestore, MODELLO } from './lumi/nucleo.js';
import { creaVoceLocale, scegliMotore, daByte, MAX_BYTE } from './lumi/voce.js';
import { mezzanotte, piuGiorni, giornoDi } from './agenda-aggregati.js';   // i giorni nel fuso dell'azienda

const ORIGINE = 'http://lumi.lumi';   // il nucleo vuole un'origine ammessa: la richiesta la costruiamo noi, dopo la sessione
const CHIAVE = /^sk-[\w-]{10,300}$/;
const SENZA_CHIAVE = 'Lumi non ha ancora la chiave di Claude: il titolare la aggiunge in Gestione → Lumi.';
const GIORNO = 864e5;
const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // server/, web/ e (in sviluppo) desktop/bin
// le voci locali accese da questo processo (una per server): si chiudono tutte all'uscita
const VOCI = new Set();
process.once('exit', () => { for (const v of VOCI) v.chiudi(); });

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
  const limite = () => Number(meta.leggi(db, 'lumi.limite') || process.env.LUMI_DOMANDE_MINUTO || 20);
  const titolare = ctx => { if (serve(ctx).r.id !== 'titolare') throw new P.ErrorePermesso('Solo il titolare cambia le impostazioni di Lumi'); return ctx; };
  // la voce locale: il motore si sceglie una volta, all'avvio (lumi-voce sul Mac con chip Apple, sherpa-onnx altrove, o niente)
  const cartellaDati = () => { const l = db.location?.(); return l ? dirname(l) : null; };
  const voce = creaVoceLocale({ scelta: scegliMotore({ radice: RADICE, cartellaModello: process.env.LUMI_VOCE_MODELLO || (cartellaDati() && join(cartellaDati(), 'voce-onnx')) }),
    temp: process.env.LUMI_VOCE_TEMP || undefined });
  VOCI.add(voce);
  const impostazioni = () => ({ attivo: acceso(), chiave: !!chiave(), fonte: chiaveSalvata() ? 'impostazioni' : chiave() ? 'ambiente' : null,
    limite: limite(), modello: process.env.LUMI_MODELLO || MODELLO, voce: !!process.env.DEEPGRAM_API_KEY, voceLocale: voce.motore });

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
    if (az === 'stato') {
      // voceLocale: si può usare adesso (il modello è in memoria); voceMotore: c'è su questo computer. Chi chiede lo stato
      // la fa preparare in sottofondo: alla prima frase il modello è già pronto
      if (acceso() && voce.disponibile() && !voce.pronta()) voce.prepara();
      return { claude: acceso() && !!k, voce: acceso() && !!k && !!process.env.DEEPGRAM_API_KEY, modello: process.env.LUMI_MODELLO || MODELLO, attivo: acceso(), chiave: !!k,
        voceLocale: acceso() && voce.pronta(), voceMotore: acceso() ? voce.motore : null };
    }
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

  // ---------- la voce locale: l'audio resta su questo computer ----------
  // stessa autenticazione di POST /api/lumi (sessione o token, X-Lumi), Lumi acceso, un limite al minuto per persona
  // (lo stesso numero delle domande, contato a parte). Una trascrizione alla volta: le altre aspettano in fila.
  const contiVoce = new Map();
  r('POST', '/api/lumi/voce/trascrivi', async ({ ctx, grezzo }) => {
    serve(ctx);
    if (!acceso()) throw new ErroreHttp(400, 'Lumi è spento: il titolare lo riaccende in Gestione → Lumi.');
    if (!voce.disponibile()) throw new ErroreHttp(503, 'La voce locale non c\'è su questo server');
    const b = grezzo || Buffer.alloc(0);
    if (b.length > MAX_BYTE) throw new ErroreHttp(413, 'Audio troppo lungo: al massimo 60 secondi');
    if (!b.length || b.length % 4) throw new ErroreHttp(400, 'Audio non valido: serve float32 mono a 16 kHz');
    const ora = Date.now(), c = contiVoce.get(ctx.utente.id);
    if (!c || ora - c.da > 6e4) contiVoce.set(ctx.utente.id, { da: ora, n: 1 }); else if (++c.n > limite()) throw new ErroreHttp(429, 'Troppe domande in poco tempo: riprova fra un minuto.');
    try { return { testo: await voce.trascrivi(daByte(b)), motore: voce.motore }; }
    catch (e) {
      if (e.codice === 'occupata') throw new ErroreHttp(503, 'La voce locale è occupata: riprova fra poco');
      console.error('voce locale:', e.message);
      throw new ErroreHttp(502, 'La voce locale non ha risposto: riprova');
    }
  }, { grezzo: true });

  // ---------- «Da vedere»: dallo schema, con i permessi di chi guarda ----------
  // ogni browser lo rilegge ogni minuto e i calcolati costano: per 20 secondi vale la stessa risposta (per persona)
  const memoria = new Map();
  r('GET', '/api/lumi/da-vedere', ({ ctx }) => {
    const id = serve(ctx).utente.id, m = memoria.get(id), ora = Date.now();
    if (m && ora - m.quando < 2e4 && m.versione === versione()) return m.cose;
    const cose = daVedere(ctx); memoria.set(id, { quando: ora, versione: versione(), cose });
    if (memoria.size > 500) memoria.clear();
    return cose;
  });
  // cambia a ogni scrittura: il registro cresce sempre
  const versione = () => db.prepare('SELECT MAX(id) n FROM _registro').get().n;
  function daVedere(ctx) {
    const oggi = giornoDi(new Date()), settimana = new Date(Date.now() - 7 * GIORNO).toISOString(), out = [];
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
    const giorno = x => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x)) || isNaN(new Date(x))) throw new ErroreHttp(400, `Data non valida «${x}»: usa AAAA-MM-GG`); return x; };
    if (dal) giorno(dal); if (al) giorno(al);
    if (dal || al) {
      const cd = campo_data || S.campiAttivi(def).find(c => c.tipo === 'data' || c.tipo === 'data_ora')?.id || 'creato';
      const ora = cd === 'creato' || cd === 'modificato' || campo(cd).tipo === 'data_ora';
      if (dal) f.push({ campo: cd, op: '>=', valore: ora ? mezzanotte(dal) : dal });
      if (al) f.push(ora ? { campo: cd, op: '<', valore: mezzanotte(piuGiorni(al, 1)) } : { campo: cd, op: '<=', valore: al });
    }
    const sommati = (Array.isArray(somma) ? somma : [somma]).filter(Boolean).map(campo), gruppo = raggruppa ? campo(raggruppa) : null;
    const righe = []; let totale = 0;
    // prima la lettura leggera in SQL (solo le colonne da sommare e raggruppare), altrimenti a pagine come prima
    const veloce = D.elenca(db, def.id, { filtri: f, cerca: testo || '', leggero: [...sommati.map(c => c.id), gruppo?.id].filter(Boolean), limite: 10000 }, ctx);
    if (veloce) { totale = veloce.totale; righe.push(...veloce.righe); }
    else for (let pagina = 1; pagina <= 20; pagina++) {
      const x = D.elenca(db, def.id, { filtri: f, cerca: testo || '', perPagina: 500, pagina }, ctx);
      totale = x.totale; righe.push(...x.righe); if (righe.length >= x.totale || !x.righe.length) break;
    }
    const somme = rr => Object.fromEntries(sommati.map(c => [c.id, Math.round(rr.reduce((t, x) => t + (Number(x[c.id]) || 0), 0) * 100) / 100]));
    // oltre 10.000 elementi il conteggio resta esatto, somme e gruppi no: lo si dice al modello
    const out = { entita: def.id, conteggio: totale, somme: somme(righe), ...(totale > righe.length ? { parziale: `somme e gruppi sui primi ${righe.length}` } : {}) };
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
    for (const d of Array.isArray(corpo.entita) ? corpo.entita : []) {
      const prima = S.leggi(db, d?.id);
      // una sezione archiviata con lo stesso id tornerebbe in vita con i campi di prima: meglio dirlo che farlo
      if (prima?.archiviata) { errori.push(`c'è già una sezione archiviata «${prima.nome}» (${prima.id}): ripristinala da Personalizza o scegli un altro nome`); continue; }
      for (const c of prima?.campi || []) if (!c.archiviato && !(d.campi || []).some(x => x.id === c.id && !x.archiviato)) archivia.push(`${d.id}.${c.id}`);
    }
    if (errori.length) return { ok: false, errori, archivia };
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
