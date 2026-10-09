// Token di accesso brevi ottenuti da un segreto lungo (refresh token di Amazon LWA, di eBay, di Etsy; client credentials
// di UPS e FedEx): si chiedono quando servono e si tengono solo in memoria fino a un minuto prima della scadenza.
// Il segreto lungo resta nell'archivio cifrato del nucleo; un riavvio chiede semplicemente un token nuovo.
import { createHash } from 'node:crypto';
const cache = new Map();
export async function token(k, { url, form, basic, intestazioni }) {
  const chiave = createHash('sha256').update(JSON.stringify([k.id, url, form, basic])).digest('hex');
  const x = cache.get(chiave); if (x?.token && x.scade - Date.now() > 60000) return x.token;
  if (x?.attesa) return x.attesa;
  const attesa = (async () => {
    const r = await k.http.post(url, { form, ...(basic ? { basic } : {}), ...(intestazioni ? { intestazioni } : {}) });
    if (!r.ok || !r.json?.access_token) { cache.delete(chiave); throw new Error(`Accesso rifiutato da ${new URL(url).host} (${r.stato}${r.json?.error_description ? ': ' + r.json.error_description : r.json?.error ? ': ' + (r.json.error.message || r.json.error) : ''})`); }
    cache.set(chiave, { token: r.json.access_token, scade: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 });
    return r.json.access_token;
  })();
  cache.set(chiave, { attesa });
  return attesa;
}
