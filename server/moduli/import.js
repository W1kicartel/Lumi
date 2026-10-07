// Import ed export dei dati, e il backup completo.
//   POST /api/import/anteprima { caricamento, entita? }   le prime righe, i tipi indovinati, l'abbinamento proposto
//   POST /api/import/esegui { caricamento, entita | nuova: { nome }, abbinamento: { colonna: idCampo | { nuovo, tipo?, nome? } | null },
//        doppioni?: { campo, modo: 'aggiorna' | 'salta' }, prova? }   → { create, aggiornate, saltate, errori: [{ riga, messaggio, valori }] }
//   GET  /api/import/esporta/:e?formato=csv|xlsx&q&f&o&arch   la lista con gli stessi filtri dell'interfaccia
//   GET  /api/import/backup                                  solo il titolare: zip con la copia coerente del database
//                                                             (VACUUM INTO) e gli allegati
// Tutto con i permessi di chi lo fa: le righe passano da D.crea / D.modifica / D.elenca con il suo ctx.
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { transazione } from '../db.js';
import { leggiTabella, scriviCsv, scriviXlsx, scriviZip, numeroIt, dataIt, siNo, indovinaTipo, proponiAbbinamento, slug, ErroreFormato } from './import-formati.js';
import { caricamento, fileDaSalvare, intestazioneNome } from './import-file.js';

const NON_IMPORTABILI = ['calcolato', 'contatore', 'righe', 'file', 'immagine'];
const RISERVATI = new Set(['id', 'creato', 'modificato', 'creato_da', 'modificato_da', 'archiviato']);
const MAX_ERRORI = 1000;
class Annulla extends Error {}

export default function registra({ r, db, S, D, P, serve, ErroreHttp, manda }) {
  const tabellaDi = (id, ctx) => {
    const c = caricamento(db, id, ctx);
    if (!c?.completo) throw new ErroreHttp(404, 'Il file non è arrivato: caricalo di nuovo');
    try { return leggiTabella(readFileSync(c.percorso), c.nome); }
    catch (e) { if (e instanceof ErroreFormato) throw new ErroreHttp(422, e.message); throw new ErroreHttp(422, 'Non riesco a leggere il file: è un .xlsx o un .csv?'); }
  };
  const colonna = (tab, i) => tab.righe.map(r => r[i]);
  const importabili = (def, ctx) => S.campiAttivi(def).filter(c => !NON_IMPORTABILI.includes(c.tipo) && !P.statoCampo(ctx, def.id, c.id));

  r('POST', '/api/import/anteprima', ({ ctx, corpo }) => {
    serve(ctx);
    const tab = tabellaDi(corpo.caricamento, ctx);
    const def = corpo.entita ? S.leggi(db, String(corpo.entita)) : null;
    if (corpo.entita && (!def || def.archiviata || !P.puo(ctx, def.id, 'leggi'))) throw new ErroreHttp(404, 'Sezione sconosciuta');
    return {
      intestazioni: tab.intestazioni, righe: tab.righe.slice(0, 8), totale: tab.righe.length,
      tipi: tab.intestazioni.map((t, i) => indovinaTipo(t, colonna(tab, i))),
      abbinamento: def ? proponiAbbinamento(tab.intestazioni, importabili(def, ctx)) : null,
    };
  });

  // un campo nuovo da una colonna del file: il tipo è quello scelto o quello indovinato
  function campoDa(intestazione, valori, scelta, occupati) {
    const ind = indovinaTipo(intestazione, valori);
    const tipo = S.TIPI[scelta?.tipo] && !NON_IMPORTABILI.includes(scelta.tipo) && scelta.tipo !== 'relazione' ? scelta.tipo : ind.tipo;
    const nome = String(scelta?.nome || intestazione).trim().slice(0, 80) || intestazione;
    let id = slug(nome), n = 1; while (RISERVATI.has(id) || occupati.has(id)) id = `${slug(nome).slice(0, 36)}_${++n}`;
    occupati.add(id);
    const c = { id, nome, tipo };
    if (['scelta', 'scelta_multipla', 'stato'].includes(tipo)) {
      const distinti = [...new Set(valori.flatMap(x => (x == null || x === '' ? [] : tipo === 'scelta_multipla' ? String(x).split(/\s*[;,|]\s*/) : [String(x).trim()])).filter(Boolean))];
      if (ind.opzioni && tipo === 'scelta') c.opzioni = ind.opzioni;
      else if (distinti.length && distinti.length <= 60) { const ids = new Set(); c.opzioni = distinti.map(x => { let o = slug(x); while (ids.has(o)) o += '_'; ids.add(o); return { id: o, nome: x, colore: 'grigio' }; }); }
      else { c.tipo = 'testo'; }
    }
    return c;
  }

  // da valore del foglio a valore per D.crea, secondo il tipo del campo (lancia Error con un messaggio chiaro)
  function convertitore(c, ctx) {
    const no = m => { throw new Error(m); };
    const opzione = x => c.opzioni.find(o => o.id === String(x).trim() || o.nome.toLowerCase() === String(x).trim().toLowerCase());
    switch (c.tipo) {
      case 'numero': case 'percentuale': case 'durata': case 'valuta':
        return x => { const n = numeroIt(x); if (!Number.isFinite(n)) no(`«${x}» non è ${c.tipo === 'valuta' ? 'un importo' : 'un numero'}`); return n; };
      case 'si_no': return x => { const b = siNo(x); if (b === undefined) no(`«${x}»: scrivi sì o no`); return b; };
      case 'data': return x => { const d = dataIt(x); if (!d) no(`«${x}» non è una data (es. 31/12/2026)`); return d.data; };
      case 'data_ora': return x => { const d = dataIt(x); if (!d) no(`«${x}» non è una data con l'ora (es. 31/12/2026 14:30)`); return d.iso || new Date(`${d.data}T${d.ora || '00:00'}:00`).toISOString(); };
      case 'scelta': case 'stato': return x => { const o = opzione(x); if (!o) no(`«${x}» non è fra le opzioni di «${c.nome}»`); return o.id; };
      case 'scelta_multipla': return x => String(x).split(/\s*[;,|]\s*/).filter(Boolean).map(y => { const o = opzione(y); if (!o) no(`«${y}» non è fra le opzioni di «${c.nome}»`); return o.id; });
      case 'relazione': {
        if (!P.puo(ctx, c.entita, 'leggi')) return () => no(`Non puoi vedere «${c.entita}»`);
        const altra = S.leggi(db, c.entita), t = altra && S.campoTitolo(altra), cache = new Map();
        const q = db.prepare(`SELECT id FROM ${S.tabella(c.entita)} WHERE archiviato = 0 AND (id = ?${t && S.haColonna(t) ? ` OR lower(trim(${S.colonna(t.id)})) = lower(?)` : ''}) LIMIT 2`);
        const trova = y => { const k = String(y).trim(); if (!cache.has(k)) { const l = q.all(...(t && S.haColonna(t) ? [k, k] : [k])); cache.set(k, l.length === 1 ? l[0].id : l.length ? false : null); }
          const v = cache.get(k); if (v === null) no(`«${k}» non c'è in «${altra?.nome || c.entita}»`); if (v === false) no(`«${k}»: in «${altra?.nome}» ce n'è più di uno con questo nome`); return v; };
        return c.molti ? x => String(x).split(/\s*[;|]\s*/).filter(Boolean).map(trova) : trova;
      }
      case 'utente': { const q = db.prepare('SELECT id FROM _utenti WHERE id = ? OR lower(nome) = lower(?) OR email = ? LIMIT 1');
        return x => { const k = String(x).trim(); const u = q.get(k, k, k); if (!u) no(`«${k}» non è una persona del gestionale`); return u.id; }; }
      case 'email': return x => String(x).trim().toLowerCase();
      default: return x => (typeof x === 'number' && Number.isInteger(x) ? String(x) : String(x)).trim();
    }
  }

  r('POST', '/api/import/esegui', ({ ctx, corpo }) => {
    serve(ctx);
    const tab = tabellaDi(corpo.caricamento, ctx);
    const abb = corpo.abbinamento && typeof corpo.abbinamento === 'object' ? corpo.abbinamento : {};
    const nuoviCampi = tab.intestazioni.filter(t => abb[t] && typeof abb[t] === 'object' && abb[t].nuovo);
    if ((corpo.nuova || nuoviCampi.length) && !P.puoSchema(ctx)) throw new P.ErrorePermesso('Solo chi può personalizzare crea sezioni e campi nuovi');
    let toccata = null;
    try {
      return transazione(db, () => {
        // 1. la sezione nuova, o i campi che mancano
        let def;
        if (corpo.nuova) {
          const nome = String(corpo.nuova.nome || '').trim().slice(0, 60); if (!nome) throw new ErroreHttp(400, 'Dai un nome alla nuova sezione');
          let id = slug(nome).replace(/^c_/, 's_'), n = 1; while (S.leggi(db, id)) id = `${slug(nome).slice(0, 36)}_${++n}`;
          const occupati = new Set(), campi = [];
          tab.intestazioni.forEach((t, i) => { if (abb[t] === null) return; const c = campoDa(t, colonna(tab, i), abb[t], occupati); campi.push(c); abb[t] = c.id; });
          if (!campi.length) throw new ErroreHttp(400, 'Scegli almeno una colonna');
          const titolo = campi.find(c => c.tipo === 'testo') || campi[0];
          def = S.applica(db, { id, nome, icona: 'cartella', titolo: ['testo', 'email', 'contatore'].includes(titolo.tipo) ? titolo.id : undefined, campi }, { utente: ctx.utente.id });
        } else {
          def = S.leggi(db, String(corpo.entita || ''));
          if (!def || def.archiviata || !P.puo(ctx, def.id, 'leggi')) throw new ErroreHttp(404, 'Sezione sconosciuta');
          if (nuoviCampi.length) {
            const occupati = new Set(def.campi.map(c => c.id)), aggiunti = nuoviCampi.map(t => campoDa(t, colonna(tab, tab.intestazioni.indexOf(t)), abb[t], occupati));
            nuoviCampi.forEach((t, i) => { abb[t] = aggiunti[i].id; });
            const { archiviata, ...pulita } = def;
            def = S.applica(db, { ...pulita, campi: [...def.campi, ...aggiunti] }, { utente: ctx.utente.id });
          }
        }
        P.verifica(ctx, def.id, 'crea'); toccata = def.id;
        // 2. le colonne usate, con il loro convertitore
        const usabili = new Map(importabili(def, ctx).map(c => [c.id, c]));
        const colonne = tab.intestazioni.map((t, i) => ({ t, i, c: usabili.get(abb[t]) })).filter(x => x.c);
        if (!colonne.length) throw new ErroreHttp(400, 'Nessuna colonna abbinata a un campo');
        for (const x of colonne) x.conv = convertitore(x.c, ctx);
        const chiave = corpo.doppioni?.campo ? usabili.get(corpo.doppioni.campo) : null;
        if (corpo.doppioni?.campo && !chiave) throw new ErroreHttp(400, 'Campo per i doppioni sconosciuto');
        if (chiave && corpo.doppioni.modo !== 'salta') P.verifica(ctx, def.id, 'modifica');
        // 3. le righe: ognuna nel suo punto di salvataggio, gli errori si raccolgono e il resto entra
        const esito = { entita: def.id, nome: def.nome, create: 0, aggiornate: 0, saltate: 0, errori: [], erroriTotali: 0, prova: !!corpo.prova };
        tab.righe.forEach((riga, j) => {
          const valori = {}, sbagli = [];
          for (const x of colonne) {
            const v = riga[x.i]; if (v == null || (typeof v === 'string' && !v.trim())) continue;
            try { valori[x.c.id] = x.conv(v); } catch (e) { sbagli.push(`${x.t}: ${e.message}`); }
          }
          try {
            if (sbagli.length) throw new D.ErroreDati(sbagli.join(' · '));
            if (!Object.keys(valori).length) { esito.saltate++; return; }
            let esistente = null;
            if (chiave && valori[chiave.id] != null && valori[chiave.id] !== '') {
              const v = valori[chiave.id];
              esistente = D.elenca(db, def.id, { filtri: [{ campo: chiave.id, op: '=', valore: Array.isArray(v) ? v[0] : v }], perPagina: 1 }, ctx).righe[0] || null;
            }
            if (esistente && corpo.doppioni.modo === 'salta') esito.saltate++;
            else if (esistente) { D.modifica(db, def.id, esistente.id, valori, ctx, { interno: true }); esito.aggiornate++; }
            else { D.crea(db, def.id, valori, ctx, { interno: true }); esito.create++; }
          } catch (e) {
            if (!(e instanceof D.ErroreDati || e instanceof P.ErrorePermesso)) throw e;
            esito.erroriTotali++;
            if (esito.errori.length < MAX_ERRORI) esito.errori.push({ riga: j + 2, messaggio: e.message, valori: riga.map(x => (x == null ? '' : x)) });
          }
        });
        if (corpo.prova) throw Object.assign(new Annulla(), { esito });
        return esito;
      });
    } catch (e) { if (e instanceof Annulla) return e.esito; throw e; }
    finally { if (!corpo.prova && toccata) manda({ tipo: 'import', entita: toccata, da: ctx.utente.id }); }
  });

  // ---------- export ----------
  function cella(c, v, utenti) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
    const tipo = c.tipo === 'calcolato' ? c.formato || (typeof v === 'number' ? 'numero' : typeof v === 'boolean' ? 'si_no' : 'testo') : c.tipo;
    switch (tipo) {
      case 'valuta': return typeof v === 'number' ? { euro: v } : v;
      case 'numero': case 'percentuale': case 'durata': return typeof v === 'number' ? v : Number(v);
      case 'si_no': return !!v;
      case 'data': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { data: v } : String(v);
      case 'data_ora': return { dataOra: v };
      case 'scelta': case 'stato': return c.opzioni?.find(o => o.id === v)?.nome ?? String(v);
      case 'scelta_multipla': return v.map(x => c.opzioni?.find(o => o.id === x)?.nome ?? x).join(', ');
      case 'relazione': return Array.isArray(v) ? v.map(x => x.titolo).join(', ') : String(v.titolo ?? v.id ?? v);
      case 'utente': return utenti.get(v) ?? String(v);
      case 'file': case 'immagine': return v.map(x => x.nome).join(', ');
      default: return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
  r('GET', '/api/import/esporta/:e', ({ ctx, p, q, res }) => {
    serve(ctx);
    const def = S.leggi(db, p.e); if (!def || def.archiviata) throw new ErroreHttp(404, 'Sezione sconosciuta');
    // ?vuoto=1: il modello da compilare, con le sole colonne che si possono importare
    const vuoto = q.get('vuoto') === '1';
    const campi = vuoto ? importabili(def, ctx) : S.campiAttivi(def).filter(c => c.tipo !== 'righe' && P.statoCampo(ctx, def.id, c.id) !== 'nascosto');
    const opz = { cerca: q.get('q') || '', filtri: q.get('f') ? JSON.parse(q.get('f')) : [], archiviati: q.get('arch') === '1', perPagina: 500,
      ordina: (q.get('o') || '').split(',').filter(Boolean).map(x => { const [campo, dir] = x.split(':'); return { campo, dir }; }) };
    const utenti = new Map(db.prepare('SELECT id, nome FROM _utenti').all().map(u => [u.id, u.nome])), righe = [];
    for (let pagina = 1; pagina <= 200 && !vuoto; pagina++) {
      const r = D.elenca(db, def.id, { ...opz, pagina }, ctx);
      for (const x of r.righe) righe.push(campi.map(c => cella(c, x[c.id], utenti)));
      if (pagina * r.perPagina >= r.totale) break;
    }
    const xlsx = q.get('formato') !== 'csv', oggi = new Date().toISOString().slice(0, 10);
    const dati = xlsx ? scriviXlsx(campi.map(c => c.nome), righe, { foglio: def.nome }) : Buffer.from(scriviCsv(campi.map(c => c.nome), righe), 'utf8');
    res.writeHead(200, { 'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
      'Content-Disposition': intestazioneNome(`${def.nome} ${vuoto ? 'da compilare' : oggi}.${xlsx ? 'xlsx' : 'csv'}`), 'Content-Length': dati.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(dati);
  });

  // ---------- backup completo ----------
  r('GET', '/api/import/backup', ({ ctx, res }) => {
    if (serve(ctx).r.id !== 'titolare' || ctx.viaToken) throw new P.ErrorePermesso('Solo il titolare scarica il backup, dall\'interfaccia');
    const cartella = join(tmpdir(), `kubo-backup-${randomBytes(6).toString('hex')}`); mkdirSync(cartella, { recursive: true });
    const copia = join(cartella, 'kubo.db');
    try {
      db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);   // copia coerente anche mentre altri scrivono
      const allegati = fileDaSalvare(db), peso = allegati.reduce((s, f) => s + f.dimensione, 0), conAllegati = peso <= 1024 * 1024 * 1024;
      const ora = new Date(), nome = `kubo-backup-${ora.toISOString().slice(0, 16).replace(/[T:]/g, '-')}.zip`;
      const zip = scriviZip([
        { nome: 'kubo.db', dati: readFileSync(copia) },
        { nome: 'LEGGIMI.txt', dati: `Backup di Kubo del ${ora.toLocaleString('it-IT')}.\r\n\r\nPer ripristinarlo: ferma Kubo, metti kubo.db${conAllegati ? ' e la cartella file' : ''} nella cartella dei dati (quella di --dati, di solito ./dati) al posto di quelli che ci sono, poi riaccendi.\r\n${conAllegati ? '' : '\r\nGli allegati superano 1 GB e non sono nello zip: copia a mano la cartella dati/file.\r\n'}` },
        ...(conAllegati ? allegati.map(f => ({ nome: f.nome, dati: readFileSync(f.percorso), comprimi: false })) : []),
      ]);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': intestazioneNome(nome), 'Content-Length': zip.length, 'Cache-Control': 'no-store' }).end(zip);
    } finally { rmSync(cartella, { recursive: true, force: true }); }
  });
}
