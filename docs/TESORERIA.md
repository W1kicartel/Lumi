# Tesoreria: scadenze, banca e cassa

La tesoreria risponde a tre domande che ogni ufficio si fa ogni settimana:

- chi mi deve pagare e chi devo pagare;
- questi soldi sono arrivati;
- quanta cassa avrò fra un mese.

Prepara anche i file da caricare sull'home banking: Ri.Ba., addebiti SDD e bonifici. È la lacuna numero 1 del [confronto con gli altri gestionali](ricerca/CONFRONTO.md).

## Dove sta

| file | cosa fa |
|---|---|
| `server/moduli/tesoreria-regole.js` | regole senza database: termini di pagamento e rate, punteggio dell'abbinamento, combinazioni di più fatture, livelli dei solleciti e testo della lettera, previsione per periodi, ritardo medio |
| `server/moduli/tesoreria-file.js` | i file della banca: Ri.Ba. CBI, pain.008, pain.001, lettura di CAMT.053, CBI «RH» e CSV/Excel, IBAN e identificativo del creditore SEPA, un piccolo lettore XML |
| `server/moduli/tesoreria.js` | sezioni, impostazioni, scadenzario dai dati (con i permessi di chi chiede), pagamenti, distinte, import dell'estratto, riconciliazione, solleciti, previsione, rotte e strumenti di Lumi |
| `web/moduli/tesoreria.js` e `.css` | la pagina `#/tesoreria` |
| `web/lingue/<codice>/tesoreria.js` | i testi nelle sei lingue (area `tesoreria`) |
| `server/moduli/lingue/<codice>.js` | i messaggi d'errore (chiavi `tes-*`) |
| `test/tesoreria.test.mjs` | le prove, senza rete |

## Lo scadenzario

Le scadenze non si ricopiano in una sezione: si calcolano dalle fatture ogni volta, così non vanno mai fuori sincrono.

- **Attive.** Vengono dalle fatture emesse, inviate o pagate. Le note di credito e le autofatture TD16-TD28 restano fuori, perché non si incassano. L'importo è il netto a pagare, cioè il totale meno la ritenuta. Per trovare le date si guarda, in quest'ordine:
  1. le **rate** della fattura (sezione `rate_fattura`);
  2. la **scadenza** della fattura;
  3. i **termini di pagamento** del cliente;
  4. se non c'è niente di questo, la data della fattura (a vista).
- **Passive.** Vengono dalle fatture ricevute. Per le date si usano la scadenza, poi i termini del fornitore, poi la data.

Ogni scadenza ha una **chiave** stabile:

- `r:<id>` per una rata vera;
- `f:<id>:<n>` per una rata calcolata di una fattura emessa;
- `p:<id>:<n>` per una fattura ricevuta.

**Pagato** vuol dire una di queste tre cose:

- ci sono pagamenti registrati dalla tesoreria (`_tesoreria_pagamenti`, anche parziali);
- la rata è segnata «pagata»;
- il documento è «pagata» (a mano o dall'automazione delle fatture).

Quando tutte le scadenze di un documento sono saldate, la tesoreria lo segna **pagata** con la data dell'ultimo pagamento. Per farlo passa da `dati.js` con il ctx di chi chiede, quindi valgono le regole delle fatture: dopo l'emissione si possono cambiare solo «pagata» delle rate e lo stato. **Annulla** toglie i pagamenti e riapre il documento: una fattura emessa torna «emessa» o «inviata», una ricevuta torna «da pagare».

### Termini di pagamento

Si scrivono nel campo «Termini di pagamento» di clienti e fornitori, come nei gestionali italiani:

| termini | da una fattura del 15/01/2026 |
|---|---|
| `RD` | a vista: 15/01 |
| `30 DF` | 15/02 |
| `30 DFFM` | 28/02 |
| `30/60/90 DFFM` | 28/02, 31/03, 30/04, in tre parti uguali (l'arrotondamento va sull'ultima) |
| `60 DFFM+10` | 10/04 |

I multipli di 30 giorni contano come **mesi commerciali**: 30 giorni dal 15/01 fanno il 15/02, non il 14/02. Gli altri sono giorni di calendario. FM porta alla fine di quel mese, «+10» al giorno 10 del mese dopo. È la convenzione di Danea Easyfatt e di TeamSystem. Se un cliente vuole i giorni di calendario, scrivi per esempio `31 DF`.

## I file per la banca

Le distinte si preparano dallo scadenzario. Spunti le scadenze e scegli **Distinta Ri.Ba.**, **Addebito SDD** o **Bonifici SEPA**. Prima di creare il file Kubo controlla i dati: se manca qualcosa, mostra un elenco come «manca il codice SIA», «Rossi srl: manca l'IBAN della banca d'appoggio» o «manca il mandato SDD». Le scadenze messe in distinta non si mettono in un'altra finché la distinta non è accreditata.

| file | formato | fonte |
|---|---|---|
| Ri.Ba. | CBI, record di 120 caratteri con CR LF: `IB`, poi `14 20 30 40 50 51 70` per ogni ricevuta, poi `EF`. Causale 30000, segno «-», divisa «E», importi in centesimi | standard CBI «Ri.Ba. – Incassi commerciali» (Consorzio CBI); il tracciato coincide record per record con `l10n_it_riba` di OCA (github.com/OCA/l10n-italy) |
| SDD | ISO 20022 `pain.008.001.02`, SEPA Core, un `PmtInf` per data di incasso, `SeqTp` RCUR (si può cambiare nelle impostazioni), BIC facoltativo (`NOTPROVIDED`) | EPC130-08 SDD Core Customer-to-Bank Implementation Guidelines; schema pain.008.001.02 da iso20022.org |
| Bonifici | ISO 20022 `pain.001.001.03`, SEPA Credit Transfer, `ChrgBr` SLEV, un `PmtInf` per data di esecuzione | EPC132-08 SCT Customer-to-Bank Implementation Guidelines; schema pain.001.001.03 |

Le prove controllano:

- la lunghezza e le posizioni di ogni record CBI, e i totali della coda;
- la sequenza degli elementi XML rispetto agli XSD (GrpHdr, PmtInf, DrctDbtTxInf, CdtTrfTxInf);
- i totali (`NbOfTxs`, `CtrlSum`) e i caratteri ammessi da SEPA. Le lettere accentate perdono l'accento, i simboli diventano spazi;
- che l'XML sia ben formato con `xmllint`, quando c'è.

Gli XSD ufficiali non sono nel repository. Per la validazione completa scarica `pain.008.001.02.xsd` e `pain.001.001.03.xsd` da iso20022.org e lancia `xmllint --schema`.

**Cosa serve:**

- **dati dell'azienda:** l'IBAN (Documenti → dati dell'azienda);
- **impostazioni della tesoreria:**
  - il **codice SIA**, che dà la banca, per la Ri.Ba.;
  - l'**identificativo del creditore SEPA** per gli SDD. Kubo propone `IT` + controllo + `ZZZ` + codice fiscale, con le cifre di controllo ISO 7064 mod 97-10 (EPC262-08), ma quello vero lo rilascia la banca;
- **scheda del cliente:** l'IBAN della banca d'appoggio (da lì vengono ABI e CAB della Ri.Ba.), il codice e la data del mandato SDD, la partita IVA o il codice fiscale e l'indirizzo;
- **scheda del fornitore:** l'IBAN, oppure quello scritto nella fattura ricevuta.

**Prepara la tesoreria** aggiunge questi campi ai clienti e ai fornitori, senza toccare quelli che ci sono già.

Quando la banca accredita la distinta, la riconciliazione propone l'accredito come un movimento solo per il totale. Si può anche segnarla accreditata a mano da **Distinte**.

## Estratto conto e riconciliazione

**Banca → trascina il file.** Kubo riconosce il formato dal contenuto:

- **CAMT.053** (`camt.053.001.02` e successive). Entrano solo i movimenti contabilizzati (`Sts` BOOK), con gli storni (`RvslInd`). La controparte è il `Dbtr` delle entrate e il `Cdtr` delle uscite, anche con `Pty` della versione .08. Si leggono l'IBAN della controparte, l'`EndToEndId` e la causale (`Ustrd`, `Strd/CdtrRefInf/Ref`, `AddtlNtryInf`). Il saldo finale `CLBD` diventa il saldo di partenza della previsione, se è più recente di quello che c'è.
- **CBI «RH»** (rendicontazione movimenti di c/c, 120 caratteri). Il record 62 è il movimento, il 63 la descrizione in più, il 61 e il 64 i saldi. Le posizioni vengono dal tracciato CBI: **da ricontrollare su un file vero della propria banca.**
- **CSV o Excel della banca.** Le colonne si riconoscono dal nome: data contabile/operazione, data valuta, importo oppure dare e avere, descrizione o causale, controparte, IBAN, riferimento o CRO. I numeri e le date si leggono all'italiana. Le righe senza data o senza importo (saldi, totali) si scartano e si elencano.

Lo stesso movimento non entra due volte. Si riconosce dall'`AcctSvcrRef` della banca o, se non c'è, da un'impronta di data, importo, descrizione e riferimento.

### La sezione dei movimenti (anche per l'open banking)

I movimenti stanno in una **sezione normale**, `movimenti_banca` («Movimenti di banca»): si vedono, si filtrano, si esportano, hanno i permessi. Un connettore di open banking scrive le righe nella stessa sezione, e la riconciliazione le tratta allo stesso modo. Ecco la forma che si aspetta la tesoreria:

| campo | tipo | obbligatorio | note |
|---|---|---|---|
| `data` | data | sì | data contabile |
| `importo` | valuta | sì | **positivo per le entrate, negativo per le uscite** |
| `descrizione` | testo | consigliato | causale completa: qui si cercano i numeri di fattura |
| `controparte` | testo | no | nome di chi paga o di chi riceve |
| `iban` | testo | no | IBAN della controparte (l'abbinamento più sicuro) |
| `riferimento` | testo | no | EndToEndId, CRO, TRN |
| `id_esterno` | testo | no | id della banca, per non importare due volte |
| `valuta_il`, `conto`, `fonte` | | no | `fonte`: camt053, cbi, csv, openbanking, manuale |
| `stato`, `abbinato` | stato, testo | no | li scrive la tesoreria, se ci sono |

Se un connettore usa una sua sezione con gli stessi id di campo, basta indicarla in **Impostazioni → Sezione dei movimenti di banca**. Lo stato degli abbinamenti la tesoreria lo tiene in `_tesoreria_abbinamenti`, quindi funziona anche con una sezione senza «stato».

### Le proposte

Per ogni movimento da abbinare Kubo cerca fra le scadenze aperte dello stesso verso: un'entrata fra gli incassi, un'uscita fra i pagamenti. Poi dà un punteggio da 0 a 100:

| indizio | punti |
|---|---|
| stesso importo del residuo | 50 (simile entro l'1%: 25; minore: acconto, 5) |
| numero della fattura nella causale («FT 12/2026», «fatt. n.12») | 30 |
| stesso IBAN | 30 |
| nome della controparte nella causale (senza «srl», «spa»…) | 10-20 |
| data entro 10 giorni dalla scadenza | 10 (entro 45: 4) |

Kubo propone anche:

- **più fatture dello stesso cliente** che insieme fanno l'importo, cioè un bonifico che ne paga tre;
- **l'accredito di una distinta** Ri.Ba. o SDD per il totale ancora aperto. Le scadenze che stanno in una distinta si abbinano solo così.

Chi lavora sceglie **Abbina**, oppure abbina a mano dall'elenco, oppure **Ignora** (spese, giroconti, stipendi). Un abbinamento sbagliato si toglie con **Annulla**, che riapre anche le fatture.

Se l'entrata è minore della scadenza, Kubo registra un acconto. Se è maggiore, la scadenza si chiude e Kubo dice quanto avanza.

## Previsione di cassa

**Previsione di cassa**, per 13 settimane o 6 mesi (fino a 52 o 24), mette insieme:

- **il saldo di partenza**, cioè quello delle impostazioni o il `CLBD` dell'ultimo CAMT.053, più i movimenti arrivati dopo quella data;
- **gli incassi aperti**, spostati del **ritardo medio con cui paga ogni cliente**, calcolato sulle sue fatture già pagate (si può spegnere). Quelli già scaduti si contano nel primo periodo;
- **i pagamenti aperti** ai fornitori;
- **le previsioni a mano** della sezione «Previsioni di cassa»: affitto, stipendi, rate del mutuo, con la ripetizione mensile, bimestrale, trimestrale, semestrale o annuale e la data di fine;
- **le tasse**: gli F24 del modulo fisco (IVA, imposta sostitutiva, INPS, ritenute, bollo) di quest'anno e del prossimo, se chi guarda vede le fatture.

La previsione mostra il saldo di ogni periodo e il **punto più basso**, e avvisa se la cassa va sotto zero. Si vede anche da dove viene ogni numero.

## Solleciti

**Solleciti** elenca i clienti con scadenze scadute, dal ritardo più lungo. Il livello si sceglie da solo:

| livello | quando |
|---|---|
| 1, promemoria cortese | dopo 7 giorni |
| 2, sollecito | dopo 30 giorni, o 15 giorni dopo un primo sollecito |
| 3, diffida | dopo 60 giorni, o 15 giorni dopo un secondo sollecito; cita gli interessi di mora del D.Lgs. 231/2002 |

Un cliente sollecitato da meno di 15 giorni aspetta. Il testo è pronto, in italiano, la lingua dei documenti, con l'elenco delle fatture, il totale e l'IBAN. Si può copiare oppure aprire nell'email (`mailto:` alla PEC o all'email del cliente). **Segna come mandato** registra il sollecito, così la volta dopo il livello sale. Kubo non manda niente da solo.

## Rotte

Tutte con la sessione di chi chiede. Si legge se si vedono le fatture emesse o le ricevute. Le impostazioni le cambia solo chi può personalizzare.

```
GET/PUT /api/tesoreria/impostazioni                    sia, bic, idCreditore, saldo, saldoData, sezioneMovimenti, ritardoClienti, sequenzaSdd
POST    /api/tesoreria/prepara                         sezioni «Movimenti di banca» e «Previsioni di cassa», campi di clienti e fornitori
GET     /api/tesoreria/scadenze?verso=attiva|passiva&tutte=1
POST    /api/tesoreria/pagamenti { chiavi, data, importo? }      DELETE /api/tesoreria/pagamenti/:chiave
GET     /api/tesoreria/termini?termini&data&importo
POST    /api/tesoreria/distinte { tipo: riba|sdd|sct, chiavi, data? }   → 422 { errori: [{ chiave, nome, n }] } se mancano dati
GET     /api/tesoreria/distinte · GET /api/tesoreria/distinte/:id/file · POST /api/tesoreria/distinte/:id/incassata { data }
POST    /api/tesoreria/estratto { nome, dati (base64) }
GET     /api/tesoreria/banca
POST    /api/tesoreria/abbina { movimento, chiavi, distinta? } · POST /api/tesoreria/ignora { movimento } · DELETE /api/tesoreria/abbinamenti/:movimento
GET     /api/tesoreria/solleciti · POST /api/tesoreria/solleciti { cliente, livello, chiavi }
GET     /api/tesoreria/previsione?passo=settimana|mese&periodi
```

## Gli strumenti di Lumi

| strumento | tipo | per |
|---|---|---|
| `tesoreria_scadenzario` | leggi | «chi mi deve pagare?», «cosa devo pagare questa settimana?», «scaduti di Rossi» |
| `tesoreria_previsione_cassa` | leggi | «ce la faccio a pagare l'F24 di novembre?», «quanta cassa a fine mese?» |
| `tesoreria_solleciti` | leggi | «chi devo sollecitare?», con il testo pronto |
| `tesoreria_termini` | leggi | «che scadenze danno 30/60/90 DFFM su 3.000 € dal 15 gennaio?» |
| `tesoreria_segna_pagata` | scrivi | «la fattura 12 è stata pagata ieri», anche un acconto; scheda Conferma/Annulla |
| `tesoreria_abbina_movimento` | scrivi | abbina un movimento con la proposta migliore o con le scadenze indicate; scheda Conferma/Annulla |

## Cosa non fa ancora

- Non manda i file alla banca. Si caricano a mano sull'home banking; il collegamento diretto lo daranno i connettori.
- Non gestisce gli insoluti Ri.Ba. con il loro addebito di spese. Per ora si annulla il pagamento della scadenza e la si rimette in una nuova distinta.
- Il formato CBI XML dei bonifici (`CBIPaymentRequest`) non c'è. C'è il pain.001 ISO, che le banche italiane accettano per i bonifici SEPA.
- La prima nota in partita doppia e i conti di banca multipli (un saldo per conto) arrivano con la contabilità.
