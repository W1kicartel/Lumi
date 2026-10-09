// Gotify: notifiche push sul telefono con un server tuo (open source, MIT): vendite, appuntamenti, scorte basse.
// POST <server>/message con l'intestazione X-Gotify-Key (token di un'applicazione creata nel server) e { title, message, priority }.
import { canale } from '../_comunica/canale.js';
export default canale({
  id: 'gotify', nome: 'Gotify', descrizione: 'Notifiche push sul telefono con Gotify, sul tuo server: vendite, appuntamenti, scorte basse.',
  impostazioni: [
    { id: 'server', nome: 'Indirizzo del server Gotify (https://…)', tipo: 'url' },
    { id: 'token', nome: 'Token dell\'applicazione (A…)', segreto: true },
    { id: 'priorita', nome: 'Priorità (0–10; su Android da 4 suona, da 8 suona e vibra)', tipo: 'scelta', opzioni: ['1', '4', '5', '8', '10'], predefinito: '5' },
  ],
  async scrivi(k, testo) {
    const r = await k.http.post(`${String(k.base || k.imp.server || '').replace(/\/$/, '')}/message`, { json: { title: 'Lumi', message: testo, priority: Number(k.imp.priorita ?? 5) },
      intestazioni: { 'X-Gotify-Key': k.segreti.token } });
    if (!r.ok) throw new Error(`Gotify ha risposto ${r.stato}${r.json?.errorDescription ? `: ${r.json.errorDescription}` : ''}`);
    return { inviato: true, id: r.json?.id };
  },
  catalogo: {
    categoria: 'messaggi', sito: 'https://gotify.net', costo: 'gratis',
    costoNota: 'Gratuito e open source (licenza MIT): lo installi tu su un tuo server, un NAS o un Raspberry Pi; l\'app per Android è gratuita (Google Play, F-Droid). Nessun limite di messaggi. Per iPhone non c\'è un\'app ufficiale.',
    serve: [
      { cosa: 'Un server Gotify raggiungibile da Lumi', dove: 'installazione con Docker (gotify/server) o con il file per Linux, Windows, macOS', link: 'https://gotify.net/docs/install' },
      { cosa: 'Il token di un\'applicazione', dove: 'interfaccia web di Gotify → Apps → Create application → copia il token', link: 'https://gotify.net/docs/pushmsg' },
    ],
    passi: ['Installa il server Gotify (es. con Docker) e apri la sua interfaccia web', 'In «Apps» crea un\'applicazione «Lumi» e copia il token', 'Installa l\'app Gotify sul telefono Android ed entra con il tuo utente', 'Scrivi qui l\'indirizzo del server e il token', 'Scegli quali avvisi ricevere', 'Premi «Prova»: arriva la prima notifica'],
    difficolta: 'media', zone: ['mondo'],
    fonti: ['https://gotify.net/docs/pushmsg', 'https://gotify.net/api-docs', 'https://gotify.net/docs/install', 'https://github.com/gotify/server', 'https://github.com/gotify/android#message-priorities'],
    prova: 'finto', parole: ['gotify', 'push', 'notifiche', 'telefono', 'avvisi', 'self-hosted', 'open source', 'android', 'notifications'],
  },
  testi: {
    en: { nome: 'Gotify', descrizione: 'Push notifications on your phone with Gotify, on your own server: sales, appointments, low stock.', 'imp.server': 'Gotify server address (https://…)', 'imp.token': 'Application token (A…)', 'imp.priorita': 'Priority (0–10; on Android from 4 it sounds, from 8 it sounds and vibrates)',
      'cat.costoNota': 'Free and open source (MIT license): you host it on your own server, a NAS or a Raspberry Pi; the Android app is free (Google Play, F-Droid). No message limits. There is no official iPhone app.',
      'cat.serve': [{ cosa: 'A Gotify server reachable from Lumi', dove: 'install with Docker (gotify/server) or the binary for Linux, Windows, macOS' }, { cosa: 'An application token', dove: 'Gotify web interface → Apps → Create application → copy the token' }],
      'cat.passi': ['Install the Gotify server (e.g. with Docker) and open its web interface', 'In «Apps» create a «Lumi» application and copy the token', 'Install the Gotify app on your Android phone and log in with your user', 'Write the server address and the token here', 'Choose which alerts to get', 'Press «Test»: the first notification arrives'] },
    es: { nome: 'Gotify', descrizione: 'Notificaciones push en el móvil con Gotify, en tu servidor: ventas, citas, stock bajo.', 'imp.server': 'Dirección del servidor Gotify (https://…)', 'imp.token': 'Token de la aplicación (A…)', 'imp.priorita': 'Prioridad (0–10; en Android desde 4 suena, desde 8 suena y vibra)' },
    fr: { nome: 'Gotify', descrizione: 'Notifications push sur le téléphone avec Gotify, sur ton serveur : ventes, rendez-vous, stock bas.', 'imp.server': 'Adresse du serveur Gotify (https://…)', 'imp.token': 'Jeton de l\'application (A…)', 'imp.priorita': 'Priorité (0–10 ; sur Android dès 4 elle sonne, dès 8 elle sonne et vibre)' },
    de: { nome: 'Gotify', descrizione: 'Push-Benachrichtigungen aufs Handy mit Gotify, auf deinem Server: Verkäufe, Termine, niedriger Bestand.', 'imp.server': 'Adresse des Gotify-Servers (https://…)', 'imp.token': 'Anwendungs-Token (A…)', 'imp.priorita': 'Priorität (0–10; auf Android ab 4 mit Ton, ab 8 mit Ton und Vibration)' },
    pt: { nome: 'Gotify', descrizione: 'Notificações push no celular com o Gotify, no seu servidor: vendas, agendamentos, estoque baixo.', 'imp.server': 'Endereço do servidor Gotify (https://…)', 'imp.token': 'Token do aplicativo (A…)', 'imp.priorita': 'Prioridade (0–10; no Android a partir de 4 toca, a partir de 8 toca e vibra)' },
  },
});
