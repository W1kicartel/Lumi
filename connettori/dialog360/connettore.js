// WhatsApp tramite 360dialog (id «dialog360»: gli id dei connettori iniziano con una lettera): partner ufficiale di Meta con sede a Berlino (UE), la stessa Cloud API ospitata su
// waba-v2.360dialog.io, un canone fisso al mese per numero e le tariffe di Meta senza ricarichi.
// Serve: la chiave API (intestazione D360-API-KEY). Il webhook di 360dialog non è firmato: Kubo lo protegge con un codice
// segreto in fondo all'indirizzo (/in/<codice>) e lo registra da sé (POST /v1/configs/webhook) quando c'è l'indirizzo pubblico
// (il suo o quello di Kubo nella Libreria).
// Fonti: https://docs.360dialog.com/docs/messaging-api/api-reference/webhooks · https://docs.360dialog.com/docs/waba-messaging/webhook
//        https://docs.360dialog.com/docs/waba-messaging/template-messaging · https://docs.360dialog.com/docs/360dialog/prices-plans-and-payment-options
import { bus } from '../../server/moduli/whatsapp-bus.js';
import * as C from '../whatsapp/cloud.js';

const chiama = (k, m, url, opz = {}) => k.http[m](/^https?:/.test(url) ? url : `${k.base}/${url}`, { ...opz, intestazioni: { ...(opz.intestazioni || {}), 'D360-API-KEY': k.segreti.chiave } });
const pubblico = k => String(k.imp.indirizzo || k.pubblico || '').trim().replace(/\/+$/, '');
const urlWebhook = k => `${pubblico(k)}/api/connettori/dialog360/in/${k.segreti.codice}`;
async function registraWebhook(k) {
  if (!pubblico(k) || !k.segreti.codice) return { ok: false };
  const r = await chiama(k, 'post', 'v1/configs/webhook', { json: { url: urlWebhook(k) } });
  if (!r.ok) throw new Error(C.errore(r)); return { ok: true };
}

export default {
  id: 'dialog360', nome: 'WhatsApp (360dialog)', versione: 1, icona: 'utenti', base: 'https://waba-v2.360dialog.io',
  descrizione: 'WhatsApp con 360dialog, partner di Meta in Europa: canone fisso al mese e tariffe di Meta senza ricarichi.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API (D360-API-KEY)', segreto: true },
    { id: 'codice', nome: 'Codice segreto del webhook', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (es. https://kubo.miobottega.it)', tipo: 'url', obbligatorio: false },
  ],
  permessi: { clienti: { leggi: true } },
  prova: async k => { const r = await chiama(k, 'get', 'v1/configs/webhook'); return r.ok ? { ok: true, messaggio: r.json?.url || '' } : { ok: false, messaggio: C.errore(r) }; },
  attiva: async k => { try { await registraWebhook(k); } catch (e) { k.avvisa(String(e.message).slice(0, 200)); } },
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    idempotenza: C.idempotenza,
    gestisci: (ev, k) => C.consegna(bus, k, C.eventi(ev)),
  },
  lavori: { 'whatsapp:invia': (corpo, k) => bus.get(k.db)?.lavora(corpo, k.id) },
  whatsapp: {
    ...C.api({
      chiama, percorsoMessaggi: () => 'messages', percorsoMedia: () => 'media',
      percorsoModelli: () => 'v1/configs/templates', listaModelli: j => j?.waba_templates || j?.data || [],
    }),
    creaModelli: true,
    registraWebhook,
    webhook: k => ({ percorso: `/api/connettori/dialog360/in/${k.segreti.codice || '…'}`, verifica: false, automatico: true }),
  },
  catalogo: {
    categoria: 'whatsapp', sito: 'https://www.360dialog.com', costo: 'abbonamento',
    costoNota: 'Canone fisso per numero: circa 49 € al mese (Regular) o 99 € (Premium), più le tariffe di Meta senza ricarichi (in Italia circa 0,066 € marketing, 0,025 € utility).',
    serve: [
      { cosa: 'Un account 360dialog con un numero collegato', dove: 'hub.360dialog.com → Sign up', link: 'https://hub.360dialog.com/' },
      { cosa: 'Il portafoglio Meta Business (l\'iscrizione guidata lo collega)', dove: 'hub.360dialog.com → Numbers → Connect', link: 'https://business.facebook.com/settings' },
      { cosa: 'La chiave API del numero (D360-API-KEY)', dove: 'hub.360dialog.com → Numbers → Generate API key', link: 'https://hub.360dialog.com/' },
      { cosa: 'L\'indirizzo pubblico di Kubo (https)', dove: 'chi ospita Kubo, o un tunnel', link: 'https://docs.360dialog.com/docs/waba-messaging/webhook' },
    ],
    passi: [
      'Iscriviti su hub.360dialog.com e scegli il piano.',
      'Collega il numero con l\'iscrizione guidata (Embedded Signup): accedi con Facebook e scegli il portafoglio Meta.',
      'In Numbers genera la chiave API del numero e copiala.',
      'In Kubo incolla la chiave e l\'indirizzo pubblico di Kubo (se l\'hai impostato nella Libreria, puoi lasciarlo vuoto), poi accendi: Kubo registra da sé il webhook con il suo codice segreto.',
      'Sincronizza i modelli o creane uno da Kubo e aspetta l\'approvazione di Meta.',
    ],
    difficolta: 'media', zone: ['mondo'], prova: 'finto',
    fonti: ['https://docs.360dialog.com/docs/messaging-api/api-reference/webhooks', 'https://docs.360dialog.com/docs/waba-messaging/webhook',
      'https://docs.360dialog.com/docs/360dialog/prices-plans-and-payment-options', 'https://developers.facebook.com/docs/whatsapp/pricing'],
    parole: ['whatsapp', '360dialog', 'europa', 'messaggi', 'chat', 'promemoria', 'canone'],
  },
  testi: {
    en: { nome: 'WhatsApp (360dialog)', descrizione: 'WhatsApp with 360dialog, a Meta partner based in Europe: fixed monthly fee and Meta\'s prices with no markup.',
      'imp.chiave': 'API key (D360-API-KEY)', 'imp.codice': 'Webhook secret code', 'imp.indirizzo': 'Kubo\'s public address (e.g. https://kubo.myshop.com)',
      'cat.costoNota': 'Fixed fee per number: about €49 a month (Regular) or €99 (Premium), plus Meta\'s prices with no markup (in Italy about €0.066 marketing, €0.025 utility).',
      'cat.serve': [{ cosa: 'A 360dialog account with a connected number', dove: 'hub.360dialog.com → Sign up' }, { cosa: 'Your Meta business portfolio (the guided sign-up links it)', dove: 'hub.360dialog.com → Numbers → Connect' },
        { cosa: 'The number\'s API key (D360-API-KEY)', dove: 'hub.360dialog.com → Numbers → Generate API key' }, { cosa: 'Kubo\'s public address (https)', dove: 'your Kubo host, or a tunnel' }],
      'cat.passi': ['Sign up on hub.360dialog.com and pick a plan.', 'Connect the number with Embedded Signup: log in with Facebook and pick your Meta portfolio.',
        'In Numbers generate the number\'s API key and copy it.', 'In Kubo paste the key and Kubo\'s public address (if you set it in the Library, you can leave it empty), then turn it on: Kubo registers the webhook with its secret code.',
        'Sync the templates or create one from Kubo and wait for Meta\'s approval.'] },
    es: { nome: 'WhatsApp (360dialog)', descrizione: 'WhatsApp con 360dialog, socio de Meta en Europa: cuota fija mensual y precios de Meta sin recargo.', 'imp.chiave': 'Clave API (D360-API-KEY)', 'imp.codice': 'Código secreto del webhook', 'imp.indirizzo': 'Dirección pública de Kubo' },
    fr: { nome: 'WhatsApp (360dialog)', descrizione: 'WhatsApp avec 360dialog, partenaire de Meta en Europe : abonnement fixe et tarifs de Meta sans majoration.', 'imp.chiave': 'Clé API (D360-API-KEY)', 'imp.codice': 'Code secret du webhook', 'imp.indirizzo': 'Adresse publique de Kubo' },
    de: { nome: 'WhatsApp (360dialog)', descrizione: 'WhatsApp mit 360dialog, Meta-Partner in Europa: feste Monatsgebühr und Meta-Preise ohne Aufschlag.', 'imp.chiave': 'API-Schlüssel (D360-API-KEY)', 'imp.codice': 'Geheimcode des Webhooks', 'imp.indirizzo': 'Öffentliche Adresse von Kubo' },
    pt: { nome: 'WhatsApp (360dialog)', descrizione: 'WhatsApp com a 360dialog, parceira da Meta na Europa: mensalidade fixa e preços da Meta sem acréscimo.', 'imp.chiave': 'Chave API (D360-API-KEY)', 'imp.codice': 'Código secreto do webhook', 'imp.indirizzo': 'Endereço público do Kubo' },
  },
};
