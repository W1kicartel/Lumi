// I formati dei fogli, senza librerie: zip (lettura e scrittura con node:zlib), Excel .xlsx (lettura del primo foglio con
// stringhe condivise e stili delle date, scrittura con intestazione, filtri e formati), CSV (separatore indovinato,
// UTF-8 o Windows-1252), valori all'italiana («1.234,50», «€ 12», «31/12/2026», «sì/no») e tipi indovinati per colonna.
// Nessuna rotta: questo file non esporta registra(), lo usano import.js e i test.
import { inflateRawSync, deflateRawSync, crc32 } from 'node:zlib';

export class ErroreFormato extends Error {}
const LIMITE = 200 * 1024 * 1024;   // nessun file del pacchetto si gonfia oltre 200 MB (bombe zip)

// ---------- zip ----------
export function leggiZip(buf) {
  let fine = -1;   // fine della directory centrale, cercata dalla coda (il commento può arrivare a 64 KB)
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fine = i; break; }
  if (fine < 0) throw new ErroreFormato('Il file non è un .xlsx valido');
  const n = buf.readUInt16LE(fine + 10), voci = new Map(); let p = buf.readUInt32LE(fine + 16);
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ErroreFormato('Il file .xlsx è rovinato');
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32);
    voci.set(buf.toString('utf8', p + 46, p + 46 + ln), { metodo: buf.readUInt16LE(p + 10), compresso: buf.readUInt32LE(p + 20), lungo: buf.readUInt32LE(p + 24), off: buf.readUInt32LE(p + 42) });
    p += 46 + ln + le + lc;
  }
  const leggi = nome => {
    const v = voci.get(nome); if (!v) return null;
    if (v.lungo > LIMITE) throw new ErroreFormato('Il file è troppo grande');
    const da = v.off + 30 + buf.readUInt16LE(v.off + 26) + buf.readUInt16LE(v.off + 28), dati = buf.subarray(da, da + v.compresso);
    if (v.metodo === 0) return dati;
    if (v.metodo === 8) return inflateRawSync(dati, { maxOutputLength: LIMITE });
    throw new ErroreFormato('Compressione dello zip non supportata');
  };
  return { nomi: [...voci.keys()], leggi };
}

// file: [{ nome, dati: Buffer | testo, comprimi? }] → Buffer dello zip
export function scriviZip(file, quando = new Date()) {
  const ora = (quando.getHours() << 11) | (quando.getMinutes() << 5) | (quando.getSeconds() >> 1);
  const giorno = ((quando.getFullYear() - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate();
  const locali = [], centrali = []; let off = 0;
  for (const f of file) {
    const dati = Buffer.isBuffer(f.dati) ? f.dati : Buffer.from(String(f.dati), 'utf8'), nome = Buffer.from(f.nome, 'utf8');
    const metodo = f.comprimi === false ? 0 : 8, comp = metodo ? deflateRawSync(dati) : dati, crc = crc32(dati);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(metodo, 8);
    l.writeUInt16LE(ora, 10); l.writeUInt16LE(giorno, 12); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(dati.length, 22); l.writeUInt16LE(nome.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(metodo, 10);
    c.writeUInt16LE(ora, 12); c.writeUInt16LE(giorno, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dati.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    locali.push(l, nome, comp); centrali.push(c, nome); off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrali), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(file.length, 8); e.writeUInt16LE(file.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locali, cd, e]);
}

// ---------- un XML piccolo: quanto basta per i pezzi di un .xlsx ----------
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const deXml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m)
  .replace(/_x([0-9A-Fa-f]{4})_/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
export const xml = s => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const attributi = s => { const o = {}; for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] = deXml(m[2] ?? m[3]); return o; };
const tag = n => `(?:[\\w-]+:)?${n}`;   // alcuni programmi scrivono <x:row>, <x:c>…
const testiDi = s => [...s.replace(new RegExp(`<${tag('rPh')}\\b[\\s\\S]*?</${tag('rPh')}>`, 'g'), '').matchAll(new RegExp(`<${tag('t')}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag('t')}>`, 'g'))].map(m => deXml(m[1])).join('');

// i formati numerici che sono date: quelli predefiniti di Excel e quelli propri con d, m, y, h, s fuori dalle virgolette
function stiliData(stili) {
  const propri = new Map([...stili.matchAll(new RegExp(`<${tag('numFmt')}\\b([^>]*)/?>`, 'g'))].map(m => attributi(m[1])).map(a => [Number(a.numFmtId), a.formatCode || '']));
  const eData = id => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)
    || (propri.has(id) && /[dmyhs]/i.test(propri.get(id).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')));
  const xf = new RegExp(`<${tag('cellXfs')}\\b[^>]*>([\\s\\S]*?)</${tag('cellXfs')}>`).exec(stili)?.[1] || '';
  const out = new Set();
  [...xf.matchAll(new RegExp(`<${tag('xf')}\\b([^>]*?)(?:/>|>)`, 'g'))].forEach((m, i) => { if (eData(Number(attributi(m[1]).numFmtId || 0))) out.add(i); });
  return out;
}
const due = n => String(n).padStart(2, '0');
export function daSeriale(n, d1904 = false) {
  const d = new Date(Math.round((n - (d1904 ? 24107 : 25569)) * 864e5));
  if (n < 1 && n > 0) return `${due(d.getUTCHours())}:${due(d.getUTCMinutes())}`;
  const giorno = `${d.getUTCFullYear()}-${due(d.getUTCMonth() + 1)}-${due(d.getUTCDate())}`;
  return Math.abs(n % 1) < 1e-9 ? giorno : `${giorno}T${due(d.getUTCHours())}:${due(d.getUTCMinutes())}:${due(d.getUTCSeconds())}`;
}
export const aSeriale = iso => { const [d, t = '00:00:00'] = String(iso).split('T'); const [h, m, s] = t.split(':').map(Number); return Date.UTC(...d.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) / 864e5 + 25569 + ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) / 86400; };
const indiceColonna = ref => { let n = 0; for (const c of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

// il primo foglio (nell'ordine della cartella di lavoro) come matrice di valori: testi, numeri, booleani, date ISO
export function leggiXlsx(buf, { maxRighe = 100000 } = {}) {
  const z = leggiZip(buf), testo = n => z.leggi(n)?.toString('utf8') ?? null;
  const wb = testo('xl/workbook.xml') || '', d1904 = /date1904\s*=\s*"(1|true)"/i.test(wb);
  const primo = [...wb.matchAll(new RegExp(`<${tag('sheet')}\\b([^>]*)/?>`, 'g'))].map(m => attributi(m[1]))[0];
  const rel = Object.fromEntries([...(testo('xl/_rels/workbook.xml.rels') || '').matchAll(/<(?:[\w-]+:)?Relationship\b([^>]*)\/?>/g)].map(m => attributi(m[1])).map(a => [a.Id, a.Target]));
  let percorso = null;
  if (primo) { const t = rel[Object.entries(primo).find(([k]) => /(^|:)id$/.test(k) && k !== 'sheetId')?.[1]]; if (t) percorso = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
  if (!percorso || !z.nomi.includes(percorso)) percorso = z.nomi.find(n => n === 'xl/worksheets/sheet1.xml') || z.nomi.find(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (!percorso) throw new ErroreFormato('Nel file non c\'è nessun foglio');
  const condivise = [...(testo('xl/sharedStrings.xml') || '').matchAll(new RegExp(`<${tag('si')}>([\\s\\S]*?)</${tag('si')}>`, 'g'))].map(m => testiDi(m[1]));
  const date = stiliData(testo('xl/styles.xml') || ''), righe = [];
  const reRiga = new RegExp(`<${tag('row')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('row')}>)`, 'g'), reCella = new RegExp(`<${tag('c')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('c')}>)`, 'g'), reV = new RegExp(`<${tag('v')}>([\\s\\S]*?)</${tag('v')}>`);
  for (const mr of testo(percorso).matchAll(reRiga)) {
    const ar = attributi(mr[1]), ir = ar.r ? Number(ar.r) - 1 : righe.length;
    if (ir >= maxRighe + 1) throw new ErroreFormato(`Il foglio ha più di ${maxRighe} righe: dividilo in più file`);
    const riga = []; let col = 0;
    for (const mc of (mr[2] || '').matchAll(reCella)) {
      const a = attributi(mc[1]), dentro = mc[2] || '', v = reV.exec(dentro)?.[1];
      if (a.r) col = indiceColonna(a.r);
      if (col > 500) break;
      let x = null;
      switch (a.t) {
        case 's': x = v != null ? condivise[Number(v)] ?? '' : ''; break;
        case 'inlineStr': x = testiDi(dentro); break;
        case 'str': case 'd': x = v != null ? deXml(v) : ''; break;
        case 'b': x = v === '1'; break;
        case 'e': x = null; break;
        default: if (v != null && v !== '') { const n = Number(v); x = date.has(Number(a.s || 0)) && Number.isFinite(n) ? daSeriale(n, d1904) : n; }
      }
      riga[col++] = x;
    }
    righe[ir] = Array.from(riga, x => x ?? null);
  }
  return Array.from(righe, r => r || []);
}

// ---------- CSV ----------
export function decodifica(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}
export function indovinaSeparatore(testo) {
  const conta = { ';': 0, ',': 0, '\t': 0, '|': 0 }; let dentro = false, righe = 0;
  for (let i = 0; i < Math.min(testo.length, 20000) && righe < 5; i++) {
    const c = testo[i];
    if (c === '"') dentro = !dentro; else if (!dentro && c in conta) conta[c]++; else if (!dentro && c === '\n') righe++;
  }
  const [primo, quanti] = Object.entries(conta).sort((a, b) => b[1] - a[1] || (a[0] === ';' ? -1 : b[0] === ';' ? 1 : 0))[0];
  return quanti ? primo : ',';
}
export function leggiCsv(testo, sep = indovinaSeparatore(testo)) {
  const righe = []; let riga = [], campo = '', virg = false, quotato = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virg) { if (c === '"') { if (testo[i + 1] === '"') { campo += '"'; i++; } else virg = false; } else campo += c; continue; }
    if (c === '"' && campo === '' && !quotato) { virg = quotato = true; }
    else if (c === sep) { riga.push(quotato ? campo : campo.trim()); campo = ''; quotato = false; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && testo[i + 1] === '\n') i++; riga.push(quotato ? campo : campo.trim()); righe.push(riga); riga = []; campo = ''; quotato = false; }
    else campo += c;
  }
  if (campo !== '' || riga.length || quotato) { riga.push(campo); righe.push(riga); }
  return righe;
}

// un file (xlsx o csv) → { intestazioni, righe } con le righe vuote tolte e i nomi delle colonne unici
export function leggiTabella(buf, nome = '') {
  let m;
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) m = leggiXlsx(buf);
  else if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) throw new ErroreFormato('Il vecchio formato .xls non si legge: in Excel fai «Salva con nome» → .xlsx o .csv');
  else if (/\.(pdf|docx?|odt|ods|numbers)$/i.test(nome)) throw new ErroreFormato('Serve un foglio .xlsx o .csv');
  else m = leggiCsv(decodifica(buf)).map(r => r.map(x => (/^'[=+\-@]/.test(x) ? x.slice(1) : x)));   // l'apostrofo messo da scriviCsv
  const vuota = r => !r || r.every(x => x == null || String(x).trim() === '');
  m = m.filter(r => !vuota(r));
  if (!m.length) throw new ErroreFormato('Il file è vuoto');
  const larghezza = Math.min(500, Math.max(...m.map(r => r.length)));
  const visti = new Map();
  const intestazioni = Array.from({ length: larghezza }, (_, i) => {
    let t = String(m[0][i] ?? '').trim().replace(/\s+/g, ' ') || `Colonna ${i + 1}`;
    const n = (visti.get(t.toLowerCase()) || 0) + 1; visti.set(t.toLowerCase(), n); if (n > 1) t += ` (${n})`;
    return t;
  });
  const righe = m.slice(1).map(r => Array.from({ length: larghezza }, (_, i) => { const x = r[i]; return typeof x === 'string' ? x.trim() : x ?? null; }));
  return { intestazioni, righe };
}

export function scriviCsv(intestazioni, righe) {
  const cella = v => {
    let s;
    if (v == null) s = '';
    else if (typeof v === 'number') s = String(v).replace('.', ',');
    else if (typeof v === 'boolean') s = v ? 'Sì' : 'No';
    else if (v.euro != null) s = v.euro.toFixed(2).replace('.', ',');
    else if (v.data) s = v.data.split('-').reverse().join('/');
    else if (v.dataOra) { const d = new Date(v.dataOra); s = `${due(d.getDate())}/${due(d.getMonth() + 1)}/${d.getFullYear()} ${due(d.getHours())}:${due(d.getMinutes())}`; }
    else { s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; }   // niente formule nascoste per Excel
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [intestazioni, ...righe].map(r => r.map(cella).join(';')).join('\r\n') + '\r\n';
}

// ---------- scrivere un .xlsx ----------
const lettera = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const STILI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
// valori: numero, booleano, testo, { euro }, { data: 'AAAA-MM-GG' }, { dataOra: ISO }
export function scriviXlsx(intestazioni, righe, { foglio = 'Dati' } = {}) {
  const cella = (v, ref) => {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : '';
    if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"><is><t>${v ? 'Sì' : 'No'}</t></is></c>`;
    if (v.euro != null) return `<c r="${ref}" s="2"><v>${v.euro}</v></c>`;
    if (v.data) return `<c r="${ref}" s="3"><v>${aSeriale(v.data)}</v></c>`;
    if (v.dataOra) { const d = new Date(v.dataOra); return `<c r="${ref}" s="4"><v>${aSeriale(`${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}T${due(d.getHours())}:${due(d.getMinutes())}:00`)}</v></c>`; }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const larg = intestazioni.map((t, i) => Math.min(50, Math.max(8, String(t).length + 2, ...righe.slice(0, 200).map(r => { const v = r[i]; return v == null ? 0 : typeof v === 'object' ? 12 : String(v).length + 1; }))));
  const corpo = [intestazioni.map((t, i) => `<c r="${lettera(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`).join('')]
    .concat(righe.map((r, j) => r.map((v, i) => cella(v, lettera(i) + (j + 2))).join(''))).map((c, j) => `<row r="${j + 1}">${c}</row>`).join('');
  const ultima = `${lettera(Math.max(0, intestazioni.length - 1))}${righe.length + 1}`;
  const nome = xml(String(foglio).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Dati');
  const xmlns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const T = 'application/vnd.openxmlformats-officedocument.spreadsheetml', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return scriviZip([
    { nome: '[Content_Types].xml', dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${T}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${T}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${T}.styles+xml"/></Types>` },
    { nome: '_rels/.rels', dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nome: 'xl/workbook.xml', dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${xmlns}><sheets><sheet name="${nome}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { nome: 'xl/styles.xml', dati: STILI },
    { nome: 'xl/worksheets/sheet1.xml', dati: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${xmlns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${corpo}</sheetData>${righe.length ? `<autoFilter ref="A1:${ultima}"/>` : ''}</worksheet>` },
  ]);
}

// ---------- valori all'italiana ----------
export function numeroIt(x) {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean' || x == null) return NaN;
  let t = String(x).trim().replace(/[\s '€]|eur(o)?/gi, '').replace(/%$/, ''), neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (!t) return NaN;
  const v = t.lastIndexOf(','), p = t.lastIndexOf('.');
  if (v >= 0 && p >= 0) t = v > p ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (v >= 0) t = (t.match(/,/g).length > 1) ? t.replace(/,/g, '') : t.replace(',', '.');
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');   // «1.234» in Italia è milleduecentotrentaquattro
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return neg ? -Number(t) : Number(t);
}
const valida = (a, m, g) => { const d = new Date(Date.UTC(a, m - 1, g)); return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === g; };
const anno = a => (a.length === 2 ? (Number(a) < 70 ? 2000 : 1900) + Number(a) : Number(a));
// «31/12/2026», «31-12-26», «31.12.2026», «2026-12-31» → '2026-12-31'; con l'ora → { data, ora }
export function dataIt(x) {
  if (x == null || typeof x === 'boolean') return null;
  if (typeof x === 'number') return x > 0 && x < 2958466 ? { data: daSeriale(Math.floor(x)), ora: x % 1 ? daSeriale(x).slice(11, 16) : null } : null;
  const s = String(x).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2})[:.](\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) { const [a, me, g] = [Number(m[1]), Number(m[2]), Number(m[3])]; if (!valida(a, me, g)) return null; return { data: `${a}-${due(me)}-${due(g)}`, ora: m[4] != null ? `${due(m[4])}:${m[5]}` : null, iso: m[7] ? s : null }; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[\s,]+(?:ore\s+)?(\d{1,2})[:.](\d{2})(?::\d{2})?)?$/i.exec(s);
  if (m) { const [g, me, a] = [Number(m[1]), Number(m[2]), anno(m[3])]; if (!valida(a, me, g)) return null; return { data: `${a}-${due(me)}-${due(g)}`, ora: m[4] != null ? `${due(m[4])}:${m[5]}` : null }; }
  return null;
}
const piano = s => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const SI = new Set(['si', 's', 'yes', 'y', 'vero', 'true', 'x', '1', 'ok', '✓', '✔']), NO = new Set(['no', 'n', 'falso', 'false', '0', '-', '']);
export function siNo(x) { if (typeof x === 'boolean') return x; if (typeof x === 'number') return x !== 0; const p = piano(x); return SI.has(p) ? true : NO.has(p) ? false : undefined; }

// ---------- tipi indovinati e abbinamento delle colonne ----------
export const slug = s => piano(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40) || 'campo';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function indovinaTipo(nome, valori) {
  const v = valori.filter(x => x != null && String(x).trim() !== '').slice(0, 2000), n = piano(nome);
  if (!v.length) return { tipo: 'testo' };
  const tutti = f => v.every(f);
  if (/(^|\s)(tel|cell|telefono|cellulare|phone|mobile|fax)/.test(n) && tutti(x => /^[+\d\s()./-]{5,}$/.test(String(x)))) return { tipo: 'telefono' };
  if (tutti(x => typeof x === 'string' && EMAIL.test(x))) return { tipo: 'email' };
  if (tutti(x => typeof x === 'string' && /^https?:\/\/\S+$/i.test(x))) return { tipo: 'url' };
  if (tutti(x => typeof x !== 'number' && siNo(x) !== undefined) && !tutti(x => /^-?\d+$/.test(String(x)))) return { tipo: 'si_no' };
  if (tutti(x => typeof x === 'string' && dataIt(x))) return { tipo: v.some(x => dataIt(x).ora && dataIt(x).ora !== '00:00') ? 'data_ora' : 'data' };
  const codice = x => typeof x === 'string' && /^\d+$/.test(x.replace(/\s/g, '')) && (/^0\d/.test(x) || x.length >= 7);   // CAP, P.IVA, codici: restano testo
  if (tutti(x => Number.isFinite(numeroIt(x)) && !codice(x)) && !/(^|\s)(cap|codice|cod|p ?iva|partita|piva|sku|ean|barcode)(\s|$)/.test(n)) {
    if (/prezz|importo|totale|cost|euro|imponibile|incasso|saldo|valore|listino|€/.test(n) || v.some(x => /€|eur/i.test(String(x)))) return { tipo: 'valuta' };
    if (/%/.test(n) || v.some(x => /%$/.test(String(x)))) return { tipo: 'percentuale' };
    return { tipo: 'numero' };
  }
  if (v.some(x => String(x).length > 120 || /\n/.test(String(x)))) return { tipo: 'testo_lungo' };
  const distinti = [...new Set(v.map(x => String(x).trim()))];
  if (distinti.length >= 2 && distinti.length <= 8 && v.length >= distinti.length * 3 && distinti.every(x => x.length <= 30)) {
    const ids = new Set();
    return { tipo: 'scelta', opzioni: distinti.map(x => { let id = slug(x); while (ids.has(id)) id += '_'; ids.add(id); return { id, nome: x, colore: 'grigio' }; }) };
  }
  return { tipo: 'testo' };
}

const SINONIMI = { email: ['e mail', 'mail', 'posta elettronica', 'indirizzo email'], telefono: ['tel', 'cell', 'cellulare', 'phone', 'mobile', 'numero di telefono'],
  nome: ['ragione sociale', 'denominazione', 'nominativo', 'name', 'cliente', 'nome e cognome', 'descrizione'], indirizzo: ['via', 'address', 'sede'], prezzo: ['prezzo di vendita', 'price', 'listino', 'prezzo unitario'],
  note: ['annotazioni', 'commenti', 'notes', 'osservazioni'], codice: ['cod', 'sku', 'codice articolo', 'code', 'articolo'], giacenza: ['quantita', 'qta', 'q ta', 'disponibilita', 'stock'] };
const norma = s => piano(s).replace(/[^a-z0-9]+/g, ' ').trim();
function distanza(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const q = [i]; for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; }
  return p[b.length];
}
export function punteggio(intestazione, campo) {
  const a = norma(intestazione), n = norma(campo.nome), i = norma(campo.id.replace(/_/g, ' '));
  if (!a) return 0;
  if (a === n || a === i) return 100;
  if (a.replace(/ /g, '') === n.replace(/ /g, '')) return 95;
  if ((SINONIMI[campo.id] || []).includes(a)) return 90;
  if (Math.min(a.length, n.length) >= 4 && (a.startsWith(n) || n.startsWith(a))) return 70;
  if (n.length >= 4 && distanza(a, n) <= Math.max(1, Math.floor(n.length / 5))) return 60;
  return 0;
}
// { intestazione: idCampo | null }, ogni campo al massimo una volta, prima gli abbinamenti più sicuri
export function proponiAbbinamento(intestazioni, campi) {
  const coppie = [];
  for (const t of intestazioni) for (const c of campi) { const p = punteggio(t, c); if (p >= 60) coppie.push({ t, c: c.id, p }); }
  coppie.sort((x, y) => y.p - x.p);
  const out = Object.fromEntries(intestazioni.map(t => [t, null])), presi = new Set();
  for (const x of coppie) if (out[x.t] == null && !presi.has(x.c)) { out[x.t] = x.c; presi.add(x.c); }
  return out;
}
