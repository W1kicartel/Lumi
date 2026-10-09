// Zoom: la riunione per un appuntamento a distanza, con un clic o chiedendola a Lumi («fai una riunione Zoom per la
// consulenza di domani con Rossi»). Il link va nelle note dell'appuntamento (e da lì, se ci sono, a Outlook o al CalDAV).
// Se l'appuntamento si sposta, la riunione si sposta (stesso link); se si annulla, la riunione si cancella.
// Accesso: app Server-to-Server OAuth dell'account (account_id, client_id, client_secret); il token si chiede con
// grant_type=account_credentials e Basic client_id:client_secret, vale un'ora e si tiene in memoria.
import { titoloDi, fineDi, annullato } from '../_comunica/agenda.js';
const SEM = 'appuntamenti';
const api = k => (k.base ? `${k.base}/v2` : 'https://api.zoom.us/v2');
const tokens = new Map();
async function token(k) {
  const chiave = `${k.base}|${k.imp.account_id}|${k.segreti.client_id}`, t = tokens.get(chiave);
  if (t && t.scade - Date.now() > 6e4) return t.valore;
  const r = await k.http.post(k.base ? `${k.base}/oauth/token` : 'https://zoom.us/oauth/token', { basic: [k.segreti.client_id, k.segreti.client_secret], form: { grant_type: 'account_credentials', account_id: k.imp.account_id } });
  if (!r.ok || !r.json?.access_token) throw new Error(`Zoom non dà l'accesso (${r.stato}): controlla Account ID, Client ID e Client secret`);
  tokens.set(chiave, { valore: r.json.access_token, scade: Date.now() + Number(r.json.expires_in || 3600) * 1000 });
  return r.json.access_token;
}
const durata = (k, r) => Math.max(15, Math.round((Date.parse(fineDi(k, r)) - Date.parse(k.valore(r, SEM, 'quando'))) / 6e4));
const quando = (k, r) => new Date(k.valore(r, SEM, 'quando')).toLocaleString('it-IT', { timeZone: k.fuso(), dateStyle: 'medium', timeStyle: 'short' });
// la riunione segue l'appuntamento: spostata con PATCH (il link non cambia), annullata con DELETE
async function segui(r, k) {
  const id = k.sincro.remoto(SEM, r.id); if (!id) return null;
  const tok = await token(k), url = `${api(k)}/meetings/${encodeURIComponent(id)}`;
  const x = annullato(k, r) ? await k.http.delete(url, { bearer: tok }) : await k.http.patch(url, { bearer: tok, json: { start_time: new Date(k.valore(r, SEM, 'quando')).toISOString().replace(/\.\d{3}Z$/, 'Z'), duration: durata(k, r) } });
  if (!x.ok && x.stato !== 404) throw new Error(`Zoom ha risposto ${x.stato}`);
  return x.stato;
}

export default {
  id: 'zoom', nome: 'Zoom', versione: 1, icona: 'calendario',
  descrizione: 'Una riunione Zoom per gli appuntamenti a distanza, con il link nelle note.',
  impostazioni: [
    { id: 'account_id', nome: 'Account ID' },
    { id: 'client_id', nome: 'Client ID', segreto: true }, { id: 'client_secret', nome: 'Client secret', segreto: true },
    { id: 'durata', nome: 'Durata di un appuntamento senza servizio (minuti)', tipo: 'numero', predefinito: 60 },
  ],
  richiede: { appuntamenti: { quando: { tipo: ['data_ora'] }, note: { tipo: ['testo_lungo', 'testo'] }, stato: { tipo: 'stato', facoltativo: true } } },
  permessi: { appuntamenti: { leggi: true, modifica: true }, servizi: { leggi: true } },
  prova: async k => { await token(k); return { ok: true, messaggio: 'Accesso a Zoom riuscito' }; },
  azioni: {
    crea_riunione: {
      nome: 'Crea la riunione Zoom', descrizione: 'Crea una riunione Zoom all\'ora dell\'appuntamento e ne scrive il link nelle note', su: SEM, lumi: true, scrive: true,
      input: { appuntamento: { tipo: 'relazione', entita: SEM, nome: 'L\'appuntamento' } },
      proponi: async ({ appuntamento: a }, k) => ({ titolo: 'Riunione Zoom', righe: [['Appuntamento', titoloDi(k, a)], ['Quando', quando(k, a)], ['Durata', `${durata(k, a)} min`]],
        avvisi: [...(k.sincro.remoto(SEM, a.id) ? ['C\'è già una riunione: si aggiorna l\'ora, il link resta quello'] : []), ...(annullato(k, a) ? ['L\'appuntamento è annullato'] : [])] }),
      async esegui({ appuntamento: a }, k) {
        if (annullato(k, a)) throw new Error('L\'appuntamento è annullato');
        if (k.sincro.remoto(SEM, a.id)) { await segui(a, k); return { aggiornata: true }; }
        const r = await k.http.post(`${api(k)}/users/me/meetings`, { bearer: await token(k), json: { topic: titoloDi(k, a), type: 2, start_time: new Date(k.valore(a, SEM, 'quando')).toISOString().replace(/\.\d{3}Z$/, 'Z'),
          duration: durata(k, a), timezone: k.fuso(), settings: { waiting_room: true, join_before_host: false } } });
        if (!r.ok || !r.json?.join_url) throw new Error(`Zoom ha risposto ${r.stato}${r.json?.message ? ': ' + r.json.message : ''}`);
        const note = k.valore(a, SEM, 'note');
        k.dati.modifica(SEM, a.id, { note: [note, `Zoom: ${r.json.join_url}`].filter(Boolean).join('\n') });
        k.sincro.collega(SEM, a.id, r.json.id);
        return { link: r.json.join_url, id: r.json.id };
      },
    },
  },
  uscita: { appuntamenti: { campi: ['quando', 'stato'], quando: (r, k) => !!k.sincro.remoto(SEM, r.id), invia: async (r, k) => { await segui(r, k); } } },
  catalogo: {
    categoria: 'calendario', sito: 'https://zoom.us', costo: 'abbonamento',
    costoNota: 'Il piano Basic è gratis ma le riunioni con 3 o più persone durano al massimo 40 minuti; Pro da 13,33 € al mese a licenza (annuale). Le app Server-to-Server OAuth non costano.',
    serve: [
      { cosa: 'Un\'app Server-to-Server OAuth con Account ID, Client ID e Client secret', dove: 'marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth App → App Credentials', link: 'https://marketplace.zoom.us/develop/create' },
      { cosa: 'Gli scope per creare e modificare le riunioni', dove: 'La tua app → Scopes → Add Scopes → Meeting: meeting:write:meeting:admin, meeting:update:meeting:admin, meeting:delete:meeting:admin', link: 'https://developers.zoom.us/docs/internal-apps/s2s-oauth/' },
    ],
    passi: ['Su marketplace.zoom.us apri Develop → Build App e scegli Server-to-Server OAuth App (serve un utente amministratore).', 'Copia Account ID, Client ID e Client secret in Kubo.', 'In Scopes aggiungi la creazione, la modifica e la cancellazione delle riunioni.', 'In Activation premi Activate your app.', 'Premi «Prova», poi sull\'appuntamento «Crea la riunione Zoom» (o chiedilo a Lumi): il link va nelle note.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.zoom.us/docs/internal-apps/s2s-oauth/', 'https://developers.zoom.us/docs/api/meetings/#tag/meetings/POST/users/{userId}/meetings', 'https://zoom.us/pricing'],
    prova: 'finto', parole: ['zoom', 'riunione', 'videochiamata', 'video call', 'meeting', 'consulenza online', 'teleconsulto'],
  },
  testi: {
    en: { nome: 'Zoom', descrizione: 'A Zoom meeting for remote appointments, with the link in the notes.', 'imp.account_id': 'Account ID', 'imp.client_id': 'Client ID', 'imp.client_secret': 'Client secret', 'imp.durata': 'Length of an appointment without a service (minutes)', 'az.crea_riunione': 'Create the Zoom meeting',
      'cat.costoNota': 'The Basic plan is free but meetings with 3 or more people last at most 40 minutes; Pro from €13.33 a month per license (yearly). Server-to-Server OAuth apps cost nothing.',
      'cat.passi': ['On marketplace.zoom.us open Develop → Build App and pick Server-to-Server OAuth App (an admin user is needed).', 'Copy Account ID, Client ID and Client secret into Kubo.', 'Under Scopes add creating, updating and deleting meetings.', 'Under Activation press Activate your app.', 'Press «Test», then on the appointment «Create the Zoom meeting» (or ask Lumi): the link goes into the notes.'],
      'cat.serve': [{ cosa: 'A Server-to-Server OAuth app with Account ID, Client ID and Client secret', dove: 'marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth App → App Credentials' }, { cosa: 'The scopes to create and update meetings', dove: 'Your app → Scopes → Add Scopes → Meeting: meeting:write:meeting:admin, meeting:update:meeting:admin, meeting:delete:meeting:admin' }] },
    es: { nome: 'Zoom', descrizione: 'Una reunión de Zoom para las citas a distancia, con el enlace en las notas.', 'imp.account_id': 'Account ID', 'imp.client_id': 'Client ID', 'imp.client_secret': 'Client secret', 'imp.durata': 'Duración de una cita sin servicio (minutos)', 'az.crea_riunione': 'Crear la reunión de Zoom' },
    fr: { nome: 'Zoom', descrizione: 'Une réunion Zoom pour les rendez-vous à distance, avec le lien dans les notes.', 'imp.account_id': 'Account ID', 'imp.client_id': 'Client ID', 'imp.client_secret': 'Client secret', 'imp.durata': 'Durée d\'un rendez-vous sans prestation (minutes)', 'az.crea_riunione': 'Créer la réunion Zoom' },
    de: { nome: 'Zoom', descrizione: 'Ein Zoom-Meeting für Termine aus der Ferne, mit dem Link in den Notizen.', 'imp.account_id': 'Account-ID', 'imp.client_id': 'Client-ID', 'imp.client_secret': 'Client-Secret', 'imp.durata': 'Dauer eines Termins ohne Leistung (Minuten)', 'az.crea_riunione': 'Zoom-Meeting erstellen' },
    pt: { nome: 'Zoom', descrizione: 'Uma reunião Zoom para os agendamentos a distância, com o link nas notas.', 'imp.account_id': 'Account ID', 'imp.client_id': 'Client ID', 'imp.client_secret': 'Client secret', 'imp.durata': 'Duração de um agendamento sem serviço (minutos)', 'az.crea_riunione': 'Criar a reunião Zoom' },
  },
};
