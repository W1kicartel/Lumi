// Jotform: chi compila un modulo diventa un cliente (niente doppioni per email o telefono), con le risposte nelle note;
// un campo «Data e ora» o «Appuntamento» diventa anche un appuntamento.
// - Il webhook di Jotform non è firmato: l'indirizzo porta in fondo un codice segreto generato da Kubo (/in/<codice>).
//   Arriva in multipart/form-data (formID, submissionID, formTitle, rawRequest = le risposte in JSON); con la chiave API
//   la risposta si rilegge da GET /submission/{id} (tipi ed etichette veri), altrimenti si legge rawRequest.
// - Senza indirizzo pubblico: un giro ogni 15 minuti legge le risposte nuove dei moduli scelti con la chiave API
//   (GET /form/{id}/submissions con filter created_at:gt). Una risposta già importata non entra due volte.
import { REQ, PERMESSI, richiesta, isoLocale } from '../_comunica/moduli.js';
import { webhookDi } from '../_comunica/agenda.js';

const BASI = { mondo: 'https://api.jotform.com', ue: 'https://eu-api.jotform.com', hipaa: 'https://hipaa-api.jotform.com' };
const api = k => k.base || BASI[k.imp.regione] || BASI.mondo;
const moduli = k => String(k.imp.moduli || '').split(/[\s,;]+/).filter(s => /^\d{5,25}$/.test(s));
const chiedi = async (k, percorso) => {
  const r = await k.http.get(`${api(k)}${percorso}`, { intestazioni: { APIKEY: k.segreti.chiave } });
  if (!r.ok || (r.json?.responseCode && r.json.responseCode !== 200)) throw new Error(`Jotform ha risposto ${r.json?.responseCode || r.stato}${r.json?.message ? ': ' + r.json.message : ''}`);
  return r.json?.content;
};

// il corpo multipart/form-data come testo → { campo: valore } (i file si saltano)
export function leggiMultipart(testo, tipo = '') {
  const b = /boundary="?([^";]+)"?/i.exec(tipo)?.[1]; if (!b || typeof testo !== 'string') return {};
  const out = {};
  for (const parte of testo.split(`--${b}`)) {
    const i = parte.indexOf('\r\n\r\n'); if (i < 0) continue;
    const testa = parte.slice(0, i), nome = /name="([^"]*)"/i.exec(testa)?.[1];
    if (nome && !/filename=/i.test(testa)) out[nome] = parte.slice(i + 4).replace(/\r\n$/, '');
  }
  return out;
}
const ora24 = (h, m, ampm) => { let x = Number(h) % 12; if (!/am|pm/i.test(ampm || '')) x = Number(h); else if (/pm/i.test(ampm)) x += 12; return `${String(x).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`; };
const fusoDi = (s, k) => /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/.exec(String(s || ''))?.[1] || k.fuso();
// una data di Jotform ({ year, month, day, hour, min, ampm } o { date: '2026-10-20 10:00', timezone }) → { tipo, valore }
function dataDi(v, k) {
  if (v?.date && /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(v.date)) { const [d, o] = v.date.split(' '); return { tipo: 'data_ora', valore: isoLocale(d, o, fusoDi(v.timezone, k)) }; }
  if (v?.year && v?.month && v?.day) {
    const d = `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
    return v.hour ? { tipo: 'data_ora', valore: isoLocale(d, ora24(v.hour, v.min, v.ampm), k.fuso()) } : { tipo: 'data', valore: d };
  }
  return null;
}
// le risposte dell'API (answers: { "3": { text, type, answer, prettyFormat } }) → [{ titolo, tipo, valore }]
export function risposteApi(answers = {}, k) {
  return Object.values(answers).filter(a => a.answer != null && a.answer !== '').sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).map(a => {
    const t = a.type, v = a.answer, titolo = String(a.text || a.name || '').trim();
    if (t === 'control_email') return { titolo, tipo: 'email', valore: v };
    if (t === 'control_phone') return { titolo, tipo: 'telefono', valore: v?.full || a.prettyFormat || v };
    if (t === 'control_fullname') return { titolo, tipo: 'nome', valore: [v?.prefix, v?.first, v?.middle, v?.last].filter(Boolean).join(' ') || a.prettyFormat };
    if (t === 'control_datetime' || t === 'control_appointment') { const d = dataDi(v, k); if (d?.valore) return { titolo, ...d }; }
    return { titolo, tipo: 'testo', valore: a.prettyFormat || v };
  });
}
// rawRequest del webhook ({ q3_email: '…', q4_nome: { first, last }, … }) → [{ titolo, tipo, valore }], senza etichette
export function risposteGrezze(raw = {}, k) {
  return Object.entries(raw).filter(([c]) => /^q\d+_/.test(c)).map(([c, v]) => {
    const titolo = c.replace(/^q\d+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('first' in v || 'last' in v) return { titolo, tipo: 'nome', valore: [v.first, v.middle, v.last].filter(Boolean).join(' ') };
      if ('full' in v || 'phone' in v) return { titolo, tipo: 'telefono', valore: v.full || `${v.area || ''}${v.phone || ''}` };
      const d = dataDi(v, k); if (d?.valore) return { titolo, ...d };
    }
    return { titolo, tipo: typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? 'email' : 'testo', valore: v };
  });
}
async function nomeModulo(k, id) {
  const nomi = k.stato.leggi('moduli') || {}; if (nomi[id]) return nomi[id];
  try { const f = await chiedi(k, `/form/${encodeURIComponent(id)}`); if (f?.title) { nomi[id] = f.title; k.stato.scrivi('moduli', nomi); return f.title; } } catch { }
  return null;
}
const importa = (k, s, modulo) => richiesta(k, { remoto: s.id, fonte: 'jotform', intestazione: 'Jotform', modulo, risposte: risposteApi(s.answers, k), crea: k.imp.clienti !== false });

async function giro(k) {
  if (!k.segreti.chiave) throw new Error('Serve la chiave API di Jotform');
  if (!moduli(k).length) throw new Error('Scrivi l\'id di almeno un modulo');
  const conti = { creati: 0, presenti: 0 };
  for (const f of moduli(k)) {
    const dopo = k.stato.leggi(`dopo:${f}`) || '2000-01-01 00:00:00'; let ultimo = dopo; const modulo = await nomeModulo(k, f);
    for (let p = 0; p < 20; p++) {
      const l = await chiedi(k, `/form/${encodeURIComponent(f)}/submissions?${new URLSearchParams({ limit: '100', offset: String(p * 100), orderby: 'created_at', direction: 'ASC', filter: JSON.stringify({ 'created_at:gt': dopo }) })}`) || [];
      for (const s of l) {
        if (s.status === 'DELETED') continue;
        /^cliente creato/.test(await importa(k, s, modulo)) ? conti.creati++ : conti.presenti++;
        if (String(s.created_at) > ultimo) ultimo = String(s.created_at);
      }
      if (l.length < 100) break;
    }
    k.stato.scrivi(`dopo:${f}`, ultimo);
  }
  if (conti.creati) k.avvisa(`${conti.creati} nuovi contatti dai moduli di Jotform`);
  return conti;
}
const corpo = (ev, req) => (typeof ev === 'string' ? leggiMultipart(ev, req?.headers?.['content-type']) : ev || {});

export default {
  id: 'jotform', nome: 'Jotform', versione: 1, icona: 'persona',
  descrizione: 'Chi compila un modulo Jotform diventa un cliente, con le risposte nelle note.',
  impostazioni: [
    { id: 'codice', nome: 'Codice segreto dell\'indirizzo del webhook', segreto: true, generato: true },
    { id: 'chiave', nome: 'Chiave API (per il giro senza webhook e per le etichette)', segreto: true, obbligatorio: false },
    { id: 'moduli', nome: 'Id dei moduli da controllare (separati da virgola)', obbligatorio: false, schema: /^[\d\s,;]*$/ },
    { id: 'regione', nome: 'Dove sono i dati', tipo: 'scelta', opzioni: ['mondo', 'ue', 'hipaa'], predefinito: 'mondo' },
    { id: 'indirizzo', nome: 'Indirizzo pubblico di Kubo (es. https://kubo.studiorossi.it)', tipo: 'url', obbligatorio: false },
    { id: 'clienti', nome: 'Crea il cliente se non c\'è', tipo: 'si_no', predefinito: true },
  ],
  richiede: REQ, permessi: PERMESSI,
  prova: async k => { const u = await chiedi(k, '/user'); return { ok: true, messaggio: `${u?.name || u?.username || 'Account'} (${u?.account_type?.split('/').pop() || 'Jotform'})` }; },
  pianificati: { risposte: { nome: 'Risposte nuove dai moduli', ogni: '15m', giro: async k => (k.segreti.chiave && moduli(k).length ? giro(k) : { saltato: 'senza chiave API o moduli' }) } },
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    idempotenza: (ev, req) => corpo(ev, req).submissionID || null,
    async gestisci(ev, k, { req } = {}) {
      const c = corpo(ev, req), id = c.submissionID;
      if (!id) return 'ignorato: senza submissionID';
      if (k.segreti.chiave) {
        const s = await chiedi(k, `/submission/${encodeURIComponent(id)}`);
        if (s?.answers) return importa(k, s, c.formTitle || await nomeModulo(k, c.formID));
      }
      let raw = {}; try { raw = typeof c.rawRequest === 'string' ? JSON.parse(c.rawRequest) : c.rawRequest || {}; } catch { return 'ignorato: rawRequest illeggibile'; }
      return richiesta(k, { remoto: id, fonte: 'jotform', intestazione: 'Jotform', modulo: c.formTitle, risposte: risposteGrezze(raw, k), crea: k.imp.clienti !== false });
    },
  },
  azioni: {
    indirizzo_webhook: {
      nome: 'Indirizzo da dare a Jotform', descrizione: 'L\'indirizzo (con il codice segreto) da incollare nel webhook del modulo',
      async esegui(a, k) { return { indirizzo: `${webhookDi(k, 'jotform')}/${k.segreti.codice}` }; },
    },
    leggi_risposte: {
      nome: 'Controlla i moduli adesso', descrizione: 'Legge subito le risposte nuove dei moduli Jotform e le trasforma in clienti', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Risposte da Jotform', righe: [['Moduli', moduli(k).join(', ') || '—']], avvisi: [...(k.segreti.chiave ? [] : ['Manca la chiave API']), 'I contatti nuovi diventano clienti'] }),
      esegui: async (x, k) => giro(k),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.jotform.com', costo: 'gratis',
    costoNota: 'Il piano Starter gratuito (5 moduli, 100 risposte al mese) ha webhook e API; Bronze da 34 € al mese (annuale), Silver 39 €, Gold 99 €.',
    serve: [
      { cosa: 'Con indirizzo pubblico: il webhook del modulo con l\'indirizzo che contiene il codice segreto di Kubo', dove: 'Jotform → apri il modulo → Impostazioni → Integrazioni → WebHooks', link: 'https://www.jotform.com/help/245-how-to-setup-a-webhook-with-jotform/' },
      { cosa: 'Senza indirizzo pubblico (o per avere le etichette delle domande): una chiave API in sola lettura e gli id dei moduli', dove: 'Jotform → Impostazioni dell\'account → API → Crea nuova chiave (Read Access); l\'id del modulo è il numero nel suo indirizzo', link: 'https://www.jotform.com/myaccount/api' },
    ],
    passi: ['Accendi il connettore: Kubo crea il codice segreto dell\'indirizzo.', 'Se Kubo ha un indirizzo pubblico, scrivilo e copia l\'indirizzo dato da «Indirizzo da dare a Jotform».', 'Su Jotform apri il modulo → Impostazioni → Integrazioni → WebHooks e incolla l\'indirizzo.', 'Senza indirizzo pubblico: crea una chiave API (Read Access), incollala qui con gli id dei moduli; il giro passa ogni 15 minuti.', 'Se l\'account è nell\'UE (eu.jotform.com) scegli «ue» come zona dei dati.', 'Usa i campi Email, Telefono e Nome completo; per un appuntamento il campo Data (con l\'ora) o Appuntamento.', 'Compila il modulo: il cliente compare in Kubo.'],
    difficolta: 'media', zone: ['mondo', 'UE'],
    fonti: ['https://api.jotform.com/docs/', 'https://www.jotform.com/help/245-how-to-setup-a-webhook-with-jotform/', 'https://www.jotform.com/help/253-how-to-create-a-jotform-api-key/', 'https://www.jotform.com/pricing/'],
    prova: 'finto', parole: ['jotform', 'moduli', 'modulo contatti', 'form', 'forms', 'lead', 'richieste', 'webhook'],
  },
  testi: {
    en: { nome: 'Jotform', descrizione: 'People who fill in a Jotform become customers, with the answers in the notes.', 'imp.codice': 'Secret code of the webhook address', 'imp.chiave': 'API key (for the check without webhook and for the labels)', 'imp.moduli': 'Form ids to check (comma separated)', 'imp.regione': 'Where the data lives', 'imp.indirizzo': 'Public address of Kubo (e.g. https://kubo.mystudio.com)', 'imp.clienti': 'Create the customer if missing', 'az.indirizzo_webhook': 'Address to give Jotform', 'az.leggi_risposte': 'Check the forms now', 'giro.risposte': 'New answers from the forms',
      'cat.costoNota': 'The free Starter plan (5 forms, 100 submissions a month) has webhooks and API; Bronze from €34 a month (yearly), Silver €39, Gold €99.',
      'cat.serve': [{ cosa: 'With a public address: the form webhook with the address containing Kubo\'s secret code', dove: 'Jotform → open the form → Settings → Integrations → WebHooks' }, { cosa: 'Without a public address (or to get the question labels): a read-only API key and the form ids', dove: 'Jotform → Account settings → API → Create new key (Read Access); the form id is the number in its address' }],
      'cat.passi': ['Turn the connector on: Kubo creates the secret code of the address.', 'If Kubo has a public address, enter it and copy the address given by «Address to give Jotform».', 'In Jotform open the form → Settings → Integrations → WebHooks and paste the address.', 'Without a public address: create an API key (Read Access), paste it here with the form ids; the check runs every 15 minutes.', 'If the account is in the EU (eu.jotform.com) choose «ue» as data zone.', 'Use the Email, Phone and Full Name fields; for an appointment the Date field (with time) or Appointment.', 'Fill in the form: the customer shows up in Kubo.'] },
    es: { nome: 'Jotform', descrizione: 'Quien rellena un formulario de Jotform se convierte en cliente, con las respuestas en las notas.', 'imp.codice': 'Código secreto de la dirección del webhook', 'imp.chiave': 'Clave API (para la revisión sin webhook y las etiquetas)', 'imp.moduli': 'Ids de los formularios (separados por comas)', 'imp.regione': 'Dónde están los datos', 'imp.indirizzo': 'Dirección pública de Kubo (p. ej. https://kubo.miestudio.es)', 'imp.clienti': 'Crear el cliente si no existe', 'az.indirizzo_webhook': 'Dirección para Jotform', 'az.leggi_risposte': 'Revisar los formularios ahora', 'giro.risposte': 'Respuestas nuevas de los formularios' },
    fr: { nome: 'Jotform', descrizione: 'Les personnes qui remplissent un formulaire Jotform deviennent clients, avec les réponses dans les notes.', 'imp.codice': 'Code secret de l\'adresse du webhook', 'imp.chiave': 'Clé API (pour la vérification sans webhook et les libellés)', 'imp.moduli': 'Ids des formulaires (séparés par des virgules)', 'imp.regione': 'Où sont les données', 'imp.indirizzo': 'Adresse publique de Kubo (ex. https://kubo.moncabinet.fr)', 'imp.clienti': 'Créer le client s\'il n\'existe pas', 'az.indirizzo_webhook': 'Adresse à donner à Jotform', 'az.leggi_risposte': 'Vérifier les formulaires maintenant', 'giro.risposte': 'Nouvelles réponses des formulaires' },
    de: { nome: 'Jotform', descrizione: 'Wer ein Jotform-Formular ausfüllt, wird Kunde, mit den Antworten in den Notizen.', 'imp.codice': 'Geheimcode der Webhook-Adresse', 'imp.chiave': 'API-Schlüssel (für die Prüfung ohne Webhook und die Beschriftungen)', 'imp.moduli': 'Formular-IDs (durch Komma getrennt)', 'imp.regione': 'Wo die Daten liegen', 'imp.indirizzo': 'Öffentliche Adresse von Kubo (z. B. https://kubo.meinestudio.de)', 'imp.clienti': 'Kunden anlegen, falls er fehlt', 'az.indirizzo_webhook': 'Adresse für Jotform', 'az.leggi_risposte': 'Formulare jetzt prüfen', 'giro.risposte': 'Neue Antworten aus den Formularen' },
    pt: { nome: 'Jotform', descrizione: 'Quem preenche um formulário do Jotform vira cliente, com as respostas nas notas.', 'imp.codice': 'Código secreto do endereço do webhook', 'imp.chiave': 'Chave API (para a verificação sem webhook e os rótulos)', 'imp.moduli': 'Ids dos formulários (separados por vírgula)', 'imp.regione': 'Onde ficam os dados', 'imp.indirizzo': 'Endereço público do Kubo (ex. https://kubo.meuestudio.com)', 'imp.clienti': 'Criar o cliente se não existir', 'az.indirizzo_webhook': 'Endereço para o Jotform', 'az.leggi_risposte': 'Verificar os formulários agora', 'giro.risposte': 'Novas respostas dos formulários' },
  },
};
