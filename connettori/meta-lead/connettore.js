// Meta Lead Ads: chi compila un modulo di Facebook o Instagram diventa un cliente di Kubo, con la provenienza e una nota
// con il nome del modulo, la campagna e le altre risposte.
// - Ogni 15 minuti un giro legge i lead nuovi dei moduli scelti (Graph API GET /<form-id>/leads filtrati per time_created).
//   È la strada principale: il webhook di Meta va prima verificato con una sfida GET (hub.challenge) a cui Kubo non può
//   rispondere, perché i webhook di Kubo accettano solo POST;
// - se l'abbonamento è già verificato altrove e Kubo ha un indirizzo pubblico, l'entrata POST firmata con X-Hub-Signature-256
//   (HMAC-SHA256 del corpo con l'App Secret) prende il leadgen_id e rilegge il lead dall'API: arriva in pochi secondi.
// Un lead già importato non si importa due volte (k.sincro), e un cliente con la stessa email o lo stesso telefono non si duplica.
import { opzione } from '../_comunica/tabelle.js';
const gbase = k => k.base || 'https://graph.facebook.com';
const ver = k => String(k.imp.versione || 'v25.0').replace(/^(?!v)/, 'v');
const CAMPI = 'id,created_time,field_data,form_id,ad_name,adset_name,campaign_name,platform,is_organic';
const no = (r, cosa) => new Error(`Meta ha risposto ${r.stato} a ${cosa}${r.json?.error?.message ? ': ' + r.json.error.message : ''}`);
const moduli = k => String(k.imp.moduli || '').split(/[\s,;]+/).map(s => s.trim()).filter(s => /^\d{5,30}$/.test(s));
async function nomeModulo(k, id) {
  const nomi = k.stato.leggi('moduli') || {}; if (nomi[id]) return nomi[id];
  const r = await k.http.get(`${gbase(k)}/${ver(k)}/${id}?fields=name`, { bearer: k.segreti.token });
  if (r.ok && r.json?.name) { nomi[id] = r.json.name; k.stato.scrivi('moduli', nomi); }
  return r.json?.name || `modulo ${id}`;
}
// un lead → un cliente. → 'creato' | 'già importato' | 'già presente'
async function importa(k, lead) {
  if (k.sincro.locale('clienti', lead.id)) return 'già importato';
  const r = Object.fromEntries((lead.field_data || []).map(f => [f.name, (f.values || []).join(', ')]));
  const email = (r.email || '').trim().toLowerCase() || null, tel = (r.phone_number || r.phone || '').trim() || null;
  const nome = r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || email || tel || `Lead ${lead.id}`;
  const gia = (email && k.dati.trova('clienti', 'email', email)) || (tel && k.campo('clienti', 'telefono') && k.dati.trova('clienti', 'telefono', tel));
  if (gia) { k.sincro.collega('clienti', gia.id, lead.id); return 'già presente'; }
  const modulo = await nomeModulo(k, lead.form_id), altre = Object.entries(r).filter(([c]) => !['email', 'phone_number', 'phone', 'full_name', 'first_name', 'last_name'].includes(c));
  const nota = [`Meta Lead Ads (${lead.platform === 'ig' ? 'Instagram' : 'Facebook'}) · modulo «${modulo}»${lead.campaign_name ? ` · campagna «${lead.campaign_name}»` : ''}${lead.ad_name ? ` · inserzione «${lead.ad_name}»` : ''}`, ...altre.map(([c, v]) => `${c.replace(/_/g, ' ')}: ${v}`)].join('\n');
  const prov = opzione(k, 'clienti', 'provenienza', 'social', 'Meta Lead Ads');
  const c = k.dati.crea('clienti', { nome, ...(email ? { email } : {}), ...(tel && k.campo('clienti', 'telefono') ? { telefono: tel } : {}), ...(prov ? { provenienza: prov } : {}), ...(k.campo('clienti', 'note') ? { note: nota } : {}) });
  k.sincro.collega('clienti', c.id, lead.id);
  return 'creato';
}
async function giro(k) {
  const conti = { creati: 0, presenti: 0 }; if (!moduli(k).length) throw new Error('Scrivi l\'id di almeno un modulo');
  for (const f of moduli(k)) {
    const dopo = k.stato.leggi(`dopo:${f}`) || Math.floor(Date.now() / 1000) - 30 * 86400; let ultimo = dopo;
    let url = `${gbase(k)}/${ver(k)}/${f}/leads?${new URLSearchParams({ fields: CAMPI, limit: '100', filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: dopo }]) })}`;
    for (let p = 0; url && p < 20; p++) {
      const r = await k.http.get(url, { bearer: k.segreti.token }); if (!r.ok) throw no(r, `i lead del modulo ${f}`);
      for (const l of r.json?.data || []) {
        (await importa(k, l)) === 'creato' ? conti.creati++ : conti.presenti++;
        const t = Math.floor(Date.parse(l.created_time) / 1000); if (t > ultimo) ultimo = t;
      }
      const prossima = r.json?.paging?.next; url = prossima && URL.canParse(prossima) && new URL(prossima).origin === new URL(gbase(k)).origin ? prossima : null;   // solo verso Meta
    }
    k.stato.scrivi(`dopo:${f}`, ultimo);
  }
  if (conti.creati) k.avvisa(`${conti.creati} nuovi contatti dai moduli di Meta`);
  return conti;
}
export default {
  id: 'meta-lead', nome: 'Meta Lead Ads', versione: 1, icona: 'persona',
  descrizione: 'Chi compila i moduli delle inserzioni su Facebook e Instagram diventa un cliente.',
  impostazioni: [
    { id: 'token', nome: 'Token di accesso della Pagina (di lunga durata)', segreto: true },
    { id: 'moduli', nome: 'Id dei moduli (separati da virgola)', schema: /^[\d\s,;]+$/ },
    { id: 'segreto_app', nome: 'App Secret (solo per il webhook)', segreto: true, obbligatorio: false },
    { id: 'versione', nome: 'Versione della Graph API', predefinito: 'v25.0', schema: /^v?\d{1,3}\.\d$/ },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'], facoltativo: true }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, provenienza: { tipo: ['scelta', 'testo'], facoltativo: true }, note: { tipo: ['testo_lungo', 'testo'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, crea: true } },
  prova: async k => {
    const f = moduli(k)[0]; if (!f) return { ok: false, messaggio: 'Scrivi l\'id di almeno un modulo' };
    const r = await k.http.get(`${gbase(k)}/${ver(k)}/${f}?fields=name,status,leads_count`, { bearer: k.segreti.token });
    return { ok: r.ok, messaggio: r.ok ? `${r.json?.name} (${r.json?.leads_count ?? 0} lead)` : `HTTP ${r.stato}${r.json?.error?.message ? ': ' + r.json.error.message : ''}` };
  },
  pianificati: { lead: { nome: 'Lead nuovi dai moduli', ogni: '15m', giro } },
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-hub-signature-256', segreto: 'segreto_app', formato: 'hex' },
    idempotenza: ev => (ev?.entry || []).flatMap(e => (e.changes || []).map(c => c.value?.leadgen_id)).filter(Boolean).join(',').slice(0, 300) || null,
    async gestisci(ev, k) {
      if (ev?.object !== 'page') return 'ignorato: non è una pagina';
      const ids = (ev.entry || []).flatMap(e => (e.changes || []).filter(c => c.field === 'leadgen').map(c => c.value || {}))
        .filter(v => v.leadgen_id && (!moduli(k).length || moduli(k).includes(String(v.form_id)))).map(v => v.leadgen_id);
      if (!ids.length) return 'ignorato: nessun lead dei moduli scelti';
      const esiti = [];
      for (const id of ids) {
        const r = await k.http.get(`${gbase(k)}/${ver(k)}/${id}?fields=${CAMPI}`, { bearer: k.segreti.token }); if (!r.ok) throw no(r, `il lead ${id}`);
        esiti.push(await importa(k, r.json));
      }
      return esiti.join(', ');
    },
  },
  azioni: {
    leggi_lead: {
      nome: 'Controlla i moduli adesso', descrizione: 'Legge subito i nuovi contatti arrivati dai moduli delle inserzioni di Facebook e Instagram', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Lead da Meta', righe: [['Moduli', moduli(k).join(', ') || '—']], avvisi: ['I contatti nuovi diventano clienti'] }),
      esegui: async (x, k) => giro(k),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.facebook.com/business/ads/lead-ads', costo: 'a-consumo',
    costoNota: 'L\'API è gratuita: si pagano solo le inserzioni, con il budget scelto in Gestione inserzioni (asta a costo per lead o per impressioni, nessun minimo fisso oltre 1 € circa al giorno).',
    serve: [
      { cosa: 'Un\'app Meta di tipo Business con i permessi leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads', dove: 'developers.facebook.com → Le mie app → Crea app → Business → Casi d\'uso / Permessi', link: 'https://developers.facebook.com/apps/' },
      { cosa: 'Il token di accesso della Pagina di lunga durata (non scade se nasce da un token utente di lunga durata)', dove: 'Graph API Explorer → seleziona l\'app e la Pagina → Genera token → poi Strumento di debug del token → Estendi; oppure un utente di sistema in Business Manager', link: 'https://developers.facebook.com/tools/explorer/' },
      { cosa: 'L\'id di ogni modulo', dove: 'Meta Business Suite → Tutti gli strumenti → Moduli istantanei (Strumenti per i moduli): la colonna ID', link: 'https://business.facebook.com/latest/instant_forms' },
      { cosa: 'Solo per il webhook: l\'App Secret e un indirizzo pubblico di Kubo', dove: 'App → Impostazioni dell\'app → Di base → Chiave segreta', link: 'https://developers.facebook.com/docs/graph-api/webhooks/getting-started' },
    ],
    passi: [
      'Crea un\'app Meta di tipo Business e aggiungi i permessi leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata e pages_manage_ads.',
      'Con Graph API Explorer genera il token della Pagina; estendilo a lunga durata con lo strumento di debug (o usa un utente di sistema del Business Manager).',
      'In Meta Business Suite → Strumenti per i moduli dai accesso ai lead all\'app («Accesso ai lead» → CRM), altrimenti l\'API risponde 403.',
      'Incolla il token e gli id dei moduli (separati da virgola), poi premi «Prova la connessione».',
      'Premi «Controlla i moduli adesso»: arrivano i lead degli ultimi 30 giorni, poi ogni 15 minuti quelli nuovi.',
      'Facoltativo: se Kubo ha un indirizzo pubblico e l\'abbonamento al campo «leadgen» è già verificato, punta il webhook a <indirizzo>/api/connettori/meta-lead/in e incolla qui l\'App Secret.',
    ],
    difficolta: 'difficile', zone: ['mondo'],
    fonti: ['https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving', 'https://developers.facebook.com/docs/graph-api/webhooks/getting-started', 'https://developers.facebook.com/docs/graph-api/webhooks/reference/page/#leadgen', 'https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived', 'https://developers.facebook.com/docs/permissions/reference/leads_retrieval'],
    prova: 'finto', parole: ['meta', 'facebook', 'instagram', 'lead ads', 'moduli', 'forms', 'lead', 'contatti', 'inserzioni', 'ads', 'campagne'],
  },
  testi: {
    en: { nome: 'Meta Lead Ads', descrizione: 'People who fill in Facebook and Instagram ad forms become customers.', 'imp.token': 'Page access token (long-lived)', 'imp.moduli': 'Form ids (comma separated)', 'imp.segreto_app': 'App Secret (webhook only)', 'imp.versione': 'Graph API version', 'az.leggi_lead': 'Check the forms now', 'giro.lead': 'New leads from the forms',
      'cat.costoNota': 'The API is free: you only pay for the ads, with the budget set in Ads Manager (auction on cost per lead or impressions, no fixed minimum beyond about €1 a day).',
      'cat.serve': [{ cosa: 'A Business-type Meta app with permissions leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads', dove: 'developers.facebook.com → My Apps → Create App → Business → Use cases / Permissions' }, { cosa: 'The long-lived Page access token (it does not expire if it comes from a long-lived user token)', dove: 'Graph API Explorer → choose app and Page → Generate token → then Access Token Debugger → Extend; or a system user in Business Manager' }, { cosa: 'The id of each form', dove: 'Meta Business Suite → All tools → Instant forms (Forms library): the ID column' }, { cosa: 'Webhook only: the App Secret and a public address for Kubo', dove: 'App → App settings → Basic → App secret' }],
      'cat.passi': ['Create a Business-type Meta app and add leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata and pages_manage_ads.', 'Generate the Page token with Graph API Explorer; extend it with the token debugger (or use a Business Manager system user).', 'In Meta Business Suite → Forms library give the app access to leads («Leads access» → CRM), otherwise the API answers 403.', 'Paste the token and the form ids (comma separated), then press «Test connection».', 'Press «Check the forms now»: leads from the last 30 days arrive, then new ones every 15 minutes.', 'Optional: if Kubo has a public address and the «leadgen» subscription is already verified, point the webhook to <address>/api/connettori/meta-lead/in and paste the App Secret here.'] },
    es: { nome: 'Meta Lead Ads', descrizione: 'Quien rellena los formularios de los anuncios de Facebook e Instagram se convierte en cliente.', 'imp.token': 'Token de acceso de la página (de larga duración)', 'imp.moduli': 'Ids de los formularios (separados por comas)', 'imp.segreto_app': 'App Secret (solo para el webhook)', 'imp.versione': 'Versión de la Graph API', 'az.leggi_lead': 'Revisar los formularios ahora', 'giro.lead': 'Leads nuevos de los formularios' },
    fr: { nome: 'Meta Lead Ads', descrizione: 'Les personnes qui remplissent les formulaires des publicités Facebook et Instagram deviennent clients.', 'imp.token': 'Jeton d\'accès de la Page (longue durée)', 'imp.moduli': 'Ids des formulaires (séparés par des virgules)', 'imp.segreto_app': 'App Secret (webhook uniquement)', 'imp.versione': 'Version de la Graph API', 'az.leggi_lead': 'Vérifier les formulaires maintenant', 'giro.lead': 'Nouveaux leads des formulaires' },
    de: { nome: 'Meta Lead Ads', descrizione: 'Wer die Formulare der Facebook- und Instagram-Anzeigen ausfüllt, wird Kunde.', 'imp.token': 'Seiten-Zugriffstoken (langlebig)', 'imp.moduli': 'Formular-IDs (durch Komma getrennt)', 'imp.segreto_app': 'App Secret (nur für den Webhook)', 'imp.versione': 'Graph-API-Version', 'az.leggi_lead': 'Formulare jetzt prüfen', 'giro.lead': 'Neue Leads aus den Formularen' },
    pt: { nome: 'Meta Lead Ads', descrizione: 'Quem preenche os formulários dos anúncios do Facebook e Instagram vira cliente.', 'imp.token': 'Token de acesso da Página (de longa duração)', 'imp.moduli': 'Ids dos formulários (separados por vírgula)', 'imp.segreto_app': 'App Secret (só para o webhook)', 'imp.versione': 'Versão da Graph API', 'az.leggi_lead': 'Verificar os formulários agora', 'giro.lead': 'Novos leads dos formulários' },
  },
};
