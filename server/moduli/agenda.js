// Agenda, cruscotto, aggregati e viste salvate. Rotte:
//   GET  /api/agenda/:e?da&a&campo     gli eventi del calendario (data o data_ora), con durata e colonne per persona/risorsa
//   GET  /api/agenda-persone           le persone attive (id e nome) per le colonne e i filtri «utente»
//   POST /api/aggregati                conta/somma/media raggruppate per periodo o per campo (vedi agenda-aggregati.js)
//   GET  /api/cruscotto                il cruscotto con i dati di ogni widget (quello predefinito si crea se manca)
//   PUT  /api/cruscotto                salva i widget (serve il potere di personalizzare)
//   POST /api/cruscotto/anteprima      i dati di un widget non ancora salvato
//   GET|POST /api/viste/:e · PUT|DELETE /api/viste/:e/:id   viste salvate «per me» o «per tutti»
// Tutto passa per dati.js con il ctx dell'utente: permessi, «solo i propri» e campi nascosti valgono sempre.
import { nuovoId } from '../db.js';
import { aggrega, risolviFiltri, filtriFra, tutte, primoCampoData } from './agenda-aggregati.js';

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const TIPI_WIDGET = ['numero', 'grafico', 'attenzione', 'ultime'];

export default function registra({ r, db, S, D, P, serve, ErroreHttp }) {
  db.exec(`CREATE TABLE IF NOT EXISTS _agenda_cruscotti (id TEXT PRIMARY KEY, utente TEXT, def TEXT NOT NULL, modificato TEXT NOT NULL)`);
  const defLeggibile = (ctx, id) => { const d = S.leggi(db, id); if (!d || d.archiviata) throw new ErroreHttp(404, `Entità sconosciuta «${id}»`); P.verifica(ctx, id, 'leggi'); return d; };
  const visibile = (ctx, def, c) => c && !c.archiviato && P.statoCampo(ctx, def.id, c.id) !== 'nascosto';
  const persone = () => db.prepare('SELECT id, nome FROM _utenti WHERE attivo = 1 ORDER BY nome').all().map(u => ({ id: u.id, nome: u.nome }));

  // ---------- calendario ----------
  r('GET', '/api/agenda-persone', ({ ctx }) => { serve(ctx); return persone(); });
  r('GET', '/api/agenda/:e', ({ ctx, p, q }) => {
    serve(ctx); const def = defLeggibile(ctx, p.e), campi = S.campiAttivi(def).filter(c => visibile(ctx, def, c));
    const date = campi.filter(c => ['data', 'data_ora'].includes(c.tipo));
    const cd = date.find(c => c.id === q.get('campo')) || date.find(c => c.tipo === 'data_ora') || date[0];
    if (!cd) throw new ErroreHttp(400, `«${def.nome}» non ha campi data`);
    const da = q.get('da'), a = q.get('a');
    if (!GIORNO.test(da || '') || !GIORNO.test(a || '') || a < da) throw new ErroreHttp(400, 'Periodo non valido (da e a in AAAA-MM-GG)');
    if ((Date.parse(a) - Date.parse(da)) / 864e5 > 62) throw new ErroreHttp(400, 'Al massimo due mesi alla volta');
    const { righe, troncato } = tutte(db, def.id, filtriFra(def, cd.id, da, a), ctx, { limite: 3000 });
    // durata: un campo «durata» dell'entità, oppure quello di una relazione (es. servizio.durata), altrimenti 60 minuti
    const campoDurata = campi.find(c => c.tipo === 'durata');
    let durataDa = null;
    if (!campoDurata) for (const c of campi.filter(c => c.tipo === 'relazione' && !c.molti)) {
      const altra = S.leggi(db, c.entita), k = altra && P.puo(ctx, altra.id, 'leggi') && S.campiAttivi(altra).find(x => x.tipo === 'durata' && P.statoCampo(ctx, altra.id, x.id) !== 'nascosto');
      if (k) { durataDa = { relazione: c.id, entita: altra.id, campo: k.id }; break; }
    }
    const durate = new Map();
    if (durataDa) {
      const ids = [...new Set(righe.map(x => x[durataDa.relazione]?.id).filter(Boolean))];
      for (const x of tutte(db, durataDa.entita, [{ campo: 'id', op: 'in', valore: ids }], ctx).righe) durate.set(x.id, x[durataDa.campo]);
    }
    const colonne = campi.filter(c => c.tipo === 'utente' || (c.tipo === 'relazione' && !c.molti)).map(c => ({ id: c.id, nome: c.nome, tipo: c.tipo, entita: c.entita }));
    const titolo = S.campoTitolo(def), colore = campi.find(c => c.tipo === 'stato') || campi.find(c => c.tipo === 'scelta');
    const sotto = durataDa ? durataDa.relazione : campi.find(c => c.tipo === 'relazione' && !c.molti && c.id !== titolo?.id)?.id;
    const testo = v => (v && typeof v === 'object' ? v.titolo : v);
    const eventi = righe.map(x => {
      const o = colore && colore.opzioni.find(k => k.id === x[colore.id]);
      const dur = Number(campoDurata ? x[campoDurata.id] : durataDa ? durate.get(x[durataDa.relazione]?.id) : null);
      return { id: x.id, titolo: String(testo(titolo && x[titolo.id]) ?? '') || '—', sotto: sotto && x[sotto] ? String(testo(x[sotto])) : '',
        inizio: x[cd.id], durata: Number.isFinite(dur) && dur > 0 ? Math.min(dur, 24 * 60) : 60,
        colore: o?.colore || null, stato: o ? { id: o.id, nome: o.nome } : null,
        colonne: Object.fromEntries(colonne.map(c => [c.id, (typeof x[c.id] === 'object' ? x[c.id]?.id : x[c.id]) ?? null])) };
    }).filter(e => e.inizio);
    return { entita: def.id, campoData: cd.id, tipoData: cd.tipo, date: date.map(c => ({ id: c.id, nome: c.nome, tipo: c.tipo })),
      campoDurata: campoDurata?.id || null, durataDa, colonne, persone: colonne.some(c => c.tipo === 'utente') ? persone() : [], eventi, troncato,
      puo: { crea: P.puo(ctx, def.id, 'crea'), modifica: P.puo(ctx, def.id, 'modifica') && P.statoCampo(ctx, def.id, cd.id) !== 'lettura' } };
  });

  // ---------- aggregati ----------
  r('POST', '/api/aggregati', ({ ctx, corpo }) => aggrega(db, corpo || {}, serve(ctx)));

  // ---------- cruscotto ----------
  function leggiCruscotto() {
    const x = db.prepare("SELECT def FROM _agenda_cruscotti WHERE id = 'casa'").get();
    if (x) return JSON.parse(x.def);
    const def = { nome: 'Cruscotto', widget: predefinito(db, S) };
    db.prepare("INSERT INTO _agenda_cruscotti (id, utente, def, modificato) VALUES ('casa', NULL, ?, ?)").run(JSON.stringify(def), new Date().toISOString());
    return def;
  }
  function datiWidget(w, ctx) {
    if (w.tipo === 'ultime') return ultime(ctx, Math.min(30, Number(w.quante) || 10));
    if (w.tipo === 'attenzione') return { voci: (w.voci || []).flatMap(v => {
      const def = S.leggi(db, v.entita); if (!def || def.archiviata || !P.puo(ctx, def.id, 'leggi')) return [];
      try {
        const r = D.elenca(db, def.id, { filtri: risolviFiltri(def, v.filtri), perPagina: 5, ordina: v.ordina ? [v.ordina] : [] }, ctx);
        const t = S.campoTitolo(def);
        return [{ titolo: v.titolo, entita: def.id, filtri: v.filtri || [], totale: r.totale, righe: r.righe.map(x => ({ id: x.id, titolo: String((t && (typeof x[t.id] === 'object' ? x[t.id]?.titolo : x[t.id])) ?? x.id) })) }];
      } catch (e) { if (e instanceof D.ErroreDati || e instanceof P.ErrorePermesso) return []; throw e; }
    }) };
    return aggrega(db, { ...w, confronta: w.tipo === 'numero' && w.confronta !== false }, ctx);
  }
  // una voce di registro per riga, solo per le righe che l'utente può leggere; i valori non si mostrano (campi nascosti)
  function ultime(ctx, quante) {
    const out = [], visti = new Set(), nomi = new Map(db.prepare('SELECT id, nome FROM _utenti').all().map(u => [u.id, u.nome]));
    for (const x of db.prepare("SELECT quando, utente, tipo, entita, riga FROM _registro WHERE tipo IN ('crea','modifica','elimina','ripristina') ORDER BY id DESC LIMIT 400").all()) {
      if (out.length >= quante) break;
      const chiave = x.entita + '/' + x.riga; if (visti.has(chiave)) continue; visti.add(chiave);
      const def = S.leggi(db, x.entita); if (!def || def.archiviata || def.nascosta || !P.puo(ctx, def.id, 'leggi')) continue;
      let riga; try { riga = D.leggi(db, def.id, x.riga, ctx, { conRighe: false }); } catch { continue; }
      const t = S.campoTitolo(def), v = t && riga[t.id];
      out.push({ quando: x.quando, chi: nomi.get(x.utente) || 'automazione', tipo: x.tipo, entita: def.id, nomeEntita: def.nome, riga: x.riga, titolo: String((v && typeof v === 'object' ? v.titolo : v) ?? '') });
    }
    return { voci: out };
  }
  const calcolaTutti = (widget, ctx) => Object.fromEntries(widget.map(w => {
    try { return [w.id, datiWidget(w, ctx)]; }
    catch (e) { if (e instanceof P.ErrorePermesso) return [w.id, { negato: true }]; if (e instanceof D.ErroreDati || e instanceof ErroreHttp) return [w.id, { errore: e.message }]; throw e; }
  }));
  r('GET', '/api/cruscotto', ({ ctx }) => {
    serve(ctx); const c = leggiCruscotto(), dati = calcolaTutti(c.widget, ctx);
    // i widget su entità che l'utente non può vedere non si mostrano proprio
    const widget = c.widget.filter(w => !dati[w.id]?.negato && (!w.entita || P.puo(ctx, w.entita, 'leggi')));
    return { nome: c.nome, widget, dati, puoModificare: P.puoSchema(ctx) };
  });
  r('PUT', '/api/cruscotto', ({ ctx, corpo }) => {
    if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Solo chi personalizza il gestionale cambia il cruscotto');
    const widget = (Array.isArray(corpo?.widget) ? corpo.widget : []).slice(0, 40).map(w => validaWidget(w));
    const def = { nome: String(corpo.nome || 'Cruscotto').slice(0, 80), widget };
    db.prepare("INSERT INTO _agenda_cruscotti (id, utente, def, modificato) VALUES ('casa', NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET def = excluded.def, modificato = excluded.modificato").run(JSON.stringify(def), new Date().toISOString());
    return { ok: true, widget };
  });
  r('POST', '/api/cruscotto/anteprima', ({ ctx, corpo }) => { serve(ctx); const w = validaWidget({ ...corpo, id: corpo?.id || 'anteprima' }); return datiWidget(w, ctx); });
  function validaWidget(w) {
    if (!w || !TIPI_WIDGET.includes(w.tipo)) throw new ErroreHttp(400, 'Tipo di widget sconosciuto');
    if (!['ultime', 'attenzione'].includes(w.tipo) && !S.leggi(db, w.entita)) throw new ErroreHttp(400, `Entità sconosciuta «${w.entita}»`);
    const id = /^[\w-]{1,40}$/.test(w.id || '') ? w.id : nuovoId();
    return JSON.parse(JSON.stringify({ ...w, id, titolo: String(w.titolo || '').slice(0, 80) }));
  }

  // ---------- viste salvate ----------
  const vistaDa = (x, ctx) => {
    const def = S.leggi(db, x.entita), v = JSON.parse(x.def);
    // per chi ha campi nascosti: via colonne e filtri su quei campi (i filtri tolti si segnalano)
    const ok = id => ['creato', 'modificato'].includes(id) || visibile(ctx, def, S.campo(def, id));
    const filtri = (v.filtri || []).filter(f => ok(f.campo));
    return { ...v, id: x.id, entita: x.entita, perTutti: !x.utente, mia: x.utente === ctx.utente.id, colonne: (v.colonne || []).filter(ok), filtri,
      raggruppa: v.raggruppa && ok(v.raggruppa) ? v.raggruppa : null, incompleta: filtri.length !== (v.filtri || []).length || undefined };
  };
  r('GET', '/api/viste/:e', ({ ctx, p }) => {
    serve(ctx); defLeggibile(ctx, p.e);
    return db.prepare('SELECT * FROM _viste WHERE entita = ? AND (utente IS NULL OR utente = ?) ORDER BY utente IS NOT NULL, id').all(p.e, ctx.utente.id).map(x => vistaDa(x, ctx));
  });
  function pulisciVista(def, corpo) {
    const nome = String(corpo?.nome || '').trim().slice(0, 60); if (!nome) throw new ErroreHttp(400, 'Dai un nome alla vista');
    const esiste = id => ['creato', 'modificato'].includes(id) || !!S.campo(def, id);
    const filtri = (Array.isArray(corpo.filtri) ? corpo.filtri : []).slice(0, 30).map(f => ({ campo: String(f.campo), op: String(f.op || '='), valore: f.valore ?? null }));
    for (const f of filtri) if (!esiste(f.campo)) throw new ErroreHttp(400, `Filtro su un campo sconosciuto «${f.campo}»`);
    const colonne = (Array.isArray(corpo.colonne) ? corpo.colonne : []).map(String).filter(esiste).slice(0, 30);
    const ordina = corpo.ordina && esiste(corpo.ordina.campo) ? { campo: corpo.ordina.campo, dir: corpo.ordina.dir === 'asc' ? 'asc' : 'desc' } : null;
    return { nome, filtri, colonne, ordina, raggruppa: corpo.raggruppa && S.campo(def, corpo.raggruppa) ? corpo.raggruppa : null, modo: ['tabella', 'kanban'].includes(corpo.modo) ? corpo.modo : 'tabella' };
  }
  const potereCondivise = ctx => { if (!P.puoSchema(ctx)) throw new P.ErrorePermesso('Solo chi personalizza il gestionale salva viste per tutti'); };
  r('POST', '/api/viste/:e', ({ ctx, p, corpo }) => {
    serve(ctx); const def = defLeggibile(ctx, p.e); if (corpo?.perTutti) potereCondivise(ctx);
    const id = nuovoId();
    db.prepare('INSERT INTO _viste (id, entita, utente, def) VALUES (?, ?, ?, ?)').run(id, def.id, corpo?.perTutti ? null : ctx.utente.id, JSON.stringify(pulisciVista(def, corpo)));
    return vistaDa(db.prepare('SELECT * FROM _viste WHERE id = ?').get(id), ctx);
  });
  function vistaMia(ctx, e, id) {
    const x = db.prepare('SELECT * FROM _viste WHERE id = ? AND entita = ?').get(id, e);
    if (!x || (x.utente && x.utente !== ctx.utente.id)) throw new ErroreHttp(404, 'Vista non trovata');
    if (!x.utente) potereCondivise(ctx);
    return x;
  }
  r('PUT', '/api/viste/:e/:id', ({ ctx, p, corpo }) => {
    serve(ctx); const def = defLeggibile(ctx, p.e), x = vistaMia(ctx, p.e, p.id);
    const perTutti = corpo?.perTutti ?? !x.utente; if (perTutti) potereCondivise(ctx);
    db.prepare('UPDATE _viste SET utente = ?, def = ? WHERE id = ?').run(perTutti ? null : ctx.utente.id, JSON.stringify(pulisciVista(def, corpo)), x.id);
    return vistaDa(db.prepare('SELECT * FROM _viste WHERE id = ?').get(x.id), ctx);
  });
  r('DELETE', '/api/viste/:e/:id', ({ ctx, p }) => { serve(ctx); defLeggibile(ctx, p.e); const x = vistaMia(ctx, p.e, p.id); db.prepare('DELETE FROM _viste WHERE id = ?').run(x.id); return { ok: true }; });
}

// ---------- il cruscotto predefinito: per ogni modello installato, i widget che hanno senso (solo se le entità ci sono) ----------
export function predefinito(db, S) {
  const c = (e, ...campi) => { const d = S.leggi(db, e); return !!d && !d.archiviata && campi.every(k => S.campo(d, k) && !S.campo(d, k).archiviato); };
  const w = [], metti = (cond, x) => { if (cond) w.push({ id: `w${w.length + 1}`, ...x }); };
  // negozio
  metti(c('vendite', 'totale', 'data', 'stato'), { tipo: 'numero', titolo: 'Incassato oggi', entita: 'vendite', misura: 'somma', campo: 'totale', campoData: 'data', periodo: 'oggi', filtri: [{ campo: 'stato', op: '=', valore: 'pagata' }] });
  metti(c('vendite', 'totale', 'data', 'stato'), { tipo: 'numero', titolo: 'Incassato questo mese', entita: 'vendite', misura: 'somma', campo: 'totale', campoData: 'data', periodo: 'mese', filtri: [{ campo: 'stato', op: '=', valore: 'pagata' }] });
  metti(c('vendite', 'data'), { tipo: 'numero', titolo: 'Vendite oggi', entita: 'vendite', misura: 'conta', campoData: 'data', periodo: 'oggi', filtri: [{ campo: 'stato', op: '!=', valore: 'annullata' }] });
  metti(c('vendite', 'totale', 'data', 'stato'), { tipo: 'grafico', titolo: 'Incassi degli ultimi 30 giorni', entita: 'vendite', misura: 'somma', campo: 'totale', campoData: 'data', periodo: 'ultimi_30', per: 'giorno', forma: 'barre', filtri: [{ campo: 'stato', op: '=', valore: 'pagata' }], largo: true });
  // studio
  metti(c('appuntamenti', 'quando'), { tipo: 'numero', titolo: 'Appuntamenti oggi', entita: 'appuntamenti', misura: 'conta', campoData: 'quando', periodo: 'oggi', filtri: [{ campo: 'stato', op: 'in', valore: ['prenotato', 'confermato', 'fatto'] }] });
  metti(c('appuntamenti', 'quando', 'prezzo', 'pagato'), { tipo: 'numero', titolo: 'Incassato oggi', entita: 'appuntamenti', misura: 'somma', campo: 'prezzo', campoData: 'quando', periodo: 'oggi', filtri: [{ campo: 'pagato', op: '=', valore: true }] });
  metti(c('appuntamenti', 'quando', 'prezzo', 'pagato'), { tipo: 'numero', titolo: 'Incassato questo mese', entita: 'appuntamenti', misura: 'somma', campo: 'prezzo', campoData: 'quando', periodo: 'mese', filtri: [{ campo: 'pagato', op: '=', valore: true }] });
  metti(c('appuntamenti', 'quando'), { tipo: 'grafico', titolo: 'Appuntamenti per settimana', entita: 'appuntamenti', misura: 'conta', campoData: 'quando', periodo: 'ultimi_84', per: 'settimana', forma: 'linea', filtri: [{ campo: 'stato', op: 'in', valore: ['prenotato', 'confermato', 'fatto'] }], largo: true });
  // laboratorio
  metti(c('preventivi', 'stato'), { tipo: 'numero', titolo: 'Preventivi in attesa', entita: 'preventivi', misura: 'conta', filtri: [{ campo: 'stato', op: '=', valore: 'inviato' }] });
  metti(c('commesse', 'fase'), { tipo: 'numero', titolo: 'Commesse aperte', entita: 'commesse', misura: 'conta', filtri: [{ campo: 'fase', op: 'in', valore: ['da_iniziare', 'in_lavorazione', 'rifinitura', 'pronta'] }] });
  metti(c('preventivi', 'totale', 'data', 'stato'), { tipo: 'numero', titolo: 'Accettato questo mese', entita: 'preventivi', misura: 'somma', campo: 'totale', campoData: 'data', periodo: 'mese', filtri: [{ campo: 'stato', op: '=', valore: 'accettato' }] });
  metti(c('preventivi', 'totale', 'data', 'stato'), { tipo: 'grafico', titolo: 'Preventivi accettati per mese', entita: 'preventivi', misura: 'somma', campo: 'totale', campoData: 'data', periodo: 'ultimi_365', per: 'mese', forma: 'barre', filtri: [{ campo: 'stato', op: '=', valore: 'accettato' }], largo: true });
  // cosa richiede attenzione: calcolati veri, date scadute, stati fermi da giorni
  const voci = [];
  if (c('articoli', 'da_riordinare')) voci.push({ titolo: 'Articoli da riordinare', entita: 'articoli', filtri: [{ campo: 'da_riordinare', op: '=', valore: true }] });
  if (c('materiali', 'da_riordinare')) voci.push({ titolo: 'Materiali da riordinare', entita: 'materiali', filtri: [{ campo: 'da_riordinare', op: '=', valore: true }] });
  if (c('ordini', 'consegna_prevista', 'stato')) voci.push({ titolo: 'Ordini in ritardo', entita: 'ordini', filtri: [{ campo: 'consegna_prevista', op: '<', valore: '@oggi' }, { campo: 'stato', op: '=', valore: 'inviato' }] });
  if (c('vendite', 'stato')) voci.push({ titolo: 'Vendite aperte da più di 2 giorni', entita: 'vendite', filtri: [{ campo: 'stato', op: '=', valore: 'aperta' }, { campo: 'modificato', op: '<', valore: '@oggi-2' }] });
  if (c('commesse', 'in_ritardo')) voci.push({ titolo: 'Commesse in ritardo', entita: 'commesse', filtri: [{ campo: 'in_ritardo', op: '=', valore: true }] });
  if (c('preventivi', 'stato')) voci.push({ titolo: 'Preventivi senza risposta da 7 giorni', entita: 'preventivi', filtri: [{ campo: 'stato', op: '=', valore: 'inviato' }, { campo: 'modificato', op: '<', valore: '@oggi-7' }] });
  if (c('appuntamenti', 'quando', 'stato')) voci.push({ titolo: 'Appuntamenti passati da chiudere', entita: 'appuntamenti', filtri: [{ campo: 'quando', op: '<', valore: '@oggi' }, { campo: 'stato', op: 'in', valore: ['prenotato', 'confermato'] }] });
  if (c('pacchetti', 'scadenza', 'rimaste')) voci.push({ titolo: 'Pacchetti scaduti con sedute', entita: 'pacchetti', filtri: [{ campo: 'scadenza', op: '<', valore: '@oggi' }, { campo: 'rimaste', op: '>', valore: 0 }] });
  metti(voci.length, { tipo: 'attenzione', titolo: 'Cosa richiede attenzione', voci });
  metti(true, { tipo: 'ultime', titolo: 'Ultime modifiche', quante: 8 });
  // se non c'è nessun modello noto: un numero per ogni entità visibile con un campo data
  if (w.length <= 1) for (const d of S.elenco(db).filter(e => !e.nascosta).slice(0, 4)) w.unshift({ id: `w${w.length + 1}`, tipo: 'numero', titolo: `${d.nome}: nuovi questo mese`, entita: d.id, misura: 'conta', campoData: primoCampoData(d) === 'creato' ? 'creato' : primoCampoData(d), periodo: 'mese' });
  return w;
}
