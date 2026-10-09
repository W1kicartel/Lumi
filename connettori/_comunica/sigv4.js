// AWS Signature Version 4: la firma delle richieste per S3 e compatibili (Backblaze B2, Wasabi, Cloudflare R2, MinIO) e
// per gli altri servizi AWS (Amazon SES). Regole: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
// e per S3 https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (percorso codificato una volta
// sola, intestazione x-amz-content-sha256 obbligatoria). Verificata con «get-vanilla» e con l'esempio GET Object di S3.
import { createHash, createHmac } from 'node:crypto';

export const sha256 = x => createHash('sha256').update(x ?? '').digest('hex');
const hmac = (k, x) => createHmac('sha256', k).update(x).digest();
// la codifica RFC 3986 che vuole AWS: restano solo A-Z a-z 0-9 - _ . ~
export const codifica = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export const dataAmz = (ora = new Date()) => ora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export const chiaveFirma = (segreto, giorno, regione, servizio) => hmac(hmac(hmac(hmac('AWS4' + segreto, giorno), regione), servizio), 'aws4_request');

// → le intestazioni da aggiungere alla richiesta: Authorization, x-amz-date (e per S3 x-amz-content-sha256, con un token
// temporaneo x-amz-security-token). «intestazioni» sono quelle che si mandano e vanno firmate (Content-Type, Range…).
export function firmaV4({ metodo = 'GET', url, intestazioni = {}, corpo = '', hashCorpo = null, regione, servizio, chiave, segreto, token = null, ora = new Date(), s3 = servizio === 's3' }) {
  const u = new URL(url), amz = dataAmz(ora), giorno = amz.slice(0, 8), ph = hashCorpo || sha256(corpo);
  const h = {}; for (const [n, v] of Object.entries(intestazioni)) h[n.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  h.host = u.host; h['x-amz-date'] = amz;
  if (s3) h['x-amz-content-sha256'] = ph;
  if (token) h['x-amz-security-token'] = token;
  const nomi = Object.keys(h).sort(), firmate = nomi.join(';');
  // S3 codifica il percorso una volta; gli altri servizi due (ogni segmento già codificato si ricodifica)
  const seg = u.pathname.split('/').map(p => { const d = codifica(decodeURIComponent(p)); return s3 ? d : codifica(d); });
  const percorso = seg.join('/') || '/';
  const query = [...u.searchParams].map(([a, b]) => [codifica(a), codifica(b)]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)).map(([a, b]) => `${a}=${b}`).join('&');
  const canonica = [metodo.toUpperCase(), percorso, query, nomi.map(n => `${n}:${h[n]}\n`).join(''), firmate, ph].join('\n');
  const ambito = `${giorno}/${regione}/${servizio}/aws4_request`;
  const daFirmare = ['AWS4-HMAC-SHA256', amz, ambito, sha256(canonica)].join('\n');
  const firma = createHmac('sha256', chiaveFirma(segreto, giorno, regione, servizio)).update(daFirmare).digest('hex');
  const out = { Authorization: `AWS4-HMAC-SHA256 Credential=${chiave}/${ambito}, SignedHeaders=${firmate}, Signature=${firma}`, 'x-amz-date': amz };
  if (s3) out['x-amz-content-sha256'] = ph;
  if (token) out['x-amz-security-token'] = token;
  return out;
}
