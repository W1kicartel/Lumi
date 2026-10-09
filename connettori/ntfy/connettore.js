// ntfy: notifiche push sul telefono (app ntfy per Android e iPhone), con il servizio pubblico ntfy.sh o un server tuo.
// L'argomento (topic) fa da password: Kubo ne genera uno lungo e casuale; con un server tuo si aggiunge un token.
import { canale } from '../_comunica/canale.js';
export default canale({
  id: 'ntfy', nome: 'ntfy', descrizione: 'Notifiche push sul telefono con ntfy: vendite, appuntamenti, scorte basse.',
  impostazioni: [
    { id: 'server', nome: 'Server ntfy', tipo: 'url', predefinito: 'https://ntfy.sh' },
    { id: 'argomento', nome: 'Argomento (topic) da seguire nell\'app', segreto: true, generato: true },
    { id: 'token', nome: 'Token di accesso (tk_…, solo con un server protetto)', segreto: true, obbligatorio: false },
    { id: 'priorita', nome: 'Priorità', tipo: 'scelta', opzioni: ['1', '2', '3', '4', '5'], predefinito: '3' },
  ],
  async scrivi(k, testo) {
    const r = await k.http.post(`${String(k.base || k.imp.server || 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(k.segreti.argomento)}`, { testo, ...(k.segreti.token ? { bearer: k.segreti.token } : {}),
      intestazioni: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'Kubo', Tags: 'kubo', Priority: String(k.imp.priorita || 3) } });
    if (!r.ok) throw new Error(`ntfy ha risposto ${r.stato}${r.json?.error ? `: ${r.json.error}` : ''}`);
    return { inviato: true, id: r.json?.id };
  },
  catalogo: {
    categoria: 'messaggi', sito: 'https://ntfy.sh', costo: 'gratis',
    costoNota: 'ntfy.sh è gratuito (fino a 250 messaggi al giorno per indirizzo IP); ntfy Pro da 5 $ al mese con argomenti riservati. Il server è open source: puoi installarlo tu, senza limiti.',
    serve: [{ cosa: 'L\'app ntfy sul telefono e l\'argomento che Kubo genera', dove: 'App ntfy (Google Play, F-Droid, App Store) → + → «Subscribe to topic» → incolla l\'argomento che trovi in questa pagina', link: 'https://docs.ntfy.sh/subscribe/phone/' },
      { cosa: 'Solo con un server tuo protetto: un token di accesso', dove: 'sul server: ntfy token add <utente>', link: 'https://docs.ntfy.sh/config/#access-tokens' }],
    passi: ['Installa l\'app ntfy sul telefono', 'Accendi il connettore: Kubo genera un argomento segreto', 'Copia l\'argomento da questa pagina e nell\'app scegli «+ → Subscribe to topic»', 'Scegli quali avvisi ricevere', 'Premi «Prova»: arriva la prima notifica'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://docs.ntfy.sh/publish/', 'https://docs.ntfy.sh/config/#access-tokens', 'https://ntfy.sh/#pricing'],
    prova: 'finto', parole: ['ntfy', 'push', 'notifiche', 'telefono', 'avvisi', 'self-hosted', 'open source', 'notifications'],
  },
  testi: {
    en: { nome: 'ntfy', descrizione: 'Push notifications on your phone with ntfy: sales, appointments, low stock.', 'imp.server': 'ntfy server', 'imp.argomento': 'Topic to follow in the app', 'imp.token': 'Access token (tk_…, only for a protected server)', 'imp.priorita': 'Priority',
      'cat.costoNota': 'ntfy.sh is free (up to 250 messages a day per IP address); ntfy Pro from $5 a month with reserved topics. The server is open source: you can host it yourself, with no limits.',
      'cat.serve': [{ cosa: 'The ntfy app on your phone and the topic Kubo generates', dove: 'ntfy app → + → «Subscribe to topic» → paste the topic shown on this page' }, { cosa: 'Only with your own protected server: an access token', dove: 'on the server: ntfy token add <user>' }],
      'cat.passi': ['Install the ntfy app on your phone', 'Turn on the connector: Kubo generates a secret topic', 'Copy the topic from this page and in the app choose «+ → Subscribe to topic»', 'Choose which alerts to get', 'Press «Test»: the first notification arrives'] },
    es: { nome: 'ntfy', descrizione: 'Notificaciones push en el móvil con ntfy: ventas, citas, stock bajo.', 'imp.server': 'Servidor ntfy', 'imp.argomento': 'Tema (topic) que seguir en la app', 'imp.token': 'Token de acceso (tk_…, solo con un servidor protegido)', 'imp.priorita': 'Prioridad' },
    fr: { nome: 'ntfy', descrizione: 'Notifications push sur le téléphone avec ntfy : ventes, rendez-vous, stock bas.', 'imp.server': 'Serveur ntfy', 'imp.argomento': 'Sujet (topic) à suivre dans l\'app', 'imp.token': 'Jeton d\'accès (tk_…, seulement avec un serveur protégé)', 'imp.priorita': 'Priorité' },
    de: { nome: 'ntfy', descrizione: 'Push-Benachrichtigungen aufs Handy mit ntfy: Verkäufe, Termine, niedriger Bestand.', 'imp.server': 'ntfy-Server', 'imp.argomento': 'Thema (Topic), dem die App folgt', 'imp.token': 'Zugriffstoken (tk_…, nur bei geschütztem Server)', 'imp.priorita': 'Priorität' },
    pt: { nome: 'ntfy', descrizione: 'Notificações push no celular com o ntfy: vendas, agendamentos, estoque baixo.', 'imp.server': 'Servidor ntfy', 'imp.argomento': 'Tópico (topic) a seguir no app', 'imp.token': 'Token de acesso (tk_…, só com servidor protegido)', 'imp.priorita': 'Prioridade' },
  },
});
