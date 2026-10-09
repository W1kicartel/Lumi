// Yousign (API v3): un preventivo di Lumi va in firma elettronica e torna «accettato» quando il cliente firma.
// Flusso (https://developers.yousign.com/reference): POST /signature_requests → POST /signature_requests/{id}/documents
// (multipart: file + nature=signable_document) → POST /signature_requests/{id}/signers (con il campo firma sul documento)
// → POST /signature_requests/{id}/activate: Yousign manda la mail al cliente.
// Webhook: X-Yousign-Signature-256 = «sha256=» + hex HMAC-SHA256(segreto, corpo grezzo)
// (https://developers.yousign.com/docs/security, https://developers.yousign.com/docs/use-webhooks-in-your-app).
// Eventi: signature_request.done → accettato, signature_request.declined → rifiutato, signature_request.expired → avviso.
// Il PDF è la stampa del preventivo (documenti.js) ridotta a testo (fisco-file.js), con lo spazio della firma in fondo.
import { randomBytes } from 'node:crypto';
import { stampa } from '../../server/moduli/documenti.js';
import { pdfTesto } from '../../server/moduli/fisco-file.js';
import { meta } from '../_soldi/comuni.js';

const base = k => k.base || (k.imp.ambiente === 'produzione' ? 'https://api.yousign.app/v3' : 'https://api-sandbox.yousign.app/v3');
const rifP = id => `lumi-p-${id}`;
const daRifP = s => /lumi-p-([\w-]{1,60})/.exec(String(s ?? ''))?.[1] || null;

// l'HTML della stampa diventa righe di testo
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', euro: '€', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì' };
export function testoDi(html) {
  return String(html || '').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(td|th)>/gi, '  ').replace(/<br\s*\/?>|<\/(p|div|tr|h\d|li|table|section|header|footer)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)
    .split('\n').map(r => r.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}
// dove cade la firma: la stessa impaginazione di pdfTesto (A4 595×842, margine 50, righe da 15 o 20 punti, a capo a 92 caratteri)
const pezzi = t => { let n = 0, resto = String(t ?? ''); do { let i = resto.length > 92 ? resto.lastIndexOf(' ', 92) : resto.length; if (i <= 0) i = Math.min(92, resto.length); n++; resto = resto.slice(i).trimStart(); } while (resto); return n; };
export function pdfFirma(righe, titolo) {
  const tutte = [...righe], SPAZIO = 6;   // l'etichetta e sei righe vuote (90 punti) per la firma
  let pagina = 1, y = 792;
  const scendi = alt => { if (y - alt < 50) { pagina++; y = 792; } y -= alt; };
  for (const r of tutte) for (let i = pezzi(r.testo ?? r); i > 0; i--) scendi(r.grande ? 20 : 15);
  // la firma non si spezza: se non ci sta, righe vuote fino a fine pagina e si comincia la successiva
  if (y - (2 + SPAZIO) * 15 < 50) { while (y - 15 >= 50) { tutte.push(''); y -= 15; } pagina++; y = 792; }
  y -= 30;   // una riga vuota e l'etichetta
  tutte.push('', { testo: 'Firma per accettazione', grassetto: true }, ...Array(SPAZIO).fill(''));
  return { pdf: pdfTesto(tutte, { titolo }), campo: { page: pagina, x: 50, y: Math.round(842 - y + 5), width: 200, height: 70 } };
}

// multipart/form-data a mano: k.http manda un Buffer così com'è
function multipart(campi) {
  const b = `----lumi${randomBytes(12).toString('hex')}`, out = [];
  for (const c of campi) out.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${c.nome}"${c.file ? `; filename="${c.file}"\r\nContent-Type: ${c.tipo}` : ''}\r\n\r\n`),
    Buffer.isBuffer(c.dati) ? c.dati : Buffer.from(String(c.dati)), Buffer.from('\r\n'));
  out.push(Buffer.from(`--${b}--\r\n`));
  return { corpo: Buffer.concat(out), tipo: `multipart/form-data; boundary=${b}` };
}
const errore = (r, cosa) => new Error(`Yousign (${cosa}) ha risposto ${r.stato}: ${String(r.json?.detail || r.json?.title || r.json?.message || r.testo).slice(0, 200)}`);

// il firmatario: quello indicato, altrimenti il referente o il nome del cliente e la sua email
function firmatario(k, p, { email, nome }) {
  const cid = k.valore(p, 'preventivi', 'cliente')?.id ?? k.valore(p, 'preventivi', 'cliente');
  let cl = {}; if (cid) { try { cl = k.dati.leggi('clienti', cid); } catch { cl = {}; } }
  const em = String(email || k.valore(cl, 'clienti', 'email') || '').trim(), n = String(nome || k.valore(cl, 'clienti', 'referente') || k.valore(cl, 'clienti', 'nome') || '').trim();
  const [primo, ...resto] = n.split(/\s+/);
  return { email: em, nome: n, first_name: primo || em.split('@')[0], last_name: resto.join(' ') || primo || em.split('@')[0] };
}
const numeroDi = (k, p) => k.valore(p, 'preventivi', 'numero') || p.numero || p.id;

export default {
  id: 'yousign', nome: 'Yousign', versione: 1, icona: 'documento',
  descrizione: 'Manda i preventivi in firma elettronica: quando il cliente firma, il preventivo diventa «accettato».',
  catalogo: { categoria: 'firma', sito: 'https://yousign.com/it-it', costo: 'abbonamento', costoNota: 'L\'API è nei piani con accesso API (Pro/Scale, da circa 75 € al mese per 50 richieste di firma; prezzi su richiesta oltre). La sandbox è gratuita: controlla il listino aggiornato sul sito di Yousign',
    serve: [{ cosa: 'Chiave API (sandbox o produzione)', dove: 'App Yousign → Developers → API keys', link: 'https://app.yousign.com' },
      { cosa: 'Segreto del webhook', dove: 'App Yousign → Developers → Webhooks → il webhook creato → Secret key', link: 'https://developers.yousign.com/docs/use-webhooks-in-your-app' }],
    passi: ['Crea un account Yousign con accesso API e apri la sezione Developers', 'Crea una chiave API, prima per la sandbox', 'Incolla la chiave qui e lascia l\'ambiente su «prova»', 'Accendi il connettore e copia l\'indirizzo del webhook che Lumi mostra', 'In Yousign crea un webhook verso quell\'indirizzo con gli eventi signature_request.done, declined ed expired', 'Copia il segreto del webhook e incollalo qui', 'Prova «Manda in firma» su un preventivo; quando va, passa a «produzione» con la chiave di produzione'],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'], fonti: ['https://developers.yousign.com/reference', 'https://developers.yousign.com/docs/security', 'https://developers.yousign.com/docs/use-webhooks-in-your-app'], prova: 'finto',
    parole: ['firma elettronica', 'firma digitale', 'preventivo', 'contratto', 'accettazione', 'e-signature', 'esign', 'signature', 'yousign'] },
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API Yousign', segreto: true },
    { id: 'webhook', nome: 'Segreto del webhook', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['prova', 'produzione'], predefinito: 'prova' },
  ],
  richiede: { preventivi: { stato: { tipo: 'stato', facoltativo: true }, numero: { facoltativo: true }, cliente: { tipo: 'relazione', facoltativo: true } },
    clienti: { nome: { facoltativo: true }, email: { tipo: 'email', facoltativo: true }, referente: { facoltativo: true } } },
  permessi: { preventivi: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { const r = await k.http.get(`${base(k)}/signature_requests?limit=1`, { bearer: k.segreti.chiave }); return { ok: r.ok, messaggio: r.ok ? null : r.json?.detail || `HTTP ${r.stato}` }; },
  azioni: {
    firma: {
      nome: 'Manda in firma', descrizione: 'Manda il preventivo al cliente per la firma elettronica con Yousign', su: 'preventivi', lumi: true, scrive: true,
      input: { preventivo: { tipo: 'relazione', entita: 'preventivi', nome: 'Il preventivo da far firmare' },
        email: { tipo: 'email', nome: 'Email di chi firma (se vuota, quella del cliente)', facoltativo: true }, nome: { tipo: 'testo', nome: 'Nome di chi firma (se vuoto, quello del cliente)', facoltativo: true } },
      proponi: async ({ preventivo, ...x }, k) => {
        const f = firmatario(k, preventivo, x), s = k.valore(preventivo, 'preventivi', 'stato');
        return { titolo: 'Firma elettronica con Yousign', righe: [['Preventivo', numeroDi(k, preventivo)], ['Firma', f.nome || '—'], ['Email', f.email || '—']],
          avvisi: [...(k.sincro.remoto('preventivi', preventivo.id) ? ['Questo preventivo è già in firma'] : []), ...(!f.email ? ['Manca l\'email di chi firma'] : []),
            ...(['accettato', 'rifiutato'].includes(s) ? [`Il preventivo è già ${s}`] : [])] };
      },
      async esegui({ preventivo, ...x }, k) {
        const id = preventivo.id, s = k.valore(preventivo, 'preventivi', 'stato'), f = firmatario(k, preventivo, x);
        if (k.sincro.remoto('preventivi', id)) throw new Error('Il preventivo è già in firma');
        if (['accettato', 'rifiutato'].includes(s)) throw new Error(`Il preventivo è già ${s}`);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw new Error('Manca un\'email valida di chi firma');
        const st = stampa(k.db, { S: k.S, D: k.D, meta }, k.entita('preventivi'), id, k.ctx), titolo = st.titolo || `Preventivo ${numeroDi(k, preventivo)}`;
        const righe = testoDi(st.html); righe[0] = { testo: righe[0] || titolo, grande: true };
        const { pdf, campo } = pdfFirma(righe, titolo), h = { bearer: k.segreti.chiave };
        const sr = await k.http.post(`${base(k)}/signature_requests`, { ...h, json: { name: titolo.slice(0, 128), delivery_mode: 'email', timezone: 'Europe/Rome', external_id: rifP(id) } });
        if (!sr.ok || !sr.json?.id) throw errore(sr, 'richiesta');
        const u = `${base(k)}/signature_requests/${encodeURIComponent(sr.json.id)}`;
        const mp = multipart([{ nome: 'file', file: `${titolo.replace(/[^\w.-]+/g, '-').slice(0, 80)}.pdf`, tipo: 'application/pdf', dati: pdf }, { nome: 'nature', dati: 'signable_document' }]);
        const doc = await k.http.post(`${u}/documents`, { ...h, testo: mp.corpo, intestazioni: { 'Content-Type': mp.tipo } });
        if (!doc.ok || !doc.json?.id) throw errore(doc, 'documento');
        const fi = await k.http.post(`${u}/signers`, { ...h, json: { info: { first_name: f.first_name, last_name: f.last_name, email: f.email, locale: 'it' },
          signature_level: 'electronic_signature', signature_authentication_mode: 'no_otp', fields: [{ document_id: doc.json.id, type: 'signature', ...campo }] } });
        if (!fi.ok) throw errore(fi, 'firmatario');
        const at = await k.http.post(`${u}/activate`, h);
        if (!at.ok) throw errore(at, 'attivazione');
        k.sincro.collega('preventivi', id, sr.json.id);
        if (s === 'bozza' && k.campo('preventivi', 'stato')) await k.dati.modifica('preventivi', id, { stato: 'inviato' });
        return { id: sr.json.id, firmatario: f.email, stato: at.json?.status || 'ongoing' };
      },
    },
  },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-yousign-signature-256', segreto: 'webhook', formato: 'hex' },   // il nucleo toglie «sha256=»
    idempotenza: ev => ev?.event_id || [ev?.event_name, ev?.data?.signature_request?.id].join(':'),
    async gestisci(ev, k) {
      const sr = ev?.data?.signature_request || {}, nome = ev?.event_name;
      if (!['signature_request.done', 'signature_request.declined', 'signature_request.expired'].includes(nome)) return 'ignorato';
      const pid = (sr.id && k.sincro.locale('preventivi', sr.id)) || daRifP(sr.external_id);
      if (!pid) return k.avvisa(`firma ${sr.id || '?'} per un preventivo sconosciuto`);
      let p; try { p = k.dati.leggi('preventivi', pid); } catch { return k.avvisa(`firma ${sr.id || '?'} per un preventivo che non c'è (${pid})`); }
      const n = numeroDi(k, p), s = k.valore(p, 'preventivi', 'stato');
      if (nome === 'signature_request.expired') return k.avvisa(`la firma del preventivo ${n} è scaduta senza risposta`);
      const nuovo = nome === 'signature_request.done' ? 'accettato' : 'rifiutato';
      if (s === nuovo) return `ignorato: già ${nuovo}`;
      if (!k.campo('preventivi', 'stato')) return `preventivo ${n} ${nuovo === 'accettato' ? 'firmato' : 'rifiutato'}`;
      if (s !== 'inviato' && s !== 'bozza') return k.avvisa(`preventivo ${n} ${nuovo === 'accettato' ? 'firmato' : 'rifiutato'} su Yousign, ma in Lumi è «${s}»: controllalo a mano`);
      if (s === 'bozza') await k.dati.modifica('preventivi', pid, { stato: 'inviato' });   // le transizioni passano da «inviato»
      await k.dati.modifica('preventivi', pid, { stato: nuovo });
      if (nuovo === 'rifiutato') k.avvisa(`il cliente ha rifiutato di firmare il preventivo ${n}${sr.decline_information?.reason ? `: ${String(sr.decline_information.reason).slice(0, 200)}` : ''}`);
      return `preventivo ${n} ${nuovo}`;
    },
  },
  testi: {
    en: { descrizione: 'Send quotes for e-signature: when the customer signs, the quote becomes «accepted».', 'imp.chiave': 'Yousign API key', 'imp.webhook': 'Webhook secret', 'imp.ambiente': 'Environment', 'az.firma': 'Send for signature',
      'cat.costoNota': 'The API is in the plans with API access (Pro/Scale, from about €75 a month for 50 signature requests; custom pricing above). The sandbox is free: check the current price list on the Yousign website',
      'cat.serve': [{ cosa: 'API key (sandbox or production)', dove: 'Yousign app → Developers → API keys' }, { cosa: 'Webhook secret', dove: 'Yousign app → Developers → Webhooks → your webhook → Secret key' }],
      'cat.passi': ['Create a Yousign account with API access and open the Developers section', 'Create an API key, first for the sandbox', 'Paste the key here and leave the environment on «prova» (test)', 'Switch the connector on and copy the webhook address Lumi shows', 'In Yousign create a webhook to that address with the events signature_request.done, declined and expired', 'Copy the webhook secret and paste it here', 'Try «Send for signature» on a quote; when it works, move to «produzione» with the production key'] },
    es: { descrizione: 'Envía los presupuestos a firma electrónica: cuando el cliente firma, el presupuesto pasa a «aceptado».', 'imp.chiave': 'Clave API de Yousign', 'imp.webhook': 'Secreto del webhook', 'imp.ambiente': 'Entorno', 'az.firma': 'Enviar a firmar' },
    fr: { descrizione: 'Envoyez les devis en signature électronique : quand le client signe, le devis passe à «accepté».', 'imp.chiave': 'Clé API Yousign', 'imp.webhook': 'Secret du webhook', 'imp.ambiente': 'Environnement', 'az.firma': 'Envoyer en signature' },
    de: { descrizione: 'Sende Angebote zur elektronischen Signatur: Wenn der Kunde unterschreibt, wird das Angebot «angenommen».', 'imp.chiave': 'Yousign-API-Schlüssel', 'imp.webhook': 'Webhook-Geheimnis', 'imp.ambiente': 'Umgebung', 'az.firma': 'Zur Unterschrift senden' },
    pt: { descrizione: 'Envie os orçamentos para assinatura eletrônica: quando o cliente assina, o orçamento fica «aceito».', 'imp.chiave': 'Chave API da Yousign', 'imp.webhook': 'Segredo do webhook', 'imp.ambiente': 'Ambiente', 'az.firma': 'Enviar para assinatura' },
  },
};
