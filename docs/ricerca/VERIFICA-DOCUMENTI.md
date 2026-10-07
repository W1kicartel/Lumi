# Kubo + Lumi può sostituire il commercialista per i documenti? Verifica pratica

Data: 7 ottobre 2026. Ho lavorato su una copia: worktree `prova-documenti` da `main` (c56ee89). `~/Desktop/kubo` non è stato toccato. Worktree e ramo sono stati tolti alla fine e non c'è nessun commit.

I test scritti sono in `scratchpad/test-documenti/`:

- `prova-documenti-xsd.test.mjs`: 18 test. 10 passano e 8 sono `todo`, cioè lacune dimostrate.
- `prova-lumi-documenti.test.mjs`: 5 test. 4 passano e 1 è `todo`.
- `documenti/xsd/`: lo schema ufficiale e xmldsig.

Per rieseguirli bisogna copiarli in `test/` di Kubo. I file XML generati sono in `scratchpad/xml-generati/`.

Le suite esistenti `documenti.test.mjs` e `lumi.test.mjs` passano tutte, 20 su 20.

**Risposta breve: no, non ancora.** Per le fatture «normali» tra privati in regime ordinario o forfettario, Kubo produce un file FatturaPA **valido contro lo schema XSD ufficiale 1.2.2**, coerente con i controlli aritmetici dello SDI. Lumi riesce già a crearlo a parole, ma solo in bozza. Mancano però:

- casi interi: PA, cassa previdenziale, autofatture;
- due errori di calcolo o di controllo;
- tutto il ciclo passivo e la contabilità (registri IVA, liquidazione, F24).

Lumi poi non ha strumenti dedicati ai documenti: fa le fatture con gli strumenti generici, senza controlli fiscali prima della conferma.

---

## 1. Inventario: cosa produce Kubo oggi

Fonti: `server/moduli/documenti*.js`, `modelli/fatture.json`, `docs/DOCUMENTI.md`.

| Voce | Stato | Dettaglio |
|---|---|---|
| Fattura TD01 | **fatto** | numero all'emissione, per anno e serie; niente doppioni |
| Nota di credito TD04 | **fatto** | bottone e rotta `POST /api/documenti/nota-di-credito/:id`; `DatiFattureCollegate` nell'XML |
| Nota di debito TD05 | fatto (base) | solo il tipo |
| Fattura differita TD24 | **parziale** | c'è il tipo, ma l'XML non scrive `DatiDDT`, cioè gli estremi dei DDT che la differita deve citare |
| Parcella TD06 | fatto (base) | solo il tipo |
| Acconto TD02, semplificata TD07 | **manca** | |
| Autofatture e integrazioni TD16-TD19, TD20, TD21, TD27 | **manca** | Per TD16-19 il cedente dev'essere il fornitore estero, mentre `xml()` mette sempre la tua azienda |
| Nature IVA N1…N7, con le sottocategorie 2021 | **fatto** | riepilogo per aliquota e natura con `RiferimentoNormativo` |
| Split payment (`EsigibilitaIVA` S) | **manca** | scrive sempre `I` |
| IVA per cassa (`EsigibilitaIVA` D) | **manca** | |
| Ritenuta d'acconto | **parziale** | RT01/RT02 con causale. Si calcola su **tutto** l'imponibile, comprese le spese N1 escluse art. 15 (bug, vedi 2b), e `Ritenuta=SI` finisce su ogni riga. Mancano RT03-RT06 (INPS, Enasarco, ENPAM) |
| Cassa previdenziale | **manca** | nessun campo e nessun `DatiCassaPrevidenziale`. L'INPS 4% e le casse professionali non si possono fatturare |
| Bollo virtuale 2 € | **parziale** | `DatiBollo` corretto. Il controllo però lo pretende su **ogni** riga a IVA 0 sopra 77,47 €, anche N3.1, N3.2 e N6, dove non è dovuto, e **blocca l'esportazione** finché non lo spunti (vedi 4c). Il bollo rifatturato non entra nel totale |
| Regime forfettario RF19 | **fatto** | righe N2.2 e la dicitura «Operazione in franchigia… L. 190/2014» sia nell'XML sia in stampa; controllo dell'IVA |
| Esportazione XML FatturaPA | **fatto** per FPR12 | nome `IT<piva>_<progr>.xml`, progressivo d'invio mai ripetuto. **FPA12 manca** (PA, CIG/CUP, firma) |
| Clienti esteri | **fatto** | `XXXXXXX`, `IdFiscaleIVA` del paese, CAP `00000` fuori dall'Italia |
| Privato con solo codice fiscale | **fatto** | `0000000` più `CodiceFiscale` |
| Sconti | **parziale** | solo in percentuale per riga (anche maggiorazioni). Niente sconti in valore né a piede |
| Prezzi unitari con più di 2 decimali | **manca** | il prezzo si arrotonda al centesimo: 1000 × 0,125 € diventa 130 € (vedi 8b) |
| Numerazione | **fatto** | per anno della data e per serie, niente buchi (le bozze non hanno numero) |
| Blocco dopo l'emissione | **manca** | una fattura emessa si modifica ancora, anche da Lumi |
| Stampe e PDF | **fatto** | modello A4 personalizzabile per ogni sezione con righe, riepilogo IVA e dicitura del forfettario; il PDF passa dalla finestra di stampa del browser |
| Invio allo SDI e ricevute | **manca** (per scelta) | si carica il file su «Fatture e Corrispettivi» o dall'intermediario |
| Fatture passive (import XML/P7M dal cassetto fiscale o dallo SDI) | **manca** | l'import legge solo CSV e XLSX |
| Registri IVA vendite e acquisti | **manca** | |
| Liquidazione IVA mensile o trimestrale, LIPE | **manca** | |
| Prima nota e contabilità | **manca** | |
| Scadenzario | **parziale** | solo crediti: scadenza, rate, «scaduta», «Da vedere». Niente debiti verso i fornitori |
| F24 | **manca** | |
| Corrispettivi telematici (RT) | **manca** | |
| Riepiloghi per il commercialista | **parziale** | esporti l'elenco delle fatture in CSV o XLSX e Lumi fa `riepilogo` per periodo. Niente pacchetto ZIP degli XML del periodo né registro IVA |
| Conservazione a norma | **manca** | si delega all'Agenzia (servizio gratuito) o all'intermediario |

## 2. Il file XML è valido? Prove con lo schema ufficiale

**Schema:** scaricato con curl da `https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.2.2/Schema_del_file_xml_FatturaPA_v1.2.2.xsd`. Il download è riuscito: 68.110 byte, `version="1.2.2"`, sha256 `cedaeece…7e18`.

L'import di `xmldsig-core-schema.xsd` è stato scaricato da w3.org e reso locale. La validazione usa `xmllint --noout --nonet --schema`, con libxml 2.9.13.

Oltre allo schema, il test applica i **controlli di coerenza dello SDI**, riscritti in piccolo:

- 00400, 00401, 00429, 00430: natura e aliquota;
- 00411: ritenuta;
- 00417: identificativo del cliente;
- 00419: un riepilogo per ogni aliquota;
- 00421: imposta;
- 00422: imponibile contro le righe;
- 00423: prezzo totale con sconti;
- 00427: lunghezza del codice destinatario.

| Caso | Schema XSD | Controlli SDI | Note |
|---|---|---|---|
| File atteso dei test di Kubo (`fattura-attesa.xml`) | valido | — | I test di Kubo controllavano solo che fosse XML ben formato, mai lo schema |
| 1. Forfettario RF19, N2.2, bollo, dicitura | **valido** | ok | `controlla()` avverte se manca il bollo o se c'è l'IVA |
| 1b. Bollo rifatturato nel totale | — | — | todo: il totale e il netto non includono i 2 € |
| 2. Professionista con ritenuta 20% RT01/A e riga spese N1 | **valido** | ok | |
| 2b. Ritenuta solo sui compensi | — | — | **bug**: 210 € invece di 200 €. Il file resta valido e passa lo SDI, ma l'importo è sbagliato |
| 2c. Cassa previdenziale | — | — | **manca** |
| 3. Nota di credito TD04 collegata | **valido** | ok | `DatiFattureCollegate` con numero e data |
| 4. Cliente UE (DE, N3.2) ed extra UE (US, N3.1), `XXXXXXX` | **valido** | ok | ma vedi 4c |
| 4c. Bollo su N3.1, N3.2, N6 | — | — | **bug**: `controlla()` lo pretende e blocca l'esportazione |
| 5. PA (codice ufficio di 6 caratteri) | valido se forzato | **00427: scarto** | Kubo si ferma prima, giustamente («serve FPA12») |
| 5b. FPA12, split payment, CIG/CUP | — | — | **manca** |
| 6. Privato con solo codice fiscale | **valido** | ok | |
| 7. Sconti 10%, 33,33%, maggiorazione 15%, quantità 2,5 | **valido** | ok | |
| 7b. Sconto in valore o a piede | — | — | manca |
| 8. 300 righe, aliquote 22/10/5/4/0 (N4), sconti, quantità decimali | **valido** | ok | IVA calcolata per aliquota, mai riga per riga |
| 8b. Prezzo unitario 0,125 € | — | — | **errore di importo**: arrotonda al centesimo |
| 9. Tipi TD02, TD07, TD16-19 | — | — | mancano nel modello |
| 10. Controprova: date sbagliate, ordine degli elementi, natura N9 | **rifiutato** | — | la validazione XSD morde davvero |

**Esito:** tutti i file che Kubo accetta di esportare sono validi contro lo schema ufficiale 1.2.2 e superano i controlli aritmetici dello SDI.

Non ho potuto provare le **altre** verifiche dello SDI che richiedono i suoi archivi: partita IVA esistente in Anagrafe tributaria, codice destinatario registrato, file già ricevuto. Lì l'unica prova vera è il caricamento su «Fatture e Corrispettivi».

## 3. Lumi riesce a farli a parole?

La prova usa un finto Claude locale, come `test/lumi.test.mjs`. Il percorso è quello reale:

- la richiesta passa dal vero `POST /api/lumi`, cioè dal proxy e dal nucleo;
- gli strumenti sono quelli **veri**, generati dallo schema con `modelli: professionista + fatture`;
- il giro è quello del motore: proponi, conferma, esegui, `tool_result`.

**Cosa vede Lumi:** 28 strumenti. Per i documenti ci sono solo i generici `cerca_`, `leggi_`, `crea_` e `modifica_` su `fatture` e `clienti`. Gli strumenti **dedicati ai documenti sono zero**: emetti, nota di credito, FatturaPA/XML, stampa/PDF, controlla. Lo schema passa il limite del server di Lumi (al massimo 128 strumenti e 12.000 caratteri).

**«fai una fattura a Rossi Srl per 3 ore di consulenza a 80 euro più IVA»: riesce.**

1. `cerca_clienti`, poi `crea_fatture` con `{ cliente: "Rossi Srl", righe: [{ quantita: 3, prezzo: 80, aliquota: 22 }] }`. Il risultato è una fattura **in bozza** da 240 € + 52,80 € di IVA = 292,80 €, con l'IVA ricalcolata dal server.
2. «emettila»: `modifica_fatture { stato: "emessa" }`. Il numero lo assegna Kubo.
3. «mandami l'XML»: **nessuno strumento**. Bisogna premere il bottone FatturaPA. Il file che esce dai dati scritti da Lumi è comunque **valido contro l'XSD** (verificato nel test).

**«fai la nota di credito della fattura 12»: riesce solo se il modello «indovina» la ricostruzione.**

Senza uno strumento dedicato, il modello deve:

1. trovare la fattura con `cerca_fatture` (numero = 12);
2. leggerla;
3. creare a mano una `crea_fatture` con `tipo: TD04`, `collegata`, le stesse righe, la stessa ritenuta e lo stesso cliente.

Se lo fa giusto, il risultato coincide con quello del bottone (tipo, totale, ritenuta e imposta confrontati nel test). Se dimentica `collegata` o la ritenuta, nessuno lo ferma. La rotta `POST /api/documenti/nota-di-credito/:id` esiste, ma Lumi non la vede.

**Rischi dimostrati:**

- **La scheda di conferma non mostra gli importi.** La persona conferma vedendo `[Documento: Fattura] [Cliente: Rossi Srl] [Data] [Righe: 1 riga]`, senza prezzi, IVA né totale (todo).
- **Nessun controllo fiscale prima della conferma.** Lumi crea ed emette una fattura con IVA 0 e senza natura; l'errore esce solo all'esportazione.
- **Una fattura emessa si cambia a parole** (il prezzo passa da 100 a 150), senza nota di credito.
- **Il numero si può scrivere a mano.** Kubo rifiuta solo i doppioni dello stesso anno, e questo è un controllo buono.

**Cosa manca perché Lumi lo faccia davvero:**

- strumenti dedicati, ognuno con proposta e conferma:
  - `emetti_fattura`;
  - `nota_di_credito(fattura)`, che usa la rotta esistente;
  - `fattura_da(documento)`;
  - `controlla_fattura`, che espone `GET /api/documenti/fatturapa/:id`;
  - `esporta_fatturapa`, che consegna il file e rispetta il potere «fatturapa» del ruolo;
  - `stampa_documento`, che apre l'anteprima o il PDF;
- `controlla()` già nella **proposta**, così la scheda mostra gli errori prima del sì;
- una scheda di conferma con righe, imponibile, IVA, ritenuta, netto e il regime;
- istruzioni di sistema sulle regole fiscali (natura con IVA 0, forfettario, ritenuta);
- il blocco della modifica dopo l'emissione.

## 4. Conclusione

| Documento | Stato |
|---|---|
| Fattura ordinaria B2B o B2C (TD01, FPR12) | **fatto e valido** (XSD ufficiale + controlli SDI) |
| Fattura del forfettario con bollo e dicitura | **fatto e valido** |
| Nota di credito TD04 | **fatto e valido**; da Lumi solo «ricostruita» a mano |
| Cliente estero UE o extra UE | **fatto e valido**, ma il bollo viene preteso a torto |
| Privato con codice fiscale | **fatto e valido** |
| Sconti in percentuale e arrotondamenti su molte righe | **fatto e valido** |
| Professionista con ritenuta | **parziale**: il file è valido, ma la ritenuta è sbagliata con spese N1 e manca la cassa |
| Fattura differita TD24 | **parziale**: mancano i DDT |
| Stampa e PDF | **fatto**, ma non da Lumi |
| Prezzi con 3 o più decimali, sconti in valore | **manca** (con errore d'importo) |
| PA (FPA12, split payment, CIG/CUP) | **manca** (Kubo blocca correttamente) |
| Autofatture TD16-19, acconto, semplificata | **manca** |
| Fatture passive, registri IVA, liquidazione, prima nota, F24, corrispettivi | **manca** |
| Lumi «a parole» | **parziale**: crea ed emette fatture con strumenti generici; non esporta, non stampa, non storna con la rotta dedicata, non controlla prima della conferma |

### Cosa costruire, in ordine

1. **Correggere i due errori di calcolo e di controllo.**
   - Ritenuta solo sulle righe soggette, con un flag per riga e `Ritenuta=SI` solo lì.
   - Bollo non preteso su N3.1, N3.2, N3.3, N3.4 e N6.x.
   - Prezzo unitario fino a 8 decimali (`Amount8DecimalType`).
2. **Blocco dopo l'emissione.** Una fattura emessa o inviata non si modifica più: si corregge con una nota di credito. Lo stato «inviata» va registrato con la data e il nome del file.
3. **Strumenti Lumi dedicati** con controllo e scheda completa: emetti, nota di credito, controlla, esporta FatturaPA, stampa/PDF, più le istruzioni fiscali nel prompt.
4. **Validazione XSD nei test di Kubo**, con lo schema ufficiale versionato in `test/documenti/xsd/`, come fatto qui.
5. **Professionisti**: `DatiCassaPrevidenziale` (TC01-TC22, con l'aliquota IVA della cassa e la ritenuta sulla cassa), RT03-RT06, `DatiDDT` per TD24, rivalsa del bollo nel totale.
6. **Tipi mancanti**: TD02, TD07, TD16-TD19 (autofattura reverse charge e integrazione, con il fornitore come cedente) e TD20.
7. **PA**: FPA12, codice ufficio, CIG/CUP, split payment, firma digitale (CAdES `.p7m`, con un certificato del titolare).
8. **Ciclo passivo**: import degli XML e P7M ricevuti dal cassetto fiscale, fornitori, scadenzario dei debiti.
9. **Per il commercialista**: registri IVA vendite e acquisti, riepilogo della liquidazione periodica, ZIP degli XML del periodo, CSV della prima nota.
10. **Facoltativo**: invio allo SDI tramite un intermediario accreditato (plugin che usa `POST /api/documenti/fatturapa/:id`) e ricevute dentro Kubo.

### Cosa resta comunque fuori: per legge o perché serve un soggetto abilitato

- **Trasmissione allo SDI**: la puoi fare da solo dal portale «Fatture e Corrispettivi» (SPID/CIE). Un canale diretto SDICoop o SFTP richiede l'accreditamento all'Agenzia: nella pratica serve un intermediario.
- **Conservazione a norma per 10 anni**: con il servizio gratuito dell'Agenzia (adesione) o con un conservatore accreditato, non dentro Kubo.
- **Dichiarazioni** (IVA annuale, Redditi, IRAP, 770, Certificazione Unica, LIPE) e **invio telematico** dell'F24 con compensazioni: la trasmissione è riservata agli intermediari abilitati (art. 3 c.3 DPR 322/98), cioè commercialisti, CAF e consulenti del lavoro. In alternativa le invii da solo con le tue credenziali Entratel/Fisconline. Kubo può prepararne i dati, ma non è un intermediario.
- **Responsabilità e scelte fiscali**: regime, natura e qualifica delle operazioni, dichiarazioni d'intento, ravvedimenti, bilancio delle società di capitali. Un software, Lumi compreso, può proporre ma non firma e non risponde. Il contribuente resta responsabile di quello che emette.

**In una riga:** per **emettere** fatture ordinarie e del forfettario, Kubo è già affidabile (file valido contro lo schema ufficiale). Lumi ci arriva a metà: crea ed emette, ma non esporta e non controlla. «Non mi serve il commercialista per i documenti» è raggiungibile con i punti 1-6. Per la contabilità e le dichiarazioni il commercialista, o un intermediario, resta necessario per legge o per competenza.
