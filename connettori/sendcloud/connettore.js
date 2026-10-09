// Sendcloud: l'etichetta di una vendita (BRT, Poste, GLS, SDA, DHL, UPS… con il contratto Sendcloud o con il tuo),
// il tracking che torna sulla vendita, e Lumi che risponde «dov'è il pacco di Rossi?».
// API v2 (https://api.sendcloud.dev/docs/sendcloud-public-api/): Basic con chiave pubblica e segreta dell'integrazione;
// POST /parcels con request_label crea il pacco e l'etichetta; GET /parcels/{id} ne dà lo stato. Webhook
// parcel_status_changed firmati con Sendcloud-Signature = hex(HMAC-SHA256 del corpo grezzo, chiave segreta).
import { venditaDa, venditaDiChi, destinatario, segnaSpedizione, tondo, RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const api = (k, p) => `${(k.base || 'https://panel.sendcloud.sc').replace(/\/$/, '')}/api/v2${p}`;
const chiavi = k => ({ basic: [k.segreti.chiave_pubblica, k.segreti.chiave_segreta] });
const errore = r => new Error(`Sendcloud ha risposto ${r.stato}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);

function pacco(k, v, { peso, metodo } = {}) {
  const d = destinatario(k, v), m = Number(metodo || k.imp.metodo) || null;
  return { parcel: {
    name: d.nome, address: d.via, house_number: d.civico || 'snc', city: d.comune, postal_code: d.cap, country: d.paese,
    ...(d.provincia ? { country_state: d.provincia } : {}), telephone: d.telefono || undefined, email: d.email || undefined,
    order_number: String(v.numero ?? v.id), weight: String(tondo(peso || k.imp.peso || 1).toFixed(3)), request_label: true,
    total_order_value: String(tondo(k.valore(v, 'vendite', 'totale'))), total_order_value_currency: 'EUR',
    ...(m ? { shipment: { id: m } } : { apply_shipping_rules: true }),
  } };
}

export default {
  id: 'sendcloud', nome: 'Sendcloud', versione: 1, icona: 'camion', base: 'https://panel.sendcloud.sc',
  descrizione: 'Etichette e tracking per BRT, Poste, GLS, SDA, DHL, UPS: la spedizione parte dalla vendita e lo stato ci torna da solo.',
  impostazioni: [
    { id: 'chiave_pubblica', nome: 'Chiave pubblica (Public key)', segreto: true },
    { id: 'chiave_segreta', nome: 'Chiave segreta (Secret key)', segreto: true, aiuto: 'Firma anche i webhook' },
    { id: 'metodo', nome: 'Metodo di spedizione predefinito (id, vuoto = regole di Sendcloud)', tipo: 'numero', obbligatorio: false },
    { id: 'peso', nome: 'Peso predefinito del pacco (kg)', tipo: 'numero', predefinito: 1 },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { const r = await k.http.get(api(k, '/user'), chiavi(k)); return { ok: r.ok, messaggio: r.ok ? r.json?.user?.company_name || r.json?.user?.username || null : `HTTP ${r.stato}` }; },
  azioni: {
    etichetta: {
      nome: 'Crea l\'etichetta Sendcloud', descrizione: 'crea il pacco e l\'etichetta per una vendita (indirizzo dal cliente della vendita)', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, peso: { tipo: 'numero', nome: 'Peso in kg (facoltativo)' }, metodo: { tipo: 'numero', nome: 'Id del metodo di spedizione (facoltativo)' } },
      proponi: (x, k) => { const v = venditaDa(k, x.vendita), p = pacco(k, v, x).parcel, gia = k.sincro.remoto('vendite', v.id);
        return { titolo: 'Etichetta Sendcloud', righe: [['Vendita', v.numero ?? v.id], ['A', `${p.name}, ${p.address} ${p.house_number}, ${p.postal_code} ${p.city}`], ['Peso', `${p.weight} kg`], ['Metodo', p.shipment?.id ?? 'regole di Sendcloud']],
          avvisi: gia ? [`Questa vendita ha già il pacco ${gia}: se confermi ne crei un altro`] : [] }; },
      async esegui(x, k) {
        const v = venditaDa(k, x.vendita), r = await k.http.post(api(k, '/parcels'), { ...chiavi(k), json: pacco(k, v, x) }); if (!r.ok) throw errore(r);
        const p = r.json.parcel; k.sincro.collega('vendite', v.id, p.id);
        segnaSpedizione(k, v.id, { corriere: p.carrier?.code?.toUpperCase(), tracking: p.tracking_number, stato: p.status?.message || 'Etichetta creata', url: p.tracking_url });
        return { ok: true, pacco: p.id, tracking: p.tracking_number, tracciamento: p.tracking_url, etichetta: p.label?.label_printer || p.label?.normal_printer?.[0] || null };
      },
    },
    dove: {
      nome: 'Dov\'è il pacco', descrizione: 'lo stato della spedizione di una vendita, o dell\'ultima spedizione di un cliente (per nome)', su: 'vendite', lumi: true,
      input: { chi: { tipo: 'testo', nome: 'Numero della vendita o nome del cliente' } },
      async esegui({ chi }, k) {
        const { vendita, remoto } = venditaDiChi(k, chi); if (!remoto) throw new Error('Questa vendita non ha ancora una spedizione Sendcloud');
        const r = await k.http.get(api(k, `/parcels/${remoto}`), chiavi(k)); if (!r.ok) throw errore(r);
        const p = r.json.parcel; segnaSpedizione(k, vendita.id, { corriere: p.carrier?.code?.toUpperCase(), tracking: p.tracking_number, stato: p.status?.message, url: p.tracking_url });
        return { vendita: vendita.numero ?? vendita.id, stato: p.status?.message, tracking: p.tracking_number, tracciamento: p.tracking_url, corriere: p.carrier?.code };
      },
    },
    metodi: {
      nome: 'Metodi di spedizione', descrizione: 'i metodi attivi nel tuo account, con l\'id da mettere nelle impostazioni',
      async esegui(x, k) { const r = await k.http.get(api(k, '/shipping_methods?to_country=IT'), chiavi(k)); if (!r.ok) throw errore(r);
        return (r.json.shipping_methods || []).map(m => ({ id: m.id, nome: m.name, corriere: m.carrier, peso: `${m.min_weight}–${m.max_weight} kg` })); },
    },
  },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'sendcloud-signature', segreto: 'chiave_segreta', formato: 'hex' },
    idempotenza: ev => (ev?.parcel?.id ? `${ev.parcel.id}:${ev.parcel.status?.id}:${ev.timestamp}` : null),
    async gestisci(ev, k) {
      if (ev?.action !== 'parcel_status_changed' || !ev.parcel?.id) return 'ignorato';
      const p = ev.parcel, v = k.sincro.locale('vendite', p.id); if (!v) return 'ignorato: pacco creato fuori da Kubo';
      segnaSpedizione(k, v, { corriere: p.carrier?.code?.toUpperCase(), tracking: p.tracking_number, stato: p.status?.message, url: p.tracking_url });
      return `spedizione: ${p.status?.message}`;
    },
  },
  catalogo: {
    categoria: 'spedizioni', sito: 'https://www.sendcloud.com/it/', costo: 'abbonamento',
    costoNota: 'Piano Free senza canone (paghi le etichette alle tariffe Sendcloud); i piani a pagamento partono da circa 30 € al mese e aggiungono regole, resi e il tuo contratto con i corrieri. Prezzi su sendcloud.com/it/prezzi.',
    serve: [
      { cosa: 'Chiave pubblica e chiave segreta di un\'integrazione «Sendcloud API»', dove: 'Pannello Sendcloud › Impostazioni › Integrazioni › Sendcloud API › Connetti', link: 'https://support.sendcloud.com/hc/en-us/articles/360024967252' },
      { cosa: 'L\'indirizzo dei webhook di Kubo (la «Webhook URL» dell\'integrazione)', dove: 'Stessa integrazione › Webhook feedback enabled', link: 'https://api.sendcloud.dev/docs/sendcloud-public-api/webhooks' },
    ],
    passi: [
      'In Sendcloud apri Impostazioni › Integrazioni, cerca «Sendcloud API» e premi Connetti.',
      'Dai un nome (Kubo), spunta «Webhook feedback enabled» e incolla come Webhook URL l\'indirizzo che Kubo mostra in questa pagina.',
      'Salva e copia la chiave pubblica e la chiave segreta in Kubo.',
      'Premi «Metodi di spedizione» per vedere gli id e metti quello che usi di solito (o lascia vuoto per le regole di Sendcloud).',
      'Controlla che i clienti abbiano via, CAP e comune: l\'indirizzo del pacco arriva da lì.',
      'Accendi: da una vendita premi «Crea l\'etichetta Sendcloud», oppure chiedi a Lumi «crea l\'etichetta per la vendita 1043».',
    ],
    difficolta: 'facile', zone: ['IT', 'UE'],
    fonti: ['https://api.sendcloud.dev/docs/sendcloud-public-api/parcels/operations/create-a-parcel', 'https://api.sendcloud.dev/docs/sendcloud-public-api/webhooks', 'https://api.sendcloud.dev/docs/sendcloud-public-api/getting-started'],
    prova: 'finto', parole: ['sendcloud', 'spedizioni', 'etichette', 'tracking', 'corriere', 'brt', 'poste', 'gls', 'sda', 'dhl', 'ups', 'shipping', 'labels', 'parcel'],
  },
  testi: {
    en: { descrizione: 'Labels and tracking for BRT, Poste, GLS, SDA, DHL, UPS: the shipment starts from the sale and its status comes back by itself.', 'imp.chiave_pubblica': 'Public key', 'imp.chiave_segreta': 'Secret key', 'aiuto.chiave_segreta': 'Also signs the webhooks', 'imp.metodo': 'Default shipping method (id, empty = Sendcloud rules)', 'imp.peso': 'Default parcel weight (kg)', 'az.etichetta': 'Create the Sendcloud label', 'az.dove': 'Where is the parcel', 'az.metodi': 'Shipping methods',
      'cat.costoNota': 'Free plan with no fee (you pay labels at Sendcloud rates); paid plans start at about €30 a month and add rules, returns and your own carrier contracts. Prices at sendcloud.com/pricing.',
      'cat.serve': [{ cosa: 'Public and secret key of a «Sendcloud API» integration', dove: 'Sendcloud panel › Settings › Integrations › Sendcloud API › Connect' }, { cosa: 'Kubo\'s webhook address (the integration\'s «Webhook URL»)', dove: 'Same integration › Webhook feedback enabled' }],
      'cat.passi': ['In Sendcloud open Settings › Integrations, find «Sendcloud API» and press Connect.', 'Name it (Kubo), tick «Webhook feedback enabled» and paste as Webhook URL the address Kubo shows on this page.', 'Save and copy the public and secret keys into Kubo.', 'Press «Shipping methods» to see the ids and enter your usual one (or leave empty for Sendcloud rules).', 'Check that customers have street, postcode and city: the parcel address comes from there.', 'Switch on: from a sale press «Create the Sendcloud label», or ask Lumi «create the label for sale 1043».'] },
    es: { descrizione: 'Etiquetas y seguimiento para BRT, Poste, GLS, SDA, DHL, UPS: el envío sale de la venta y el estado vuelve solo.', 'imp.chiave_pubblica': 'Clave pública', 'imp.chiave_segreta': 'Clave secreta', 'aiuto.chiave_segreta': 'También firma los webhooks', 'imp.metodo': 'Método de envío predeterminado (id, vacío = reglas de Sendcloud)', 'imp.peso': 'Peso predeterminado del paquete (kg)', 'az.etichetta': 'Crear la etiqueta Sendcloud', 'az.dove': 'Dónde está el paquete', 'az.metodi': 'Métodos de envío' },
    fr: { descrizione: 'Étiquettes et suivi pour BRT, Poste, GLS, SDA, DHL, UPS : l\'envoi part de la vente et le statut revient tout seul.', 'imp.chiave_pubblica': 'Clé publique', 'imp.chiave_segreta': 'Clé secrète', 'aiuto.chiave_segreta': 'Signe aussi les webhooks', 'imp.metodo': 'Méthode d\'envoi par défaut (id, vide = règles Sendcloud)', 'imp.peso': 'Poids par défaut du colis (kg)', 'az.etichetta': 'Créer l\'étiquette Sendcloud', 'az.dove': 'Où est le colis', 'az.metodi': 'Méthodes d\'envoi' },
    de: { descrizione: 'Etiketten und Sendungsverfolgung für BRT, Poste, GLS, SDA, DHL, UPS: der Versand startet beim Verkauf, der Status kommt von selbst zurück.', 'imp.chiave_pubblica': 'Öffentlicher Schlüssel', 'imp.chiave_segreta': 'Geheimer Schlüssel', 'aiuto.chiave_segreta': 'Signiert auch die Webhooks', 'imp.metodo': 'Standard-Versandart (ID, leer = Sendcloud-Regeln)', 'imp.peso': 'Standardgewicht des Pakets (kg)', 'az.etichetta': 'Sendcloud-Etikett erstellen', 'az.dove': 'Wo ist das Paket', 'az.metodi': 'Versandarten' },
    pt: { descrizione: 'Etiquetas e rastreio para BRT, Poste, GLS, SDA, DHL, UPS: o envio parte da venda e o estado volta sozinho.', 'imp.chiave_pubblica': 'Chave pública', 'imp.chiave_segreta': 'Chave secreta', 'aiuto.chiave_segreta': 'Também assina os webhooks', 'imp.metodo': 'Método de envio padrão (id, vazio = regras da Sendcloud)', 'imp.peso': 'Peso padrão do pacote (kg)', 'az.etichetta': 'Criar a etiqueta Sendcloud', 'az.dove': 'Onde está o pacote', 'az.metodi': 'Métodos de envio' },
  },
};
