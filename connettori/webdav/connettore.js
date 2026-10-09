// Archivio WebDAV: Nextcloud, ownCloud, Synology (WebDAV Server), QNAP, Koofr, pCloud, 4shared e qualsiasi server WebDAV.
// Fatture e documenti in Lumi/Fatture/2026/…, backup del database ogni notte in Lumi/Backup (gli ultimi N).
// Accesso Basic con una password per app (mai quella principale). iCloud Drive NON ha WebDAV: non si può usare.
// Un NAS in casa o in ufficio è sulla rete interna: va spuntato «permetti la rete interna» nella pagina del connettore.
// Protocollo: RFC 4918 (PUT, MKCOL, PROPFIND, DELETE) in ../_comunica/webdav.js
import { archivio, testiArchivio } from '../_comunica/documento.js';
import { dav } from '../_comunica/webdav.js';

const di = k => dav(k.http, { indirizzo: k.base || k.imp.indirizzo, utente: k.imp.utente, password: k.segreti.password });
const A = archivio({
  nome: 'WebDAV', carica: (k, cartella, nome, contenuto, tipo) => di(k).carica(`${cartella}/${nome}`, contenuto, tipo),
  elenca: (k, cartella) => di(k).elenca(cartella), cancella: (k, voce) => di(k).cancella(voce.percorso),
  pronto: k => !!((k.base || k.imp.indirizzo) && k.imp.utente && k.segreti.password),
});
export default {
  id: 'webdav', nome: 'Archivio WebDAV', versione: 1, icona: 'documento',
  descrizione: 'Fatture, documenti e backup notturno su Nextcloud, ownCloud, Synology o qualsiasi WebDAV.',
  impostazioni: [
    { id: 'indirizzo', nome: 'Indirizzo WebDAV (Nextcloud: https://cloud.esempio.it/remote.php/dav/files/<utente>/)', tipo: 'url' },
    { id: 'utente', nome: 'Utente' }, { id: 'password', nome: 'Password per app', segreto: true },
    ...A.impostazioni],
  richiede: A.richiede, permessi: A.permessi, azioni: A.azioni, uscita: A.uscita, pianificati: A.pianificati,
  prova: async k => {
    const r = await k.http.richiesta('PROPFIND', di(k).url(''), { basic: [k.imp.utente, k.segreti.password], testo: '', intestazioni: { Depth: '0' } });
    return { ok: r.stato === 207, messaggio: r.stato === 207 ? 'WebDAV raggiungibile' : `HTTP ${r.stato}${r.stato === 401 ? ': utente o password per app sbagliati' : ''}` };
  },
  catalogo: {
    categoria: 'archivio', sito: 'https://nextcloud.com', costo: 'gratis',
    costoNota: 'Il protocollo è gratuito: paghi solo lo spazio. Nextcloud o un NAS Synology in ufficio non costano nulla oltre all\'hardware; Nextcloud in hosting da circa 3–5 €/mese (es. Hetzner Storage Share da 1 TB), Koofr 10 GB gratis.',
    serve: [
      { cosa: 'Indirizzo WebDAV, utente e una password per app', dove: 'Nextcloud: Impostazioni personali → Sicurezza → Dispositivi e sessioni → Crea nuova password per app; l\'indirizzo è in File → Impostazioni file (in basso a sinistra) → WebDAV', link: 'https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html' },
      { cosa: 'Synology: il pacchetto WebDAV Server attivo (HTTPS, porta 5006)', dove: 'DSM → Centro pacchetti → WebDAV Server → Abilita HTTPS', link: 'https://kb.synology.com/en-global/DSM/help/WebDAVServer/webdav_server' },
    ],
    passi: [
      'Prendi l\'indirizzo WebDAV: Nextcloud https://<server>/remote.php/dav/files/<utente>/, ownCloud https://<server>/remote.php/webdav/, Synology https://<nas>:5006/.',
      'Crea una password per app (Nextcloud: Impostazioni → Sicurezza). Non usare la password principale.',
      'In Lumi scrivi indirizzo e utente, incolla la password per app e accendi il connettore.',
      'Se il server è un NAS in casa o in ufficio, spunta «permetti la rete interna» nella pagina del connettore.',
      'Premi «Prova», poi scegli se salvare da solo le fatture emesse e quanti backup tenere.',
      'iCloud Drive non ha WebDAV: per Apple usa un altro archivio (Drive, Dropbox, OneDrive o S3).',
    ],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://www.rfc-editor.org/rfc/rfc4918', 'https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html', 'https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html', 'https://kb.synology.com/en-global/DSM/help/WebDAVServer/webdav_server'],
    prova: 'finto', parole: ['webdav', 'nextcloud', 'owncloud', 'synology', 'nas', 'qnap', 'koofr', 'pcloud', 'archivio', 'cloud', 'backup', 'copia'],
  },
  testi: testiArchivio('WebDAV', {
    en: { nome: 'WebDAV storage', descrizione: 'Invoices, documents and nightly backup on Nextcloud, ownCloud, Synology or any WebDAV.', 'imp.indirizzo': 'WebDAV address (Nextcloud: https://cloud.example.com/remote.php/dav/files/<user>/)', 'imp.utente': 'User', 'imp.password': 'App password',
      'cat.costoNota': 'The protocol is free: you only pay for space. Nextcloud or a Synology NAS in the office cost nothing beyond the hardware; hosted Nextcloud from about €3–5/month, Koofr 10 GB free.',
      'cat.serve': [{ cosa: 'WebDAV address, user and an app password', dove: 'Nextcloud: Personal settings → Security → Devices & sessions → Create new app password; the address is in Files → Files settings (bottom left) → WebDAV' }, { cosa: 'Synology: the WebDAV Server package on (HTTPS, port 5006)', dove: 'DSM → Package Center → WebDAV Server → Enable HTTPS' }],
      'cat.passi': ['Get the WebDAV address: Nextcloud https://<server>/remote.php/dav/files/<user>/, ownCloud https://<server>/remote.php/webdav/, Synology https://<nas>:5006/.', 'Create an app password (Nextcloud: Settings → Security). Do not use the main password.', 'In Lumi enter address and user, paste the app password and turn the connector on.', 'If the server is a NAS at home or in the office, tick «allow the internal network» on the connector page.', 'Press «Test», then choose whether to save issued invoices automatically and how many backups to keep.', 'iCloud Drive has no WebDAV: for Apple use another storage (Drive, Dropbox, OneDrive or S3).'] },
    es: { nome: 'Almacenamiento WebDAV', descrizione: 'Facturas, documentos y copia nocturna en Nextcloud, ownCloud, Synology o cualquier WebDAV.', 'imp.indirizzo': 'Dirección WebDAV', 'imp.utente': 'Usuario', 'imp.password': 'Contraseña de aplicación' },
    fr: { nome: 'Stockage WebDAV', descrizione: 'Factures, documents et sauvegarde nocturne sur Nextcloud, ownCloud, Synology ou tout WebDAV.', 'imp.indirizzo': 'Adresse WebDAV', 'imp.utente': 'Utilisateur', 'imp.password': 'Mot de passe d\'application' },
    de: { nome: 'WebDAV-Speicher', descrizione: 'Rechnungen, Dokumente und nächtliche Sicherung auf Nextcloud, ownCloud, Synology oder jedem WebDAV.', 'imp.indirizzo': 'WebDAV-Adresse', 'imp.utente': 'Benutzer', 'imp.password': 'App-Passwort' },
    pt: { nome: 'Armazenamento WebDAV', descrizione: 'Faturas, documentos e backup noturno no Nextcloud, ownCloud, Synology ou qualquer WebDAV.', 'imp.indirizzo': 'Endereço WebDAV', 'imp.utente': 'Usuário', 'imp.password': 'Senha de app' },
  }),
};
