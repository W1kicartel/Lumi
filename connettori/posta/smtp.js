// Un client SMTP minimo senza dipendenze: TLS implicito (465) o STARTTLS (587), AUTH PLAIN, un messaggio MIME con
// allegati in base64. Vale anche per la PEC (Aruba, Legalmail, Namirial…: SMTP su TLS con le credenziali della casella).
// Controllo SSRF come per HTTP: un server nella rete interna solo con il consenso del titolare per questo connettore;
// senza TLS («nessuna») solo verso la rete interna (un relay del negozio, i finti server dei test).
import { connect as tcp } from 'node:net';
import { connect as tls } from 'node:tls';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { interno } from '../../server/moduli/sicurezza-rete.js';

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const intesta = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const riga76 = s => s.replace(/.{1,76}/g, '$&\r\n');
export function messaggio({ da, a, oggetto, testo, allegati = [] }) {
  const conf = randomBytes(12).toString('hex'), parti = [`From: ${da}`, `To: ${[].concat(a).join(', ')}`, `Subject: ${intesta(oggetto)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@kubo>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${conf}"`, '',
    `--${conf}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', riga76(b64(testo))];
  for (const x of allegati) parti.push(`--${conf}`, `Content-Type: ${x.tipo || 'application/octet-stream'}; name="${x.nome}"`, 'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${x.nome}"`, '', riga76(Buffer.from(x.contenuto).toString('base64')));
  parti.push(`--${conf}--`, '');
  return parti.join('\r\n').replace(/^\./gm, '..');   // il punto a inizio riga si raddoppia (RFC 5321)
}
export async function invia({ host, porta = 587, sicurezza = 'starttls', utente, password, interni = false, ms = 20000 }, posta) {
  const ind = (await lookup(host, { all: true })).map(x => x.address);
  if (!ind.length || (!interni && ind.some(interno))) throw new Error('Il server di posta è nella rete interna: il titolare può permetterlo nella pagina del connettore');
  if (sicurezza === 'nessuna' && !ind.every(interno)) throw new Error('Senza TLS solo verso un server della rete interna');
  let s = sicurezza === 'tls' ? tls({ host: ind[0], port: porta, servername: host }) : tcp({ host: ind[0], port: porta });
  s.setTimeout(ms, () => s.destroy(new Error('Tempo scaduto')));
  let buf = '', attesa = null;
  const leggi = () => { s.on('data', x => { buf += x; const m = /(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buf); if (m && attesa) { const r = { codice: Number(m[1]), testo: buf }; buf = ''; const f = attesa; attesa = null; f(r); } }); };
  const risposta = () => new Promise((ok, ko) => { attesa = ok; s.once('error', ko); });
  const cmd = async (c, atteso) => { if (c != null) s.write(c + '\r\n'); const r = await risposta(); if (!atteso.includes(r.codice)) throw new Error(`SMTP ${r.codice}: ${r.testo.trim().slice(0, 200)}`); return r; };
  leggi();
  try {
    await cmd(null, [220]); let e = await cmd('EHLO kubo', [250]);
    if (sicurezza === 'starttls') {
      if (!/STARTTLS/i.test(e.testo)) throw new Error('Il server non offre STARTTLS');
      await cmd('STARTTLS', [220]); s.removeAllListeners('data');
      s = tls({ socket: s, servername: host }); leggi(); await new Promise((ok, ko) => { s.once('secureConnect', ok); s.once('error', ko); });
      e = await cmd('EHLO kubo', [250]);
    }
    if (utente) await cmd(`AUTH PLAIN ${b64(`\0${utente}\0${password}`)}`, [235]);
    if (posta) {
      const mitt = /<([^>]+)>/.exec(posta.da)?.[1] || posta.da;
      await cmd(`MAIL FROM:<${mitt}>`, [250]);
      for (const x of [].concat(posta.a)) await cmd(`RCPT TO:<${/<([^>]+)>/.exec(x)?.[1] || x}>`, [250, 251]);
      await cmd('DATA', [354]); await cmd(messaggio(posta) + '\r\n.', [250]);
    }
    await cmd('QUIT', [221]).catch(() => {});
  } finally { s.destroy(); }
  return true;
}
