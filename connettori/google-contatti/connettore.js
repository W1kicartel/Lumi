// Google Contatti: i clienti di Lumi nella rubrica Google (Android e chi usa Gmail): quando chiamano, vedi chi è.
// People API: people:createContact la prima volta (il resourceName resta abbinato al cliente), poi
// :updateContact con l'etag (se è cambiato, 400 FAILED_PRECONDITION: si rilegge e si riprova una volta).
import { impRubrica, giroRubrica, uscitaRubrica, testiRubrica } from '../_comunica/rubrica.js';

const api = k => `${k.base || 'https://people.googleapis.com'}/v1`;
const persona = x => ({ names: [{ givenName: x.n, ...(x.cg ? { familyName: x.cg } : {}) }], phoneNumbers: x.tel ? [{ value: x.tel, type: 'mobile' }] : [], emailAddresses: x.email ? [{ value: x.email }] : [],
  ...(x.azienda ? { biographies: [{ value: x.azienda, contentType: 'TEXT_PLAIN' }] } : {}) });
const CAMPI = 'names,phoneNumbers,emailAddresses,biographies';
async function metti(k, x) {
  const tok = await k.oauth.token(), rn = k.sincro.remoto('clienti', x.id), etag = (k.stato.leggi('etag') || {})[x.id];
  const salva = e => k.stato.scrivi('etag', { ...(k.stato.leggi('etag') || {}), [x.id]: e });
  if (!rn) {
    const r = await k.http.post(`${api(k)}/people:createContact?personFields=metadata`, { bearer: tok, json: persona(x) });
    if (!r.ok) throw new Error(`Google Contatti: ${r.json?.error?.message || `HTTP ${r.stato}`}`);
    k.sincro.collega('clienti', x.id, r.json.resourceName); salva(r.json.etag); return;
  }
  for (let i = 0, e = etag; i < 2; i++) {
    if (!e) { const g = await k.http.get(`${api(k)}/${rn}?personFields=metadata`, { bearer: tok }); if (g.stato === 404) { k.sincro.scollega('clienti', { remoto: rn }); return metti(k, x); } e = g.json?.etag; }
    const r = await k.http.patch(`${api(k)}/${rn}:updateContact?updatePersonFields=${CAMPI}`, { bearer: tok, json: { etag: e, ...persona(x) } });
    if (r.ok) { salva(r.json?.etag); return; }
    if (r.stato === 404) { k.sincro.scollega('clienti', { remoto: rn }); return metti(k, x); }   // tolto dalla rubrica: si ricrea
    if (r.stato === 400 && /FAILED_PRECONDITION|etag/i.test(JSON.stringify(r.json || ''))) { e = null; continue; }   // cambiato sul telefono: si rilegge
    throw new Error(`Google Contatti: ${r.json?.error?.message || `HTTP ${r.stato}`}`);
  }
  throw new Error('Google Contatti: il contatto cambia mentre lo aggiorno, riprovo al prossimo giro');
}

export default {
  id: 'google-contatti', nome: 'Google Contatti', versione: 1, icona: 'clienti',
  descrizione: 'I clienti nella rubrica Google del telefono: quando chiamano, vedi chi è.',
  impostazioni: [{ id: 'client_id', nome: 'Google: client ID OAuth', segreto: true }, { id: 'client_secret', nome: 'Google: client secret', segreto: true }, ...impRubrica],
  richiede: { clienti: { nome: {}, telefono: { tipo: ['telefono'], facoltativo: true }, email: { tipo: ['email'], facoltativo: true } } },
  permessi: { clienti: { leggi: true } },
  oauth: { tipo: 'codice', autorizza: 'https://accounts.google.com/o/oauth2/v2/auth', token: k => (k.base ? `${k.base}/token` : 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/contacts', extra: { access_type: 'offline', prompt: 'consent' } },
  prova: async k => {
    if (!k.oauth.collegato()) return { ok: false, messaggio: 'Collega l\'account Google' };
    const r = await k.http.get(`${api(k)}/people/me/connections?personFields=names&pageSize=1`, { bearer: await k.oauth.token() });
    return { ok: r.ok, messaggio: r.ok ? `${r.json?.totalPeople ?? r.json?.totalItems ?? 0} contatti` : `HTTP ${r.stato}` };
  },
  uscita: Object.fromEntries(Object.entries(uscitaRubrica(metti)).map(([s, u]) => [s, { ...u, quando: (r, k) => k.oauth.collegato() }])),
  pianificati: { tutti: giroRubrica(metti) },
  catalogo: {
    categoria: 'produttivita', sito: 'https://contacts.google.com', costo: 'gratis',
    costoNota: 'Gratis con un account Google (fino a 25.000 contatti). La People API non ha costi.',
    serve: [{ cosa: 'Un client OAuth «Applicazione web» (client ID e client secret) con la People API abilitata', dove: 'console.cloud.google.com → API e servizi → Libreria → «People API» → Abilita; Credenziali → Crea credenziali → ID client OAuth → Applicazione web', link: 'https://console.cloud.google.com/apis/library/people.googleapis.com' }],
    passi: ['Su console.cloud.google.com crea un progetto (o usa quello di Calendario/Gmail) e abilita la People API', 'Nella schermata di consenso OAuth aggiungi l\'ambito contacts e pubblica l\'app (in Test il collegamento scade dopo 7 giorni)', 'Crea un ID client OAuth di tipo Applicazione web con l\'URI di reindirizzamento <indirizzo di Lumi>/api/connettori/google-contatti/oauth/ritorno', 'Incolla client ID e secret, premi «Collega» e accetta', 'Premi «Sincronizza ora» su «Tutti i clienti in rubrica»: da lì i clienti nuovi o cambiati vanno in rubrica da soli'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.google.com/people/api/rest/v1/people/createContact', 'https://developers.google.com/people/api/rest/v1/people/updateContact', 'https://developers.google.com/people/v1/contacts#create_a_new_contact', 'https://support.google.com/contacts/answer/7208229'],
    prova: 'finto', parole: ['google', 'contatti', 'rubrica', 'android', 'gmail', 'chi chiama', 'contacts', 'people api'],
  },
  testi: {
    en: { nome: 'Google Contacts', descrizione: 'Customers in your phone\'s Google address book: when they call, you see who it is.', 'imp.client_id': 'Google: OAuth client ID', 'imp.client_secret': 'Google: client secret', ...testiRubrica.en,
      'cat.costoNota': 'Free with a Google account (up to 25,000 contacts). The People API has no cost.',
      'cat.serve': [{ cosa: 'An OAuth «Web application» client (client ID and secret) with the People API enabled', dove: 'console.cloud.google.com → APIs & Services → Library → «People API» → Enable; Credentials → Create credentials → OAuth client ID → Web application' }],
      'cat.passi': ['On console.cloud.google.com create a project (or reuse the Calendar/Gmail one) and enable the People API', 'In the OAuth consent screen add the contacts scope and publish the app (in Testing the connection expires after 7 days)', 'Create a Web application OAuth client with the redirect URI <Lumi address>/api/connettori/google-contatti/oauth/ritorno', 'Paste client ID and secret, press «Connect» and accept', 'Press «Sync now» on «All customers in the address book»: from then on new or changed customers go in by themselves'] },
    es: { nome: 'Google Contactos', descrizione: 'Los clientes en la agenda de Google del móvil: cuando llaman, ves quién es.', 'imp.client_id': 'Google: client ID de OAuth', 'imp.client_secret': 'Google: client secret', ...testiRubrica.es },
    fr: { nome: 'Google Contacts', descrizione: 'Les clients dans le carnet Google du téléphone : quand ils appellent, tu sais qui c\'est.', 'imp.client_id': 'Google : client ID OAuth', 'imp.client_secret': 'Google : client secret', ...testiRubrica.fr },
    de: { nome: 'Google Kontakte', descrizione: 'Kunden im Google-Adressbuch des Handys: wenn sie anrufen, siehst du, wer es ist.', 'imp.client_id': 'Google: OAuth-Client-ID', 'imp.client_secret': 'Google: Client-Secret', ...testiRubrica.de },
    pt: { nome: 'Google Contatos', descrizione: 'Os clientes na agenda Google do celular: quando ligam, você vê quem é.', 'imp.client_id': 'Google: client ID OAuth', 'imp.client_secret': 'Google: client secret', ...testiRubrica.pt },
  },
};
