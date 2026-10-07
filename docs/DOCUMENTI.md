# Documenti, stampe e fattura elettronica

Il modulo **Documenti** fa uscire i dati da Kubo in forma ufficiale: documenti A4 da stampare o salvare in PDF, fatture numerate come vuole la legge e il file **FatturaPA** da mandare allo SDI.

Il codice sta tutto in file suoi:

| file | cosa fa |
|---|---|
| `server/moduli/documenti.js` | rotte, dati dell'azienda, logo, numerazione delle fatture, «crea fattura da» |
| `server/moduli/documenti-italia.js` | controllo di partita IVA, codice fiscale e IBAN |
| `server/moduli/documenti-calcoli.js` | i conti: righe, riepilogo IVA, ritenuta, bollo |
| `server/moduli/documenti-stampa.js` | i modelli di stampa e il documento HTML |
| `server/moduli/documenti-xml.js` | controlli ed esportazione FatturaPA 1.2.2 (FPR12) |
| `web/moduli/documenti.js` e `.css` | anteprima, bottoni nella scheda, pagina «Documenti» |
| `modelli/fatture.json` | il modello «Fatture e fattura elettronica» |

Nel motore ci sono tre aggiunte piccole:

- `server/dati.js`: un registro di validatori (`D.validatore(nome, f)`). Un campo di testo con `"valida": "piva"`, `"codice_fiscale"` o `"iban"` viene controllato a ogni salvataggio, e il valore si salva pulito: maiuscolo e senza spazi.
- `server/modelli.js`: i modelli si ordinano per `ordine`. Quello delle fatture si aggiunge agli altri, quindi va dopo i modelli di settore.
- `server/db.js`: gli id creati nello stesso millisecondo crescono in ordine. Così le righe di un documento restano nell'ordine in cui le hai scritte.

## I dati dell'azienda

Si compilano in **Documenti → Dati dell'azienda**. Può cambiarli solo chi può personalizzare il gestionale. Si salvano in `_meta`, alla chiave `documenti.azienda`.

- **Anagrafica:** ragione sociale, partita IVA, codice fiscale, regime fiscale (RF01…RF19), indirizzo, telefono, email, PEC, il tuo codice destinatario.
- **Pagamenti:** IBAN e banca.
- **Documenti:** l'IVA predefinita e il colore.

La partita IVA, il codice fiscale e l'IBAN si controllano con la cifra di controllo:

- **partita IVA:** l'algoritmo di Luhn sulle 11 cifre;
- **codice fiscale delle persone:** il carattere di controllo, anche con l'omocodia;
- **codice fiscale delle società:** 11 cifre, come la partita IVA;
- **IBAN:** il modulo 97, con la lunghezza giusta per ogni paese.

Il **logo** è un PNG o un JPEG di al massimo 300 KB. Si riconosce dai primi byte del file, non dal nome. Si salva in `<cartella dati>/documenti/logo.png` (o `.jpg`), accanto a `kubo.db`, e nel backup della cartella c'è anche lui.

## Modelli di stampa

Ogni sezione con le righe ha il suo documento A4: vendite, preventivi, ordini, fatture e le sezioni che crei tu. Il bottone **Stampa** in testa alla scheda apre l'anteprima. **Stampa o salva PDF** apre la finestra di stampa del browser, e da lì si salva anche il PDF. Il foglio è definito con `@page { size: A4 }`, ha i numeri di pagina e l'intestazione delle righe si ripete su ogni pagina.

Il modello è un dato, salvato in `_meta` alla chiave `documenti.stampa.<entità>`. Si cambia in **Documenti → Modelli di stampa**, con l'anteprima che si aggiorna mentre scrivi.

**Cosa si può cambiare:**

- titolo e colore;
- il destinatario e l'etichetta sopra;
- i dettagli in alto a destra;
- le colonne delle righe: titolo, contenuto, allineamento, ordine;
- il riepilogo IVA;
- se i prezzi comprendono l'IVA;
- note, pagamento e piè di pagina.

**Segnaposto:**

| scrivi | ottieni |
|---|---|
| `{{numero}}`, `{{data}}`, `{{totale}}` | i campi del documento, già formattati (date all'italiana, importi in euro) |
| `{{cliente}}`, `{{cliente.piva}}` | il titolo della riga collegata e i suoi campi |
| `{{azienda.ragione_sociale}}`, `{{azienda.iban}}` | i dati della tua azienda |
| `{{linea.descrizione}}`, `{{linea.quantita}}`, `{{linea.prezzo}}`, `{{linea.sconto}}`, `{{linea.iva}}`, `{{linea.totale}}` | nelle colonne: i valori di ogni riga, già conteggiati |
| `{{riga.campo}}` | nelle colonne: qualsiasi campo della riga così com'è |
| `{{totali.imponibile}}`, `{{totali.imposta}}`, `{{totali.totale}}`, `{{oggi}}` | i totali e la data di oggi |
| `{{#note}}Note: {{note}}{{/note}}` | il pezzo compare solo se il campo ha un valore |
| `{{^scadenza}}Pagamento a vista{{/scadenza}}` | il pezzo compare solo se il campo è vuoto |
| `{{#linee}}…{{/linee}}` | il pezzo si ripete per ogni riga |

Tutto il testo, del modello e dei dati, finisce nel documento come testo: l'HTML scritto da qualcuno non entra mai. Il documento si mostra in un iframe `sandbox` senza script. I campi che un ruolo non vede non escono nemmeno su carta, perché la stampa legge i dati con i permessi di chi stampa.

**L'IVA nei documenti che non sono fatture.** L'aliquota di ogni riga si cerca in quest'ordine:

1. il campo `aliquota` o `iva` della riga;
2. l'`iva` della riga collegata (per esempio l'articolo);
3. l'`iva` del documento (per esempio il preventivo);
4. l'IVA predefinita dell'azienda.

Le vendite al banco hanno i prezzi con l'IVA dentro. Lì il modello predefinito ha «I prezzi comprendono l'IVA», e l'imponibile si ricava per scorporo, aliquota per aliquota.

## Fatture

Il modello **Fatture e fattura elettronica** (`modelli/fatture.json`) si aggiunge a qualsiasi modello di settore e porta tre sezioni: fatture, righe e rate.

- **Il documento:** fattura (TD01), fattura differita (TD24), nota di credito (TD04), nota di debito (TD05) o parcella (TD06).
- **Numero:** lo assegna Kubo quando la fattura esce dalla bozza, cioè quando diventa **emessa**. Il numero conta per serie e per anno, prendendo l'anno dalla data della fattura: una fattura datata 31/12 ed emessa il 2/1 resta nell'anno vecchio. La serie è facoltativa: con la serie `B` i numeri sono `1/B`, `2/B`… Le bozze non hanno numero, così non restano buchi. Un numero scritto a mano viene rifiutato se nello stesso anno e nella stessa serie c'è già.
- **Righe:** descrizione, quantità, prezzo, sconto, aliquota IVA. Con l'IVA a 0 serve la **natura** (N1…N7, con le sottocategorie del 2021).
- **IVA:** si calcola da sola a ogni salvataggio, per aliquota sul totale delle righe e non riga per riga, come vuole la FatturaPA. Tre righe da 0,10 € al 22% fanno 0,07 € di IVA, non 0,06 €.
- **Ritenuta d'acconto:** aliquota, tipo (RT01 o RT02) e causale. Poi il netto a pagare.
- **Bollo virtuale da 2 €:** il controllo avverte se le righe senza IVA superano 77,47 €.
- **Pagamento:** condizioni (completo, a rate, anticipo), modalità (bonifico, contanti, carta, RIBA, SDD, PagoPA), scadenza, rate. «Scaduta» si calcola da sola. Quando la fattura passa a **pagata**, un'automazione segna la data.
- **Regime forfettario (RF19):** le fatture create da Kubo hanno righe a 0 con natura N2.2, e la dicitura di legge va sia in stampa sia nel file XML.

**Crea fattura.** Nella scheda di una vendita, di un preventivo, di una commessa o di qualsiasi sezione collegata ai clienti c'è il bottone **Crea fattura**, che crea una fattura in bozza:

- con lo stesso cliente;
- con le stesse righe: per le vendite al banco i prezzi si scorporano dall'IVA; una commessa diventa una riga sola con il suo prezzo;
- con il riferimento al documento di partenza.

**Nota di credito.** Su una fattura emessa c'è il bottone **Nota di credito**. Crea una nota (TD04) in bozza con le stesse righe e lo stesso cliente, a importi positivi, e la collega alla fattura. Nel file XML la fattura stornata finisce in `DatiFattureCollegate`, con il suo numero e la sua data.

**I clienti.** Se installi il modello delle fatture accanto a un modello di settore, ai clienti si aggiungono i campi per la fattura elettronica: codice fiscale, codice destinatario, PEC, indirizzo, CAP, comune, provincia e nazione. Si aggiungono e basta: nessun valore cambia. Un vecchio campo «Partita IVA / CF» viene letto come partita IVA se ha 11 cifre e come codice fiscale se ha 16 caratteri.

## FatturaPA

Il bottone **FatturaPA** nella scheda di una fattura prima controlla, poi scarica il file. Se manca qualcosa, mostra l'elenco in italiano semplice, per esempio:

- «Manca il codice destinatario del cliente: scrivilo nella sua scheda (oppure la PEC; se non ce l'ha, scrivi 0000000).»
- «Riga 2: IVA a 0 senza natura. Scegli perché non c'è IVA (es. N2.2 forfettario, N4 esente).»
- «La fattura è ancora in bozza: emettila, così prende il suo numero.»

Il file segue la **versione 1.2.2, formato FPR12**, per le fatture tra privati: aziende, professionisti e consumatori.

- Gli elementi sono nell'ordine dello schema XSD.
- Gli importi hanno due decimali. Il riepilogo è per aliquota e per natura, con il riferimento normativo.
- Nei testi restano solo i caratteri che lo SDI accetta: virgolette e trattini tipografici diventano semplici, e € diventa EUR.
- **Il destinatario:**
  - con il codice destinatario: quel codice;
  - con la sola PEC: `0000000` più la PEC;
  - un consumatore con il solo codice fiscale: `0000000`;
  - un cliente estero: `XXXXXXX`.
- Il file si chiama `IT<partita IVA>_<progressivo>.xml`. Il progressivo è di 5 caratteri, in base 36, e cresce a ogni esportazione: anche se riesporti la stessa fattura, il nome non si ripete mai. Lo SDI rifiuta un file con un nome che ha già ricevuto.

I test confrontano il file con un esempio atteso (`test/documenti/fattura-attesa.xml`) e, se sul computer c'è `xmllint`, controllano che sia XML ben formato.

### Come si manda allo SDI

Kubo **non** manda niente allo SDI e non si collega a nessun servizio esterno. Il file va consegnato in uno di questi modi:

1. **Portale «Fatture e Corrispettivi» dell'Agenzia delle Entrate.** È gratuito: si entra con SPID, CIE o CNS e si carica il file XML. La firma digitale non è obbligatoria per le fatture tra privati. Le ricevute (consegna, scarto, mancata consegna) si leggono sul portale.
2. **Un intermediario** (il commercialista o un servizio di fatturazione elettronica). Si carica il file sul loro portale, oppure lo si manda con la loro API o via PEC. Loro lo trasmettono, ti girano le ricevute e di solito pensano anche alla conservazione a norma per 10 anni.
3. **PEC allo SDI.** Si manda il file come allegato all'indirizzo PEC dello SDI (la prima volta `sdi01@pec.fatturapa.it`; poi lo SDI ti assegna il suo). È possibile, ma è comodo solo per pochi invii.

Per un collegamento diretto (canali SDICoop o SFTP) serve l'accreditamento presso l'Agenzia delle Entrate. Il posto giusto è un plugin che legge il file da `POST /api/documenti/fatturapa/:id` e lo passa all'intermediario.

Se lo SDI scarta una fattura, correggila in Kubo ed esportala di nuovo: il file avrà un progressivo nuovo. Lascia la stessa data e lo stesso numero, se la fattura scartata non è mai stata consegnata.

### Cosa non c'è ancora

- Le fatture alla Pubblica Amministrazione: servono il formato FPA12, il codice ufficio di 6 caratteri, il CIG/CUP e la firma.
- L'invio diretto allo SDI, le ricevute dentro Kubo, le fatture passive (quelle che ricevi) e la conservazione a norma.
- Cassa previdenziale, sconti in valore, prezzi unitari con più di due decimali e il cliente persona fisica con Nome e Cognome separati: oggi tutto va in `Denominazione`, che lo SDI accetta.
- Il blocco delle modifiche dopo l'emissione: oggi una fattura emessa si può ancora correggere. Una volta inviata, per correggerla si fa una nota di credito (c'è il bottone).

## API

Tutte le chiamate vogliono l'accesso. Quelle che scrivono vogliono l'intestazione `X-Kubo: 1`.

| metodo e percorso | cosa fa |
|---|---|
| `GET /api/documenti/azienda` · `PUT` | i dati dell'azienda (scrive chi può personalizzare) |
| `GET /api/documenti/logo` · `PUT { dati }` · `DELETE` | il logo come data URL |
| `GET /api/documenti/modelli` | le sezioni stampabili |
| `GET /api/documenti/modelli/:e` · `PUT` · `DELETE` | il modello di stampa di una sezione (`DELETE` torna al predefinito) |
| `GET /api/documenti/stampa/:e/:id` | `{ titolo, html, totali }` del documento |
| `POST /api/documenti/anteprima/:e/:id` | come sopra, con il modello passato nel corpo e non ancora salvato |
| `POST /api/documenti/fattura-da/:e/:id` | crea una fattura in bozza dal documento |
| `POST /api/documenti/nota-di-credito/:id` | crea la nota di credito che storna una fattura emessa |
| `GET /api/documenti/fatturapa/:id` | `{ errori }`: i controlli prima dell'esportazione |
| `POST /api/documenti/fatturapa/:id` | `{ nome, xml }`, oppure 422 con l'elenco di cosa manca |
| `POST /api/documenti/prepara` | aggiunge ai clienti i campi per la fattura elettronica |
