// Microsoft Teams: gli avvisi di Kubo in un canale, con un flusso di Workflows («Invia webhook avvisi a un canale»).
// I vecchi connettori Office 365 (Incoming Webhook) sono stati ritirati: il corpo è un messaggio con una Adaptive Card.
import { canale } from '../_comunica/canale.js';
export default canale({
  id: 'teams', nome: 'Microsoft Teams',
  descrizione: 'Gli avvisi di Kubo in un canale di Microsoft Teams, con un flusso di Workflows.',
  corpo: text => ({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null,
    content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text, wrap: true }] } }] }),
  catalogo: {
    categoria: 'messaggi', sito: 'https://www.microsoft.com/microsoft-teams', costo: 'abbonamento',
    costoNota: 'Incluso nei piani Microsoft 365 con Teams (es. Business Basic, circa 5,60 € per utente al mese); il flusso di Workflows usa connettori standard, senza costi in più.',
    serve: [{ cosa: 'L\'indirizzo HTTP POST del flusso «Invia webhook avvisi a un canale»', dove: 'Teams → canale → ⋯ → Workflows → «Send webhook alerts to a channel» (Invia avvisi webhook a un canale) → Avanti → Aggiungi flusso → copia l\'indirizzo', link: 'https://support.microsoft.com/office/creating-a-workflow-from-a-channel-in-teams-242eb8f2-f328-45be-b81f-9817b51a5f0e' }],
    passi: ['In Teams apri il canale che deve ricevere gli avvisi', 'Dal menu ⋯ del canale scegli «Workflows»', 'Cerca il modello «Send webhook alerts to a channel», dagli un nome e conferma squadra e canale', 'Copia l\'indirizzo che Teams mostra alla fine e incollalo qui', 'Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nel canale'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook', 'https://support.microsoft.com/office/creating-a-workflow-from-a-channel-in-teams-242eb8f2-f328-45be-b81f-9817b51a5f0e', 'https://adaptivecards.io/explorer/AdaptiveCard.html'],
    prova: 'finto', parole: ['teams', 'microsoft', 'office 365', 'canale', 'avvisi', 'notifiche', 'workflows', 'power automate', 'webhook'],
  },
  testi: {
    en: { nome: 'Microsoft Teams', descrizione: 'Kubo alerts in a Microsoft Teams channel, through a Workflows flow.', 'cat.costoNota': 'Included in Microsoft 365 plans with Teams (e.g. Business Basic, about €5.60 per user per month); the Workflows flow uses standard connectors at no extra cost.',
      'cat.serve': [{ cosa: 'The HTTP POST address of the «Send webhook alerts to a channel» flow', dove: 'Teams → channel → ⋯ → Workflows → «Send webhook alerts to a channel» → Next → Add workflow → copy the address' }],
      'cat.passi': ['In Teams open the channel that should receive the alerts', 'From the channel ⋯ menu choose «Workflows»', 'Pick the «Send webhook alerts to a channel» template, name it and confirm team and channel', 'Copy the address Teams shows at the end and paste it here', 'Choose the alerts and Turn on: «Test» writes a message in the channel'] },
    es: { nome: 'Microsoft Teams', descrizione: 'Los avisos de Kubo en un canal de Microsoft Teams, con un flujo de Workflows.' },
    fr: { nome: 'Microsoft Teams', descrizione: 'Les alertes de Kubo dans un canal Microsoft Teams, avec un flux Workflows.' },
    de: { nome: 'Microsoft Teams', descrizione: 'Kubo-Meldungen in einem Microsoft-Teams-Kanal, über einen Workflows-Flow.' },
    pt: { nome: 'Microsoft Teams', descrizione: 'Os avisos do Kubo num canal do Microsoft Teams, com um fluxo do Workflows.' },
  },
});
