// I file del fisco: la Comunicazione liquidazioni periodiche IVA in XML (LIPE), il modello F24 compilato da stampare e un
// PDF di testo semplice per il riepilogo del pacchetto per il commercialista. Niente dipendenze.
import { xml as escXml } from './import-formati.js';

// ---------- LIPE ----------
// Specifiche tecniche «Comunicazione IVA Trimestrale» (codice fornitura IVP18, schema fornituraIvp_2018_v1.xsd, namespace
// urn:www.agenziaentrate.gov.it:specificheTecniche:sco:ivp), Allegato A del provv. AdE 27/3/2017 e aggiornamenti successivi.
// Importi con la virgola e due decimali (DatoVP_Type/DatoVN_Type); un modulo per mese (mensili) o uno per trimestre.
// Per i trimestrali il quarto trimestre si indica con Trimestre = 5 e senza rigo VP14 né interessi (controlli dei righi VP12 e VP14).
export const NS_LIPE = 'urn:www.agenziaentrate.gov.it:specificheTecniche:sco:ivp';
const imp = n => (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace('.', ',');
export function lipe({ cf, piva, anno, periodicita, trimestre, periodi, metodoAcconto = null, identificativo = 1, firma = true }) {
  const righe = [];
  const el = (nome, v, rientro = '      ') => righe.push(`${rientro}<iv:${nome}>${escXml(v)}</iv:${nome}>`);
  righe.push('<?xml version="1.0" encoding="UTF-8"?>', `<iv:Fornitura xmlns:iv="${NS_LIPE}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">`,
    '  <iv:Intestazione>', '    <iv:CodiceFornitura>IVP18</iv:CodiceFornitura>', '  </iv:Intestazione>',
    `  <iv:Comunicazione identificativo="${String(identificativo).padStart(5, '0')}">`, '    <iv:Frontespizio>');
  el('CodiceFiscale', cf); el('AnnoImposta', anno); el('PartitaIVA', piva); el('FirmaDichiarazione', firma ? 1 : 0); el('IdentificativoProdSoftware', 'KUBO');
  righe.push('    </iv:Frontespizio>', '    <iv:DatiContabili>');
  periodi.forEach((p, i) => {
    const r = '        ', q5 = periodicita === 'trimestrale' && trimestre === 4;
    righe.push('      <iv:Modulo>'); el('NumeroModulo', i + 1, r);
    if (periodicita === 'mensile') el('Mese', p.periodo, r); else el('Trimestre', q5 ? 5 : trimestre, r);
    el('TotaleOperazioniAttive', imp(p.attive), r); el('TotaleOperazioniPassive', imp(p.passive), r);
    el('IvaEsigibile', imp(p.ivaEsigibile), r); el('IvaDetratta', imp(p.ivaDetratta), r);
    if (p.ivaDovuta > 0) el('IvaDovuta', imp(p.ivaDovuta), r); else el('IvaCredito', imp(p.ivaCredito), r);
    if (p.debitoPrecedente > 0) el('DebitoPrecedente', imp(p.debitoPrecedente), r);
    if (p.creditoPeriodoPrecedente > 0) el('CreditoPeriodoPrecedente', imp(p.creditoPeriodoPrecedente), r);
    if (p.creditoAnnoPrecedente > 0) el('CreditoAnnoPrecedente', imp(p.creditoAnnoPrecedente), r);
    if (p.interessi > 0 && !q5) el('InteressiDovuti', imp(p.interessi), r);
    if (p.acconto > 0) { el('Metodo', metodoAcconto || 1, r); el('Acconto', imp(p.acconto), r); }
    if (!q5) { if (p.importoDaVersare > 0) el('ImportoDaVersare', imp(p.importoDaVersare), r); else el('ImportoACredito', imp(p.importoACredito), r); }
    righe.push('      </iv:Modulo>');
  });
  righe.push('    </iv:DatiContabili>', '  </iv:Comunicazione>', '</iv:Fornitura>', '');
  const nome = `IT${piva}_LI_${anno}${periodicita === 'mensile' ? 'T' : 'T'}${trimestre}.xml`;
  return { nome, xml: righe.join('\n') };
}

// ---------- F24 ----------
// Il modello F24 (provv. AdE del 2007 e successivi): sezioni Erario, INPS, Regioni, IMU e altri tributi locali. Qui una
// versione da stampare e da ricopiare in F24 web o nell'home banking: stessi campi, stesso ordine.
const eur = n => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function f24Html({ contribuente = {}, scadenza, erario = [], inps = [], locali = [], testi = {} }) {
  const e = escXml, T = k => e(testi[k] ?? k);
  const tot = l => l.reduce((s, x) => s + Math.round((x.debito || 0) * 100), 0) / 100, cred = l => l.reduce((s, x) => s + Math.round((x.credito || 0) * 100), 0) / 100;
  const tabella = (titolo, intest, righe, celle) => !righe.length ? '' : `<h2>${T(titolo)}</h2><table><tr>${intest.map(x => `<th>${T(x)}</th>`).join('')}</tr>${righe.map(r => `<tr>${celle(r).map(c => `<td>${e(c ?? '')}</td>`).join('')}</tr>`).join('')}
    <tr class="tot"><td colspan="${intest.length - 2}">${T('f24-totale')}</td><td>${eur(tot(righe))}</td><td>${eur(cred(righe))}</td></tr></table>`;
  const saldo = tot(erario) + tot(inps) + tot(locali) - cred(erario) - cred(inps) - cred(locali);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>F24</title><style>
body{font:12px/1.35 Helvetica,Arial,sans-serif;color:#000;margin:24px}h1{font-size:18px;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 4px;border-bottom:2px solid #000}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:4px 6px;text-align:left}th{font-size:10px;text-transform:uppercase;background:#eee}td:nth-last-child(-n+2){text-align:right;font-variant-numeric:tabular-nums}
.tot td{font-weight:700}.saldo{margin-top:18px;font-size:16px;font-weight:700;text-align:right}.nota{margin-top:18px;font-size:11px;border:1px solid #000;padding:8px}@media print{body{margin:10mm}}
</style></head><body><h1>${T('f24-titolo')}</h1><p>${T('f24-contribuente')}: <b>${e(contribuente.nome || '')}</b> · ${T('f24-cf')}: <b>${e(contribuente.cf || '')}</b> · ${T('f24-scadenza')}: <b>${e(scadenza || '')}</b></p>
${tabella('f24-erario', ['f24-codice', 'f24-rateazione', 'f24-anno', 'f24-debito', 'f24-credito'], erario, r => [r.codice, r.rateazione, r.anno, eur(r.debito), r.credito ? eur(r.credito) : ''])}
${tabella('f24-inps', ['f24-sede', 'f24-causale', 'f24-matricola', 'f24-da', 'f24-a', 'f24-debito', 'f24-credito'], inps, r => [r.sede, r.causale, r.matricola, r.da, r.a, eur(r.debito), r.credito ? eur(r.credito) : ''])}
${tabella('f24-locali', ['f24-ente', 'f24-codice', 'f24-rateazione', 'f24-anno', 'f24-debito', 'f24-credito'], locali, r => [r.ente, r.codice, r.rateazione, r.anno, eur(r.debito), r.credito ? eur(r.credito) : ''])}
<p class="saldo">${T('f24-saldo')}: € ${eur(saldo)}</p><p class="nota">${T('f24-nota')}</p></body></html>`;
}

// ---------- un PDF di solo testo ----------
// PDF 1.4 con Helvetica (WinAnsiEncoding): righe di testo, a capo automatico, più pagine. Basta per un riepilogo da stampare.
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
function winAnsi(s) {
  const b = [];
  for (const ch of String(s)) { const c = ch.codePointAt(0); if (WIN[ch]) b.push(WIN[ch]); else if (c < 256) b.push(c); else b.push(63); }
  return Buffer.from(b).toString('latin1').replace(/[\\()]/g, m => '\\' + m);
}
// righe: [{ testo, grande?, grassetto? }] o stringhe
export function pdfTesto(righe, { titolo = 'Kubo' } = {}) {
  const pagine = [[]], A4 = [595, 842], margine = 50, max = 92;
  let y = A4[1] - margine;
  for (const r0 of righe) {
    const r = typeof r0 === 'string' ? { testo: r0 } : r0, dim = r.grande ? 15 : 10, alt = dim + 5;
    const pezzi = []; let resto = String(r.testo ?? '');
    do { let i = resto.length > max ? resto.lastIndexOf(' ', max) : resto.length; if (i <= 0) i = Math.min(max, resto.length); pezzi.push(resto.slice(0, i)); resto = resto.slice(i).trimStart(); } while (resto);
    for (const p of pezzi) {
      if (y - alt < margine) { pagine.push([]); y = A4[1] - margine; }
      y -= alt; pagine.at(-1).push(`BT /${r.grassetto || r.grande ? 'F2' : 'F1'} ${dim} Tf ${margine} ${y} Td (${winAnsi(p)}) Tj ET`);
    }
  }
  const ogg = [];   // [contenuto] con numerazione da 1
  const aggiungi = s => { ogg.push(s); return ogg.length; };
  const catalogo = aggiungi(''), radice = aggiungi('');
  const f1 = aggiungi('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = aggiungi('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const figli = pagine.map(p => {
    const flusso = p.join('\n'), c = aggiungi(`<< /Length ${Buffer.byteLength(flusso, 'latin1')} >>\nstream\n${flusso}\nendstream`);
    return aggiungi(`<< /Type /Page /Parent ${radice} 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  ogg[catalogo - 1] = `<< /Type /Catalog /Pages ${radice} 0 R >>`;
  ogg[radice - 1] = `<< /Type /Pages /Kids [${figli.map(f => `${f} 0 R`).join(' ')}] /Count ${figli.length} >>`;
  const info = aggiungi(`<< /Title (${winAnsi(titolo)}) /Producer (Kubo) >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const pos = [];
  ogg.forEach((o, i) => { pos.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${ogg.length + 1}\n0000000000 65535 f \n${pos.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${ogg.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
