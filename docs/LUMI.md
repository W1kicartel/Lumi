# L'assistente Lumi

Lumi è il gestionale; dentro c'è l'assistente, che si chiama anche lui Lumi: una pillola in cima allo schermo a cui si parla o si scrive. Cerca, conta, prepara schede e cambia la forma del gestionale a parole. **L'AI propone, la persona decide**: ogni scrittura, sui dati o sullo schema, è una scheda con Conferma / Annulla.

Il motore dell'assistente viene dal progetto Lumi per le aziende (MIT, © W1kicartel), copiato e adattato il meno possibile.

## Accenderlo

1. Crea una chiave su console.anthropic.com, alla voce *API Keys*.
2. Da titolare: **Gestione → Lumi**, incolla la chiave, **Salva la chiave**.

In alternativa, la variabile `ANTHROPIC_API_KEY` all'avvio del server. La chiave salvata dall'interfaccia sta nel file `lumi-chiave` accanto a `lumi.db` (permessi 600). Non entra nel database e non arriva mai ai browser.

Senza chiave la pillola resta: mostra «Da vedere» e le azioni rapide, e a chi le scrive dice con garbo come accenderla.

| Variabile | Cosa fa |
|---|---|
| `ANTHROPIC_API_KEY` | la chiave, se non è salvata dall'interfaccia |
| `LUMI_MODELLO`, `LUMI_SFORZO` | modello (predefinito `claude-opus-5-5`, pensiero adattivo) e sforzo (predefinito `low`) |
| `DEEPGRAM_API_KEY` | la voce in tempo reale nel cloud; senza, e senza la voce locale, Lumi usa il riconoscimento vocale del browser dove c'è |
| `LUMI_VOCE` | `no` spegne la voce locale; `onnx` sceglie sherpa-onnx anche dove c'è lumi-voce o con poca memoria |
| `LUMI_VOCE_BINARIO` | il percorso di un programma lumi-voce (o lode-voce) da usare al posto di quello trovato da solo |
| `LUMI_VOCE_MODELLO` | dove tenere il modello ONNX (predefinito: `voce-onnx` accanto a `lumi.db`) |
| `LUMI_DOMANDE_MINUTO` | domande al minuto per persona (predefinito 20; si cambia anche dalle impostazioni) |
| `ANTHROPIC_BASE_URL` | un altro indirizzo per l'API (le prove usano un finto Claude locale) |

## La voce

Si tiene premuto **⌥ Spazio** (Ctrl ⇧ Spazio su Windows e Linux) e si parla, oppure si clicca il microfono. Lumi prova tre strade, in quest'ordine:

1. **La voce locale**, se il server ce l'ha pronta: [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) di NVIDIA gira sul computer che tiene Lumi. È gratis, l'audio non esce dall'azienda e la lingua si riconosce da sola: l'interfaccia può essere in italiano e chi parla può farlo in russo.
2. **Deepgram**, se c'è `DEEPGRAM_API_KEY`: le parole compaiono mentre si parla, ma la lingua è quella dell'interfaccia.
3. **Il riconoscimento del browser** (Web Speech), dove c'è, anche lui nella lingua dell'interfaccia.

Se la voce locale non risponde, la pagina passa alla strada dopo fino a quando non si ricarica. Lumi risponde nella lingua in cui gli si parla o si scrive. Se non la capisce, usa quella dell'interfaccia.

**Le 25 lingue** di Parakeet v3, dalla scheda del modello: bulgaro, ceco, croato, danese, estone, finlandese, francese, greco, inglese, italiano, lettone, lituano, maltese, olandese, polacco, portoghese, rumeno, russo, slovacco, sloveno, spagnolo, svedese, tedesco, ucraino e ungherese (`bg cs da de el en es et fi fr hr hu it lt lv mt nl pl pt ro ru sk sl sv uk`).

### I due motori

| | dove | cosa si scarica | come si accende |
|---|---|---|---|
| **lumi-voce** | Mac con chip Apple, sul Neural Engine | il modello CoreML, circa **460 MB**, la prima volta che parte, in `~/Library/Application Support/FluidAudio` (se c'è già FluidVoice o Lode, è lo stesso e non si riscarica) | si compila una volta: `bash desktop/voce-mac/compila.sh` (qualche minuto, ~1 GB di cache in `desktop/voce-mac/.build`). Il programma finisce in `desktop/bin/lumi-voce`, che git ignora. L'app per il Mac lo mette nel pacchetto |
| **sherpa-onnx** | Windows, Linux, Mac Intel, sul processore | il modello int8 ONNX, **640 MB** (4 file), al primo uso in `<dati>/voce-onnx`, da un commit fisso di Hugging Face e con le impronte SHA256 controllate | `npm install` nella cartella di Lumi: installa `sherpa-onnx-node` 1.13.8, l'unica dipendenza ed è **facoltativa**. Serve un computer con almeno 5,5 GB di memoria |

Senza nessuno dei due il gestionale parte lo stesso, e l'assistente usa Deepgram o la voce del browser.

`compila.sh` vuole gli strumenti di Apple (`xcode-select --install`) e aggira due difetti dei Command Line Tools 16.4. FluidAudio è fermo alla versione 0.17.5 di `Package.resolved`. Se Lumi non trova il suo lumi-voce, sul Mac usa in ripiego il `lode-voce` dell'app Lode. Quel programma però scarta i caratteri non latini (è fatto per l'italiano): con il russo, l'ucraino, il bulgaro e il greco va compilato lumi-voce.

Il modello è di NVIDIA, con licenza CC BY 4.0. FluidAudio e sherpa-onnx hanno licenza Apache 2.0.

### Com'è fatta

- **Il browser** (`web/lumi/voce.js`, `cattura.js`) registra il microfono con un `AudioContext` e un AudioWorklet, mentre il livello muove la pillola come sempre. Lascia il tasto o fai una pausa di un secondo e mezzo (se hai cliccato), e l'audio, ricampionato a 16 kHz mono float32, va al server con `POST /api/lumi/voce/trascrivi`. Il testo arriva nel campo e parte come una domanda scritta.
- **L'endpoint** (`server/moduli/lumi.js`) vuole la stessa autenticazione di `POST /api/lumi` (sessione o token, `X-Lumi`) e Lumi acceso; non serve la chiave di Claude. Il corpo è `application/octet-stream`, al massimo 60 secondi (3.840.000 byte, altrimenti 413). Vale lo stesso limite al minuto delle domande, contato a parte. Risponde `{ testo, motore }`: Parakeet non dice la lingua, quindi la risposta non la riporta.
- **Il motore** (`server/moduli/lumi/voce.js`) si sceglie all'avvio. C'è un processo solo: parte quando qualcuno apre Lumi (lo stato, `voceMotore` e `voceLocale`, dice se è pronto) e si chiude dopo 10 minuti di riposo. Le trascrizioni passano una alla volta, in fila; oltre quattro in attesa la risposta è 503. Per lumi-voce l'audio passa da un file temporaneo 0600 che si cancella **sempre**: alla risposta, all'errore, se il processo cade. All'avvio si tolgono anche quelli lasciati da Lumi chiuso di colpo. Con sherpa-onnx l'audio resta in memoria, e l'addon si carica solo in un processo a parte (`voce-onnx-motore.js`).
- **Le prove**: `test/voce.test.mjs` usa un lumi-voce finto. `node test/voce-vera.mjs`, su un Mac con lumi-voce compilato, genera tre frasi con `say` (russo, tedesco e italiano), le manda a Lumi acceso davvero e controlla le parole.

## Cosa sa fare

Gli strumenti si generano dallo schema: nessuno è scritto a mano per una sezione, e una sezione nuova porta i suoi strumenti al giro dopo.

- **`cerca_<sezione>`, `leggi_<sezione>`** per ogni sezione che la persona vede: testo libero, filtri per campo, ordinamento.
- **`crea_<sezione>`, `modifica_<sezione>`** dove la persona può scrivere. Lo schema JSON dei valori viene dai campi: tipi, opzioni, obbligatori e righe. I collegamenti si danno anche per nome («la vendita di Marta con due vasi blu»); se il nome è ambiguo, Lumi chiede quale.
- **`riepilogo`**: conteggi, somme e gruppi per filtro e periodo. Risponde a domande come «quanto ho venduto questa settimana» o «vendite per pagamento».
- **`da_vedere`**: cosa richiede attenzione. Si genera dallo schema:
  - calcolati vero/falso (`da_riordinare`, `in_ritardo`);
  - elementi fermi nello stato iniziale da più di una settimana;
  - scadenze passate (`consegna`, `scadenza`, `valido fino`…) degli elementi non chiusi.
- **`proponi_modifica_schema`**, solo per chi può personalizzare:
  - aggiungere, rinominare o archiviare campi;
  - aggiungere opzioni;
  - cambiare una formula;
  - creare una sezione nuova.
- **`proponi_automazione`**, sempre per chi può personalizzare: «quando… allora…».

I moduli del server aggiungono i loro strumenti con `k.lumi` (contratto e strumenti delle fatture in [LUMIDOC.md](LUMIDOC.md)): `fattura_nuova`, `fattura_emetti`, `fattura_nota_di_credito`, `fattura_controlla`, `fattura_esporta_xml`, `fattura_stampa`, `fatture_da_incassare`, `fatture_da_pagare`.

Le modifiche dello schema e le automazioni, prima di arrivare alla scheda di conferma, si **provano davvero** sul database (`POST /api/lumi/verifica`, dentro un SAVEPOINT annullato). Così una formula sbagliata o un cambio che perderebbe dati si ferma prima. Dopo il Conferma si applicano con `PUT /api/schema/:id` e `PUT /api/automazioni/:id`, come dall'editor visuale.

Esempi che funzionano (nelle prove):

- «aggiungi la taglia agli articoli con S M L XL»
- «fammi una sezione per i noleggi con cliente, attrezzo, dal, al e stato»
- «quando un noleggio passa a restituito avvisami»

## Permessi

- Le letture passano dalle API con la sessione di chi chiede. Lumi non vede sezioni, righe o campi che quella persona non vede, e il server rifiuta comunque quello che non può fare.
- Gli strumenti di scrittura compaiono solo dove la persona può scrivere. Quelli di personalizzazione compaiono solo per chi può personalizzare.
- Le impostazioni di Lumi (chiave, acceso o spento, limite) sono del titolare.

## Com'è fatto

| File | |
|---|---|
| `web/lumi/` | il motore di Lumi (pillola, conversazione, voce, file). Adattamenti: `strumenti` può essere una funzione riletta a ogni giro; `testi` sostituisce alcune frasi; la voce locale (`voce.js`, `cattura.js`, `trascriviVoce` in `motore.js`) |
| `web/moduli/lumi.js`, `lumi.css` | la pillola in Lumi, «Da vedere», le azioni rapide, il contesto (che schermata è aperta), le impostazioni in `#/lumi` |
| `web/moduli/lumi/strumenti.js` | gli strumenti generati dallo schema, senza DOM: si provano in Node |
| `server/moduli/lumi.js` | `POST /api/lumi` (il tramite verso Claude in streaming), impostazioni, `da-vedere`, `riepilogo`, `verifica` |
| `server/moduli/lumi/nucleo.js` | il server di Lumi. Adattamenti: fino a 128 strumenti; risponde nella lingua di chi parla |
| `server/moduli/lumi/voce.js`, `voce-onnx.js`, `voce-onnx-motore.js` | la voce locale: scelta del motore, lumi-voce, sherpa-onnx con il download del modello |
| `desktop/voce-mac/` | il pacchetto Swift di lumi-voce e `compila.sh` |
| `test/lumi.test.mjs` | finto Claude locale con risposte SSE registrate: chat, chiave, limite, strumenti dei tre modelli, proposte, permessi |

L'unica modifica al motore di Lumi è in `server/api.js`: le rotte ricevono anche `res`, e se hanno già risposto da sé (lo streaming) il server non risponde una seconda volta.

I file mandati all'assistente passano dal corpo delle richieste HTTP, che è limitato a 5 MB: le foto e i PDF più grandi vengono rifiutati.
