// Tally: chi compila un modulo diventa un cliente (niente doppioni per email o telefono), con le risposte nelle note;
// con una domanda «Data» e una «Ora» anche un appuntamento. Il webhook (eventType FORM_RESPONSE) è firmato con
// «Tally-Signature: <base64 HMAC-SHA256 del corpo con la signing secret>». La signing secret la genera Kubo e il titolare
// la incolla nel webhook su Tally. Una risposta già importata (eventId, submissionId) non entra due volte.
// Senza indirizzo pubblico: con una chiave API un giro ogni 15 minuti legge le risposte nuove dei moduli scelti
// (GET /forms/{id}/submissions?startDate=…, Bearer).
import { REQ, PERMESSI, richiesta } from '../_comunica/moduli.js';
import { webhookDi } from '../_comunica/agenda.js';

const TIPI = { INPUT_EMAIL: 'email', INPUT_PHONE_NUMBER: 'telefono', INPUT_DATE: 'data', INPUT_TIME: 'ora' };
// i campi di Tally → [{ titolo, tipo, valore }]: le scelte (id delle opzioni) diventano i loro testi, i file i loro nomi
export function risposteTally(campi = []) {
  return campi.filter(f => !/^(HIDDEN_FIELDS|CALCULATED_FIELDS)$/.test(f.type) || f.value != null).map(f => {
    let v = f.value;
    if (Array.isArray(v) && f.options?.length) v = v.map(id => f.options.find(o => o.id === id)?.text ?? id);
    else if (Array.isArray(v)) v = v.map(x => (x && typeof x === 'object' ? x.name || x.url : x));
    return { titolo: String(f.label || f.key || '').trim(), tipo: TIPI[f.type] || 'testo', valore: v };
  });
}

const api = k => k.base || 'https://api.tally.so';
const moduli = k => String(k.imp.moduli || '').split(/[\s,;]+/).filter(s => /^[A-Za-z0-9]{4,20}$/.test(s));
const ESATTI = /^(INPUT_EMAIL|INPUT_PHONE_NUMBER|INPUT_DATE|INPUT_TIME)$/;
async function giro(k) {
  if (!k.segreti.chiave) throw new Error('Serve la chiave API di Tally');
  if (!moduli(k).length) throw new Error('Scrivi l\'id di almeno un modulo');
  const conti = { creati: 0, presenti: 0 };
  for (const f of moduli(k)) {
    const dopo = k.stato.leggi(`dopo:${f}`) || new Date(Date.now() - 30 * 864e5).toISOString(); let ultimo = dopo;
    for (let pagina = 1; pagina <= 20; pagina++) {
      const r = await k.http.get(`${api(k)}/forms/${f}/submissions?${new URLSearchParams({ page: String(pagina), limit: '500', filter: 'completed', startDate: dopo })}`, { bearer: k.segreti.chiave });
      if (!r.ok) throw new Error(`Tally ha risposto ${r.stato} alle risposte del modulo ${f}`);
      const domande = Object.fromEntries((r.json?.questions || []).map(q => [q.id, q]));
      for (const s of r.json?.submissions || []) {
        const campi = (s.responses || []).map(x => { const q = domande[x.questionId] || {}; return { label: q.title, type: q.type, value: ESATTI.test(q.type) ? x.answer : x.formattedAnswer ?? x.answer }; });
        const e = richiesta(k, { remoto: s.id, fonte: 'tally', intestazione: 'Tally', modulo: null, risposte: risposteTally(campi), crea: k.imp.clienti !== false });
        if (e !== 'già importato') /^cliente creato/.test(e) ? conti.creati++ : conti.presenti++;   // startDate comprende l'ultima già letta
        if (s.submittedAt > ultimo) ultimo = s.submittedAt;
      }
      if (!r.json?.hasMore) break;
    }
    k.stato.scrivi(`dopo:${f}`, ultimo);
  }
  if (conti.creati) k.avvisa(`${conti.creati} nuovi contatti dai moduli Tally`);
  return conti;
}

export default {
  id: 'tally', nome: 'Tally', versione: 1, icona: 'persona',
  descrizione: 'Chi compila un modulo Tally diventa un cliente, con le risposte nelle note.',
  impostazioni: [
    { id: 'segreto', nome: 'Signing secret del webhook (da incollare su Tally)', segreto: true, generato: true },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (es. https://kubo.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
    { id: 'chiave', nome: 'Chiave API (solo senza webhook)', segreto: true, obbligatorio: false },
    { id: 'moduli', nome: 'Id dei moduli da controllare (separati da virgola)', obbligatorio: false, schema: /^[A-Za-z0-9\s,;]*$/ },
  ],
  richiede: REQ, permessi: PERMESSI,
  pianificati: { risposte: { nome: 'Risposte nuove dai moduli', ogni: '15m', giro: async k => (k.segreti.chiave && moduli(k).length ? giro(k) : { saltato: 'senza chiave API o moduli' }) } },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'tally-signature', segreto: 'segreto', formato: 'base64' },
    idempotenza: ev => ev?.eventId || ev?.data?.responseId || null,
    async gestisci(ev, k) {
      if (ev?.eventType !== 'FORM_RESPONSE' || !ev.data) return 'ignorato';
      const d = ev.data;
      return richiesta(k, { remoto: d.submissionId || d.responseId || ev.eventId, fonte: 'tally', intestazione: 'Tally', modulo: d.formName, risposte: risposteTally(d.fields), crea: k.imp.clienti !== false });
    },
  },
  azioni: {
    indirizzo_webhook: {
      nome: 'Indirizzo da dare a Tally', descrizione: 'L\'indirizzo da incollare nel webhook del modulo su Tally',
      async esegui(a, k) { return { indirizzo: webhookDi(k, 'tally') }; },
    },
    leggi_risposte: {
      nome: 'Controlla i moduli adesso', descrizione: 'Legge subito le risposte nuove dei moduli Tally e le trasforma in clienti', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Risposte da Tally', righe: [['Moduli', moduli(k).join(', ') || '—']], avvisi: [...(k.segreti.chiave ? [] : ['Manca la chiave API']), 'I contatti nuovi diventano clienti'] }),
      esegui: async (x, k) => giro(k),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://tally.so', costo: 'gratis',
    costoNota: 'Il piano Free ha moduli e risposte illimitati e i webhook; Pro (29 $ al mese, 24 $ annuale) toglie il marchio e aggiunge domini propri.',
    serve: [
      { cosa: 'Un webhook sul modulo con la signing secret generata da Kubo', dove: 'Tally → apri il modulo → Integrations → Webhooks → Connect → Signing secret', link: 'https://tally.so/help/webhooks' },
      { cosa: 'Un indirizzo pubblico di Kubo (dominio o tunnel) raggiungibile da Internet', dove: 'Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)', link: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/' },
      { cosa: 'Senza indirizzo pubblico: una chiave API e l\'id dei moduli', dove: 'Tally → Impostazioni → API keys → Create API key; l\'id è la parte dopo /forms/ nell\'indirizzo del modulo', link: 'https://developers.tally.so/api-reference/api-keys' },
    ],
    passi: ['Accendi il connettore: Kubo crea la signing secret.', 'Scrivi l\'indirizzo pubblico di Kubo (con https).', 'Su Tally apri il modulo → Integrations → Webhooks → Connect.', 'Come Endpoint URL incolla l\'indirizzo dato da «Indirizzo da dare a Tally»; in «Signing secret» incolla il segreto.', 'Usa i blocchi Email e Phone number (e una domanda «Nome»); per un appuntamento i blocchi Date e Time.', 'Compila il modulo: il cliente compare in Kubo (gli invii falliti Tally li riprova da solo).', 'Senza indirizzo pubblico: incolla una chiave API e gli id dei moduli; il giro passa ogni 15 minuti (o chiedi a Lumi di controllare).'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://tally.so/help/webhooks', 'https://developers.tally.so/api-reference/endpoint/forms/submissions/list', 'https://tally.so/pricing'],
    prova: 'finto', parole: ['tally', 'moduli', 'modulo contatti', 'form', 'forms', 'lead', 'sondaggi', 'survey', 'richieste'],
  },
  testi: {
    en: { nome: 'Tally', descrizione: 'People who fill in a Tally form become customers, with the answers in the notes.', 'imp.segreto': 'Webhook signing secret (to paste into Tally)', 'imp.indirizzo': 'Public address of Kubo (e.g. https://kubo.mystudio.com)', 'imp.clienti': 'Create the customer if missing', 'imp.chiave': 'API key (only without webhook)', 'imp.moduli': 'Form ids to check (comma separated)', 'az.indirizzo_webhook': 'Address to give Tally', 'az.leggi_risposte': 'Check the forms now', 'giro.risposte': 'New answers from the forms',
      'cat.costoNota': 'The Free plan has unlimited forms and responses and webhooks; Pro ($29 a month, $24 yearly) removes the branding and adds custom domains.',
      'cat.serve': [{ cosa: 'A webhook on the form with the signing secret generated by Kubo', dove: 'Tally → open the form → Integrations → Webhooks → Connect → Signing secret' }, { cosa: 'A public address for Kubo reachable from the Internet', dove: 'Your domain with HTTPS, or a tunnel (Cloudflare Tunnel)' }, { cosa: 'Without a public address: an API key and the form ids', dove: 'Tally → Settings → API keys → Create API key; the id is the part after /forms/ in the form address' }],
      'cat.passi': ['Turn the connector on: Kubo creates the signing secret.', 'Enter Kubo\'s public address (with https).', 'In Tally open the form → Integrations → Webhooks → Connect.', 'As Endpoint URL paste the address given by «Address to give Tally»; paste the secret in «Signing secret».', 'Use the Email and Phone number blocks (and a «Name» question); for an appointment the Date and Time blocks.', 'Fill in the form: the customer shows up in Kubo (Tally retries failed deliveries by itself).', 'Without a public address: paste an API key and the form ids; the check runs every 15 minutes (or ask Lumi to check).'] },
    es: { nome: 'Tally', descrizione: 'Quien rellena un formulario de Tally se convierte en cliente, con las respuestas en las notas.', 'imp.segreto': 'Signing secret del webhook (para pegar en Tally)', 'imp.indirizzo': 'Dirección pública de Kubo (p. ej. https://kubo.miestudio.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.indirizzo_webhook': 'Dirección para Tally', 'imp.chiave': 'Clave API (solo sin webhook)', 'imp.moduli': 'Ids de los formularios (separados por comas)', 'az.leggi_risposte': 'Revisar los formularios ahora', 'giro.risposte': 'Respuestas nuevas de los formularios' },
    fr: { nome: 'Tally', descrizione: 'Les personnes qui remplissent un formulaire Tally deviennent clients, avec les réponses dans les notes.', 'imp.segreto': 'Signing secret du webhook (à coller dans Tally)', 'imp.indirizzo': 'Adresse publique de Kubo (ex. https://kubo.moncabinet.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.indirizzo_webhook': 'Adresse à donner à Tally', 'imp.chiave': 'Clé API (sans webhook uniquement)', 'imp.moduli': 'Ids des formulaires (séparés par des virgules)', 'az.leggi_risposte': 'Vérifier les formulaires maintenant', 'giro.risposte': 'Nouvelles réponses des formulaires' },
    de: { nome: 'Tally', descrizione: 'Wer ein Tally-Formular ausfüllt, wird Kunde, mit den Antworten in den Notizen.', 'imp.segreto': 'Signing Secret des Webhooks (in Tally einfügen)', 'imp.indirizzo': 'Öffentliche Adresse von Kubo (z. B. https://kubo.meinestudio.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.indirizzo_webhook': 'Adresse für Tally', 'imp.chiave': 'API-Schlüssel (nur ohne Webhook)', 'imp.moduli': 'Formular-IDs (durch Komma getrennt)', 'az.leggi_risposte': 'Formulare jetzt prüfen', 'giro.risposte': 'Neue Antworten aus den Formularen' },
    pt: { nome: 'Tally', descrizione: 'Quem preenche um formulário do Tally vira cliente, com as respostas nas notas.', 'imp.segreto': 'Signing secret do webhook (para colar no Tally)', 'imp.indirizzo': 'Endereço público do Kubo (ex. https://kubo.meuestudio.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.indirizzo_webhook': 'Endereço para o Tally', 'imp.chiave': 'Chave API (só sem webhook)', 'imp.moduli': 'Ids dos formulários (separados por vírgula)', 'az.leggi_risposte': 'Verificar os formulários agora', 'giro.risposte': 'Novas respostas dos formulários' },
  },
};
