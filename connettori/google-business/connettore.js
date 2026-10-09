// Google Business Profile (la scheda su Google Maps): le recensioni nuove arrivano come avviso, e si risponde da Kubo
// (anche chiedendo a Lumi «rispondi alla recensione di Marco ringraziandolo»: Lumi scrive la bozza, il titolare conferma).
// API My Business v4: GET accounts/{a}/locations/{l}/reviews e PUT …/reviews/{id}/reply; OAuth con codice + PKCE,
// scope business.manage. Attenzione: l'accesso alle API va CHIESTO a Google (vedi la guida), finché non lo approvano
// il progetto ha quota 0 e ogni chiamata risponde 403/429.
const gbase = k => k.base || 'https://mybusiness.googleapis.com';
const num = s => String(s || '').trim().replace(/^.*\//, '');
const sede = k => { const a = num(k.imp.account), l = num(k.imp.sede); if (!a || !l) throw new Error('Scrivi l\'id dell\'account e della sede'); return `accounts/${a}/locations/${l}`; };
const STELLE = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const no = (r, cosa) => new Error(`Google ha risposto ${r.stato} a ${cosa}${r.json?.error?.message ? ': ' + r.json.error.message : ''}${r.stato === 429 || r.stato === 403 ? ' (l\'accesso alle API è stato approvato?)' : ''}`);
const breve = r => ({ id: r.reviewId || num(r.name), autore: r.reviewer?.isAnonymous ? 'Anonimo' : r.reviewer?.displayName || 'Anonimo', stelle: STELLE[r.starRating] || null,
  testo: String(r.comment || '').replace(/\(Translated by Google\)[\s\S]*$/, '').trim().slice(0, 1000), quando: r.updateTime || r.createTime, risposta: r.reviewReply?.comment || null });
// le recensioni più recenti (ordinate per aggiornamento), fino a «fino» o al massimo 5 pagine da 50
async function leggi(k, { fino = null, pagine = 5 } = {}) {
  const out = []; let pt = null, media = null, totale = null;
  for (let i = 0; i < pagine; i++) {
    const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(pt ? { pageToken: pt } : {}) });
    const r = await k.http.get(`${gbase(k)}/v4/${sede(k)}/reviews?${q}`, { bearer: await k.oauth.token() }); if (!r.ok) throw no(r, 'le recensioni');
    media ??= r.json?.averageRating ?? null; totale ??= r.json?.totalReviewCount ?? null;
    const rr = (r.json?.reviews || []).map(breve); out.push(...rr);
    pt = r.json?.nextPageToken; if (!pt || (fino && rr.some(x => x.quando <= fino))) break;
  }
  return { recensioni: out, media, totale };
}
async function giro(k) {
  const ultima = k.stato.leggi('ultima') || null, { recensioni, media, totale } = await leggi(k, { fino: ultima, pagine: ultima ? 5 : 1 });
  const nuove = ultima ? recensioni.filter(r => r.quando > ultima) : [];
  for (const r of nuove.slice(0, 10).reverse()) k.avvisa(`${r.risposta ? 'Recensione aggiornata' : 'Nuova recensione'} ${r.stelle ? '★'.repeat(r.stelle) : ''} da ${r.autore}${r.testo ? `: «${r.testo.slice(0, 200)}»` : ''}`);
  if (nuove.length > 10) k.avvisa(`…e altre ${nuove.length - 10} recensioni nuove`);
  if (recensioni[0]?.quando && recensioni[0].quando > (ultima || '')) k.stato.scrivi('ultima', recensioni[0].quando);
  k.stato.scrivi('recenti', recensioni.slice(0, 50));   // per le anteprime delle risposte e per Lumi
  return { nuove: nuove.length, senzaRisposta: nuove.filter(r => !r.risposta).length, media, totale };
}
const trova = async (k, id) => (k.stato.leggi('recenti') || []).find(r => r.id === id)
  || (await leggi(k, { pagine: 3 })).recensioni.find(r => r.id === id) || null;
export default {
  id: 'google-business', nome: 'Recensioni Google', versione: 1, icona: 'stella',
  descrizione: 'Le recensioni nuove della scheda Google come avviso, e le risposte scritte da Kubo (anche con Lumi).',
  impostazioni: [
    { id: 'account', nome: 'Id dell\'account (accounts/…)', schema: /^(accounts\/)?\d{5,30}$/ },
    { id: 'sede', nome: 'Id della sede (locations/…)', schema: /^(.*locations\/)?\d{5,30}$/ },
    { id: 'client_id', nome: 'Google: client ID OAuth', segreto: true }, { id: 'client_secret', nome: 'Google: client secret', segreto: true },
  ],
  permessi: {},   // non tocca i dati di Kubo: legge e risponde su Google
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/business.manage', extra: { access_type: 'offline', prompt: 'consent' } },
  prova: async k => { const { media, totale } = await leggi(k, { pagine: 1 }); return { ok: true, messaggio: `${totale ?? 0} recensioni, media ${media ?? '—'}` }; },
  pianificati: { recensioni: { nome: 'Recensioni nuove', ogni: '1h', giro } },
  azioni: {
    recensioni: {
      nome: 'Ultime recensioni', descrizione: 'Le recensioni più recenti della scheda Google: autore, stelle, testo, risposta e id (per rispondere)', lumi: true,
      esegui: async (x, k) => { const { recensioni, media, totale } = await leggi(k, { pagine: 1 }); return { media, totale, recensioni: recensioni.slice(0, 10) }; },
    },
    rispondi_recensione: {
      nome: 'Rispondi a una recensione', descrizione: 'Pubblica su Google la risposta a una recensione (sostituisce quella che c\'era)', lumi: true, scrive: true,
      input: { recensione: { tipo: 'testo', nome: 'L\'id della recensione' }, risposta: { tipo: 'testo', nome: 'Il testo della risposta, come la leggeranno tutti' } },
      async proponi({ recensione, risposta }, k) {
        const r = await trova(k, String(recensione || '')), t = String(risposta || '').trim();
        return { titolo: 'Risposta su Google', righe: [['Recensione', r ? `${r.stelle ? '★'.repeat(r.stelle) + ' ' : ''}${r.autore}${r.testo ? ` — «${r.testo.slice(0, 300)}»` : ''}` : String(recensione || '—')], ['Risposta', t || '—']],
          avvisi: [...(r ? [] : ['Non trovo questa recensione tra le ultime']), ...(r?.risposta ? ['C\'è già una risposta: verrà sostituita'] : []), ...(t ? [] : ['La risposta è vuota']), ...(t.length > 4096 ? ['La risposta supera i 4.096 caratteri'] : []), 'La risposta è pubblica, sotto la recensione'] };
      },
      async esegui({ recensione, risposta }, k) {
        const t = String(risposta || '').trim(); if (!t) throw new Error('La risposta è vuota'); if (t.length > 4096) throw new Error('La risposta supera i 4.096 caratteri');
        const id = num(recensione); if (!/^[\w-]{5,200}$/.test(id)) throw new Error('Id della recensione non valido');
        const r = await k.http.put(`${gbase(k)}/v4/${sede(k)}/reviews/${encodeURIComponent(id)}/reply`, { bearer: await k.oauth.token(), json: { comment: t } });
        if (!r.ok) throw no(r, 'la risposta');
        k.stato.scrivi('recenti', (k.stato.leggi('recenti') || []).map(x => (x.id === id ? { ...x, risposta: t } : x)));
        return { pubblicata: true, quando: r.json?.updateTime || null };
      },
    },
  },
  catalogo: {
    categoria: 'recensioni', sito: 'https://www.google.com/business/', costo: 'gratis',
    costoNota: 'Il Profilo dell\'attività su Google e le sue API sono gratuiti; l\'accesso alle API però va chiesto a Google e approvato (quota 300 richieste al minuto dopo l\'approvazione).',
    serve: [
      { cosa: 'L\'approvazione di Google all\'uso delle Business Profile API (modulo «GBP API contact form» → «Application for Basic API Access», con il numero del progetto Google Cloud)', dove: 'Business Profile APIs → Prerequisiti → modulo di richiesta di accesso; risponde Google per email, anche dopo settimane', link: 'https://developers.google.com/my-business/content/prereqs' },
      { cosa: 'Le API abilitate nel progetto: Google My Business API, My Business Account Management API, My Business Business Information API', dove: 'Google Cloud Console → API e servizi → Libreria', link: 'https://console.cloud.google.com/apis/library' },
      { cosa: 'Client ID e client secret OAuth (tipo «Applicazione web»)', dove: 'Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth', link: 'https://console.cloud.google.com/apis/credentials' },
      { cosa: 'L\'id dell\'account e della sede', dove: 'Con l\'API: accounts.list (My Business Account Management) e accounts.locations.list (Business Information); oppure in Business Profile Manager → la sede → Impostazioni avanzate → ID della sede', link: 'https://developers.google.com/my-business/content/basic-setup' },
    ],
    passi: [
      'Requisiti di Google: una scheda verificata attiva da più di 60 giorni e un sito web indicato nella scheda.',
      'Crea un progetto su Google Cloud Console e annota il «Numero di progetto».',
      'Compila il modulo di richiesta di accesso alle Business Profile API (Application for Basic API Access) con un\'email proprietaria o amministratrice della scheda; l\'attesa può essere di settimane.',
      'Finché la quota delle Business Profile API in Cloud Console è 0 richieste al minuto non sei approvato; con 300 sì: allora abilita le tre API e crea l\'ID client OAuth «Applicazione web» con l\'indirizzo di ritorno mostrato qui.',
      'Incolla client ID e secret, premi «Collega» e accedi con l\'account che gestisce la scheda.',
      'Scrivi l\'id dell\'account e della sede, poi «Prova la connessione»: da lì ogni ora le recensioni nuove arrivano come avviso, e puoi rispondere da Kubo o chiedere a Lumi una bozza.',
    ],
    difficolta: 'difficile', zone: ['mondo'],
    fonti: ['https://developers.google.com/my-business/content/review-data', 'https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews', 'https://developers.google.com/my-business/content/prereqs', 'https://developers.google.com/my-business/content/basic-setup', 'https://developers.google.com/identity/protocols/oauth2/web-server'],
    prova: 'finto', parole: ['google', 'recensioni', 'reviews', 'google maps', 'scheda', 'business profile', 'my business', 'stelle', 'rispondi', 'reputazione'],
  },
  testi: {
    en: { nome: 'Google Reviews', descrizione: 'New reviews of your Google listing as alerts, and replies written from Kubo (also with Lumi).', 'imp.account': 'Account id (accounts/…)', 'imp.sede': 'Location id (locations/…)', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret', 'az.recensioni': 'Latest reviews', 'az.rispondi_recensione': 'Reply to a review', 'giro.recensioni': 'New reviews',
      'cat.costoNota': 'The Google Business Profile and its APIs are free; API access must be requested from Google and approved (300 requests per minute after approval).',
      'cat.serve': [{ cosa: 'Google\'s approval to use the Business Profile APIs («GBP API contact form» → «Application for Basic API Access», with the Google Cloud project number)', dove: 'Business Profile APIs → Prerequisites → access request form; Google answers by email, even after weeks' }, { cosa: 'APIs enabled in the project: Google My Business API, My Business Account Management API, My Business Business Information API', dove: 'Google Cloud Console → APIs & Services → Library' }, { cosa: 'OAuth client ID and client secret («Web application»)', dove: 'Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID' }, { cosa: 'The account and location ids', dove: 'Via API: accounts.list and accounts.locations.list; or Business Profile Manager → the location → Advanced settings → Location ID' }],
      'cat.passi': ['Google\'s requirements: a verified listing active for more than 60 days and a website shown on the listing.', 'Create a project in Google Cloud Console and note the «Project number».', 'Fill in the Business Profile API access request form (Application for Basic API Access) with an email that owns or manages the listing; the wait can be weeks.', 'While the Business Profile API quota in Cloud Console is 0 requests per minute you are not approved; at 300 you are: then enable the three APIs and create a «Web application» OAuth client ID with the redirect address shown here.', 'Paste client ID and secret, press «Connect» and sign in with the account that manages the listing.', 'Enter the account and location ids, then «Test connection»: from then on new reviews arrive as alerts every hour, and you can reply from Kubo or ask Lumi for a draft.'] },
    es: { nome: 'Reseñas de Google', descrizione: 'Las reseñas nuevas de tu ficha de Google como aviso, y las respuestas escritas desde Kubo (también con Lumi).', 'imp.account': 'Id de la cuenta (accounts/…)', 'imp.sede': 'Id de la ubicación (locations/…)', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret', 'az.recensioni': 'Últimas reseñas', 'az.rispondi_recensione': 'Responder a una reseña', 'giro.recensioni': 'Reseñas nuevas' },
    fr: { nome: 'Avis Google', descrizione: 'Les nouveaux avis de votre fiche Google en alerte, et les réponses écrites depuis Kubo (aussi avec Lumi).', 'imp.account': 'Id du compte (accounts/…)', 'imp.sede': 'Id de l\'établissement (locations/…)', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret', 'az.recensioni': 'Derniers avis', 'az.rispondi_recensione': 'Répondre à un avis', 'giro.recensioni': 'Nouveaux avis' },
    de: { nome: 'Google-Rezensionen', descrizione: 'Neue Rezensionen Ihres Google-Eintrags als Hinweis, und Antworten aus Kubo (auch mit Lumi).', 'imp.account': 'Konto-ID (accounts/…)', 'imp.sede': 'Standort-ID (locations/…)', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret', 'az.recensioni': 'Neueste Rezensionen', 'az.rispondi_recensione': 'Auf eine Rezension antworten', 'giro.recensioni': 'Neue Rezensionen' },
    pt: { nome: 'Avaliações do Google', descrizione: 'As novas avaliações do seu perfil no Google como aviso, e as respostas escritas no Kubo (também com Lumi).', 'imp.account': 'Id da conta (accounts/…)', 'imp.sede': 'Id do local (locations/…)', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret', 'az.recensioni': 'Últimas avaliações', 'az.rispondi_recensione': 'Responder a uma avaliação', 'giro.recensioni': 'Avaliações novas' },
  },
};
