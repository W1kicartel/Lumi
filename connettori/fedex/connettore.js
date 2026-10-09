// FedEx (e TNT, ora FedEx): il tracking delle spedizioni sulle vendite, e Lumi che risponde «dov'è il pacco».
// OAuth client credentials: POST /oauth/token con grant_type, client_id e client_secret nel form, token di un'ora
// (https://developer.fedex.com/api/en-us/catalog/authorization/docs.html). Tracking: POST /track/v1/trackingnumbers
// (https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html); latestStatusDetail.code «DL» = consegnato.
// La creazione delle etichette (Ship API) non c'è ancora: per le etichette FedEx usa Sendcloud, Packlink o ShippyPro.
import { token } from '../_negozi/token.js';
import { tracciamento } from '../_negozi/tracciamento.js';
import { RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const host = k => (k.base || (k.imp.ambiente === 'prova' ? 'https://apis-sandbox.fedex.com' : 'https://apis.fedex.com')).replace(/\/$/, '');
const accesso = async k => ({ bearer: await token(k, { url: `${host(k)}/oauth/token`, form: { grant_type: 'client_credentials', client_id: k.segreti.client_id, client_secret: k.segreti.client_secret } }), intestazioni: { 'X-locale': 'it_IT' } });
const t = tracciamento({ corriere: 'FedEx', pagina: n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`, async leggi(k, n) {
  const r = await k.http.post(`${host(k)}/track/v1/trackingnumbers`, { ...(await accesso(k)), json: { includeDetailedScans: false, trackingInfo: [{ trackingNumberInfo: { trackingNumber: n } }] } });
  if (!r.ok) throw new Error(`FedEx ha risposto ${r.stato}${r.json?.errors?.[0]?.message ? ': ' + r.json.errors[0].message : ''}`);
  const x = r.json?.output?.completeTrackResults?.[0]?.trackResults?.[0]; if (!x || x.error) return null;
  const s = x.latestStatusDetail || {};
  return { stato: s.statusByLocale || s.description || 'In viaggio', consegnato: s.code === 'DL', dove: s.scanLocation?.city || null, quando: x.dateAndTimes?.[0]?.dateTime || null };
} });

export default {
  id: 'fedex', nome: 'FedEx', versione: 1, icona: 'camion',
  descrizione: 'Il tracking delle spedizioni FedEx (anche ex TNT) sulle vendite: lo stato torna da solo e Lumi sa dov\'è il pacco.',
  impostazioni: [
    { id: 'client_id', nome: 'API key (Client ID) del progetto FedEx', segreto: true },
    { id: 'client_secret', nome: 'Secret key del progetto FedEx', segreto: true },
    { id: 'ambiente', nome: 'Ambiente', tipo: 'scelta', opzioni: ['produzione', 'prova'], predefinito: 'produzione' },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { await accesso(k); return { ok: true }; },
  azioni: t.azioni,
  pianificati: t.pianificati,
  catalogo: {
    categoria: 'spedizioni', sito: 'https://www.fedex.com/it-it/home.html', costo: 'gratis',
    costoNota: 'Le API FedEx sono gratuite con un account FedEx Developer; le spedizioni si pagano con il tuo conto FedEx.',
    serve: [{ cosa: 'API key e Secret key di un progetto con la «Track API»', dove: 'developer.fedex.com › My Projects › Create API Project › Track API', link: 'https://developer.fedex.com/api/en-us/get-started.html' }],
    passi: [
      'Registrati su developer.fedex.com e crea un progetto («Create API Project») con la Track API.',
      'Copia API key e Secret key (prima quelle di prova, poi quelle di produzione).',
      'In Lumi incollale, scegli l\'ambiente, premi «Prova la connessione» e accendi.',
      'Da una vendita usa «Collega un tracking FedEx», oppure chiedilo a Lumi: lo stato torna sulla vendita ogni due ore.',
    ],
    difficolta: 'facile', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.fedex.com/api/en-us/catalog/authorization/docs.html', 'https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html'],
    prova: 'finto', parole: ['fedex', 'tnt', 'corriere', 'tracking', 'spedizioni', 'dov\'è il pacco', 'courier', 'parcel tracking'],
  },
  testi: {
    en: { descrizione: 'Tracking of FedEx shipments (former TNT too) on sales: the status comes back by itself and Lumi knows where the parcel is.', 'imp.client_id': 'FedEx project API key (Client ID)', 'imp.client_secret': 'FedEx project secret key', 'imp.ambiente': 'Environment', 'az.collega': 'Link a FedEx tracking', 'az.dove': 'Where is the parcel', 'giro.stati': 'Shipment status',
      'cat.costoNota': 'FedEx APIs are free with a FedEx Developer account; shipments are paid with your FedEx account.',
      'cat.serve': [{ cosa: 'API key and Secret key of a project with the «Track API»', dove: 'developer.fedex.com › My Projects › Create API Project › Track API' }],
      'cat.passi': ['Sign up at developer.fedex.com and create a project («Create API Project») with the Track API.', 'Copy the API key and Secret key (test ones first, then production).', 'In Lumi paste them, pick the environment, press «Test connection» and switch on.', 'From a sale use «Link a FedEx tracking», or ask Lumi: the status comes back to the sale every two hours.'] },
    es: { descrizione: 'El seguimiento de los envíos FedEx (también ex TNT) en las ventas: el estado vuelve solo y Lumi sabe dónde está el paquete.', 'imp.client_id': 'API key (Client ID) del proyecto FedEx', 'imp.client_secret': 'Secret key del proyecto FedEx', 'imp.ambiente': 'Entorno', 'az.collega': 'Vincular un seguimiento FedEx', 'az.dove': 'Dónde está el paquete', 'giro.stati': 'Estado de los envíos' },
    fr: { descrizione: 'Le suivi des envois FedEx (ex-TNT aussi) sur les ventes : le statut revient tout seul et Lumi sait où est le colis.', 'imp.client_id': 'Clé API (Client ID) du projet FedEx', 'imp.client_secret': 'Clé secrète du projet FedEx', 'imp.ambiente': 'Environnement', 'az.collega': 'Lier un suivi FedEx', 'az.dove': 'Où est le colis', 'giro.stati': 'Statut des envois' },
    de: { descrizione: 'Sendungsverfolgung von FedEx-Sendungen (auch ehemals TNT) am Verkauf: der Status kommt von selbst und Lumi weiß, wo das Paket ist.', 'imp.client_id': 'API-Schlüssel (Client-ID) des FedEx-Projekts', 'imp.client_secret': 'Geheimer Schlüssel des FedEx-Projekts', 'imp.ambiente': 'Umgebung', 'az.collega': 'FedEx-Sendungsnummer verknüpfen', 'az.dove': 'Wo ist das Paket', 'giro.stati': 'Status der Sendungen' },
    pt: { descrizione: 'O rastreio dos envios FedEx (também ex-TNT) nas vendas: o estado volta sozinho e a Lumi sabe onde está o pacote.', 'imp.client_id': 'API key (Client ID) do projeto FedEx', 'imp.client_secret': 'Secret key do projeto FedEx', 'imp.ambiente': 'Ambiente', 'az.collega': 'Vincular um rastreio FedEx', 'az.dove': 'Onde está o pacote', 'giro.stati': 'Estado dos envios' },
  },
};
