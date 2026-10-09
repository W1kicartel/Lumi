// Qapla': il tracking di tutte le spedizioni (BRT, GLS, SDA, Poste, DHL, UPS… più di 200 corrieri) con le email e gli SMS
// di avviso al cliente fatti da Qapla', e lo stato che torna sulla vendita.
// API 1.2 (https://api.qapla.dev/1.2/en/): https://api.qapla.it/1.2/<metodo>/, apiKey del canale nel corpo (POST) o nella
// query (GET). pushShipment (fino a 100 spedizioni: trackingNumber, courier, shipDate obbligatori), getShipment per
// trackingNumber con lo stato normalizzato (qaplaStatus) e la pagina di tracking (url). Limite: 150 gettoni al minuto per
// canale. Il webhook di Qapla' non documenta una firma: l'indirizzo porta il codice segreto di Kubo e lo stato si rilegge
// sempre con getShipment. Un giro ogni ora rilegge le spedizioni non ancora consegnate (al massimo 100 per giro).
import { venditaDa, venditaDiChi, destinatario, segnaSpedizione, tondo, RICHIEDE_SPEDIZIONI } from '../_negozi/comune.js';

const api = (k, m) => `${(k.base || 'https://api.qapla.it').replace(/\/$/, '')}/1.2/${m}/`;
const errore = (m, r) => new Error(`Qapla' (${m}) ha risposto ${r.stato}${r.json?.[m]?.error ? ': ' + r.json[m].error : ''}`);
async function leggi(k, numero) {
  const u = new URL(api(k, 'getShipment')); u.searchParams.set('apiKey', k.segreti.chiave); u.searchParams.set('trackingNumber', numero); u.searchParams.set('lang', 'it');
  const r = await k.http.get(u.href); if (!r.ok || r.json?.getShipment?.result === 'KO') throw errore('getShipment', r);
  return r.json.getShipment.shipments?.[0] || null;
}
// lo stato di Qapla' sulla vendita collegata a quel tracking; le consegnate escono dal giro
function scrivi(k, s) {
  const v = k.sincro.locale('vendite', s.trackingNumber); if (!v) return null;
  const stato = s.status?.qaplaStatus?.status || s.status?.status || 'In viaggio';
  segnaSpedizione(k, v, { corriere: s.courier?.name || s.courier?.code || '', tracking: s.trackingNumber, stato, url: s.url });
  const aperte = new Set(k.stato.leggi('aperte') || []); if (s.isDelivered) aperte.delete(s.trackingNumber); else aperte.add(s.trackingNumber); k.stato.scrivi('aperte', [...aperte]);
  return stato;
}

export default {
  id: 'qapla', nome: 'Qapla\'', versione: 1, icona: 'camion', base: 'https://api.qapla.it',
  descrizione: 'Il tracking di ogni corriere in un posto: Qapla\' avvisa il cliente e lo stato della spedizione torna sulla vendita.',
  impostazioni: [
    { id: 'chiave', nome: 'API key del canale', segreto: true, aiuto: 'Qapla\' › Impostazioni › Canali › il tuo canale › API key' },
    { id: 'codice', nome: 'Codice segreto del webhook', segreto: true, generato: true },
  ],
  richiede: RICHIEDE_SPEDIZIONI,
  permessi: { vendite: { leggi: true, modifica: true }, clienti: { leggi: true } },
  prova: async k => { const u = new URL(api(k, 'getShipments')); u.searchParams.set('apiKey', k.segreti.chiave); u.searchParams.set('dateFrom', new Date().toISOString().slice(0, 10));
    const r = await k.http.get(u.href); return { ok: r.ok && r.json?.getShipments?.result !== 'KO', messaggio: r.json?.getShipments?.error || (r.ok ? null : `HTTP ${r.stato}`) }; },
  azioni: {
    traccia: {
      nome: 'Traccia con Qapla\'', descrizione: 'manda a Qapla\' il tracking di una vendita: Qapla\' segue il pacco e avvisa il cliente', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'testo', nome: 'Numero o id della vendita' }, tracking: { tipo: 'testo', nome: 'Numero di tracking' }, corriere: { tipo: 'testo', nome: 'Codice del corriere Qapla\' (BRT, GLS-ITA, SDA, PTI, DHL, UPS…)' } },
      proponi: ({ vendita, tracking, corriere }, k) => { const v = venditaDa(k, vendita); let a = null; try { a = destinatario(k, v); } catch { a = null; }
        return { titolo: 'Tracking con Qapla\'', righe: [['Vendita', v.numero ?? v.id], ['Corriere', String(corriere || '').toUpperCase()], ['Tracking', tracking], ['Avvisi a', a?.email || a?.telefono || '—']], avvisi: a ? [] : ['Il cliente non ha un indirizzo completo: Qapla\' traccia lo stesso, ma senza avvisi'] }; },
      async esegui({ vendita, tracking, corriere }, k) {
        const v = venditaDa(k, vendita); let a = {}; try { a = destinatario(k, v); } catch { a = {}; }
        const r = await k.http.post(api(k, 'pushShipment'), { json: { apiKey: k.segreti.chiave, pushShipment: [{
          reference: String(v.numero ?? v.id), trackingNumber: String(tracking).trim(), courier: String(corriere || '').trim().toUpperCase(), shipDate: new Date().toISOString().slice(0, 10),
          name: a.nome, email: a.email || undefined, telephone: a.telefono || undefined, street: a.indirizzo, city: a.comune, ZIP: a.cap, state: a.provincia, country: a.paese, amount: tondo(k.valore(v, 'vendite', 'totale')), language: 'it' }] } });
        const s = r.json?.pushShipment?.shipments?.[0];
        if (!r.ok || r.json?.pushShipment?.result === 'KO' || s?.result === 'KO') throw new Error(`Qapla' non ha preso la spedizione: ${s?.error || r.json?.pushShipment?.error || r.stato}`);
        k.sincro.collega('vendite', v.id, String(tracking).trim());
        scrivi(k, { trackingNumber: String(tracking).trim(), url: s?.url, courier: { code: s?.courier || corriere }, status: { status: 'Affidata al corriere' } });
        return { ok: true, tracciamento: s?.url || null };
      },
    },
    dove: {
      nome: 'Dov\'è il pacco', descrizione: 'lo stato della spedizione di una vendita, o dell\'ultima spedizione di un cliente (per nome)', su: 'vendite', lumi: true,
      input: { chi: { tipo: 'testo', nome: 'Numero della vendita o nome del cliente' } },
      async esegui({ chi }, k) {
        const { vendita, remoto } = venditaDiChi(k, chi); if (!remoto) throw new Error('Questa vendita non è tracciata con Qapla\'');
        const s = await leggi(k, remoto); if (!s) throw new Error(`Qapla' non conosce il tracking ${remoto}`);
        return { vendita: vendita.numero ?? vendita.id, stato: scrivi(k, s), consegnato: !!s.isDelivered, dove: s.status?.place || null, quando: s.status?.date || null, tracciamento: s.url, corriere: s.courier?.name };
      },
    },
  },
  pianificati: { stati: { nome: 'Stato delle spedizioni', ogni: '1h', async giro(k) {
    const conti = { lette: 0, consegnate: 0 };
    for (const n of (k.stato.leggi('aperte') || []).slice(0, 100)) { const s = await leggi(k, n); if (!s) continue; scrivi(k, s); conti.lette++; if (s.isDelivered) conti.consegnate++; }
    return conti;
  } } },
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    idempotenza: () => null,
    async gestisci(ev, k) {
      const n = ev?.trackingNumber || ev?.shipment?.trackingNumber || ev?.data?.trackingNumber || ev?.getShipment?.shipments?.[0]?.trackingNumber;
      if (!n || !k.sincro.locale('vendite', n)) return 'ignorato';
      const s = await leggi(k, n); return s ? `spedizione: ${scrivi(k, s)}` : 'ignorato';   // niente firma: lo stato si rilegge
    },
  },
  catalogo: {
    categoria: 'spedizioni', sito: 'https://www.qapla.it', costo: 'abbonamento',
    costoNota: 'Abbonamento mensile in base alle spedizioni tracciate, con prova gratuita; i prezzi aggiornati sono nella pagina dei piani di qapla.it (le API sono incluse).',
    serve: [
      { cosa: 'API key del canale (un canale per negozio o per Kubo)', dove: 'Pannello Qapla\' › Impostazioni › Canali › il canale › API key', link: 'https://api.qapla.dev/1.2/en/' },
      { cosa: 'Facoltativo: l\'indirizzo del webhook di Kubo (con il codice segreto) nelle notifiche del canale', dove: 'Pannello Qapla\' › Impostazioni › Notifiche › Webhook', link: 'https://webhook.qapla.dev' },
    ],
    passi: [
      'Nel pannello di Qapla\' crea (o scegli) un canale per Kubo e copia la sua API key.',
      'In Kubo incolla l\'API key, premi «Prova la connessione» e accendi.',
      'Facoltativo: copia l\'indirizzo del webhook che Kubo mostra (finisce con il codice segreto) nelle notifiche webhook del canale, per avere gli stati subito.',
      'Quando spedisci, dalla vendita premi «Traccia con Qapla\'» con tracking e corriere (BRT, GLS-ITA, SDA, PTI per Poste, DHL, UPS…), oppure chiedilo a Lumi.',
      'Lo stato torna sulla vendita (ogni ora, o subito con il webhook) e Lumi risponde a «dov\'è il pacco di Rossi?».',
    ],
    difficolta: 'facile', zone: ['IT', 'UE'],
    fonti: ['https://api.qapla.dev/1.2/en/', 'https://webhook.qapla.dev'],
    prova: 'finto', parole: ['qapla', 'tracking', 'spedizioni', 'corrieri', 'notifiche', 'brt', 'gls', 'sda', 'poste', 'tracking page', 'shipment tracking'],
  },
  testi: {
    en: { nome: 'Qapla\'', descrizione: 'Tracking for every carrier in one place: Qapla\' notifies the customer and the shipment status comes back to the sale.', 'imp.chiave': 'Channel API key', 'aiuto.chiave': 'Qapla\' › Settings › Channels › your channel › API key', 'imp.codice': 'Webhook secret code', 'az.traccia': 'Track with Qapla\'', 'az.dove': 'Where is the parcel', 'giro.stati': 'Shipment status',
      'cat.costoNota': 'Monthly subscription based on tracked shipments, with a free trial; current prices are on qapla.it\'s plans page (APIs included).',
      'cat.serve': [{ cosa: 'Channel API key (one channel per shop or for Kubo)', dove: 'Qapla\' panel › Settings › Channels › the channel › API key' }, { cosa: 'Optional: Kubo\'s webhook address (with the secret code) in the channel notifications', dove: 'Qapla\' panel › Settings › Notifications › Webhook' }],
      'cat.passi': ['In the Qapla\' panel create (or pick) a channel for Kubo and copy its API key.', 'In Kubo paste the API key, press «Test connection» and switch on.', 'Optional: copy the webhook address Kubo shows (it ends with the secret code) into the channel webhook notifications, to get statuses at once.', 'When you ship, press «Track with Qapla\'» on the sale with tracking and carrier (BRT, GLS-ITA, SDA, PTI for Poste, DHL, UPS…), or ask Lumi.', 'The status comes back to the sale (hourly, or at once with the webhook) and Lumi answers «where is Rossi\'s parcel?».'] },
    es: { nome: 'Qapla\'', descrizione: 'El seguimiento de todos los transportistas en un sitio: Qapla\' avisa al cliente y el estado vuelve a la venta.', 'imp.chiave': 'API key del canal', 'aiuto.chiave': 'Qapla\' › Ajustes › Canales › tu canal › API key', 'imp.codice': 'Código secreto del webhook', 'az.traccia': 'Seguir con Qapla\'', 'az.dove': 'Dónde está el paquete', 'giro.stati': 'Estado de los envíos' },
    fr: { nome: 'Qapla\'', descrizione: 'Le suivi de tous les transporteurs au même endroit : Qapla\' prévient le client et le statut revient sur la vente.', 'imp.chiave': 'Clé API du canal', 'aiuto.chiave': 'Qapla\' › Paramètres › Canaux › votre canal › API key', 'imp.codice': 'Code secret du webhook', 'az.traccia': 'Suivre avec Qapla\'', 'az.dove': 'Où est le colis', 'giro.stati': 'Statut des envois' },
    de: { nome: 'Qapla\'', descrizione: 'Sendungsverfolgung aller Kuriere an einem Ort: Qapla\' benachrichtigt den Kunden, der Status kommt zum Verkauf zurück.', 'imp.chiave': 'API-Schlüssel des Kanals', 'aiuto.chiave': 'Qapla\' › Einstellungen › Kanäle › dein Kanal › API key', 'imp.codice': 'Geheimer Webhook-Code', 'az.traccia': 'Mit Qapla\' verfolgen', 'az.dove': 'Wo ist das Paket', 'giro.stati': 'Status der Sendungen' },
    pt: { nome: 'Qapla\'', descrizione: 'O rastreio de todas as transportadoras num só lugar: a Qapla\' avisa o cliente e o estado volta para a venda.', 'imp.chiave': 'API key do canal', 'aiuto.chiave': 'Qapla\' › Configurações › Canais › seu canal › API key', 'imp.codice': 'Código secreto do webhook', 'az.traccia': 'Rastrear com a Qapla\'', 'az.dove': 'Onde está o pacote', 'giro.stati': 'Estado dos envios' },
  },
};
