// Typeform: chi compila un modulo diventa un cliente (niente doppioni per email o telefono), con le risposte nelle note;
// se il modulo chiede una data e un'ora, anche un appuntamento. Il webhook (form_response) è firmato:
// «Typeform-Signature: sha256=<base64 HMAC-SHA256 del corpo con il secret del webhook>». Il secret lo genera Lumi e il
// titolare lo incolla nel webhook su Typeform. Una risposta già importata (event_id, token) non entra due volte.
// Senza indirizzo pubblico: con un token personale un giro ogni 15 minuti legge le risposte nuove dei moduli scelti
// (GET /forms/{id}/responses?since=…, i titoli delle domande da GET /forms/{id}).
import { REQ, PERMESSI, richiesta } from '../_comunica/moduli.js';
import { webhookDi } from '../_comunica/agenda.js';

const TIPI = { email: 'email', phone_number: 'telefono', date: 'data' };
// le risposte di Typeform → [{ titolo, tipo, valore }] (il titolo della domanda viene da definition.fields)
export function risposteTypeform(fr = {}) {
  const titoli = Object.fromEntries((fr.definition?.fields || []).map(f => [f.id, f.title]));
  const out = (fr.answers || []).map(a => ({ titolo: String(titoli[a.field?.id] || a.field?.ref || '').replace(/\*|\{\{[^}]*\}\}/g, '').trim(), tipo: TIPI[a.type] || 'testo',
    valore: a.type === 'choice' ? (a.choice?.label ?? a.choice?.other) : a.type === 'choices' ? [...(a.choices?.labels || []), a.choices?.other].filter(Boolean)
      : a.type === 'payment' ? a.payment?.amount : a[a.type] }));
  for (const [c, v] of Object.entries(fr.hidden || {})) out.push({ titolo: c, tipo: 'testo', valore: v });
  return out;
}

const api = k => k.base || 'https://api.typeform.com';
const moduli = k => String(k.imp.moduli || '').split(/[\s,;]+/).filter(s => /^[A-Za-z0-9]{4,20}$/.test(s));
const piatte = campi => (campi || []).flatMap(f => [f, ...piatte(f.properties?.fields)]);   // i gruppi di domande hanno domande dentro
async function giro(k) {
  if (!k.segreti.token) throw new Error('Serve il token personale di Typeform');
  if (!moduli(k).length) throw new Error('Scrivi l\'id di almeno un modulo');
  const conti = { creati: 0, presenti: 0 };
  for (const f of moduli(k)) {
    const d = await k.http.get(`${api(k)}/forms/${f}`, { bearer: k.segreti.token }); if (!d.ok) throw new Error(`Typeform ha risposto ${d.stato} al modulo ${f}`);
    const definition = { title: d.json?.title, fields: piatte(d.json?.fields) }, dopo = k.stato.leggi(`dopo:${f}`) || new Date(Date.now() - 30 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');
    let ultimo = dopo;
    const r = await k.http.get(`${api(k)}/forms/${f}/responses?${new URLSearchParams({ page_size: '1000', since: dopo, completed: 'true' })}`, { bearer: k.segreti.token });
    if (!r.ok) throw new Error(`Typeform ha risposto ${r.stato} alle risposte del modulo ${f}`);
    for (const x of [...(r.json?.items || [])].sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))) {
      const e = richiesta(k, { remoto: x.token || x.response_id, fonte: 'typeform', intestazione: 'Typeform', modulo: definition.title, risposte: risposteTypeform({ ...x, definition }), crea: k.imp.clienti !== false });
      if (e !== 'già importato') /^cliente creato/.test(e) ? conti.creati++ : conti.presenti++;   // «since» comprende l'ultima già letta
      if (x.submitted_at > ultimo) ultimo = x.submitted_at;
    }
    k.stato.scrivi(`dopo:${f}`, ultimo);
  }
  if (conti.creati) k.avvisa(`${conti.creati} nuovi contatti dai moduli Typeform`);
  return conti;
}

export default {
  id: 'typeform', nome: 'Typeform', versione: 1, icona: 'persona',
  descrizione: 'Chi compila un modulo Typeform diventa un cliente, con le risposte nelle note.',
  impostazioni: [
    { id: 'segreto', nome: 'Secret del webhook (da incollare su Typeform)', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Lumi (es. https://lumi.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
    { id: 'token', nome: 'Token personale (solo senza webhook)', segreto: true, obbligatorio: false },
    { id: 'moduli', nome: 'Id dei moduli da controllare (separati da virgola)', obbligatorio: false, schema: /^[A-Za-z0-9\s,;]*$/ },
  ],
  richiede: REQ, permessi: PERMESSI,
  prova: async k => { const r = await k.http.get(`${api(k)}/me`, { bearer: k.segreti.token }); return { ok: r.ok, messaggio: r.ok ? r.json?.alias || r.json?.email : `HTTP ${r.stato}` }; },
  pianificati: { risposte: { nome: 'Risposte nuove dai moduli', ogni: '15m', giro: async k => (k.segreti.token && moduli(k).length ? giro(k) : { saltato: 'senza token o moduli' }) } },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'typeform-signature', segreto: 'segreto', formato: 'base64' },
    idempotenza: ev => ev?.event_id || ev?.form_response?.token || null,
    async gestisci(ev, k) {
      if (ev?.event_type !== 'form_response' || !ev.form_response) return 'ignorato';
      const fr = ev.form_response;
      return richiesta(k, { remoto: fr.token || ev.event_id, fonte: 'typeform', intestazione: 'Typeform', modulo: fr.definition?.title, risposte: risposteTypeform(fr), crea: k.imp.clienti !== false });
    },
  },
  azioni: {
    indirizzo_webhook: {
      nome: 'Indirizzo da dare a Typeform', descrizione: 'L\'indirizzo da incollare nel webhook del modulo su Typeform',
      async esegui(a, k) { return { indirizzo: webhookDi(k, 'typeform', true) }; },
    },
    leggi_risposte: {
      nome: 'Controlla i moduli adesso', descrizione: 'Legge subito le risposte nuove dei moduli Typeform e le trasforma in clienti', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Risposte da Typeform', righe: [['Moduli', moduli(k).join(', ') || '—']], avvisi: [...(k.segreti.token ? [] : ['Manca il token personale']), 'I contatti nuovi diventano clienti'] }),
      esegui: async (x, k) => giro(k),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.typeform.com', costo: 'abbonamento',
    costoNota: 'Il piano Free (10 risposte al mese) ha già i webhook; Basic da 25 € al mese (annuale) per 100 risposte, Plus 50 €, Business 83 €.',
    serve: [
      { cosa: 'Un webhook sul modulo, con il secret generato da Lumi', dove: 'Typeform → apri il modulo → Connect → Webhooks → Add a webhook → poi Edit → Secret', link: 'https://www.typeform.com/help/a/webhooks-360029573471/' },
      { cosa: 'Un indirizzo pubblico di Lumi (dominio o tunnel) raggiungibile da Internet', dove: 'Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
      { cosa: 'Senza indirizzo pubblico: un token personale (permessi Forms: Read, Responses: Read) e l\'id dei moduli', dove: 'Typeform → Impostazioni dell\'account → Personal tokens → Generate a new token; l\'id è la parte dopo /to/ nel link del modulo', link: 'https://admin.typeform.com/user/tokens' },
    ],
    passi: ['Accendi il connettore: Lumi crea il secret del webhook.', 'Scrivi l\'indirizzo pubblico di Lumi (con https); se l\'hai impostato nella Libreria, puoi lasciarlo vuoto.', 'Su Typeform apri il modulo → Connect → Webhooks → Add a webhook e incolla l\'indirizzo dato da «Indirizzo da dare a Typeform».', 'Premi Edit sul webhook, incolla il secret in «Secret» e salva; poi accendi il webhook.', 'Per riconoscere il cliente usa le domande «Email» e «Phone number» (e una domanda «Nome»); per un appuntamento una domanda «Date» e una «Ora» (es. 15:30).', 'Premi «Send test request» o compila il modulo: il cliente compare in Lumi.', 'Senza indirizzo pubblico: incolla un token personale e gli id dei moduli; il giro passa ogni 15 minuti (o chiedi a Lumi di controllare).'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://www.typeform.com/developers/webhooks/secure-your-webhooks/', 'https://www.typeform.com/developers/webhooks/example-payload/', 'https://www.typeform.com/developers/responses/reference/retrieve-responses/', 'https://www.typeform.com/developers/get-started/personal-access-token/', 'https://www.typeform.com/pricing/'],
    prova: 'finto', parole: ['typeform', 'moduli', 'modulo contatti', 'form', 'forms', 'lead', 'sondaggi', 'survey', 'richieste'],
  },
  testi: {
    en: { nome: 'Typeform', descrizione: 'People who fill in a Typeform become customers, with the answers in the notes.', 'imp.segreto': 'Webhook secret (to paste into Typeform)', 'imp.indirizzo': 'Public address of Lumi (e.g. https://lumi.mystudio.com)', 'imp.clienti': 'Create the customer if missing', 'imp.token': 'Personal token (only without webhook)', 'imp.moduli': 'Form ids to check (comma separated)', 'az.indirizzo_webhook': 'Address to give Typeform', 'az.leggi_risposte': 'Check the forms now', 'giro.risposte': 'New answers from the forms',
      'cat.costoNota': 'The Free plan (10 responses a month) already has webhooks; Basic from €25 a month (yearly) for 100 responses, Plus €50, Business €83.',
      'cat.serve': [{ cosa: 'A webhook on the form, with the secret generated by Lumi', dove: 'Typeform → open the form → Connect → Webhooks → Add a webhook → then Edit → Secret' }, { cosa: 'A public address for Lumi reachable from the Internet', dove: 'Your domain with HTTPS, or a tunnel (Cloudflare Tunnel)' }, { cosa: 'Without a public address: a personal token (Forms: Read, Responses: Read) and the form ids', dove: 'Typeform → Account settings → Personal tokens → Generate a new token; the id is the part after /to/ in the form link' }],
      'cat.passi': ['Turn the connector on: Lumi creates the webhook secret.', 'Enter Lumi\'s public address (with https); if you set it in the Library, you can leave it empty.', 'In Typeform open the form → Connect → Webhooks → Add a webhook and paste the address given by «Address to give Typeform».', 'Press Edit on the webhook, paste the secret in «Secret» and save; then turn the webhook on.', 'To recognise the customer use «Email» and «Phone number» questions (and a «Name» question); for an appointment a «Date» question and a «Time» one (e.g. 15:30).', 'Press «Send test request» or fill in the form: the customer shows up in Lumi.', 'Without a public address: paste a personal token and the form ids; the check runs every 15 minutes (or ask Lumi to check).'] },
    es: { nome: 'Typeform', descrizione: 'Quien rellena un Typeform se convierte en cliente, con las respuestas en las notas.', 'imp.segreto': 'Secreto del webhook (para pegar en Typeform)', 'imp.indirizzo': 'Dirección pública de Lumi (p. ej. https://lumi.miestudio.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.indirizzo_webhook': 'Dirección para Typeform', 'imp.token': 'Token personal (solo sin webhook)', 'imp.moduli': 'Ids de los formularios (separados por comas)', 'az.leggi_risposte': 'Revisar los formularios ahora', 'giro.risposte': 'Respuestas nuevas de los formularios' },
    fr: { nome: 'Typeform', descrizione: 'Les personnes qui remplissent un Typeform deviennent clients, avec les réponses dans les notes.', 'imp.segreto': 'Secret du webhook (à coller dans Typeform)', 'imp.indirizzo': 'Adresse publique de Lumi (ex. https://lumi.moncabinet.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.indirizzo_webhook': 'Adresse à donner à Typeform', 'imp.token': 'Jeton personnel (sans webhook uniquement)', 'imp.moduli': 'Ids des formulaires (séparés par des virgules)', 'az.leggi_risposte': 'Vérifier les formulaires maintenant', 'giro.risposte': 'Nouvelles réponses des formulaires' },
    de: { nome: 'Typeform', descrizione: 'Wer ein Typeform ausfüllt, wird Kunde, mit den Antworten in den Notizen.', 'imp.segreto': 'Webhook-Secret (in Typeform einfügen)', 'imp.indirizzo': 'Öffentliche Adresse von Lumi (z. B. https://lumi.meinestudio.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.indirizzo_webhook': 'Adresse für Typeform', 'imp.token': 'Persönliches Token (nur ohne Webhook)', 'imp.moduli': 'Formular-IDs (durch Komma getrennt)', 'az.leggi_risposte': 'Formulare jetzt prüfen', 'giro.risposte': 'Neue Antworten aus den Formularen' },
    pt: { nome: 'Typeform', descrizione: 'Quem preenche um Typeform vira cliente, com as respostas nas notas.', 'imp.segreto': 'Segredo do webhook (para colar no Typeform)', 'imp.indirizzo': 'Endereço público do Lumi (ex. https://lumi.meuestudio.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.indirizzo_webhook': 'Endereço para o Typeform', 'imp.token': 'Token pessoal (só sem webhook)', 'imp.moduli': 'Ids dos formulários (separados por vírgula)', 'az.leggi_risposte': 'Verificar os formulários agora', 'giro.risposte': 'Novas respostas dos formulários' },
  },
};
