// Aircall (centralino in cloud): chi chiama si riconosce dal numero e Lumi avvisa («Chiama Anna Rossi»,
// «Chiamata persa da Anna Rossi»); a fine chiamata una riga nelle note del cliente, se l'impostazione lo chiede.
// - Webhook non firmato: ogni evento porta nel corpo { resource, event, timestamp, token, data } e il «token» è quello
//   del webhook (lo dà Aircall alla creazione); si confronta in tempo costante con quello salvato.
// - Eventi usati: call.created (squilla), call.ended (finita: persa se non ha risposto nessuno), call.voicemail_left.
// - Azione «chiama»: POST /v1/users/{utente}/calls { number_id, to } fa squillare il telefono Aircall dell'utente
//   e poi chiama il cliente. Accesso all'API: Basic api_id:api_token.
import { timingSafeEqual } from 'node:crypto';
import { e164, telefonoDi, nomeDi } from '../_comunica/telefono.js';
const api = k => `${k.base || 'https://api.aircall.io'}/v1`;
const chiedi = (k, percorso, opz = {}) => k.http[opz.json ? 'post' : 'get'](`${api(k)}${percorso}`, { basic: [k.imp.api_id, k.segreti.api_token], ...opz });
const prova = f => { try { return f(); } catch { return null; } };
const stesso = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };
export const verificaAircall = ({ grezzo, segreto }) => { let ev; try { ev = JSON.parse(grezzo.toString('utf8')); } catch { return false; } return stesso(ev?.token, segreto); };

// le forme in cui un numero può essere scritto in anagrafica: com'è, E.164, senza prefisso, con lo 00, con gli spazi
export function varianti(numero, prefisso = '39') {
  const t = String(numero || '').trim(), e = e164(t, prefisso); if (!e) return t ? [t] : [];
  const p = `+${String(prefisso).replace(/\D/g, '')}`, naz = e.startsWith(p) ? e.slice(p.length) : null;
  return [...new Set([t, t.replace(/[\s\-./()]/g, ''), e, '00' + e.slice(1), naz, naz && `${p} ${naz}`, naz && `${naz.slice(0, 3)} ${naz.slice(3)}`, naz && `${naz.slice(0, 3)} ${naz.slice(3, 6)} ${naz.slice(6)}`].filter(Boolean))];
}
export function clienteDaNumero(k, numero) {
  if (!k.campo('clienti', 'telefono')) return null;
  for (const v of varianti(numero, k.imp.prefisso || '39')) { const c = prova(() => k.dati.trova('clienti', 'telefono', v)); if (c) return c; }
  return null;
}
const ora = (k, s) => new Date(s ? Number(s) * 1000 : Date.now()).toLocaleString('it-IT', { timeZone: k.fuso(), dateStyle: 'short', timeStyle: 'short' });
const minuti = s => (Number(s) >= 60 ? `${Math.round(Number(s) / 60)} min` : `${Number(s) || 0} s`);
// una chiamata in entrata senza risposta (o con un motivo di chiamata persa) è persa
const persa = c => c.direction === 'inbound' && (!!c.missed_call_reason || !c.answered_at);

export default {
  id: 'aircall', nome: 'Aircall', versione: 1, icona: 'telefono',
  descrizione: 'Il centralino Aircall riconosce i clienti: avvisi di chiamata e chiamate perse, una riga nelle note.',
  impostazioni: [
    { id: 'api_id', nome: 'API ID' },
    { id: 'api_token', nome: 'API token', segreto: true },
    { id: 'token_webhook', nome: 'Token del webhook (lo dà Aircall alla creazione del webhook)', segreto: true },
    { id: 'utente', nome: 'ID utente Aircall che fa le chiamate (per «Chiama»)', obbligatorio: false, schema: /^\d{1,15}$/ },
    { id: 'numero', nome: 'ID del numero Aircall da cui chiamare (per «Chiama»)', obbligatorio: false, schema: /^\d{1,15}$/ },
    { id: 'avvisi', nome: 'Avvisa a ogni chiamata in arrivo', tipo: 'si_no', predefinito: true },
    { id: 'note', nome: 'A fine chiamata aggiungi una riga nelle note del cliente', tipo: 'si_no', predefinito: true },
    { id: 'prefisso', nome: 'Prefisso del paese per i numeri senza prefisso', predefinito: '39', schema: /^\d{1,4}$/ },
  ],
  richiede: { clienti: { nome: {}, telefono: { tipo: ['telefono'] }, note: { tipo: ['testo_lungo', 'testo'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, modifica: true } },
  prova: async k => { const r = await chiedi(k, '/ping'); return { ok: r.ok, messaggio: r.ok ? 'Accesso ad Aircall riuscito' : `HTTP ${r.stato}` }; },
  entrata: {
    firma: { tipo: 'aircall', segreto: 'token_webhook', verifica: verificaAircall },
    idempotenza: ev => (ev?.data?.id ? `${ev.event}:${ev.data.id}` : ''),
    async gestisci(ev, k) {
      if (ev?.resource !== 'call' || !ev.data) return 'ignorato';
      const c = ev.data, numero = c.raw_digits, cl = clienteDaNumero(k, numero), chi = cl ? nomeDi(k, cl) : (numero || 'numero nascosto');
      if (ev.event === 'call.created') {
        if (c.direction !== 'inbound' || k.imp.avvisi === false) return 'ignorato: uscente o avvisi spenti';
        k.avvisa(`Chiama ${chi}${cl && numero ? ` (${numero})` : ''}`); return cl ? 'avvisato: cliente' : 'avvisato';
      }
      if (ev.event === 'call.voicemail_left') { k.avvisa(`Messaggio in segreteria da ${chi}`); return 'avvisato'; }
      if (ev.event !== 'call.ended') return 'ignorato';
      const p = persa(c);
      if (p) k.avvisa(`Chiamata persa da ${chi}${cl && numero ? ` (${numero})` : ''}`);
      if (!cl || k.imp.note === false || !k.campo('clienti', 'note')) return p ? 'persa' : 'finita';
      const riga = `${ora(k, c.started_at)} · Aircall: ${p ? 'chiamata persa' : `chiamata ${c.direction === 'outbound' ? 'fatta' : 'ricevuta'}, ${minuti(c.duration)}`}${c.user?.name ? ` (${c.user.name})` : ''}`;
      const vecchie = k.valore(cl, 'clienti', 'note');
      k.dati.modifica('clienti', cl.id, { note: [vecchie, riga].filter(Boolean).join('\n').slice(-8000) });
      return p ? 'persa: nota' : 'finita: nota';
    },
  },
  azioni: {
    chiama: {
      nome: 'Chiama con Aircall', descrizione: 'Fa squillare il tuo telefono Aircall e poi chiama il cliente', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' } },
      proponi: async ({ cliente: c }, k) => { const t = e164(telefonoDi(k, c), k.imp.prefisso || '39');
        return { titolo: 'Chiamata Aircall', righe: [['Cliente', nomeDi(k, c)], ['Numero', t || '—']],
          avvisi: [...(t ? [] : ['Il cliente non ha un numero di telefono valido']), ...(k.imp.utente && k.imp.numero ? [] : ['Mancano l\'ID utente e l\'ID del numero Aircall nelle impostazioni'])] }; },
      async esegui({ cliente: c }, k) {
        const to = e164(telefonoDi(k, c), k.imp.prefisso || '39');
        if (!to) throw new Error('Il cliente non ha un numero di telefono valido');
        if (!k.imp.utente || !k.imp.numero) throw new Error('Mancano l\'ID utente e l\'ID del numero Aircall nelle impostazioni');
        const r = await chiedi(k, `/users/${k.imp.utente}/calls`, { json: { number_id: Number(k.imp.numero), to } });
        if (!r.ok) throw new Error(r.stato === 405 ? 'L\'utente Aircall non è disponibile (è già al telefono o non è collegato)' : `Aircall ha risposto ${r.stato}${r.json?.message ? ': ' + r.json.message : ''}`);
        return { chiamata: to };
      },
    },
  },
  catalogo: {
    categoria: 'messaggi', sito: 'https://aircall.io', costo: 'abbonamento',
    costoNota: 'Abbonamento a utente: Essentials da 30 € al mese a licenza (annuale, minimo 3 licenze), Professional da 50 €; le chiamate oltre il pacchetto si pagano a consumo. API e webhook sono inclusi.',
    serve: [
      { cosa: 'API ID e API token', dove: 'Aircall Dashboard → Integrations & API → API Keys → Generate an API key', link: 'https://dashboard.aircall.io/integrations/api-keys' },
      { cosa: 'Un webhook verso l\'indirizzo pubblico di Lumi con gli eventi call.created, call.ended, call.voicemail_left, e il suo token', dove: 'Dashboard → Integrations & API → Webhook → Install; il token si legge con GET /v1/webhooks/{id}', link: 'https://developer.aircall.io/tutorials/how-to-create-a-webhook-integration' },
      { cosa: 'Per «Chiama»: l\'ID del tuo utente e l\'ID del numero Aircall', dove: 'Dashboard → Users e Numbers: l\'ID è il numero in fondo all\'indirizzo della pagina', link: 'https://developer.aircall.io/api-references/#start-an-outbound-call' },
    ],
    passi: ['Nella Dashboard di Aircall apri Integrations & API → API Keys e crea una chiave: copia API ID e API token.', 'Incollali qui e premi «Prova».', 'Crea un webhook verso https://<indirizzo di Lumi>/api/connettori/aircall/in con call.created, call.ended e call.voicemail_left.', 'Copia il token del webhook in «Token del webhook».', 'Per chiamare dai clienti scrivi l\'ID del tuo utente e del numero Aircall.', 'Fai una chiamata di prova: Lumi avvisa e, a fine chiamata, scrive una riga nelle note del cliente.'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.aircall.io/api-references', 'https://developer.aircall.io/docs/setup-webhooks', 'https://developer.aircall.io/tutorials/how-to-create-a-webhook-integration', 'https://aircall.io/pricing/'],
    prova: 'finto', parole: ['aircall', 'centralino', 'telefono', 'voip', 'chiamate', 'chiamata persa', 'phone', 'call center', 'calls'],
  },
  testi: {
    en: { nome: 'Aircall', descrizione: 'The Aircall phone system recognises customers: call alerts and missed calls, a line in the notes.', 'imp.api_id': 'API ID', 'imp.api_token': 'API token', 'imp.token_webhook': 'Webhook token (Aircall gives it when the webhook is created)', 'imp.utente': 'Aircall user ID that makes the calls (for «Call»)', 'imp.numero': 'Aircall number ID to call from (for «Call»)', 'imp.avvisi': 'Alert on every incoming call', 'imp.note': 'After the call add a line to the customer notes', 'imp.prefisso': 'Country code for numbers without one', 'az.chiama': 'Call with Aircall',
      'cat.costoNota': 'Per-user subscription: Essentials from €30 a month per license (yearly, at least 3 licenses), Professional from €50; calls beyond the bundle are pay as you go. API and webhooks are included.',
      'cat.serve': [{ cosa: 'API ID and API token', dove: 'Aircall Dashboard → Integrations & API → API Keys → Generate an API key' }, { cosa: 'A webhook to Lumi\'s public address with the events call.created, call.ended, call.voicemail_left, and its token', dove: 'Dashboard → Integrations & API → Webhook → Install; read the token with GET /v1/webhooks/{id}' }, { cosa: 'For «Call»: your user ID and the Aircall number ID', dove: 'Dashboard → Users and Numbers: the ID is the number at the end of the page address' }],
      'cat.passi': ['In the Aircall Dashboard open Integrations & API → API Keys and create a key: copy API ID and API token.', 'Paste them here and press «Test».', 'Create a webhook to https://<Lumi address>/api/connettori/aircall/in with call.created, call.ended and call.voicemail_left.', 'Copy the webhook token into «Webhook token».', 'To call customers enter your user ID and the Aircall number ID.', 'Make a test call: Lumi alerts you and, after the call, writes a line in the customer notes.'] },
    es: { nome: 'Aircall', descrizione: 'La centralita Aircall reconoce a los clientes: avisos de llamada y llamadas perdidas, una línea en las notas.', 'imp.api_id': 'API ID', 'imp.api_token': 'API token', 'imp.token_webhook': 'Token del webhook (lo da Aircall al crearlo)', 'imp.utente': 'ID del usuario Aircall que llama (para «Llamar»)', 'imp.numero': 'ID del número Aircall desde el que llamar (para «Llamar»)', 'imp.avvisi': 'Avisar en cada llamada entrante', 'imp.note': 'Al terminar la llamada añadir una línea a las notas del cliente', 'imp.prefisso': 'Prefijo del país para números sin prefijo', 'az.chiama': 'Llamar con Aircall' },
    fr: { nome: 'Aircall', descrizione: 'Le standard Aircall reconnaît les clients : alertes d\'appel et appels manqués, une ligne dans les notes.', 'imp.api_id': 'API ID', 'imp.api_token': 'API token', 'imp.token_webhook': 'Jeton du webhook (donné par Aircall à sa création)', 'imp.utente': 'ID de l\'utilisateur Aircall qui appelle (pour « Appeler »)', 'imp.numero': 'ID du numéro Aircall d\'où appeler (pour « Appeler »)', 'imp.avvisi': 'Alerter à chaque appel entrant', 'imp.note': 'Après l\'appel ajouter une ligne aux notes du client', 'imp.prefisso': 'Indicatif du pays pour les numéros sans indicatif', 'az.chiama': 'Appeler avec Aircall' },
    de: { nome: 'Aircall', descrizione: 'Die Aircall-Telefonanlage erkennt Kunden: Anrufhinweise und verpasste Anrufe, eine Zeile in den Notizen.', 'imp.api_id': 'API-ID', 'imp.api_token': 'API-Token', 'imp.token_webhook': 'Webhook-Token (Aircall gibt ihn beim Anlegen)', 'imp.utente': 'Aircall-Benutzer-ID, die anruft (für „Anrufen“)', 'imp.numero': 'Aircall-Nummern-ID, von der angerufen wird (für „Anrufen“)', 'imp.avvisi': 'Bei jedem eingehenden Anruf benachrichtigen', 'imp.note': 'Nach dem Anruf eine Zeile in die Kundennotizen schreiben', 'imp.prefisso': 'Landesvorwahl für Nummern ohne Vorwahl', 'az.chiama': 'Mit Aircall anrufen' },
    pt: { nome: 'Aircall', descrizione: 'A central Aircall reconhece os clientes: avisos de chamada e chamadas perdidas, uma linha nas notas.', 'imp.api_id': 'API ID', 'imp.api_token': 'API token', 'imp.token_webhook': 'Token do webhook (o Aircall o fornece ao criá-lo)', 'imp.utente': 'ID do usuário Aircall que faz as chamadas (para «Ligar»)', 'imp.numero': 'ID do número Aircall de onde ligar (para «Ligar»)', 'imp.avvisi': 'Avisar a cada chamada recebida', 'imp.note': 'No fim da chamada adicionar uma linha às notas do cliente', 'imp.prefisso': 'Código do país para números sem código', 'az.chiama': 'Ligar com Aircall' },
  },
};
