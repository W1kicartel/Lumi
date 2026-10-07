// La rete dei connettori: il client HTTP (k.http) e le firme dei webhook in entrata.
// Il client è quello di sicurezza-rete.js generalizzato: stesso controllo SSRF sull'indirizzo a cui ci si collega davvero
// (anche contro il DNS rebinding), ma con la risposta intera (fino a «max», 5 MB), le intestazioni, JSON e form, Basic e
// Bearer, nuovi tentativi su 429/5xx rispettando Retry-After, e la paginazione (Link rel="next" o «totale pagine»).
// La rete interna (un RT del negozio, un CalDAV di casa, i finti server dei test) solo con il consenso del titolare per
// quel connettore. Mai segreti nei log: gli errori riportano metodo, host e stato, non le intestazioni.
import { request as richiestaHttp } from 'node:http';
import { request as richiestaHttps } from 'node:https';
import { lookup } from 'node:dns';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { interno, controllaUrl } from './sicurezza-rete.js';

export class ErroreRete extends Error { constructor(m, extra = {}) { super(m); Object.assign(this, extra); } }
const pausa = ms => new Promise(r => setTimeout(r, ms));

// una richiesta. → { stato, ok, intestazioni, testo, json }
export function richiesta(url, { metodo = 'GET', intestazioni = {}, json, form, testo, bearer, basic, ms = 20000, max = 5e6, interni = false } = {}) {
  return new Promise((ok, ko) => {
    const no = controllaUrl(url, { interni }); if (no) { ko(new ErroreRete(no, { code: 'INDIRIZZO' })); return; }
    const u = new URL(url), f = u.protocol === 'https:' ? richiestaHttps : richiestaHttp;
    const h = { 'User-Agent': 'Kubo-connettori/1', Accept: 'application/json', ...intestazioni };
    let corpo = '';
    if (json !== undefined) { corpo = JSON.stringify(json); h['Content-Type'] ||= 'application/json'; }
    else if (form !== undefined) { corpo = new URLSearchParams(Object.entries(form).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString(); h['Content-Type'] ||= 'application/x-www-form-urlencoded'; }
    else if (testo !== undefined) corpo = testo;
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    if (basic) h.Authorization = 'Basic ' + Buffer.from(`${basic[0]}:${basic[1]}`).toString('base64');
    if (corpo) h['Content-Length'] = Buffer.byteLength(corpo);
    const cerca = (host, opz, cb) => lookup(host, { ...opz, all: true }, (e, lista) => {
      if (e) return cb(e);
      const l = (Array.isArray(lista) ? lista : [{ address: lista, family: opz.family }]).filter(x => interni || !interno(x.address));
      if (!l.length) return cb(new ErroreRete('L\'indirizzo porta alla rete interna', { code: 'INDIRIZZO' }));
      return opz.all ? cb(null, l) : cb(null, l[0].address, l[0].family);
    });
    const rq = f(u, { method: metodo, headers: h, lookup: cerca, timeout: ms }, rs => {
      const pezzi = []; let n = 0;
      rs.on('data', x => { n += x.length; if (n > max) { rq.destroy(new ErroreRete('Risposta troppo grande', { code: 'GRANDE' })); return; } pezzi.push(x); });
      rs.on('end', () => {
        const t = Buffer.concat(pezzi).toString('utf8'); let j = null;
        if (/json/i.test(rs.headers['content-type'] || '') || /^\s*[[{]/.test(t)) { try { j = JSON.parse(t); } catch { j = null; } }
        ok({ stato: rs.statusCode, ok: rs.statusCode >= 200 && rs.statusCode < 300, intestazioni: rs.headers, testo: t, json: j });
      });
      rs.on('error', ko);
    });
    const scaduto = () => rq.destroy(new ErroreRete('Tempo scaduto', { code: 'TEMPO' })), tutto = setTimeout(scaduto, ms);
    rq.on('timeout', scaduto); rq.on('close', () => clearTimeout(tutto)); rq.on('error', ko);
    rq.end(corpo);
  });
}

// il client di un connettore: nuovi tentativi su 429 e 5xx (al massimo «tentativi», attesa da Retry-After, mai oltre 30 s)
export function client({ interni = () => false, tentativi = 2, attesaMax = 30000 } = {}) {
  async function chiama(metodo, url, opz = {}) {
    for (let i = 0; ; i++) {
      const r = await richiesta(url, { ...opz, metodo, interni: interni(url) });
      if ((r.stato === 429 || r.stato >= 500) && i < tentativi) {
        const ra = Number(r.intestazioni['retry-after']), att = Number.isFinite(ra) ? ra * 1000 : 500 * 2 ** i;
        await pausa(Math.min(attesaMax, Math.max(0, att))); continue;
      }
      return r;
    }
  }
  const c = { richiesta: chiama };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) c[m] = (url, opz) => chiama(m.toUpperCase(), url, opz);
  // tutte le pagine: «Link: <…>; rel="next"» (Shopify, GitHub) oppure «?page=N» fino a «totale» (es. x-wp-totalpages)
  c.pagine = async function* (url, { totale = null, parametro = 'page', massimo = 1000, ...opz } = {}) {
    let prossimo = url;
    for (let n = 1; prossimo && n <= massimo; n++) {
      const r = await chiama('GET', prossimo, opz);
      if (!r.ok) throw new ErroreRete(`Il servizio ha risposto ${r.stato}`, { stato: r.stato, risposta: r });
      yield r.json;
      const link = /<([^>]+)>;\s*rel="?next"?/.exec(r.intestazioni.link || '')?.[1];
      if (link) prossimo = new URL(link, prossimo).href;
      else if (totale && n < Number(r.intestazioni[totale.toLowerCase()] || 0)) { const u = new URL(url); u.searchParams.set(parametro, String(n + 1)); prossimo = u.href; }
      else prossimo = null;
    }
  };
  return c;
}

// ---------- firme dei webhook in entrata ----------
const uguali = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
export const TOLLERANZA = 300;   // secondi: come Stripe, contro il replay (https://docs.stripe.com/webhooks#verify-manually)
// Stripe: «Stripe-Signature: t=<tempo>,v1=<hex HMAC-SHA256(segreto, "<t>.<corpo grezzo>")>» (anche più v1, dopo una rotazione)
export function firmaStripe(intestazione, grezzo, segreto, ora = Date.now()) {
  const parti = String(intestazione || '').split(',').map(x => x.split('=').map(s => s.trim()));
  const t = Number(parti.find(p => p[0] === 't')?.[1]), v1 = parti.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !v1.length || Math.abs(ora / 1000 - t) > TOLLERANZA) return false;
  const atteso = createHmac('sha256', segreto).update(`${t}.`).update(grezzo).digest('hex');
  return v1.some(v => uguali(atteso, v));
}
// WooCommerce (X-WC-Webhook-Signature), Shopify (X-Shopify-Hmac-Sha256): base64 dell'HMAC-SHA256 del corpo grezzo
export const firmaHmac = (valore, grezzo, segreto, formato = 'base64') => !!valore && uguali(createHmac('sha256', segreto).update(grezzo).digest(formato), String(valore).replace(/^sha256=/, ''));
export const stessoSegreto = uguali;

// le firme per i test e per chi scrive un connettore (docs/CONNETTORI.md)
export const firmaStripeDi = (segreto, corpo, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', segreto).update(`${t}.${corpo}`).digest('hex')}`;
export const firmaHmacDi = (segreto, corpo, formato = 'base64') => createHmac('sha256', segreto).update(corpo).digest(formato);
