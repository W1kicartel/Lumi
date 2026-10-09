// UPS: il tracking delle spedizioni UPS sulle vendite, e Lumi che risponde «dov'è il pacco». Dal 3 giugno 2024 le API UPS
// vogliono OAuth client credentials (niente più access key): POST /security/v1/oauth/token con Basic client_id:secret,
// token di 4 ore (https://developer.ups.com/api/reference/oauth/client-credentials). Tracking: GET
// /api/track/v1/details/{numero} con transId e transactionSrc (https://developer.ups.com/api/reference?loc=en_US&tag=Tracking).
// La creazione delle etichette (Shipping API v2409) non c'è ancora: per le etichette UPS usa Sendcloud, Packlink o ShippyPro.
import { randomUUID } from 'node:crypto';
import { token } from '../_negozi/token.js';
import { tracciamento } from '../_negozi/tracciamento.js';
import { RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const host = k => (k.base || (k.imp.ambiente === 'prova' ? 'https://wwwcie.ups.com' : 'https://onlinetools.ups.com')).replace(/\/$/, '');
const accesso = async k => ({ bearer: await token(k, { url: `${host(k)}/security/v1/oauth/token`, basic: [k.segreti.client_id, k.segreti.client_secret], form: { grant_type: 'client_credentials' } }),
  intestazioni: { transId: randomUUID().replace(/-/g, '').slice(0, 32), transactionSrc: 'Lumi' } });
// stati UPS: D consegnato, I in viaggio, X eccezione, P ritirato, M etichetta creata
const t = tracciamento({ corriere: 'UPS', pagina: n => `https://www.ups.com/track?loc=it_IT&tracknum=${encodeURIComponent(n)}`, async leggi(k, n) {
  const r = await k.http.get(`${host(k)}/api/track/v1/details/${encodeURIComponent(n)}?locale=it_IT&returnSignature=false`, await accesso(k));
  if (r.stato === 404) return null; if (!r.ok) throw new Error(`UPS ha risposto ${r.stato}${r.json?.response?.errors?.[0]?.message ? ': ' + r.json.response.errors[0].message : ''}`);
  const p = r.json?.trackResponse?.shipment?.[0]?.package?.[0]; if (!p) return null;
  const a = p.activity?.[0], s = a?.status || p.currentStatus || {};
  return { stato: p.currentStatus?.description || s.description || 'In viaggio', consegnato: (s.type || p.currentStatus?.type) === 'D' || /delivered|consegnat/i.test(p.currentStatus?.description || ''),
    dove: a?.location?.address?.city || null, quando: a?.date ? `${a.date.slice(0, 4)}-${a.date.slice(4, 6)}-${a.date.slice(6, 8)}` : null };
} });

export default {
  id: 'ups', nome: 'UPS', versione: 1, icona: 'camion',
  descrizione: 'Il tracking delle spedizioni UPS sulle vendite: lo stato torna da solo e Lumi sa dov\'è il pacco.',
  impostazioni: [
    { id: 'client_id', nome: 'Client ID dell\'app UPS', segreto: true },
    { id: 'client_secret', nome: 'Client secret dell\'app UPS', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['produzione', 'prova'], predefinito: 'produzione' },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { await accesso(k); return { ok: true }; },
  azioni: t.azioni,
  pianificati: t.pianificati,
  catalogo: {
    categoria: 'spedizioni', sito: 'https://www.ups.com/it/it', costo: 'gratis',
    costoNota: 'Le API UPS sono gratuite con un account UPS (anche senza contratto per il solo tracking); le spedizioni si pagano alle tariffe del tuo conto UPS.',
    serve: [{ cosa: 'Client ID e Client secret di un\'app con il prodotto «Tracking»', dove: 'developer.ups.com › Apps › Add Apps (collegata al tuo account UPS)', link: 'https://developer.ups.com/get-started' }],
    passi: [
      'Accedi a developer.ups.com con il tuo account UPS e crea un\'app («Add Apps»), scegliendo il prodotto Tracking.',
      'Copia Client ID e Client secret dell\'app.',
      'In Lumi incollali, premi «Prova la connessione» e accendi.',
      'Da una vendita usa «Collega un tracking UPS» con il numero 1Z…, oppure chiedilo a Lumi: lo stato torna sulla vendita ogni due ore.',
    ],
    difficolta: 'facile', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.ups.com/api/reference/oauth/client-credentials', 'https://developer.ups.com/api/reference?loc=en_US&tag=Tracking'],
    prova: 'finto', parole: ['ups', 'corriere', 'tracking', 'spedizioni', 'dov\'è il pacco', 'courier', 'parcel tracking'],
  },
  testi: {
    en: { descrizione: 'Tracking of UPS shipments on sales: the status comes back by itself and Lumi knows where the parcel is.', 'imp.client_id': 'UPS app client ID', 'imp.client_secret': 'UPS app client secret', 'imp.ambiente': 'Environment', 'az.collega': 'Link a UPS tracking', 'az.dove': 'Where is the parcel', 'giro.stati': 'Shipment status',
      'cat.costoNota': 'UPS APIs are free with a UPS account (tracking works without a contract too); shipments are paid at your UPS account rates.',
      'cat.serve': [{ cosa: 'Client ID and Client secret of an app with the «Tracking» product', dove: 'developer.ups.com › Apps › Add Apps (linked to your UPS account)' }],
      'cat.passi': ['Sign in to developer.ups.com with your UPS account and create an app («Add Apps») with the Tracking product.', 'Copy the app Client ID and Client secret.', 'In Lumi paste them, press «Test connection» and switch on.', 'From a sale use «Link a UPS tracking» with the 1Z… number, or ask Lumi: the status comes back to the sale every two hours.'] },
    es: { descrizione: 'El seguimiento de los envíos UPS en las ventas: el estado vuelve solo y Lumi sabe dónde está el paquete.', 'imp.client_id': 'Client ID de la app UPS', 'imp.client_secret': 'Client secret de la app UPS', 'imp.ambiente': 'Entorno', 'az.collega': 'Vincular un seguimiento UPS', 'az.dove': 'Dónde está el paquete', 'giro.stati': 'Estado de los envíos' },
    fr: { descrizione: 'Le suivi des envois UPS sur les ventes : le statut revient tout seul et Lumi sait où est le colis.', 'imp.client_id': 'Client ID de l\'app UPS', 'imp.client_secret': 'Client secret de l\'app UPS', 'imp.ambiente': 'Environnement', 'az.collega': 'Lier un suivi UPS', 'az.dove': 'Où est le colis', 'giro.stati': 'Statut des envois' },
    de: { descrizione: 'Sendungsverfolgung von UPS-Sendungen am Verkauf: der Status kommt von selbst und Lumi weiß, wo das Paket ist.', 'imp.client_id': 'Client-ID der UPS-App', 'imp.client_secret': 'Client-Secret der UPS-App', 'imp.ambiente': 'Umgebung', 'az.collega': 'UPS-Sendungsnummer verknüpfen', 'az.dove': 'Wo ist das Paket', 'giro.stati': 'Status der Sendungen' },
    pt: { descrizione: 'O rastreio dos envios UPS nas vendas: o estado volta sozinho e a Lumi sabe onde está o pacote.', 'imp.client_id': 'Client ID do app UPS', 'imp.client_secret': 'Client secret do app UPS', 'imp.ambiente': 'Ambiente', 'az.collega': 'Vincular um rastreio UPS', 'az.dove': 'Onde está o pacote', 'giro.stati': 'Estado dos envios' },
  },
};
