// Documenti, stampe e fattura elettronica. Il modulo aggiunge:
//   - i dati dell'azienda (ragione sociale, P.IVA, regime, indirizzo, PEC, IBAN, logo, colore) in _meta «documenti.azienda»;
//   - i modelli di stampa per ogni entità con righe (in _meta «documenti.stampa.<entità>», altrimenti quello predefinito);
//   - le fatture: numero assegnato all'emissione (per anno e serie, dalla data della fattura), IVA calcolata per aliquota,
//     «crea fattura da» vendita/preventivo/commessa, controlli ed esportazione FatturaPA (FPR12).
// Il logo sta nella cartella dei dati (documenti/logo.png|jpg accanto a kubo.db); con il database in memoria resta in _meta.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { VALIDATORI } from './documenti-italia.js';
import { totali, cent } from './documenti-calcoli.js';
import { controlla, xml, contiFattura, progressivoDa, REGIMI } from './documenti-xml.js';
import { unificaIndirizzo } from './sicurezza-migrazioni.js';
import { modelloPredefinito, pulisciModello, documentoHtml, singolare, rendi } from './documenti-stampa.js';

const FATTURE = 'fatture';
const CAMPI_AZIENDA = ['ragione_sociale', 'piva', 'codice_fiscale', 'regime', 'via', 'cap', 'comune', 'provincia', 'telefono', 'email', 'pec', 'codice_destinatario', 'iban', 'banca', 'colore', 'aliquota'];
// i campi fiscali che servono alla fattura elettronica: si aggiungono ai clienti dei modelli di settore che non li hanno
const CAMPI_FISCALI = [
  { id: 'piva', nome: 'Partita IVA', tipo: 'testo', valida: 'piva' }, { id: 'codice_fiscale', nome: 'Codice fiscale', tipo: 'testo', valida: 'codice_fiscale' },
  { id: 'codice_destinatario', nome: 'Codice destinatario (SDI)', tipo: 'testo' }, { id: 'pec', nome: 'PEC', tipo: 'email' },
  { id: 'via', nome: 'Indirizzo (via e civico)', tipo: 'testo' }, { id: 'cap', nome: 'CAP', tipo: 'testo' }, { id: 'comune', nome: 'Comune', tipo: 'testo' },
  { id: 'provincia', nome: 'Provincia (sigla)', tipo: 'testo' }, { id: 'nazione', nome: 'Nazione', tipo: 'testo', predefinito: 'IT' },
];
const LOGO_MAX = 300 * 1024;

// ---------- formati per la stampa ----------
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }), nf = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 4 });
const dataIt = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : String(v ?? ''));
export function formatta(c, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  const tipo = c.tipo === 'calcolato' ? c.formato || (typeof v === 'boolean' ? 'si_no' : typeof v === 'number' ? 'numero' : 'testo') : c.tipo;
  switch (tipo) {
    case 'valuta': return eur.format(v);
    case 'numero': case 'durata': return typeof v === 'number' ? nf.format(v) : String(v);
    case 'percentuale': return typeof v === 'number' ? nf.format(v) + '%' : String(v);
    case 'si_no': return v ? 'Sì' : '';   // vuoto se no: così {{#campo}}…{{/campo}} funziona
    case 'data': return dataIt(v);
    case 'data_ora': return new Date(v).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' });
    case 'scelta': case 'stato': return c.opzioni?.find(o => o.id === v)?.nome ?? String(v);
    case 'scelta_multipla': return v.map(x => c.opzioni?.find(o => o.id === x)?.nome ?? x).join(', ');
    case 'relazione': return Array.isArray(v) ? v.map(x => x.titolo).join(', ') : v.titolo ?? String(v);
    case 'immagine': case 'file': case 'righe': return '';
    default: return String(v);
  }
}

export default function registra({ r, db, S, D, P, meta, serve, ErroreHttp }) {
  attivaFatture(D);
  // i campi fiscali dei clienti cambiano lo schema: li aggiunge solo chi può personalizzare (POST /api/documenti/prepara,
  // che l'interfaccia chiama per lui), mai l'avvio del server né chi stampa o esporta una fattura
  const puoImpostare = ctx => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Solo chi può personalizzare il gestionale cambia questi dati'); };
  const errore = e => { throw new ErroreHttp(422, e.message, e.dettagli ? { dettagli: e.dettagli } : {}); };

  r('GET', '/api/documenti/azienda', ({ ctx }) => { serve(ctx); return { ...azienda(db, meta), logo: !!leggiLogo(db, meta), regimi: REGIMI }; });
  r('PUT', '/api/documenti/azienda', ({ ctx, corpo }) => { puoImpostare(ctx); try { return salvaAzienda(db, meta, corpo); } catch (e) { errore(e); } });
  r('GET', '/api/documenti/logo', ({ ctx }) => { serve(ctx); return { dati: leggiLogo(db, meta) }; });
  r('PUT', '/api/documenti/logo', ({ ctx, corpo }) => { puoImpostare(ctx); try { salvaLogo(db, meta, corpo.dati); return { ok: true }; } catch (e) { errore(e); } });
  r('DELETE', '/api/documenti/logo', ({ ctx }) => { puoImpostare(ctx); salvaLogo(db, meta, null); return { ok: true }; });

  // modelli di stampa
  r('GET', '/api/documenti/modelli', ({ ctx }) => { serve(ctx); return stampabili(S.elenco(db)).filter(e => P.puo(ctx, e.id, 'leggi')).map(e => ({ id: e.id, nome: e.nome, personalizzato: !!meta.leggi(db, `documenti.stampa.${e.id}`) })); });
  r('GET', '/api/documenti/modelli/:e', ({ ctx, p }) => { P.verifica(serve(ctx), p.e, 'leggi'); try { return modelloDi(db, meta, S, p.e); } catch (e) { throw new ErroreHttp(404, e.message); } });
  r('PUT', '/api/documenti/modelli/:e', ({ ctx, p, corpo }) => {
    puoImpostare(ctx); if (!stampabili(S.elenco(db)).some(e => e.id === p.e)) throw new ErroreHttp(404, 'Questa sezione non ha righe da stampare');
    let m; try { m = pulisciModello(corpo); } catch (e) { errore(e); }
    meta.scrivi(db, `documenti.stampa.${p.e}`, JSON.stringify(m)); return m;
  });
  r('DELETE', '/api/documenti/modelli/:e', ({ ctx, p }) => {
    puoImpostare(ctx); db.prepare('DELETE FROM _meta WHERE chiave = ?').run(`documenti.stampa.${p.e}`);
    try { return modelloDi(db, meta, S, p.e); } catch (e) { throw new ErroreHttp(404, e.message); }
  });

  // la stampa (HTML pronto per la finestra di stampa del browser); con un corpo è l'anteprima di un modello non salvato
  r('GET', '/api/documenti/stampa/:e/:id', ({ ctx, p }) => stampa(db, { S, D, meta }, p.e, p.id, serve(ctx)));
  r('POST', '/api/documenti/anteprima/:e/:id', ({ ctx, p, corpo }) => { serve(ctx); let m; try { m = pulisciModello(corpo); } catch (e) { errore(e); } return stampa(db, { S, D, meta }, p.e, p.id, ctx, m); });

  // fatture
  r('POST', '/api/documenti/prepara', ({ ctx }) => { puoImpostare(ctx); return { aggiunti: completaClienti(db, S, { utente: ctx.utente.id }) }; });
  r('POST', '/api/documenti/fattura-da/:e/:id', ({ ctx, p }) => fatturaDa(db, { S, D, P, meta, ErroreHttp }, p.e, p.id, serve(ctx)));
  r('POST', '/api/documenti/nota-di-credito/:id', ({ ctx, p }) => notaDiCredito(db, { S, D, P, ErroreHttp }, p.id, serve(ctx)));
  r('GET', '/api/documenti/fatturapa/:id', ({ ctx, p }) => { const { errori } = preparaXml(db, { S, D, meta }, p.id, serve(ctx)); return { errori }; });
  r('POST', '/api/documenti/fatturapa/:id', ({ ctx, p }) => {
    const { errori, az, f, cliente } = preparaXml(db, { S, D, meta }, p.id, serve(ctx));
    if (errori.length) throw new ErroreHttp(422, errori[0], { dettagli: errori });
    const n = Number(D.prossimoNumero(db, 'fatturapa', '{N}'));   // progressivo d'invio: mai ripetuto, anche se si riesporta
    return xml(az, f, cliente, { progressivo: progressivoDa(n) });
  });
}

// ---------- dati dell'azienda ----------
export function azienda(db, meta) {
  let a = {}; try { a = JSON.parse(meta.leggi(db, 'documenti.azienda') || '{}'); } catch { a = {}; }
  return { ragione_sociale: meta.leggi(db, 'azienda') || '', regime: 'RF01', aliquota: 22, colore: '', ...a };
}
export function salvaAzienda(db, meta, corpo = {}) {
  const a = azienda(db, meta), errori = [];
  for (const k of CAMPI_AZIENDA) if (k in corpo) a[k] = k === 'aliquota' ? Number(corpo[k] ?? 22) : String(corpo[k] ?? '').trim().slice(0, 200);
  for (const [k, v] of [['piva', 'piva'], ['codice_fiscale', 'codice_fiscale'], ['iban', 'iban']]) {
    if (!a[k]) continue; const x = VALIDATORI[v](a[k]); if (x.errore) errori.push(`${{ piva: 'Partita IVA', codice_fiscale: 'Codice fiscale', iban: 'IBAN' }[k]}: ${x.errore}`); else a[k] = x.valore;
  }
  if (a.regime && !REGIMI[a.regime]) errori.push('Regime fiscale sconosciuto');
  if (a.cap && !/^\d{5}$/.test(a.cap)) errori.push('Il CAP ha 5 cifre');
  a.provincia = String(a.provincia || '').toUpperCase(); if (a.provincia && !/^[A-Z]{2}$/.test(a.provincia)) errori.push('La provincia è la sigla di 2 lettere (es. MI)');
  if (a.colore && !/^#[0-9a-fA-F]{6}$/.test(a.colore)) errori.push('Colore non valido');
  if (!Number.isFinite(a.aliquota) || a.aliquota < 0 || a.aliquota > 100) errori.push('Aliquota IVA non valida');
  if (errori.length) { const e = new Error(errori[0]); e.dettagli = errori; throw e; }
  meta.scrivi(db, 'documenti.azienda', JSON.stringify(a));
  return a;
}

// il logo: solo PNG o JPEG (si riconoscono dai primi byte, non dal nome), al massimo 300 KB
const cartellaDati = db => { try { const l = db.location?.(); return l ? dirname(l) : null; } catch { return null; } };
export function salvaLogo(db, meta, datiUrl) {
  const cartella = cartellaDati(db), dir = cartella && join(cartella, 'documenti');
  const togli = () => { for (const ext of ['png', 'jpg']) if (dir && existsSync(join(dir, `logo.${ext}`))) rmSync(join(dir, `logo.${ext}`)); };
  if (!datiUrl) { togli(); db.prepare('DELETE FROM _meta WHERE chiave = ?').run('documenti.logo'); return; }
  // prima si controlla il nuovo, poi si toglie il vecchio: un file sbagliato non cancella il logo che c'era
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(datiUrl));
  if (!m) throw new Error('Il logo deve essere un\'immagine PNG o JPEG');
  const b = Buffer.from(m[2], 'base64');
  if (b.length > LOGO_MAX) throw new Error('Il logo è troppo grande: al massimo 300 KB');
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (!png && !jpg) throw new Error('Il file non è un PNG o un JPEG');
  const ext = png ? 'png' : 'jpg';
  togli();
  if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `logo.${ext}`), b); meta.scrivi(db, 'documenti.logo', `file:${ext}`); }
  else meta.scrivi(db, 'documenti.logo', `data:image/${png ? 'png' : 'jpeg'};base64,${b.toString('base64')}`);
}
export function leggiLogo(db, meta) {
  const v = meta.leggi(db, 'documenti.logo'); if (!v) return null;
  if (v.startsWith('data:')) return v;
  const ext = v === 'file:png' ? 'png' : 'jpg', dir = cartellaDati(db);
  try { return `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${readFileSync(join(dir, 'documenti', `logo.${ext}`)).toString('base64')}`; } catch { return null; }
}

// ---------- modelli di stampa ----------
export const stampabili = schema => schema.filter(e => !e.nascosta && e.campi.some(c => c.tipo === 'righe' && !c.archiviato));
export function modelloDi(db, meta, S, e) {
  const def = S.leggi(db, e); if (!def || def.archiviata) throw new Error(`Sezione sconosciuta «${e}»`);
  const salvato = meta.leggi(db, `documenti.stampa.${e}`);
  if (salvato) { try { return { ...JSON.parse(salvato), personalizzato: true }; } catch { /* rotto: si torna al predefinito */ } }
  return modelloPredefinito(def, S.elenco(db), meta.leggi(db, 'lingue.azienda') || 'it');
}

// i valori di una riga, formattati per la stampa; le relazioni diventano { _: titolo, …campi della riga collegata }
function valori(def, riga) { const o = { _titolo: '' }; for (const c of S_attivi(def)) if (c.id in riga) o[c.id] = formatta(c, riga[c.id]); return o; }
const S_attivi = def => def.campi.filter(c => !c.archiviato);

function aliquotaRiga(r, figlia, collegati, doc, az) {
  for (const k of ['aliquota', 'iva']) if (r[k] != null && r[k] !== '' && figlia.campi.some(c => c.id === k && ['percentuale', 'numero'].includes(c.tipo))) return Number(r[k]);
  for (const x of Object.values(collegati)) if (x && (x.iva != null || x.aliquota != null)) return Number(x.aliquota ?? x.iva);
  if (doc.iva != null && doc.iva !== '' && typeof doc.iva === 'number') return doc.iva;
  return Number(az.aliquota ?? 22);
}
// le righe di un documento qualsiasi, nella forma dei conti (descrizione, quantità, prezzo, sconto, aliquota, natura)
export function lineeDi(db, { S, D }, def, riga, ctx, az) {
  const cr = def.campi.find(c => c.tipo === 'righe' && !c.archiviato && c.id !== 'rate'); if (!cr) return [];
  const figlia = S.leggi(db, cr.entita), rel = S_attivi(figlia).filter(c => c.tipo === 'relazione' && !c.molti && c.id !== cr.campo);
  return (riga[cr.id] || []).map(r => {
    const collegati = {};
    for (const c of rel) if (r[c.id]?.id) { try { collegati[c.id] = D.leggi(db, c.entita, r[c.id].id, ctx, { conRighe: false }); } catch { collegati[c.id] = null; } }
    const desc = r.descrizione ?? (rel[0] && r[rel[0].id]?.titolo) ?? r.nome ?? '';
    const prezzo = r.prezzo ?? r.importo ?? r.costo ?? 0;
    return { descrizione: String(desc ?? ''), quantita: r.quantita ?? r.qta ?? 1, prezzo, sconto: r.sconto ?? 0, aliquota: aliquotaRiga(r, figlia, collegati, riga, az), natura: r.natura ?? null,
      riga: Object.fromEntries(S_attivi(figlia).filter(c => c.id in r).map(c => [c.id, formatta(c, r[c.id])])) };
  });
}

export function stampa(db, { S, D, meta }, e, id, ctx, modello = null) {
  const def = S.leggi(db, e); if (!def || def.archiviata) throw new D.ErroreDati(`Sezione sconosciuta «${e}»`);
  const riga = D.leggi(db, e, id, ctx);   // con i permessi di chi stampa: i campi nascosti non escono nemmeno su carta
  const m = modello || modelloDi(db, meta, S, e), az = azienda(db, meta);
  const fattura = e === FATTURE;
  const linee = fattura ? (riga.righe || []).map(r => ({ descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, sconto: r.sconto, aliquota: r.aliquota, natura: r.natura, riga: {} })) : lineeDi(db, { S, D }, def, riga, ctx, az);
  const conti = totali(linee, { prezziIvati: !fattura && m.prezziIvati, ritenuta: fattura ? riga.ritenuta : 0, bollo: fattura && riga.bollo });
  const dati = valori(def, riga);
  const t = S.campoTitolo(def); dati._titolo = t ? formatta(t, riga[t.id]) : '';
  for (const c of S_attivi(def).filter(c => c.tipo === 'relazione' && !c.molti && riga[c.id]?.id)) {
    const dc = S.leggi(db, c.entita); let coll = null;
    try { coll = D.leggi(db, c.entita, riga[c.id].id, ctx, { conRighe: false }); } catch { coll = null; }
    dati[c.id] = { _: riga[c.id].titolo, ...(coll ? valori(dc, coll) : {}) };
  }
  const pct = n => `${String(n).replace('.', ',')}%`;
  const lineeF = conti.linee.map(l => ({ descrizione: l.descrizione, quantita: nf.format(l.quantita), prezzo: eur.format(l.prezzo), sconto: l.sconto ? pct(l.sconto) : '',
    iva: l.aliquota ? pct(l.aliquota) : l.natura || '0%', aliquota: pct(l.aliquota), natura: l.natura || '', totale: eur.format(l.totale), riga: l.riga }));
  const riepilogo = conti.riepilogo.map(g => ({ etichetta: g.aliquota ? pct(g.aliquota) : `0% ${g.natura || ''}`.trim(), imponibile: eur.format(g.imponibile), imposta: eur.format(g.imposta) }));
  const T = { imponibile: eur.format(conti.imponibile), imposta: eur.format(conti.imposta), totale: eur.format(conti.totale), ritenuta: conti.ritenuta ? eur.format(conti.ritenuta) : '', netto: eur.format(conti.netto) };
  Object.assign(dati, { doc: { ...dati }, azienda: az, linee: lineeF, riepilogo, totali: T, oggi: dataIt(new Date().toISOString().slice(0, 10)),
    forfettario: fattura && az.regime === 'RF19' ? 'sì' : '' });
  const html = documentoHtml(m, { lingua: meta.leggi(db, 'lingue.azienda') || 'it', azienda: az, logo: leggiLogo(db, meta), dati, linee: lineeF, riepilogo, totali: T });
  return { titolo: rendi(m.titolo, [dati]).replace(/\s+/g, ' ').trim() || `${singolare(def.nome)} ${dati._titolo}`.trim(), html, totali: conti };
}

// ---------- fatture ----------
// i clienti dei modelli di settore prendono i campi fiscali che mancano (si aggiungono e basta: nessun dato si tocca)
// poi il vecchio campo libero «Indirizzo» si scompone in via, CAP, comune e provincia e si archivia (sicurezza-migrazioni.js)
export function completaClienti(db, S, { utente = null } = {}) {
  const f = S.leggi(db, FATTURE); if (!f || f.archiviata) return [];
  const rc = S.campo(f, 'cliente'); const cl = rc && S.leggi(db, rc.entita); if (!cl) return [];
  const mancanti = CAMPI_FISCALI.filter(x => !cl.campi.some(c => c.id === x.id));
  const { archiviata, ...def } = cl;
  if (mancanti.length) S.applica(db, { ...def, campi: [...def.campi, ...mancanti] }, { utente });
  unificaIndirizzo(db, S, cl.id, { utente });
  return mancanti.map(x => x.id);
}

// numero alla prima uscita dalla bozza: per serie e per anno della data della fattura (una fattura del 31/12 fatta il 2/1 resta nell'anno vecchio)
export function numeroFattura(D, db, serie, data) {
  const n = D.prossimoNumero(db, `fatture:${serie || ''}`, '{AAAA}/{N}', new Date(`${data}T12:00:00`)).split('/')[1];
  return serie ? `${n}/${serie}` : n;
}
const NOMI_TIPO = { TD04: 'Nota di credito', TD05: 'Nota di debito', TD06: 'Parcella' };
export const nomeDocumento = f => `${NOMI_TIPO[f.tipo] || 'Fattura'} ${f.numero ? f.numero : 'in bozza'}`;
let attivo = false;
export function attivaFatture(D) {
  if (attivo) return; attivo = true;
  D.ascolta((ev, db) => {
    if (ev.entita !== FATTURE || !['crea', 'modifica'].includes(ev.tipo) || !ev.dopo) return;
    const f = ev.dopo, cambi = {};
    const doppia = (numero, data) => !!db.prepare(`SELECT 1 FROM d_${FATTURE} WHERE archiviato = 0 AND id <> ? AND c_numero = ? AND IFNULL(c_serie, '') = ? AND substr(c_data, 1, 4) = ?`)
      .get(f.id, String(numero), f.serie || '', String(data || '').slice(0, 4));
    if (f.stato && f.stato !== 'bozza' && !f.numero) {
      // i numeri già scritti a mano (per esempio le fatture riportate da un altro programma) si saltano
      const data = f.data || new Date().toISOString().slice(0, 10);
      let n = numeroFattura(D, db, f.serie, data); for (let i = 0; i < 10000 && doppia(n, data); i++) n = numeroFattura(D, db, f.serie, data);
      cambi.numero = n; if (!f.data) cambi.data = data;
    } else if (f.numero && (ev.prima?.numero !== f.numero || (ev.prima?.serie ?? null) !== (f.serie ?? null) || String(ev.prima?.data || '').slice(0, 4) !== String(f.data || '').slice(0, 4))) {
      if (doppia(f.numero, f.data)) throw new D.ErroreDati(`C'è già una fattura numero ${f.numero} nel ${String(f.data).slice(0, 4)}`, { numero: 'Numero già usato quest\'anno' });
    }
    // il nome con cui la fattura compare nei titoli e nelle relazioni (un campo vero, così lo trova anche la ricerca)
    if ('nome_documento' in f) { const n = nomeDocumento({ ...f, ...cambi }); if (n !== f.nome_documento) cambi.nome_documento = n; }
    // l'IVA si calcola per aliquota sul totale delle righe, non riga per riga (come vuole la FatturaPA)
    if ('imposta' in f) { const imposta = contiFattura(f).imposta; if (cent(imposta) !== cent(f.imposta)) cambi.imposta = imposta; }
    if (Object.keys(cambi).length) D.modifica(db, FATTURE, f.id, cambi, null, { interno: true });
  });
}

export function fatturaDa(db, { S, D, P, meta, ErroreHttp }, e, id, ctx) {
  const fdef = S.leggi(db, FATTURE);
  if (!fdef || fdef.archiviata) throw new ErroreHttp(409, 'Aggiungi prima il modello «Fatture e fattura elettronica» (Personalizza → modelli).');
  if (e === FATTURE) throw new ErroreHttp(400, 'È già una fattura');
  P.verifica(ctx, FATTURE, 'crea');
  const def = S.leggi(db, e), src = D.leggi(db, e, id, ctx), az = azienda(db, meta);
  const entCliente = S.campo(fdef, 'cliente').entita;
  const rc = def.campi.find(c => c.tipo === 'relazione' && !c.molti && !c.archiviato && c.entita === entCliente);
  if (!rc) throw new ErroreHttp(400, `In «${def.nome}» non c'è un cliente a cui fare la fattura`);
  const cr = def.campi.find(c => c.tipo === 'righe' && !c.archiviato), figlia = cr && S.leggi(db, cr.entita);
  const m = modelloDi(db, meta, S, e);
  let righe;
  if (figlia && figlia.campi.some(c => ['prezzo', 'importo'].includes(c.id))) {   // righe di vendita: si copiano
    righe = lineeDi(db, { S, D }, def, src, ctx, az).map(l => {
      const prezzo = m.prezziIvati ? Math.round(Number(l.prezzo || 0) / (1 + l.aliquota / 100) * 100) / 100 : Number(l.prezzo || 0);
      return { descrizione: l.descrizione || '-', quantita: Number(l.quantita) || 1, prezzo, sconto: Number(l.sconto) || 0, aliquota: l.aliquota, ...(l.aliquota ? {} : { natura: az.regime === 'RF19' ? 'N2.2' : null }) };
    });
  } else {   // una commessa: una riga sola con il prezzo
    const prezzo = src.prezzo ?? src.imponibile ?? src.totale ?? 0, al = typeof src.iva === 'number' ? src.iva : az.regime === 'RF19' ? 0 : Number(az.aliquota ?? 22);
    righe = [{ descrizione: String(src.titolo ?? src.oggetto ?? src.nome ?? singolare(def.nome)), quantita: 1, prezzo: Number(prezzo) || 0, sconto: 0, aliquota: al, ...(al ? {} : { natura: 'N2.2' }) }];
  }
  if (az.regime === 'RF19') righe = righe.map(r => ({ ...r, aliquota: 0, natura: r.natura || 'N2.2' }));
  const t = S.campoTitolo(def), titolo = t ? (typeof src[t.id] === 'object' ? src[t.id]?.titolo : src[t.id]) : '';
  const valori = { cliente: src[rc.id]?.id ?? null, riferimento: `${singolare(def.nome)} ${titolo ?? ''}`.trim().slice(0, 200), righe };
  for (const k of Object.keys(valori)) if (!S.campo(fdef, k) || S.campo(fdef, k).archiviato) delete valori[k];
  return D.crea(db, FATTURE, valori, ctx);
}

// la nota di credito che storna una fattura emessa: stesse righe e stesso cliente, importi positivi, fattura collegata
export function notaDiCredito(db, { S, D, P, ErroreHttp }, id, ctx) {
  P.verifica(ctx, FATTURE, 'crea');
  const f = D.leggi(db, FATTURE, id, ctx), fdef = S.leggi(db, FATTURE);
  if (!f.numero || f.stato === 'bozza') throw new ErroreHttp(400, 'Si storna solo una fattura emessa: questa è ancora in bozza');
  if (f.tipo === 'TD04') throw new ErroreHttp(400, 'È già una nota di credito');
  const valori = { tipo: 'TD04', cliente: f.cliente?.id ?? null, collegata: f.id, riferimento: `Storno della fattura ${f.numero} del ${String(f.data).split('-').reverse().join('/')}`,
    ritenuta: f.ritenuta, ritenuta_tipo: f.ritenuta_tipo, ritenuta_causale: f.ritenuta_causale, bollo: f.bollo, modalita: f.modalita,
    righe: (f.righe || []).map(r => ({ descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, sconto: r.sconto, aliquota: r.aliquota, natura: r.natura })) };
  for (const k of Object.keys(valori)) if (!S.campo(fdef, k) || S.campo(fdef, k).archiviato) delete valori[k];
  return D.crea(db, FATTURE, valori, ctx);
}

function preparaXml(db, { S, D, meta }, id, ctx) {
  const f = D.leggi(db, FATTURE, id, ctx), az = azienda(db, meta);
  const fdef = S.leggi(db, FATTURE), entCliente = S.campo(fdef, 'cliente').entita;
  let cliente = {};
  if (f.cliente?.id) { try { cliente = D.leggi(db, entCliente, f.cliente.id, ctx, { conRighe: false }); } catch { cliente = {}; } }
  if (f.collegata?.id) { try { const c = D.leggi(db, FATTURE, f.collegata.id, ctx, { conRighe: false }); f.collegata_dati = { numero: c.numero, data: c.data }; } catch { /* non visibile: si esporta senza */ } }
  return { errori: controlla(az, f, cliente), az, f, cliente };
}
