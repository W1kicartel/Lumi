// Discord: gli avvisi di Lumi in un canale del server, con un webhook del canale. Nessuna menzione (@everyone) parte mai.
import { canale } from '../_comunica/canale.js';
export default canale({
  id: 'discord', nome: 'Discord',
  descrizione: 'Gli avvisi di Lumi in un canale Discord, con un webhook del canale.',
  corpo: content => ({ content: content.slice(0, 2000), username: 'Lumi', allowed_mentions: { parse: [] } }),
  catalogo: {
    categoria: 'messaggi', sito: 'https://discord.com', costo: 'gratis',
    costoNota: 'I webhook dei canali Discord sono gratuiti (limite di circa 30 messaggi al minuto per webhook).',
    serve: [{ cosa: 'L\'URL del webhook del canale (https://discord.com/api/webhooks/…)', dove: 'Discord → Impostazioni del server → Integrazioni → Webhook → Nuovo webhook → scegli il canale → Copia URL del webhook', link: 'https://support.discord.com/hc/articles/228383668' }],
    passi: ['In Discord apri Impostazioni del server → Integrazioni', '«Webhook» → «Nuovo webhook», dagli un nome (es. Lumi) e scegli il canale', '«Copia URL del webhook» e incollalo qui', 'Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nel canale'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://discord.com/developers/docs/resources/webhook#execute-webhook', 'https://support.discord.com/hc/articles/228383668'],
    prova: 'finto', parole: ['discord', 'canale', 'server', 'avvisi', 'notifiche', 'webhook', 'notifications'],
  },
  testi: {
    en: { nome: 'Discord', descrizione: 'Lumi alerts in a Discord channel, through a channel webhook.', 'cat.costoNota': 'Discord channel webhooks are free (limit of about 30 messages per minute per webhook).',
      'cat.serve': [{ cosa: 'The channel webhook URL (https://discord.com/api/webhooks/…)', dove: 'Discord → Server Settings → Integrations → Webhooks → New Webhook → pick the channel → Copy Webhook URL' }],
      'cat.passi': ['In Discord open Server Settings → Integrations', '«Webhooks» → «New Webhook», name it (e.g. Lumi) and pick the channel', '«Copy Webhook URL» and paste it here', 'Choose the alerts and Turn on: «Test» writes a message in the channel'] },
    es: { nome: 'Discord', descrizione: 'Los avisos de Lumi en un canal de Discord, con un webhook del canal.' },
    fr: { nome: 'Discord', descrizione: 'Les alertes de Lumi dans un salon Discord, avec un webhook du salon.' },
    de: { nome: 'Discord', descrizione: 'Lumi-Meldungen in einem Discord-Kanal, über einen Kanal-Webhook.' },
    pt: { nome: 'Discord', descrizione: 'Os avisos do Lumi num canal do Discord, com um webhook do canal.' },
  },
});
