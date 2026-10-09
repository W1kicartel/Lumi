// Sendcloud: l'etichetta di una vendita (BRT, Poste, GLS, SDA, DHL, UPS… con il contratto Sendcloud o con il tuo),
// il tracking che torna sulla vendita, e Lumi che risponde «dov'è il pacco di Rossi?».
// Basic con chiave pubblica e segreta dell'integrazione. L'etichetta si crea con l'API v3, POST /shipments/announce
// (sincrona, un pacco): la v2 POST /parcels è in manutenzione e chiusa agli account nati dal 13 aprile 2026
// (https://sendcloud.dev/docs/getting-started/api-version-guide). external_reference_id rende la creazione idempotente
// (un doppio clic riceve 409 con la spedizione già fatta). Lo stato si rilegge con GET /api/v2/parcels/{id}. Webhook
// parcel_status_changed firmati con Sendcloud-Signature = hex(HMAC-SHA256 del corpo grezzo, chiave segreta).
import { venditaDa, venditaDiChi, destinatario, segnaSpedizione, tondo, RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const api = (k, p, v = 'v2') => `${(k.base || 'https://panel.sendcloud.sc').replace(/\/$/, '')}/api/${v}${p}`;
const chiavi = k => ({ basic: [k.segreti.chiave_pubblica, k.segreti.chiave_segreta] });
const errore = r => new Error(`Sendcloud ha risposto ${r.stato}${r.json?.error?.message ? ': ' + r.json.error.message : r.json?.errors?.length ? ': ' + r.json.errors.map(e => e.detail || e.message || e.code).join('; ') : ''}`);

function spedizione(k, v, { peso, opzione } = {}) {
  const d = destinatario(k, v), o = String(opzione || k.imp.opzione || '').trim();
  if (!o) throw new Error('Manca il codice dell\'opzione di spedizione (impostazioni o «Opzioni di spedizione»)');
  if (!k.imp.mittente) throw new Error('Manca l\'indirizzo del mittente (id) nelle impostazioni');
  return {
    from_address: { sender_address_id: Number(k.imp.mittente) },
    to_address: { name: d.nome, address_line_1: d.via, house_number: d.civico || undefined, postal_code: d.cap, city: d.comune, country_code: d.paese,
      state_province_code: d.provincia ? `${d.paese}-${d.provincia}` : undefined, phone_number: d.telefono || undefined, email: d.email || undefined },
    ship_with: { type: 'shipping_option_code', properties: { shipping_option_code: o } },
    parcels: [{ weight: { value: String(tondo(peso || k.imp.peso || 1)), unit: 'kg' } }],
    order_number: String(v.numero ?? v.id), total_order_price: { value: String(tondo(k.valore(v, 'vendite', 'totale'))), currency: 'EUR' },
    external_reference_id: `kubo-${v.id}-${(k.stato.leggi('etichette') || {})[v.id] || 0}`,
  };
}

export default {
  id: 'sendcloud', nome: 'Sendcloud', versione: 1, icona: 'camion', base: 'https://panel.sendcloud.sc',
  descrizione: 'Etichette e tracking per BRT, Poste, GLS, SDA, DHL, UPS: la spedizione parte dalla vendita e lo stato ci torna da solo.',
  impostazioni: [
    { id: 'chiave_pubblica', nome: 'Chiave pubblica (Public key)', segreto: true },
    { id: 'chiave_segreta', nome: 'Chiave segreta (Secret key)', segreto: true, aiuto: 'Firma anche i webhook' },
    { id: 'mittente', nome: 'Indirizzo del mittente (id)', tipo: 'numero', aiuto: 'Impostazioni › Indirizzi › Indirizzo del mittente: il numero nell\'indirizzo della pagina' },
    { id: 'opzione', nome: 'Opzione di spedizione predefinita (codice)', aiuto: 'Premi «Opzioni di spedizione» per vedere i codici' },
    { id: 'peso', nome: 'Peso predefinito del pacco (kg)', tipo: 'numero', predefinito: 1 },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { const r = await k.http.get(api(k, '/user'), chiavi(k)); return { ok: r.ok, messaggio: r.ok ? r.json?.user?.company_name || r.json?.user?.username || null : `HTTP ${r.stato}` }; },
  azioni: {
    etichetta: {
      nome: 'Crea l\'etichetta Sendcloud', descrizione: 'crea il pacco e l\'etichetta per una vendita (indirizzo dal cliente della vendita)', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, peso: { tipo: 'numero', nome: 'Peso in kg (facoltativo)' }, opzione: { tipo: 'testo', nome: 'Codice dell\'opzione di spedizione (facoltativo)' } },
      proponi: (x, k) => { const v = venditaDa(k, x.vendita), s = spedizione(k, v, x), a = s.to_address, gia = k.sincro.remoto('vendite', v.id);
        return { titolo: 'Etichetta Sendcloud', righe: [['Vendita', v.numero ?? v.id], ['A', `${a.name}, ${a.address_line_1} ${a.house_number || ''}, ${a.postal_code} ${a.city}`.replace(' ,', ',')], ['Peso', `${s.parcels[0].weight.value} kg`], ['Opzione', s.ship_with.properties.shipping_option_code]],
          avvisi: gia ? [`Questa vendita ha già il pacco ${gia}: se confermi ne crei un altro`] : [] }; },
      async esegui(x, k) {
        const v = venditaDa(k, x.vendita), corpo = spedizione(k, v, x);
        if (k.sincro.remoto('vendite', v.id)) { const n = k.stato.leggi('etichette') || {}; n[v.id] = (n[v.id] || 0) + 1; k.stato.scrivi('etichette', n); corpo.external_reference_id = `kubo-${v.id}-${n[v.id]}`; }
        const r = await k.http.post(api(k, '/shipments/announce', 'v3'), { ...chiavi(k), json: corpo });
        const d = r.stato === 409 ? r.json?.data : r.ok ? r.json?.data : null; if (!d) throw errore(r);
        const p = d.parcels?.[0]; if (!p?.id) throw new Error(`Sendcloud non ha creato il pacco${d.errors?.length ? ': ' + d.errors.map(e => e.detail || e.message || e.code).join('; ') : ''}`);
        k.sincro.collega('vendite', v.id, p.id);
        segnaSpedizione(k, v.id, { corriere: (d.carrier?.code || '').toUpperCase(), tracking: p.tracking_number, stato: p.status?.message || 'Etichetta creata', url: p.tracking_url });
        return { ok: true, pacco: p.id, tracking: p.tracking_number, tracciamento: p.tracking_url, etichetta: p.documents?.find(x => x.type === 'label')?.link || p.documents?.[0]?.link || null };
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
    opzioni: {
      nome: 'Opzioni di spedizione', descrizione: 'le opzioni attive nel tuo account verso l\'Italia, con il codice da mettere nelle impostazioni',
      async esegui(x, k) { const r = await k.http.post(api(k, '/shipping-options', 'v3'), { ...chiavi(k), json: { from_country_code: 'IT', to_country_code: 'IT' } }); if (!r.ok) throw errore(r);
        return (r.json?.data || []).map(m => ({ codice: m.code, nome: m.name, corriere: m.carrier?.name || m.carrier?.code })); },
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
    costoNota: 'Free 0 € (20 etichette al mese), Lite 28 € (400), Growth 87 € (1.000), Premium 175 € (10.000), Pro 639 € (30.000) al mese, -20 % con il pagamento annuale; oltre la soglia 0,15 € a etichetta. Le etichette si pagano alle tariffe Sendcloud o con il tuo contratto.',
    serve: [
      { cosa: 'Chiave pubblica e chiave segreta di un\'integrazione «Sendcloud API»', dove: 'Pannello Sendcloud › Impostazioni › Integrazioni › Sendcloud API › Connetti', link: 'https://support.sendcloud.com/hc/en-us/articles/360024967252' },
      { cosa: 'L\'indirizzo dei webhook di Kubo (la «Webhook URL» dell\'integrazione)', dove: 'Stessa integrazione › Webhook feedback enabled', link: 'https://sendcloud.dev/api/v3/webhooks' },
    ],
    passi: [
      'In Sendcloud apri Impostazioni › Integrazioni, cerca «Sendcloud API» e premi Connetti.',
      'Dai un nome (Kubo), spunta «Webhook feedback enabled» e incolla come Webhook URL l\'indirizzo che Kubo mostra in questa pagina.',
      'Salva e copia la chiave pubblica e la chiave segreta in Kubo.',
      'Metti l\'id dell\'indirizzo del mittente (Impostazioni › Indirizzi) e, con «Opzioni di spedizione», il codice dell\'opzione che usi di solito.',
      'Controlla che i clienti abbiano via, CAP e comune: l\'indirizzo del pacco arriva da lì.',
      'Accendi: da una vendita premi «Crea l\'etichetta Sendcloud», oppure chiedi a Lumi «crea l\'etichetta per la vendita 1043».',
    ],
    difficolta: 'facile', zone: ['IT', 'UE'],
    fonti: ['https://sendcloud.dev/api/v3/shipments/create-and-announce-a-shipment-synchronously', 'https://sendcloud.dev/docs/getting-started/api-version-guide', 'https://sendcloud.dev/api/v3/webhooks', 'https://www.sendcloud.com/pricing/'],
    prova: 'finto', parole: ['sendcloud', 'spedizioni', 'etichette', 'tracking', 'corriere', 'brt', 'poste', 'gls', 'sda', 'dhl', 'ups', 'shipping', 'labels', 'parcel'],
  },
  testi: {
    en: { 'aiuto.mittente': 'Settings › Addresses › Sender address: the number in the page address', 'aiuto.opzione': 'Press «Shipping options» to see the codes', descrizione: 'Labels and tracking for BRT, Poste, GLS, SDA, DHL, UPS: the shipment starts from the sale and its status comes back by itself.', 'imp.chiave_pubblica': 'Public key', 'imp.chiave_segreta': 'Secret key', 'aiuto.chiave_segreta': 'Also signs the webhooks', 'imp.mittente': 'Sender address (id)', 'imp.opzione': 'Default shipping option (code)', 'imp.peso': 'Default parcel weight (kg)', 'az.etichetta': 'Create the Sendcloud label', 'az.dove': 'Where is the parcel', 'az.opzioni': 'Shipping options',
      'cat.costoNota': 'Free €0 (20 labels a month), Lite €28 (400), Growth €87 (1,000), Premium €175 (10,000), Pro €639 (30,000) a month, 20% off yearly; above the limit €0.15 per label. Labels are paid at Sendcloud rates or with your own contract.',
      'cat.serve': [{ cosa: 'Public and secret key of a «Sendcloud API» integration', dove: 'Sendcloud panel › Settings › Integrations › Sendcloud API › Connect' }, { cosa: 'Kubo\'s webhook address (the integration\'s «Webhook URL»)', dove: 'Same integration › Webhook feedback enabled' }],
      'cat.passi': ['In Sendcloud open Settings › Integrations, find «Sendcloud API» and press Connect.', 'Name it (Kubo), tick «Webhook feedback enabled» and paste as Webhook URL the address Kubo shows on this page.', 'Save and copy the public and secret keys into Kubo.', 'Enter the sender address id (Settings › Addresses) and, with «Shipping options», the code of the option you usually use.', 'Check that customers have street, postcode and city: the parcel address comes from there.', 'Switch on: from a sale press «Create the Sendcloud label», or ask Lumi «create the label for sale 1043».'] },
    es: { 'aiuto.mittente': 'Ajustes › Direcciones › Dirección del remitente: el número en la dirección de la página', 'aiuto.opzione': 'Pulsa «Opciones de envío» para ver los códigos', descrizione: 'Etiquetas y seguimiento para BRT, Poste, GLS, SDA, DHL, UPS: el envío sale de la venta y el estado vuelve solo.', 'imp.chiave_pubblica': 'Clave pública', 'imp.chiave_segreta': 'Clave secreta', 'aiuto.chiave_segreta': 'También firma los webhooks', 'imp.mittente': 'Dirección del remitente (id)', 'imp.opzione': 'Opción de envío predeterminada (código)', 'imp.peso': 'Peso predeterminado del paquete (kg)', 'az.etichetta': 'Crear la etiqueta Sendcloud', 'az.dove': 'Dónde está el paquete', 'az.opzioni': 'Opciones de envío' },
    fr: { 'aiuto.mittente': 'Paramètres › Adresses › Adresse de l\'expéditeur : le numéro dans l\'adresse de la page', 'aiuto.opzione': 'Appuyez sur «Options d\'envoi» pour voir les codes', descrizione: 'Étiquettes et suivi pour BRT, Poste, GLS, SDA, DHL, UPS : l\'envoi part de la vente et le statut revient tout seul.', 'imp.chiave_pubblica': 'Clé publique', 'imp.chiave_segreta': 'Clé secrète', 'aiuto.chiave_segreta': 'Signe aussi les webhooks', 'imp.mittente': 'Adresse de l\'expéditeur (id)', 'imp.opzione': 'Option d\'envoi par défaut (code)', 'imp.peso': 'Poids par défaut du colis (kg)', 'az.etichetta': 'Créer l\'étiquette Sendcloud', 'az.dove': 'Où est le colis', 'az.opzioni': 'Options d\'envoi' },
    de: { 'aiuto.mittente': 'Einstellungen › Adressen › Absenderadresse: die Nummer in der Seitenadresse', 'aiuto.opzione': '«Versandoptionen» zeigt die Codes', descrizione: 'Etiketten und Sendungsverfolgung für BRT, Poste, GLS, SDA, DHL, UPS: der Versand startet beim Verkauf, der Status kommt von selbst zurück.', 'imp.chiave_pubblica': 'Öffentlicher Schlüssel', 'imp.chiave_segreta': 'Geheimer Schlüssel', 'aiuto.chiave_segreta': 'Signiert auch die Webhooks', 'imp.mittente': 'Absenderadresse (ID)', 'imp.opzione': 'Standard-Versandoption (Code)', 'imp.peso': 'Standardgewicht des Pakets (kg)', 'az.etichetta': 'Sendcloud-Etikett erstellen', 'az.dove': 'Wo ist das Paket', 'az.opzioni': 'Versandoptionen' },
    pt: { 'aiuto.mittente': 'Configurações › Endereços › Endereço do remetente: o número no endereço da página', 'aiuto.opzione': 'Toque em «Opções de envio» para ver os códigos', descrizione: 'Etiquetas e rastreio para BRT, Poste, GLS, SDA, DHL, UPS: o envio parte da venda e o estado volta sozinho.', 'imp.chiave_pubblica': 'Chave pública', 'imp.chiave_segreta': 'Chave secreta', 'aiuto.chiave_segreta': 'Também assina os webhooks', 'imp.mittente': 'Endereço do remetente (id)', 'imp.opzione': 'Opção de envio padrão (código)', 'imp.peso': 'Peso padrão do pacote (kg)', 'az.etichetta': 'Criar a etiqueta Sendcloud', 'az.dove': 'Onde está o pacote', 'az.opzioni': 'Opções de envio' },
  },
};
