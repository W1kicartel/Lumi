# Il fisco in Kubo

Il titolare deve sapere sempre quanto pagare, quando e con che codice, e avere i file pronti da caricare da solo con SPID. Quando serve davvero un professionista, Kubo lo dice.

**Kubo calcola e prepara; la responsabilità resta del contribuente.** L'avviso è in cima a ogni schermata del fisco, nell'F24 stampato e nel riepilogo del pacchetto.

## Dove sta

| File | Cosa fa |
|---|---|
| `server/moduli/fisco-regole.js` | Le regole, senza database: scadenze (con sabati e festivi), codici tributo, soglie e conti del forfettario, INPS, liquidazione IVA, acconti, bollo virtuale, ritenute, scadenzario. Ogni costante ha la sua fonte in un commento. |
| `server/moduli/fisco-file.js` | La LIPE in XML (specifiche IVP18), l'F24 da stampare, un PDF di testo per il riepilogo. |
| `server/moduli/fisco.js` | Le impostazioni, la lettura dei dati con i permessi di chi chiede, le rotte `/api/fisco/*`, il pacchetto per il commercialista e gli strumenti di Lumi. |
| `web/moduli/fisco.js` e `.css` | La pagina `#/fisco` con le schede. |
| `web/lingue/<codice>/fisco.js` | I testi nelle sei lingue (area `fisco` in `web/lingue/indice.js`). |
| `test/fisco.test.mjs` | Le prove, senza rete. |

## Le impostazioni (`#/fisco/impostazioni`)

Regime (forfettario, semplificato, ordinario; se non è scelto si parte da quello dei dati dell'azienda, RF19 → forfettario), periodicità IVA, codice ATECO con il coefficiente di redditività dell'allegato 4 alla L. 190/2014 (si può correggere a mano), gestione INPS (artigiani, commercianti, gestione separata, cassa professionale, nessuna), riduzione del 35%, aliquota del 5% dei primi cinque anni, e i numeri che Kubo non può sapere: imposta e acconti dell'anno prima, contributi versati, credito IVA dell'anno prima, base dell'acconto IVA, diritto camerale, sede e matricola INPS.

«Prepara» aggiunge due sezioni normali dello schema, che poi si personalizzano come le altre:

- **Fatture ricevute** (`fatture_ricevute`): fornitore, numero, data, data di ricezione, imponibile, aliquota, IVA (vuota: si calcola), percentuale detraibile, pagata il, e per i compensi ai professionisti ritenuta, codice fiscale del percipiente e causale della CU;
- **Corrispettivi** (`corrispettivi`), solo se servono: incasso del giorno IVA compresa e aliquota (l'imponibile si ricava per scorporo).

## Cosa calcola

- **Registri IVA** dalle fatture emesse (non le bozze né le annullate; le note di credito in negativo), dalle fatture ricevute (alla data di ricezione, con la parte detraibile) e dai corrispettivi.
- **Liquidazione** mensile o trimestrale: IVA esigibile e detratta, debito sotto i 100 € riportato (ma pagato entro il 16 dicembre), credito riportato, credito dell'anno prima usato finché c'è, 1% di interessi per i trimestrali (quello del quarto trimestre va nel saldo annuale 6099), acconto di dicembre con il metodo storico o previsionale (88%, il minore; niente sotto 103,29 €), codice tributo e scadenza. Il previsionale lo inserisce chi lo prevede: Kubo usa il calcolo dell'ultimo periodo solo a periodo chiuso, mai i dati parziali. I valori «dell'anno scorso» delle impostazioni (crediti, acconti, imposta, contributi versati) valgono solo per l'anno in cui sono stati salvati (`annoRiferimento`); per gli altri anni Kubo riparte dai dati.
- **LIPE** in XML secondo le specifiche tecniche IVP18 (namespace `urn:www.agenziaentrate.gov.it:specificheTecniche:sco:ivp`): un modulo per mese o per trimestre, importi con la virgola, quarto trimestre dei trimestrali con `Trimestre` 5 e senza interessi né importo da versare. Il file si chiama `IT<codice fiscale>_LI_<progressivo di 5 caratteri>.xml` (per esempio `…_LI_26T10.xml`) e si carica su «Fatture e Corrispettivi» (la guida è nella scheda IVA).
- **Forfettario**: incassato per cassa («Pagata il»; le fatture pagate senza data contano alla data della fattura, e lo dice), reddito = incassato × coefficiente, contributi INPS stimati, imposta sostitutiva al 5% o al 15% sul reddito meno i contributi versati, acconti (niente sotto 51,65 €, unica rata a novembre fino a 257,52 €, poi 50% + 50%) e saldo, soglie 85.000 / 100.000 € con l'avviso dall'80%. La simulazione «se incasso ancora X» dice quante tasse in più e quanto resta in tasca.
- **F24**: per ogni scadenza le righe con sezione, codice tributo o causale INPS, rateazione, anno di riferimento e importo: IVA (6001-6012, 6031-6033, 6099, 6013/6035), imposta sostitutiva (1790, 1791, 1792), contributi INPS (sezione INPS), bollo virtuale (2521-2524, con i rinvii sotto 5.000 €), ritenute (1040, il 16 del mese dopo il pagamento), diritto camerale (3850, sezione tributi locali). Il modello si stampa o si salva in PDF dalla finestra di stampa.
- **Ritenute** come sostituto d'imposta: registro, versamenti, riepilogo per percipiente per la CU e il 770 (i dati, non l'invio).
- **Scadenzario** del regime dell'azienda, con l'importo quando Kubo lo conosce, e un promemoria all'apertura (una volta al giorno) per le scadenze dei prossimi 7 giorni.
- **Pacchetto per il commercialista** (`GET /api/fisco/pacchetto?da=&a=`): uno zip con le copie XML FatturaPA delle fatture emesse (quelle con dati mancanti finiscono in un `DA-SISTEMARE_*.txt`), i registri IVA, le liquidazioni, la prima nota per cassa e le ritenute in CSV ed Excel, il riepilogo in PDF e un LEGGIMI.

## Cosa non fa (e lo dice)

- Non invia niente: LIPE, F24 e dichiarazioni li carica il titolare con le sue credenziali, oppure un intermediario.
- Non calcola IRPEF, IRES e IRAP del regime ordinario o semplificato, né i contributi delle casse professionali.
- Per compensare un credito IVA oltre 5.000 € serve il visto di conformità: con un credito così alto la liquidazione lo segnala.
- Scelta del regime, riduzione INPS, rateazioni, controlli e avvisi sono consulenza: la scheda «Per il commercialista» lo spiega.

## Gli strumenti di Lumi

Con il contratto «strumenti di Lumi dai moduli» (`k.lumi?.strumento(…)`): tutti in sola lettura, con il permesso di leggere le fatture, e ognuno con l'elenco `professionista` di cosa resta da far fare a un professionista.

| Strumento | Domanda |
|---|---|
| `fisco_quanto_pagare` | «quanto devo pagare e quando» |
| `fisco_stima_forfettario` | «stima le tasse del forfettario», anche «se incasso ancora 10.000 €» |
| `fisco_liquidazione_iva` | «liquidazione IVA del trimestre» |
| `fisco_prepara_f24` | «prepara l'F24 di giugno» |
| `fisco_scadenze_mese` | «cosa scade questo mese» |

## Fonti e cose da verificare

Le fonti sono accanto alle costanti in `fisco-regole.js`. Da ricontrollare ogni anno:

- gli importi INPS del 2026 (minimale, contributi fissi, aliquote, massimale) vengono dalla ricerca su Circ. INPS 14/2026 e 8/2026: confrontali con il Cassetto previdenziale;
- la proroga del primo acconto per i forfettari (2026: 20 luglio) è in `PROROGHE_GIUGNO`;
- i coefficienti ATECO restano quelli dell'allegato 4 (codici 2007) finché non esce la tabella per ATECO 2025;
- la rateazione `0101` per 1790 e 1792 in un'unica soluzione; per 1040 il campo resta vuoto;
- il 4 ottobre festa nazionale dal 2026 (per lo slittamento delle scadenze);
- la LIPE segue le specifiche IVP18 lette dal documento ufficiale; lo schema XSD non è nel repository: la prova controlla l'ordine degli elementi e, se c'è `xmllint`, che l'XML sia ben formato. Da ricontrollare sulle specifiche anche la nomenclatura del file. Per la validazione completa scarica `fornituraIvp_2018_v1.xsd` dal sito dell'Agenzia.
