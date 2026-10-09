// Jitsi Meet: la videochiamata per un appuntamento a distanza, senza chiavi né account. Il link è
// <server>/<stanza> con un nome di stanza casuale e lungo (non si indovina) e va nelle note dell'appuntamento.
// Con «automatico» ogni appuntamento nuovo prende il suo link da solo. Il server è meet.jit.si o uno proprio.
// Su meet.jit.si chi apre la stanza per primo (il moderatore) deve entrare con un account Google, GitHub o Facebook;
// con un server Jitsi proprio decide chi lo gestisce.
import { randomBytes } from 'node:crypto';
import { titoloDi, annullato } from '../_comunica/agenda.js';
const SEM = 'appuntamenti';
const server = k => String(k.imp.server || 'https://meet.jit.si').replace(/\/+$/, '');
// 24 lettere e cifre casuali (circa 120 bit), con un prefisso leggibile
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';
export const stanza = (prefisso = 'kubo') => `${String(prefisso || 'kubo').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'kubo'}-${[...randomBytes(24)].map(b => ALFABETO[b % 32]).join('')}`;
// il link già scritto nelle note, se c'è
const linkDi = (k, r) => String(k.valore(r, SEM, 'note') || '').match(new RegExp(`${server(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[\\w-]+`))?.[0] || null;
const quando = (k, r) => new Date(k.valore(r, SEM, 'quando')).toLocaleString('it-IT', { timeZone: k.fuso(), dateStyle: 'medium', timeStyle: 'short' });
function scrivi(k, r) {
  const gia = linkDi(k, r); if (gia) return { link: gia, gia: true };
  const link = `${server(k)}/${stanza(k.imp.prefisso)}`, note = k.valore(r, SEM, 'note');
  k.dati.modifica(SEM, r.id, { note: [note, `Videochiamata Jitsi: ${link}`].filter(Boolean).join('\n') });
  return { link };
}

export default {
  id: 'jitsi', nome: 'Jitsi Meet', versione: 1, icona: 'calendario',
  descrizione: 'Un link di videochiamata Jitsi per gli appuntamenti a distanza, nelle note. Senza chiavi.',
  impostazioni: [
    { id: 'server', nome: 'Server Jitsi', tipo: 'url', predefinito: 'https://meet.jit.si' },
    { id: 'prefisso', nome: 'Inizio del nome della stanza (es. studiorossi)', obbligatorio: false, schema: /^[A-Za-z0-9-]{0,20}$/ },
    { id: 'automatico', nome: 'Crea il link per ogni appuntamento nuovo', tipo: 'si_no', predefinito: false },
  ],
  richiede: { appuntamenti: { quando: { tipo: ['data_ora'] }, note: { tipo: ['testo_lungo', 'testo'] }, stato: { tipo: 'stato', facoltativo: true } } },
  permessi: { appuntamenti: { leggi: true, modifica: true } },
  azioni: {
    crea_riunione: {
      nome: 'Crea la videochiamata Jitsi', descrizione: 'Crea un link di videochiamata Jitsi per l\'appuntamento e lo scrive nelle note', su: SEM, lumi: true, scrive: true,
      input: { appuntamento: { tipo: 'relazione', entita: SEM, nome: 'L\'appuntamento' } },
      proponi: async ({ appuntamento: a }, k) => ({ titolo: 'Videochiamata Jitsi', righe: [['Appuntamento', titoloDi(k, a)], ['Quando', quando(k, a)], ['Server', server(k)]],
        avvisi: [...(linkDi(k, a) ? ['C\'è già un link nelle note: resta quello'] : []), ...(annullato(k, a) ? ['L\'appuntamento è annullato'] : []),
          ...(/\/\/meet\.jit\.si$/.test(server(k)) ? ['Su meet.jit.si chi apre la stanza per primo entra con Google, GitHub o Facebook'] : [])] }),
      async esegui({ appuntamento: a }, k) {
        if (annullato(k, a)) throw new Error('L\'appuntamento è annullato');
        return scrivi(k, a);
      },
    },
  },
  // «automatico»: un appuntamento nuovo (o spostato, se non ha ancora il link) prende il suo link
  uscita: { appuntamenti: { campi: ['quando'], quando: (r, k) => k.imp.automatico === true && !annullato(k, r) && !linkDi(k, r), invia: async (r, k) => { scrivi(k, r); } } },
  catalogo: {
    categoria: 'calendario', sito: 'https://jitsi.org/jitsi-meet/', costo: 'gratis',
    costoNota: 'Gratis e open source (Apache 2.0): meet.jit.si non costa niente, senza limiti di durata; un server proprio costa solo il server (da circa 5 € al mese per pochi partecipanti). Jitsi as a Service (8x8) è a pagamento, oltre 25 utenti al mese.',
    serve: [
      { cosa: 'Niente chiavi: basta scegliere il server (meet.jit.si o il tuo)', dove: 'Le impostazioni di questo connettore', link: 'https://meet.jit.si' },
      { cosa: 'Su meet.jit.si: un account Google, GitHub o Facebook per chi apre la stanza per primo (il moderatore)', dove: 'Si chiede all\'apertura della stanza; gli ospiti entrano senza account', link: 'https://jitsi.org/blog/authentication-on-meet-jit-si/' },
      { cosa: 'Facoltativo: un server Jitsi proprio, per avere le regole di accesso in casa', dove: 'Guida di installazione di Jitsi Meet (Debian/Ubuntu o Docker)', link: 'https://jitsi.github.io/handbook/docs/devops-guide/' },
    ],
    passi: ['Accendi il connettore: non servono chiavi.', 'Lascia https://meet.jit.si o scrivi l\'indirizzo del tuo server Jitsi.', 'Facoltativo: scrivi l\'inizio del nome delle stanze (es. il nome dello studio).', 'Sull\'appuntamento premi «Crea la videochiamata Jitsi» (o chiedilo a Lumi): il link va nelle note.', 'Se vuoi il link per tutti gli appuntamenti nuovi, accendi «Crea il link per ogni appuntamento nuovo».', 'Su meet.jit.si entra per primo nella stanza con Google, GitHub o Facebook: sei il moderatore; il cliente apre il link senza account.'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://jitsi.github.io/handbook/docs/user-guide/user-guide-start-a-jitsi-meeting/', 'https://jitsi.org/blog/authentication-on-meet-jit-si/', 'https://jitsi.github.io/handbook/docs/devops-guide/', 'https://jaas.8x8.vc/#/pricing'],
    prova: 'finto', parole: ['jitsi', 'jitsi meet', 'videochiamata', 'video call', 'riunione', 'meeting', 'consulenza online', 'telemedicina', 'open source'],
  },
  testi: {
    en: { nome: 'Jitsi Meet', descrizione: 'A Jitsi video call link for remote appointments, in the notes. No keys.', 'imp.server': 'Jitsi server', 'imp.prefisso': 'Start of the room name (e.g. mystudio)', 'imp.automatico': 'Create the link for every new appointment', 'az.crea_riunione': 'Create the Jitsi video call',
      'cat.costoNota': 'Free and open source (Apache 2.0): meet.jit.si costs nothing, with no time limit; your own server costs only the server (from about €5 a month for a few participants). Jitsi as a Service (8x8) is paid above 25 users a month.',
      'cat.serve': [{ cosa: 'No keys: just choose the server (meet.jit.si or yours)', dove: 'The settings of this connector' }, { cosa: 'On meet.jit.si: a Google, GitHub or Facebook account for whoever opens the room first (the moderator)', dove: 'It is asked when the room opens; guests join without an account' }, { cosa: 'Optional: your own Jitsi server, to keep the access rules in house', dove: 'Jitsi Meet installation guide (Debian/Ubuntu or Docker)' }],
      'cat.passi': ['Turn the connector on: no keys needed.', 'Keep https://meet.jit.si or enter the address of your Jitsi server.', 'Optional: enter the start of the room names (e.g. the studio name).', 'On the appointment press «Create the Jitsi video call» (or ask Lumi): the link goes into the notes.', 'If you want the link for every new appointment, turn on «Create the link for every new appointment».', 'On meet.jit.si join the room first with Google, GitHub or Facebook: you are the moderator; the customer opens the link without an account.'] },
    es: { nome: 'Jitsi Meet', descrizione: 'Un enlace de videollamada Jitsi para las citas a distancia, en las notas. Sin claves.', 'imp.server': 'Servidor Jitsi', 'imp.prefisso': 'Inicio del nombre de la sala (p. ej. miestudio)', 'imp.automatico': 'Crear el enlace para cada cita nueva', 'az.crea_riunione': 'Crear la videollamada Jitsi' },
    fr: { nome: 'Jitsi Meet', descrizione: 'Un lien de visioconférence Jitsi pour les rendez-vous à distance, dans les notes. Sans clés.', 'imp.server': 'Serveur Jitsi', 'imp.prefisso': 'Début du nom de la salle (ex. moncabinet)', 'imp.automatico': 'Créer le lien pour chaque nouveau rendez-vous', 'az.crea_riunione': 'Créer la visioconférence Jitsi' },
    de: { nome: 'Jitsi Meet', descrizione: 'Ein Jitsi-Videolink für Online-Termine, in den Notizen. Ohne Schlüssel.', 'imp.server': 'Jitsi-Server', 'imp.prefisso': 'Anfang des Raumnamens (z. B. meinestudio)', 'imp.automatico': 'Link für jeden neuen Termin erstellen', 'az.crea_riunione': 'Jitsi-Videoanruf erstellen' },
    pt: { nome: 'Jitsi Meet', descrizione: 'Um link de videochamada Jitsi para os agendamentos à distância, nas notas. Sem chaves.', 'imp.server': 'Servidor Jitsi', 'imp.prefisso': 'Início do nome da sala (ex. meuestudio)', 'imp.automatico': 'Criar o link para cada agendamento novo', 'az.crea_riunione': 'Criar a videochamada Jitsi' },
  },
};
