// Trustpilot: le recensioni nuove dell'azienda come avviso, la risposta da qui (anche con l'assistente) e l'invito a lasciare
// una recensione mandato da Trustpilot a un cliente («chiedi una recensione ad Anna»).
// - lettura: API pubbliche con l'API key nell'intestazione «apikey» (GET /v1/business-units/{id}/reviews);
// - risposte e inviti: token «business user» con il grant client_credentials (API key e secret), che dura 100 ore;
//   con questo grant gli inviti vogliono l'id dell'utente business nell'intestazione x-business-user-id.
const tbase = k => k.base || 'https://api.trustpilot.com';
const ibase = k => k.base || 'https://invitations-api.trustpilot.com';
const pub = k => ({ intestazioni: { apikey: k.segreti.chiave } });
const no = (r, cosa) => new Error(`Trustpilot ha risposto ${r.stato} a ${cosa}${r.json?.message ? ': ' + r.json.message : r.json?.details ? ': ' + r.json.details : ''}`);
const breve = r => ({ id: r.id, autore: r.consumer?.displayName || 'Anonimo', stelle: r.stars ?? null, titolo: r.title || '', testo: String(r.text || '').slice(0, 1000), quando: r.createdAt, risposta: r.companyReply?.text || null });
// l'id della «business unit» si trova dal dominio la prima volta, poi resta in k.stato
async function unita(k) {
  const dom = String(k.imp.dominio || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const s = k.stato.leggi('unita'); if (s?.dominio === dom && s.id) return s.id;
  if (/^[0-9a-f]{24}$/.test(dom)) { k.stato.scrivi('unita', { dominio: dom, id: dom, nome: dom }); return dom; }   // già l'id della business unit
  // «find» per nome di dominio; se non risponde, la ricerca documentata (/search?query=) prendendo il risultato con quel dominio
  let r = await k.http.get(`${tbase(k)}/v1/business-units/find?${new URLSearchParams({ name: dom })}`, pub(k)), u = r.ok && r.json?.id ? r.json : null;
  if (!u) { r = await k.http.get(`${tbase(k)}/v1/business-units/search?${new URLSearchParams({ query: dom })}`, pub(k)); const l = r.json?.businessUnits || [];
    u = l.find(x => [x.name?.identifying, x.identifyingName, ...(x.name?.referring || [])].includes(dom)) || l[0] || null; }
  if (!u?.id) throw no(r, `la ricerca di ${dom}`);
  k.stato.scrivi('unita', { dominio: dom, id: u.id, nome: u.displayName || dom }); return u.id;
}
async function leggi(k) {
  const r = await k.http.get(`${tbase(k)}/v1/business-units/${await unita(k)}/reviews?perPage=100&orderBy=createdat.desc`, pub(k));
  if (!r.ok) throw no(r, 'le recensioni'); return (r.json?.reviews || []).map(breve);
}
async function giro(k) {
  const ultima = k.stato.leggi('ultima') || null, tutte = await leggi(k), nuove = ultima ? tutte.filter(r => r.quando > ultima) : [];
  for (const r of nuove.slice(0, 10).reverse()) k.avvisa(`Nuova recensione ${r.stelle ? '★'.repeat(r.stelle) : ''} da ${r.autore}: «${(r.titolo || r.testo).slice(0, 200)}»`);
  if (tutte[0]?.quando && tutte[0].quando > (ultima || '')) k.stato.scrivi('ultima', tutte[0].quando);
  k.stato.scrivi('recenti', tutte.slice(0, 50));
  return { nuove: nuove.length, senzaRisposta: nuove.filter(r => !r.risposta).length };
}
const utente = k => String(k.imp.utente || '').trim() || null;
export default {
  id: 'trustpilot', nome: 'Trustpilot', versione: 1, icona: 'stella',
  descrizione: 'Recensioni Trustpilot come avviso, risposte da Lumi e inviti a recensire mandati ai clienti.',
  impostazioni: [
    { id: 'chiave', nome: 'API key', segreto: true }, { id: 'segreto', nome: 'API secret', segreto: true },
    { id: 'dominio', nome: 'Dominio dell\'azienda su Trustpilot (es. bottega.it) o id della business unit' },
    { id: 'utente', nome: 'Id dell\'utente business (per inviti e risposte)' },
    { id: 'modello', nome: 'Id del modello di invito (vuoto = quello predefinito)' },
    { id: 'mittente', nome: 'Nome del mittente degli inviti (es. Bottega Rossi)' },
    { id: 'rispondi_a', nome: 'Email per le risposte agli inviti', schema: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] } } },
  permessi: { clienti: { leggi: true } },
  oauth: { tipo: 'client', client: 'chiave', segreto: 'segreto', token: k => `${tbase(k)}/v1/oauth/oauth-business-users-for-applications/accesstoken` },
  prova: async k => { const id = await unita(k), s = k.stato.leggi('unita'); return { ok: !!id, messaggio: `${s?.nome || id}` }; },
  pianificati: { recensioni: { nome: 'Recensioni nuove', ogni: '1h', giro } },
  azioni: {
    recensioni: { nome: 'Ultime recensioni Trustpilot', descrizione: 'Le recensioni più recenti su Trustpilot: autore, stelle, testo, risposta e id', lumi: true,
      esegui: async (x, k) => ({ recensioni: (await leggi(k)).slice(0, 10) }) },
    rispondi_recensione: {
      nome: 'Rispondi su Trustpilot', descrizione: 'Pubblica su Trustpilot la risposta dell\'azienda a una recensione', lumi: true, scrive: true,
      input: { recensione: { tipo: 'testo', nome: 'L\'id della recensione' }, risposta: { tipo: 'testo', nome: 'Il testo della risposta, pubblico' } },
      proponi: async ({ recensione, risposta }, k) => { const r = (k.stato.leggi('recenti') || []).find(x => x.id === recensione), t = String(risposta || '').trim();
        return { titolo: 'Risposta su Trustpilot', righe: [['Recensione', r ? `${r.stelle ? '★'.repeat(r.stelle) + ' ' : ''}${r.autore} — «${(r.titolo || r.testo).slice(0, 300)}»` : String(recensione || '—')], ['Risposta', t || '—']],
          avvisi: [...(r ? [] : ['Non trovo questa recensione tra le ultime']), ...(r?.risposta ? ['C\'è già una risposta: verrà sostituita'] : []), ...(t ? [] : ['La risposta è vuota']), 'La risposta è pubblica'] }; },
      async esegui({ recensione, risposta }, k) {
        const t = String(risposta || '').trim(), id = String(recensione || '').trim(); if (!t) throw new Error('La risposta è vuota'); if (!/^[0-9a-f]{24}$/i.test(id)) throw new Error('Id della recensione non valido');
        const r = await k.http.post(`${tbase(k)}/v1/private/reviews/${id}/reply`, { bearer: await k.oauth.token(), json: { message: t, ...(utente(k) ? { authorBusinessUserId: utente(k) } : {}) } });
        if (!r.ok) throw no(r, 'la risposta'); return { pubblicata: true };
      },
    },
    chiedi_recensione: {
      nome: 'Chiedi una recensione', descrizione: 'Trustpilot manda al cliente l\'email di invito a lasciare una recensione', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' } },
      proponi: async ({ cliente }, k) => { const e = k.valore(cliente, 'clienti', 'email');
        return { titolo: 'Invito Trustpilot', righe: [['Cliente', k.valore(cliente, 'clienti', 'nome') || '—'], ['Email', e || '—'], ['Mittente', k.imp.mittente || '—']], avvisi: e ? [] : ['Il cliente non ha un indirizzo email'] }; },
      async esegui({ cliente }, k) {
        const e = k.valore(cliente, 'clienti', 'email'); if (!e) throw new Error('Il cliente non ha un indirizzo email');
        const corpo = { consumerEmail: e, consumerName: k.valore(cliente, 'clienti', 'nome') || e, referenceNumber: cliente.id, locale: 'it-IT', type: 'email',
          ...(k.imp.mittente ? { senderName: k.imp.mittente } : {}), ...(k.imp.rispondi_a ? { replyTo: k.imp.rispondi_a } : {}),
          serviceReviewInvitation: { ...(k.imp.modello ? { templateId: k.imp.modello } : {}), preferredSendTime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') } };
        const r = await k.http.post(`${ibase(k)}/v1/private/business-units/${await unita(k)}/email-invitations`, { bearer: await k.oauth.token(), json: corpo, intestazioni: utente(k) ? { 'x-business-user-id': utente(k) } : {} });
        if (!r.ok) throw no(r, 'l\'invito'); return { invitato: e };
      },
    },
  },
  catalogo: {
    categoria: 'recensioni', sito: 'https://business.trustpilot.com', costo: 'abbonamento',
    costoNota: 'Il piano Free permette di raccogliere e rispondere alle recensioni dal sito, ma le chiavi API (lettura, risposte, inviti) sono incluse solo nei piani a pagamento superiori; prezzi su business.trustpilot.com/plans, a partire da alcune centinaia di euro al mese.',
    serve: [
      { cosa: 'API key e API secret dell\'applicazione', dove: 'Trustpilot Business → Integrations → Developers → API → Create application', link: 'https://businessapp.b2b.trustpilot.com/applications' },
      { cosa: 'Il dominio dell\'azienda come compare su Trustpilot', dove: 'È l\'indirizzo della pagina pubblica: trustpilot.com/review/<dominio>', link: 'https://www.trustpilot.com' },
      { cosa: 'L\'id dell\'utente business (per inviti e risposte con le credenziali dell\'applicazione)', dove: 'Trustpilot Business → Settings → Users: l\'utente che firma le risposte; oppure chiedilo al supporto API', link: 'https://developers.trustpilot.com/authentication' },
    ],
    passi: [
      'Verifica che il tuo piano Trustpilot includa l\'accesso alle API (altrimenti la sezione Developers non c\'è).',
      'In Trustpilot Business → Integrations → Developers crea un\'applicazione e copia API key e secret.',
      'Incolla key, secret e il dominio dell\'azienda; premi «Prova la connessione»: Lumi trova la tua pagina.',
      'Per risposte e inviti scrivi l\'id dell\'utente business, il nome del mittente e l\'email per le risposte.',
      'Da lì ogni ora le recensioni nuove arrivano come avviso; dalla scheda del cliente puoi «Chiedere una recensione», anche tramite Lumi.',
    ],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://developers.trustpilot.com/authentication', 'https://developers.trustpilot.com/service-reviews-api', 'https://developers.trustpilot.com/invitation-api', 'https://developers.trustpilot.com/business-units-api', 'https://business.trustpilot.com/plans'],
    prova: 'finto', parole: ['trustpilot', 'recensioni', 'reviews', 'reputazione', 'inviti', 'invitations', 'stelle', 'feedback'],
  },
  testi: {
    en: { nome: 'Trustpilot', descrizione: 'Trustpilot reviews as alerts, replies from Lumi and review invitations sent to customers.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.dominio': 'Company domain on Trustpilot (e.g. shop.com) or business unit id', 'imp.utente': 'Business user id (for invitations and replies)', 'imp.modello': 'Invitation template id (empty = the default)', 'imp.mittente': 'Invitation sender name (e.g. Rossi Shop)', 'imp.rispondi_a': 'Reply-to email for invitations', 'az.recensioni': 'Latest Trustpilot reviews', 'az.rispondi_recensione': 'Reply on Trustpilot', 'az.chiedi_recensione': 'Ask for a review', 'giro.recensioni': 'New reviews',
      'cat.costoNota': 'The Free plan lets you collect and reply to reviews on the website, but API keys (reading, replies, invitations) come only with the higher paid plans; prices on business.trustpilot.com/plans, from a few hundred euros a month.',
      'cat.serve': [{ cosa: 'The application API key and API secret', dove: 'Trustpilot Business → Integrations → Developers → API → Create application' }, { cosa: 'The company domain as shown on Trustpilot', dove: 'It is the public page address: trustpilot.com/review/<domain>' }, { cosa: 'The business user id (for invitations and replies with application credentials)', dove: 'Trustpilot Business → Settings → Users: the user who signs replies; or ask API support' }],
      'cat.passi': ['Check that your Trustpilot plan includes API access (otherwise there is no Developers section).', 'In Trustpilot Business → Integrations → Developers create an application and copy API key and secret.', 'Paste key, secret and the company domain; press «Test connection»: Lumi finds your page.', 'For replies and invitations enter the business user id, the sender name and the reply-to email.', 'From then on new reviews arrive as alerts every hour; from a customer card you can «Ask for a review», also through Lumi.'] },
    es: { nome: 'Trustpilot', descrizione: 'Reseñas de Trustpilot como aviso, respuestas desde Lumi e invitaciones a reseñar enviadas a los clientes.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.dominio': 'Dominio de la empresa en Trustpilot (p. ej. tienda.es)', 'imp.utente': 'Id del usuario business (para invitaciones y respuestas)', 'imp.modello': 'Id de la plantilla de invitación (vacío = la predeterminada)', 'imp.mittente': 'Nombre del remitente de las invitaciones', 'imp.rispondi_a': 'Email de respuesta de las invitaciones', 'az.recensioni': 'Últimas reseñas de Trustpilot', 'az.rispondi_recensione': 'Responder en Trustpilot', 'az.chiedi_recensione': 'Pedir una reseña', 'giro.recensioni': 'Reseñas nuevas' },
    fr: { nome: 'Trustpilot', descrizione: 'Avis Trustpilot en alerte, réponses depuis Lumi et invitations à laisser un avis envoyées aux clients.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.dominio': 'Domaine de l\'entreprise sur Trustpilot (ex. boutique.fr)', 'imp.utente': 'Id de l\'utilisateur business (invitations et réponses)', 'imp.modello': 'Id du modèle d\'invitation (vide = celui par défaut)', 'imp.mittente': 'Nom de l\'expéditeur des invitations', 'imp.rispondi_a': 'E-mail de réponse des invitations', 'az.recensioni': 'Derniers avis Trustpilot', 'az.rispondi_recensione': 'Répondre sur Trustpilot', 'az.chiedi_recensione': 'Demander un avis', 'giro.recensioni': 'Nouveaux avis' },
    de: { nome: 'Trustpilot', descrizione: 'Trustpilot-Bewertungen als Hinweis, Antworten aus Lumi und Bewertungseinladungen an Kunden.', 'imp.chiave': 'API-Key', 'imp.segreto': 'API-Secret', 'imp.dominio': 'Firmendomain auf Trustpilot (z. B. laden.de)', 'imp.utente': 'ID des Business-Benutzers (für Einladungen und Antworten)', 'imp.modello': 'ID der Einladungsvorlage (leer = Standard)', 'imp.mittente': 'Absendername der Einladungen', 'imp.rispondi_a': 'Antwort-E-Mail für Einladungen', 'az.recensioni': 'Neueste Trustpilot-Bewertungen', 'az.rispondi_recensione': 'Auf Trustpilot antworten', 'az.chiedi_recensione': 'Um eine Bewertung bitten', 'giro.recensioni': 'Neue Bewertungen' },
    pt: { nome: 'Trustpilot', descrizione: 'Avaliações do Trustpilot como aviso, respostas pelo Lumi e convites para avaliar enviados aos clientes.', 'imp.chiave': 'API key', 'imp.segreto': 'API secret', 'imp.dominio': 'Domínio da empresa no Trustpilot (ex. loja.com.br)', 'imp.utente': 'Id do usuário business (para convites e respostas)', 'imp.modello': 'Id do modelo de convite (vazio = o padrão)', 'imp.mittente': 'Nome do remetente dos convites', 'imp.rispondi_a': 'Email de resposta dos convites', 'az.recensioni': 'Últimas avaliações do Trustpilot', 'az.rispondi_recensione': 'Responder no Trustpilot', 'az.chiedi_recensione': 'Pedir uma avaliação', 'giro.recensioni': 'Avaliações novas' },
  },
};
