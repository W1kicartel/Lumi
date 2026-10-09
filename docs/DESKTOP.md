# App desktop, rete, backup e aggiornamenti

Come si installa: [INSTALLARE.md](INSTALLARE.md). Qui c'è come è fatto.

## I file

| file | cosa fa |
|---|---|
| `desktop/main.mjs` | l'app Electron: la prima scelta, Kubo nel processo principale, la finestra, l'icona nel vassoio, l'avvio con il sistema |
| `desktop/kubo.mjs` | `accendi({ radice, cartella, porta, rete })`: accende lo stesso server di `server/` (porta occupata → prova le 10 dopo) e restituisce `chiudi()` |
| `desktop/scelta.html`, `scelta.js`, `preload.cjs` | la prima scelta «Questo PC tiene i dati» / «Collegati a un Kubo in rete» e il ponte minimo con la pagina |
| `desktop/icona.mjs` | disegna l'icona dell'app (`build/icon.png`) e quella del vassoio, senza file di grafica |
| `server/moduli/desktop.js` | le rotte e gli orari: backup del giorno, backup prima delle modifiche, versioni nuove |
| `server/moduli/desktop-backup.js` | copia (VACUUM INTO), rotazione, allegati incrementali, verifica, ripristino |
| `server/moduli/desktop-qr.js` | un codificatore QR da zero (byte, correzione M, versioni 1-10) |
| `server/moduli/desktop-rete.js` | gli indirizzi in rete, il codice da dettare, gli indirizzi scritti come capita |
| `server/moduli/desktop-aggiorna.js` | il controllo delle versioni su GitHub (avvisa e basta) |
| `web/moduli/desktop.js`, `.css` | le pagine **Collega dispositivi** (`#/rete`) e **Backup** (`#/backup`), e l'avviso di una versione nuova |
| `Dockerfile`, `docker-compose.yml` | il contenitore e il VPS con Caddy |

## L'app

- **Il processo principale.** Kubo gira dentro il processo principale di Electron (Node 24 in Electron 44, con `node:sqlite`). Non c'è un secondo processo né un Node a parte.
- **Cartelle.** Nel pacchetto `server/`, `web/` e `modelli/` stanno in `resources/kubo`. In sviluppo si usa la cartella sopra `desktop/`.
- **Le finestre sono isolate.** Hanno `contextIsolation` e `sandbox`, e niente Node nella pagina. Navigano solo sull'origine di Kubo. I collegamenti esterni (solo `https:` e `mailto:`) si aprono nel browser.
- **Il ponte.** Il preload espone `kuboAvvio.scegli()` alla prima scelta e `kuboDesktop.scegliCartella()` al gestionale, dove serve per scegliere la cartella dei backup con la finestra del sistema: solo quando i dati sono su questo PC (a un Kubo in rete non si dà niente, e la cartella sarebbe di questo PC e non del server). Il processo principale controlla sempre chi chiede.
- **Un ripristino ricarica la finestra.** Il server emette `process.emit('kubo:ripristinato')` e l'app ricarica.

Le opzioni:

| opzione | a cosa serve |
|---|---|
| `--nascosto` | parte senza finestra; è quella dell'avvio con il sistema |
| `--cartella-utente <dir>` | impostazioni e dati altrove (installazione portatile) |
| `--prova` | accende Kubo senza finestre in una cartella temporanea, controlla `/api/stato`, stampa `PROVA OK` ed esce |
| `--foto <prefisso>` | per le prove: fotografa la prima scelta e il gestionale ed esce |

### Costruire gli installatori

Serve electron-builder: è l'unico caso in cui si installa qualcosa, e solo per chi costruisce.

```bash
cd desktop
npm install          # electron e electron-builder (devDependencies)
npm start            # prova l'app dai sorgenti
npm run prova        # la modalità di prova, senza finestre
npm run dist:mac     # dist/Kubo-x.y.z-mac.dmg (universale)
npm run dist:win     # dist/Kubo-x.y.z-windows.exe (NSIS, senza diritti di amministratore)
npm run dist:linux   # dist/Kubo-x.y.z-linux.AppImage e .deb
```

`dist:*` disegna prima l'icona (`npm run icona`). Sul Mac, prima di `dist:mac`, compila la voce locale con `bash voce-mac/compila.sh`: `desktop/bin/kubo-voce` (solo arm64) entra nel pacchetto in `Resources/kubo/bin`, e `x64ArchFiles` lo lascia com'è nell'app universale. Se manca, l'app si costruisce lo stesso, senza voce locale. Il microfono ha la sua frase in `NSMicrophoneUsageDescription`. Nell'app per Windows e Linux sherpa-onnx non c'è ancora: lì Lumi ascolta con Deepgram o con la voce del browser ([LUMI.md](LUMI.md#la-voce)). Gli installatori vanno pubblicati come «release» su GitHub (W1kicartel/kubo).

Prima di distribuirli bisogna firmarli:

- **Mac:** certificato Developer ID e notarizzazione (`CSC_LINK`, `APPLE_ID`…). Senza firma, macOS blocca l'app scaricata.
- **Windows:** certificato di firma del codice. Senza, SmartScreen avvisa.

## Rete

- `GET /api/desktop/rete` restituisce gli IPv4 della rete locale, prima quelli privati (192.168, 10, 172.16-31).
- Per ognuno dà l'URL, il **codice** e la matrice del **QR**. Il codice è IP e porta in 10 caratteri base 32, senza I, L, O, U, per esempio `R8M0-0A1C-4W`.
- Dietro un proxy si aggiunge l'indirizzo con cui si è arrivati (`Host` e `X-Forwarded-Proto`).
- Se Kubo ascolta solo su 127.0.0.1, la pagina spiega come aprirlo alla rete.

Il QR usa il modo byte con la correzione M: sopporta circa il 15% di danni, abbastanza per uno schermo fotografato. Si sceglie la versione più piccola che basta: un indirizzo locale sta nella versione 2 (25×25). La maschera è quella con la penalità più bassa, come vuole la norma.

Il test lo rilegge con un lettore scritto da capo e controlla i valori noti della norma. Nella prova nel browser, il lettore di Chromium (`BarcodeDetector`) ha letto l'URL giusto.

## Backup

Nomi dei file: `kubo-AAAA-MM-GG-hh-mm-ss-<tipo>.db`, nella cartella `backup/` accanto ai dati oppure in una cartella scelta dal titolare.

| tipo | quando | quanti se ne tengono |
|---|---|---|
| giornaliero | ogni giorno, al primo controllo (ogni 30 minuti) | il più recente di ognuno degli ultimi 7 giorni, 4 settimane ISO e 12 mesi |
| modifica | prima di cambiare lo schema, installare un modello o fare un import (al massimo uno ogni 2 minuti) | gli ultimi 10 |
| manuale | «Fai un backup adesso», o quando si cambia cartella | tutti, finché il titolare non li elimina |
| sicurezza | prima di ogni ripristino | gli ultimi 5 |
| caricato | «Carica un backup» | gli ultimi 5 |

- **Copia coerente.** Si fa con `VACUUM INTO`, anche mentre si lavora. Si scrive in un file provvisorio, che si rinomina solo a copia finita.
- **Allegati.** Vanno in `<backup>/allegati/` in modo incrementale: si copiano solo i file nuovi o cambiati e non si cancella niente, così anche un backup vecchio ritrova i suoi file.
- **Disco esterno staccato.** Se la cartella scelta non risponde, la copia va accanto ai dati e nella pagina compare un avviso. Con una cartella esterna l'elenco mostra anche le copie rimaste accanto ai dati (segnate «accanto ai dati»): si scaricano e si ripristinano come le altre.
- **Il gancio «prima».** Il backup prima delle modifiche usa `prima(metodo, percorso, f)`, un piccolo gancio aggiunto a `server/api.js`: un modulo può agire prima della rotta di un altro senza toccarla.

### Ripristino

Il ripristino non spegne il server. Va così:

1. Il file si controlla:
   - `integrity_check`;
   - le tabelle del motore;
   - almeno un titolare attivo;
   - una versione dello schema non più nuova di quella di Kubo.
2. Si fa una copia di **sicurezza** di adesso.
3. Il backup si prepara in un file a parte, in una cartella provvisoria:
   - si apre con `apri()` di `server/db.js`, che fa le migrazioni del motore che mancano a un backup di una versione vecchia;
   - si aggiungono, vuote, le tabelle dei moduli arrivati dopo;
   - le impostazioni `backup.*` e `aggiornamenti.*` restano quelle di adesso (altrimenti la cartella dei backup, con la copia di sicurezza appena fatta, tornerebbe quella di allora o di un altro computer);
   - la sessione di chi ripristina, se il suo utente c'è anche nel backup.
4. Le pagine si copiano dentro il database vivo con l'API di backup di SQLite (`node:sqlite` → `backup()`), in un colpo solo. La connessione aperta vede il contenuto nuovo alla lettura dopo. Poi `wal_checkpoint(TRUNCATE)`.
5. Gli allegati che mancano tornano dalla cartella `allegati` accanto al backup.
6. Si avvisano i browser collegati (evento `ripristinato`): si ricaricano da soli.

Niente si perde: per tornare a prima del ripristino basta ripristinare la copia «Prima di un ripristino».

### Rotte (solo il titolare, mai con un token delle API)

`GET /api/backup` · `POST /api/backup` · `PUT /api/backup/cartella { cartella }` · `GET|DELETE /api/backup/file/:nome` · `POST /api/backup/ripristina { nome, conferma: true }` · `POST /api/backup/carica { nome, dimensione }` → `{ id, pezzo }` · `POST /api/backup/carica/:id { da, pezzo }` (base64, pezzi da 2 MB, fino a 4 GB).

## Versioni nuove

Il controllo è spento finché il titolare non lo accende. Una volta al giorno legge l'ultima release pubblicata di `W1kicartel/kubo` (`api.github.com/repos/W1kicartel/kubo/releases/latest`):

- la richiesta non porta dati dell'azienda;
- si confronta il numero con la versione di `package.json`, saltando bozze e pre-release;
- il collegamento mostrato è solo una pagina `https://github.com/…`.

Se c'è una versione nuova, il titolare vede un avviso discreto, una volta per versione. Kubo non scarica e non installa mai niente. Nei test `KUBO_AGGIORNAMENTI_URL` punta a un finto server locale.
