// La rete locale: gli indirizzi a cui gli altri PC e i telefoni trovano questo Lumi, e il «codice» da dettare a voce
// (es. «R8M0-0A1C-4W»): l'indirizzo IPv4 e la porta in 10 lettere e cifre (base 32 senza I, L, O, U, che si confondono).
// L'app desktop, in «Collegati a Lumi in rete», accetta il codice oppure un indirizzo scritto come capita.
import { networkInterfaces } from 'node:os';

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// gli IPv4 di questo computer nella rete locale (prima quelli delle reti di casa e ufficio: 192.168…, 10…, 172.16-31…)
export function indirizziLocali(interfacce = networkInterfaces()) {
  const privato = a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return Object.values(interfacce).flat().filter(l => l && (l.family === 'IPv4' || l.family === 4) && !l.internal && !/^169\.254\./.test(l.address))
    .map(l => l.address).sort((a, b) => privato(b) - privato(a));
}

export function codiceDa(ip, porta) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('Indirizzo IPv4 non valido');
  let n = 0n; for (const x of [...p, (porta >> 8) & 255, porta & 255]) n = (n << 8n) | BigInt(x);
  let s = ''; for (let i = 0; i < 10; i++) { s = B32[Number(n & 31n)] + s; n >>= 5n; }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export function daCodice(codice) {
  const s = String(codice).toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(s)) return null;
  let n = 0n; for (const c of s) n = (n << 5n) | BigInt(B32.indexOf(c));
  if (n >> 48n) return null;
  const b = []; for (let i = 0; i < 6; i++) { b.unshift(Number(n & 255n)); n >>= 8n; }
  return { ip: b.slice(0, 4).join('.'), porta: (b[4] << 8) | b[5] };
}

// quello che la persona scrive («192.168.1.20», «ufficio.local:4380», «https://lumi.miazienda.it», un codice) → un URL pulito
export function indirizzoDa(testo, portaPredefinita = 4380) {
  const t = String(testo || '').trim(); if (!t) throw new Error('Scrivi un indirizzo o un codice');
  const c = daCodice(t); if (c && !/[.:/]/.test(t)) return `http://${c.ip}:${c.porta}`;
  let u; try { u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `http://${t}`); } catch { throw new Error('Indirizzo non valido'); }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password) throw new Error('Indirizzo non valido');
  if (!u.port && u.protocol === 'http:' && !/:\d+$/.test(u.host)) u.port = String(portaPredefinita);
  return u.origin;
}
