// Archivio S3: AWS S3 e i compatibili (Backblaze B2, Wasabi, Cloudflare R2, MinIO, Aruba Cloud Object Storage…).
// Fatture e documenti in <bucket>/Lumi/Fatture/2026/…, backup del database ogni notte in Lumi/Backup (gli ultimi N).
// Chiave di accesso + segreto, firma AWS Signature V4 vera (../_comunica/sigv4.js), indirizzi path-style
// (https://<endpoint>/<bucket>/<chiave>), che vanno bene per tutti. Un PUT singolo arriva a 5 GB.
// API: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html, ListObjectsV2, DeleteObject.
import { archivio, testiArchivio } from '../_comunica/documento.js';
import { firmaV4, codifica } from '../_comunica/sigv4.js';

const regione = k => k.imp.regione || 'us-east-1';
const fine = k => String(k.base || k.imp.endpoint || `https://s3.${regione(k)}.amazonaws.com`).replace(/\/+$/, '');
const oggetto = (k, chiave) => `${fine(k)}/${codifica(k.imp.bucket)}/${chiave.split('/').filter(Boolean).map(codifica).join('/')}`;
const xml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const no = (r, cosa) => new Error(`S3: ${cosa} non riuscito (HTTP ${r.stato}${/<Code>([^<]+)<\/Code>/.exec(r.testo || '')?.[1] ? `: ${/<Code>([^<]+)<\/Code>/.exec(r.testo)[1]}` : ''})`);
// una richiesta firmata: la firma copre host, data, hash del corpo e le intestazioni passate (Content-Type)
export async function s3(k, metodo, url, { corpo = Buffer.alloc(0), intestazioni = {} } = {}) {
  const firma = firmaV4({ metodo, url, intestazioni, corpo, regione: regione(k), servizio: 's3', chiave: k.segreti.chiave, segreto: k.segreti.segreto });
  return k.http.richiesta(metodo, url, { testo: corpo.length ? corpo : undefined, intestazioni: { ...intestazioni, ...firma }, ms: 300000 });
}

async function carica(k, cartella, nome, contenuto, tipo) {
  const r = await s3(k, 'PUT', oggetto(k, `${cartella}/${nome}`), { corpo: contenuto, intestazioni: { 'Content-Type': tipo } });
  if (!r.ok) throw no(r, `il caricamento di «${nome}»`);
  return { chiave: `${cartella}/${nome}` };
}
async function elenca(k, cartella) {
  const out = [], prefisso = `${cartella.split('/').filter(Boolean).join('/')}/`; let token = null;
  for (let n = 0; n < 50; n++) {
    const p = new URLSearchParams({ 'list-type': '2', prefix: prefisso, ...(token ? { 'continuation-token': token } : {}) });
    const r = await s3(k, 'GET', `${fine(k)}/${codifica(k.imp.bucket)}?${p}`);
    if (!r.ok) throw no(r, 'l\'elenco dei backup');
    for (const [, c] of r.testo.matchAll(/<Key>([^<]+)<\/Key>/g)) { const chiave = xml(c); if (!chiave.slice(prefisso.length).includes('/')) out.push({ nome: chiave.slice(prefisso.length), chiave }); }
    token = /<IsTruncated>true<\/IsTruncated>/.test(r.testo) ? xml(/<NextContinuationToken>([^<]+)</.exec(r.testo)?.[1] || '') : null;
    if (!token) break;
  }
  return out;
}
async function cancella(k, voce) {
  const r = await s3(k, 'DELETE', oggetto(k, voce.chiave));
  if (!r.ok && r.stato !== 404) throw no(r, `la cancellazione di «${voce.nome}»`);
}

const A = archivio({ nome: 'S3', carica, elenca, cancella, massimo: 5 * 1024 ** 3, pronto: k => !!(k.segreti.chiave && k.segreti.segreto && k.imp.bucket) });
export default {
  id: 's3', nome: 'Archivio S3', versione: 1, icona: 'documento',
  descrizione: 'Fatture, documenti e backup notturno su AWS S3, Backblaze B2, Wasabi, Cloudflare R2 o un altro S3.',
  impostazioni: [
    { id: 'endpoint', nome: 'Endpoint (vuoto = AWS; es. https://s3.eu-central-003.backblazeb2.com)', tipo: 'url', obbligatorio: false },
    { id: 'regione', nome: 'Regione (es. eu-south-1, eu-central-003, auto per R2)', predefinito: 'eu-south-1', schema: /^[a-z0-9-]{2,40}$/ },
    { id: 'bucket', nome: 'Bucket', schema: /^[a-zA-Z0-9.\-_]{3,63}$/ },
    { id: 'chiave', nome: 'Chiave di accesso (Access key ID)', segreto: true }, { id: 'segreto', nome: 'Chiave segreta (Secret access key)', segreto: true },
    ...A.impostazioni],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  prova: async k => {
    const r = await s3(k, 'GET', `${fine(k)}/${codifica(k.imp.bucket)}?list-type=2&max-keys=1`);
    return { ok: r.ok, messaggio: r.ok ? `Bucket ${k.imp.bucket}` : `HTTP ${r.stato}${/<Code>([^<]+)</.exec(r.testo || '')?.[1] ? ` ${/<Code>([^<]+)</.exec(r.testo)[1]}` : ''}` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://aws.amazon.com/s3/', costo: 'a-consumo',
    costoNota: 'Si paga lo spazio: AWS S3 Standard circa 0,023 $/GB al mese (Milano eu-south-1 poco di più); Backblaze B2 6 $/TB al mese con 10 GB gratis; Wasabi 6,99 $/TB al mese (minimo 1 TB); Cloudflare R2 0,015 $/GB al mese con 10 GB gratis e uscita gratuita. Per i backup di Lumi bastano pochi centesimi al mese.',
    serve: [
      { cosa: 'Un bucket privato e la sua regione', dove: 'AWS: Console S3 → Crea bucket · B2: Buckets → Create a Bucket · R2: R2 Object Storage → Create bucket', link: 'https://s3.console.aws.amazon.com/s3/' },
      { cosa: 'Chiave di accesso e chiave segreta limitate a quel bucket', dove: 'AWS: IAM → Utenti → Credenziali di sicurezza → Crea chiave di accesso · B2: Application Keys → Add a New Application Key · R2: Manage R2 API Tokens', link: 'https://console.aws.amazon.com/iam/' },
    ],
    passi: [
      'Crea un bucket privato (meglio in una regione UE: eu-south-1 Milano su AWS, eu-central-003 su B2).',
      'Crea una chiave di accesso con i soli permessi di lettura, scrittura e cancellazione su quel bucket.',
      'In Lumi scrivi bucket e regione; per B2, Wasabi o R2 anche l\'endpoint (es. https://s3.eu-central-003.backblazeb2.com, https://s3.eu-central-1.wasabisys.com, https://<account>.r2.cloudflarestorage.com con regione «auto»).',
      'Incolla chiave di accesso e chiave segreta, accendi il connettore e premi «Prova».',
      'Scegli se salvare da solo le fatture emesse e quanti backup tenere (predefinito 14).',
    ],
    difficolta: 'media', zone: ['mondo', 'UE'],
    fonti: ['https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html', 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html', 'https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html', 'https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html', 'https://www.backblaze.com/docs/cloud-storage-s3-compatible-api', 'https://developers.cloudflare.com/r2/api/s3/api/'],
    prova: 'finto', parole: ['s3', 'aws', 'amazon', 'backblaze', 'b2', 'wasabi', 'cloudflare', 'r2', 'minio', 'object storage', 'archivio', 'backup', 'bucket'],
  },
  testi: testiArchivio('S3', {
    en: { nome: 'S3 storage', descrizione: 'Invoices, documents and nightly backup on AWS S3, Backblaze B2, Wasabi, Cloudflare R2 or any S3.', 'imp.endpoint': 'Endpoint (empty = AWS; e.g. https://s3.eu-central-003.backblazeb2.com)', 'imp.regione': 'Region (e.g. eu-south-1, eu-central-003, auto for R2)', 'imp.bucket': 'Bucket', 'imp.chiave': 'Access key ID', 'imp.segreto': 'Secret access key',
      'cat.costoNota': 'You pay for space: AWS S3 Standard about $0.023/GB per month; Backblaze B2 $6/TB per month with 10 GB free; Wasabi $6.99/TB per month (1 TB minimum); Cloudflare R2 $0.015/GB per month with 10 GB free and free egress. Lumi backups cost a few cents a month.',
      'cat.serve': [{ cosa: 'A private bucket and its region', dove: 'AWS: S3 console → Create bucket · B2: Buckets → Create a Bucket · R2: R2 Object Storage → Create bucket' }, { cosa: 'Access key and secret key limited to that bucket', dove: 'AWS: IAM → Users → Security credentials → Create access key · B2: Application Keys → Add a New Application Key · R2: Manage R2 API Tokens' }],
      'cat.passi': ['Create a private bucket (better in an EU region).', 'Create an access key with only read, write and delete permissions on that bucket.', 'In Lumi enter bucket and region; for B2, Wasabi or R2 also the endpoint (R2 uses region «auto»).', 'Paste access key and secret key, turn the connector on and press «Test».', 'Choose whether to save issued invoices automatically and how many backups to keep (default 14).'] },
    es: { nome: 'Almacenamiento S3', descrizione: 'Facturas, documentos y copia nocturna en AWS S3, Backblaze B2, Wasabi, Cloudflare R2 u otro S3.', 'imp.endpoint': 'Endpoint (vacío = AWS)', 'imp.regione': 'Región (p. ej. eu-south-1, auto para R2)', 'imp.bucket': 'Bucket', 'imp.chiave': 'Clave de acceso (Access key ID)', 'imp.segreto': 'Clave secreta (Secret access key)' },
    fr: { nome: 'Stockage S3', descrizione: 'Factures, documents et sauvegarde nocturne sur AWS S3, Backblaze B2, Wasabi, Cloudflare R2 ou un autre S3.', 'imp.endpoint': 'Endpoint (vide = AWS)', 'imp.regione': 'Région (ex. eu-south-1, auto pour R2)', 'imp.bucket': 'Bucket', 'imp.chiave': 'Clé d\'accès (Access key ID)', 'imp.segreto': 'Clé secrète (Secret access key)' },
    de: { nome: 'S3-Speicher', descrizione: 'Rechnungen, Dokumente und nächtliche Sicherung auf AWS S3, Backblaze B2, Wasabi, Cloudflare R2 oder einem anderen S3.', 'imp.endpoint': 'Endpoint (leer = AWS)', 'imp.regione': 'Region (z. B. eu-south-1, auto für R2)', 'imp.bucket': 'Bucket', 'imp.chiave': 'Zugriffsschlüssel (Access key ID)', 'imp.segreto': 'Geheimer Schlüssel (Secret access key)' },
    pt: { nome: 'Armazenamento S3', descrizione: 'Faturas, documentos e backup noturno no AWS S3, Backblaze B2, Wasabi, Cloudflare R2 ou outro S3.', 'imp.endpoint': 'Endpoint (vazio = AWS)', 'imp.regione': 'Região (ex. eu-south-1, auto para R2)', 'imp.bucket': 'Bucket', 'imp.chiave': 'Chave de acesso (Access key ID)', 'imp.segreto': 'Chave secreta (Secret access key)' },
  }),
};
