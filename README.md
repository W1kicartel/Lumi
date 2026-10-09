# Lumi

**Il gestionale open source che monti a modo tuo.** Rispondi a dieci domande sul tuo lavoro e Lumi prepara clienti, vendite, agenda e magazzino. Poi lo cambi da solo, senza scrivere codice. I dati restano su un tuo computer.

Lumi è il gestionale; dentro c'è l'assistente, che si chiama anche lui Lumi. Prima si chiamava Kubo.

![Il cruscotto di Lumi per una trattoria, con i dati d'esempio](sito/img/cruscotto.png)

- **Lo monti tu.** Sezioni, campi, stati, formule alla Excel in italiano, automazioni e permessi si cambiano da **Personalizza**. Nessuna modifica perde dati: un campo tolto si archivia, un cambio di tipo che perderebbe valori si ferma e ti dice quali.
- **I dati stanno da te.** Un solo file SQLite su un PC o un piccolo server in ufficio; gli altri entrano dal browser della rete locale, anche dal telefono. Funziona senza internet.
- **C'è l'assistente.** Chiedi a parole: «quanto ho incassato questa settimana?», «aggiungi la taglia agli articoli». Lumi legge con i tuoi permessi e propone; ogni modifica la confermi tu. A voce ti capisce in 25 lingue europee, sul tuo computer: l'audio non esce.
- **Si collega al resto.** 129 integrazioni pronte, un connettore HTTP per le API che mancano, i ponti verso Zapier, Make, n8n e Pipedream, le API REST descritte in OpenAPI 3.1.
- **In sei lingue.** Italiano, inglese, spagnolo, francese, tedesco e portoghese del Brasile: ognuno sceglie la sua, l'azienda sceglie la valuta ([docs/LINGUE.md](docs/LINGUE.md)).

Gratis, licenza MIT, zero dipendenze obbligatorie: basta Node ≥ 22.5.

## Provalo in due minuti

```bash
git clone https://github.com/W1kicartel/Lumi
cd Lumi
npm start          # http://localhost:4380 · i dati in ./dati/lumi.db
```

Al primo avvio parte l'**avvio guidato**: il nome dell'attività, una domanda per schermata (che lavoro fai, se hai un magazzino, se prendi appuntamenti, se emetti fatture, chi lavora con te, se vuoi Lumi), e alla fine «vuoi vedere il gestionale con dei dati d'esempio?». Dopo, un giro di quattro tappe ti mostra dove sono le cose. I dati d'esempio si tolgono con un clic; dove non hai ancora inserito niente, la numerazione riparte da 1.

| | |
|---|---|
| ![La prima domanda: che lavoro fai](sito/img/avvio-settore.png) | ![L'ultima schermata: cosa Lumi sta per preparare](sito/img/avvio-riepilogo.png) |

```bash
npm start -- --rete   # anche dagli altri PC e telefoni della rete locale
npm test              # tutta la suite, senza rete
```

C'è anche l'app per il computer, che tiene i dati o si collega a Lumi in rete, e c'è Docker per un VPS con HTTPS. Tutte e tre le strade sono in [docs/INSTALLARE.md](docs/INSTALLARE.md). I backup sono automatici: ogni giorno e prima di ogni modifica alla struttura.

## Settori pronti

Ogni modello ha sezioni, formule, automazioni, ruoli, un cruscotto suo e i dati d'esempio. Si combinano: un'officina che fa anche preventivi, una palestra che emette fatture.

| | cosa c'è | cosa fa da solo |
|---|---|---|
| **Negozio e bottega** | articoli con giacenza e scorta minima, vendite con righe, fornitori e ordini | scala il magazzino alla vendita pagata, lo ricarica al reso e all'arrivo dell'ordine |
| **Ristorante e bar** | tavoli, comande con coperto e uscite, menù con i 14 allergeni e il food cost, prenotazioni, scorte | segna il tavolo occupato e da sparecchiare, avvisa la cucina delle allergie |
| **Laboratorio e artigiano** | preventivi con voci e IVA, commesse a fasi con ore, materiali, costo e margine | il preventivo accettato apre la commessa, l'avvio scala i materiali |
| **Officina e assistenza** | veicoli e apparecchi, interventi a fasi, ore, ricambi, garanzie e revisioni | scala i ricambi una volta sola, aggiorna i km, ricorda di chiamare il cliente |
| **Studio e servizi** | agenda per persona, servizi, schede cliente, pacchetti di sedute | l'appuntamento fatto consuma una seduta |
| **Beauty ed estetica** | agenda per cabina e operatrice, trattamenti, schede, pacchetti, prodotti | conta le sedute e apre la scheda del trattamento |
| **Palestra e associazione** | soci e certificati medici, abbonamenti a tempo o a ingressi, corsi, lezioni e presenze, quote | prepara la quota dell'abbonamento e la scadenza del mensile |
| **Professionista e agenzia** | progetti con budget e ore, registro delle ore, attività e scadenze, preventivi | il preventivo accettato apre il progetto, quello inviato mette il promemoria |
| **Noleggio** | beni con la disponibilità, contratti dal/al con giorni, sconto e cauzione | i beni escono e rientrano da soli, segna la riconsegna, avvisa dei danni |
| **Fatture** | si aggiunge a tutti: numerazione per anno, IVA, ritenuta, bollo, FatturaPA | segna la data del pagamento |
| **Da zero** | nessuna sezione: le crei tu o le chiedi a Lumi | |

Per aggiungere un settore basta scrivere un file in `modelli/` (e, se vuoi, i suoi dati d'esempio in `modelli/esempi/`): vedi [docs/AVVIO.md](docs/AVVIO.md).

## Cosa fa, oltre ai settori

- **Fatture e fisco.** Numerazione per anno, IVA, ritenuta, bollo, il file FatturaPA da mandare allo SDI (anche tramite un intermediario fra quelli del catalogo). Poi registri IVA, liquidazione, LIPE, forfettario, F24 e il pacchetto per il commercialista. Lumi calcola e prepara; la responsabilità resta del contribuente ([docs/FATTURE.md](docs/FATTURE.md), [docs/FISCO.md](docs/FISCO.md)).
- **Tesoreria.** Lo scadenzario di chi ti deve pagare e di chi devi pagare, le distinte Ri.Ba., gli addebiti SDD e i bonifici SEPA, l'estratto conto importato (CAMT.053, CBI, CSV o Excel) e abbinato alle scadenze, i solleciti e la cassa prevista per le prossime settimane ([docs/TESORERIA.md](docs/TESORERIA.md)).
- **Acquisti.** Cosa riordinare, l'ordine al fornitore giusto, il carico di quello che arriva, anche in più volte, e il confronto con la fattura del fornitore ([docs/ACQUISTI.md](docs/ACQUISTI.md)).
- **Magazzino.** Ogni movimento con il suo perché, il valore della merce e l'inventario che corregge le giacenze ([docs/MAGAZZINO.md](docs/MAGAZZINO.md)).
- **Contratti ricorrenti.** Canoni, manutenzioni e abbonamenti: il contratto si scrive una volta e le fatture si preparano quando scadono ([docs/RICORRENTI.md](docs/RICORRENTI.md)).
- **WhatsApp.** Solo con la piattaforma ufficiale di Meta, direttamente o tramite Twilio o 360dialog. I messaggi dei clienti arrivano in una posta unica; rispondi tu o lo chiedi all'assistente. I messaggi automatici (promemoria, conferme, fatture, solleciti) partono solo con il consenso registrato, e STOP vale ovunque ([docs/WHATSAPP.md](docs/WHATSAPP.md)).
- **Agenda e cruscotto.** Il calendario per persona o per cabina, la pagina iniziale con i numeri, le liste filtrate e salvate ([docs/AGENDA.md](docs/AGENDA.md)).
- **Documenti.** Preventivi, fatture e documenti A4 da stampare o salvare in PDF, con il tuo logo ([docs/DOCUMENTI.md](docs/DOCUMENTI.md)).
- **Import ed export.** Excel e CSV in entrata e in uscita, gli allegati, i token per le API e i webhook firmati ([docs/IMPORT.md](docs/IMPORT.md)).

## Le integrazioni

Il catalogo ne ha **129**, in 21 categorie: pagamenti, cassa e POS, negozi online, marketplace, fatturazione elettronica, contabilità, banche, spedizioni, WhatsApp, messaggi, email, SMS, calendario, prenotazioni, archivio e file, produttività, marketing, recensioni, firma, dati delle aziende e automazione. Ognuna ha la sua pagina con cosa serve, quanto costa e i passi per accenderla: [docs/CATALOGO.md](docs/CATALOGO.md).

Sono tutte provate contro un servizio finto che risponde come quello vero, secondo la documentazione: prima di affidarti, fai una prova nella tua situazione.

Se un servizio manca:

- il connettore **HTTP / API REST** lo collega con qualche «ricetta» scritta dalla sua pagina, senza codice;
- i **ponti** verso Zapier, Make, n8n e Pipedream, e i webhook generici, aprono le migliaia di app che quelle piattaforme conoscono;
- le API di Lumi sono descritte in **OpenAPI 3.1**, generato dallo schema di chi chiede.

Un connettore nuovo è una cartella con un file: [docs/CONNETTORI.md](docs/CONNETTORI.md).

## Com'è fatto

| | |
|---|---|
| ![La scheda di una comanda](sito/img/scheda.png) | ![Personalizza sui campi del menù](sito/img/personalizza.png) |

- **`server/`** (Node, nessuna dipendenza): `schema.js` trasforma lo schema in tabelle senza perdite; `dati.js` fa il CRUD generico con righe figlie, calcolati e registro; poi `formule.js`, `permessi.js`, `automazioni.js`, `auth.js` (scrypt, sessioni, PIN al banco) e `api.js` (REST, eventi in tempo reale, file statici). I moduli in `server/moduli/` aggiungono agenda e cruscotto, documenti e FatturaPA, fisco, tesoreria, acquisti, magazzino, contratti ricorrenti, WhatsApp, connettori, import ed export, l'assistente e l'avvio guidato.
- **`web/`**: l'interfaccia in moduli ES puri, senza build, aggiornata in tempo reale quando un collega modifica.
- **`connettori/`**: le integrazioni, una cartella ciascuna.
- **`desktop/`**: l'app per il computer (Electron), con la voce locale per il Mac.
- **`modelli/`**: i settori in JSON.
- **`sito/`**: la pagina di presentazione, pubblicata su GitHub Pages da `.github/workflows/sito.yml`.

Il disegno completo è in [docs/PROGETTO.md](docs/PROGETTO.md).

## Lumi non fa per te se…

…vuoi un numero di telefono da chiamare quando qualcosa non va e non hai nessuno che sappia installare un programma, oppure ti serve la contabilità completa (prima nota, bilancio, F24): quella resta al commercialista.

## La voce dell'assistente

Tieni premuto ⌥ Spazio (Ctrl ⇧ Spazio su Windows e Linux) e parla. Se il computer che tiene Lumi ha la **voce locale**, la trascrive [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) di NVIDIA, gratis e senza mandare l'audio fuori. Riconosce da sola una delle 25 lingue europee del modello: bulgaro, ceco, croato, danese, estone, finlandese, francese, greco, inglese, italiano, lettone, lituano, maltese, olandese, polacco, portoghese, rumeno, russo, slovacco, sloveno, spagnolo, svedese, tedesco, ucraino e ungherese. L'assistente risponde nella lingua in cui gli hai parlato.

- **Mac con chip Apple:** `bash desktop/voce-mac/compila.sh` una volta (servono gli strumenti di Apple). Al primo uso si scarica il modello, circa 460 MB.
- **Windows, Linux, Mac Intel:** `npm install` aggiunge `sherpa-onnx-node`, l'unica dipendenza ed è facoltativa. Al primo uso scarica il modello ONNX: 640 MB, controllati con le impronte.

Senza voce locale il gestionale funziona lo stesso, e l'assistente ascolta con Deepgram (se c'è la chiave) o con la voce del browser. Tutto in [docs/LUMI.md](docs/LUMI.md#la-voce).

## Sicurezza e prestazioni

- Come Lumi protegge i dati, e cosa si regola da *Sicurezza*: [docs/SICUREZZA.md](docs/SICUREZZA.md).
- Quanto resta veloce con 50.000 articoli e 200.000 righe di vendita: [docs/PRESTAZIONI.md](docs/PRESTAZIONI.md).

## Licenza

MIT © W1kicartel. Il carattere Geist è © Vercel, con licenza SIL OFL 1.1.
