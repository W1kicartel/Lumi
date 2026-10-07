// Le fatture ricevute: lettura del file FatturaPA (FPR12 o FPA12, anche con più fatture nello stesso file) e la vista
// leggibile. Si leggono solo gli elementi che servono, con espressioni semplici e senza un parser XML generico: niente
// entità esterne, niente DTD, niente rete. Il modulo non registra rotte (le rotte sono in fatture.js).

const MAX = 5 * 1024 * 1024;
// i byte del file → testo, rispettando la codifica dichiarata (UTF-8 o ISO-8859-1/Windows-1252)
export function testoXml(b) {
  if (b.length > MAX) throw new Error('Il file è troppo grande: al massimo 5 MB');
  const testa = b.subarray(0, 200).toString('latin1'), cod = /encoding=["']([\w-]+)["']/i.exec(testa)?.[1]?.toLowerCase();
  const t = new TextDecoder(cod && /8859|1252|latin/.test(cod) ? 'windows-1252' : 'utf-8').decode(b).replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(t)) throw new Error('Il file non è una fattura elettronica');
  // i prefissi dei namespace (p:, ns2:…) si tolgono: i nomi degli elementi FatturaPA sono unici
  return t.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const testo = s => (s == null ? null : s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m)).trim());
export const blocchi = (x, tag) => [...String(x || '').matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
export const val = (x, tag) => testo(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(String(x || ''))?.[1] ?? null);
const num = s => (s == null || s === '' ? 0 : Number(s));

function soggetto(x) {
  const a = blocchi(x, 'DatiAnagrafici')[0] || '', s = blocchi(x, 'Sede')[0] || '', id = blocchi(a, 'IdFiscaleIVA')[0] || '';
  const nome = val(a, 'Denominazione') || [val(a, 'Nome'), val(a, 'Cognome')].filter(Boolean).join(' ');
  return {
    nome, paese: val(id, 'IdPaese') || val(s, 'Nazione') || 'IT', piva: val(id, 'IdCodice') || '', codice_fiscale: val(a, 'CodiceFiscale') || '',
    regime: val(a, 'RegimeFiscale') || '', via: [val(s, 'Indirizzo'), val(s, 'NumeroCivico')].filter(Boolean).join(' '), cap: val(s, 'CAP') || '',
    comune: val(s, 'Comune') || '', provincia: val(s, 'Provincia') || '', nazione: val(s, 'Nazione') || 'IT',
    email: val(blocchi(x, 'Contatti')[0], 'Email') || '', telefono: val(blocchi(x, 'Contatti')[0], 'Telefono') || '',
  };
}

// testo XML → { formato, fornitore, cliente, fatture: [{ tipo, numero, data, imponibile, imposta, totale, ritenuta, netto, righe, riepilogo, pagamenti, … }] }
export function leggiFattura(xml) {
  const testa = blocchi(xml, 'FatturaElettronicaHeader')[0], corpi = blocchi(xml, 'FatturaElettronicaBody');
  if (!testa || !corpi.length) throw new Error('Il file non è una fattura elettronica');
  const formato = /versione=["'](FP[AR]12)["']/.exec(xml)?.[1] || val(testa, 'FormatoTrasmissione') || '';
  const fornitore = soggetto(blocchi(testa, 'CedentePrestatore')[0]), cliente = soggetto(blocchi(testa, 'CessionarioCommittente')[0]);
  const fatture = corpi.map(c => {
    const g = blocchi(c, 'DatiGeneraliDocumento')[0] || '';
    const righe = blocchi(c, 'DettaglioLinee').map(l => ({ n: Number(val(l, 'NumeroLinea')), descrizione: val(l, 'Descrizione') || '', quantita: val(l, 'Quantita') == null ? 1 : num(val(l, 'Quantita')),
      unita: val(l, 'UnitaMisura') || '', prezzo: num(val(l, 'PrezzoUnitario')), totale: num(val(l, 'PrezzoTotale')), aliquota: num(val(l, 'AliquotaIVA')), natura: val(l, 'Natura') || null }));
    const riepilogo = blocchi(c, 'DatiRiepilogo').map(r => ({ aliquota: num(val(r, 'AliquotaIVA')), natura: val(r, 'Natura') || null, imponibile: num(val(r, 'ImponibileImporto')),
      imposta: num(val(r, 'Imposta')), esigibilita: val(r, 'EsigibilitaIVA') || 'I', riferimento: val(r, 'RiferimentoNormativo') || '' }));
    const pagamenti = blocchi(c, 'DettaglioPagamento').map(p => ({ modalita: val(p, 'ModalitaPagamento') || '', scadenza: val(p, 'DataScadenzaPagamento') || null,
      importo: num(val(p, 'ImportoPagamento')), iban: val(p, 'IBAN') || '' }));
    const imponibile = cent2(riepilogo.reduce((s, r) => s + r.imponibile, 0)), imposta = cent2(riepilogo.reduce((s, r) => s + r.imposta, 0));
    const ritenuta = cent2(blocchi(g, 'DatiRitenuta').reduce((s, r) => s + num(val(r, 'ImportoRitenuta')), 0));
    const totale = val(g, 'ImportoTotaleDocumento') != null ? num(val(g, 'ImportoTotaleDocumento')) : cent2(imponibile + imposta);
    const split = riepilogo.some(r => r.esigibilita === 'S');
    return {
      tipo: val(g, 'TipoDocumento') || 'TD01', numero: val(g, 'Numero') || '', data: val(g, 'Data') || null, divisa: val(g, 'Divisa') || 'EUR',
      causale: blocchi(g, 'Causale').map(testo).join(' '), bollo: !!blocchi(g, 'DatiBollo').length,
      imponibile, imposta, totale, ritenuta, netto: pagamenti.length ? cent2(pagamenti.reduce((s, p) => s + p.importo, 0)) : cent2(totale - ritenuta - (split ? imposta : 0)),
      scadenza: pagamenti.map(p => p.scadenza).filter(Boolean).sort()[0] || null, modalita: pagamenti[0]?.modalita || '', iban: pagamenti.find(p => p.iban)?.iban || '',
      // da integrare: inversione contabile (N6.x) o fornitore estero (servirà un TD16-TD19)
      inversione: riepilogo.some(r => /^N6/.test(r.natura || '')) || (fornitore.paese !== 'IT' && !riepilogo.some(r => r.imposta > 0)),
      righe, riepilogo, pagamenti,
    };
  });
  return { formato, fornitore, cliente, fatture };
}
const cent2 = n => Math.round(n * 100) / 100;

// la vista leggibile della fattura ricevuta: HTML semplice, ogni valore passa dall'escape (si mostra in un iframe sandbox)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function vistaHtml(xml, indice = 0, { etichette = {}, lingua = 'it' } = {}) {
  const { fornitore: f, cliente: c, fatture } = leggiFattura(xml), d = fatture[indice] || fatture[0];
  const E = k => esc(etichette[k] || k);
  const eur = x => new Intl.NumberFormat(lingua, { style: 'currency', currency: d.divisa || 'EUR', maximumFractionDigits: 8 }).format(x);
  const dataL = s => (s ? new Date(`${s}T12:00:00`).toLocaleDateString(lingua) : '');
  const sog = (t, s) => `<div class="sog"><small>${E(t)}</small><b>${esc(s.nome)}</b><span>${esc([s.via, [s.cap, s.comune, s.provincia].filter(Boolean).join(' '), s.nazione].filter(Boolean).join(', '))}</span>` +
    `<span>${s.piva ? `${E('piva')} ${esc(s.paese)}${esc(s.piva)}` : ''}${s.codice_fiscale ? ` · ${E('cf')} ${esc(s.codice_fiscale)}` : ''}</span></div>`;
  return `<!doctype html><html lang="${esc(lingua)}"><head><meta charset="utf-8"><style>
body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:24px;background:#fff}h1{font-size:18px;margin:0 0 4px}small{display:block;color:#666;text-transform:uppercase;font-size:10px;letter-spacing:.06em}
.soggetti{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.sog{border:1px solid #ddd;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:2px}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}th{font-size:11px;color:#666;font-weight:600}td.n,th.n{text-align:right;white-space:nowrap}
.tot{margin-left:auto;width:min(320px,100%)}.tot td{border:0;padding:3px 8px}.tot tr:last-child td{font-weight:700;border-top:1px solid #111}
@media print{body{margin:0}}</style></head><body>
<h1>${E('fattura')} ${esc(d.numero)} <small style="display:inline">${esc(d.tipo)}</small></h1><div>${esc(dataL(d.data))}${d.causale ? ` · ${esc(d.causale)}` : ''}</div>
<div class="soggetti">${sog('fornitore', f)}${sog('cliente', c)}</div>
<table><thead><tr><th>${E('descrizione')}</th><th class="n">${E('quantita')}</th><th class="n">${E('prezzo')}</th><th class="n">${E('iva')}</th><th class="n">${E('totale')}</th></tr></thead><tbody>
${d.righe.map(r => `<tr><td>${esc(r.descrizione)}</td><td class="n">${esc(r.quantita)} ${esc(r.unita)}</td><td class="n">${esc(eur(r.prezzo))}</td><td class="n">${r.aliquota ? esc(r.aliquota) + '%' : esc(r.natura || '0%')}</td><td class="n">${esc(eur(r.totale))}</td></tr>`).join('\n')}
</tbody></table>
<table class="tot"><tbody><tr><td>${E('imponibile')}</td><td class="n">${esc(eur(d.imponibile))}</td></tr><tr><td>${E('iva')}</td><td class="n">${esc(eur(d.imposta))}</td></tr>
${d.ritenuta ? `<tr><td>${E('ritenuta')}</td><td class="n">−${esc(eur(d.ritenuta))}</td></tr>` : ''}<tr><td>${E('totale')}</td><td class="n">${esc(eur(d.totale))}</td></tr></tbody></table>
${d.pagamenti.length ? `<table><thead><tr><th>${E('scadenza')}</th><th>${E('modalita')}</th><th>IBAN</th><th class="n">${E('importo')}</th></tr></thead><tbody>${d.pagamenti.map(p => `<tr><td>${esc(dataL(p.scadenza))}</td><td>${esc(p.modalita)}</td><td>${esc(p.iban)}</td><td class="n">${esc(eur(p.importo))}</td></tr>`).join('')}</tbody></table>` : ''}
</body></html>`;
}
