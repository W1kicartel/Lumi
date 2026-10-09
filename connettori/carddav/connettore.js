// CardDAV: i clienti di Lumi nella rubrica di iCloud (iPhone, Mac), Nextcloud, Fastmail, Synology… (RFC 6352).
// La rubrica si trova da sola (current-user-principal → addressbook-home-set → la prima rubrica) o si incolla l'indirizzo.
// Ogni cliente è una scheda «lumi-<id>.vcf» con il nome, il cellulare in formato internazionale e l'email.
import { impRubrica, giroRubrica, uscitaRubrica, testiRubrica, vcard } from '../_comunica/rubrica.js';

const NS = 'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"';
const tag = (x, n) => new RegExp(`<(?:[\\w-]+:)?${n}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${n}>)`).exec(String(x || ''))?.[1] ?? null;
const tutti = (x, n) => [...String(x || '').matchAll(new RegExp(`<(?:[\\w-]+:)?${n}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${n}>)`, 'g'))].map(m => m[1] ?? '');
const auth = k => ({ basic: [k.imp.utente || '', k.segreti.password || ''] });
async function propfind(k, url, prof, prop) {
  const r = await k.http.richiesta('PROPFIND', url, { ...auth(k), testo: `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${prop}</d:prop></d:propfind>`,
    intestazioni: { 'Content-Type': 'application/xml; charset=utf-8', Depth: String(prof), Accept: 'application/xml' } });
  if (r.stato === 401 || r.stato === 403) throw new Error('CardDAV: accesso negato: controlla utente e password per app');
  if (r.stato !== 207 && !r.ok) throw new Error(`CardDAV ha risposto ${r.stato}`);
  return r.testo;
}
async function rubriche(k) {
  const server = k.base || k.imp.server, href = (xml, prop, base) => { const h = tag(tag(xml, prop), 'href'); return h ? new URL(h.trim(), base).href : null; };
  const principale = href(await propfind(k, server, 0, '<d:current-user-principal/>'), 'current-user-principal', server) || server;
  const casa = href(await propfind(k, principale, 0, '<card:addressbook-home-set/>'), 'addressbook-home-set', principale) || principale;
  return tutti(await propfind(k, casa, 1, '<d:resourcetype/><d:displayname/>'), 'response')
    .filter(x => /<(?:[\w-]+:)?addressbook\b/.test(tag(x, 'resourcetype') || ''))
    .map(x => ({ url: new URL(tag(x, 'href').trim(), casa).href, nome: (tag(x, 'displayname') || '').trim() || tag(x, 'href').trim() }));
}
async function rubrica(k) {
  if (k.imp.rubrica) return k.imp.rubrica.replace(/\/?$/, '/');
  const s = k.stato.leggi('rubrica'); if (s) return s;
  const r = (await rubriche(k))[0]; if (!r) throw new Error('CardDAV: nessuna rubrica trovata: incolla l\'indirizzo della rubrica');
  const u = r.url.replace(/\/?$/, '/'); k.stato.scrivi('rubrica', u); return u;
}
async function metti(k, x) {
  const r = await k.http.put(`${await rubrica(k)}lumi-${encodeURIComponent(x.id)}.vcf`, { ...auth(k), testo: vcard(x), intestazioni: { 'Content-Type': 'text/vcard; charset=utf-8' } });
  if (!r.ok) throw new Error(`CardDAV: la scheda di ${x.nome} non è stata salvata (HTTP ${r.stato})`);
}

export default {
  id: 'carddav', nome: 'Rubrica CardDAV (iCloud, Nextcloud)', versione: 1, icona: 'clienti',
  descrizione: 'I clienti nella rubrica del telefono (iCloud, Nextcloud, Fastmail…): quando chiamano, vedi chi è.',
  impostazioni: [
    { id: 'server', nome: 'Server CardDAV (iCloud: https://contacts.icloud.com)', tipo: 'url', predefinito: 'https://contacts.icloud.com' },
    { id: 'utente', nome: 'Utente (per iCloud: l\'Apple ID)' },
    { id: 'password', nome: 'Password per app', segreto: true },
    { id: 'rubrica', nome: 'Indirizzo della rubrica (vuoto = la prima che si trova)', tipo: 'url', obbligatorio: false },
    ...impRubrica,
  ],
  richiede: { clienti: { nome: {}, telefono: { tipo: ['telefono'], facoltativo: true }, email: { tipo: ['email'], facoltativo: true } } },
  permessi: { clienti: { leggi: true } },
  prova: async k => ({ ok: true, messaggio: await rubrica(k) }),
  uscita: uscitaRubrica(metti),
  pianificati: { tutti: giroRubrica(metti) },
  azioni: { rubriche: { nome: 'Elenca le rubriche', descrizione: 'Le rubriche dell\'account CardDAV, per scegliere quella giusta', esegui: async (_, k) => ({ rubriche: await rubriche(k) }) } },
  catalogo: {
    categoria: 'produttivita', sito: 'https://www.icloud.com/contacts', costo: 'gratis',
    costoNota: 'Gratis: usa la rubrica che hai già (iCloud, Nextcloud, Fastmail, Synology Contacts).',
    serve: [
      { cosa: 'Per iCloud: l\'Apple ID e una password per app', dove: 'account.apple.com → Accesso e sicurezza → Password specifiche per le app → Genera (serve l\'autenticazione a due fattori)', link: 'https://account.apple.com' },
      { cosa: 'Per Nextcloud: l\'indirizzo CardDAV e una password per app', dove: 'Nextcloud → Contatti → Impostazioni (in basso) → ⋯ della rubrica → Copia link; Impostazioni personali → Sicurezza → Crea una nuova password per app', link: 'https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html' },
    ],
    passi: ['iCloud: genera una password per app su account.apple.com', 'Lascia il server https://contacts.icloud.com e scrivi il tuo Apple ID e la password per app', 'Nextcloud: scrivi come server https://<tuo-cloud>/remote.php/dav e utente e password per app', 'Accendi e premi «Prova»: mostra la rubrica trovata (con «Elenca le rubriche» puoi sceglierne un\'altra)', 'Premi «Sincronizza ora» su «Tutti i clienti in rubrica»: da lì ogni cliente nuovo o cambiato va in rubrica da solo'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://datatracker.ietf.org/doc/html/rfc6352', 'https://datatracker.ietf.org/doc/html/rfc2426', 'https://support.apple.com/102654', 'https://docs.nextcloud.com/server/latest/user_manual/en/groupware/contacts.html'],
    prova: 'finto', parole: ['rubrica', 'contatti', 'carddav', 'icloud', 'iphone', 'nextcloud', 'fastmail', 'synology', 'chi chiama', 'contacts', 'address book'],
  },
  testi: {
    en: { nome: 'CardDAV address book (iCloud, Nextcloud)', descrizione: 'Customers in your phone\'s address book (iCloud, Nextcloud, Fastmail…): when they call, you see who it is.', 'imp.server': 'CardDAV server (iCloud: https://contacts.icloud.com)', 'imp.utente': 'User (for iCloud: the Apple ID)', 'imp.password': 'App password', 'imp.rubrica': 'Address book address (empty = the first one found)', ...testiRubrica.en, 'az.rubriche': 'List address books',
      'cat.costoNota': 'Free: it uses the address book you already have (iCloud, Nextcloud, Fastmail, Synology Contacts).',
      'cat.serve': [{ cosa: 'For iCloud: the Apple ID and an app-specific password', dove: 'account.apple.com → Sign-In and Security → App-Specific Passwords → Generate (two-factor authentication required)' }, { cosa: 'For Nextcloud: the CardDAV address and an app password', dove: 'Nextcloud → Contacts → Settings → address book ⋯ → Copy link; Personal settings → Security → Create new app password' }],
      'cat.passi': ['iCloud: generate an app-specific password on account.apple.com', 'Keep the server https://contacts.icloud.com and write your Apple ID and the app password', 'Nextcloud: write https://<your-cloud>/remote.php/dav as server, and user and app password', 'Turn on and press «Test»: it shows the address book found («List address books» lets you pick another)', 'Press «Sync now» on «All customers in the address book»: from then on every new or changed customer goes in by itself'] },
    es: { nome: 'Agenda CardDAV (iCloud, Nextcloud)', descrizione: 'Los clientes en la agenda del móvil (iCloud, Nextcloud, Fastmail…): cuando llaman, ves quién es.', 'imp.server': 'Servidor CardDAV (iCloud: https://contacts.icloud.com)', 'imp.utente': 'Usuario (para iCloud: el Apple ID)', 'imp.password': 'Contraseña de aplicación', 'imp.rubrica': 'Dirección de la agenda (vacío = la primera encontrada)', ...testiRubrica.es, 'az.rubriche': 'Listar las agendas' },
    fr: { nome: 'Carnet CardDAV (iCloud, Nextcloud)', descrizione: 'Les clients dans le carnet d\'adresses du téléphone (iCloud, Nextcloud, Fastmail…) : quand ils appellent, tu sais qui c\'est.', 'imp.server': 'Serveur CardDAV (iCloud : https://contacts.icloud.com)', 'imp.utente': 'Utilisateur (pour iCloud : l\'identifiant Apple)', 'imp.password': 'Mot de passe d\'application', 'imp.rubrica': 'Adresse du carnet (vide = le premier trouvé)', ...testiRubrica.fr, 'az.rubriche': 'Lister les carnets' },
    de: { nome: 'CardDAV-Adressbuch (iCloud, Nextcloud)', descrizione: 'Kunden im Adressbuch des Handys (iCloud, Nextcloud, Fastmail…): wenn sie anrufen, siehst du, wer es ist.', 'imp.server': 'CardDAV-Server (iCloud: https://contacts.icloud.com)', 'imp.utente': 'Benutzer (bei iCloud: die Apple-ID)', 'imp.password': 'App-Passwort', 'imp.rubrica': 'Adresse des Adressbuchs (leer = das erste gefundene)', ...testiRubrica.de, 'az.rubriche': 'Adressbücher auflisten' },
    pt: { nome: 'Agenda CardDAV (iCloud, Nextcloud)', descrizione: 'Os clientes na agenda do celular (iCloud, Nextcloud, Fastmail…): quando ligam, você vê quem é.', 'imp.server': 'Servidor CardDAV (iCloud: https://contacts.icloud.com)', 'imp.utente': 'Usuário (no iCloud: o Apple ID)', 'imp.password': 'Senha de app', 'imp.rubrica': 'Endereço da agenda (vazio = a primeira encontrada)', ...testiRubrica.pt, 'az.rubriche': 'Listar as agendas' },
  },
};
