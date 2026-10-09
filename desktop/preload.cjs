// Il ponte fra le pagine e l'app, ridotto al minimo (finestre isolate, sandbox): la prima scelta, e per il gestionale
// solo la scelta di una cartella con la finestra del sistema (per i backup). Nessun accesso a file o comandi.
const { contextBridge, ipcRenderer } = require('electron');
const pagina = (process.argv.find(a => a.startsWith('--gestionale-pagina=')) || '').split('=')[1];

if (pagina === 'scelta') contextBridge.exposeInMainWorld('gestionaleAvvio', { scegli: richiesta => ipcRenderer.invoke('gestionale:scegli', richiesta) });
if (pagina === 'gestionale') contextBridge.exposeInMainWorld('gestionaleDesktop', { scegliCartella: () => ipcRenderer.invoke('gestionale:scegli-cartella') });
