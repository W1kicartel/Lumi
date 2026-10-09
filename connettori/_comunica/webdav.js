// WebDAV minimo (RFC 4918) sopra k.http: PUT di un file, MKCOL delle cartelle mancanti, PROPFIND Depth 1 per elencare,
// DELETE. Basta per Nextcloud, ownCloud, Synology, Koofr, pCloud e qualsiasi server WebDAV, con utente e password per app.
const PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';
const parti = p => String(p).split('/').filter(Boolean);
const spiega = (stato, cosa) => new Error(`WebDAV: ${cosa} non riuscito (HTTP ${stato})${stato === 401 ? ': controlla utente e password per app' : stato === 507 ? ': spazio finito' : ''}`);

// → { carica, creaCartelle, elenca, cancella }. «indirizzo» è la radice WebDAV dell'utente
// (Nextcloud: https://cloud.esempio.it/remote.php/dav/files/<utente>/)
export function dav(http, { indirizzo, utente, password, ms = 300000 }) {
  const radice = String(indirizzo || '').replace(/\/+$/, '');
  const url = (p, cartella = false) => `${radice}/${parti(p).map(encodeURIComponent).join('/')}${cartella ? '/' : ''}`;
  const opz = (extra = {}) => ({ basic: [utente, password], ms, ...extra });
  // crea le cartelle una alla volta: 201 creata, 405 c'era già (alcuni server rispondono 301 o 409 se c'è già un file)
  async function creaCartelle(percorso) {
    const p = parti(percorso);
    for (let i = 1; i <= p.length; i++) {
      const r = await http.richiesta('MKCOL', url(p.slice(0, i).join('/'), true), opz());
      if (!r.ok && ![405, 301].includes(r.stato)) throw spiega(r.stato, `creare la cartella «${p.slice(0, i).join('/')}»`);
    }
  }
  async function carica(percorso, contenuto, tipo = 'application/octet-stream') {
    const put = () => http.put(url(percorso), opz({ testo: contenuto, intestazioni: { 'Content-Type': tipo } }));
    let r = await put();
    // 409 (o 404 su alcuni server): manca una cartella. Si crea e si riprova una volta
    if (r.stato === 409 || r.stato === 404) { await creaCartelle(parti(percorso).slice(0, -1).join('/')); r = await put(); }
    if (!r.ok) throw spiega(r.stato, `caricare «${percorso}»`);
    return { percorso };
  }
  // i file (non le cartelle) dentro una cartella → [{ nome, percorso, byte }]; una cartella che non c'è è vuota
  async function elenca(percorso) {
    const r = await http.richiesta('PROPFIND', url(percorso, true), opz({ testo: PROPFIND, intestazioni: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' } }));
    if (r.stato === 404) return [];
    if (r.stato !== 207) throw spiega(r.stato, `elencare «${percorso}»`);
    const io = decodeURIComponent(new URL(url(percorso, true)).pathname).replace(/\/+$/, ''), out = [];
    for (const [, blocco] of r.testo.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
      const href = /<(?:[\w-]+:)?href\b[^>]*>([^<]*)<\/(?:[\w-]+:)?href>/i.exec(blocco)?.[1]; if (!href) continue;
      const p = decodeURIComponent(new URL(href.replace(/&amp;/g, '&'), radice + '/').pathname).replace(/\/+$/, '');
      if (p === io || /<(?:[\w-]+:)?collection\b/i.test(blocco)) continue;
      out.push({ nome: p.split('/').pop(), percorso: `${parti(percorso).join('/')}/${p.split('/').pop()}`, byte: Number(/getcontentlength[^>]*>(\d+)</i.exec(blocco)?.[1] || 0) });
    }
    return out;
  }
  async function cancella(percorso) {
    const r = await http.delete(url(percorso), opz());
    if (!r.ok && r.stato !== 404) throw spiega(r.stato, `cancellare «${percorso}»`);
  }
  return { carica, creaCartelle, elenca, cancella, url };
}
