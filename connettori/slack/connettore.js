// Slack: gli avvisi di Kubo in un canale (Incoming Webhook) e «scrivi su Slack» per Lumi.
// Va bene anche per Mattermost e Rocket.Chat, che accettano lo stesso formato ({ text }).
import { canale } from '../_comunica/canale.js';
export default canale({
  id: 'slack', nome: 'Slack',
  descrizione: 'Gli avvisi di Kubo (vendite, appuntamenti, scorte) in un canale Slack della squadra.',
  corpo: text => ({ text }),
  catalogo: {
    categoria: 'messaggi', sito: 'https://slack.com', costo: 'gratis',
    costoNota: 'Gli Incoming Webhook funzionano anche con il piano Free di Slack (al massimo 10 app installate nell\'area di lavoro). Nessun costo per messaggio.',
    serve: [{ cosa: 'L\'indirizzo dell\'Incoming Webhook (https://hooks.slack.com/services/…)', dove: 'api.slack.com/apps → Create New App → From scratch → Incoming Webhooks → attiva → Add New Webhook to Workspace → scegli il canale → copia l\'indirizzo', link: 'https://api.slack.com/apps' }],
    passi: ['Apri api.slack.com/apps e crea un\'app «Kubo» nella tua area di lavoro', 'In «Incoming Webhooks» attiva l\'interruttore', '«Add New Webhook to Workspace», scegli il canale (es. #negozio) e consenti', 'Copia l\'indirizzo del webhook e incollalo qui', 'Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nel canale'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks', 'https://developers.mattermost.com/integrate/webhooks/incoming/'],
    prova: 'finto', parole: ['slack', 'canale', 'squadra', 'avvisi', 'notifiche', 'mattermost', 'rocket.chat', 'team chat', 'webhook'],
  },
  testi: {
    en: { nome: 'Slack', descrizione: 'Kubo alerts (sales, appointments, stock) in a team Slack channel.', 'cat.costoNota': 'Incoming Webhooks work on Slack\'s Free plan too (up to 10 installed apps per workspace). No per-message cost.',
      'cat.serve': [{ cosa: 'The Incoming Webhook address (https://hooks.slack.com/services/…)', dove: 'api.slack.com/apps → Create New App → From scratch → Incoming Webhooks → on → Add New Webhook to Workspace → pick the channel → copy the address' }],
      'cat.passi': ['Open api.slack.com/apps and create a «Kubo» app in your workspace', 'Turn on «Incoming Webhooks»', '«Add New Webhook to Workspace», pick the channel and allow', 'Copy the webhook address and paste it here', 'Choose the alerts and Turn on: «Test» writes a message in the channel'] },
    es: { nome: 'Slack', descrizione: 'Los avisos de Kubo (ventas, citas, stock) en un canal de Slack del equipo.' },
    fr: { nome: 'Slack', descrizione: 'Les alertes de Kubo (ventes, rendez-vous, stock) dans un canal Slack de l\'équipe.' },
    de: { nome: 'Slack', descrizione: 'Kubo-Meldungen (Verkäufe, Termine, Bestand) in einem Slack-Kanal des Teams.' },
    pt: { nome: 'Slack', descrizione: 'Os avisos do Kubo (vendas, agendamentos, estoque) num canal Slack da equipe.' },
  },
});
