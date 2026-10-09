// Il fisco: quanto pagare, quando e con che codice, e i file pronti da caricare da soli con SPID. Il modulo aggiunge:
//   GET/PUT /api/fisco/impostazioni   regime, periodicità IVA, ATECO e coefficiente, gestione INPS, riduzione 35%, 5% del forfettario…
//   POST /api/fisco/prepara           aggiunge «Fatture ricevute» (la sezione del modello fatture, una sola per tutto Lumi) e, se serve, «Corrispettivi»
//   GET  /api/fisco/registri?anno&da&a      registri IVA vendite e acquisti (dalle fatture emesse, ricevute e dai corrispettivi)
//   GET  /api/fisco/liquidazione?anno       liquidazioni periodiche, acconto di dicembre, credito riportato
//   GET  /api/fisco/lipe?anno&trimestre     il file XML della Comunicazione liquidazioni periodiche IVA
//   GET  /api/fisco/forfettario?anno&piu    cruscotto del forfettario e simulazione «se incasso ancora X»
//   GET  /api/fisco/versamenti?anno         ogni versamento con codice tributo, anno, rateazione, importo e scadenza (gli F24)
//   GET  /api/fisco/f24?data&anno           il modello F24 compilato di una scadenza, da stampare
//   GET  /api/fisco/ritenute?anno           registro delle ritenute come sostituto d'imposta, riepilogo per CU e 770
//   GET  /api/fisco/scadenze?anno · GET /api/fisco/promemoria   lo scadenzario del regime dell'azienda e le prossime scadenze
//   GET  /api/fisco/pacchetto?da&a          lo zip per il commercialista
// Le letture passano da dati.js con il ctx di chi chiede: chi non vede le fatture non vede nemmeno i conti che ne vengono.
// Lumi calcola e prepara; dichiarazioni, visto di conformità e consulenza restano del contribuente o di un professionista.
import * as R from './fisco-regole.js';
import { lipe, f24Html, pdfTesto } from './fisco-file.js';
import { cent, euro, intero } from './documenti-calcoli.js';
import { contiFattura, xml as fatturaXml, controlla, progressivoDa } from './documenti-xml.js';
import { scriviZip, scriviCsv, scriviXlsx } from './import-formati.js';
import { azienda } from './documenti.js';
import { AUTOFATTURE } from './fatture-codici.js';
import { bolloTrimestri } from './fatture-regole.js';
import { aggiornaModello } from './fatture.js';

const FATTURE = 'fatture', RICEVUTE = 'fatture_ricevute', CORRISPETTIVI = 'corrispettivi';
// «inviata» è lo stato delle fatture mandate allo SDI (modulo fatture): contano come le emesse
const STATI_VALIDI = ['emessa', 'inviata', 'pagata'];
export const REGIMI_FISCALI = ['forfettario', 'semplificato', 'ordinario'];
export const GESTIONI = ['artigiani', 'commercianti', 'separata', 'cassa', 'nessuna'];

// Le fatture ricevute sono UNA sezione sola, quella del modello fatture (modelli/fatture.json): fornitore collegato a «Fornitori»,
// import da XML/p7m, stato, scadenza, reverse charge e autofattura collegata, più i campi del fisco (aliquota, IVA detraibile,
// registrata il, percipiente e causale della ritenuta). Il fisco la legge per i registri IVA acquisti, la liquidazione, le
// ritenute e il pacchetto; «prepara» la aggiunge (con «Fornitori») portando il modello fatture alla versione di oggi.
// Qui si aggiunge solo «Corrispettivi», mai da sola all'avvio.
export const SEZIONE_CORRISPETTIVI = { id: CORRISPETTIVI, nome: 'Corrispettivi', icona: 'cassa', titolo: 'data', campi: [
  { id: 'data', nome: 'Giorno', tipo: 'data', obbligatorio: true }, { id: 'totale', nome: 'Incasso (IVA compresa)', tipo: 'valuta' },
  { id: 'aliquota', nome: 'IVA %', tipo: 'percentuale', predefinito: 22 }, { id: 'note', nome: 'Note', tipo: 'testo' }] };

// ---------- impostazioni ----------
const PREDEFINITE = { regime: null, periodicita: 'trimestrale', ateco: '', coefficiente: null, gestione: 'nessuna', riduzione35: false, ante1996: false, aliquotaRidotta: false,
  annoInizio: null, creditoAnnoPrecedente: 0, accontoIvaStorico: null, accontoIvaPrevisto: null, impostaAnnoPrecedente: null, accontiVersatiAnnoPrecedente: null,
  contributiVersati: null, sedeInps: '', matricolaInps: '', camerale: null, provinciaCciaa: '', sostituto: false, bollo: false, annoRiferimento: null };
// i valori «dell'anno scorso» (crediti, acconti, imposta, contributi versati) valgono solo per l'anno in cui sono stati inseriti:
// per gli altri anni Lumi li ricava dai dati, così un'impostazione del 2026 non finisce nei conti del 2027
const DELL_ANNO = ['creditoAnnoPrecedente', 'accontoIvaStorico', 'accontoIvaPrevisto', 'impostaAnnoPrecedente', 'accontiVersatiAnnoPrecedente', 'contributiVersati'];
export function perAnno(imp, anno) {
  if (!imp.annoRiferimento || Number(imp.annoRiferimento) === Number(anno)) return imp;
  return { ...imp, ...Object.fromEntries(DELL_ANNO.map(c => [c, c === 'creditoAnnoPrecedente' ? 0 : null])) };
}
export function impostazioni(db, meta) {
  let s = {}; try { s = JSON.parse(meta.leggi(db, 'fisco.impostazioni') || '{}'); } catch { s = {}; }
  const out = { ...PREDEFINITE, ...s };
  if (!out.regime) out.regime = azienda(db, meta).regime === 'RF19' ? 'forfettario' : 'ordinario';
  const c = R.coefficienteAteco(out.ateco);
  out.coefficienteAteco = c?.coeff ?? null; out.gruppoAteco = c?.gruppo ?? null;
  out.coefficienteUsato = Number(out.coefficiente) || c?.coeff || R.COEFF_ALTRE;
  return out;
}
const numOpz = v => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
export function salvaImpostazioni(db, meta, corpo = {}) {
  const s = { ...PREDEFINITE, ...JSON.parse(meta.leggi(db, 'fisco.impostazioni') || '{}') }, sbagliato = campo => { throw new Error(`Impostazione fiscale non valida: ${campo}`); };
  for (const k of Object.keys(PREDEFINITE)) if (k in corpo) s[k] = corpo[k];
  if (s.regime != null && !REGIMI_FISCALI.includes(s.regime)) sbagliato('regime');
  if (!['mensile', 'trimestrale'].includes(s.periodicita)) sbagliato('periodicita');
  if (!GESTIONI.includes(s.gestione)) sbagliato('gestione');
  s.ateco = String(s.ateco || '').trim().slice(0, 12); if (s.ateco && !/^\d{2}(\.?\d{1,2}){0,2}$/.test(s.ateco)) sbagliato('ateco');
  for (const k of ['coefficiente', 'creditoAnnoPrecedente', 'accontoIvaStorico', 'accontoIvaPrevisto', 'impostaAnnoPrecedente', 'accontiVersatiAnnoPrecedente', 'contributiVersati', 'camerale', 'annoInizio', 'annoRiferimento']) {
    s[k] = numOpz(s[k]); if (s[k] != null && (!Number.isFinite(s[k]) || s[k] < 0 || s[k] > 1e9)) sbagliato(k);
  }
  if (s.coefficiente != null && (s.coefficiente <= 0 || s.coefficiente > 100)) sbagliato('coefficiente');
  if (!('annoRiferimento' in corpo) || s.annoRiferimento == null) s.annoRiferimento = new Date().getFullYear();
  if (!Number.isInteger(s.annoRiferimento) || s.annoRiferimento < 2000 || s.annoRiferimento > 2100) sbagliato('annoRiferimento');
  for (const k of ['riduzione35', 'ante1996', 'aliquotaRidotta', 'sostituto', 'bollo']) s[k] = !!s[k];
  for (const k of ['sedeInps', 'matricolaInps', 'provinciaCciaa']) s[k] = String(s[k] || '').trim().toUpperCase().slice(0, 20);
  meta.scrivi(db, 'fisco.impostazioni', JSON.stringify(s));
  return impostazioni(db, meta);
}

// ---------- i dati, con i permessi di chi chiede ----------
const esiste = (S, db, e) => { const d = S.leggi(db, e); return !!d && !d.archiviata; };
function tutte(D, db, e, filtri, ctx) {
  const out = [];
  for (let pagina = 1; pagina < 200; pagina++) { const r = D.elenca(db, e, { filtri, perPagina: 500, pagina, ordina: [{ campo: 'data', dir: 'asc' }] }, ctx); out.push(...r.righe); if (r.righe.length < 500) break; }
  return out;
}
const puoLeggere = (P, ctx, e) => P.puo(ctx, e, 'leggi');
// le fatture emesse fra due date, con il riepilogo IVA (le note di credito in negativo)
export function vendite(k, ctx, da, a) {
  const { db, S, D, P } = k; if (!esiste(S, db, FATTURE) || !puoLeggere(P, ctx, FATTURE)) return [];
  return tutte(D, db, FATTURE, [{ campo: 'data', op: 'tra', valore: [da, a] }], ctx).filter(f => STATI_VALIDI.includes(f.stato)).map(r => {
    const f = D.leggi(db, FATTURE, r.id, ctx), segno = f.tipo === 'TD04' ? -1 : 1, c = contiFattura(f);
    const g = c.riepilogo.map(x => ({ aliquota: x.aliquota, natura: x.natura, imponibile: euro(segno * cent(x.imponibile)), imposta: euro(segno * cent(x.imposta)) }));
    return { id: f.id, tipo: f.tipo || 'TD01', numero: f.numero, data: f.data, cliente: f.cliente?.titolo ?? '', riepilogo: g, imponibile: euro(segno * cent(c.imponibile)),
      imposta: euro(segno * cent(c.imposta)), totale: euro(segno * cent(c.totale)), ritenuta: euro(segno * cent(c.ritenuta)), bollo: !!f.bollo, pagata_il: f.pagata_il || null, stato: f.stato, _f: f };
  });
}
// Le fatture ricevute nel registro acquisti, dalla sezione unica del modello fatture. Il fornitore è una relazione verso
// «Fornitori» (la partita IVA viene da lì); nelle sezioni vecchie create dal fisco era un testo con «piva_fornitore» a fianco.
// Reverse charge ed estero (campo «inversione»): la fattura del fornitore non ha IVA e va integrata con un documento TD16-TD19
// (art. 17 DPR 633/72, artt. 46-47 DL 331/93). Entra nel registro acquisti quando l'integrazione è emessa, alla data
// dell'integrazione e con la sua IVA (che la stessa integrazione porta nel registro vendite: debito e detrazione nello stesso
// periodo); finché non è integrata resta fra le «da integrare» e non entra nei conti.
export function acquisti(k, ctx, da, a, { conDaIntegrare = false } = {}) {
  const { db, S, D, P } = k; if (!esiste(S, db, RICEVUTE) || !puoLeggere(P, ctx, RICEVUTE)) return conDaIntegrare ? { righe: [], daIntegrare: [] } : [];
  const fornitori = new Map(), integrazioni = new Map();
  const fornitore = f => {
    if (!f.fornitore || typeof f.fornitore !== 'object') return { nome: f.fornitore ?? '', piva: f.piva_fornitore ?? '' };
    if (!fornitori.has(f.fornitore.id)) { let piva = ''; try { piva = D.leggi(db, 'fornitori', f.fornitore.id, ctx, { conRighe: false }).piva || ''; } catch { piva = ''; } fornitori.set(f.fornitore.id, piva); }
    return { nome: f.fornitore.titolo ?? '', piva: f.piva_fornitore || fornitori.get(f.fornitore.id) };
  };
  const integrazione = id => {
    if (!integrazioni.has(id)) {
      let x = null;
      try { const v = D.leggi(db, FATTURE, id, ctx); if (STATI_VALIDI.includes(v.stato) && AUTOFATTURE.includes(v.tipo)) x = v; } catch { x = null; }
      integrazioni.set(id, x);
    }
    return integrazioni.get(id);
  };
  const righe = [], daIntegrare = [];
  for (const f of tutte(D, db, RICEVUTE, [], ctx)) {
    const forn = fornitore(f), segno = f.tipo === 'TD04' ? -1 : 1;
    const base = { id: f.id, tipo: f.tipo || 'TD01', fornitore: forn.nome, piva: forn.piva, numero: f.numero ?? '', data: f.data, pagata_il: f.pagata_il || null,
      ritenuta: euro(cent(f.ritenuta)), cf_percipiente: f.cf_percipiente ?? '', causale: f.causale_ritenuta ?? '' };
    const imponibile = segno * cent(f.imponibile), perc = Number(f.detraibile ?? 100);
    if (f.inversione) {
      const g = f.integrata?.id ? integrazione(f.integrata.id) : null;
      if (!g) { daIntegrare.push({ ...base, imponibile: euro(imponibile), totale: euro(cent(f.totale) || imponibile) }); continue; }
      const c = contiFattura(g), imposta = segno * cent(c.imposta);
      righe.push({ ...base, registrazione: g.data, aliquota: c.riepilogo.find(x => x.aliquota)?.aliquota ?? 0, imponibile: euro(imponibile), imposta: euro(imposta),
        detraibile: euro(intero(imposta * perc / 100)), totale: euro(imponibile + imposta), integrazione: { id: g.id, tipo: g.tipo, numero: g.numero ?? '' } });
      continue;
    }
    // l'IVA: quella della fattura (import XML o scritta a mano); vuota, dall'aliquota
    const aliquota = f.aliquota != null && f.aliquota !== '' ? Number(f.aliquota) : imponibile && f.imposta != null && f.imposta !== '' ? Math.round(cent(f.imposta) * 100 / Math.abs(imponibile)) : 22;
    const imposta = f.imposta != null && f.imposta !== '' ? segno * cent(f.imposta) : intero(imponibile * aliquota / 100);
    righe.push({ ...base, registrazione: f.data_ricezione || f.data, aliquota, imponibile: euro(imponibile), imposta: euro(imposta),
      detraibile: euro(intero(imposta * perc / 100)), totale: euro(imponibile + imposta) });
  }
  const nel = x => x.registrazione >= da && x.registrazione <= a, ordina = (x, y) => x.registrazione.localeCompare(y.registrazione);
  const out = righe.filter(nel).sort(ordina);
  return conDaIntegrare ? { righe: out, daIntegrare: daIntegrare.filter(x => x.data <= a) } : out;
}
export function corrispettivi(k, ctx, da, a) {
  const { db, S, D, P } = k; if (!esiste(S, db, CORRISPETTIVI) || !puoLeggere(P, ctx, CORRISPETTIVI)) return [];
  return tutte(D, db, CORRISPETTIVI, [{ campo: 'data', op: 'tra', valore: [da, a] }], ctx).map(c => {
    const lordo = cent(c.totale), al = Number(c.aliquota ?? 22), imponibile = intero(lordo / (1 + al / 100));   // scorporo
    return { id: c.id, data: c.data, aliquota: al, totale: euro(lordo), imponibile: euro(imponibile), imposta: euro(lordo - imponibile) };
  });
}

// ---------- IVA ----------
export function registri(k, ctx, da, a) {
  const v = vendite(k, ctx, da, a), { righe: ac, daIntegrare } = acquisti(k, ctx, da, a, { conDaIntegrare: true }), co = corrispettivi(k, ctx, da, a);
  const somma = (l, c) => euro(l.reduce((s, x) => s + cent(x[c]), 0));
  return { da, a, vendite: v.map(({ _f, ...x }) => x), acquisti: ac, daIntegrare, corrispettivi: co,
    totali: { vendite: { imponibile: somma(v, 'imponibile'), imposta: somma(v, 'imposta') }, corrispettivi: { imponibile: somma(co, 'imponibile'), imposta: somma(co, 'imposta') },
      acquisti: { imponibile: somma(ac, 'imponibile'), imposta: somma(ac, 'imposta'), detraibile: somma(ac, 'detraibile') } } };
}
export function liquidazione(k, ctx, anno, imp0 = impostazioni(k.db, k.meta)) {
  const imp = perAnno(imp0, anno), n = R.periodiDi(imp.periodicita), periodi = [];
  for (let p = 1; p <= n; p++) {
    const { da, a } = R.limitiPeriodo(imp.periodicita, anno, p), g = registri(k, ctx, da, a), t = g.totali;
    periodi.push({ ivaVendite: euro(cent(t.vendite.imposta) + cent(t.corrispettivi.imposta)), ivaAcquisti: t.acquisti.detraibile,
      attive: euro(cent(t.vendite.imponibile) + cent(t.corrispettivi.imponibile)), passive: t.acquisti.imponibile });
  }
  // l'acconto di dicembre: storico (dalle impostazioni) o previsionale. Il previsionale lo dà chi lo prevede; Lumi usa il
  // calcolo dell'ultimo periodo solo a periodo chiuso, perché con il periodo in corso i dati sono parziali e l'acconto verrebbe basso
  const prova = R.liquida({ periodicita: imp.periodicita, anno, periodi, creditoAnnoPrecedente: imp.creditoAnnoPrecedente });
  const ultimo = prova.periodi.at(-1), chiuso = new Date().toISOString().slice(0, 10) > ultimo.a;
  const previsto = imp.accontoIvaPrevisto ?? (chiuso ? ultimo.importoDaVersare || null : null);
  const acconto = R.accontoIva({ periodicita: imp.periodicita, anno, storico: imp.accontoIvaStorico, previsto });
  const l = R.liquida({ periodicita: imp.periodicita, anno, periodi, creditoAnnoPrecedente: imp.creditoAnnoPrecedente, acconto: acconto.importo });
  const avvisi = [];
  if (l.periodi.at(-1).importoACredito > 5000) avvisi.push('visto-conformita');
  if (imp.regime === 'forfettario') avvisi.push('forfettario-niente-iva');
  if (acquisti(k, ctx, `${anno}-01-01`, `${anno}-12-31`, { conDaIntegrare: true }).daIntegrare.length) avvisi.push('da-integrare');
  return { ...l, acconto, avvisi };
}
export function fileLipe(k, ctx, anno, trimestre) {
  const imp = impostazioni(k.db, k.meta), az = azienda(k.db, k.meta);
  if (imp.regime === 'forfettario') throw new k.ErroreHttp(400, 'Nel regime forfettario non si fanno liquidazioni IVA né comunicazioni LIPE');
  if (!az.piva || !(az.codice_fiscale || az.piva)) throw new k.ErroreHttp(400, 'Per la comunicazione servono partita IVA e codice fiscale dell\'azienda (Documenti → dati dell\'azienda)');
  const l = liquidazione(k, ctx, anno, imp);
  const periodi = imp.periodicita === 'mensile' ? l.periodi.slice((trimestre - 1) * 3, trimestre * 3) : [l.periodi[trimestre - 1]];
  const f = lipe({ cf: az.codice_fiscale || az.piva, piva: az.piva, anno, periodicita: imp.periodicita, trimestre, periodi, metodoAcconto: l.acconto.scelto?.codiceMetodo });
  // nome del file come vuole il caricamento: IT + codice fiscale di chi trasmette + _LI_ + progressivo di 5 caratteri (anno, T, trimestre)
  return { ...f, nome: `IT${String(az.codice_fiscale || az.piva).toUpperCase()}_LI_${String(anno).slice(2)}T${trimestre}0.xml` };
}

// ---------- forfettario ----------
// l'incassato dell'anno (principio di cassa, art. 1 c. 64 L. 190/2014), dai pagamenti registrati nelle fatture:
//   - «Pagata il» nell'anno: tutta la fattura; una fattura pagata senza data conta alla sua data (e si avvisa);
//   - senza «Pagata il», le rate segnate «pagata» con la data nell'anno: la parte di compenso che corrisponde alla rata;
//   - le integrazioni e autofatture TD16-TD19 non sono ricavi (sono acquisti): non contano.
// Il compenso è l'imponibile della fattura, che comprende la rivalsa INPS e il bollo da 2 € quando è addebitato al cliente
// (campo «bollo» senza «il bollo lo paghi tu»): il bollo riaddebitato è parte del compenso e concorre al reddito forfettario
// e alle soglie. Fonte: Agenzia delle Entrate, risposta all'interpello n. 428 del 12 agosto 2022 («L'importo dell'imposta
// di bollo addebitato in fattura al cliente assume natura di ricavo/compenso» e concorre alla determinazione del reddito
// forfetario ex art. 1 c. 64 L. 190/2014). Se il bollo lo paghi tu non è in fattura e non conta.
export function incassato(k, ctx, anno) {
  const da = `${anno - 1}-01-01`, a = `${anno}-12-31`, y = String(anno);   // una fattura di dicembre si può incassare a gennaio
  let tot = 0, senzaData = 0;
  for (const f of vendite(k, ctx, da, a)) {
    if (AUTOFATTURE.includes(f.tipo)) continue;
    const quando = f.pagata_il || (f.stato === 'pagata' ? f.data : null);
    if (quando) { if (!quando.startsWith(y)) continue; if (!f.pagata_il) senzaData++; tot += cent(f.imponibile); continue; }
    const rate = (f._f.rate || []).filter(r => r.pagata && String(r.data || '').startsWith(y)), netto = cent(f._f.netto ?? f.totale);
    for (const r of rate) tot += netto ? intero(cent(f.imponibile) * cent(r.importo) / netto) : 0;
  }
  return { incassato: euro(tot), senzaData };
}
export function cruscottoForfettario(k, ctx, anno, { piu = 0 } = {}) {
  const imp = perAnno(impostazioni(k.db, k.meta), anno), { incassato: inc, senzaData } = incassato(k, ctx, anno), prima = incassato(k, ctx, anno - 1);
  const base = { coefficiente: imp.coefficienteUsato, gestione: imp.gestione, riduzione35: imp.riduzione35, ante1996: imp.ante1996, aliquotaRidotta: imp.aliquotaRidotta, anno };
  const precedente = R.forfettario({ ...base, anno: anno - 1, incassato: prima.incassato });
  const impostaPrec = imp.impostaAnnoPrecedente ?? precedente.imposta;
  const acconti = R.accontiForfettario(impostaPrec, anno), versati = acconti.reduce((s, x) => s + cent(x.importo), 0);
  const ora = R.forfettario({ ...base, incassato: inc, contributiVersati: imp.contributiVersati, impostaAnnoPrecedente: impostaPrec, accontiVersati: euro(versati), ricaviAnnoPrecedente: prima.incassato });
  if (senzaData) ora.avvisi.push('incassi-senza-data');
  const out = { ...ora, incassatoAnnoPrecedente: prima.incassato, impostaAnnoPrecedente: impostaPrec, fonteImpostaPrecedente: imp.impostaAnnoPrecedente != null ? 'impostazioni' : 'calcolo' };
  if (Number(piu) > 0) {
    const sim = R.forfettario({ ...base, incassato: euro(cent(inc) + cent(piu)), contributiVersati: imp.contributiVersati, impostaAnnoPrecedente: impostaPrec, accontiVersati: euro(versati) });
    out.simulazione = { piu: Number(piu), incassato: sim.incassato, imposta: sim.imposta, inps: sim.inps.totale, diPiu: euro(cent(sim.imposta) + cent(sim.inps.totale) - cent(ora.imposta) - cent(ora.inps.totale)), avvisi: sim.avvisi.filter(x => x.startsWith('oltre') || x.startsWith('vicino')) };
    out.simulazione.restaInTasca = euro(cent(piu) - cent(out.simulazione.diPiu));
  }
  return out;
}

// ---------- i versamenti dell'anno (gli F24) ----------
// ogni voce: { data, sezione: erario|inps|locali, codice | causale, anno, rateazione, importo, chiave, periodo }
export function versamenti(k, ctx, anno) {
  const imp = impostazioni(k.db, k.meta), out = [], avvisi = [];
  const add = v => { if (cent(v.importo) > 0) out.push({ sezione: 'erario', rateazione: '', ...v, importo: euro(cent(v.importo)) }); };
  if (imp.regime !== 'forfettario') {
    const l = liquidazione(k, ctx, anno, imp);
    for (const p of l.periodi) add({ data: p.scadenza, codice: p.codice, anno, importo: p.daVersare, chiave: p.codice === '6099' ? 'iva-saldo' : 'iva', periodo: p.periodo });
    if (l.acconto.dovuto) add({ data: l.acconto.scadenza, codice: l.acconto.codice, anno, importo: l.acconto.importo, chiave: 'iva-acconto' });
    avvisi.push('redditi-professionista');
  } else {
    // giugno: saldo dell'anno prima + primo acconto; novembre: secondo acconto (o unico)
    const prec = cruscottoForfettario(k, ctx, anno - 1), c = cruscottoForfettario(k, ctx, anno);
    const accPrec = perAnno(imp, anno).accontiVersatiAnnoPrecedente ?? (prec.accontiQuestAnno || []).reduce((s, x) => s + x.importo, 0);
    const saldo = euro(cent(c.impostaAnnoPrecedente) - cent(accPrec));
    add({ data: R.scadenzaGiugno(anno), codice: R.COD_FORF.saldo, anno: anno - 1, rateazione: '0101', importo: Math.max(0, saldo), chiave: 'forf-saldo' });
    for (const x of c.accontiQuestAnno || []) add({ data: x.scadenza, codice: x.codice, anno, rateazione: x.codice === R.COD_FORF.acconto1 ? '0101' : '', importo: x.importo, chiave: 'forf-acconto' });
    // contributi INPS sul reddito: saldo dell'anno prima e acconti (artigiani/commercianti 50%+50% dell'eccedenza; separata 40%+40%)
    if (['artigiani', 'commercianti', 'separata'].includes(imp.gestione)) {
      const ecc = prec.inps.eccedenza, perc = imp.gestione === 'separata' ? 40 : 50, causale = prec.inps.causale, matricola = imp.matricolaInps, sede = imp.sedeInps;
      const inps = (data, importo, a, chiave) => { if (cent(importo) > 0) out.push({ sezione: 'inps', data, causale, sede, matricola, da: `01/${a}`, a: `12/${a}`, anno: a, importo: euro(cent(importo)), chiave }); };
      inps(R.scadenzaGiugno(anno), euro(intero(cent(ecc) * perc / 100)), anno, 'inps-acconto');
      inps(R.scadenzaNovembre(anno), euro(intero(cent(ecc) * perc / 100)), anno, 'inps-acconto');
      if (['artigiani', 'commercianti'].includes(imp.gestione)) R.rateFisseInps(anno).forEach(d => out.push({ sezione: 'inps', data: d, causale: R.INPS[imp.gestione].causaleFissi, sede, matricola, da: '', a: '', anno, importo: euro(intero(c.inps.fissi * 100 / 4)), chiave: 'inps-fissi' }));
      if (imp.gestione !== 'separata') avvisi.push('inps-cassetto');
    }
    if (imp.gestione === 'cassa') avvisi.push('cassa-professionale');
  }
  // bollo virtuale: lo stesso conto della pagina Fatture (fatture-regole.js bolloTrimestri: fatture emesse col bollo, per trimestre
  // della data, rinvii sotto 5.000 €, codici 2521-2524), così F24 e pagina Fatture dicono la stessa cifra con la stessa scadenza.
  // Vale per ogni regime: il bollo è dovuto su ogni fattura che lo dichiara (forfettario, esenti, non imponibili)
  if (esiste(k.S, k.db, FATTURE) && puoLeggere(k.P, ctx, FATTURE)) {
    const emesse = tutte(k.D, k.db, FATTURE, [{ campo: 'data', op: 'tra', valore: [`${anno}-01-01`, `${anno}-12-31`] }], ctx);
    for (const b of bolloTrimestri(emesse, anno)) add({ data: b.scadenza, codice: b.tributo, anno, importo: b.importo, chiave: 'bollo', periodo: b.trimestre });
  }
  // forfettario con acquisti in reverse charge o dall'estero: l'IVA delle integrazioni TD16-TD19 non si detrae e si versa
  // entro il 16 del mese dopo l'operazione, con il codice del mese (art. 1 c. 58 lett. e) L. 190/2014)
  if (imp.regime === 'forfettario') {
    const perMese = {};
    for (const f of vendite(k, ctx, `${anno}-01-01`, `${anno}-12-31`)) if (AUTOFATTURE.includes(f.tipo)) { const m = Number(f.data.slice(5, 7)); perMese[m] = (perMese[m] || 0) + cent(f.imposta); }
    for (const [m, c] of Object.entries(perMese)) add({ data: R.scadenzaRitenuta(`${anno}-${String(m).padStart(2, '0')}-01`), codice: R.COD_IVA.mese(Number(m)), anno, importo: euro(c), chiave: 'iva-integrazioni', periodo: Number(m) });
  }
  // ritenute operate come sostituto d'imposta: il 16 del mese dopo il pagamento
  for (const [mese, v] of Object.entries(ritenute(k, ctx, anno).perMese)) add({ data: v.scadenza, codice: R.COD_RITENUTE, anno, rateazione: '', importo: v.ritenute, chiave: 'ritenute', periodo: Number(mese) });
  if (imp.camerale) out.push({ sezione: 'locali', data: R.scadenzaGiugno(anno), ente: imp.provinciaCciaa, codice: R.COD_CAMERALE, anno, rateazione: '', importo: euro(cent(imp.camerale)), chiave: 'camerale' });
  if (acquisti(k, ctx, `${anno}-01-01`, `${anno}-12-31`, { conDaIntegrare: true }).daIntegrare.length) avvisi.push('da-integrare');
  out.sort((a, b) => a.data.localeCompare(b.data));
  // un F24 per ogni scadenza
  const f24 = []; for (const v of out) { let g = f24.find(x => x.data === v.data); if (!g) f24.push(g = { data: v.data, voci: [], totale: 0 }); g.voci.push(v); g.totale = euro(cent(g.totale) + cent(v.importo)); }
  return { anno, regime: imp.regime, voci: out, f24, avvisi };
}

// ---------- ritenute come sostituto d'imposta ----------
export function ritenute(k, ctx, anno) {
  const righe = acquisti(k, ctx, '0000-01-01', '9999-12-31').filter(x => cent(x.ritenuta) > 0 && x.pagata_il && x.pagata_il.startsWith(String(anno)));
  const perMese = {}, perPercipiente = {};
  for (const r of righe) {
    const m = Number(r.pagata_il.slice(5, 7)), pm = perMese[m] ||= { ritenute: 0, scadenza: R.scadenzaRitenuta(r.pagata_il), righe: 0 };
    pm.ritenute = euro(cent(pm.ritenute) + cent(r.ritenuta)); pm.righe++;
    const chiave = r.cf_percipiente || r.fornitore, p = perPercipiente[chiave] ||= { percipiente: r.fornitore, cf: r.cf_percipiente, causale: r.causale, compensi: 0, ritenute: 0 };
    p.compensi = euro(cent(p.compensi) + cent(r.imponibile)); p.ritenute = euro(cent(p.ritenute) + cent(r.ritenuta));
  }
  const cu = Object.values(perPercipiente);
  return { anno, righe: righe.map(r => ({ ...r, versamento: R.scadenzaRitenuta(r.pagata_il), codice: R.COD_RITENUTE })), perMese, cu,
    avvisi: cu.length >= 20 ? ['cu-intermediario'] : cu.length ? ['cu-fisconline'] : [] };
}

// ---------- scadenze ----------
export function scadenze(k, ctx, anno) {
  const imp = impostazioni(k.db, k.meta), v = versamenti(k, ctx, anno);
  return R.scadenzario(anno, { ...imp, camerale: imp.camerale != null }).map(s => {
    const importo = v.voci.filter(x => x.data === s.data && gruppoDi(x.chiave) === s.tipo).reduce((t, x) => t + cent(x.importo), 0);
    return { ...s, importo: importo ? euro(importo) : null };
  });
}
const gruppoDi = ch => (ch.startsWith('iva') ? 'iva' : ch.startsWith('forf') ? 'imposte' : ch.startsWith('inps') ? 'inps' : ch);
export function promemoria(k, ctx, oggi = new Date().toISOString().slice(0, 10), giorni = 30) {
  const fine = new Date(Date.parse(oggi) + giorni * 864e5).toISOString().slice(0, 10), a = Number(oggi.slice(0, 4));
  return [...scadenze(k, ctx, a), ...(fine.slice(0, 4) !== oggi.slice(0, 4) ? scadenze(k, ctx, a + 1) : [])].filter(s => s.data >= oggi && s.data <= fine);
}

// ---------- F24 da stampare ----------
const TESTI_F24 = { 'f24-titolo': 'Modello F24 — da ricopiare in F24 web o nell\'home banking', 'f24-contribuente': 'Contribuente', 'f24-cf': 'Codice fiscale', 'f24-scadenza': 'Scadenza',
  'f24-erario': 'Sezione Erario', 'f24-inps': 'Sezione INPS', 'f24-locali': 'Sezione IMU e altri tributi locali', 'f24-codice': 'Codice tributo', 'f24-rateazione': 'Rateazione / mese rif.',
  'f24-anno': 'Anno di riferimento', 'f24-debito': 'Importi a debito', 'f24-credito': 'Importi a credito', 'f24-sede': 'Codice sede', 'f24-causale': 'Causale contributo',
  'f24-matricola': 'Matricola / codice INPS', 'f24-da': 'Periodo da (mm/aaaa)', 'f24-a': 'Periodo a (mm/aaaa)', 'f24-ente': 'Codice ente', 'f24-totale': 'Totale', 'f24-saldo': 'Saldo finale',
  'f24-nota': 'Preparato da Lumi: controlla gli importi prima di pagare, la responsabilità del versamento è del contribuente. Con un saldo a debito senza compensazioni puoi pagare dall\'home banking; se compensi un credito (o il saldo è zero) devi usare i servizi dell\'Agenzia delle Entrate (F24 web, F24 online). Per compensare crediti IVA oltre 5.000 € serve il visto di conformità di un professionista.' };
export function f24(k, ctx, anno, data) {
  const v = versamenti(k, ctx, anno), g = v.f24.find(x => x.data === data); if (!g) throw new k.ErroreHttp(404, 'Nessun versamento in questa data');
  const az = azienda(k.db, k.meta), dataIt = data.split('-').reverse().join('/');
  const html = f24Html({ contribuente: { nome: az.ragione_sociale, cf: az.codice_fiscale || az.piva }, scadenza: dataIt, testi: TESTI_F24,
    erario: g.voci.filter(x => x.sezione === 'erario').map(x => ({ codice: x.codice, rateazione: x.rateazione, anno: x.anno, debito: x.importo })),
    inps: g.voci.filter(x => x.sezione === 'inps').map(x => ({ sede: x.sede, causale: x.causale, matricola: x.matricola, da: x.da, a: x.a, debito: x.importo })),
    locali: g.voci.filter(x => x.sezione === 'locali').map(x => ({ ente: x.ente, codice: x.codice, rateazione: x.rateazione, anno: x.anno, debito: x.importo })) });
  return { data, totale: g.totale, voci: g.voci, html };
}

// ---------- il pacchetto per il commercialista ----------
const d = s => (s ? { data: s } : null), e = n => ({ euro: Number(n) || 0 });
export function pacchetto(k, ctx, da, a) {
  const imp = impostazioni(k.db, k.meta), az = azienda(k.db, k.meta), reg = registri(k, ctx, da, a), file = [];
  const tabella = (nome, intest, righe) => { file.push({ nome: `${nome}.csv`, dati: scriviCsv(intest, righe) }, { nome: `${nome}.xlsx`, dati: scriviXlsx(intest, righe, { foglio: nome.split('/').pop() }), comprimi: false }); };
  // fatture emesse: una copia dell'XML FatturaPA di ciascuna (il progressivo è quello della copia, non quello inviato allo SDI)
  for (const f of vendite(k, ctx, da, a)) {
    const fd = S_cliente(k, ctx, f._f), err = controlla(az, f._f, fd);
    if (err.length) { file.push({ nome: `fatture-emesse/DA-SISTEMARE_${String(f.numero).replace(/[^\w-]/g, '_')}.txt`, dati: err.join('\n') }); continue; }
    const x = fatturaXml(az, f._f, fd, { progressivo: progressivoDa(parseInt(f.id.replace(/[^0-9a-f]/gi, '').slice(-8) || '1', 16)) });
    file.push({ nome: `fatture-emesse/${x.nome}`, dati: x.xml });
  }
  tabella('registro-iva-vendite', ['Data', 'Numero', 'Tipo', 'Cliente', 'Aliquota', 'Natura', 'Imponibile', 'IVA'], reg.vendite.flatMap(v => v.riepilogo.map(g => [d(v.data), v.numero, v.tipo, v.cliente, g.aliquota, g.natura || '', e(g.imponibile), e(g.imposta)])));
  tabella('registro-iva-acquisti', ['Registrata il', 'Data', 'Numero', 'Fornitore', 'P.IVA', 'Aliquota', 'Imponibile', 'IVA', 'IVA detraibile'], reg.acquisti.map(x => [d(x.registrazione), d(x.data), x.numero, x.fornitore, x.piva, x.aliquota, e(x.imponibile), e(x.imposta), e(x.detraibile)]));
  if (reg.corrispettivi.length) tabella('registro-corrispettivi', ['Giorno', 'Aliquota', 'Totale', 'Imponibile', 'IVA'], reg.corrispettivi.map(x => [d(x.data), x.aliquota, e(x.totale), e(x.imponibile), e(x.imposta)]));
  const anni = [...new Set([da.slice(0, 4), a.slice(0, 4)])].map(Number);
  if (imp.regime !== 'forfettario') tabella('liquidazioni-iva', ['Anno', 'Periodo', 'IVA esigibile', 'IVA detratta', 'Debito precedente', 'Credito precedente', 'Credito anno prec.', 'Interessi', 'Acconto', 'Da versare', 'A credito', 'Codice', 'Scadenza'],
    anni.flatMap(y => liquidazione(k, ctx, y, imp).periodi.filter(p => p.a >= da && p.da <= a).map(p => [y, p.periodo, e(p.ivaEsigibile), e(p.ivaDetratta), e(p.debitoPrecedente), e(p.creditoPeriodoPrecedente), e(p.creditoAnnoPrecedente), e(p.interessi), e(p.acconto), e(p.daVersare), e(p.importoACredito), p.codice, d(p.scadenza)])));
  // prima nota per cassa: incassi delle fatture e pagamenti ai fornitori
  const prima = [...vendite(k, ctx, '0000-01-01', '9999-12-31').filter(v => v.pagata_il >= da && v.pagata_il <= a).map(v => [d(v.pagata_il), `Incasso fattura ${v.numero} - ${v.cliente}`, e(euro(cent(v.totale) - cent(v.ritenuta))), null]),
    ...acquisti(k, ctx, '0000-01-01', '9999-12-31').filter(x => x.pagata_il >= da && x.pagata_il <= a).map(x => [d(x.pagata_il), `Pagamento fattura ${x.numero} - ${x.fornitore}`, null, e(euro(cent(x.totale) - cent(x.ritenuta)))])]
    .sort((x, y) => x[0].data.localeCompare(y[0].data));
  tabella('prima-nota', ['Data', 'Descrizione', 'Entrate', 'Uscite'], prima);
  const rit = anni.flatMap(y => ritenute(k, ctx, y).righe).filter(r => r.pagata_il >= da && r.pagata_il <= a);
  if (rit.length) tabella('ritenute', ['Pagata il', 'Percipiente', 'Codice fiscale', 'Causale', 'Compenso', 'Ritenuta', 'Codice tributo', 'Versare entro'], rit.map(r => [d(r.pagata_il), r.fornitore, r.cf_percipiente, r.causale, e(r.imponibile), e(r.ritenuta), r.codice, d(r.versamento)]));
  // il riepilogo in PDF
  const fmt = n => (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }), t = reg.totali;
  const righe = [{ testo: `Riepilogo fiscale - ${az.ragione_sociale || ''}`, grande: true }, `Periodo: dal ${da.split('-').reverse().join('/')} al ${a.split('-').reverse().join('/')}`,
    `P.IVA ${az.piva || '-'} - C.F. ${az.codice_fiscale || '-'} - Regime: ${imp.regime} - Periodicità IVA: ${imp.periodicita}`, '',
    { testo: 'Vendite', grassetto: true }, `Fatture emesse: ${reg.vendite.length} - Imponibile ${fmt(t.vendite.imponibile)} - IVA ${fmt(t.vendite.imposta)}`,
    ...(reg.corrispettivi.length ? [`Corrispettivi: ${reg.corrispettivi.length} giorni - Imponibile ${fmt(t.corrispettivi.imponibile)} - IVA ${fmt(t.corrispettivi.imposta)}`] : []), '',
    { testo: 'Acquisti', grassetto: true }, `Fatture ricevute: ${reg.acquisti.length} - Imponibile ${fmt(t.acquisti.imponibile)} - IVA ${fmt(t.acquisti.imposta)} (detraibile ${fmt(t.acquisti.detraibile)})`, ''];
  for (const y of anni) {
    const v = versamenti(k, ctx, y).voci.filter(x => x.data >= da && x.data <= a);
    if (v.length) { righe.push({ testo: `Versamenti con scadenza nel periodo (${y})`, grassetto: true }); for (const x of v) righe.push(`${x.data.split('-').reverse().join('/')}  ${x.codice || x.causale}  anno ${x.anno}  ${fmt(x.importo)}`); righe.push(''); }
  }
  righe.push({ testo: 'Nota', grassetto: true }, 'Preparato con Lumi dai dati del gestionale. Gli importi sono calcolati e vanno controllati: la responsabilità di versamenti e dichiarazioni resta del contribuente.',
    'Gli XML delle fatture emesse sono copie generate ora dai dati: il file inviato allo SDI e le ricevute stanno in «Fatture e Corrispettivi».');
  file.push({ nome: 'riepilogo.pdf', dati: pdfTesto(righe, { titolo: 'Riepilogo fiscale' }) });
  file.push({ nome: 'LEGGIMI.txt', dati: `Pacchetto per il commercialista - ${az.ragione_sociale || ''}\r\nPeriodo ${da} - ${a}\r\n\r\nfatture-emesse/  copie XML FatturaPA delle fatture emesse\r\nregistro-iva-*.csv/.xlsx  registri IVA\r\nliquidazioni-iva  liquidazioni periodiche (se in regime ordinario o semplificato)\r\nprima-nota  incassi e pagamenti\r\nritenute  ritenute operate come sostituto d'imposta\r\nriepilogo.pdf  riepilogo stampabile\r\n` });
  return { nome: `lumi-commercialista_${da}_${a}.zip`, dati: scriviZip(file) };
}
function S_cliente(k, ctx, f) {
  if (!f.cliente?.id) return {};
  try { const fdef = k.S.leggi(k.db, FATTURE); return k.D.leggi(k.db, k.S.campo(fdef, 'cliente').entita, f.cliente.id, ctx, { conRighe: false }); } catch { return {}; }
}

// ---------- strumenti di Lumi ----------
// Avvisi su cosa resta da far fare a un professionista, uguali per gli strumenti e per l'interfaccia
export const PROFESSIONISTA = {
  dichiarazioni: 'Le dichiarazioni (Redditi, IVA annuale, 770) le puoi inviare da solo con SPID; un software non può inviarle per conto tuo: se vuoi che lo faccia qualcuno serve un intermediario abilitato (commercialista, CAF).',
  visto: 'Per compensare in F24 un credito IVA oltre 5.000 € serve il visto di conformità di un professionista.',
  consulenza: 'Scelte come il regime, la riduzione INPS del 35% o le rateazioni sono consulenza: chiedi a un commercialista.',
  redditi: 'IRPEF, IRES e IRAP del regime ordinario o semplificato non le calcola Lumi: le prepara il commercialista o la precompilata.',
};
const mese2 = (anno, mese) => `${anno}-${String(mese).padStart(2, '0')}`;
export function strumentiLumi(k) {
  const oggi = () => new Date().toISOString().slice(0, 10), annoOggi = () => Number(oggi().slice(0, 4));
  const puo = ctx => !!ctx && k.P.puo(ctx, FATTURE, 'leggi');
  const avvisiDi = regime => [PROFESSIONISTA.dichiarazioni, ...(regime === 'forfettario' ? [PROFESSIONISTA.consulenza] : [PROFESSIONISTA.redditi, PROFESSIONISTA.visto])];
  const anno = { type: 'integer', minimum: 2000, maximum: 2100, description: 'anno (predefinito: quello in corso)' };
  return [
    { nome: 'fisco_quanto_pagare', descrizione: 'Quanto deve pagare l\'azienda di tasse e contributi e quando: i prossimi versamenti con codice tributo, importo e scadenza.', tipo: 'leggi', permesso: puo,
      schema: { type: 'object', properties: { giorni: { type: 'integer', minimum: 1, maximum: 400, description: 'quanti giorni avanti guardare (predefinito 90)' } } },
      esegui: async ({ ctx, args = {} }) => {
        const da = oggi(), fino = new Date(Date.now() + (Number(args.giorni) || 90) * 864e5).toISOString().slice(0, 10);
        const voci = [annoOggi(), annoOggi() + 1].flatMap(a => versamenti(k, ctx, a).voci).filter(v => v.data >= da && v.data <= fino);
        return { da, fino, versamenti: voci.map(v => ({ data: v.data, codice: v.codice || v.causale, anno: v.anno, importo: v.importo, cosa: v.chiave })), totale: euro(voci.reduce((s, v) => s + cent(v.importo), 0)), professionista: avvisiDi(impostazioni(k.db, k.meta).regime) };
      } },
    { nome: 'fisco_stima_forfettario', descrizione: 'Stima le tasse del regime forfettario: incassato, reddito, contributi INPS, imposta sostitutiva, acconti e soglie 85.000/100.000; con «incasso_in_piu» simula quanto costerebbe incassare ancora.', tipo: 'leggi', permesso: puo,
      schema: { type: 'object', properties: { anno, incasso_in_piu: { type: 'number', minimum: 0, description: 'euro da incassare ancora quest\'anno' } } },
      esegui: async ({ ctx, args = {} }) => {
        const imp = impostazioni(k.db, k.meta);
        if (imp.regime !== 'forfettario') return { errore: 'L\'azienda non è nel regime forfettario (Fisco → Impostazioni).', regime: imp.regime };
        return { ...cruscottoForfettario(k, ctx, Number(args.anno) || annoOggi(), { piu: args.incasso_in_piu }), professionista: avvisiDi('forfettario') };
      } },
    { nome: 'fisco_liquidazione_iva', descrizione: 'Liquidazione IVA di un mese o trimestre: IVA delle vendite e degli acquisti, crediti e debiti riportati, interessi, importo da versare con codice e scadenza.', tipo: 'leggi', permesso: puo,
      schema: { type: 'object', properties: { anno, periodo: { type: 'integer', minimum: 1, maximum: 12, description: 'mese (1-12) o trimestre (1-4) secondo la periodicità; predefinito: quello in corso' } } },
      esegui: async ({ ctx, args = {} }) => {
        const imp = impostazioni(k.db, k.meta);
        if (imp.regime === 'forfettario') return { errore: 'Nel regime forfettario non si fa la liquidazione IVA.' };
        const a = Number(args.anno) || annoOggi(), m = Number(oggi().slice(5, 7)), p = Number(args.periodo) || (imp.periodicita === 'mensile' ? m : Math.ceil(m / 3));
        const l = liquidazione(k, ctx, a, imp); const x = l.periodi[p - 1]; if (!x) return { errore: 'Periodo non valido' };
        return { anno: a, periodicita: imp.periodicita, ...x, acconto: p === l.periodi.length ? l.acconto : undefined, professionista: [...avvisiDi(imp.regime), ...(l.avvisi.includes('visto-conformita') ? [PROFESSIONISTA.visto] : [])] };
      } },
    { nome: 'fisco_prepara_f24', descrizione: 'Prepara gli F24 di un mese: per ogni scadenza le righe con sezione, codice tributo o causale, anno di riferimento, rateazione e importo, da copiare in F24 web o nell\'home banking.', tipo: 'leggi', permesso: puo,
      schema: { type: 'object', properties: { anno, mese: { type: 'integer', minimum: 1, maximum: 12, description: 'mese delle scadenze (es. 6 per giugno)' } } },
      esegui: async ({ ctx, args = {} }) => {
        const a = Number(args.anno) || annoOggi(), m = Number(args.mese) || Number(oggi().slice(5, 7));
        const f = versamenti(k, ctx, a).f24.filter(x => x.data.startsWith(mese2(a, m)));
        return { anno: a, mese: m, f24: f.map(g => ({ data: g.data, totale: g.totale, righe: g.voci.map(({ chiave, ...v }) => v), stampa: `#/fisco/f24/${g.data}` })),
          come: 'Con saldo a debito senza compensazioni paghi dall\'home banking o da F24 web; se compensi crediti usa i servizi dell\'Agenzia delle Entrate.', professionista: avvisiDi(impostazioni(k.db, k.meta).regime) };
      } },
    { nome: 'fisco_scadenze_mese', descrizione: 'Le scadenze fiscali di un mese che riguardano il regime dell\'azienda (IVA, LIPE, imposte, INPS, bollo, ritenute, dichiarazioni), con l\'importo quando Lumi lo conosce.', tipo: 'leggi', permesso: puo,
      schema: { type: 'object', properties: { anno, mese: { type: 'integer', minimum: 1, maximum: 12 } } },
      esegui: async ({ ctx, args = {} }) => {
        const a = Number(args.anno) || annoOggi(), m = Number(args.mese) || Number(oggi().slice(5, 7));
        return { anno: a, mese: m, scadenze: scadenze(k, ctx, a).filter(s => s.data.startsWith(mese2(a, m))), professionista: avvisiDi(impostazioni(k.db, k.meta).regime) };
      } },
  ];
}

// ---------- rotte ----------
const annoDi = (q, ErroreHttp) => { const a = Number(q.get('anno') || new Date().getFullYear()); if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new ErroreHttp(400, 'Anno non valido'); return a; };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const periodo = (q, ErroreHttp) => { const da = q.get('da'), a = q.get('a'); if (!DATA.test(da || '') || !DATA.test(a || '') || da > a) throw new ErroreHttp(400, 'Periodo non valido'); return [da, a]; };
const scarica = (res, nome, tipo, dati) => res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': dati.length, 'Content-Disposition': `attachment; filename="${nome.replace(/[^\w.-]/g, '_')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(dati);

export default function registra(k) {
  const { r, db, S, P, meta, serve, ErroreHttp } = k;
  // il fisco lo vede chi vede le fatture; le impostazioni le cambia chi può personalizzare
  const lettore = ctx => { serve(ctx); if (!P.puo(ctx, FATTURE, 'leggi') && !P.puoSchema(ctx)) throw new P.ErrorePermesso(); return ctx; };
  const gestore = ctx => { if (!P.puoSchema(serve(ctx))) throw new P.ErrorePermesso('Solo chi può personalizzare cambia le impostazioni fiscali'); return ctx; };
  const errore = e => { throw new ErroreHttp(422, e.message); };

  r('GET', '/api/fisco/impostazioni', ({ ctx }) => { lettore(ctx); return { ...impostazioni(db, meta), sezioni: { ricevute: esiste(S, db, RICEVUTE), corrispettivi: esiste(S, db, CORRISPETTIVI), fatture: esiste(S, db, FATTURE) }, azienda: { piva: azienda(db, meta).piva || '', cf: azienda(db, meta).codice_fiscale || '' } }; });
  r('PUT', '/api/fisco/impostazioni', ({ ctx, corpo }) => { gestore(ctx); try { return salvaImpostazioni(db, meta, corpo); } catch (e) { errore(e); } });
  r('POST', '/api/fisco/prepara', ({ ctx, corpo }) => {
    gestore(ctx); const fatte = [];
    // le fatture ricevute sono quelle del modello fatture: si porta il modello alla versione di oggi (aggiunge «Fatture ricevute»
    // e «Fornitori» se mancano, i campi del fisco se la sezione è di prima, e converte la sezione che il fisco creava da solo)
    if (!esiste(S, db, FATTURE)) throw new ErroreHttp(409, 'Aggiungi prima il modello «Fatture e fattura elettronica» (Personalizza → modelli).');
    const c = S.leggi(db, RICEVUTE), vecchia = !c || c.archiviata || S.campo(c, 'fornitore')?.tipo !== 'relazione' || !S.campo(c, 'detraibile');
    if (vecchia) { aggiornaModello(db, S, { utente: ctx.utente.id, D: k.D }); if (!c || c.archiviata) fatte.push(RICEVUTE); }
    if (corpo.corrispettivi && !esiste(S, db, CORRISPETTIVI)) { S.applica(db, SEZIONE_CORRISPETTIVI, { utente: ctx.utente.id }); fatte.push(CORRISPETTIVI); }
    return { aggiunte: fatte };
  });
  r('GET', '/api/fisco/registri', ({ ctx, q }) => { lettore(ctx); const [da, a] = periodo(q, ErroreHttp); return registri(k, ctx, da, a); });
  r('GET', '/api/fisco/liquidazione', ({ ctx, q }) => liquidazione(k, lettore(ctx), annoDi(q, ErroreHttp)));
  r('GET', '/api/fisco/lipe', ({ ctx, q, res }) => {
    lettore(ctx); const t = Number(q.get('trimestre')); if (![1, 2, 3, 4].includes(t)) throw new ErroreHttp(400, 'Periodo non valido');
    const f = fileLipe(k, ctx, annoDi(q, ErroreHttp), t);
    if (q.get('scarica') === '1') return scarica(res, f.nome, 'application/xml; charset=utf-8', Buffer.from(f.xml, 'utf8'));
    return f;
  });
  r('GET', '/api/fisco/forfettario', ({ ctx, q }) => cruscottoForfettario(k, lettore(ctx), annoDi(q, ErroreHttp), { piu: Number(q.get('piu')) || 0 }));
  r('GET', '/api/fisco/versamenti', ({ ctx, q }) => versamenti(k, lettore(ctx), annoDi(q, ErroreHttp)));
  r('GET', '/api/fisco/f24', ({ ctx, q }) => { lettore(ctx); const data = q.get('data'); if (!DATA.test(data || '')) throw new ErroreHttp(400, 'Periodo non valido'); return f24(k, ctx, annoDi(q, ErroreHttp), data); });
  r('GET', '/api/fisco/ritenute', ({ ctx, q }) => ritenute(k, lettore(ctx), annoDi(q, ErroreHttp)));
  r('GET', '/api/fisco/scadenze', ({ ctx, q }) => scadenze(k, lettore(ctx), annoDi(q, ErroreHttp)));
  r('GET', '/api/fisco/promemoria', ({ ctx }) => { serve(ctx); if (!P.puo(ctx, FATTURE, 'leggi')) return []; return promemoria(k, ctx); });
  r('GET', '/api/fisco/pacchetto', ({ ctx, q, res }) => { lettore(ctx); const [da, a] = periodo(q, ErroreHttp); const p = pacchetto(k, ctx, da, a); return scarica(res, p.nome, 'application/zip', p.dati); });
  // gli strumenti per Lumi (contratto «strumenti di Lumi dai moduli»): se k.lumi non c'è ancora non succede niente
  for (const s of strumentiLumi(k)) k.lumi?.strumento?.(s);
}
