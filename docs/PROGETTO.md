# Kubo: il progetto


**L'idea:** il gestionale open source più versatile che esista. Un'azienda non deve più cercare qualcuno che le scriva il gestionale: parte da un modello del suo settore e poi se lo cuce addosso da sola. Può farlo:

- dalle impostazioni;
- con l'editor visuale, senza scrivere codice;
- chiedendolo a Lumi a parole;
- con un plugin, se ha uno sviluppatore.

Kubo sono i blocchi: ogni azienda monta i suoi e il gestionale prende la sua forma.

## Principi

1. **I dati restano in azienda.** Un PC o un piccolo server in ufficio tiene un unico file SQLite. Gli altri si collegano con l'app desktop o dal browser in rete locale. Funziona senza internet. Chi vuole può installarlo su un VPS con Docker. Il cloud non è mai obbligatorio.
2. **Zero dipendenze, zero build.** Server in Node ≥ 22: `node:http` e `node:sqlite`. Web in moduli ES puri. Si installa e si aggiorna copiando una cartella, e il codice si legge e si modifica senza strumenti.
3. **Tutto è definito da uno schema.** Entità, campi, viste, automazioni, permessi e documenti sono dati (JSON nel database), non codice. L'interfaccia, le API e Lumi si generano dallo schema. Personalizzare vuol dire modificare lo schema, non il programma.
4. **Nessuna modifica perde dati.** Rinominare un campo non tocca il database, perché le colonne hanno id stabili. Un campo eliminato viene archiviato e si può ripristinare. Il cambio di tipo converte i valori e prima avverte di quelli che non si possono convertire. Ogni modifica allo schema finisce nel registro.
5. **Ogni modifica ha un autore.** Il registro (audit) dice chi ha cambiato cosa, quando, e qual era il valore prima.
6. **L'AI propone, la persona decide.** Lumi legge con i permessi dell'utente. Ogni scrittura, sui dati o sullo schema, è una proposta con Conferma / Annulla.
7. **Italia prima, mondo poi.** Codice fiscale e partita IVA, IVA, fattura elettronica (FatturaPA/SDI) e numerazione per anno arrivano come moduli. Le lingue sono `it` ed `en` fin dall'inizio.

## Architettura

```
 server/   Node 24, nessuna dipendenza
   db.js           SQLite (WAL), tabelle di sistema _*, migrazioni del motore
   schema.js       definizioni → tabelle: crea, aggiunge colonne, archivia; validazione
   dati.js         lettura/scrittura generica: filtri, ordinamento, ricerca, pagine, righe figlie
   formule.js      campi calcolati: un linguaggio piccolo e sicuro (niente eval)
   permessi.js     ruoli × entità × azione, campi nascosti/sola lettura, «solo i propri»
   automazioni.js  quando (creato, modificato, campo cambia, data arriva, ogni giorno) → allora (…)
   numeratori.js   numerazione per serie e anno (fatture, preventivi, commesse)
   auth.js         utenti, password (scrypt), sessioni, PIN rapido al banco
   api.js          REST + eventi in tempo reale (SSE) per vedere subito le modifiche degli altri
   modelli.js      installa un modello di settore (negozio, laboratorio, studio…)
 web/      l'interfaccia generica: lista, scheda, kanban, calendario, cruscotto, «Personalizza»
 modelli/  i modelli di settore in JSON: entità, viste, automazioni, domande dell'avvio guidato
 desktop/  Electron: «questo PC è il server» (indirizzo e QR per gli altri) oppure «collegati»
 lumi/     l'assistente (da github.com/W1kicartel/lumi): strumenti generati dallo schema
```

### I dati

Ogni entità diventa una tabella `d_<id>`. Le colonne fisse sono `id`, `creato`, `modificato`, `creato_da`, `modificato_da` e `archiviato`; poi una colonna `c_<idCampo>` per ogni campo. L'id del campo non cambia mai, l'etichetta sì.

### Tipi di campo

| tipo | note |
|---|---|
| testo, testo_lungo, email, telefono, url | ricerca a testo pieno |
| numero, valuta, percentuale | valuta in centesimi interi |
| data, data_ora, durata | |
| si_no | |
| scelta, scelta_multipla | opzioni colorate |
| stato | un flusso con le transizioni permesse (es. preventivo → accettato → in lavorazione → consegnato) |
| relazione | verso un'altra entità, uno o molti |
| righe | sotto-tabella: righe d'ordine, materiali di una commessa |
| file, immagine | |
| calcolato | formula: `quantita * prezzo`, `SOMMA(righe.totale)`, `SE(scadenza < OGGI(); "scaduto"; "")` |
| contatore | dal numeratore: `F-2026-0042` |
| utente | |
| codice_a_barre | EAN/Code128, si legge con il lettore |
| indirizzo | |

### Viste

- **Lista:** filtri, colonne, raggruppamento e totali.
- **Scheda:** sezioni e colonne trascinabili.
- **Kanban** per un campo stato o scelta.
- **Calendario** per un campo data o data_ora, con l'agenda per risorsa.
- **Galleria** per le immagini.
- **Cruscotto:** numeri, grafici, «cosa richiede attenzione».

Ogni vista si salva per sé o per tutti.

### Personalizzare, su quattro livelli

1. **L'avvio guidato:** una dozzina di domande sceglie il modello e accende o spegne i moduli.
2. **«Personalizza»**, sopra ogni schermata: aggiungi, sposta o rinomina un campo, nuova entità, nuova vista, nuova automazione, permessi. Si vede subito com'è e si torna indietro.
3. **Lumi:** «aggiungi la taglia agli articoli», «quando un ordine passa a spedito, scala il magazzino», «fammi un modulo per i noleggi». Lumi mostra la modifica allo schema e la applica dopo il Conferma.
4. **Plugin:** un file JS in `plugin/` registra campi, azioni, documenti, integrazioni (e-commerce, SDI, stampanti) e viste.

## Primi modelli

- **Negozio e bottega:** articoli e varianti, magazzino con soglie e movimenti, clienti, vendite e cassa, ordini ai fornitori, resi.
- **Laboratorio e artigiano:** preventivi, commesse con fasi e stato, materiali e tempi, consegne, prezzi su misura.
- **Studio e servizi:** agenda per persona e risorsa, appuntamenti, schede cliente, pratiche, pacchetti e abbonamenti.

In tutti e tre ci sono anche documenti (preventivo, fattura, DDT), pagamenti e scadenze, cruscotto e permessi.

## Fasi

1. **Fondamenta:** motore dello schema, dati, API, utenti e permessi, interfaccia generica (lista e scheda), modello «negozio» minimo, test.
2. **Personalizza:** l'editor visuale, kanban e calendario, formule, automazioni.
3. **I tre modelli completi** e l'avvio guidato.
4. **Documenti e Italia:** stampe, numeratori, IVA, FatturaPA.
5. **Lumi** dentro, con gli strumenti generati e la modifica dello schema a parole.
6. **Desktop e rete:** Electron server/cliente, backup automatici, aggiornamenti, Docker.
7. **Import ed export:** CSV/Excel, API pubblica con token, webhook.

## Cosa non è

- Non è un fork: è scritto da zero.
- Non contiene codice né nomi di progetti fatti per clienti.
- Non è un CRM cloud con il gestionale attaccato sopra.
