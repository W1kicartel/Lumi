// Brevo (ex Sendinblue): email e SMS transazionali ai clienti, promemoria SMS degli appuntamenti, i clienti di Lumi
// in una lista di contatti (solo chi ha dato il consenso, se il campo c'è). Il webhook (codice segreto in fondo
// all'indirizzo: Brevo non firma) toglie il consenso a chi si disiscrive o segna spam e avvisa degli indirizzi sbagliati.
import { e164, telefonoDi, nomeDi, modificateDopo, nomeCognome } from '../_comunica/telefono.js';
import { azioneSms, giroPromemoria, impostazioniPromemoria, testiSms, impPrefisso } from '../_comunica/sms.js';
import { azioniDocumenti, TESTI_DOCUMENTI } from '../_comunica/email.js';

const base = k => k.base || 'https://api.brevo.com/v3';
const h = k => ({ 'api-key': k.segreti.chiave });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function chiama(k, metodo, via, json) {
  const r = await k.http[metodo](`${base(k)}${via}`, { intestazioni: h(k), ...(json ? { json } : {}) });
  if (!r.ok) throw new Error(`Brevo ${via}: ${r.json?.message || `HTTP ${r.stato}`}`);
  return r.json || {};
}
async function sms(k, numero, testo) {
  const x = await chiama(k, 'post', '/transactionalSMS/send', { sender: k.imp.mittente_sms || 'Lumi', recipient: numero.replace(/^\+/, ''), content: testo, type: 'transactional', tag: 'lumi', unicodeEnabled: /[^\x00-\x7F€àèéìòù]/.test(testo) });
  return { id: x.messageId ?? x.reference ?? null };
}
const emailDi = (k, c) => c && (k.valore(c, 'clienti', 'email') || null);
// un'email con gli allegati (fatture e preventivi, da _comunica/email.js): Brevo li vuole in base64
async function email(k, m) {
  const x = await chiama(k, 'post', '/smtp/email', { sender: { email: m.da, ...(m.daNome ? { name: m.daNome } : {}) }, to: [{ email: m.a, ...(m.aNome ? { name: m.aNome } : {}) }], ...(m.rispondi ? { replyTo: { email: m.rispondi } } : {}),
    subject: m.oggetto, textContent: m.testo, htmlContent: m.html, tags: ['lumi'], ...(m.allegati.length ? { attachment: m.allegati.map(a => ({ name: a.nome, content: a.contenuto.toString('base64') })) } : {}) });
  return { id: x.messageId };
}

export default {
  id: 'brevo', nome: 'Brevo', versione: 1, icona: 'messaggio', base: 'https://api.brevo.com/v3',
  descrizione: 'Email e SMS ai clienti, promemoria degli appuntamenti e i clienti in una lista di contatti Brevo.',
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API (xkeysib-…)', segreto: true, schema: /^xkeysib-[\w-]{20,}$/ },
    { id: 'mittente_email', nome: 'Email del mittente (verificata in Brevo)', schema: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    { id: 'mittente_nome', nome: 'Nome del mittente', obbligatorio: false },
    { id: 'mittente_sms', nome: 'Mittente degli SMS (max 11 lettere o cifre)', schema: /^[A-Za-z0-9]{1,11}$|^\d{12,15}$/, obbligatorio: false },
    { id: 'lista', nome: 'Lista dei contatti (numero, es. 2)', tipo: 'numero', obbligatorio: false },
    { id: 'solo_consenso', nome: 'Nella lista solo i clienti con il consenso', tipo: 'si_no', predefinito: true },
    { id: 'attr_nome', nome: 'Attributo del nome in Brevo', predefinito: 'FIRSTNAME', aiuto: 'Negli account Brevo in italiano spesso è NOME' },
    { id: 'attr_cognome', nome: 'Attributo del cognome in Brevo', predefinito: 'LASTNAME', aiuto: 'Negli account Brevo in italiano spesso è COGNOME' },
    impPrefisso, ...impostazioniPromemoria(),
    { id: 'webhook', nome: 'Codice segreto del webhook', segreto: true, generato: true },
  ],
  richiede: { clienti: { email: { tipo: ['email'], facoltativo: true }, telefono: { tipo: ['telefono'], facoltativo: true }, consenso: { tipo: ['si_no'], facoltativo: true } } },
  permessi: { clienti: { leggi: true, modifica: true }, appuntamenti: { leggi: true }, fatture: { leggi: true }, preventivi: { leggi: true } },
  prova: async k => { const a = await chiama(k, 'get', '/account'); return { ok: true, messaggio: [a.email, a.plan?.[0]?.type].filter(Boolean).join(' · ') }; },
  azioni: {
    manda_email: {
      nome: 'Manda un\'email', descrizione: 'Manda un\'email al cliente con Brevo', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti', nome: 'Il cliente' }, oggetto: { tipo: 'testo', nome: 'L\'oggetto' }, testo: { tipo: 'testo', nome: 'Il testo' } },
      proponi: async ({ cliente, oggetto, testo }, k) => ({ titolo: 'Email con Brevo', righe: [['A', `${nomeDi(k, cliente)} <${emailDi(k, cliente) || '—'}>`], ['Oggetto', oggetto], ['Testo', testo]],
        avvisi: [...(emailDi(k, cliente) ? [] : ['Il cliente non ha un indirizzo email']), ...(k.imp.mittente_email ? [] : ['Manca l\'email del mittente nelle impostazioni'])] }),
      async esegui({ cliente, oggetto, testo }, k) {
        const a = emailDi(k, cliente); if (!a) throw new Error('Il cliente non ha un indirizzo email');
        if (!String(oggetto || '').trim() || !String(testo || '').trim()) throw new Error('Servono oggetto e testo');
        const x = await chiama(k, 'post', '/smtp/email', { sender: { email: k.imp.mittente_email, ...(k.imp.mittente_nome ? { name: k.imp.mittente_nome } : {}) }, to: [{ email: a, name: nomeDi(k, cliente) || undefined }],
          subject: oggetto, textContent: testo, htmlContent: `<p>${esc(testo).replace(/\r?\n/g, '<br>')}</p>`, tags: ['lumi'] });
        return { a, id: x.messageId };
      },
    },
    manda_sms: azioneSms(sms, 'Brevo'),
    ...azioniDocumenti(email),
  },
  pianificati: {
    contatti: { nome: 'Clienti nella lista dei contatti', ogni: '1h', async giro(k) {
      if (!k.imp.lista) return { saltato: 'nessuna lista' };
      const dal = k.stato.leggi('contatti_dal') || '', consenso = k.imp.solo_consenso && k.campo('clienti', 'consenso'), pref = String(k.imp.prefisso || '39');
      const contatti = []; let ultimo = dal;
      for (const c of modificateDopo(k, 'clienti', dal)) {
        ultimo = c.modificato || ultimo; const email = emailDi(k, c);
        if (!email || (consenso && c[consenso] !== true && c[consenso] !== 1)) continue;
        const [n, cg] = nomeCognome(nomeDi(k, c)), tel = e164(telefonoDi(k, c), pref);
        contatti.push({ email, attributes: { [k.imp.attr_nome || 'FIRSTNAME']: n, ...(cg ? { [k.imp.attr_cognome || 'LASTNAME']: cg } : {}), ...(tel ? { SMS: tel } : {}) } });
      }
      // l'import di Brevo prende fino a 8 MB per volta: a lotti da 2000 contatti
      for (let i = 0; i < contatti.length; i += 2000)
        await chiama(k, 'post', '/contacts/import', { jsonBody: contatti.slice(i, i + 2000), listIds: [Number(k.imp.lista)], updateExistingContacts: true, emptyContactsAttributes: false });
      k.stato.scrivi('contatti_dal', ultimo);
      return { mandati: contatti.length };
    } },
    promemoria: giroPromemoria(sms),
  },
  entrata: {
    firma: { tipo: 'token', segreto: 'webhook' },
    idempotenza: ev => [ev.event, ev.email, ev['message-id'] || ev.id || ev.ts_event || ev.date].join('|'),
    async gestisci(ev, k) {
      const tipo = String(ev?.event || ''), email = String(ev?.email || '').trim().toLowerCase(); if (!email) return 'ignorato';
      if (/^(unsubscribe|unsubscribed|spam|complaint)$/.test(tipo)) {
        const campo = k.campo('clienti', 'consenso'), c = k.dati.trova('clienti', 'email', email) || k.dati.trova('clienti', 'email', ev.email);
        if (!c) return 'ignorato: cliente sconosciuto';
        if (campo && c[campo]) k.dati.modifica('clienti', c.id, { consenso: false });
        return `consenso tolto: ${nomeDi(k, c) || email}`;
      }
      if (/^(hard_bounce|hardBounce|invalid_email|blocked)$/.test(tipo)) { k.avvisa(`l'indirizzo ${email} non riceve email (${tipo})`); return 'avvisato'; }
      return 'ignorato';
    },
  },
  catalogo: {
    categoria: 'email', sito: 'https://www.brevo.com/it/', costo: 'gratis',
    costoNota: 'Piano Free: 300 email al giorno, contatti illimitati. Piani a pagamento da circa 9 € al mese (Starter, 5.000 email). Gli SMS si pagano a crediti prepagati, con un prezzo per paese (listino su brevo.com/it/pricing).',
    serve: [
      { cosa: 'La chiave API v3 (inizia con xkeysib-)', dove: 'Brevo → menu del tuo nome in alto a destra → SMTP e API → scheda «Chiavi API» → Genera una nuova chiave API', link: 'https://app.brevo.com/settings/keys/api' },
      { cosa: 'Un mittente email verificato (meglio con il dominio autenticato)', dove: 'Brevo → Impostazioni → Mittenti, domini e IP dedicati', link: 'https://app.brevo.com/senders/list' },
      { cosa: 'Il numero della lista dei contatti (facoltativo)', dove: 'Brevo → Contatti → Liste → il numero (ID) accanto al nome', link: 'https://app.brevo.com/contact/list-listing' },
    ],
    passi: ['Crea un account gratuito su brevo.com', 'Verifica l\'email del mittente (Impostazioni → Mittenti) e, se puoi, autentica il dominio', 'Genera la chiave API (SMTP e API → Chiavi API) e incollala qui con l\'email del mittente', 'Per la lista: crea una lista in Contatti → Liste e scrivi qui il suo numero', 'Per gli SMS: compra un pacchetto di crediti SMS e scegli il mittente (max 11 caratteri)', 'Per le disiscrizioni: in Transazionali → Impostazioni → Webhook aggiungi l\'indirizzo di Lumi con il codice segreto (serve un indirizzo pubblico)'],
    difficolta: 'facile', zone: ['UE', 'mondo'],
    fonti: ['https://developers.brevo.com/docs/send-a-transactional-email', 'https://developers.brevo.com/docs/transactional-sms-endpoints', 'https://developers.brevo.com/reference/import-contacts', 'https://developers.brevo.com/docs/transactional-webhooks', 'https://www.brevo.com/it/pricing/'],
    prova: 'finto', parole: ['brevo', 'sendinblue', 'email', 'sms', 'newsletter', 'contatti', 'lista', 'promemoria', 'transactional email', 'mailing list'],
  },
  testi: {
    en: { nome: 'Brevo', descrizione: 'Email and SMS to customers, appointment reminders and customers in a Brevo contact list.', 'imp.chiave': 'API key (xkeysib-…)', 'imp.mittente_email': 'Sender email (verified in Brevo)', 'imp.mittente_nome': 'Sender name', 'imp.mittente_sms': 'SMS sender (max 11 letters or digits)', 'imp.lista': 'Contact list (number, e.g. 2)', 'imp.solo_consenso': 'Only customers who gave consent in the list', 'imp.attr_nome': 'First-name attribute in Brevo', 'imp.attr_cognome': 'Last-name attribute in Brevo', 'aiuto.attr_nome': 'In Italian Brevo accounts it is often NOME', 'aiuto.attr_cognome': 'In Italian Brevo accounts it is often COGNOME', 'imp.webhook': 'Webhook secret code', 'az.manda_email': 'Send an email', 'giro.contatti': 'Customers in the contact list', ...testiSms.en, ...TESTI_DOCUMENTI('en'),
      'cat.costoNota': 'Free plan: 300 emails a day, unlimited contacts. Paid plans from about €9 a month (Starter, 5,000 emails). SMS are paid with prepaid credits, priced per country (see brevo.com/pricing).',
      'cat.serve': [{ cosa: 'The v3 API key (starts with xkeysib-)', dove: 'Brevo → your name menu top right → SMTP & API → «API Keys» tab → Generate a new API key' }, { cosa: 'A verified sender email (better with an authenticated domain)', dove: 'Brevo → Settings → Senders, domains & dedicated IPs' }, { cosa: 'The contact list number (optional)', dove: 'Brevo → Contacts → Lists → the ID next to the name' }],
      'cat.passi': ['Create a free account on brevo.com', 'Verify the sender email (Settings → Senders) and, if you can, authenticate the domain', 'Generate the API key (SMTP & API → API Keys) and paste it here with the sender email', 'For the list: create one in Contacts → Lists and write its number here', 'For SMS: buy SMS credits and choose the sender (max 11 characters)', 'For unsubscribes: in Transactional → Settings → Webhook add Lumi\'s address with the secret code (needs a public address)'] },
    es: { nome: 'Brevo', descrizione: 'Email y SMS a los clientes, recordatorios de citas y clientes en una lista de contactos de Brevo.', 'imp.chiave': 'Clave API (xkeysib-…)', 'imp.mittente_email': 'Email del remitente (verificado en Brevo)', 'imp.mittente_nome': 'Nombre del remitente', 'imp.mittente_sms': 'Remitente de los SMS (máx. 11 letras o cifras)', 'imp.lista': 'Lista de contactos (número, p. ej. 2)', 'imp.solo_consenso': 'En la lista solo clientes con consentimiento', 'imp.attr_nome': 'Atributo del nombre en Brevo', 'imp.attr_cognome': 'Atributo del apellido en Brevo', 'aiuto.attr_nome': 'En cuentas de Brevo en italiano suele ser NOME', 'aiuto.attr_cognome': 'En cuentas de Brevo en italiano suele ser COGNOME', 'imp.webhook': 'Código secreto del webhook', 'az.manda_email': 'Enviar un email', 'giro.contatti': 'Clientes en la lista de contactos', ...testiSms.es, ...TESTI_DOCUMENTI('es') },
    fr: { nome: 'Brevo', descrizione: 'E-mails et SMS aux clients, rappels de rendez-vous et clients dans une liste de contacts Brevo.', 'imp.chiave': 'Clé API (xkeysib-…)', 'imp.mittente_email': 'E-mail de l\'expéditeur (vérifié dans Brevo)', 'imp.mittente_nome': 'Nom de l\'expéditeur', 'imp.mittente_sms': 'Expéditeur des SMS (11 lettres ou chiffres max.)', 'imp.lista': 'Liste de contacts (numéro, ex. 2)', 'imp.solo_consenso': 'Dans la liste seulement les clients consentants', 'imp.attr_nome': 'Attribut du prénom dans Brevo', 'imp.attr_cognome': 'Attribut du nom dans Brevo', 'aiuto.attr_nome': 'Dans les comptes Brevo en italien c\'est souvent NOME', 'aiuto.attr_cognome': 'Dans les comptes Brevo en italien c\'est souvent COGNOME', 'imp.webhook': 'Code secret du webhook', 'az.manda_email': 'Envoyer un e-mail', 'giro.contatti': 'Clients dans la liste de contacts', ...testiSms.fr, ...TESTI_DOCUMENTI('fr') },
    de: { nome: 'Brevo', descrizione: 'E-Mails und SMS an Kunden, Terminerinnerungen und Kunden in einer Brevo-Kontaktliste.', 'imp.chiave': 'API-Schlüssel (xkeysib-…)', 'imp.mittente_email': 'Absender-E-Mail (in Brevo verifiziert)', 'imp.mittente_nome': 'Absendername', 'imp.mittente_sms': 'SMS-Absender (max. 11 Buchstaben oder Ziffern)', 'imp.lista': 'Kontaktliste (Nummer, z. B. 2)', 'imp.solo_consenso': 'Nur Kunden mit Einwilligung in der Liste', 'imp.attr_nome': 'Vornamen-Attribut in Brevo', 'imp.attr_cognome': 'Nachnamen-Attribut in Brevo', 'aiuto.attr_nome': 'In italienischen Brevo-Konten oft NOME', 'aiuto.attr_cognome': 'In italienischen Brevo-Konten oft COGNOME', 'imp.webhook': 'Geheimcode des Webhooks', 'az.manda_email': 'E-Mail senden', 'giro.contatti': 'Kunden in der Kontaktliste', ...testiSms.de, ...TESTI_DOCUMENTI('de') },
    pt: { nome: 'Brevo', descrizione: 'Email e SMS aos clientes, lembretes de agendamentos e clientes numa lista de contatos do Brevo.', 'imp.chiave': 'Chave API (xkeysib-…)', 'imp.mittente_email': 'Email do remetente (verificado no Brevo)', 'imp.mittente_nome': 'Nome do remetente', 'imp.mittente_sms': 'Remetente dos SMS (máx. 11 letras ou dígitos)', 'imp.lista': 'Lista de contatos (número, ex. 2)', 'imp.solo_consenso': 'Na lista só clientes com consentimento', 'imp.attr_nome': 'Atributo do nome no Brevo', 'imp.attr_cognome': 'Atributo do sobrenome no Brevo', 'aiuto.attr_nome': 'Em contas Brevo em italiano costuma ser NOME', 'aiuto.attr_cognome': 'Em contas Brevo em italiano costuma ser COGNOME', 'imp.webhook': 'Código secreto do webhook', 'az.manda_email': 'Enviar um email', 'giro.contatti': 'Clientes na lista de contatos', ...testiSms.pt, ...TESTI_DOCUMENTI('pt') },
  },
};
