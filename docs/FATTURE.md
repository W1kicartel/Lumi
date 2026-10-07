# Fatture elettroniche complete

Il modulo **Fatture** porta a termine quello che [DOCUMENTI.md](DOCUMENTI.md) aveva cominciato. Ogni fattura che un'attività italiana emette o riceve deve essere corretta e passare lo SDI. Le lacune trovate dalla verifica di ottobre 2026 ([ricerca/VERIFICA-DOCUMENTI.md](ricerca/VERIFICA-DOCUMENTI.md)) sono chiuse. I test con lo schema ufficiale, prima segnati «da fare», ora passano tutti.

## Dove sta il codice

| file | cosa fa |
|---|---|
| `server/moduli/documenti-calcoli.js` | i conti: prezzi a 8 decimali, sconti in percentuale e in valore, ritenuta sulle sole righe soggette, cassa previdenziale, bollo, scissione dei pagamenti |
| `server/moduli/documenti-xml.js` | controlli ed esportazione: FPR12 e FPA12, cassa, ritenute RT01-RT06, DDT, CIG e CUP, autofatture TD16-TD19 |
| `server/moduli/documenti.js` | nel suo ascoltatore: blocco dopo l'emissione, conti scritti dal server |
| `server/moduli/fatture-codici.js` | i codici della FatturaPA (casse, ritenute, causali, tipi documento), copiati dallo schema ufficiale |
| `server/moduli/fatture-regole.js` | cosa resta modificabile dopo l'emissione, i buchi nella numerazione, il bollo per trimestre |
| `server/moduli/fatture-p7m.js` | la busta firmata `.p7m` letta con un piccolo lettore ASN.1, senza librerie |
| `server/moduli/fatture-passive.js` | la lettura delle fatture ricevute e la vista leggibile |
| `server/moduli/fatture.js` | le rotte `/api/fatture/*` e l'aggiornamento dei gestionali già installati |
| `web/moduli/fatture.js` e `.css` | la pagina **Fatture elettroniche** e i bottoni nelle schede |
| `web/lingue/<lingua>/fatture.js` | i testi dell'interfaccia nelle sei lingue (area `fatture`) |
| `modelli/fatture.json` | il modello, con le sezioni nuove: DDT, fornitori, fatture ricevute |
| `test/fatture.test.mjs`, `test/prova-documenti-xsd.test.mjs` | i test: motore, API e schema ufficiale |

## I conti

- **Prezzo unitario fino a 8 decimali.** Il campo `prezzo` delle righe ora è un numero, non più una valuta in centesimi: 1.000 viti a 0,125 € fanno 125 €, non 130 €. Il file scrive da 2 a 8 decimali (`Amount8DecimalType`). Il totale di riga si arrotonda al centesimo, l'imposta si calcola una volta sola per aliquota.
- **Sconti.** In percentuale (`sconto`, negativo = maggiorazione) e in euro sul prezzo unitario (`sconto_importo`). Si applicano a cascata, prima la percentuale e poi l'importo, nell'ordine in cui lo SDI li ricontrolla (controllo 00423).
- **Ritenuta d'acconto** solo sulle righe soggette. Le spese anticipate escluse dall'art. 15 (natura N1) non la scontano mai. Una riga si esclude anche a mano, con «Esclusa dalla ritenuta». `Ritenuta=SI` compare solo sulle righe soggette. Ci sono tutti i tipi RT01-RT06 e tutte le causali del modello 770.
- **Cassa previdenziale** (`DatiCassaPrevidenziale`, TC01-TC22):
  - si calcola sui compensi, non sulle spese N1;
  - prende l'IVA delle righe, oppure quella scritta, oppure una natura se è senza IVA;
  - entra nell'imponibile della sua aliquota;
  - la ritenuta si applica anche al contributo solo con la rivalsa INPS 4% (TC22).
- **Bollo da 2 €.** È dovuto sopra 77,47 € di righe con natura N2.1, N2.2, N3.5, N3.6 o N4: sono i criteri dell'«Elenco B» dell'Agenzia delle Entrate (guida *L'imposta di bollo sulle fatture elettroniche*, gennaio 2024). Non si chiede più su esportazioni e cessioni UE (N3.1-N3.4), inversione contabile (N6.x) e N7.
  - Di norma il bollo si addebita al cliente: in fattura compare una riga «Imposta di bollo» da 2 € N1, che entra nel totale.
  - Con «Il bollo lo paghi tu» resta solo `DatiBollo`.
- **Scissione dei pagamenti.** Con `EsigibilitaIVA` S il totale documento comprende l'IVA, ma il cliente paga solo l'imponibile. Con D (IVA per cassa) cambia solo l'esigibilità.

I conti che il server scrive da solo sono l'IVA, la ritenuta e il contributo della cassa. Imponibile, totale e netto sono calcolati dalle formule del modello.

## Fattura emessa = bloccata

Il blocco sta nel motore dei dati, nell'ascoltatore delle scritture (`documenti.js` con `fatture-regole.js`). Vale quindi per l'interfaccia, per le API e per Lumi.

Dopo l'emissione cambiano solo:

- lo stato: emessa → inviata allo SDI → pagata, oppure annullata;
- la data del pagamento e quella dell'invio;
- le note interne;
- le rate segnate come pagate.

Tutto il resto si rifiuta con «La fattura N è emessa: non si modifica più. Correggila con una nota di credito o di debito.»: righe, prezzi, cliente, numero, data, tipo, ritenuta. Il rifiuto vale anche per le righe, le rate e i DDT scritti da soli: dalle API delle sezioni nascoste, dall'import da file, spostando una riga su un'altra fattura o ripristinandone una archiviata.

Una fattura emessa **non si elimina**, perché lascerebbe un buco nella numerazione. Si storna con la nota di credito.

Nella scheda c'è il segno «Emessa · bloccata»: i campi bloccati sono spenti e «Archivia» sparisce.

**Numerazione.** Il numero si dà all'emissione, per serie e per anno della data, e le bozze non lo consumano. `GET /api/fatture/numerazione?anno=` elenca i numeri che mancano in ogni serie. Di solito un buco viene da una fattura riportata a mano. Le autofatture prendono la serie `AF`.

## Tipi di documento

| tipo | cosa |
|---|---|
| TD01 | fattura |
| TD02, TD03 | acconto o anticipo su fattura o su parcella |
| TD04, TD05 | nota di credito e di debito (con `DatiFattureCollegate`) |
| TD06 | parcella |
| TD16-TD19 | integrazioni e autofatture: cedente il fornitore, cessionario tu, niente `DatiPagamento` |
| TD24 | fattura differita, con i DDT citati in `DatiDDT` (sezione «DDT della fattura») |

Gli elenchi di codici sono quelli dello schema 1.2.2. `test/fatture.test.mjs` li confronta con le enumerazioni dello schema.

**TD29** (fattura per comunicare un'operazione senza fattura o irregolare) non c'è nello schema 1.2.2 che i test usano. Si aggiunge quando si aggiorna lo schema in `test/documenti/xsd/`.

Nelle integrazioni il fornitore estero ha `RegimeFiscale` RF18 («altro»). Va verificato con un intermediario prima di affidarcisi su volumi grandi.

## Pubblica Amministrazione

Un cliente italiano con un codice ufficio di 6 caratteri è una PA.

- Il file esce in formato **FPA12**: `versione` e `FormatoTrasmissione`.
- Si sceglie l'esigibilità IVA, di solito S, cioè la scissione dei pagamenti.
- **CIG** (10 caratteri) e **CUP** (15) vanno in `DatiOrdineAcquisto`, `DatiContratto` o `DatiConvenzione`. Il numero e la data del documento sono obbligatori se c'è il CIG o il CUP.

La firma digitale che la PA pretende non la mette Kubo: il file si firma con lo strumento del titolare (CAdES `.p7m`) o lo firma l'intermediario.

## Fatture ricevute

Nella pagina **Fatture elettroniche → Ricevute** si trascinano i file scaricati dal cassetto fiscale o dalla PEC: `.xml` e `.xml.p7m`. Si chiama con `POST /api/fatture/ricevute { nome, dati (base64) }`. Un file entra fino a 3,5 MB: il server accetta richieste fino a 5 MB e il base64 pesa un terzo in più.

- **La busta `.p7m`** (CMS SignedData) si apre con un lettore ASN.1 di poche righe, in `fatture-p7m.js`. Legge:
  - lunghezze definite e indefinite;
  - l'OCTET STRING spezzato in pezzi (BER);
  - i file in base64.

  La firma non si verifica: l'ha già controllata lo SDI. Una firma «staccata», senza il documento dentro, si rifiuta con un messaggio chiaro.
- **La lettura** toglie i prefissi dei namespace e rispetta la codifica dichiarata (UTF-8 o ISO-8859-1). Un file può contenere più fatture e le legge tutte. Rifiuta DTD ed entità esterne e non va mai in rete.
- **Il fornitore** si cerca per partita IVA, poi per codice fiscale. Se non c'è si crea con i dati della fattura. Le fatture già importate (stesso fornitore, numero e data) si saltano.
- **Il costo** finisce nella sezione «Fatture ricevute» con:
  - imponibile, IVA, totale, ritenuta e netto da pagare;
  - la scadenza (la prima rata) e la categoria di costo;
  - lo stato «Da pagare / Pagata», e la data del pagamento si scrive da sola;
  - l'aliquota, quando la fattura ne ha una sola (per il registro IVA acquisti).

  Il file XML resta in `_fatture_xml`.
- **Una sezione sola.** «Fatture ricevute» è la stessa per le fatture e per il fisco (`docs/FISCO.md`): oltre ai campi qui sopra ha quelli del registro IVA acquisti e delle ritenute (aliquota, IVA detraibile %, «registrata il», codice fiscale del percipiente e causale della CU). La sezione che il fisco creava da solo prima dell'unione, con il fornitore scritto a mano, diventa questa con l'aggiornamento del modello: il fornitore passa a «Fornitori» (cercato per partita IVA o per nome, creato se manca) e i valori restano.
- **La vista leggibile** (`GET /api/fatture/ricevute/:id/vista`) è un HTML semplice con ogni valore passato dall'escape. Si mostra in un iframe sandbox e si stampa.
- **Le integrazioni.** Una ricevuta in inversione contabile (N6.x) o da un fornitore estero senza IVA è segnata «Da integrare». Con «Crea integrazione» (`POST /api/fatture/integrazione/:id`) nasce in bozza l'integrazione o autofattura, con l'IVA italiana al 22%. Il tipo dipende dal fornitore:
  - TD16 se è italiano;
  - TD17 per i servizi esteri;
  - TD18 per i beni UE;
  - TD19 per i beni extra UE.

  La controlli e la emetti tu. La data è quella di oggi nel fuso dell'azienda. Emessa (o inviata), l'integrazione va nel registro IVA vendite e la ricevuta nel registro acquisti con la stessa IVA, alla data dell'integrazione: finché non c'è resta fra le «da integrare» del fisco.

## Il bollo virtuale

`GET /api/fatture/bollo?anno=2026` restituisce, per ogni trimestre:

- quante fatture emesse hanno il bollo;
- l'importo da versare;
- la scadenza;
- il codice tributo F24 (2521-2524).

La funzione `bolloAnno(db, { D, P }, anno, ctx)` di `server/moduli/fatture.js` fa lo stesso per gli altri moduli. Il fisco usa la stessa regola (`bolloTrimestri` di `fatture-regole.js`) per le righe 2521-2524 dei suoi F24: la pagina Fatture e l'F24 dicono la stessa cifra con la stessa scadenza, in ogni regime.

Le scadenze sono quelle della guida dell'Agenzia: 31 maggio, 30 settembre, 30 novembre e 28 febbraio (29 negli anni bisestili). Ci sono anche i rinvii per gli importi piccoli: se il 1° trimestre non supera 5.000 € si versa entro il 30 settembre, e se 1° e 2° insieme non li superano, entro il 30 novembre. Le scadenze che cadono di sabato, domenica o festa slittano al primo giorno lavorativo (art. 7 c. 1 lett. h DL 70/2011), con lo stesso calendario del fisco: il 31 maggio 2026 è domenica e diventa il 1° giugno.

## Un gestionale già installato

All'avvio, a chi può personalizzare, l'interfaccia chiede se aggiungere i campi nuovi. Si può fare anche con `POST /api/fatture/aggiorna` o con `POST /api/documenti/prepara`. Si aggiunge e basta:

- sezioni e campi mancanti;
- opzioni mancanti;
- il prezzo delle righe passa da centesimi a euro con 8 decimali, e i valori si convertono;
- la ritenuta diventa un campo vero: le fatture già emesse tengono l'importo con cui sono uscite;
- le sezioni nuove (DDT, fornitori, fatture ricevute) entrano insieme, con l'automazione della data di pagamento;
- prima il bollo non entrava nei totali: le fatture già emesse col bollo prendono «Il bollo lo paghi tu» e il totale resta quello di allora. Le bozze seguono la regola nuova (bollo addebitato al cliente).

I fornitori dei modelli di settore (negozio, officina, ristorante) prendono via, CAP, comune, nazione e PEC.

## Cosa resta fuori

- L'invio allo SDI e le ricevute: servono un intermediario o il portale «Fatture e Corrispettivi».
- La firma digitale delle fatture alla PA.
- La conservazione a norma.
- Gli sconti sul totale documento: si fanno con una riga negativa per aliquota.
- La fattura semplificata TD07, che ha un altro schema (FSM10).
- TD20-TD28.
