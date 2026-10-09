// Packlink PRO: la spedizione di una vendita parte come bozza in Packlink PRO (con il servizio scelto, il pacco e
// l'indirizzo del cliente), si paga nel pannello Packlink (o in automatico con la carta salvata) e il tracking torna sulla
// vendita. API https://api.packlink.com/v1 con l'intestazione Authorization: <chiave API> (la stessa che usano i moduli
// ufficiali per PrestaShop e WooCommerce, packlink-dev/ecommerce_module_core): POST /shipments crea la bozza e dà il
// riferimento, GET /shipments/{rif} lo stato e i tracking, GET /shipments/{rif}/track la cronologia, POST
// /shipments/callback registra l'indirizzo degli eventi. Gli eventi non sono firmati: l'indirizzo porta il codice segreto
// di Lumi e la spedizione si rilegge sempre dall'API.
import { venditaDa, venditaDiChi, destinatario, segnaSpedizione, tondo, RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const api = (k, p) => `${(k.base || 'https://api.packlink.com').replace(/\/$/, '')}/v1${p}`;
const tok = k => ({ intestazioni: { Authorization: k.segreti.chiave } });
const errore = r => new Error(`Packlink ha risposto ${r.stato}${r.json?.messages?.[0]?.message ? ': ' + r.json.messages[0].message : r.json?.message ? ': ' + r.json.message : ''}`);
async function chiama(k, metodo, p, json) { const r = await k.http[metodo](api(k, p), { ...tok(k), ...(json ? { json } : {}) }); if (!r.ok) throw errore(r); return r.json; }
const STATI = { AWAITING_COMPLETION: 'Bozza da pagare', READY_TO_PRINT: 'Etichetta pronta', READY_FOR_COLLECTION: 'In attesa del ritiro', IN_TRANSIT: 'In viaggio', DELIVERED: 'Consegnata', RETURNED_TO_SENDER: 'Tornata al mittente', INCIDENT: 'Problema' };
async function aggiorna(k, rif) {
  const s = await chiama(k, 'get', `/shipments/${encodeURIComponent(rif)}`), v = k.sincro.locale('vendite', rif); if (!v) return null;
  const stato = STATI[s?.state] || s?.state || 'Bozza'; const tracking = (s?.tracking_codes || s?.trackings || [])[0] || '';
  segnaSpedizione(k, v, { corriere: s?.carrier || '', tracking, stato, url: s?.tracking_url || '' });
  return stato;
}
function bozza(k, v, { peso, servizio } = {}) {
  const d = destinatario(k, v), [nome, ...cognome] = d.nome.split(' '), m = k.imp;
  if (!m.mittente_cap || !m.mittente_via) throw new Error('Mancano l\'indirizzo e il CAP del mittente nelle impostazioni');
  return {
    service_id: Number(servizio || m.servizio) || undefined, source: 'Lumi', platform: 'PRO', platform_country: 'IT', shipment_custom_reference: String(v.numero ?? v.id),
    content: m.contenuto || 'Merce', contentvalue: tondo(k.valore(v, 'vendite', 'totale')),
    from: { name: m.mittente_nome || '', surname: '', company: m.mittente_nome || '', street1: m.mittente_via, zip_code: m.mittente_cap, city: m.mittente_comune || '', country: 'IT', phone: m.mittente_telefono || '', email: m.mittente_email || '' },
    to: { name: nome, surname: cognome.join(' '), street1: `${d.via} ${d.civico}`.trim(), zip_code: d.cap, city: d.comune, country: d.paese, phone: d.telefono, email: d.email },
    packages: [{ weight: tondo(peso || m.peso || 1), width: Number(m.larghezza || 20), height: Number(m.altezza || 10), length: Number(m.lunghezza || 30) }],
  };
}

export default {
  id: 'packlink', nome: 'Packlink PRO', versione: 1, icona: 'camion', base: 'https://api.packlink.com',
  descrizione: 'Spedizioni scontate con BRT, GLS, SDA, Poste, UPS, DHL: la bozza parte dalla vendita, il tracking ci torna da solo.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API di Packlink PRO', segreto: true, aiuto: 'Packlink PRO › Impostazioni › Integrazioni › Chiave API' },
    { id: 'codice', nome: 'Codice segreto degli eventi', segreto: true, generato: true },
    { id: 'servizio', nome: 'Servizio predefinito (id)', tipo: 'numero', aiuto: 'Premi «Servizi disponibili» per vedere gli id' },
    { id: 'mittente_nome', nome: 'Mittente: nome o ragione sociale' }, { id: 'mittente_via', nome: 'Mittente: via e numero' },
    { id: 'mittente_cap', nome: 'Mittente: CAP', schema: /^\d{5}$/ }, { id: 'mittente_comune', nome: 'Mittente: comune' },
    { id: 'mittente_telefono', nome: 'Mittente: telefono' }, { id: 'mittente_email', nome: 'Mittente: email' },
    { id: 'peso', nome: 'Peso predefinito (kg)', tipo: 'numero', predefinito: 1 },
    { id: 'lunghezza', nome: 'Lunghezza (cm)', tipo: 'numero', predefinito: 30 }, { id: 'larghezza', nome: 'Larghezza (cm)', tipo: 'numero', predefinito: 20 }, { id: 'altezza', nome: 'Altezza (cm)', tipo: 'numero', predefinito: 10 },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { const r = await k.http.get(api(k, '/users/me'), tok(k)); return { ok: r.ok, messaggio: r.ok ? r.json?.email || null : r.stato === 401 ? 'Chiave non valida' : `HTTP ${r.stato}` }; },
  azioni: {
    bozza: {
      nome: 'Prepara la spedizione Packlink', descrizione: 'crea la bozza della spedizione di una vendita in Packlink PRO (si paga e si stampa da Packlink)', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, peso: { tipo: 'numero', nome: 'Peso in kg (facoltativo)' }, servizio: { tipo: 'numero', nome: 'Id del servizio (facoltativo)' } },
      proponi: (x, k) => { const v = venditaDa(k, x.vendita), b = bozza(k, v, x);
        return { titolo: 'Spedizione Packlink', righe: [['Vendita', v.numero ?? v.id], ['A', `${b.to.name} ${b.to.surname}, ${b.to.street1}, ${b.to.zip_code} ${b.to.city}`], ['Pacco', `${b.packages[0].weight} kg`], ['Servizio', b.service_id ?? 'da scegliere in Packlink']], avvisi: [] }; },
      async esegui(x, k) {
        const v = venditaDa(k, x.vendita), j = await chiama(k, 'post', '/shipments', bozza(k, v, x)), rif = j?.reference;
        if (!rif) throw new Error('Packlink non ha dato il riferimento della spedizione');
        k.sincro.collega('vendite', v.id, rif); segnaSpedizione(k, v.id, { tracking: rif, stato: STATI.AWAITING_COMPLETION, url: `https://pro.packlink.it/private/shipments/${rif}` });
        return { ok: true, riferimento: rif, pannello: `https://pro.packlink.it/private/shipments/${rif}` };
      },
    },
    dove: {
      nome: 'Dov\'è il pacco', descrizione: 'lo stato della spedizione Packlink di una vendita, o dell\'ultima di un cliente (per nome)', su: 'vendite', lumi: true,
      input: { chi: { tipo: 'testo', nome: 'Numero della vendita o nome del cliente' } },
      async esegui({ chi }, k) {
        const { vendita, remoto } = venditaDiChi(k, chi); if (!remoto) throw new Error('Questa vendita non ha una spedizione Packlink');
        const stato = await aggiorna(k, remoto), storia = await chiama(k, 'get', `/shipments/${encodeURIComponent(remoto)}/track`).catch(() => []);
        const ultimo = Array.isArray(storia) ? storia[0] : null;
        return { vendita: vendita.numero ?? vendita.id, stato, ultimo: ultimo ? `${ultimo.description || ''} ${ultimo.city || ''} ${ultimo.timestamp ? new Date(ultimo.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ') : ''}`.trim() : null };
      },
    },
    servizi: {
      nome: 'Servizi disponibili', descrizione: 'i servizi e i prezzi per un pacco standard dal tuo CAP a Milano, con l\'id da mettere nelle impostazioni',
      async esegui(x, k) {
        const q = new URLSearchParams({ 'from[country]': 'IT', 'from[zip]': k.imp.mittente_cap || '20121', 'to[country]': 'IT', 'to[zip]': '20121',
          'packages[0][weight]': k.imp.peso || 1, 'packages[0][length]': k.imp.lunghezza || 30, 'packages[0][width]': k.imp.larghezza || 20, 'packages[0][height]': k.imp.altezza || 10 });
        return ((await chiama(k, 'get', `/services?${q}`)) || []).map(s => ({ id: s.id, corriere: s.carrier_name, servizio: s.service_name, prezzo: s.price?.total_price ?? s.base_price, giorni: s.transit_hours ? Math.ceil(s.transit_hours / 24) : null }));
      },
    },
    eventi: {
      nome: 'Registra l\'indirizzo degli eventi', descrizione: 'chiede a Packlink di avvisare Lumi a ogni cambio di stato delle spedizioni',
      input: { indirizzo: { tipo: 'testo', nome: 'Indirizzo pubblico di Lumi (https://…; vuoto: quello della Libreria)', facoltativo: true } },
      async esegui({ indirizzo }, k) {
        // l'indirizzo scritto qui o, se vuoto, quello unico della Libreria (k.pubblico), purché https
        const base = String(indirizzo || (/^https:\/\//i.test(k.pubblico || '') ? k.pubblico : '')).trim().replace(/\/+$/, '');
        if (!/^https:\/\/[^/]+/.test(base)) throw new Error('Serve l\'indirizzo pubblico https di Lumi: scrivilo qui o impostalo nella Libreria');
        await chiama(k, 'post', '/shipments/callback', { url: `${base}/api/connettori/packlink/in/${k.segreti.codice}` }); return { ok: true };
      },
    },
  },
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    idempotenza: ev => (ev?.data?.shipment_reference ? `${ev.data.shipment_reference}:${ev.event}:${ev.datetime || ''}` : null),
    async gestisci(ev, k) {
      const rif = ev?.data?.shipment_reference; if (!rif || !k.sincro.locale('vendite', rif)) return 'ignorato';
      return `spedizione: ${await aggiorna(k, rif)}`;   // niente firma: la spedizione si rilegge
    },
  },
  catalogo: {
    categoria: 'spedizioni', sito: 'https://pro.packlink.it', costo: 'a-consumo',
    costoNota: 'Packlink PRO è gratuito: paghi solo le spedizioni, con le tariffe scontate di Packlink (in Italia da pochi euro a pacco). Esistono piani a pagamento con sconti in più per chi spedisce molto.',
    serve: [
      { cosa: 'Chiave API di Packlink PRO', dove: 'pro.packlink.it › Impostazioni › Integrazioni (o «Packlink PRO API key»)', link: 'https://support-pro.packlink.com/hc/en-gb/articles/213431749' },
      { cosa: 'L\'indirizzo del mittente e le misure del pacco standard', dove: 'In Lumi, nelle impostazioni di questo connettore', link: 'https://pro.packlink.it' },
    ],
    passi: [
      'Registrati gratis su pro.packlink.it e, in Impostazioni, genera la chiave API.',
      'In Lumi incolla la chiave e compila mittente e pacco standard, poi premi «Prova la connessione» e accendi.',
      'Premi «Servizi disponibili» e metti l\'id del servizio che usi di solito.',
      'Con l\'indirizzo pubblico di Lumi (se hai impostato l\'indirizzo pubblico di Lumi nella Libreria, puoi lasciarlo vuoto) premi «Registra l\'indirizzo degli eventi»: il tracking torna sulla vendita appena c\'è.',
      'Da una vendita premi «Prepara la spedizione Packlink» (o chiedilo a Lumi), poi paga e stampa l\'etichetta nel pannello Packlink.',
    ],
    difficolta: 'facile', zone: ['IT', 'UE'],
    fonti: ['https://support-pro.packlink.com/hc/en-gb/articles/213431749', 'https://github.com/packlink-dev/ecommerce_module_core'],
    prova: 'finto', parole: ['packlink', 'packlink pro', 'spedizioni', 'etichette', 'corrieri', 'tracking', 'brt', 'gls', 'sda', 'poste', 'shipping'],
  },
  testi: {
    en: { nome: 'Packlink PRO', descrizione: 'Discounted shipping with BRT, GLS, SDA, Poste, UPS, DHL: the draft starts from the sale, tracking comes back by itself.', 'imp.chiave': 'Packlink PRO API key', 'aiuto.chiave': 'Packlink PRO › Settings › Integrations › API key', 'imp.codice': 'Events secret code', 'imp.servizio': 'Default service (id)', 'aiuto.servizio': 'Press «Available services» to see the ids', 'imp.mittente_nome': 'Sender: name or company', 'imp.mittente_via': 'Sender: street and number', 'imp.mittente_cap': 'Sender: postcode', 'imp.mittente_comune': 'Sender: city', 'imp.mittente_telefono': 'Sender: phone', 'imp.mittente_email': 'Sender: email', 'imp.peso': 'Default weight (kg)', 'imp.lunghezza': 'Length (cm)', 'imp.larghezza': 'Width (cm)', 'imp.altezza': 'Height (cm)', 'az.bozza': 'Prepare the Packlink shipment', 'az.dove': 'Where is the parcel', 'az.servizi': 'Available services', 'az.eventi': 'Register the events address',
      'cat.costoNota': 'Packlink PRO is free: you only pay for shipments at Packlink\'s discounted rates (in Italy a few euros per parcel). Paid plans with extra discounts exist for high volumes.',
      'cat.serve': [{ cosa: 'Packlink PRO API key', dove: 'pro.packlink.it › Settings › Integrations (or «Packlink PRO API key»)' }, { cosa: 'Sender address and standard parcel size', dove: 'In Lumi, in this connector\'s settings' }],
      'cat.passi': ['Sign up for free at pro.packlink.it and generate the API key in Settings.', 'In Lumi paste the key and fill in sender and standard parcel, then press «Test connection» and switch on.', 'Press «Available services» and enter the id of the service you usually use.', 'With Lumi\'s public address (if you set Lumi\'s public address in the Library, you can leave it empty) press «Register the events address»: tracking comes back to the sale as soon as it exists.', 'From a sale press «Prepare the Packlink shipment» (or ask Lumi), then pay and print the label in the Packlink panel.'] },
    es: { nome: 'Packlink PRO', descrizione: 'Envíos con descuento con BRT, GLS, SDA, Poste, UPS, DHL: el borrador sale de la venta y el seguimiento vuelve solo.', 'imp.chiave': 'Clave API de Packlink PRO', 'aiuto.chiave': 'Packlink PRO › Configuración › Integraciones › Clave API', 'imp.codice': 'Código secreto de los eventos', 'imp.servizio': 'Servicio predeterminado (id)', 'aiuto.servizio': 'Pulsa «Servicios disponibles» para ver los id', 'imp.mittente_nome': 'Remitente: nombre o razón social', 'imp.mittente_via': 'Remitente: calle y número', 'imp.mittente_cap': 'Remitente: código postal', 'imp.mittente_comune': 'Remitente: ciudad', 'imp.mittente_telefono': 'Remitente: teléfono', 'imp.mittente_email': 'Remitente: email', 'imp.peso': 'Peso predeterminado (kg)', 'imp.lunghezza': 'Largo (cm)', 'imp.larghezza': 'Ancho (cm)', 'imp.altezza': 'Alto (cm)', 'az.bozza': 'Preparar el envío Packlink', 'az.dove': 'Dónde está el paquete', 'az.servizi': 'Servicios disponibles', 'az.eventi': 'Registrar la dirección de eventos' },
    fr: { nome: 'Packlink PRO', descrizione: 'Envois à prix réduit avec BRT, GLS, SDA, Poste, UPS, DHL : le brouillon part de la vente, le suivi revient tout seul.', 'imp.chiave': 'Clé API Packlink PRO', 'aiuto.chiave': 'Packlink PRO › Paramètres › Intégrations › Clé API', 'imp.codice': 'Code secret des événements', 'imp.servizio': 'Service par défaut (id)', 'aiuto.servizio': 'Appuyez sur «Services disponibles» pour voir les id', 'imp.mittente_nome': 'Expéditeur : nom ou société', 'imp.mittente_via': 'Expéditeur : rue et numéro', 'imp.mittente_cap': 'Expéditeur : code postal', 'imp.mittente_comune': 'Expéditeur : ville', 'imp.mittente_telefono': 'Expéditeur : téléphone', 'imp.mittente_email': 'Expéditeur : e-mail', 'imp.peso': 'Poids par défaut (kg)', 'imp.lunghezza': 'Longueur (cm)', 'imp.larghezza': 'Largeur (cm)', 'imp.altezza': 'Hauteur (cm)', 'az.bozza': 'Préparer l\'envoi Packlink', 'az.dove': 'Où est le colis', 'az.servizi': 'Services disponibles', 'az.eventi': 'Enregistrer l\'adresse des événements' },
    de: { nome: 'Packlink PRO', descrizione: 'Günstiger Versand mit BRT, GLS, SDA, Poste, UPS, DHL: der Entwurf startet beim Verkauf, die Sendungsnummer kommt von selbst zurück.', 'imp.chiave': 'Packlink-PRO-API-Schlüssel', 'aiuto.chiave': 'Packlink PRO › Einstellungen › Integrationen › API-Schlüssel', 'imp.codice': 'Geheimer Code der Ereignisse', 'imp.servizio': 'Standarddienst (ID)', 'aiuto.servizio': '«Verfügbare Dienste» zeigt die IDs', 'imp.mittente_nome': 'Absender: Name oder Firma', 'imp.mittente_via': 'Absender: Straße und Nummer', 'imp.mittente_cap': 'Absender: PLZ', 'imp.mittente_comune': 'Absender: Ort', 'imp.mittente_telefono': 'Absender: Telefon', 'imp.mittente_email': 'Absender: E-Mail', 'imp.peso': 'Standardgewicht (kg)', 'imp.lunghezza': 'Länge (cm)', 'imp.larghezza': 'Breite (cm)', 'imp.altezza': 'Höhe (cm)', 'az.bozza': 'Packlink-Versand vorbereiten', 'az.dove': 'Wo ist das Paket', 'az.servizi': 'Verfügbare Dienste', 'az.eventi': 'Ereignisadresse registrieren' },
    pt: { nome: 'Packlink PRO', descrizione: 'Envios com desconto com BRT, GLS, SDA, Poste, UPS, DHL: o rascunho parte da venda e o rastreio volta sozinho.', 'imp.chiave': 'Chave de API do Packlink PRO', 'aiuto.chiave': 'Packlink PRO › Configurações › Integrações › Chave de API', 'imp.codice': 'Código secreto dos eventos', 'imp.servizio': 'Serviço padrão (id)', 'aiuto.servizio': 'Toque em «Serviços disponíveis» para ver os id', 'imp.mittente_nome': 'Remetente: nome ou empresa', 'imp.mittente_via': 'Remetente: rua e número', 'imp.mittente_cap': 'Remetente: CEP', 'imp.mittente_comune': 'Remetente: cidade', 'imp.mittente_telefono': 'Remetente: telefone', 'imp.mittente_email': 'Remetente: e-mail', 'imp.peso': 'Peso padrão (kg)', 'imp.lunghezza': 'Comprimento (cm)', 'imp.larghezza': 'Largura (cm)', 'imp.altezza': 'Altura (cm)', 'az.bozza': 'Preparar o envio Packlink', 'az.dove': 'Onde está o pacote', 'az.servizi': 'Serviços disponíveis', 'az.eventi': 'Registrar o endereço de eventos' },
  },
};
