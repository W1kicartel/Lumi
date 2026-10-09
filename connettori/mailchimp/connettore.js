// Mailchimp: i clienti di Lumi nel pubblico (audience) della newsletter, con nome, telefono e tag.
// - in uscita: ogni cliente nuovo o cambiato va subito a Mailchimp (PUT del membro: crea o aggiorna, mai doppioni);
// - ogni ora un giro ripassa i clienti cambiati (anche la prima volta, tutti) e legge chi si è disiscritto in Mailchimp:
//   in Lumi il consenso diventa «no»;
// - facoltativo, il webhook di Mailchimp (unsubscribe, cleaned) toglie il consenso subito. Non è firmato: il codice
//   generato da Lumi va in fondo all'indirizzo (firma «token»), e la GET di controllo alla creazione risponde 200
//   (entrata.verificaGet). Il corpo è form-urlencoded con chiavi letterali «data[email]». Il giro orario resta: manda i
//   clienti cambiati e ripesca un disiscritto che il webhook avesse perso.
// Se la sezione clienti ha il campo del consenso, vanno a Mailchimp solo i clienti che l'hanno dato (GDPR).
// La chiave API finisce con il data center («…-us21»): l'indirizzo è https://us21.api.mailchimp.com/3.0, Basic auth.
import { md5, spezza, testo, cambiate } from '../_comunica/tabelle.js';
const dc = k => (/-([a-z]+\d+)$/.exec(String(k.segreti.chiave || '')) || [])[1];
const mbase = k => k.base || `https://${dc(k) || 'us1'}.api.mailchimp.com`;
const opz = (k, json) => ({ basic: ['lumi', k.segreti.chiave], ...(json ? { json } : {}) });
const lista = k => encodeURIComponent(String(k.imp.lista || '').trim());
const no = (r, cosa) => new Error(`Mailchimp ha risposto ${r.stato} a ${cosa}${r.json?.detail ? ': ' + r.json.detail : ''}`);
const conConsenso = k => !!k.campo('clienti', 'consenso');
// i tag del cliente: il valore del campo scelto (scelta, scelta multipla, relazione…) più il tag fisso
function tagDi(k, c) {
  const out = new Set(String(k.imp.tag_fisso || '').split(',').map(s => s.trim()).filter(Boolean)), campo = String(k.imp.tag_campo || '').trim();
  if (campo) for (const v of [].concat(c[k.campo('clienti', campo) || campo] ?? [])) { const t = testo(v).trim(); if (t) out.add(t.slice(0, 100)); }
  return [...out];
}
// un cliente nel pubblico: → 'iscritto' | 'senza email' | 'senza consenso'
async function iscrivi(k, c) {
  const email = String(k.valore(c, 'clienti', 'email') || '').trim().toLowerCase();
  if (!email) return 'senza email';
  if (conConsenso(k) && k.valore(c, 'clienti', 'consenso') !== true) return 'senza consenso';
  const { nome, cognome } = spezza(k.valore(c, 'clienti', 'nome')), tel = k.valore(c, 'clienti', 'telefono'), h = md5(email);
  const url = `${mbase(k)}/3.0/lists/${lista(k)}/members/${h}`, corpo = { email_address: email, status_if_new: k.imp.stato_nuovi || 'subscribed', merge_fields: { FNAME: nome, LNAME: cognome, ...(tel ? { PHONE: String(tel) } : {}) } };
  let r = await k.http.put(url, opz(k, corpo));
  // un pubblico senza il campo PHONE rifiuta i merge fields: si riprova con nome e cognome soltanto
  if (r.stato === 400 && tel && /merge/i.test(JSON.stringify(r.json || {}))) r = await k.http.put(url, opz(k, { ...corpo, merge_fields: { FNAME: nome, LNAME: cognome } }));
  if (!r.ok) throw no(r, `l'iscrizione di ${email}`);
  const tags = tagDi(k, c);
  if (tags.length) { const t = await k.http.post(`${url}/tags`, opz(k, { tags: tags.map(name => ({ name, status: 'active' })) })); if (!t.ok) throw no(t, 'i tag'); }
  return 'iscritto';
}
// chi si è disiscritto in Mailchimp dopo l'ultimo giro: in Lumi il consenso diventa «no»
async function disiscritti(k) {
  if (!conConsenso(k)) return 0;
  const dopo = k.stato.leggi('disiscritti') || new Date(Date.now() - 30 * 864e5).toISOString(); let n = 0, ultimo = dopo;
  for (let offset = 0; offset < 50000; offset += 1000) {
    const q = new URLSearchParams({ status: 'unsubscribed', since_last_changed: dopo, count: '1000', offset: String(offset), fields: 'members.email_address,members.last_changed,total_items' });
    const r = await k.http.get(`${mbase(k)}/3.0/lists/${lista(k)}/members?${q}`, opz(k)); if (!r.ok) throw no(r, 'l\'elenco dei disiscritti');
    for (const m of r.json?.members || []) {
      if (m.last_changed > ultimo) ultimo = m.last_changed;
      const c = k.dati.trova('clienti', 'email', m.email_address);
      if (c && k.valore(c, 'clienti', 'consenso') !== false) { k.dati.modifica('clienti', c.id, { consenso: false }); n++; }
    }
    if ((r.json?.members || []).length < 1000) break;
  }
  k.stato.scrivi('disiscritti', ultimo); return n;
}
// il webhook: chi si disiscrive (unsubscribe) o ha l'indirizzo che rimbalza (cleaned) perde il consenso in Lumi
function webhook(ev, k) {
  const tipo = String(ev?.type || ''), email = String(ev?.['data[email]'] || '').trim().toLowerCase();
  if (!['unsubscribe', 'cleaned'].includes(tipo)) return `ignorato: ${tipo || 'senza tipo'}`;
  if (k.imp.lista && ev['data[list_id]'] && ev['data[list_id]'] !== String(k.imp.lista).trim()) return 'ignorato: un altro pubblico';
  if (!email || !conConsenso(k)) return 'ignorato: senza email o senza il campo del consenso';
  const c = k.dati.trova('clienti', 'email', email); if (!c) return 'ignorato: cliente sconosciuto';
  if (k.valore(c, 'clienti', 'consenso') === false) return 'già senza consenso';
  k.dati.modifica('clienti', c.id, { consenso: false }); return `consenso tolto: ${email}`;
}
async function sincronizza(k) {
  const { righe, salva } = cambiate(k, k.entita('clienti')), conti = { iscritti: 0, saltati: 0 };
  for (const c of righe) { (await iscrivi(k, c)) === 'iscritto' ? conti.iscritti++ : conti.saltati++; salva(c.modificato); }
  return { ...conti, disiscritti: await disiscritti(k) };
}
export default {
  id: 'mailchimp', nome: 'Mailchimp', versione: 1, icona: 'utenti',
  descrizione: 'I clienti con il consenso nella lista della newsletter di Mailchimp, con i tag.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API (finisce con -us21 o simile)', segreto: true, schema: /^[0-9a-f]{32}-[a-z]+\d+$/ },
    { id: 'lista', nome: 'Id del pubblico (Audience ID)', schema: /^[0-9a-z]{6,20}$/ },
    { id: 'stato_nuovi', nome: 'I nuovi iscritti', tipo: 'scelta', opzioni: [{ id: 'subscribed', nome: 'Iscritti subito' }, { id: 'pending', nome: 'Ricevono l\'email di conferma (doppio opt-in)' }], predefinito: 'subscribed' },
    { id: 'tag_campo', nome: 'Campo dei clienti da usare come tag (es. tipo)' },
    { id: 'tag_fisso', nome: 'Tag per tutti (es. Lumi)', predefinito: 'Lumi' },
    { id: 'codice', nome: 'Codice segreto del webhook (va in fondo all\'indirizzo)', segreto: true, generato: true },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, consenso: { tipo: ['si_no'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, modifica: true } },   // modifica: solo il consenso di chi si disiscrive
  prova: async k => {
    if (!dc(k)) return { ok: false, messaggio: 'La chiave API deve finire con il data center, per esempio -us21' };
    const r = await k.http.get(`${mbase(k)}/3.0/lists/${lista(k)}?fields=name,stats.member_count`, opz(k));
    return { ok: r.ok, messaggio: r.ok ? `${r.json?.name}: ${r.json?.stats?.member_count ?? 0} iscritti` : `HTTP ${r.stato}` };
  },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'consenso'], quando: (r, k) => !!k.valore(r, 'clienti', 'email'), invia: async (riga, k) => { await iscrivi(k, riga); } } },
  azioni: {
    iscrivi: {
      nome: 'Iscrivi alla newsletter', descrizione: 'Mette il cliente nella lista della newsletter di Mailchimp, con i tag', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' } },
      proponi: async ({ cliente }, k) => { const e = k.valore(cliente, 'clienti', 'email'), senza = conConsenso(k) && k.valore(cliente, 'clienti', 'consenso') !== true;
        return { titolo: 'Iscrizione a Mailchimp', righe: [['Cliente', k.valore(cliente, 'clienti', 'nome') || '—'], ['Email', e || '—'], ['Tag', tagDi(k, cliente).join(', ') || '—']], avvisi: [...(e ? [] : ['Il cliente non ha un indirizzo email']), ...(senza ? ['Il cliente non ha dato il consenso: segnalo nella sua scheda prima di iscriverlo'] : [])] }; },
      async esegui({ cliente }, k) { const e = await iscrivi(k, cliente); if (e !== 'iscritto') throw new Error(e === 'senza email' ? 'Il cliente non ha un indirizzo email' : 'Il cliente non ha dato il consenso'); return { esito: e }; },
    },
    sincronizza_ora: {
      nome: 'Sincronizza ora con Mailchimp', descrizione: 'Manda a Mailchimp i clienti cambiati e legge chi si è disiscritto', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Sincronizza con Mailchimp', righe: [['Clienti da mandare', String(cambiate(k, k.entita('clienti')).righe.length)]], avvisi: [] }),
      esegui: async (x, k) => sincronizza(k),
    },
  },
  pianificati: { sincronizza: { nome: 'Clienti e disiscritti', ogni: '1h', giro: k => sincronizza(k) } },
  // POST <indirizzo pubblico>/api/connettori/mailchimp/in/<codice>: unsubscribe e cleaned; GET: il controllo di Mailchimp
  entrata: {
    firma: { tipo: 'token', segreto: 'codice' },
    verificaGet: () => ({ testo: '' }),
    idempotenza: ev => (ev?.type ? `${ev.type}:${ev['data[id]'] || ev['data[email]'] || ''}:${ev.fired_at || ''}`.slice(0, 300) : null),
    gestisci: (ev, k) => webhook(ev, k),
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://mailchimp.com', costo: 'abbonamento',
    costoNota: 'Piano Free fino a 250 contatti e 500 email al mese (un solo pubblico, l\'API c\'è). A pagamento da Essentials (circa 13 $ al mese per 500 contatti), il prezzo cresce con i contatti.',
    serve: [
      { cosa: 'Una chiave API (finisce con il data center, es. -us21)', dove: 'Mailchimp → icona del profilo → Profile → Extras → API keys → Create A Key', link: 'https://us1.admin.mailchimp.com/account/api/' },
      { cosa: 'L\'Audience ID del pubblico', dove: 'Audience → All contacts → Settings → Audience name and defaults → Audience ID', link: 'https://mailchimp.com/help/find-audience-id/' },
    ],
    passi: [
      'In Mailchimp crea una chiave API (Profile → Extras → API keys) e copiala subito: si vede una volta sola.',
      'Copia l\'Audience ID del pubblico in cui vuoi i clienti.',
      'Incolla chiave e Audience ID, scegli se i nuovi iscritti ricevono l\'email di conferma (doppio opt-in).',
      'Se vuoi, scegli un campo dei clienti da usare come tag (per esempio il tipo: privato o azienda).',
      'Premi «Prova la connessione», poi «Sincronizza ora»: passano solo i clienti con il consenso; chi si disiscrive in Mailchimp perde il consenso in Lumi ogni ora.',
      'Facoltativo, per togliere il consenso subito: con l\'indirizzo pubblico di Lumi impostato, in Audience → Settings → Webhooks crea un webhook con l\'URL che Lumi ti mostra (con il codice in fondo) e gli eventi Unsubscribes e Cleaned address.',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://mailchimp.com/developer/marketing/api/list-members/add-or-update-list-member/', 'https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/', 'https://mailchimp.com/developer/marketing/api/list-member-tags/add-or-remove-member-tags/', 'https://mailchimp.com/developer/marketing/api/list-members/list-members-info/', 'https://mailchimp.com/developer/marketing/docs/fundamentals/', 'https://mailchimp.com/pricing/marketing/'],
    prova: 'finto', parole: ['mailchimp', 'newsletter', 'email marketing', 'lista', 'audience', 'iscritti', 'subscribers', 'tag', 'campagne', 'campaigns'],
  },
  testi: {
    en: { nome: 'Mailchimp', descrizione: 'Customers who gave consent in your Mailchimp newsletter audience, with tags.', 'imp.chiave': 'API key (ends with -us21 or similar)', 'imp.lista': 'Audience ID', 'imp.stato_nuovi': 'New subscribers', 'imp.tag_campo': 'Customer field to use as tag (e.g. tipo)', 'imp.tag_fisso': 'Tag for everyone (e.g. Lumi)', 'imp.codice': 'Webhook secret code (goes at the end of the address)', 'az.iscrivi': 'Subscribe to the newsletter', 'az.sincronizza_ora': 'Sync now with Mailchimp', 'giro.sincronizza': 'Customers and unsubscribes',
      'cat.costoNota': 'Free plan up to 250 contacts and 500 emails a month (one audience, API included). Paid from Essentials (about $13 a month for 500 contacts), price grows with contacts.',
      'cat.serve': [{ cosa: 'An API key (ends with the data center, e.g. -us21)', dove: 'Mailchimp → profile icon → Profile → Extras → API keys → Create A Key' }, { cosa: 'The Audience ID', dove: 'Audience → All contacts → Settings → Audience name and defaults → Audience ID' }],
      'cat.passi': ['In Mailchimp create an API key (Profile → Extras → API keys) and copy it right away: it is shown only once.', 'Copy the Audience ID of the audience you want customers in.', 'Paste key and Audience ID, choose whether new subscribers get the confirmation email (double opt-in).', 'Optionally choose a customer field to use as tag (e.g. the type: private or company).', 'Press «Test connection», then «Sync now»: only customers with consent go; whoever unsubscribes in Mailchimp loses consent in Lumi every hour.', 'Optional, to remove consent right away: with Lumi\'s public address set, in Audience → Settings → Webhooks create a webhook with the URL Lumi shows you (code at the end) and the Unsubscribes and Cleaned address events.'] },
    es: { nome: 'Mailchimp', descrizione: 'Los clientes con consentimiento en la lista de la newsletter de Mailchimp, con etiquetas.', 'imp.chiave': 'Clave API (termina en -us21 o similar)', 'imp.lista': 'Id de la audiencia (Audience ID)', 'imp.stato_nuovi': 'Los nuevos suscriptores', 'imp.tag_campo': 'Campo de clientes usado como etiqueta (p. ej. tipo)', 'imp.tag_fisso': 'Etiqueta para todos (p. ej. Lumi)', 'imp.codice': 'Código secreto del webhook (va al final de la dirección)', 'az.iscrivi': 'Suscribir a la newsletter', 'az.sincronizza_ora': 'Sincronizar ahora con Mailchimp', 'giro.sincronizza': 'Clientes y bajas' },
    fr: { nome: 'Mailchimp', descrizione: 'Les clients ayant donné leur consentement dans l\'audience de la newsletter Mailchimp, avec des tags.', 'imp.chiave': 'Clé API (finit par -us21 ou similaire)', 'imp.lista': 'Id de l\'audience (Audience ID)', 'imp.stato_nuovi': 'Les nouveaux inscrits', 'imp.tag_campo': 'Champ client utilisé comme tag (ex. tipo)', 'imp.tag_fisso': 'Tag pour tous (ex. Lumi)', 'imp.codice': 'Code secret du webhook (à la fin de l\'adresse)', 'az.iscrivi': 'Inscrire à la newsletter', 'az.sincronizza_ora': 'Synchroniser maintenant avec Mailchimp', 'giro.sincronizza': 'Clients et désinscriptions' },
    de: { nome: 'Mailchimp', descrizione: 'Kunden mit Einwilligung in der Mailchimp-Newsletter-Zielgruppe, mit Tags.', 'imp.chiave': 'API-Schlüssel (endet auf -us21 o. Ä.)', 'imp.lista': 'Zielgruppen-ID (Audience ID)', 'imp.stato_nuovi': 'Neue Abonnenten', 'imp.tag_campo': 'Kundenfeld als Tag (z. B. tipo)', 'imp.tag_fisso': 'Tag für alle (z. B. Lumi)', 'imp.codice': 'Geheimcode des Webhooks (am Ende der Adresse)', 'az.iscrivi': 'Für den Newsletter anmelden', 'az.sincronizza_ora': 'Jetzt mit Mailchimp abgleichen', 'giro.sincronizza': 'Kunden und Abmeldungen' },
    pt: { nome: 'Mailchimp', descrizione: 'Os clientes com consentimento no público da newsletter do Mailchimp, com tags.', 'imp.chiave': 'Chave API (termina com -us21 ou similar)', 'imp.lista': 'Id do público (Audience ID)', 'imp.stato_nuovi': 'Os novos inscritos', 'imp.tag_campo': 'Campo do cliente usado como tag (ex. tipo)', 'imp.tag_fisso': 'Tag para todos (ex. Lumi)', 'imp.codice': 'Código secreto do webhook (vai no fim do endereço)', 'az.iscrivi': 'Inscrever na newsletter', 'az.sincronizza_ora': 'Sincronizar agora com o Mailchimp', 'giro.sincronizza': 'Clientes e cancelamentos' },
  },
};
