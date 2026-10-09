// Whereby: la stanza video per un appuntamento a distanza, con un clic o chiedendola a Lumi. Il link per il cliente e
// quello di chi ospita vanno nelle note dell'appuntamento; con «automatico» ogni appuntamento nuovo prende la sua stanza.
// - API REST: POST https://api.whereby.dev/v1/meetings { endDate, roomNamePrefix, roomMode, fields: ['hostRoomUrl'] }
//   con la chiave API come Bearer. La stanza vive fino a un'ora dopo endDate, poi Whereby la cancella da sola.
// - Una stanza non si sposta: se l'appuntamento si sposta se ne crea una nuova (link nuovo nelle note) e la vecchia si
//   cancella; se l'appuntamento si annulla, la stanza si cancella (DELETE /v1/meetings/{meetingId}).
import { titoloDi, fineDi, annullato } from '../_comunica/agenda.js';
const SEM = 'appuntamenti';
const api = k => `${k.base || 'https://api.whereby.dev'}/v1`;
const RIGHE = /^Whereby(?: \([^)]*\))?: https?:\/\/\S+$/;
const quando = (k, r) => new Date(k.valore(r, SEM, 'quando')).toLocaleString('it-IT', { timeZone: k.fuso(), dateStyle: 'medium', timeStyle: 'short' });
const no = (r, cosa) => new Error(`Whereby ha risposto ${r.stato} a ${cosa}${r.json?.error ? ': ' + r.json.error : ''}`);
// le note senza le righe di Whereby scritte prima
const pulite = (k, r) => String(k.valore(r, SEM, 'note') || '').split('\n').filter(l => !RIGHE.test(l.trim())).join('\n').trim();
async function togli(k, id) {
  const x = await k.http.delete(`${api(k)}/meetings/${encodeURIComponent(id)}`, { bearer: k.segreti.chiave });
  if (!x.ok && x.stato !== 404) throw no(x, 'la cancellazione della stanza');
}
// crea la stanza (fino alla fine dell'appuntamento) e scrive i link nelle note, al posto di quelli vecchi
async function stanza(k, r) {
  const x = await k.http.post(`${api(k)}/meetings`, { bearer: k.segreti.chiave, json: { endDate: fineDi(k, r), roomMode: k.imp.gruppo ? 'group' : 'normal', fields: ['hostRoomUrl'],
    ...(k.imp.prefisso ? { roomNamePrefix: String(k.imp.prefisso).toLowerCase() } : {}) } });
  if (!x.ok || !x.json?.roomUrl) throw no(x, 'la creazione della stanza');
  const { meetingId, roomUrl, hostRoomUrl } = x.json;
  k.dati.modifica(SEM, r.id, { note: [pulite(k, r), `Whereby: ${roomUrl}`, hostRoomUrl && `Whereby (link di chi ospita): ${hostRoomUrl}`].filter(Boolean).join('\n') });
  k.stato.scrivi(`stanza:${r.id}`, { id: String(meetingId), fine: fineDi(k, r) });
  return { link: roomUrl, ospite: hostRoomUrl || null, id: String(meetingId) };
}
// la stanza dell'appuntamento ({ id, fine }): si cambia a ogni spostamento, perciò sta nello stato e non in k.sincro
const salaDi = (k, r) => k.stato.leggi(`stanza:${r.id}`) || null;
// l'appuntamento cambia: annullato → via la stanza; spostato (la fine cambia) → stanza nuova e via la vecchia
async function segui(r, k) {
  const s = salaDi(k, r);
  if (!s) return k.imp.automatico === true && !annullato(k, r) ? stanza(k, r) : null;
  if (annullato(k, r)) { await togli(k, s.id); k.stato.scrivi(`stanza:${r.id}`, null); return 'cancellata'; }
  if (s.fine === fineDi(k, r)) return 'uguale';
  const nuova = await stanza(k, r); await togli(k, s.id); return nuova;
}

export default {
  id: 'whereby', nome: 'Whereby', versione: 1, icona: 'calendario',
  descrizione: 'Una stanza video Whereby per gli appuntamenti a distanza, con il link nelle note.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API', segreto: true },
    { id: 'prefisso', nome: 'Inizio del nome della stanza (es. studiorossi)', obbligatorio: false, schema: /^[A-Za-z0-9-]{0,20}$/ },
    { id: 'gruppo', nome: 'Stanze per gruppi (più di 4 persone)', tipo: 'si_no', predefinito: false },
    { id: 'automatico', nome: 'Crea la stanza per ogni appuntamento nuovo', tipo: 'si_no', predefinito: false },
    { id: 'durata', nome: 'Durata di un appuntamento senza servizio (minuti)', tipo: 'numero', predefinito: 60 },
  ],
  richiede: { appuntamenti: { quando: { tipo: ['data_ora'] }, note: { tipo: ['testo_lungo', 'testo'] }, stato: { tipo: 'stato', facoltativo: true } } },
  permessi: { appuntamenti: { leggi: true, modifica: true }, servizi: { leggi: true } },
  prova: async k => { const r = await k.http.get(`${api(k)}/meetings?limit=1`, { bearer: k.segreti.chiave }); return { ok: r.ok, messaggio: r.ok ? 'Chiave API di Whereby valida' : `HTTP ${r.stato}` }; },
  azioni: {
    crea_riunione: {
      nome: 'Crea la stanza Whereby', descrizione: 'Crea una stanza video Whereby per l\'appuntamento e ne scrive i link nelle note', su: SEM, lumi: true, scrive: true,
      input: { appuntamento: { tipo: 'relazione', entita: SEM, nome: 'L\'appuntamento' } },
      proponi: async ({ appuntamento: a }, k) => ({ titolo: 'Stanza Whereby', righe: [['Appuntamento', titoloDi(k, a)], ['Quando', quando(k, a)], ['Vale fino a', new Date(Date.parse(fineDi(k, a)) + 36e5).toLocaleString('it-IT', { timeZone: k.fuso(), timeStyle: 'short' })]],
        avvisi: [...(salaDi(k, a) ? ['C\'è già una stanza: resta quella'] : []), ...(annullato(k, a) ? ['L\'appuntamento è annullato'] : [])] }),
      async esegui({ appuntamento: a }, k) {
        if (annullato(k, a)) throw new Error('L\'appuntamento è annullato');
        if (salaDi(k, a)) return { gia: true, id: salaDi(k, a).id };
        return stanza(k, a);
      },
    },
  },
  uscita: { appuntamenti: { campi: ['quando', 'stato', 'servizio'], quando: (r, k) => !!salaDi(k, r) || (k.imp.automatico === true && !annullato(k, r)), invia: async (r, k) => { await segui(r, k); } } },
  catalogo: {
    categoria: 'calendario', sito: 'https://whereby.com', costo: 'a-consumo',
    costoNota: 'L\'API (Whereby Embedded) ha il piano Explore gratuito con 2.000 minuti-partecipante al mese (senza minuti in più); Build costa 10,99 $ al mese con 2.000 minuti inclusi, poi 0,0042 $ al minuto-partecipante (IVA esclusa). Chi entra nella stanza non ha bisogno di un account.',
    serve: [
      { cosa: 'Una chiave API di Whereby Embedded', dove: 'whereby.com/org → Configure → API → Generate key (serve un account Whereby Embedded)', link: 'https://whereby.com/information/embedded/' },
    ],
    passi: ['Crea un account Whereby Embedded (gratis per iniziare).', 'Nel pannello apri Configure → API e genera una chiave.', 'Incolla la chiave qui e premi «Prova».', 'Sull\'appuntamento premi «Crea la stanza Whereby» (o chiedilo a Lumi): i link vanno nelle note.', 'Se vuoi la stanza per tutti gli appuntamenti nuovi, accendi «Crea la stanza per ogni appuntamento nuovo».', 'Se l\'appuntamento si sposta, Lumi crea una stanza nuova; se si annulla, la cancella.'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://docs.whereby.com/reference/whereby-rest-api-reference/meetings', 'https://docs.whereby.com/creating-and-deleting-rooms', 'https://docs.whereby.com/whereby-product-features/using-the-rest-api/name-prefixes', 'https://whereby.com/information/embedded/pricing/'],
    prova: 'finto', parole: ['whereby', 'videochiamata', 'video call', 'riunione', 'meeting', 'consulenza online', 'telemedicina', 'stanza video'],
  },
  testi: {
    en: { nome: 'Whereby', descrizione: 'A Whereby video room for remote appointments, with the link in the notes.', 'imp.chiave': 'API key', 'imp.prefisso': 'Start of the room name (e.g. mystudio)', 'imp.gruppo': 'Group rooms (more than 4 people)', 'imp.automatico': 'Create the room for every new appointment', 'imp.durata': 'Length of an appointment without a service (minutes)', 'az.crea_riunione': 'Create the Whereby room',
      'cat.costoNota': 'The API (Whereby Embedded) has the free Explore plan with 2,000 participant minutes a month (no extra minutes); Build costs $10.99 a month with 2,000 minutes included, then $0.0042 per participant minute (VAT excluded). Guests need no account to join.',
      'cat.serve': [{ cosa: 'A Whereby Embedded API key', dove: 'whereby.com/org → Configure → API → Generate key (a Whereby Embedded account is needed)' }],
      'cat.passi': ['Create a Whereby Embedded account (free to start).', 'In the dashboard open Configure → API and generate a key.', 'Paste the key here and press «Test».', 'On the appointment press «Create the Whereby room» (or ask Lumi): the links go into the notes.', 'If you want a room for every new appointment, turn on «Create the room for every new appointment».', 'If the appointment moves, Lumi creates a new room; if it is cancelled, it deletes it.'] },
    es: { nome: 'Whereby', descrizione: 'Una sala de vídeo Whereby para las citas a distancia, con el enlace en las notas.', 'imp.chiave': 'Clave API', 'imp.prefisso': 'Inicio del nombre de la sala (p. ej. miestudio)', 'imp.gruppo': 'Salas para grupos (más de 4 personas)', 'imp.automatico': 'Crear la sala para cada cita nueva', 'imp.durata': 'Duración de una cita sin servicio (minutos)', 'az.crea_riunione': 'Crear la sala Whereby' },
    fr: { nome: 'Whereby', descrizione: 'Une salle vidéo Whereby pour les rendez-vous à distance, avec le lien dans les notes.', 'imp.chiave': 'Clé API', 'imp.prefisso': 'Début du nom de la salle (ex. moncabinet)', 'imp.gruppo': 'Salles de groupe (plus de 4 personnes)', 'imp.automatico': 'Créer la salle pour chaque nouveau rendez-vous', 'imp.durata': 'Durée d\'un rendez-vous sans prestation (minutes)', 'az.crea_riunione': 'Créer la salle Whereby' },
    de: { nome: 'Whereby', descrizione: 'Ein Whereby-Videoraum für Online-Termine, mit dem Link in den Notizen.', 'imp.chiave': 'API-Schlüssel', 'imp.prefisso': 'Anfang des Raumnamens (z. B. meinestudio)', 'imp.gruppo': 'Gruppenräume (mehr als 4 Personen)', 'imp.automatico': 'Raum für jeden neuen Termin erstellen', 'imp.durata': 'Dauer eines Termins ohne Leistung (Minuten)', 'az.crea_riunione': 'Whereby-Raum erstellen' },
    pt: { nome: 'Whereby', descrizione: 'Uma sala de vídeo Whereby para os agendamentos à distância, com o link nas notas.', 'imp.chiave': 'Chave API', 'imp.prefisso': 'Início do nome da sala (ex. meuestudio)', 'imp.gruppo': 'Salas para grupos (mais de 4 pessoas)', 'imp.automatico': 'Criar a sala para cada agendamento novo', 'imp.durata': 'Duração de um agendamento sem serviço (minutos)', 'az.crea_riunione': 'Criar a sala Whereby' },
  },
};
