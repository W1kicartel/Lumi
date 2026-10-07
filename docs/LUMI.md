# Lumi dentro Kubo

Lumi è l'assistente di Kubo: una pillola in cima allo schermo a cui si parla o si scrive. Cerca, conta, prepara schede e cambia la forma del gestionale a parole. **L'AI propone, la persona decide**: ogni scrittura, sui dati o sullo schema, è una scheda con Conferma / Annulla.

Il motore è quello del progetto [Lumi](https://github.com/W1kicartel/lumi) (MIT, © W1kicartel), copiato e adattato il meno possibile.

## Accenderlo

1. Crea una chiave su console.anthropic.com, alla voce *API Keys*.
2. In Kubo, da titolare: **Gestione → Lumi**, incolla la chiave, **Salva la chiave**.

In alternativa, la variabile `ANTHROPIC_API_KEY` all'avvio del server. La chiave salvata dall'interfaccia sta nel file `lumi-chiave` accanto a `kubo.db` (permessi 600). Non entra nel database e non arriva mai ai browser.

Senza chiave la pillola resta: mostra «Da vedere» e le azioni rapide, e a chi le scrive dice con garbo come accenderla.

| Variabile | Cosa fa |
|---|---|
| `ANTHROPIC_API_KEY` | la chiave, se non è salvata dall'interfaccia |
| `LUMI_MODELLO`, `LUMI_SFORZO` | modello (predefinito `claude-opus-5-5`, pensiero adattivo) e sforzo (predefinito `low`) |
| `DEEPGRAM_API_KEY` | la voce in tempo reale; senza, Lumi usa il riconoscimento vocale del browser dove c'è |
| `KUBO_LUMI_LIMITE` | domande al minuto per persona (predefinito 20; si cambia anche dalle impostazioni) |
| `ANTHROPIC_BASE_URL` | un altro indirizzo per l'API (le prove usano un finto Claude locale) |

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
| `web/lumi/` | il motore di Lumi (pillola, conversazione, voce, file). Adattamenti: `strumenti` può essere una funzione riletta a ogni giro; `testi` sostituisce alcune frasi |
| `web/moduli/lumi.js`, `lumi.css` | la pillola in Kubo, «Da vedere», le azioni rapide, il contesto (che schermata è aperta), le impostazioni in `#/lumi` |
| `web/moduli/lumi/strumenti.js` | gli strumenti generati dallo schema, senza DOM: si provano in Node |
| `server/moduli/lumi.js` | `POST /api/lumi` (il tramite verso Claude in streaming), impostazioni, `da-vedere`, `riepilogo`, `verifica` |
| `server/moduli/lumi/nucleo.js` | il server di Lumi. Adattamento: fino a 128 strumenti |
| `test/lumi.test.mjs` | finto Claude locale con risposte SSE registrate: chat, chiave, limite, strumenti dei tre modelli, proposte, permessi |

L'unica modifica al motore di Kubo è in `server/api.js`: le rotte ricevono anche `res`, e se hanno già risposto da sé (lo streaming) il server non risponde una seconda volta.

I file mandati a Lumi passano dal corpo delle richieste di Kubo, che è limitato a 5 MB: le foto e i PDF più grandi vengono rifiutati.
