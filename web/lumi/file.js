// File trascinati nel pannello. PDF e foto vanno a Claude così come sono (caricati una volta con la Files API, poi citati
// per id); fogli Excel, documenti Word, CSV, XML e testi diventano testo qui, senza librerie: xlsx e docx sono archivi
// zip di XML, che si aprono con DecompressionStream e si leggono con poche espressioni regolari (niente DOMParser, così
// le stesse funzioni girano anche in node, nelle prove).

export const MAX_MB = 10;
const MAX_TESTO = 180000;
const IMMAGINI = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const TESTO = /\.(txt|csv|tsv|json|xml|md|markdown|html?|log|eml|ics|vcf)$/i;
const est = n => (String(n).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

export class ErroreFile extends Error {}

// → { nome, dimensione, modo: 'carica', blob, tipo } | { nome, dimensione, modo: 'testo', testo, descrizione }
// lancia ErroreFile con un messaggio leggibile (in italiano o inglese, secondo `lingua`)
export async function leggiFile(f, { lingua = 'it', riduciImmagine = riduci } = {}) {
  const M = MSG[lingua] || MSG.it;
  const nome = f.name || 'file', e = est(nome), mb = f.size / 1048576;
  if (IMMAGINI.includes(f.type) || /^(jpe?g|png|webp|gif)$/.test(e)) {
    // ridotta a 1568 px sul lato lungo: meno peso, stessa leggibilità per il modello
    const blob = f.type === 'image/gif' ? f : await riduciImmagine(f, 1568).catch(() => f);
    if (blob.size > MAX_MB * 1048576) throw new ErroreFile(M.immagine);
    return { nome, dimensione: f.size, modo: 'carica', blob, tipo: blob.type || f.type || 'image/jpeg', icona: 'foto' };
  }
  if (f.type === 'application/pdf' || e === 'pdf') {
    if (mb > MAX_MB) throw new ErroreFile(M.pdf);
    return { nome, dimensione: f.size, modo: 'carica', blob: f, tipo: 'application/pdf', icona: 'pdf' };
  }
  if (mb > 25) throw new ErroreFile(M.grande);
  if (e === 'xlsx' || e === 'xlsm') return { nome, dimensione: f.size, modo: 'testo', testo: taglia(await daExcel(f, M)), descrizione: M.dExcel, icona: 'foglio' };
  if (e === 'docx') return { nome, dimensione: f.size, modo: 'testo', testo: taglia(await daWord(f, M)), descrizione: M.dWord, icona: 'doc' };
  if (TESTO.test(nome) || /^text\//.test(f.type) || f.type === 'application/json' || f.type === 'application/xml') {
    return { nome, dimensione: f.size, modo: 'testo', testo: taglia(await f.text()), descrizione: e === 'xml' ? M.dXml : e === 'csv' || e === 'tsv' ? M.dCsv : M.dTesto, icona: e === 'csv' || e === 'tsv' ? 'foglio' : 'doc' };
  }
  if (['xls', 'doc', 'numbers', 'pages', 'key', 'ppt', 'pptx', 'heic', 'heif'].includes(e)) throw new ErroreFile(M.formatoVecchio.replace('{e}', e));
  throw new ErroreFile(M.formato.replace('{e}', e ? '.' + e : ''));
}
const MSG = {
  it: { immagine: `immagine troppo grande (massimo ${MAX_MB} MB)`, pdf: `PDF troppo grande (massimo ${MAX_MB} MB)`, grande: 'file troppo grande',
    dExcel: 'foglio Excel convertito in CSV', dWord: 'documento Word convertito in testo', dXml: 'file XML', dCsv: 'tabella CSV', dTesto: 'file di testo',
    formatoVecchio: 'il formato .{e} non si legge qui: salvalo come PDF, .xlsx o .docx', formato: 'il formato {e} non si legge',
    zip: 'file danneggiato o non è un documento Office', compressione: 'compressione non supportata', vuoto: 'il file è vuoto', word: 'documento Word non leggibile' },
  en: { immagine: `image too large (up to ${MAX_MB} MB)`, pdf: `PDF too large (up to ${MAX_MB} MB)`, grande: 'file too large',
    dExcel: 'Excel sheet converted to CSV', dWord: 'Word document converted to text', dXml: 'XML file', dCsv: 'CSV table', dTesto: 'text file',
    formatoVecchio: 'the .{e} format can\'t be read here: save it as PDF, .xlsx or .docx', formato: 'the {e} format can\'t be read',
    zip: 'damaged file, or not an Office document', compressione: 'unsupported compression', vuoto: 'the file is empty', word: 'unreadable Word document' },
};
function taglia(t) {
  t = String(t || '').replace(/\r\n/g, '\n');
  return t.length > MAX_TESTO ? t.slice(0, MAX_TESTO) + `\n[… ${MAX_TESTO} / ${t.length}]` : t;
}
export async function base64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
// riduce una foto nel browser (canvas); senza canvas (node) la lascia com'è
async function riduci(f, lato) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return f;
  const img = await createImageBitmap(f), k = Math.min(1, lato / Math.max(img.width, img.height));
  if (k >= 1 && f.size < 3 * 1048576) return f;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, ko) => c.toBlob(b => (b ? ok(b) : ko(new Error('canvas'))), 'image/jpeg', 0.86));
}

/* ---------- zip: directory centrale, voci memorizzate (0) o compresse con deflate (8) ---------- */
export async function apriZip(file, M = MSG.it) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fine = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fine = i; break; }
  if (fine < 0) throw new ErroreFile(M.zip);
  const n = dv.getUint16(fine + 10, true); let p = dv.getUint32(fine + 16, true);
  const voci = new Map(), dec = new TextDecoder();
  for (let k = 0; k < n && p + 46 <= buf.length && dv.getUint32(p, true) === 0x02014b50; k++) {
    const metodo = dv.getUint16(p + 10, true), dim = dv.getUint32(p + 20, true), ln = dv.getUint16(p + 28, true), lx = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    voci.set(dec.decode(buf.subarray(p + 46, p + 46 + ln)), { metodo, dim, loc });
    p += 46 + ln + lx + lc;
  }
  return async nome => {
    const v = voci.get(nome); if (!v) return null;
    const ini = v.loc + 30 + dv.getUint16(v.loc + 26, true) + dv.getUint16(v.loc + 28, true), dati = buf.subarray(ini, ini + v.dim);
    if (v.metodo === 0) return dec.decode(dati);
    if (v.metodo !== 8) throw new ErroreFile(M.compressione);
    return new Response(new Blob([dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

/* ---------- XML senza DOMParser: quanto basta per i file di Office ---------- */
const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
export const decodifica = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITA[e] ?? m);
// gli elementi <pref:tag …>…</pref:tag> (o vuoti <tag …/>), con prefisso qualsiasi: [{ attr, dentro }]
function elementi(xml, tag) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>)`, 'g'), out = [];
  for (const m of xml.matchAll(re)) out.push({ attr: attributi(m[1] || ''), dentro: m[2] ?? '' });
  return out;
}
function attributi(s) { const o = {}; for (const m of s.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[m[1]] = decodifica(m[3] ?? m[4]); return o; }
const testi = xml => elementi(xml, 't').map(x => decodifica(x.dentro.replace(/<[^>]+>/g, ''))).join('');

/* ---------- Excel: un CSV per foglio, con le date riconosciute dallo stile delle celle ---------- */
async function daExcel(f, M) {
  const leggi = await apriZip(f, M);
  const ss = await leggi('xl/sharedStrings.xml');
  const condivisi = ss ? elementi(ss, 'si').map(si => testi(si.dentro)) : [];
  const wb = await leggi('xl/workbook.xml') || '', rels = await leggi('xl/_rels/workbook.xml.rels') || '';
  const dest = new Map(elementi(rels, 'Relationship').map(r => [r.attr.Id, r.attr.Target]));
  const fogli = elementi(wb, 'sheet').map(s => ({ nome: s.attr.name, file: 'xl/' + String(dest.get(s.attr['r:id']) || '').replace(/^\/?xl\//, '') }));
  const date = await stiliData(leggi);
  const out = [];
  for (const fg of fogli.slice(0, 12)) {
    const s = await leggi(fg.file); if (!s) continue;
    const righe = [];
    for (const r of elementi(s, 'row').slice(0, 5000)) {
      const celle = []; let prossima = 0;
      for (const c of elementi(r.dentro, 'c')) {
        // l'attributo r (es. «B3») è facoltativo: senza, la cella è quella dopo la precedente
        const col = c.attr.r ? colonna(c.attr.r) : prossima; prossima = col + 1;
        const t = c.attr.t, v = decodifica(elementi(c.dentro, 'v')[0]?.dentro ?? '');
        let x = t === 's' ? condivisi[+v] ?? '' : t === 'inlineStr' ? testi(c.dentro) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
        const tipo = date.get(+c.attr.s);
        if ((!t || t === 'n') && v !== '' && tipo) x = daSeriale(+v, tipo);
        celle[col] = x;
      }
      if (celle.some(x => String(x ?? '').trim())) righe.push(Array.from(celle, x => csv(x ?? '')).join(','));
    }
    if (righe.length) out.push(`# ${fg.nome} (${righe.length})\n${righe.join('\n')}`);
  }
  if (!out.length) throw new ErroreFile(M.vuoto);
  return out.join('\n\n');
}
function colonna(r) { let n = 0; for (const ch of String(r || 'A').replace(/\d+/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return Math.max(0, n - 1); }
const csv = x => { const s = String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
// numero di serie di Excel → «AAAA-MM-GG», «HH:MM» o «AAAA-MM-GG HH:MM» secondo il formato della cella
export function daSeriale(n, tipo = 'data') {
  const d = new Date(Math.round((n - 25569) * 864e5)); if (isNaN(d)) return String(n);
  const giorno = d.toISOString().slice(0, 10), ora = d.toISOString().slice(11, 16);
  return tipo === 'ora' ? ora : tipo === 'dataora' ? `${giorno} ${ora}` : giorno;
}
// stile della cella → 'data' | 'ora' | 'dataora' (formati predefiniti 14-17 date, 18-21 e 45-47 ore, 22 data e ora)
async function stiliData(leggi) {
  const s = await leggi('xl/styles.xml'); const out = new Map(); if (!s) return out;
  const propri = new Map(elementi(s, 'numFmt').map(n => [+n.attr.numFmtId, n.attr.formatCode || '']));
  const tipo = id => {
    if (id >= 14 && id <= 17) return 'data';
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return 'ora';
    if (id === 22) return 'dataora';
    const f = (propri.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    const g = /[dy]/i.test(f), o = /[hs]/i.test(f);
    return g && o ? 'dataora' : g ? 'data' : o ? 'ora' : null;
  };
  const xfs = elementi(s, 'cellXfs')[0]; if (!xfs) return out;
  elementi(xfs.dentro, 'xf').forEach((x, i) => { const k = tipo(+x.attr.numFmtId); if (k) out.set(i, k); });
  return out;
}

/* ---------- Word: paragrafi (le celle delle tabelle sono paragrafi anche loro) ---------- */
async function daWord(f, M) {
  const leggi = await apriZip(f, M), s = await leggi('word/document.xml');
  if (!s) throw new ErroreFile(M.word);
  const righe = elementi(s, 'p').map(p => testi(p.dentro)).filter(t => t.trim());
  if (!righe.length) throw new ErroreFile(M.vuoto);
  return righe.join('\n');
}
