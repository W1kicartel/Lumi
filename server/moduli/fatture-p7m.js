// Il contenuto di una fattura firmata (.xml.p7m, busta CAdES = CMS SignedData, RFC 5652) senza librerie: un piccolo
// lettore ASN.1 BER/DER che segue ContentInfo → SignedData → encapContentInfo → eContent e restituisce i byte dell'XML.
// Accetta lunghezze definite e indefinite, l'OCTET STRING spezzato in pezzi (BER) e il file in base64 (come lo danno alcuni
// portali). La firma NON si verifica: Lumi legge la fattura, la validità della firma l'ha già controllata lo SDI.
// Il modulo non registra rotte.

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2', ROTTO = 'Il file .p7m è rovinato o incompleto';

// un elemento: { tag, costruito, inizio (del contenuto), fine, prossimo (dopo l'elemento) }
function elemento(b, pos, fine = b.length) {
  if (pos + 2 > fine) throw new Error(ROTTO);
  const tag = b[pos], costruito = !!(tag & 0x20);
  if ((tag & 0x1f) === 0x1f) throw new Error(ROTTO);
  let p = pos + 1, l = b[p++];
  if (l === 0x80) {   // lunghezza indefinita: i figli fino a 00 00
    if (!costruito) throw new Error(ROTTO);
    let q = p; while (!(b[q] === 0 && b[q + 1] === 0)) { if (q >= fine) throw new Error(ROTTO); q = elemento(b, q, fine).prossimo; }
    return { tag, costruito, inizio: p, fine: q, prossimo: q + 2 };
  }
  if (l & 0x80) {
    const n = l & 0x7f; if (n > 4) throw new Error(ROTTO);
    l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[p++];
  }
  if (p + l > fine) throw new Error(ROTTO);
  return { tag, costruito, inizio: p, fine: p + l, prossimo: p + l };
}
const figli = (b, e) => { const out = []; for (let p = e.inizio; p < e.fine;) { const x = elemento(b, p, e.fine); out.push(x); p = x.prossimo; } return out; };
function oid(b, e) {
  const v = b.subarray(e.inizio, e.fine), parti = [Math.floor(v[0] / 40), v[0] % 40]; let n = 0;
  for (let i = 1; i < v.length; i++) { n = n * 128 + (v[i] & 0x7f); if (!(v[i] & 0x80)) { parti.push(n); n = 0; } }
  return parti.join('.');
}
// un OCTET STRING, anche spezzato in pezzi (forma costruita 0x24, ricorsiva)
const ottetti = (b, e) => (e.costruito ? Buffer.concat(figli(b, e).map(x => ottetti(b, x))) : Buffer.from(b.subarray(e.inizio, e.fine)));

// Buffer del file .p7m → Buffer del documento firmato
export function estraiP7m(dati) {
  let b = Buffer.isBuffer(dati) ? dati : Buffer.from(dati);
  if (b[0] !== 0x30) {   // forse è in base64 (con o senza intestazioni PEM)
    const t = b.toString('latin1').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(t)) throw new Error('Il file non è una fattura firmata (.p7m)');
    b = Buffer.from(t, 'base64');
  }
  if (b[0] !== 0x30) throw new Error('Il file non è una fattura firmata (.p7m)');
  const info = figli(b, elemento(b, 0));
  if (info[0]?.tag !== 0x06 || oid(b, info[0]) !== OID_SIGNED_DATA || info[1]?.tag !== 0xa0) throw new Error('Il file non è una fattura firmata (.p7m)');
  const firmati = figli(b, figli(b, info[1])[0]);   // SignedData: version, digestAlgorithms, encapContentInfo, …
  const incapsulato = firmati.find(x => x.tag === 0x30 && figli(b, x)[0]?.tag === 0x06);
  const contenuto = incapsulato && figli(b, incapsulato)[1];
  if (!contenuto || contenuto.tag !== 0xa0) throw new Error('La firma è «staccata»: il .p7m non contiene la fattura');
  return ottetti(b, figli(b, contenuto)[0]);
}

// per i test: scrive un TLV DER (etichetta, contenuto)
export function der(tag, ...parti) {
  const c = Buffer.concat(parti.map(x => (Buffer.isBuffer(x) ? x : Buffer.from(x)))), l = c.length;
  const lun = l < 128 ? [l] : l < 256 ? [0x81, l] : l < 65536 ? [0x82, l >> 8, l & 255] : [0x83, l >> 16, (l >> 8) & 255, l & 255];
  return Buffer.concat([Buffer.from([tag, ...lun]), c]);
}
export function derOid(s) {
  const p = s.split('.').map(Number), out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) { const v = []; let x = n; do { v.unshift(x & 0x7f); x = Math.floor(x / 128); } while (x); v.forEach((y, i) => out.push(i < v.length - 1 ? y | 0x80 : y)); }
  return der(0x06, Buffer.from(out));
}
