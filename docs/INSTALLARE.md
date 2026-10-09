# Installare Lumi

Tre strade, dalla più semplice. I dati sono sempre un unico file SQLite (`lumi.db`) più la cartella `file/` degli allegati.

## 1. L'app per il computer (consigliata)

Per chi non vuole sentir parlare di server. Si scarica l'installatore dalla pagina delle versioni ([github.com/W1kicartel/Lumi/releases](https://github.com/W1kicartel/Lumi/releases)):
**Lumi-x.y.z-mac.dmg**, **Lumi-x.y.z-windows.exe** oppure **Lumi-x.y.z-linux.AppImage** / **.deb**.

Al primo avvio l'app chiede come usare quel computer:

- **Questo PC tiene i dati.** Scegli questo sul primo computer, quello che sta sempre acceso in ufficio. Lumi si accende dentro l'app. I dati stanno nella cartella dell'utente:
  - Mac: `~/Library/Application Support/Lumi/dati`;
  - Windows: `%APPDATA%\Lumi\dati`;
  - Linux: `~/.config/Lumi/dati`.

  Chiudendo la finestra Lumi resta acceso nella barra dei menu (Mac) o nell'area di notifica (Windows, Linux), così gli altri continuano a lavorare. Dal menu dell'icona:
  - «Avvia con il computer»;
  - «Aperto alla rete locale»;
  - «Collega altri dispositivi»;
  - «Backup»;
  - «Esci».
- **Collegati a Lumi in rete.** Sugli altri computer. Si scrive l'indirizzo (`192.168.1.20`) oppure il codice (`R8M0-0A1C-4W`) che il primo PC mostra in **Collega dispositivi**. Funziona anche con Lumi su un server o un VPS: si scrive `https://lumi.miazienda.it`.

Telefoni e tablet non hanno bisogno dell'app: inquadrano il codice QR in **Collega dispositivi** e Lumi si apre nel browser.

> La prima volta, Mac e Windows possono chiedere se Lumi può ricevere connessioni dalla rete: rispondi sì, altrimenti gli altri dispositivi non lo trovano.

## 2. Con Node, da terminale

Basta Node 22.5 o più nuovo ([nodejs.org](https://nodejs.org)). Non c'è niente da installare con npm.

```bash
git clone https://github.com/W1kicartel/Lumi.git && cd Lumi
npm start                        # solo da questo computer: http://localhost:4380
npm start -- --rete              # anche dagli altri PC e telefoni della rete locale
npm start -- --dati /percorso/dati --porta 8080
```

Ci sono anche le variabili d'ambiente:

- `LUMI_DATI`, `LUMI_PORTA`, `LUMI_RETE=1`;
- `LUMI_BACKUP=0` spegne i backup automatici;
- `LUMI_AGGIORNAMENTI_URL` dice dove controllare le versioni nuove.

Per tenerlo acceso da solo puoi usare un servizio di sistema: systemd su Linux, launchd su Mac, NSSM su Windows.

## 3. Docker, anche su un VPS con HTTPS

```bash
docker build -t lumi .
docker run -d --init --name lumi -p 4380:4380 -v lumi-dati:/dati --restart unless-stopped lumi
```

L'immagine:

- parte da `node:24-slim`;
- gira come utente non root (`node`);
- tiene i dati nel volume `/dati`;
- ha un controllo di salute su `/api/stato`.

**Su un VPS con il tuo dominio e HTTPS automatico**, con Caddy e i certificati Let's Encrypt:

1. Punta il dominio (record A) all'IP del server.
2. Apri le porte 80 e 443.
3. Lancia:

```bash
LUMI_DOMINIO=lumi.miazienda.it docker compose up -d
```

Su internet togli la riga `4380:4380` da `docker-compose.yml`: così si passa solo da Caddy, cioè da HTTPS.

**I backup** di un'installazione Docker vanno in `/dati/backup`, dentro il volume. Per averli fuori, monta un disco o una cartella (vedi il commento in `docker-compose.yml`) e sceglila in **Backup → Dove vanno i backup**.

## Aggiornare

Lumi non si aggiorna mai da solo. Se il titolare accende **Backup → Versioni nuove**, Lumi controlla una volta al giorno se ne è uscita una e lo avvisa. Prima di aggiornare conviene fare un backup (**Fai un backup adesso**). Poi:

- **app:** installa la versione nuova sopra la vecchia;
- **Node:** `git pull` e riavvia;
- **Docker:** `docker compose build && docker compose up -d`.

I dati non si toccano. Le migrazioni del database partono da sole all'avvio, e prima di ognuna Lumi fa una copia.

### Da Kubo a Lumi

Lumi prima si chiamava Kubo. Le installazioni di prova con il nome vecchio ripartono senza fare niente:

- il database: se nella cartella dei dati c'è solo `kubo.db`, all'avvio diventa `lumi.db` (se sembra ancora aperto, con `kubo.db-wal` o `kubo.db-shm` accanto, si usa così com'è);
- l'app per il computer: se la cartella utente nuova (`…/Lumi`) è vuota e c'è quella vecchia (`…/Kubo`), si continua con quella, con i suoi dati e la sua scelta;
- le variabili `KUBO_*` valgono ancora come le `LUMI_*`, ma sono **deprecate**: all'avvio Lumi lo scrive nel terminale. `KUBO_LUMI_LIMITE` ora si chiama `LUMI_DOMANDE_MINUTO`;
- le sessioni aperte e i token per le API creati prima (`kubo_…`) restano validi.

Cambiano invece i nomi visti da fuori: le intestazioni dei webhook (`X-Lumi-Firma`, `X-Lumi-Tempo`, `X-Lumi-Evento`, `X-Lumi-Consegna`), l'intestazione `X-Lumi` delle richieste del browser, i riferimenti dei pagamenti (`lumi-v-…`, `lumi-f-…`), l'immagine e il volume Docker (`lumi`, `lumi-dati`) e il programma della voce sul Mac (`lumi-voce`: ricompilalo con `bash desktop/voce-mac/compila.sh`).
