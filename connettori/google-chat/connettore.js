// Google Chat: gli avvisi di Kubo in uno spazio di Google Workspace, con un webhook dello spazio ({ text }).
import { canale } from '../_comunica/canale.js';
export default canale({
  id: 'google-chat', nome: 'Google Chat', descrizione: 'Gli avvisi di Kubo in uno spazio di Google Chat (Google Workspace).',
  corpo: text => ({ text }),
  catalogo: {
    categoria: 'messaggi', sito: 'https://workspace.google.com/products/chat/', costo: 'abbonamento',
    costoNota: 'Incluso in Google Workspace (da circa 7 € per utente al mese, Business Starter). I webhook non funzionano con gli account Gmail personali.',
    serve: [{ cosa: 'L\'URL del webhook dello spazio (https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…)', dove: 'Google Chat → apri lo spazio → nome dello spazio ▾ → App e integrazioni → Webhook → Aggiungi webhook → copia l\'URL', link: 'https://developers.google.com/workspace/chat/quickstart/webhooks' }],
    passi: ['In Google Chat apri (o crea) lo spazio della squadra', 'Dal menu dello spazio scegli «App e integrazioni» → «Aggiungi webhook», nome «Kubo»', 'Copia l\'URL del webhook e incollalo qui', 'Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nello spazio'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://developers.google.com/workspace/chat/quickstart/webhooks', 'https://developers.google.com/workspace/chat/format-messages'],
    prova: 'finto', parole: ['google chat', 'workspace', 'hangouts', 'spazio', 'avvisi', 'notifiche', 'webhook'],
  },
  testi: {
    en: { nome: 'Google Chat', descrizione: 'Kubo alerts in a Google Chat space (Google Workspace).', 'cat.costoNota': 'Included in Google Workspace (from about €7 per user per month, Business Starter). Webhooks do not work with personal Gmail accounts.',
      'cat.serve': [{ cosa: 'The space webhook URL (https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…)', dove: 'Google Chat → open the space → space name ▾ → Apps & integrations → Webhooks → Add webhook → copy the URL' }],
      'cat.passi': ['In Google Chat open (or create) the team space', 'From the space menu choose «Apps & integrations» → «Add webhook», name «Kubo»', 'Copy the webhook URL and paste it here', 'Choose the alerts and Turn on: «Test» writes a message in the space'] },
    es: { nome: 'Google Chat', descrizione: 'Los avisos de Kubo en un espacio de Google Chat (Google Workspace).' },
    fr: { nome: 'Google Chat', descrizione: 'Les alertes de Kubo dans un espace Google Chat (Google Workspace).' },
    de: { nome: 'Google Chat', descrizione: 'Kubo-Meldungen in einem Google-Chat-Bereich (Google Workspace).' },
    pt: { nome: 'Google Chat', descrizione: 'Os avisos do Kubo num espaço do Google Chat (Google Workspace).' },
  },
});
