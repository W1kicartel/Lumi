// Telegram: un bot dell'azienda. Avvisa il titolare (vendite, appuntamenti, scorte…) e parla con i clienti che lo
// aprono dal loro link personale (t.me/<bot>?start=<codice>): il codice lega la chat alla scheda del cliente.
// Due modi di ricevere: «controllo» (getUpdates ogni minuto: va ovunque, anche sul computer del negozio) o «webhook»
// (serve un indirizzo pubblico; Telegram manda X-Telegram-Bot-Api-Secret-Token, che si confronta a tempo costante).
import { createHmac } from 'node:crypto';
import { stessoSegreto } from '../../server/moduli/connettori-rete.js';
import { impostazioniAvvisi, testiAvvisi, uscitaAvvisi, segnaAcceso, impRiepilogo, testiRiepilogo, giroRiepilogo } from '../_comunica/notifiche.js';
import { nomeDi } from '../_comunica/telefono.js';

const api = (k, metodo) => `${k.base || 'https://api.telegram.org'}/bot${k.segreti.token}/${metodo}`;
async function chiama(k, metodo, json = {}) {
  const r = await k.http.post(api(k, metodo), { json });
  if (!r.ok || r.json?.ok === false) throw new Error(`Telegram ${metodo}: ${r.json?.description || `HTTP ${r.stato}`}`);
  return r.json?.result;
}
const manda = (k, chat, text) => chiama(k, 'sendMessage', { chat_id: chat, text: String(text).slice(0, 4096), link_preview_options: { is_disabled: true } });
const titolari = k => k.stato.leggi('titolari') || [];
async function aiTitolari(k, testo) { const t = titolari(k); if (!t.length) throw new Error('Nessuna chat collegata: apri il link del titolare nel bot'); for (const c of t) await manda(k, c, testo); }
// il codice di un cliente: il suo id (senza trattini) e una firma corta, che può contenere «-» (non si indovina quello di un altro)
const firma = (k, id) => createHmac('sha256', k.segreti.codice || '').update(`cliente:${id}`).digest('base64url').slice(0, 12);
const codiceCliente = (k, id) => `${id}-${firma(k, id)}`;
const chatDi = (k, id) => (k.stato.leggi('chat') || {})[id] || null;
const clienteDaChat = (k, chat) => Object.entries(k.stato.leggi('chat') || {}).find(([, c]) => c === chat)?.[0] || null;

// un aggiornamento di Telegram (dal webhook o da getUpdates)
async function aggiorna(k, u) {
  const m = u.message; if (!m?.chat?.id || typeof m.text !== 'string') return 'ignorato';
  // in un gruppo il comando arriva come «/start@nome_bot <codice>»: così il titolare collega anche la chat della squadra
  const chat = m.chat.id, t = m.text.trim(), [c0, arg] = t.split(/\s+/, 2), cmd = c0.replace(/@\w+$/, '');
  if (cmd === '/start' && arg && k.segreti.codice && stessoSegreto(arg, k.segreti.codice)) {
    if (!titolari(k).includes(chat)) k.stato.scrivi('titolari', [...titolari(k), chat].slice(-10));
    await manda(k, chat, 'Fatto: qui arriveranno gli avvisi di Kubo.'); return 'titolare collegato';
  }
  if (cmd === '/start' && arg) {
    const i = arg.indexOf('-'), id = arg.slice(0, i), f = arg.slice(i + 1); if (i < 1 || !f || !stessoSegreto(f, firma(k, id))) { await manda(k, chat, 'Link non valido: chiedine uno nuovo.'); return 'codice non valido'; }
    let c; try { c = k.dati.leggi('clienti', id); } catch { return 'cliente non trovato'; }
    k.stato.scrivi('chat', { ...(k.stato.leggi('chat') || {}), [id]: chat });
    await manda(k, chat, k.imp.benvenuto || 'Ciao! Da adesso ti scriviamo qui per appuntamenti e ordini. Scrivi /stop per non ricevere più messaggi.');
    return `cliente collegato: ${nomeDi(k, c)}`;
  }
  if (cmd === '/stop') {
    const id = clienteDaChat(k, chat);
    if (id) { const x = { ...(k.stato.leggi('chat') || {}) }; delete x[id]; k.stato.scrivi('chat', x); }
    k.stato.scrivi('titolari', titolari(k).filter(c => c !== chat));
    await manda(k, chat, 'Fatto: non riceverai più messaggi.'); return 'scollegato';
  }
  // un cliente collegato scrive: il messaggio arriva al titolare (avviso in Kubo e nelle sue chat)
  const id = clienteDaChat(k, chat); if (!id || titolari(k).includes(chat)) return 'ignorato';
  let nome = ''; try { nome = nomeDi(k, k.dati.leggi('clienti', id)); } catch { nome = m.from?.first_name || ''; }
  k.avvisa(`messaggio da ${nome}: ${t.slice(0, 300)}`);
  for (const c of titolari(k)) await manda(k, c, `${nome}: ${t}`);
  return 'messaggio inoltrato';
}

export default {
  id: 'telegram', nome: 'Telegram', versione: 1, icona: 'messaggio',
  descrizione: 'Un bot dell\'azienda: avvisi al titolare e messaggi ai clienti che lo aprono dal loro link.',
  impostazioni: [
    { id: 'token', nome: 'Token del bot (da @BotFather)', segreto: true, schema: /^\d+:[\w-]{30,}$/ },
    { id: 'codice', nome: 'Codice del titolare (per collegare il tuo Telegram)', segreto: true, generato: true },
    { id: 'ricezione', nome: 'Come riceve i messaggi', tipo: 'scelta', opzioni: ['controllo', 'webhook'], predefinito: 'controllo' },
    { id: 'pubblico', nome: 'Indirizzo pubblico di Kubo (solo per il webhook)', tipo: 'url', obbligatorio: false },
    { id: 'segreto_webhook', nome: 'Segreto del webhook', segreto: true, generato: true },
    { id: 'benvenuto', nome: 'Messaggio di benvenuto ai clienti', obbligatorio: false },
    ...impostazioniAvvisi(), impRiepilogo,
  ],
  permessi: { clienti: { leggi: true }, vendite: { leggi: true }, appuntamenti: { leggi: true }, prenotazioni: { leggi: true }, articoli: { leggi: true }, fatture: { leggi: true } },
  async attiva(k) {
    segnaAcceso(k);
    try {
      const me = await chiama(k, 'getMe'); k.stato.scrivi('bot', me?.username || null);
      const pub = String(k.imp.pubblico || k.pubblico || '').trim().replace(/\/+$/, '');   // il suo, o quello della Libreria
      if (k.imp.ricezione === 'webhook' && !pub) throw new Error('Per ricevere con il webhook manca l\'indirizzo pubblico di Kubo: impostalo nella Libreria (o qui)');
      if (k.imp.ricezione === 'webhook') await chiama(k, 'setWebhook', { url: `${pub}/api/connettori/telegram/in`, secret_token: k.segreti.segreto_webhook, allowed_updates: ['message'] });
      else await chiama(k, 'deleteWebhook', {});
    } catch (e) { k.avvisa(e.message); }
  },
  prova: async k => { const me = await chiama(k, 'getMe'); k.stato.scrivi('bot', me?.username || null); return { ok: true, messaggio: `@${me?.username}` }; },
  entrata: {
    firma: { tipo: 'telegram', segreto: 'segreto_webhook', verifica: ({ req, segreto }) => stessoSegreto(req.headers['x-telegram-bot-api-secret-token'] || '', segreto) },
    idempotenza: ev => ev.update_id,
    gestisci: (ev, k) => aggiorna(k, ev),
  },
  pianificati: { controlla: { nome: 'Legge i messaggi nuovi', ogni: '1m', async giro(k) {
    if (k.imp.ricezione === 'webhook') return { saltato: 'webhook' };
    const off = k.stato.leggi('offset'), l = await chiama(k, 'getUpdates', { offset: off ? off + 1 : undefined, timeout: 0, allowed_updates: ['message'] }) || [];
    const esiti = [];
    for (const u of l) { try { esiti.push(await aggiorna(k, u)); } catch (e) { esiti.push(`errore: ${e.message}`); } k.stato.scrivi('offset', u.update_id); }
    return { letti: l.length, esiti };
  } },
    riepilogo: giroRiepilogo((k, testo) => aiTitolari(k, testo)) },
  uscita: uscitaAvvisi((k, testo) => aiTitolari(k, testo)),
  azioni: {
    link_cliente: {
      nome: 'Link Telegram per il cliente', descrizione: 'Il link personale che il cliente apre per ricevere i messaggi su Telegram', su: 'clienti', lumi: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' } },
      async esegui({ cliente }, k) {
        const bot = k.stato.leggi('bot') || (await chiama(k, 'getMe'))?.username;
        return { url: `https://t.me/${bot}?start=${codiceCliente(k, cliente.id)}`, collegato: !!chatDi(k, cliente.id) };
      },
    },
    manda_cliente: {
      nome: 'Manda su Telegram', descrizione: 'Manda un messaggio Telegram a un cliente che ha aperto il bot', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' }, testo: { tipo: 'testo', nome: 'Il messaggio' } },
      proponi: async ({ cliente, testo }, k) => ({ titolo: 'Messaggio Telegram', righe: [['A', nomeDi(k, cliente)], ['Testo', testo]], avvisi: chatDi(k, cliente.id) ? [] : ['Il cliente non ha ancora aperto il bot: mandagli prima il suo link'] }),
      async esegui({ cliente, testo }, k) {
        const chat = chatDi(k, cliente.id); if (!chat) throw new Error('Il cliente non ha ancora aperto il bot: mandagli prima il suo link');
        if (!String(testo || '').trim()) throw new Error('Il messaggio è vuoto');
        const m = await manda(k, chat, testo); return { inviato: true, id: m?.message_id };
      },
    },
    manda_titolare: {
      nome: 'Avvisami su Telegram', descrizione: 'Manda un messaggio alle chat Telegram del titolare', lumi: true, scrive: true,
      input: { testo: { tipo: 'testo', nome: 'Il messaggio' } },
      proponi: async ({ testo }, k) => ({ titolo: 'Avviso su Telegram', righe: [['Chat', String(titolari(k).length)], ['Testo', testo]], avvisi: titolari(k).length ? [] : ['Nessuna chat collegata'] }),
      esegui: async ({ testo }, k) => { await aiTitolari(k, testo); return { inviato: true }; },
    },
  },
  catalogo: {
    categoria: 'messaggi', sito: 'https://telegram.org', costo: 'gratis',
    costoNota: 'La Bot API di Telegram è gratuita, senza limiti di messaggi per un uso normale (circa 30 messaggi al secondo).',
    serve: [{ cosa: 'Il token del bot', dove: 'Telegram → cerca @BotFather → /newbot → scegli nome e username → copia il token', link: 'https://t.me/BotFather' }],
    passi: ['Su Telegram apri @BotFather e scrivi /newbot', 'Scegli il nome (es. «Bottega Rossi») e uno username che finisce con «bot»', 'Copia il token e incollalo qui, poi Accendi', 'Copia il «codice del titolare» e apri t.me/<username del bot>?start=<codice> dal tuo telefono: da lì ti arrivano gli avvisi', 'Scegli quali avvisi ricevere (vendite, appuntamenti, scorte…)', 'Per un cliente: nella sua scheda «Link Telegram per il cliente», poi mandagli il link (o fallo scrivere a Lumi)', 'Facoltativo: per ricevere con il webhook scegli «webhook» e scrivi l\'indirizzo pubblico di Kubo (se l\'hai impostato nella Libreria, puoi lasciarlo vuoto), poi spegni e riaccendi'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://core.telegram.org/bots/api#setwebhook', 'https://core.telegram.org/bots/api#getupdates', 'https://core.telegram.org/bots/features#deep-linking'],
    prova: 'finto', parole: ['telegram', 'bot', 'avvisi', 'notifiche', 'chat', 'messaggi', 'notifications', 'messages'],
  },
  testi: {
    en: { nome: 'Telegram', descrizione: 'A company bot: alerts for the owner and messages to customers who open it from their personal link.', 'imp.token': 'Bot token (from @BotFather)', 'imp.codice': 'Owner code (to link your Telegram)', 'imp.ricezione': 'How it receives messages', 'imp.pubblico': 'Public address of Kubo (webhook only)', 'imp.segreto_webhook': 'Webhook secret', 'imp.benvenuto': 'Welcome message for customers', ...testiAvvisi('en'), ...testiRiepilogo('en'), 'az.link_cliente': 'Telegram link for the customer', 'az.manda_cliente': 'Send on Telegram', 'az.manda_titolare': 'Notify me on Telegram', 'giro.controlla': 'Reads new messages',
      'cat.costoNota': 'The Telegram Bot API is free, with no message limits for normal use (about 30 messages per second).', 'cat.serve': [{ cosa: 'The bot token', dove: 'Telegram → search @BotFather → /newbot → choose name and username → copy the token' }],
      'cat.passi': ['On Telegram open @BotFather and send /newbot', 'Pick a name and a username ending in «bot»', 'Paste the token here, then Turn on', 'Copy the «owner code» and open t.me/<bot username>?start=<code> on your phone: alerts arrive there', 'Choose which alerts to get', 'For a customer: «Telegram link for the customer» in their record, then send them the link', 'Optional: to receive through the webhook choose «webhook» and enter Kubo\'s public address (if you set it in the Library, you can leave it empty), then turn it off and on again'] },
    es: { nome: 'Telegram', descrizione: 'Un bot de la empresa: avisos al titular y mensajes a los clientes que lo abren desde su enlace.', 'imp.token': 'Token del bot (de @BotFather)', 'imp.codice': 'Código del titular (para vincular tu Telegram)', 'imp.ricezione': 'Cómo recibe los mensajes', 'imp.pubblico': 'Dirección pública de Kubo (solo webhook)', 'imp.segreto_webhook': 'Secreto del webhook', 'imp.benvenuto': 'Mensaje de bienvenida a los clientes', ...testiAvvisi('es'), ...testiRiepilogo('es'), 'az.link_cliente': 'Enlace de Telegram para el cliente', 'az.manda_cliente': 'Enviar por Telegram', 'az.manda_titolare': 'Avísame por Telegram', 'giro.controlla': 'Lee los mensajes nuevos' },
    fr: { nome: 'Telegram', descrizione: 'Un bot de l\'entreprise : alertes au titulaire et messages aux clients qui l\'ouvrent depuis leur lien.', 'imp.token': 'Jeton du bot (de @BotFather)', 'imp.codice': 'Code du titulaire (pour lier ton Telegram)', 'imp.ricezione': 'Comment il reçoit les messages', 'imp.pubblico': 'Adresse publique de Kubo (webhook seulement)', 'imp.segreto_webhook': 'Secret du webhook', 'imp.benvenuto': 'Message de bienvenue aux clients', ...testiAvvisi('fr'), ...testiRiepilogo('fr'), 'az.link_cliente': 'Lien Telegram pour le client', 'az.manda_cliente': 'Envoyer sur Telegram', 'az.manda_titolare': 'Préviens-moi sur Telegram', 'giro.controlla': 'Lit les nouveaux messages' },
    de: { nome: 'Telegram', descrizione: 'Ein Firmen-Bot: Meldungen an den Inhaber und Nachrichten an Kunden, die ihn über ihren Link öffnen.', 'imp.token': 'Bot-Token (von @BotFather)', 'imp.codice': 'Inhaber-Code (um dein Telegram zu verbinden)', 'imp.ricezione': 'Wie Nachrichten empfangen werden', 'imp.pubblico': 'Öffentliche Adresse von Kubo (nur Webhook)', 'imp.segreto_webhook': 'Webhook-Geheimnis', 'imp.benvenuto': 'Willkommensnachricht für Kunden', ...testiAvvisi('de'), ...testiRiepilogo('de'), 'az.link_cliente': 'Telegram-Link für den Kunden', 'az.manda_cliente': 'Über Telegram senden', 'az.manda_titolare': 'Melde mir auf Telegram', 'giro.controlla': 'Liest neue Nachrichten' },
    pt: { nome: 'Telegram', descrizione: 'Um bot da empresa: avisos ao titular e mensagens aos clientes que o abrem pelo link pessoal.', 'imp.token': 'Token do bot (do @BotFather)', 'imp.codice': 'Código do titular (para ligar o seu Telegram)', 'imp.ricezione': 'Como recebe as mensagens', 'imp.pubblico': 'Endereço público do Kubo (só webhook)', 'imp.segreto_webhook': 'Segredo do webhook', 'imp.benvenuto': 'Mensagem de boas-vindas aos clientes', ...testiAvvisi('pt'), ...testiRiepilogo('pt'), 'az.link_cliente': 'Link do Telegram para o cliente', 'az.manda_cliente': 'Enviar pelo Telegram', 'az.manda_titolare': 'Avise-me pelo Telegram', 'giro.controlla': 'Lê as mensagens novas' },
  },
};
