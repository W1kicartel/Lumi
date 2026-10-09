// MailerLite (la newsletter con il piano gratuito, molto usata in Italia): i clienti con il consenso tra gli iscritti.
// - in uscita: ogni cliente nuovo o cambiato va subito a MailerLite (POST /subscribers crea o aggiorna: mai doppioni),
//   con nome, cognome, telefono e il gruppo scelto; se in Kubo il consenso viene tolto, l'iscritto diventa «unsubscribed»;
// - ogni 30 minuti un giro ripassa i clienti cambiati e legge chi si è disiscritto in MailerLite
//   (filter[status]=unsubscribed): in Kubo il consenso diventa «no». Il webhook di MailerLite non serve.
// Se la sezione clienti ha il campo del consenso, passano solo i clienti che l'hanno dato (GDPR).
// API nuova: https://connect.mailerlite.com/api, Bearer; 120 richieste al minuto.
import { spezza, cambiate } from '../_comunica/tabelle.js';
const mbase = k => k.base || 'https://connect.mailerlite.com';
const opz = (k, json) => ({ bearer: k.segreti.token, intestazioni: { Accept: 'application/json' }, ...(json ? { json } : {}) });
const no = (r, cosa) => new Error(`MailerLite ha risposto ${r.stato} a ${cosa}${r.json?.message ? ': ' + r.json.message : ''}`);
const conConsenso = k => !!k.campo('clienti', 'consenso');
const pausa = ms => new Promise(r => setTimeout(r, ms));
// un cliente tra gli iscritti: → 'iscritto' | 'disiscritto' | 'senza email' | 'senza consenso'
async function iscrivi(k, c) {
  const email = String(k.valore(c, 'clienti', 'email') || '').trim().toLowerCase();
  if (!email) return 'senza email';
  if (conConsenso(k) && k.valore(c, 'clienti', 'consenso') !== true) {
    if (!k.sincro.remoto('clienti', c.id)) return 'senza consenso';
    const r = await k.http.post(`${mbase(k)}/api/subscribers`, opz(k, { email, status: 'unsubscribed' }));
    if (!r.ok) throw no(r, `la disiscrizione di ${email}`);
    return 'disiscritto';
  }
  const { nome, cognome } = spezza(k.valore(c, 'clienti', 'nome')), tel = k.campo('clienti', 'telefono') && k.valore(c, 'clienti', 'telefono');
  const json = { email, fields: { name: nome, last_name: cognome, ...(tel ? { phone: String(tel) } : {}) }, ...(k.imp.gruppo ? { groups: [String(k.imp.gruppo)] } : {}) };
  const r = await k.http.post(`${mbase(k)}/api/subscribers`, opz(k, json));
  if (!r.ok) throw no(r, `l'iscrizione di ${email}`);
  if (r.json?.data?.id) k.sincro.collega('clienti', c.id, r.json.data.id);
  return 'iscritto';
}
// chi si è disiscritto in MailerLite (dopo l'ultimo giro): in Kubo il consenso diventa «no»
async function disiscritti(k) {
  if (!conConsenso(k)) return 0;
  const dopo = k.stato.leggi('disiscritti') || ''; let n = 0, ultimo = dopo, cursor = null;
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ 'filter[status]': 'unsubscribed', limit: '100', ...(cursor ? { cursor } : {}) });
    const r = await k.http.get(`${mbase(k)}/api/subscribers?${q}`, opz(k)); if (!r.ok) throw no(r, 'l\'elenco dei disiscritti');
    for (const s of r.json?.data || []) {
      const quando = String(s.unsubscribed_at || s.updated_at || ''); if (dopo && quando && quando <= dopo) continue;
      if (quando > ultimo) ultimo = quando;
      const c = k.dati.trova('clienti', 'email', String(s.email || '').toLowerCase());
      if (c && k.valore(c, 'clienti', 'consenso') !== false) { k.dati.modifica('clienti', c.id, { consenso: false }); n++; }
    }
    cursor = r.json?.meta?.next_cursor; if (!cursor) break;
  }
  if (ultimo) k.stato.scrivi('disiscritti', ultimo);
  return n;
}
async function sincronizza(k, { tutto = false } = {}) {
  const e = k.entita('clienti'); if (tutto) k.stato.scrivi(`cursore:${e}`, null);
  const { righe, salva } = cambiate(k, e), conti = { iscritti: 0, saltati: 0 };
  for (const [i, c] of righe.entries()) { if (i) await pausa(500); (await iscrivi(k, c)) === 'iscritto' ? conti.iscritti++ : conti.saltati++; salva(c.modificato); }
  return { ...conti, disiscritti: await disiscritti(k) };
}
export default {
  id: 'mailerlite', nome: 'MailerLite', versione: 1, icona: 'utenti',
  descrizione: 'I clienti con il consenso tra gli iscritti della newsletter di MailerLite; chi si disiscrive torna in Kubo.',
  impostazioni: [
    { id: 'token', nome: 'Token API', segreto: true, schema: /^[A-Za-z0-9._-]{40,}$/ },
    { id: 'gruppo', nome: 'Id del gruppo dove mettere i clienti (facoltativo)', schema: /^\d{5,25}$/, obbligatorio: false },
  ],
  richiede: { clienti: { nome: {}, email: { tipo: ['email'] }, telefono: { tipo: ['telefono', 'testo'], facoltativo: true }, consenso: { tipo: ['si_no'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, modifica: true } },   // modifica: solo il consenso di chi si disiscrive
  prova: async k => {
    const r = await k.http.get(`${mbase(k)}/api/groups?limit=100`, opz(k)); if (!r.ok) return { ok: false, messaggio: `HTTP ${r.stato}` };
    const g = k.imp.gruppo && (r.json?.data || []).find(x => String(x.id) === String(k.imp.gruppo));
    return { ok: !k.imp.gruppo || !!g, messaggio: k.imp.gruppo ? (g ? `Gruppo «${g.name}»` : `Il gruppo ${k.imp.gruppo} non c'è`) : `${(r.json?.data || []).length} gruppi` };
  },
  uscita: { clienti: { campi: ['nome', 'email', 'telefono', 'consenso'], quando: (r, k) => !!k.valore(r, 'clienti', 'email'), invia: async (riga, k) => { await iscrivi(k, riga); } } },
  pianificati: { sincronizza: { nome: 'Clienti cambiati e disiscritti', ogni: '30m', giro: k => sincronizza(k) } },
  azioni: {
    sincronizza_ora: {
      nome: 'Sincronizza ora con MailerLite', descrizione: 'Ripassa tutti i clienti con il consenso e legge chi si è disiscritto', lumi: true, scrive: true,
      proponi: async (x, k) => ({ titolo: 'Sincronizza con MailerLite', righe: [['Clienti', 'tutti (con email' + (conConsenso(k) ? ' e consenso)' : ')')], ['Gruppo', k.imp.gruppo || '—']], avvisi: conConsenso(k) ? [] : ['La sezione clienti non ha il campo del consenso: passano tutti i clienti con email'] }),
      esegui: async (x, k) => sincronizza(k, { tutto: true }),
    },
  },
  catalogo: {
    categoria: 'marketing', sito: 'https://www.mailerlite.com', costo: 'gratis',
    costoNota: 'Piano Free gratuito fino a 500 iscritti e 12.000 email al mese, con l\'API. Growing Business da circa 10 $ al mese (500 iscritti), il prezzo sale con gli iscritti.',
    serve: [
      { cosa: 'Un token API', dove: 'MailerLite → Integrazioni → API → Genera un nuovo token (dagli un nome, es. Kubo)', link: 'https://dashboard.mailerlite.com/integrations/api' },
      { cosa: 'Facoltativo: l\'id del gruppo', dove: 'Iscritti → Gruppi → apri il gruppo: è il numero nell\'indirizzo', link: 'https://www.mailerlite.com/help/how-to-create-and-use-groups' },
    ],
    passi: [
      'In MailerLite apri Integrazioni → API e genera un token: copialo subito.',
      'Se vuoi i clienti in un gruppo, crealo in Iscritti → Gruppi e copia il numero dall\'indirizzo.',
      'Incolla token e id del gruppo e premi «Prova la connessione».',
      'Premi «Sincronizza ora con MailerLite»: passano i clienti con email e consenso.',
      'Da lì ogni cliente nuovo o cambiato va subito a MailerLite, e ogni 30 minuti chi si disiscrive perde il consenso in Kubo.',
    ],
    difficolta: 'facile', zone: ['mondo', 'UE'],
    fonti: ['https://developers.mailerlite.com/docs/subscribers.html', 'https://developers.mailerlite.com/docs/groups.html', 'https://developers.mailerlite.com/docs/#authentication', 'https://www.mailerlite.com/pricing'],
    prova: 'finto', parole: ['mailerlite', 'newsletter', 'email marketing', 'iscritti', 'subscribers', 'gruppi', 'consenso', 'gdpr'],
  },
  testi: {
    en: { nome: 'MailerLite', descrizione: 'Customers with consent among the MailerLite newsletter subscribers; unsubscribes come back to Kubo.', 'imp.token': 'API token', 'imp.gruppo': 'Group id for customers (optional)', 'az.sincronizza_ora': 'Sync now with MailerLite', 'giro.sincronizza': 'Changed customers and unsubscribes',
      'cat.costoNota': 'Free plan up to 500 subscribers and 12,000 emails per month, API included. Growing Business from about $10 per month (500 subscribers), price grows with subscribers.',
      'cat.serve': [{ cosa: 'An API token', dove: 'MailerLite → Integrations → API → Generate new token (give it a name, e.g. Kubo)' }, { cosa: 'Optional: the group id', dove: 'Subscribers → Groups → open the group: it is the number in the address' }],
      'cat.passi': ['In MailerLite open Integrations → API and generate a token: copy it now.', 'To put customers in a group, create it in Subscribers → Groups and copy the number from the address.', 'Paste token and group id and press «Test connection».', 'Press «Sync now with MailerLite»: customers with email and consent go over.', 'From then on every new or changed customer goes to MailerLite at once, and every 30 minutes those who unsubscribe lose consent in Kubo.'] },
    es: { nome: 'MailerLite', descrizione: 'Los clientes con consentimiento entre los suscriptores de MailerLite; las bajas vuelven a Kubo.', 'imp.token': 'Token API', 'imp.gruppo': 'Id del grupo para los clientes (opcional)', 'az.sincronizza_ora': 'Sincronizar ahora con MailerLite', 'giro.sincronizza': 'Clientes cambiados y bajas' },
    fr: { nome: 'MailerLite', descrizione: 'Les clients avec consentement parmi les abonnés MailerLite ; les désinscriptions reviennent dans Kubo.', 'imp.token': 'Jeton API', 'imp.gruppo': 'Id du groupe pour les clients (facultatif)', 'az.sincronizza_ora': 'Synchroniser maintenant avec MailerLite', 'giro.sincronizza': 'Clients modifiés et désinscriptions' },
    de: { nome: 'MailerLite', descrizione: 'Kunden mit Einwilligung unter den MailerLite-Abonnenten; Abmeldungen kommen zurück in Kubo.', 'imp.token': 'API-Token', 'imp.gruppo': 'Gruppen-ID für die Kunden (optional)', 'az.sincronizza_ora': 'Jetzt mit MailerLite abgleichen', 'giro.sincronizza': 'Geänderte Kunden und Abmeldungen' },
    pt: { nome: 'MailerLite', descrizione: 'Os clientes com consentimento entre os assinantes do MailerLite; os cancelamentos voltam ao Kubo.', 'imp.token': 'Token de API', 'imp.gruppo': 'Id do grupo para os clientes (opcional)', 'az.sincronizza_ora': 'Sincronizar agora com o MailerLite', 'giro.sincronizza': 'Clientes alterados e cancelamentos' },
  },
};
