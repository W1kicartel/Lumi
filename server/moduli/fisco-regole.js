// Le regole fiscali italiane di Kubo, senza database: date delle scadenze, codici tributo, soglie e conti del forfettario,
// liquidazione IVA, acconti, bollo virtuale, ritenute. Ogni costante ha la sua fonte accanto; dove la fonte non è un testo
// ufficiale lo diciamo («verifica»). Importi in euro, conti in centesimi interi (cent/euro di documenti-calcoli.js).
// Kubo calcola e prepara: la responsabilità dei versamenti e delle dichiarazioni resta del contribuente.
import { cent, euro, intero } from './documenti-calcoli.js';

// ---------- date ----------
const due = n => String(n).padStart(2, '0');
export const iso = (a, m, g) => `${a}-${due(m)}-${due(g)}`;
export const fineMese = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
// Pasqua (calcolo gregoriano anonimo): serve per il lunedì dell'Angelo
function pasqua(a) {
  const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3);
  const i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
  const mese = Math.floor((i + m - 7 * n + 114) / 31), giorno = ((i + m - 7 * n + 114) % 31) + 1;
  return Date.UTC(a, mese - 1, giorno);
}
// festività nazionali (L. 260/1949 e successive; 4 ottobre di nuovo festa nazionale dal 2026, legge approvata nell'ottobre 2025: verifica)
export function festivo(s) {
  const d = new Date(s + 'T00:00:00Z'), a = d.getUTCFullYear(), md = s.slice(5);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return true;
  const fisse = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26', ...(a >= 2026 ? ['10-04'] : [])];
  return fisse.includes(md) || d.getTime() === pasqua(a) + 864e5;
}
// una scadenza che cade di sabato o in un giorno festivo slitta al primo giorno lavorativo dopo (art. 7 c.1 lett. h DL 70/2011)
export function lavorativo(s) {
  let d = new Date(s + 'T00:00:00Z');
  for (let i = 0; i < 10 && festivo(d.toISOString().slice(0, 10)); i++) d = new Date(d.getTime() + 864e5);
  return d.toISOString().slice(0, 10);
}
export const scad = (a, m, g) => lavorativo(iso(a, m, Math.min(g, fineMese(a, m))));

// ---------- IVA ----------
// Codici tributo IVA (F24, sezione Erario): mensili 6001…6012, trimestrali 6031…6033 (6034 per i trimestrali «speciali»),
// acconto 6013 (mensili) / 6035 (trimestrali), saldo annuale 6099. Fonte: AdE, tabella codici tributo IVA
// (agenziaentrate.gov.it → Strumenti → Codici attività e tributo → Codici tributo IVA).
export const COD_IVA = { mese: m => String(6000 + m), trimestre: t => String(6030 + t), accontoMensili: '6013', accontoTrimestrali: '6035', saldo: '6099' };
// Interessi dell'1% per i trimestrali per opzione: art. 7 c.1 lett. e) DPR 542/1999 (non sul quarto trimestre, che va con il saldo).
export const INTERESSI_TRIMESTRALI = 1;
// Un debito IVA fino a 100 € si riporta al periodo dopo, ma va pagato entro il 16 dicembre: art. 1 c.4 DPR 100/1998 come
// modificato dall'art. 9 D.Lgs. 1/2024 (prima 25,82 €). Lo conferma il controllo del rigo VP7 nelle specifiche IVP18 (≤ 100,00 dal 2024).
export const RIPORTO_MINIMO = 100;
// L'acconto IVA non è dovuto sotto 103,29 € (art. 6 c.2 L. 405/1990; specifiche IVP18, rigo VP13); storico e previsionale all'88%.
export const ACCONTO_MINIMO = 103.29, ACCONTO_PERC = 88;
// Scadenze dei versamenti: mensili il 16 del mese dopo; trimestrali 16/5, 20/8 (proroga di Ferragosto, art. 37 c.11-bis DL 223/2006),
// 16/11; saldo annuale 16/3; acconto 27/12 (art. 6 L. 405/1990). Fonte: DPR 100/1998 e DPR 542/1999.
export function scadenzaIva(periodicita, anno, periodo) {
  if (periodicita === 'mensile') return periodo === 12 ? scad(anno + 1, 1, 16) : scad(anno, periodo + 1, 16);
  return { 1: scad(anno, 5, 16), 2: scad(anno, 8, 20), 3: scad(anno, 11, 16), 4: scad(anno + 1, 3, 16) }[periodo];
}
// LIPE (Comunicazione liquidazioni periodiche IVA): Q1 31/5, Q2 30/9, Q3 30/11, Q4 ultimo giorno di febbraio (art. 21-bis DL 78/2010,
// termini dell'art. 12-quater DL 34/2019). Esonerati i forfettari e chi non deve fare la dichiarazione IVA.
export function scadenzaLipe(anno, trimestre) {
  return { 1: scad(anno, 5, 31), 2: scad(anno, 9, 30), 3: scad(anno, 11, 30), 4: scad(anno + 1, 2, 29) }[trimestre];
}
export const periodiDi = periodicita => (periodicita === 'mensile' ? 12 : 4);
export function limitiPeriodo(periodicita, anno, periodo) {
  const m0 = periodicita === 'mensile' ? periodo : (periodo - 1) * 3 + 1, m1 = periodicita === 'mensile' ? periodo : periodo * 3;
  return { da: iso(anno, m0, 1), a: iso(anno, m1, fineMese(anno, m1)) };
}

// La liquidazione di un anno, periodo per periodo. Entrano: per ogni periodo l'IVA delle vendite (esigibile) e quella degli
// acquisti detraibile; il credito dell'anno prima da usare in detrazione; l'acconto di dicembre già versato.
// Esce, per ogni periodo, la riga del quadro VP: debito/credito, riporti, interessi, importo da versare con codice e scadenza.
export function liquida({ periodicita = 'trimestrale', anno, periodi, creditoAnnoPrecedente = 0, acconto = 0 }) {
  const n = periodiDi(periodicita), out = [];
  let creditoPrec = 0, debitoPrec = 0, creditoAnno = cent(creditoAnnoPrecedente);
  for (let p = 1; p <= n; p++) {
    const x = periodi[p - 1] || {}, esig = cent(x.ivaVendite), detr = cent(x.ivaAcquisti);
    const ultimo = p === n, a = esig - detr;
    const r = { periodo: p, ...limitiPeriodo(periodicita, anno, p), attive: euro(cent(x.attive)), passive: euro(cent(x.passive)), ivaEsigibile: euro(esig), ivaDetratta: euro(detr),
      ivaDovuta: euro(Math.max(0, a)), ivaCredito: euro(Math.max(0, -a)), debitoPrecedente: euro(debitoPrec), creditoPeriodoPrecedente: euro(creditoPrec) };
    let netto = a + debitoPrec - creditoPrec;
    // il credito dell'anno prima si usa finché c'è, solo quando c'è qualcosa da pagare
    const usaAnno = Math.min(creditoAnno, Math.max(0, netto)); creditoAnno -= usaAnno; netto -= usaAnno; r.creditoAnnoPrecedente = euro(usaAnno);
    const acc = ultimo ? cent(acconto) : 0; r.acconto = euro(acc);
    // fino a 100 € si riporta (ma non oltre il 16 dicembre: novembre per i mensili e il terzo trimestre si pagano comunque)
    const ultimoRiportabile = periodicita === 'mensile' ? 10 : 2;
    r.riportato = netto - acc > 0 && netto - acc <= cent(RIPORTO_MINIMO) && p <= ultimoRiportabile;
    // l'1% dei trimestrali sul dovuto (Q1-Q3); quello del quarto trimestre va nel saldo annuale, non nella LIPE (rigo VP12)
    const trim = periodicita === 'trimestrale' && netto > 0 && !r.riportato;
    const interessi = trim && !ultimo ? intero(netto * INTERESSI_TRIMESTRALI / 100) : 0, interessiSaldo = trim && ultimo ? intero(netto * INTERESSI_TRIMESTRALI / 100) : 0;
    r.interessi = euro(interessi); r.interessiSaldo = euro(interessiSaldo);
    const finale = netto + interessi - acc;
    r.importoDaVersare = euro(Math.max(0, finale)); r.importoACredito = euro(Math.max(0, -finale));
    r.daVersare = finale > 0 && !r.riportato ? euro(finale + interessiSaldo) : 0;
    r.codice = periodicita === 'mensile' ? COD_IVA.mese(p) : ultimo ? COD_IVA.saldo : COD_IVA.trimestre(p);
    r.scadenza = scadenzaIva(periodicita, anno, p);
    debitoPrec = r.riportato ? finale : 0; creditoPrec = finale < 0 ? -finale : 0;
    out.push(r);
  }
  return { periodicita, anno, periodi: out, creditoAnnoResiduo: euro(creditoAnno) };
}
// L'acconto IVA di dicembre: storico = 88% del versato per l'ultimo periodo dell'anno prima (dicembre o saldo del quarto
// trimestre, al lordo dell'acconto); previsionale = 88% di quanto si prevede per l'ultimo periodo di quest'anno. Si sceglie il minore.
export function accontoIva({ periodicita = 'trimestrale', anno, storico = null, previsto = null }) {
  const metodi = [];
  if (storico != null && storico !== '') metodi.push({ metodo: 'storico', codiceMetodo: 1, importo: euro(intero(cent(storico) * ACCONTO_PERC / 100)) });
  if (previsto != null && previsto !== '') metodi.push({ metodo: 'previsionale', codiceMetodo: 2, importo: euro(intero(cent(previsto) * ACCONTO_PERC / 100)) });
  const scelto = metodi.sort((a, b) => a.importo - b.importo)[0] || null;
  const dovuto = !!scelto && scelto.importo >= ACCONTO_MINIMO;
  return { metodi, scelto, dovuto, importo: dovuto ? scelto.importo : 0, codice: periodicita === 'mensile' ? COD_IVA.accontoMensili : COD_IVA.accontoTrimestrali, scadenza: scad(anno, 12, 27) };
}

// ---------- forfettario ----------
// Soglie 2026: si resta nel regime se l'anno prima i ricavi sono ≤ 85.000 €; oltre 100.000 € si esce subito, con l'IVA
// dall'operazione che supera (L. 190/2014 art. 1 c.54 e c.71, come modificati dalla L. 197/2022).
export const SOGLIA_FORFETTARIO = 85000, SOGLIA_USCITA = 100000, AVVISO_SOGLIA = 0.8;
// Imposta sostitutiva: 15%, oppure 5% per i primi cinque anni di una nuova attività con i requisiti del c.65 (L. 190/2014 c.64 e c.65).
export const SOSTITUTIVA = 15, SOSTITUTIVA_START = 5;
// Codici tributo dell'imposta sostitutiva: 1790 primo acconto, 1791 secondo acconto, 1792 saldo (ris. AdE 7/E del 27/1/2015).
export const COD_FORF = { acconto1: '1790', acconto2: '1791', saldo: '1792' };
// Acconti (metodo storico): niente sotto 51,65 €; fino a 257,52 € in un'unica rata a novembre; oltre, 50% + 50%
// (art. 17 c.3 DPR 435/2001; art. 58 DL 124/2019 per i soggetti ISA e i forfettari).
export const ACCONTO_FORF_MIN = 51.65, ACCONTO_FORF_UNICO = 257.52;
// Coefficienti di redditività: allegato 4 alla L. 190/2014 (codici ATECO 2007). Con ATECO 2025 restano in vigore in via
// transitoria finché non esce la tabella nuova (verifica il tuo codice sul sito dell'Agenzia). Prima i codici più specifici.
export const COEFFICIENTI = [
  { prefissi: ['46.1'], coeff: 62, gruppo: 'intermediari' },                                   // intermediari del commercio
  { prefissi: ['47.81'], coeff: 40, gruppo: 'ambulanti-alimentari' },                           // ambulanti di alimentari e bevande
  { prefissi: ['47.82', '47.89'], coeff: 54, gruppo: 'ambulanti' },                             // ambulanti di altri prodotti
  { prefissi: ['10', '11'], coeff: 40, gruppo: 'alimentari' },                                  // industrie alimentari e delle bevande
  { prefissi: ['45', '46', '47'], coeff: 40, gruppo: 'commercio' },                             // commercio all'ingrosso e al dettaglio
  { prefissi: ['41', '42', '43', '68'], coeff: 86, gruppo: 'costruzioni' },                     // costruzioni e attività immobiliari
  { prefissi: ['55', '56'], coeff: 40, gruppo: 'alloggio' },                                    // alloggio e ristorazione
  { prefissi: ['64', '65', '66', '69', '70', '71', '72', '73', '74', '75', '85', '86', '87', '88'], coeff: 78, gruppo: 'professioni' },
];
export const COEFF_ALTRE = 67;   // altre attività economiche (gruppo 9 dell'allegato 4)
export function coefficienteAteco(codice) {
  const c = String(codice || '').trim().replace(/[^\d.]/g, ''); if (!/^\d{2}/.test(c)) return null;
  const punti = c.length > 2 && !c.includes('.') ? c.replace(/^(\d{2})(\d{1,2})?(\d{1,2})?$/, (m, a, b, d) => [a, b, d].filter(Boolean).join('.')) : c;
  for (const r of COEFFICIENTI) for (const p of r.prefissi) if (punti === p || punti.startsWith(p + (p.length === 2 ? '.' : '')) || (p.includes('.') && punti.startsWith(p))) {
    if (p.length === 2 && (punti.startsWith('46.1') || punti.startsWith('47.8'))) continue;   // già presi dai più specifici
    return { coeff: r.coeff, gruppo: r.gruppo };
  }
  return { coeff: COEFF_ALTRE, gruppo: 'altre' };
}

// ---------- INPS 2026 ----------
// Artigiani e commercianti: minimale 18.808 €, contributi fissi annui sul minimale, aliquote 24% / 24,48% fino a 56.224 €,
// +1% oltre (Circ. INPS 14 del 9/2/2026, riportata in docs/ricerca/COMMERCIALISTA.md: verifica gli importi nel Cassetto
// previdenziale). Massimale per chi è iscritto dal 1996: 122.295 € (stesso valore della gestione separata, Circ. 8/2026).
// Riduzione del 35% per i forfettari che la chiedono (L. 190/2014 c.77). Gestione separata: 26,07% fino al massimale (Circ. 8/2026).
export const INPS = {
  anno: 2026, minimale: 18808, fascia: 56224, massimale: 122295,
  artigiani: { fissi: 4521, aliquota: 24, oltre: 25, causaleFissi: 'AF', causale: 'AP' },
  commercianti: { fissi: 4612, aliquota: 24.48, oltre: 25.48, causaleFissi: 'CF', causale: 'CP' },
  separata: { aliquota: 26.07, causale: 'PXX' },   // causale PXX per chi non ha altra copertura (P10 per i pensionati e iscritti altrove)
  riduzione: 35,
};
// rate dei contributi fissi: 16/5, 20/8, 16/11, 16/2 dell'anno dopo (Circ. INPS 14/2026)
export const rateFisseInps = anno => [scad(anno, 5, 16), scad(anno, 8, 20), scad(anno, 11, 16), scad(anno + 1, 2, 16)];

export function contributiInps({ gestione, reddito, riduzione35 = false }) {
  const r = Math.max(0, Number(reddito) || 0);
  if (gestione === 'artigiani' || gestione === 'commercianti') {
    const g = INPS[gestione], k = riduzione35 ? (100 - INPS.riduzione) / 100 : 1;
    const base = Math.min(r, INPS.massimale);
    const fino = Math.max(0, Math.min(base, INPS.fascia) - INPS.minimale), oltre = Math.max(0, base - INPS.fascia);
    const fissi = euro(intero(g.fissi * 100 * k)), eccedenza = euro(intero((fino * g.aliquota + oltre * g.oltre) * k));
    return { gestione, fissi, eccedenza, totale: euro(cent(fissi) + cent(eccedenza)), causaleFissi: g.causaleFissi, causale: g.causale };
  }
  if (gestione === 'separata') {
    const tot = euro(intero(Math.min(r, INPS.massimale) * INPS.separata.aliquota));
    return { gestione, fissi: 0, eccedenza: tot, totale: tot, causale: INPS.separata.causale };
  }
  return { gestione: gestione || 'nessuna', fissi: 0, eccedenza: 0, totale: 0, calcolabile: false };
}

// Le date degli acconti e del saldo delle imposte sui redditi: 30/6 e 30/11 (art. 17 DPR 435/2001); per i soggetti ISA e i
// forfettari il primo termine può essere prorogato (2026: 20/7, fonte ecnews 2026, verifica ogni anno).
export const PROROGHE_GIUGNO = { 2026: '2026-07-20' };
export const scadenzaGiugno = anno => PROROGHE_GIUGNO[anno] || scad(anno, 6, 30);
export const scadenzaNovembre = anno => scad(anno, 11, 30);

export function accontiForfettario(base, anno) {
  const b = cent(base);
  if (b <= cent(ACCONTO_FORF_MIN)) return [];   // dovuto solo se supera 51,65 €
  if (b <= cent(ACCONTO_FORF_UNICO)) return [{ codice: COD_FORF.acconto2, importo: euro(b), scadenza: scadenzaNovembre(anno), rata: 'unica' }];
  const primo = intero(b / 2);
  return [{ codice: COD_FORF.acconto1, importo: euro(primo), scadenza: scadenzaGiugno(anno), rata: 'prima' }, { codice: COD_FORF.acconto2, importo: euro(b - primo), scadenza: scadenzaNovembre(anno), rata: 'seconda' }];
}

// Il cruscotto del forfettario per un anno: incassato (cassa), reddito, contributi, imposta, acconti e avvisi sulle soglie.
export function forfettario({ incassato = 0, coefficiente = COEFF_ALTRE, gestione = 'nessuna', riduzione35 = false, aliquotaRidotta = false,
  contributiVersati = null, impostaAnnoPrecedente = null, accontiVersati = 0, anno, ricaviAnnoPrecedente = null }) {
  const inc = cent(incassato), lordo = intero(inc * coefficiente / 100);
  const inps = contributiInps({ gestione, reddito: euro(lordo), riduzione35 });
  // si deducono i contributi VERSATI nell'anno (principio di cassa): se non li conosci si usa la stima dell'anno, e lo diciamo
  const dedotti = contributiVersati != null && contributiVersati !== '' ? cent(contributiVersati) : cent(inps.totale);
  const imponibile = Math.max(0, lordo - dedotti), aliquota = aliquotaRidotta ? SOSTITUTIVA_START : SOSTITUTIVA;
  const imposta = intero(imponibile * aliquota / 100);
  const avvisi = [];
  if (inc > cent(SOGLIA_USCITA)) avvisi.push('oltre-100');
  else if (inc > cent(SOGLIA_FORFETTARIO)) avvisi.push('oltre-85');
  else if (inc >= cent(SOGLIA_FORFETTARIO * AVVISO_SOGLIA)) avvisi.push('vicino-85');
  if (ricaviAnnoPrecedente != null && Number(ricaviAnnoPrecedente) > SOGLIA_FORFETTARIO) avvisi.push('fuori-dal-regime');
  if (contributiVersati == null || contributiVersati === '') avvisi.push('contributi-stimati');
  if (gestione === 'cassa') avvisi.push('cassa-professionale');
  const base = impostaAnnoPrecedente != null && impostaAnnoPrecedente !== '' ? Number(impostaAnnoPrecedente) : null;
  return {
    anno, incassato: euro(inc), coefficiente, redditoLordo: euro(lordo), inps, contributiDedotti: euro(dedotti), imponibile: euro(imponibile), aliquota, imposta: euro(imposta),
    // saldo dell'anno (si paga l'anno dopo) = imposta − acconti versati quest'anno
    saldo: euro(imposta - cent(accontiVersati)), accontiAnnoProssimo: accontiForfettario(euro(imposta), anno + 1),
    accontiQuestAnno: base != null ? accontiForfettario(base, anno) : null,
    soglia: { limite: SOGLIA_FORFETTARIO, uscita: SOGLIA_USCITA, usato: Math.round(inc / cent(SOGLIA_FORFETTARIO) * 1000) / 10, margine: euro(Math.max(0, cent(SOGLIA_FORFETTARIO) - inc)) },
    avvisi,
  };
}

// ---------- bollo virtuale ----------
// 2 € per fattura esente o fuori campo sopra 77,47 € (art. 6 DM 17/6/2014). Codici 2521-2524 per trimestre (ris. AdE 42/E del 9/4/2019).
// Termini: Q1 31/5, Q2 30/9, Q3 30/11, Q4 28/2 (fine febbraio) dell'anno dopo; Q1 si può pagare con Q2 se ≤ 5.000 €, e Q1+Q2 con Q3
// se insieme ≤ 5.000 € (art. 17 DL 34/2019, soglie del DL 73/2022).
export const BOLLO = { importo: 2, soglia: 77.47, codici: { 1: '2521', 2: '2522', 3: '2523', 4: '2524' }, rinvio: 5000 };
export function bolli(anno, perTrimestre) {   // perTrimestre: { 1: euro, 2: …, 3: …, 4: … }
  const q = t => Number(perTrimestre[t] || 0);
  const base = { 1: scad(anno, 5, 31), 2: scad(anno, 9, 30), 3: scad(anno, 11, 30), 4: scad(anno + 1, 2, 28) };
  const out = [1, 2, 3, 4].map(t => ({ trimestre: t, codice: BOLLO.codici[t], importo: q(t), scadenza: base[t], anno }));
  if (q(1) > 0 && q(1) <= BOLLO.rinvio) out[0].scadenza = base[2];
  if (q(1) + q(2) > 0 && q(1) + q(2) <= BOLLO.rinvio) { out[1].scadenza = base[3]; if (q(1) <= BOLLO.rinvio) out[0].scadenza = base[3]; }
  return out.filter(x => x.importo > 0);
}

// ---------- ritenute e altri tributi ----------
// 1040: ritenute su redditi di lavoro autonomo, si versano entro il 16 del mese dopo il pagamento (art. 18 D.Lgs. 241/1997).
// 3850: diritto annuale della Camera di commercio, entro il termine del primo acconto delle imposte (DM 359/2001; sezione IMU e altri tributi locali, codice ente = sigla della provincia).
export const COD_RITENUTE = '1040', COD_CAMERALE = '3850';
export const scadenzaRitenuta = dataPagamento => { const [a, m] = String(dataPagamento).split('-').map(Number); return m === 12 ? scad(a + 1, 1, 16) : scad(a, m + 1, 16); };

// ---------- le scadenze dell'anno per il regime dell'azienda ----------
// tipo: iva, lipe, imposte, inps, bollo, ritenute, dichiarazioni, camerale; chi: «tu» (con SPID) o «professionista» (quando serve davvero)
export function scadenzario(anno, imp = {}) {
  const forf = imp.regime === 'forfettario', s = [];
  const add = (data, chiave, tipo, extra = {}) => s.push({ data, chiave, tipo, ...extra });
  if (!forf) {
    for (let p = 1; p <= periodiDi(imp.periodicita); p++) add(scadenzaIva(imp.periodicita, anno, p), imp.periodicita === 'mensile' ? 'iva-mese' : p === 4 ? 'iva-saldo' : 'iva-trimestre', 'iva', { periodo: p });
    add(scad(anno, 12, 27), 'iva-acconto', 'iva');
    for (let t = 1; t <= 4; t++) add(scadenzaLipe(anno, t), 'lipe', 'lipe', { periodo: t });
    add(scad(anno, 4, 30), 'dichiarazione-iva', 'dichiarazioni', { anno: anno - 1 });
  }
  add(scadenzaGiugno(anno), forf ? 'forf-saldo-acconto' : 'redditi-saldo-acconto', 'imposte');
  add(scadenzaNovembre(anno), forf ? 'forf-acconto2' : 'redditi-acconto2', 'imposte');
  add(scad(anno, 10, 31), 'dichiarazione-redditi', 'dichiarazioni', { anno: anno - 1 });
  if (['artigiani', 'commercianti'].includes(imp.gestione)) rateFisseInps(anno).forEach((d, i) => add(d, 'inps-fissi', 'inps', { periodo: i + 1 }));
  if (imp.gestione === 'artigiani' || imp.gestione === 'commercianti' || imp.gestione === 'separata') add(scadenzaGiugno(anno), 'inps-saldo-acconto', 'inps');
  if (forf && ['artigiani', 'commercianti'].includes(imp.gestione)) add(scad(anno, 2, 28), 'inps-riduzione', 'inps');
  if (forf || imp.bollo) for (const [t, d] of Object.entries({ 1: scad(anno, 5, 31), 2: scad(anno, 9, 30), 3: scad(anno, 11, 30), 4: scad(anno, 2, 28) })) add(d, 'bollo', 'bollo', { periodo: Number(t), anno: t === '4' ? anno - 1 : anno });
  if (imp.sostituto) { for (let m = 1; m <= 12; m++) add(scad(anno, m, 16), 'ritenute', 'ritenute', { periodo: m === 1 ? 12 : m - 1 }); add(scad(anno, 3, 16), 'cu-consegna', 'dichiarazioni'); add(scad(anno, 4, 30), 'cu-invio', 'dichiarazioni'); add(scad(anno, 10, 31), 'modello-770', 'dichiarazioni'); }
  if (imp.camerale !== false) add(scadenzaGiugno(anno), 'camerale', 'camerale');
  return s.sort((a, b) => a.data.localeCompare(b.data));
}
