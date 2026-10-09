// Gli attrezzi per provare un connettore senza rete: un finto servizio locale, Lumi in memoria con il titolare,
// le firme dei webhook. Uso: const s = await finto({ 'GET /v1/balance': () => ({ ok: 1 }), 'PUT /prodotti/:id': (p, corpo) => … })
// → { url, chiamate, chiudi }. Una funzione può restituire { stato, intestazioni, corpo } per una risposta su misura.
import { createServer } from 'node:http';
import { apri } from '../server/db.js';
import { creaServer } from '../server/api.js';
import { attiva } from '../server/automazioni.js';
import { istanze } from '../server/moduli/connettori.js';
export { firmaStripeDi, firmaHmacDi } from '../server/moduli/connettori-rete.js';

attiva();
const ascolta = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

export async function finto(rotte) {
  const chiamate = [], tab = Object.entries(rotte).map(([k, f]) => { const [m, p] = k.split(' '); return { m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), f }; });
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', x => { b += x; }); req.on('end', async () => {
      const u = new URL(req.url, 'http://x'), x = tab.find(t => t.m === req.method && t.re.test(u.pathname));
      let corpo = b; try { corpo = /json/.test(req.headers['content-type'] || '') ? JSON.parse(b) : /urlencoded/.test(req.headers['content-type'] || '') ? Object.fromEntries(new URLSearchParams(b)) : b; } catch { }
      chiamate.push({ metodo: req.method, percorso: u.pathname, q: Object.fromEntries(u.searchParams), intestazioni: req.headers, corpo });
      if (!x) return res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"errore":"finto: non trovato"}');
      try {
        const out = await x.f({ ...u.pathname.match(x.re).groups }, corpo, { q: u.searchParams, intestazioni: req.headers });
        if (out?.stato) return res.writeHead(out.stato, { 'Content-Type': 'application/json', ...(out.intestazioni || {}) }).end(typeof out.corpo === 'string' ? out.corpo : JSON.stringify(out.corpo ?? {}));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out ?? {}));
      } catch (e) { res.writeHead(500).end(String(e.message)); }
    });
  });
  const url = await ascolta(srv);
  return { url, chiamate, chiudi: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}

// Lumi in memoria, con il titolare e i modelli chiesti. → { base, chiama, db, nucleo, chiudi }
export async function gestionale(modelli = ['negozio']) {
  const db = apri(), srv = creaServer(db), base = await ascolta(srv); let biscotto = '';
  const chiama = async (metodo, percorso, corpo, { intestazioni = {} } = {}) => {
    const r = await fetch(base + percorso, { method: metodo, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Lumi': '1', ...(biscotto ? { Cookie: biscotto } : {}), ...intestazioni }, body: corpo ? JSON.stringify(corpo) : undefined });
    const c = r.headers.get('set-cookie'); if (c) biscotto = c.split(';')[0];
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { }
    return { stato: r.status, json, testo: t, intestazioni: r.headers };
  };
  const c = await chiama('POST', '/api/configura', { azienda: 'Bottega', nome: 'Titolare', email: 'titolare@esempio.it', password: 'prova-lumi-1', modelli });
  if (c.stato !== 200) throw new Error(JSON.stringify(c.json));
  const nucleo = istanze.get(db); await nucleo.pronti;
  return { base, chiama, db, nucleo, chiudi: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}

// accende un connettore puntandolo al finto servizio (rete interna permessa solo per lui), con segreti e impostazioni
export async function accendi(K, id, { base, segreti = {}, impostazioni = {} } = {}) {
  if (base) K.nucleo.perProva(id, { base });
  const r = await K.chiama('PUT', `/api/connettori/${id}`, { interni: true, segreti, impostazioni, attivo: true });
  if (r.stato !== 200) throw new Error(JSON.stringify(r.json));
  return r.json;
}
// un webhook come lo manda il servizio: niente X-Lumi, niente sessione, corpo grezzo
export const manda = (K, percorso, corpo, intestazioni = {}) => fetch(K.base + percorso, { method: 'POST', headers: { 'Content-Type': 'application/json', ...intestazioni }, body: corpo })
  .then(async r => ({ stato: r.status, json: await r.json().catch(() => null) }));
