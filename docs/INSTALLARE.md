# Installare Kubo

Tre strade, dalla più semplice. I dati sono sempre un unico file SQLite (`kubo.db`) più la cartella `file/` degli allegati.

## 1. L'app per il computer (consigliata)

Per chi non vuole sentir parlare di server. Si scarica l'installatore dalla pagina delle versioni ([github.com/W1kicartel/kubo/releases](https://github.com/W1kicartel/kubo/releases)):
**Kubo-x.y.z-mac.dmg**, **Kubo-x.y.z-windows.exe** oppure **Kubo-x.y.z-linux.AppImage** / **.deb**.

Al primo avvio l'app chiede come usare quel computer:

- **Questo PC tiene i dati.** Scegli questo sul primo computer, quello che sta sempre acceso in ufficio. Kubo si accende dentro l'app. I dati stanno nella cartella dell'utente:
  - Mac: `~/Library/Application Support/Kubo/dati`;
  - Windows: `%APPDATA%\Kubo\dati`;
  - Linux: `~/.config/Kubo/dati`.

  Chiudendo la finestra Kubo resta acceso nella barra dei menu (Mac) o nell'area di notifica (Windows, Linux), così gli altri continuano a lavorare. Dal menu dell'icona:
  - «Avvia con il computer»;
  - «Aperto alla rete locale»;
  - «Collega altri dispositivi»;
  - «Backup»;
  - «Esci».
- **Collegati a un Kubo in rete.** Sugli altri computer. Si scrive l'indirizzo (`192.168.1.20`) oppure il codice (`R8M0-0A1C-4W`) che il primo PC mostra in **Collega dispositivi**. Funziona anche con un Kubo su un server o un VPS: si scrive `https://kubo.miazienda.it`.

Telefoni e tablet non hanno bisogno dell'app: inquadrano il codice QR in **Collega dispositivi** e Kubo si apre nel browser.

> La prima volta, Mac e Windows possono chiedere se Kubo può ricevere connessioni dalla rete: rispondi sì, altrimenti gli altri dispositivi non lo trovano.

## 2. Con Node, da terminale

Basta Node 22.5 o più nuovo ([nodejs.org](https://nodejs.org)). Non c'è niente da installare con npm.

```bash
git clone https://github.com/W1kicartel/kubo.git && cd kubo
npm start                        # solo da questo computer: http://localhost:4380
npm start -- --rete              # anche dagli altri PC e telefoni della rete locale
npm start -- --dati /percorso/dati --porta 8080
```

Ci sono anche le variabili d'ambiente:

- `KUBO_DATI`, `KUBO_PORTA`, `KUBO_RETE=1`;
- `KUBO_BACKUP=0` spegne i backup automatici;
- `KUBO_AGGIORNAMENTI_URL` dice dove controllare le versioni nuove.

Per tenerlo acceso da solo puoi usare un servizio di sistema: systemd su Linux, launchd su Mac, NSSM su Windows.

## 3. Docker, anche su un VPS con HTTPS

```bash
docker build -t kubo .
docker run -d --init --name kubo -p 4380:4380 -v kubo-dati:/dati --restart unless-stopped kubo
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
KUBO_DOMINIO=kubo.miazienda.it docker compose up -d
```

Su internet togli la riga `4380:4380` da `docker-compose.yml`: così si passa solo da Caddy, cioè da HTTPS.

**I backup** di un'installazione Docker vanno in `/dati/backup`, dentro il volume. Per averli fuori, monta un disco o una cartella (vedi il commento in `docker-compose.yml`) e sceglila in **Backup → Dove vanno i backup**.

## Aggiornare

Kubo non si aggiorna mai da solo. Se il titolare accende **Backup → Versioni nuove**, Kubo controlla una volta al giorno se ne è uscita una e lo avvisa. Prima di aggiornare conviene fare un backup (**Fai un backup adesso**). Poi:

- **app:** installa la versione nuova sopra la vecchia;
- **Node:** `git pull` e riavvia;
- **Docker:** `docker compose build && docker compose up -d`.

I dati non si toccano. Le migrazioni del database partono da sole all'avvio, e prima di ognuna Kubo fa una copia.
