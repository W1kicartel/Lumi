// Pushover: notifiche push sul telefono e sul computer. POST /1/messages.json con il token dell'applicazione e la
// chiave dell'utente (o di un gruppo, per avvisare più persone).
import { canale } from '../_comunica/canale.js';
const base = k => k.base || 'https://api.pushover.net';
export default canale({
  id: 'pushover', nome: 'Pushover', descrizione: 'Notifiche push sul telefono con Pushover: vendite, appuntamenti, scorte basse.',
  impostazioni: [
    { id: 'token', nome: 'API Token dell\'applicazione', segreto: true, schema: /^[A-Za-z0-9]{30}$/ },
    { id: 'utente', nome: 'User Key (o Group Key)', segreto: true, schema: /^[A-Za-z0-9]{30}$/ },
  ],
  async scrivi(k, testo) {
    const r = await k.http.post(`${base(k)}/1/messages.json`, { form: { token: k.segreti.token, user: k.segreti.utente, title: 'Lumi', message: testo.slice(0, 1024) } });
    if (!r.ok || r.json?.status !== 1) throw new Error(`Pushover: ${(r.json?.errors || []).join(', ') || `HTTP ${r.stato}`}`);
    return { inviato: true, id: r.json?.request };
  },
  catalogo: {
    categoria: 'messaggi', sito: 'https://pushover.net', costo: 'contratto',
    costoNota: 'Prova gratuita di 30 giorni, poi una licenza una tantum di 5 $ per piattaforma (Android, iPhone o computer). Ogni applicazione può mandare 10.000 messaggi al mese gratis.',
    serve: [{ cosa: 'La User Key (o una Group Key per più persone)', dove: 'pushover.net → accedi → la chiave è in alto nella pagina principale («Your User Key»)', link: 'https://pushover.net' },
      { cosa: 'L\'API Token di un\'applicazione', dove: 'pushover.net → Your Applications → Create an Application/API Token → nome «Lumi»', link: 'https://pushover.net/apps/build' }],
    passi: ['Installa l\'app Pushover sul telefono e crea l\'account', 'Su pushover.net copia la tua User Key', 'Crea un\'applicazione «Lumi» e copia il suo API Token', 'Incolla le due chiavi qui e scegli gli avvisi', 'Premi «Prova»: arriva la prima notifica'],
    difficolta: 'facile', zone: ['mondo'],
    fonti: ['https://pushover.net/api', 'https://pushover.net/api#limits', 'https://pushover.net/pricing'],
    prova: 'finto', parole: ['pushover', 'push', 'notifiche', 'telefono', 'avvisi', 'notifications'],
  },
  testi: {
    en: { nome: 'Pushover', descrizione: 'Push notifications on your phone with Pushover: sales, appointments, low stock.', 'imp.token': 'Application API Token', 'imp.utente': 'User Key (or Group Key)',
      'cat.costoNota': '30-day free trial, then a one-time $5 licence per platform (Android, iPhone or desktop). Each application can send 10,000 messages a month for free.',
      'cat.serve': [{ cosa: 'The User Key (or a Group Key for several people)', dove: 'pushover.net → log in → «Your User Key» at the top of the main page' }, { cosa: 'An application API Token', dove: 'pushover.net → Your Applications → Create an Application/API Token → name «Lumi»' }],
      'cat.passi': ['Install the Pushover app and create the account', 'On pushover.net copy your User Key', 'Create a «Lumi» application and copy its API Token', 'Paste both keys here and choose the alerts', 'Press «Test»: the first notification arrives'] },
    es: { nome: 'Pushover', descrizione: 'Notificaciones push en el móvil con Pushover: ventas, citas, stock bajo.', 'imp.token': 'API Token de la aplicación', 'imp.utente': 'User Key (o Group Key)' },
    fr: { nome: 'Pushover', descrizione: 'Notifications push sur le téléphone avec Pushover : ventes, rendez-vous, stock bas.', 'imp.token': 'API Token de l\'application', 'imp.utente': 'User Key (ou Group Key)' },
    de: { nome: 'Pushover', descrizione: 'Push-Benachrichtigungen aufs Handy mit Pushover: Verkäufe, Termine, niedriger Bestand.', 'imp.token': 'API-Token der Anwendung', 'imp.utente': 'User Key (oder Group Key)' },
    pt: { nome: 'Pushover', descrizione: 'Notificações push no celular com o Pushover: vendas, agendamentos, estoque baixo.', 'imp.token': 'API Token da aplicação', 'imp.utente': 'User Key (ou Group Key)' },
  },
});
