// Un piccolo codificatore di codici QR, senza librerie: modo byte (UTF-8), correzione M (circa il 15%), versioni 1-10
// (fino a 213 byte: un indirizzo come http://192.168.1.20:4380/#/accedi ci sta largo). Serve alla pagina «Collega altri
// dispositivi»: il telefono inquadra e si apre Kubo. Il risultato è una matrice di righe '0'/'1' (1 = modulo scuro),
// senza la cornice bianca (che l'interfaccia aggiunge disegnando).
// Riferimento: ISO/IEC 18004. Nessun file di questa cartella senza «registra»: il server lo salta (vedi api.js).

// per la correzione M: [codici di correzione per blocco, [blocchi, dati per blocco], [blocchi, dati per blocco]?]
const BLOCCHI_M = [null, [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]], [16, [4, 27]], [18, [4, 31]],
  [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
const ALLINEAMENTO = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const VERSIONE_MAX = 10;

// ---------- aritmetica nel campo di Galois GF(256), polinomio 0x11d ----------
const ESP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { ESP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) ESP[i] = ESP[i - 255];
export const per = (a, b) => (a && b ? ESP[LOG[a] + LOG[b]] : 0);

// i codici di correzione di Reed-Solomon di un blocco: il resto della divisione per il polinomio generatore
export function correzione(dati, n) {
  let g = [1];
  for (let i = 0; i < n; i++) { const p = new Array(g.length + 1).fill(0); g.forEach((c, j) => { p[j] ^= c; p[j + 1] ^= per(c, ESP[i]); }); g = p; }
  const r = new Array(n).fill(0);
  for (const d of dati) { const f = d ^ r.shift(); r.push(0); for (let j = 0; j < n; j++) r[j] ^= per(g[j + 1], f); }
  return r;
}

const capacita = v => { const [, ...gr] = BLOCCHI_M[v]; return gr.reduce((s, [b, d]) => s + b * d, 0); };
const bitConteggio = v => (v < 10 ? 8 : 16);

// i byte dei dati (intestazione, lunghezza, testo, riempitivo), poi i blocchi intrecciati con la correzione
function codiciParola(byte, v) {
  const bit = [], metti = (x, n) => { for (let i = n - 1; i >= 0; i--) bit.push((x >>> i) & 1); };
  metti(0b0100, 4); metti(byte.length, bitConteggio(v)); for (const b of byte) metti(b, 8);
  const tot = capacita(v) * 8;
  metti(0, Math.min(4, tot - bit.length)); while (bit.length % 8) bit.push(0);
  const dati = []; for (let i = 0; i < bit.length; i += 8) dati.push(bit.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let i = 0; dati.length < capacita(v); i++) dati.push(i % 2 ? 0x11 : 0xec);
  const [nc, ...gruppi] = BLOCCHI_M[v], blocchi = []; let k = 0;
  for (const [b, d] of gruppi) for (let i = 0; i < b; i++) { const pezzo = dati.slice(k, k + d); k += d; blocchi.push({ dati: pezzo, cor: correzione(pezzo, nc) }); }
  const out = [], lung = Math.max(...blocchi.map(b => b.dati.length));
  for (let i = 0; i < lung; i++) for (const b of blocchi) if (i < b.dati.length) out.push(b.dati[i]);
  for (let i = 0; i < nc; i++) for (const b of blocchi) out.push(b.cor[i]);
  return out;
}

// BCH dei 15 bit di formato (correzione M = 00) e dei 18 bit di versione (dalla 7)
export function bitFormato(maschera) {
  const d = (0b00 << 3) | maschera; let r = d << 10;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return ((d << 10) | r) ^ 0x5412;
}
function bitVersione(v) { let r = v << 12; for (let i = 17; i >= 12; i--) if ((r >>> i) & 1) r ^= 0x1f25 << (i - 12); return (v << 12) | r; }

export const MASCHERE = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

// la griglia con i motivi fissi; «riservato» segna i moduli che non portano dati
export function struttura(v) {
  const n = 17 + 4 * v, m = Array.from({ length: n }, () => new Array(n).fill(0)), ris = Array.from({ length: n }, () => new Array(n).fill(false));
  const metti = (r, c, x) => { if (r >= 0 && c >= 0 && r < n && c < n) { m[r][c] = x ? 1 : 0; ris[r][c] = true; } };
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]])   // i tre quadrati agli angoli, con il margine
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const dentro = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      metti(r0 + r, c0 + c, dentro && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
    }
  for (let i = 8; i < n - 8; i++) { metti(6, i, i % 2 === 0); metti(i, 6, i % 2 === 0); }   // le righe di temporizzazione
  const al = ALLINEAMENTO[v];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al.at(-1)) || (r === al.at(-1) && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) metti(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  for (let i = 0; i < 9; i++) { if (!ris[8][i]) ris[8][i] = true; if (!ris[i][8]) ris[i][8] = true; }   // il formato, scritto dopo
  for (let i = 0; i < 8; i++) { ris[8][n - 1 - i] = true; ris[n - 1 - i][8] = true; }
  metti(n - 8, 8, 1);   // il modulo sempre scuro
  if (v >= 7) { const b = bitVersione(v); for (let i = 0; i < 18; i++) { const x = (b >>> i) & 1, a = Math.floor(i / 3), c = n - 11 + (i % 3); metti(a, c, x); metti(c, a, x); } }
  return { n, m, ris };
}

// l'ordine in cui si leggono i moduli dei dati: colonne a coppie da destra, su e giù a serpente, saltando la colonna 6
export function ordineDati(n, ris) {
  const out = [];
  for (let destra = n - 1, su = true; destra >= 1; destra -= 2, su = !su) {
    if (destra === 6) destra = 5;
    for (let k = 0; k < n; k++) { const r = su ? n - 1 - k : k; for (const c of [destra, destra - 1]) if (!ris[r][c]) out.push([r, c]); }
  }
  return out;
}

export function scriviFormato(m, maschera) {
  const n = m.length, b = bitFormato(maschera), bit = i => (b >>> i) & 1;
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);   // la prima copia attorno al quadrato in alto a sinistra
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);   // la seconda, divisa fra gli altri due quadrati
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
}

// il punteggio di penalità della norma: si sceglie la maschera che lo rende più basso
export function penalita(m) {
  const n = m.length; let p = 0;
  const righe = (f) => { for (let a = 0; a < n; a++) { let x = -1, conta = 0; for (let b = 0; b < n; b++) { const v = f(a, b); if (v === x) conta++; else { if (conta >= 5) p += conta - 2; x = v; conta = 1; } } if (conta >= 5) p += conta - 2; } };
  righe((a, b) => m[a][b]); righe((a, b) => m[b][a]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
  const motivo = [1, 0, 1, 1, 1, 0, 1], cerca = f => { for (let a = 0; a < n; a++) for (let b = 0; b + 6 < n; b++) {
    if (!motivo.every((x, i) => f(a, b + i) === x)) continue;
    const prima = [1, 2, 3, 4].every(i => b - i < 0 || f(a, b - i) === 0), dopo = [1, 2, 3, 4].every(i => b + 6 + i >= n || f(a, b + 6 + i) === 0);
    if (prima || dopo) p += 40; } };
  cerca((a, b) => m[a][b]); cerca((a, b) => m[b][a]);
  const scuri = m.flat().reduce((s, x) => s + x, 0); p += Math.floor(Math.abs(scuri * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

// testo → { versione, maschera, righe: ['0101…', …] }
export function codiceQR(testo, { maschera: scelta = null } = {}) {
  const byte = [...Buffer.from(String(testo), 'utf8')];
  let v = 1; while (v <= VERSIONE_MAX && 4 + bitConteggio(v) + byte.length * 8 > capacita(v) * 8) v++;
  if (v > VERSIONE_MAX) throw new Error('Testo troppo lungo per il codice QR');
  const parole = codiciParola(byte, v), { n, m: base, ris } = struttura(v), posti = ordineDati(n, ris);
  let migliore = null;
  for (let k = 0; k < 8; k++) {
    if (scelta != null && k !== scelta) continue;
    const m = base.map(r => r.slice());
    posti.forEach(([r, c], i) => { const b = i < parole.length * 8 ? (parole[i >> 3] >>> (7 - (i & 7))) & 1 : 0; m[r][c] = b ^ (MASCHERE[k](r, c) ? 1 : 0); });
    scriviFormato(m, k);
    const p = penalita(m);
    if (!migliore || p < migliore.p) migliore = { p, k, m };
  }
  return { versione: v, maschera: migliore.k, righe: migliore.m.map(r => r.join('')) };
}
