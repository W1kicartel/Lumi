// DHL: la spedizione Express di una vendita con l'etichetta (MyDHL API) e il tracking di ogni spedizione DHL (Express,
// Parcel, eCommerce) con l'API Shipment Tracking – Unified, che vuole solo una chiave gratuita.
// MyDHL API (https://developer.dhl.com/api-reference/dhl-express-mydhl-api): https://express.api.dhl.com/mydhlapi (prova:
// /mydhlapi/test), Basic con utente e password dell'API, POST /shipments con il conto del mittente → numero di spedizione
// e documenti in base64. Tracking (https://developer.dhl.com/api-reference/shipment-tracking): GET
// https://api-eu.dhl.com/track/shipments?trackingNumber=… con l'intestazione DHL-API-Key. Niente webhook: un giro ogni due
// ore rilegge le spedizioni non ancora consegnate.
import { venditaDa, venditaDiChi, destinatario, segnaSpedizione, tondo, RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const express = k => (k.base ? `${k.base.replace(/\/$/, '')}/mydhlapi` : 'https://express.api.dhl.com/mydhlapi') + (k.imp.ambiente === 'prova' ? '/test' : '');
const traccia = k => (k.base ? k.base.replace(/\/$/, '') : 'https://api-eu.dhl.com') + '/track/shipments';
const STATI = { 'pre-transit': 'Etichetta creata', transit: 'In viaggio', delivered: 'Consegnata', failure: 'Problema', unknown: 'Sconosciuto' };
async function stato(k, numero) {
  const u = new URL(traccia(k)); u.searchParams.set('trackingNumber', numero); u.searchParams.set('language', 'it');
  const r = await k.http.get(u.href, { intestazioni: { 'DHL-API-Key': k.segreti.chiave_tracking } });
  if (r.stato === 404) return null; if (!r.ok) throw new Error(`DHL ha risposto ${r.stato}${r.json?.detail ? ': ' + r.json.detail : ''}`);
  const s = r.json?.shipments?.[0]; if (!s) return null;
  const v = k.sincro.locale('vendite', numero), testo = s.status?.description || s.status?.status || STATI[s.status?.statusCode] || 'In viaggio';
  if (v) segnaSpedizione(k, v, { corriere: 'DHL', tracking: numero, stato: testo, url: `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${encodeURIComponent(numero)}` });
  const aperte = new Set(k.stato.leggi('aperte') || []); if (s.status?.statusCode === 'delivered') aperte.delete(numero); else if (v) aperte.add(numero); k.stato.scrivi('aperte', [...aperte]);
  return { stato: testo, codice: s.status?.statusCode, dove: s.status?.location?.address?.addressLocality || null, quando: s.status?.timestamp || null };
}
function spedizione(k, v, { peso } = {}) {
  const d = destinatario(k, v), m = k.imp;
  if (!m.conto || !m.mittente_cap || !m.mittente_via) throw new Error('Mancano il conto DHL e l\'indirizzo del mittente nelle impostazioni');
  const domani = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  return {
    plannedShippingDateAndTime: `${domani}T10:00:00 GMT+01:00`, pickup: { isRequested: false }, productCode: m.prodotto || 'N',
    accounts: [{ typeCode: 'shipper', number: String(m.conto) }],
    customerDetails: {
      shipperDetails: { postalAddress: { postalCode: m.mittente_cap, cityName: m.mittente_comune || '', countryCode: 'IT', addressLine1: m.mittente_via }, contactInformation: { companyName: m.mittente_nome || '', fullName: m.mittente_nome || '', phone: m.mittente_telefono || '', email: m.mittente_email || undefined } },
      receiverDetails: { postalAddress: { postalCode: d.cap, cityName: d.comune, countryCode: d.paese, addressLine1: `${d.via} ${d.civico}`.trim(), ...(d.provincia ? { provinceCode: d.provincia } : {}) }, contactInformation: { companyName: d.nome, fullName: d.nome, phone: d.telefono || m.mittente_telefono || '', email: d.email || undefined } },
    },
    content: { packages: [{ weight: tondo(peso || m.peso || 1), dimensions: { length: Number(m.lunghezza || 30), width: Number(m.larghezza || 20), height: Number(m.altezza || 10) } }],
      isCustomsDeclarable: false, description: `Vendita ${v.numero ?? v.id}`, unitOfMeasurement: 'metric' },
    customerReferences: [{ value: String(v.numero ?? v.id), typeCode: 'CU' }],
  };
}

export default {
  id: 'dhl', nome: 'DHL', versione: 1, icona: 'camion',
  descrizione: 'Spedizioni DHL Express con l\'etichetta dalla vendita, e il tracking di ogni pacco DHL sulla vendita.',
  impostazioni: [
    { id: 'chiave_tracking', nome: 'API key di Shipment Tracking – Unified', segreto: true, aiuto: 'developer.dhl.com › My Apps › la tua app › API Key' },
    { id: 'utente', nome: 'MyDHL API: utente (per creare le spedizioni)', segreto: true, obbligatorio: false },
    { id: 'password', nome: 'MyDHL API: password', segreto: true, obbligatorio: false },
    { id: 'conto', nome: 'Numero di conto DHL Express', schema: /^\d{9,10}$/ },
    { id: 'ambiente', nome: 'Ambiente MyDHL', tipo: 'scelta', opzioni: ['produzione', 'prova'], predefinito: 'produzione' },
    { id: 'prodotto', nome: 'Prodotto (N = Express nazionale, P = Express Worldwide)', predefinito: 'N', schema: /^[A-Z0-9]$/ },
    { id: 'mittente_nome', nome: 'Mittente: nome o ragione sociale' }, { id: 'mittente_via', nome: 'Mittente: via e numero' },
    { id: 'mittente_cap', nome: 'Mittente: CAP', schema: /^\d{5}$/ }, { id: 'mittente_comune', nome: 'Mittente: comune' },
    { id: 'mittente_telefono', nome: 'Mittente: telefono' }, { id: 'mittente_email', nome: 'Mittente: email' },
    { id: 'peso', nome: 'Peso predefinito (kg)', tipo: 'numero', predefinito: 1 },
    { id: 'lunghezza', nome: 'Lunghezza (cm)', tipo: 'numero', predefinito: 30 }, { id: 'larghezza', nome: 'Larghezza (cm)', tipo: 'numero', predefinito: 20 }, { id: 'altezza', nome: 'Altezza (cm)', tipo: 'numero', predefinito: 10 },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { const u = new URL(traccia(k)); u.searchParams.set('trackingNumber', '00340434292135100186');
    const r = await k.http.get(u.href, { intestazioni: { 'DHL-API-Key': k.segreti.chiave_tracking } }); return { ok: r.ok || r.stato === 404, messaggio: r.stato === 401 ? 'API key non valida' : null }; },
  azioni: {
    spedisci: {
      nome: 'Crea la spedizione DHL Express', descrizione: 'crea la spedizione Express di una vendita e l\'etichetta (indirizzo dal cliente)', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, peso: { tipo: 'numero', nome: 'Peso in kg (facoltativo)' } },
      proponi: (x, k) => { const v = venditaDa(k, x.vendita), s = spedizione(k, v, x), a = s.customerDetails.receiverDetails;
        return { titolo: 'DHL Express', righe: [['Vendita', v.numero ?? v.id], ['A', `${a.contactInformation.fullName}, ${a.postalAddress.addressLine1}, ${a.postalAddress.postalCode} ${a.postalAddress.cityName}`], ['Pacco', `${s.content.packages[0].weight} kg`], ['Prodotto', s.productCode]], avvisi: [] }; },
      async esegui(x, k) {
        if (!k.segreti.utente || !k.segreti.password) throw new Error('Per creare le spedizioni servono utente e password della MyDHL API');
        const v = venditaDa(k, x.vendita), r = await k.http.post(`${express(k)}/shipments`, { basic: [k.segreti.utente, k.segreti.password], json: spedizione(k, v, x) });
        if (!r.ok) throw new Error(`DHL Express ha risposto ${r.stato}${r.json?.detail ? ': ' + r.json.detail : ''}${r.json?.additionalDetails ? ' (' + r.json.additionalDetails.join('; ') + ')' : ''}`);
        const n = r.json.shipmentTrackingNumber; k.sincro.collega('vendite', v.id, n);
        segnaSpedizione(k, v.id, { corriere: 'DHL', tracking: n, stato: 'Etichetta creata', url: r.json.trackingUrl || '' });
        const aperte = new Set(k.stato.leggi('aperte') || []); aperte.add(n); k.stato.scrivi('aperte', [...aperte]);
        const et = (r.json.documents || []).find(d => d.typeCode === 'label');
        return { ok: true, tracking: n, etichetta: et ? `data:application/${String(et.imageFormat || 'pdf').toLowerCase()};base64,${et.content}` : null };
      },
    },
    dove: {
      nome: 'Dov\'è il pacco', descrizione: 'lo stato della spedizione DHL di una vendita, o dell\'ultima di un cliente (per nome)', su: 'vendite', lumi: true,
      input: { chi: { tipo: 'testo', nome: 'Numero della vendita o nome del cliente' } },
      async esegui({ chi }, k) {
        const { vendita, remoto } = venditaDiChi(k, chi); if (!remoto) throw new Error('Questa vendita non ha una spedizione DHL');
        const s = await stato(k, remoto); if (!s) throw new Error(`DHL non conosce ancora ${remoto}`);
        return { vendita: vendita.numero ?? vendita.id, tracking: remoto, ...s };
      },
    },
    collega: {
      nome: 'Collega un tracking DHL', descrizione: 'collega a una vendita un numero di spedizione DHL fatto fuori da Lumi', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: 'Numero di spedizione DHL' } },
      proponi: ({ vendita, tracking }, k) => { const v = venditaDa(k, vendita); return { titolo: 'Tracking DHL', righe: [['Vendita', v.numero ?? v.id], ['Tracking', tracking]], avvisi: [] }; },
      async esegui({ vendita, tracking }, k) { const v = venditaDa(k, vendita), n = String(tracking).trim(); k.sincro.collega('vendite', v.id, n); return { ok: true, ...(await stato(k, n) || { stato: 'non ancora in rete' }) }; },
    },
  },
  pianificati: { stati: { nome: 'Stato delle spedizioni', ogni: '2h', async giro(k) {
    const conti = { lette: 0, consegnate: 0 };
    for (const n of (k.stato.leggi('aperte') || []).slice(0, 100)) { const s = await stato(k, n); if (!s) continue; conti.lette++; if (s.codice === 'delivered') conti.consegnate++; }
    return conti;
  } } },
  catalogo: {
    categoria: 'spedizioni', sito: 'https://www.dhl.com/it-it/home.html', costo: 'contratto',
    costoNota: 'Le API sono gratuite. Il tracking unificato ha un piano gratuito (250 chiamate al giorno). Per spedire con DHL Express serve un conto aziendale DHL Express con le tariffe del tuo contratto.',
    serve: [
      { cosa: 'API key dell\'app con «Shipment Tracking – Unified»', dove: 'developer.dhl.com › My Apps › Create App › aggiungi Shipment Tracking – Unified', link: 'https://developer.dhl.com/api-reference/shipment-tracking' },
      { cosa: 'Utente e password della MyDHL API (solo per creare spedizioni Express) e il numero di conto DHL Express', dove: 'developer.dhl.com › My Apps › aggiungi DHL Express – MyDHL API (le credenziali arrivano dopo l\'approvazione di DHL Express)', link: 'https://developer.dhl.com/api-reference/dhl-express-mydhl-api' },
    ],
    passi: [
      'Registrati su developer.dhl.com, crea un\'app e aggiungi «Shipment Tracking – Unified»: copia l\'API key.',
      'Se spedisci con DHL Express, aggiungi alla stessa app «DHL Express – MyDHL API»: DHL ti manda utente e password dopo aver controllato il tuo conto.',
      'In Lumi incolla la chiave del tracking (e, se le hai, utente, password e numero di conto), compila il mittente e il pacco standard.',
      'Prova con l\'ambiente «prova» di MyDHL, poi passa a «produzione».',
      'Da una vendita premi «Crea la spedizione DHL Express», oppure collega un tracking fatto altrove con «Collega un tracking DHL»; Lumi risponde a «dov\'è il pacco di Rossi?».',
    ],
    difficolta: 'media', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://developer.dhl.com/api-reference/dhl-express-mydhl-api', 'https://developer.dhl.com/api-reference/shipment-tracking'],
    prova: 'finto', parole: ['dhl', 'dhl express', 'mydhl', 'corriere', 'spedizioni', 'tracking', 'etichette', 'courier', 'shipping', 'tracking unificato'],
  },
  testi: {
    en: { descrizione: 'DHL Express shipments with the label from the sale, and tracking of every DHL parcel on the sale.', 'imp.chiave_tracking': 'Shipment Tracking – Unified API key', 'aiuto.chiave_tracking': 'developer.dhl.com › My Apps › your app › API Key', 'imp.utente': 'MyDHL API: username (to create shipments)', 'imp.password': 'MyDHL API: password', 'imp.conto': 'DHL Express account number', 'imp.ambiente': 'MyDHL environment', 'imp.prodotto': 'Product (N = domestic Express, P = Express Worldwide)', 'imp.mittente_nome': 'Sender: name or company', 'imp.mittente_via': 'Sender: street and number', 'imp.mittente_cap': 'Sender: postcode', 'imp.mittente_comune': 'Sender: city', 'imp.mittente_telefono': 'Sender: phone', 'imp.mittente_email': 'Sender: email', 'imp.peso': 'Default weight (kg)', 'imp.lunghezza': 'Length (cm)', 'imp.larghezza': 'Width (cm)', 'imp.altezza': 'Height (cm)', 'az.spedisci': 'Create the DHL Express shipment', 'az.dove': 'Where is the parcel', 'az.collega': 'Link a DHL tracking', 'giro.stati': 'Shipment status',
      'cat.costoNota': 'The APIs are free. Unified tracking has a free plan (250 calls a day). Shipping with DHL Express needs a DHL Express business account with your contract rates.',
      'cat.serve': [{ cosa: 'App API key with «Shipment Tracking – Unified»', dove: 'developer.dhl.com › My Apps › Create App › add Shipment Tracking – Unified' }, { cosa: 'MyDHL API username and password (only to create Express shipments) and the DHL Express account number', dove: 'developer.dhl.com › My Apps › add DHL Express – MyDHL API (credentials arrive after DHL Express approval)' }],
      'cat.passi': ['Sign up at developer.dhl.com, create an app and add «Shipment Tracking – Unified»: copy the API key.', 'If you ship with DHL Express, add «DHL Express – MyDHL API» to the same app: DHL sends username and password after checking your account.', 'In Lumi paste the tracking key (and, if you have them, username, password and account number), fill in sender and standard parcel.', 'Test with the MyDHL «test» environment, then switch to «production».', 'From a sale press «Create the DHL Express shipment», or link a tracking made elsewhere with «Link a DHL tracking»; Lumi answers «where is Rossi\'s parcel?».'] },
    es: { descrizione: 'Envíos DHL Express con la etiqueta desde la venta, y el seguimiento de cada paquete DHL en la venta.', 'imp.chiave_tracking': 'API key de Shipment Tracking – Unified', 'aiuto.chiave_tracking': 'developer.dhl.com › My Apps › tu app › API Key', 'imp.utente': 'MyDHL API: usuario (para crear envíos)', 'imp.password': 'MyDHL API: contraseña', 'imp.conto': 'Número de cuenta DHL Express', 'imp.ambiente': 'Entorno MyDHL', 'imp.prodotto': 'Producto (N = Express nacional, P = Express Worldwide)', 'imp.mittente_nome': 'Remitente: nombre o razón social', 'imp.mittente_via': 'Remitente: calle y número', 'imp.mittente_cap': 'Remitente: código postal', 'imp.mittente_comune': 'Remitente: ciudad', 'imp.mittente_telefono': 'Remitente: teléfono', 'imp.mittente_email': 'Remitente: email', 'imp.peso': 'Peso predeterminado (kg)', 'imp.lunghezza': 'Largo (cm)', 'imp.larghezza': 'Ancho (cm)', 'imp.altezza': 'Alto (cm)', 'az.spedisci': 'Crear el envío DHL Express', 'az.dove': 'Dónde está el paquete', 'az.collega': 'Vincular un seguimiento DHL', 'giro.stati': 'Estado de los envíos' },
    fr: { descrizione: 'Envois DHL Express avec l\'étiquette depuis la vente, et le suivi de chaque colis DHL sur la vente.', 'imp.chiave_tracking': 'Clé API Shipment Tracking – Unified', 'aiuto.chiave_tracking': 'developer.dhl.com › My Apps › votre app › API Key', 'imp.utente': 'MyDHL API : utilisateur (pour créer les envois)', 'imp.password': 'MyDHL API : mot de passe', 'imp.conto': 'Numéro de compte DHL Express', 'imp.ambiente': 'Environnement MyDHL', 'imp.prodotto': 'Produit (N = Express national, P = Express Worldwide)', 'imp.mittente_nome': 'Expéditeur : nom ou société', 'imp.mittente_via': 'Expéditeur : rue et numéro', 'imp.mittente_cap': 'Expéditeur : code postal', 'imp.mittente_comune': 'Expéditeur : ville', 'imp.mittente_telefono': 'Expéditeur : téléphone', 'imp.mittente_email': 'Expéditeur : e-mail', 'imp.peso': 'Poids par défaut (kg)', 'imp.lunghezza': 'Longueur (cm)', 'imp.larghezza': 'Largeur (cm)', 'imp.altezza': 'Hauteur (cm)', 'az.spedisci': 'Créer l\'envoi DHL Express', 'az.dove': 'Où est le colis', 'az.collega': 'Lier un suivi DHL', 'giro.stati': 'Statut des envois' },
    de: { descrizione: 'DHL-Express-Sendungen mit Etikett aus dem Verkauf und Sendungsverfolgung jedes DHL-Pakets am Verkauf.', 'imp.chiave_tracking': 'API-Schlüssel Shipment Tracking – Unified', 'aiuto.chiave_tracking': 'developer.dhl.com › My Apps › deine App › API Key', 'imp.utente': 'MyDHL API: Benutzer (zum Erstellen von Sendungen)', 'imp.password': 'MyDHL API: Passwort', 'imp.conto': 'DHL-Express-Kontonummer', 'imp.ambiente': 'MyDHL-Umgebung', 'imp.prodotto': 'Produkt (N = Express national, P = Express Worldwide)', 'imp.mittente_nome': 'Absender: Name oder Firma', 'imp.mittente_via': 'Absender: Straße und Nummer', 'imp.mittente_cap': 'Absender: PLZ', 'imp.mittente_comune': 'Absender: Ort', 'imp.mittente_telefono': 'Absender: Telefon', 'imp.mittente_email': 'Absender: E-Mail', 'imp.peso': 'Standardgewicht (kg)', 'imp.lunghezza': 'Länge (cm)', 'imp.larghezza': 'Breite (cm)', 'imp.altezza': 'Höhe (cm)', 'az.spedisci': 'DHL-Express-Sendung erstellen', 'az.dove': 'Wo ist das Paket', 'az.collega': 'DHL-Sendungsnummer verknüpfen', 'giro.stati': 'Status der Sendungen' },
    pt: { descrizione: 'Envios DHL Express com a etiqueta a partir da venda, e o rastreio de cada pacote DHL na venda.', 'imp.chiave_tracking': 'API key do Shipment Tracking – Unified', 'aiuto.chiave_tracking': 'developer.dhl.com › My Apps › seu app › API Key', 'imp.utente': 'MyDHL API: usuário (para criar envios)', 'imp.password': 'MyDHL API: senha', 'imp.conto': 'Número da conta DHL Express', 'imp.ambiente': 'Ambiente MyDHL', 'imp.prodotto': 'Produto (N = Express nacional, P = Express Worldwide)', 'imp.mittente_nome': 'Remetente: nome ou empresa', 'imp.mittente_via': 'Remetente: rua e número', 'imp.mittente_cap': 'Remetente: CEP', 'imp.mittente_comune': 'Remetente: cidade', 'imp.mittente_telefono': 'Remetente: telefone', 'imp.mittente_email': 'Remetente: e-mail', 'imp.peso': 'Peso padrão (kg)', 'imp.lunghezza': 'Comprimento (cm)', 'imp.larghezza': 'Largura (cm)', 'imp.altezza': 'Altura (cm)', 'az.spedisci': 'Criar o envio DHL Express', 'az.dove': 'Onde está o pacote', 'az.collega': 'Vincular um rastreio DHL', 'giro.stati': 'Estado dos envios' },
  },
};
