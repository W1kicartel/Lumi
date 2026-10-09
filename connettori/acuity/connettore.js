// Acuity Scheduling (Squarespace): le prenotazioni diventano appuntamenti di Lumi, con il cliente (per email o telefono,
// altrimenti creato) e le risposte del modulo di prenotazione nelle note. Spostamenti e annullamenti seguono.
// - Webhook: form-urlencoded con solo action (scheduled, rescheduled, canceled, changed) e id, firmato con
//   «X-Acuity-Signature: <base64 HMAC-SHA256 del corpo con la chiave API>»; l'appuntamento si rilegge da
//   GET /api/v1/appointments/{id} (Basic user id + chiave API).
// - Senza indirizzo pubblico: un giro ogni 15 minuti legge gli appuntamenti dei prossimi 60 giorni e quelli annullati.
import { REQ, PERMESSI, ricevi, annulla, conta, webhookDi, indirizzoDi, MANCA_INDIRIZZO } from '../_comunica/agenda.js';
const api = k => `${k.base || 'https://acuityscheduling.com'}/api/v1`;
const chiedi = (k, percorso, opz = {}) => k.http[opz.json ? 'post' : 'get'](`${api(k)}${percorso}`, { basic: [k.imp.utente, k.segreti.chiave], ...opz });
const no = (r, cosa) => new Error(`Acuity ha risposto ${r.stato} a ${cosa}${r.json?.message ? ': ' + r.json.message : ''}`);
// «2026-10-20T10:00:00+0200» → con i due punti nel fuso, che Date.parse legge ovunque
const iso = s => String(s || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
const note = a => [`Acuity: ${a.type || 'appuntamento'}${a.calendar ? ` · ${a.calendar}` : ''}`, a.location && `Dove: ${a.location}`, a.notes,
  ...(a.forms || []).flatMap(f => (f.values || []).filter(v => v.value).map(v => `${v.name}: ${v.value}`))].filter(Boolean).join('\n');
export function riceviAcuity(k, a) {
  if (a.canceled) return annulla(k, String(a.id));
  return ricevi(k, { remoto: String(a.id), quando: iso(a.datetime), servizio: a.type, note: note(a), creaClienti: k.imp.clienti !== false,
    cliente: { email: a.email, nome: [a.firstName, a.lastName].filter(Boolean).join(' '), telefono: a.phone } });
}
async function giro(k) {
  const conti = { creati: 0, spostati: 0, uguali: 0, saltati: 0, annullati: 0 }, oggi = new Date().toISOString().slice(0, 10), fino = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const r = await chiedi(k, `/appointments?${new URLSearchParams({ minDate: oggi, maxDate: fino, max: '500', direction: 'ASC' })}`); if (!r.ok) throw no(r, 'gli appuntamenti');
  for (const a of r.json || []) conta(conti, riceviAcuity(k, a));
  const c = await chiedi(k, `/appointments?${new URLSearchParams({ minDate: oggi, maxDate: fino, max: '500', canceled: 'true' })}`); if (!c.ok) throw no(c, 'gli annullati');
  for (const a of c.json || []) if (annulla(k, String(a.id)) === 'annullato') conti.annullati++;
  return conti;
}
const EVENTI = ['appointment.scheduled', 'appointment.rescheduled', 'appointment.canceled'];

export default {
  id: 'acuity', nome: 'Acuity Scheduling', versione: 1, icona: 'calendario',
  descrizione: 'Le prenotazioni di Acuity Scheduling diventano appuntamenti, con il cliente.',
  impostazioni: [
    { id: 'utente', nome: 'User ID', schema: /^\d{1,15}$/ },
    { id: 'chiave', nome: 'Chiave API', segreto: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Lumi (es. https://lumi.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  prova: async k => { const r = await chiedi(k, '/me'); return { ok: r.ok, messaggio: r.ok ? `${r.json?.name || r.json?.email} (${r.json?.timezone || ''})` : `HTTP ${r.stato}` }; },
  pianificati: { appuntamenti: { nome: 'Appuntamenti dei prossimi 60 giorni', ogni: '15m', giro } },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-acuity-signature', segreto: 'chiave', formato: 'base64' },
    async gestisci(ev, k) {
      const azione = String(ev?.action || '').replace(/^appointment\./, '');
      if (!['scheduled', 'rescheduled', 'canceled', 'changed'].includes(azione) || !/^\d+$/.test(String(ev.id || ''))) return 'ignorato';
      const r = await chiedi(k, `/appointments/${ev.id}`); if (!r.ok) throw no(r, `l'appuntamento ${ev.id}`);
      if (azione === 'canceled') return annulla(k, String(ev.id));
      return riceviAcuity(k, r.json || {});
    },
  },
  azioni: {
    registra_webhook: {
      nome: 'Registra il webhook su Acuity', descrizione: 'Chiede ad Acuity di avvisare Lumi a ogni prenotazione, spostamento e annullamento', scrive: true,
      proponi: async (a, k) => ({ titolo: 'Webhook di Acuity', righe: [['Indirizzo', webhookDi(k, 'acuity')], ['Eventi', EVENTI.join(', ')]], avvisi: indirizzoDi(k) ? [] : [MANCA_INDIRIZZO] }),
      async esegui(a, k) {
        if (!indirizzoDi(k)) throw new Error(MANCA_INDIRIZZO);
        const fatti = [];
        for (const event of EVENTI) { const r = await chiedi(k, '/webhooks', { json: { event, target: webhookDi(k, 'acuity') } }); if (!r.ok) throw no(r, `il webhook ${event}`); fatti.push(r.json?.id); }
        return { webhook: fatti };
      },
    },
    leggi_appuntamenti: {
      nome: 'Leggi le prenotazioni adesso', descrizione: 'Porta in agenda le prenotazioni di Acuity dei prossimi 60 giorni e segna quelle annullate', lumi: true, scrive: true,
      proponi: async () => ({ titolo: 'Prenotazioni da Acuity', righe: [['Periodo', 'oggi + 60 giorni']], avvisi: ['Le prenotazioni nuove diventano appuntamenti, gli annullamenti si segnano'] }),
      esegui: async (x, k) => giro(k),
    },
  },
  catalogo: {
    categoria: 'prenotazioni', sito: 'https://acuityscheduling.com', costo: 'abbonamento',
    costoNota: 'API e webhook servono il piano Premium: 49 $ al mese con pagamento annuale (61 $ mese per mese); Starter (16 $) e Standard (27 $) non hanno l\'API.',
    serve: [
      { cosa: 'User ID e chiave API', dove: 'Acuity → Integrazioni → API → Visualizza credenziali (in fondo alla pagina)', link: 'https://secure.acuityscheduling.com/app.php?action=settings&key=api' },
      { cosa: 'Per avere gli avvisi subito: un indirizzo pubblico di Lumi con HTTPS', dove: 'Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
    ],
    passi: ['Su Acuity apri Integrazioni → API e premi «Visualizza credenziali».', 'Incolla qui User ID e chiave API, poi premi «Prova la connessione».', 'Premi «Leggi le prenotazioni adesso»: arrivano quelle dei prossimi 60 giorni, poi ogni 15 minuti.', 'Se Lumi ha un indirizzo pubblico, scrivilo (se l\'hai impostato nella Libreria, puoi lasciarlo vuoto) e premi «Registra il webhook su Acuity»: le prenotazioni arrivano in pochi secondi.', 'Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.acuityscheduling.com/docs/webhooks', 'https://developers.acuityscheduling.com/reference/get-appointments-id', 'https://developers.acuityscheduling.com/reference/post-webhooks', 'https://developers.acuityscheduling.com/docs/quick-start', 'https://acuityscheduling.com/signup.php'],
    prova: 'finto', parole: ['acuity', 'acuity scheduling', 'squarespace', 'prenotazioni', 'prenotazione online', 'booking', 'appuntamenti', 'scheduling'],
  },
  testi: {
    en: { nome: 'Acuity Scheduling', descrizione: 'Acuity Scheduling bookings become appointments, with the customer.', 'imp.utente': 'User ID', 'imp.chiave': 'API key', 'imp.indirizzo': 'Public address of Lumi (e.g. https://lumi.mystudio.com)', 'imp.clienti': 'Create the customer if missing', 'az.registra_webhook': 'Register the webhook on Acuity', 'az.leggi_appuntamenti': 'Read the bookings now', 'giro.appuntamenti': 'Appointments of the next 60 days',
      'cat.costoNota': 'API and webhooks need the Premium plan: $49 a month billed yearly ($61 month to month); Starter ($16) and Standard ($27) have no API.',
      'cat.serve': [{ cosa: 'User ID and API key', dove: 'Acuity → Integrations → API → View credentials (at the bottom of the page)' }, { cosa: 'To get bookings instantly: a public HTTPS address for Lumi', dove: 'Your domain with HTTPS, or a tunnel (Cloudflare Tunnel)' }],
      'cat.passi': ['In Acuity open Integrations → API and press «View credentials».', 'Paste the User ID and API key here, then press «Test connection».', 'Press «Read the bookings now»: those of the next 60 days arrive, then every 15 minutes.', 'If Lumi has a public address, enter it (if you set it in the Library, you can leave it empty) and press «Register the webhook on Acuity»: bookings arrive within seconds.', 'Make a test booking: it shows up among the appointments, with the customer.'] },
    es: { nome: 'Acuity Scheduling', descrizione: 'Las reservas de Acuity Scheduling se convierten en citas, con el cliente.', 'imp.utente': 'User ID', 'imp.chiave': 'Clave API', 'imp.indirizzo': 'Dirección pública de Lumi (p. ej. https://lumi.miestudio.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.registra_webhook': 'Registrar el webhook en Acuity', 'az.leggi_appuntamenti': 'Leer las reservas ahora', 'giro.appuntamenti': 'Citas de los próximos 60 días' },
    fr: { nome: 'Acuity Scheduling', descrizione: 'Les réservations Acuity Scheduling deviennent des rendez-vous, avec le client.', 'imp.utente': 'User ID', 'imp.chiave': 'Clé API', 'imp.indirizzo': 'Adresse publique de Lumi (ex. https://lumi.moncabinet.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.registra_webhook': 'Enregistrer le webhook sur Acuity', 'az.leggi_appuntamenti': 'Lire les réservations maintenant', 'giro.appuntamenti': 'Rendez-vous des 60 prochains jours' },
    de: { nome: 'Acuity Scheduling', descrizione: 'Acuity-Scheduling-Buchungen werden zu Terminen, mit dem Kunden.', 'imp.utente': 'User ID', 'imp.chiave': 'API-Schlüssel', 'imp.indirizzo': 'Öffentliche Adresse von Lumi (z. B. https://lumi.meinestudio.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.registra_webhook': 'Webhook bei Acuity registrieren', 'az.leggi_appuntamenti': 'Buchungen jetzt lesen', 'giro.appuntamenti': 'Termine der nächsten 60 Tage' },
    pt: { nome: 'Acuity Scheduling', descrizione: 'As reservas do Acuity Scheduling viram agendamentos, com o cliente.', 'imp.utente': 'User ID', 'imp.chiave': 'Chave API', 'imp.indirizzo': 'Endereço público do Lumi (ex. https://lumi.meuestudio.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.registra_webhook': 'Registrar o webhook no Acuity', 'az.leggi_appuntamenti': 'Ler as reservas agora', 'giro.appuntamenti': 'Agendamentos dos próximos 60 dias' },
  },
};
