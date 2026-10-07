// Le richieste che Kubo fa verso fuori (i webhook): mai verso la rete interna, a meno di un'opzione esplicita.
// Un webhook verso 127.0.0.1, 192.168.x.x, 169.254.169.254 (i metadati dei cloud) o un nome che si risolve lì
// trasformerebbe Kubo in un ponte per raggiungere i servizi dell'ufficio (SSRF). Il controllo si fa sull'indirizzo vero
// a cui ci si collega (nella «lookup» della connessione), così un DNS che cambia risposta fra il controllo e l'invio
// (DNS rebinding) non passa. Opzione: impostazione «sicurezza.webhook_interni» = 1 o variabile KUBO_WEBHOOK_INTERNI=1.
import { request as richiestaHttp } from 'node:http';
import { request as richiestaHttps } from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';

// gli indirizzi che non sono «internet pubblico»
export function interno(ip) {
  let a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a); if (m) a = m[1];   // IPv4 dentro IPv6
  if (isIP(a) === 4) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
  }
  if (isIP(a) === 6) {
    // gli 8 gruppi per intero (l'URL scrive [::ffff:127.0.0.1] come [::ffff:7f00:1], che porta comunque a 127.0.0.1)
    let h; try { h = new URL(`http://[${a}]/`).hostname; } catch { return true; }   // con la zona (fe80::1%en0): rete locale
    const [s, d] = h.slice(1, -1).split('::'), sx = s ? s.split(':') : [], dx = d ? d.split(':') : [];
    const g = [...sx, ...Array(8 - sx.length - dx.length).fill('0'), ...dx].map(x => parseInt(x, 16) || 0);
    if (g.slice(0, 7).every(x => x === 0) && g[7] <= 1) return true;   // :: e ::1
    if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xffff || g[5] === 0)) return interno(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);   // IPv4 dentro IPv6
    const p = g[0];
    return (p & 0xfe00) === 0xfc00 || (p & 0xffc0) === 0xfe80 || (p & 0xff00) === 0xff00 || (p === 0x64 && g[1] === 0xff9b) || (p === 0x2001 && g[1] === 0xdb8);
  }
  return true;   // non è un indirizzo: meglio no
}
const NOMI_INTERNI = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.intranet|metadata\.google\.internal)$/i;

// controllo al salvataggio: l'indirizzo scritto (nome o numero). I nomi si controllano davvero all'invio.
export function controllaUrl(url, { interni = false } = {}) {
  let u; try { u = new URL(String(url)); } catch { return 'Indirizzo non valido'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'L\'indirizzo deve iniziare con http:// o https://';
  if (u.username || u.password) return 'Niente nome e password dentro l\'indirizzo: usa la firma del webhook';
  if (interni) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? interno(host) : NOMI_INTERNI.test(host) || !host.includes('.'))
    return 'L\'indirizzo è nella rete interna: per sicurezza i webhook vanno solo verso internet (il titolare può permetterlo in Sicurezza)';
  return null;
}

// una POST con il controllo sull'indirizzo a cui ci si collega davvero. → { status, testo }
export function invia(url, { metodo = 'POST', intestazioni = {}, corpo = '', ms = 10000, interni = false } = {}) {
  return new Promise((ok, ko) => {
    const no = controllaUrl(url, { interni }); if (no) { ko(Object.assign(new Error(no), { code: 'INDIRIZZO_INTERNO' })); return; }
    const u = new URL(url), f = u.protocol === 'https:' ? richiestaHttps : richiestaHttp;
    const cerca = (host, opz, cb) => lookup(host, { ...opz, all: true }, (e, lista) => {
      if (e) return cb(e);
      const l = (Array.isArray(lista) ? lista : [{ address: lista, family: opz.family }]).filter(x => interni || !interno(x.address));
      if (!l.length) return cb(Object.assign(new Error('L\'indirizzo porta alla rete interna'), { code: 'INDIRIZZO_INTERNO' }));
      return opz.all ? cb(null, l) : cb(null, l[0].address, l[0].family);
    });
    const rq = f(u, { method: metodo, headers: { ...intestazioni, 'Content-Length': Buffer.byteLength(corpo) }, lookup: cerca, timeout: ms }, rs => {
      const pezzi = []; let n = 0;
      rs.on('data', x => { if (n < 4096) { pezzi.push(x); n += x.length; } });
      rs.on('end', () => ok({ status: rs.statusCode, testo: Buffer.concat(pezzi).toString('utf8') }));
      rs.on('error', ko);
    });
    rq.on('timeout', () => rq.destroy(Object.assign(new Error('Tempo scaduto'), { code: 'TEMPO' })));
    rq.on('error', ko);
    rq.end(corpo);
  });
}
