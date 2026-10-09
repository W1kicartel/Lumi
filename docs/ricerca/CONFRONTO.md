# Kubo contro i gestionali migliori

Ottobre 2026. Il confronto guarda quello che una piccola o media impresa italiana usa davvero ogni settimana, non l'elenco completo delle funzioni. Kubo è valutato sul codice di questo repository (modelli in `modelli/*.json`, moduli in `server/moduli/`). Gli altri prodotti sono valutati sulle edizioni che una PMI compra di solito:

- **SAP B1**: SAP Business One 10, con la localizzazione italiana;
- **Odoo CE / EE**: Odoo 18 Community ed Enterprise, con la localizzazione `l10n_it` e i moduli OCA per l'Italia;
- **BC**: Microsoft Dynamics 365 Business Central, Essentials/Premium, con la localizzazione IT;
- **Zoho**: Books, Inventory e One;
- **TS / FiC**: TeamSystem (Studio/Enterprise, Lynfa) e Fatture in Cloud;
- **Zucchetti**: Ad Hoc Revolution / Infinity;
- **Danea**: Danea Easyfatt, edizioni Professional ed Enterprise.

Legenda per gli altri prodotti: ● c'è · ◐ in parte, o solo con un modulo o un'app a pagamento · ○ manca.
Per Kubo la colonna dice **c'è**, **parziale** o **manca**, con cosa c'è oggi.

Fonti: le pagine di prodotto e le documentazioni ufficiali, consultate a memoria e ricontrollate nei punti dubbi:

- help.sap.com (B1, *Payment Wizard*);
- odoo.com/documentation (Accounting → Bank reconciliation, Inventory, MRP, Subscriptions) e github.com/OCA/l10n-italy (`l10n_it_riba`, `account_banking_sepa_direct_debit`);
- learn.microsoft.com/dynamics365/business-central (Payment Journals, Bank Reconciliation, Cash Flow Forecast, localizzazione IT con RiBa e bonifici);
- zoho.com/books e zoho.com/inventory;
- fattureincloud.it (scadenzario, riconciliazione bancaria, magazzino);
- danea.it/software/easyfatt (scadenzario, file CBI RiBa e SDD, magazzino con lotti e taglie);
- zucchetti.it (Ad Hoc Revolution, tesoreria e Remote Banking).

Una funzione che esiste solo come app di terze parti è segnata ◐.

## La matrice

| Area | Kubo | SAP B1 | Odoo CE | Odoo EE | BC | Zoho | TS / FiC | Zucchetti | Danea |
|---|---|---|---|---|---|---|---|---|---|
| **Vendite: preventivo → ordine → DDT → fattura** | **parziale**: preventivi (laboratorio, professionista), vendite al banco, «Crea fattura da», fattura differita TD24 con i DDT. Mancano l'ordine cliente con l'evasione parziale, il DDT come documento emesso con la causale del trasporto e la fattura riepilogativa di più DDT | ● | ● | ● | ● | ● | ● / ◐ | ● | ● |
| **Acquisti: RdA, ordine al fornitore, ricevimento, abbinamento con la fattura** | **parziale**: ordini ai fornitori nel modello negozio, carico in un colpo solo, import XML delle fatture ricevute. Mancano i ricevimenti parziali, il confronto ordine-ricevuto-fattura (three-way match) e la proposta di riordino | ● | ● | ● | ● | ● | ● / ◐ | ● | ● |
| **Magazzino: più depositi e trasferimenti** | **manca**: una giacenza per articolo | ● | ● | ● | ● | ● | ● / ◐ | ● | ◐ (Enterprise) |
| **Magazzino: lotti, seriali, scadenze** | **manca**: c'è solo la scadenza degli ingredienti del ristorante | ● | ● | ● | ● | ● | ● / ○ | ● | ● |
| **Magazzino: inventario fisico e rettifiche** | **manca** | ● | ● | ● | ● | ● | ● / ◐ | ● | ● |
| **Magazzino: valorizzazione (costo medio, FIFO, LIFO)** | **manca** | ● | ● | ● | ● | ◐ | ● / ○ | ● | ● |
| **Riordino sotto scorta** | **parziale**: il campo calcolato «da riordinare», senza proposta né ordine automatico | ● | ● | ● | ● | ● | ● / ◐ | ● | ● |
| **Produzione e distinta base** | **manca**: il laboratorio ha i consumi della commessa | ● | ● | ● | ◐ (Premium) | ◐ | ● / ○ | ● | ◐ |
| **POS e cassa con registratore telematico** | **parziale**: vendite al banco, PIN rapido, corrispettivi scritti a mano. Mancano il driver del registratore telematico e il documento commerciale | ◐ | ◐ | ● (Odoo IT con RT tramite partner) | ◐ | ◐ | ● (TS Retail) / ◐ | ● | ● (Easyfatt con RT) |
| **CRM: pipeline e opportunità** | **parziale**: clienti, provenienza, kanban su qualsiasi stato, agenda. Mancano l'entità «opportunità» con probabilità e valore pesato e le attività di vendita | ● | ● | ● | ◐ | ● | ◐ | ● | ○ |
| **Commesse, progetti, timesheet e margini** | **c'è** (nei modelli laboratorio e professionista): ore, materiali, costo e margine. Mancano l'avanzamento a SAL e la fatturazione delle ore | ● | ● | ● | ● | ● | ● | ● | ◐ |
| **Abbonamenti e fatturazione ricorrente** | **parziale**: abbonamenti della palestra e pacchetti, senza fatture create da sole | ◐ | ○ | ● | ◐ | ● | ● / ● | ● | ◐ |
| **Scadenzario clienti e fornitori, rate, termini (30/60/90 gg DF FM)** | **parziale**: scadenza e rate sulla fattura, «scaduta» calcolata. Mancano i termini di pagamento che generano le rate, lo scadenzario unico (attivo e passivo) e i solleciti | ● | ◐ | ● | ● | ● | ● | ● | ● |
| **Ri.Ba. in formato CBI** | **manca** | ● | ◐ (OCA) | ◐ (OCA) | ● (loc. IT) | ○ | ● | ● | ● |
| **SEPA Direct Debit (pain.008)** | **manca** | ● | ◐ (OCA) | ● | ● | ○ | ● | ● | ● |
| **Bonifici SEPA (pain.001 / CBI)** | **manca** | ● | ◐ | ● | ● | ◐ | ● | ● | ● |
| **Import dell'estratto conto (CAMT.053, CBI, CSV) e riconciliazione** | **manca**: nel giro 4 un'altra squadra porta i movimenti dall'open banking | ● | ◐ | ● | ● | ● | ● (open banking) | ● | ◐ |
| **Previsione di cassa (cash flow)** | **manca**: il fisco sa le scadenze delle tasse, ma niente le mette insieme agli incassi | ◐ | ○ | ◐ | ● | ● | ● | ● | ◐ |
| **Prima nota e contabilità generale** | **parziale**: registri IVA, liquidazioni, prima nota per cassa nel pacchetto per il commercialista. Manca la partita doppia | ● | ● | ● | ● | ● | ● | ● | ◐ |
| **Centri di costo e contabilità analitica** | **manca** | ● | ● | ● | ● (dimensioni) | ◐ (tag) | ● / ○ | ● | ○ |
| **Più aziende e più valute** | **parziale**: una valuta di visualizzazione, un'azienda per database | ● | ● | ● | ● | ● | ● / ◐ | ● | ◐ |
| **Personale: presenze, ferie, note spese** | **manca** | ◐ | ● | ● | ◐ | ◐ (Zoho People) | ● (HR) | ● | ○ |
| **Helpdesk e ticket** | **parziale**: si costruisce con «Personalizza». L'officina ha gli interventi. Mancano gli SLA e la posta in arrivo che diventa ticket | ◐ | ○ | ● | ○ | ● (Desk) | ◐ | ◐ | ○ |
| **Portale per clienti e fornitori** | **manca** | ◐ | ● | ● | ◐ | ● | ◐ | ● | ○ |
| **Fidelity e buoni regalo** | **manca** | ○ | ◐ | ● | ○ | ◐ | ◐ | ◐ | ◐ |
| **BI e report** | **parziale**: cruscotto, liste con totali e raggruppamenti, export in Excel, Lumi che risponde a parole | ● | ◐ | ● | ● (Power BI) | ● (Analytics) | ● | ● | ◐ |
| **Archivio documentale** | **parziale**: allegati, file nelle schede, pacchetto zip. Mancano le versioni, il protocollo e la conservazione sostitutiva | ◐ | ◐ | ● | ◐ | ● | ● (conservazione) | ● | ◐ |
| **Italia: FatturaPA, SDI, IVA, LIPE, F24, bollo, ritenute** | **c'è**: FatturaPA 1.2.2 provata sugli XSD, fatture passive da p7m, TD16-19, LIPE, F24, forfettario, ritenute | ● (partner) | ◐ (OCA) | ● | ● (loc.) | ◐ | ● | ● | ● |
| **Italia: conservazione sostitutiva, esterometro, Intrastat, CU/770** | **parziale**: dati per CU e 770; conservazione con un connettore SDI | ◐ | ◐ | ◐ | ◐ | ○ | ● | ● | ◐ |
| **Assistente AI che agisce sui dati, con conferma** | **c'è**: Lumi, con strumenti dei moduli e la scheda Conferma/Annulla | ◐ (Joule) | ○ | ◐ | ◐ (Copilot) | ◐ (Zia) | ◐ | ◐ | ○ |
| **Personalizzazione senza codice e open source** | **c'è**: schema come dato, MIT, dati in locale | ○ | ● (codice) | ◐ (Studio) | ◐ | ◐ | ○ | ○ | ○ |

### Dove Kubo è già davanti

L'assistente Lumi che agisce sui dati, sempre dopo un «Conferma»; lo schema che si cambia senza codice e senza perdere dati; il fisco del forfettario e dell'ordinario con F24 e LIPE pronti; i dati sul PC dell'azienda, senza canone.

### Dove un'azienda italiana ci lascerebbe oggi

Nella tesoreria. Ri.Ba., SDD, bonifici, estratto conto e scadenzario sono il lavoro di ogni lunedì in ufficio. Danea e Fatture in Cloud ce l'hanno da anni, e lì si fa il confronto.

Subito dopo vengono il ciclo degli acquisti e il magazzino vero: depositi, lotti e inventario.

## Le 10 lacune più importanti per una PMI italiana

1. **Scadenzario con incassi e pagamenti, termini di pagamento e solleciti.** Ogni azienda guarda ogni settimana chi deve pagare e chi deve essere pagato. Senza scadenzario un gestionale resta un programma di fatture.
2. **File per la banca: Ri.Ba. CBI, SEPA Direct Debit (pain.008), bonifici SEPA (pain.001).** In Italia la Ri.Ba. è ancora il modo normale per incassare dai clienti B2B. Senza il file da caricare sull'home banking si ricopia tutto a mano, e Danea, TeamSystem e Zucchetti lo fanno da sempre.
3. **Import dell'estratto conto (CAMT.053, CBI, CSV) e riconciliazione.** Segnare a mano «pagata» fattura per fattura è il lavoro più noioso dell'ufficio. Con l'abbinamento proposto si chiude in pochi minuti, e i movimenti dell'open banking (un'altra squadra) finiscono nello stesso posto.
4. **Previsione di cassa.** «Fra 60 giorni ho i soldi per l'F24 e gli stipendi?» è la domanda del titolare. I dati per rispondere ci sono già (scadenze, rate, tasse del fisco), ma niente li mette insieme.
5. **Acquisti completi: dall'ordine al fornitore al ricevimento parziale, poi l'abbinamento con la fattura passiva e la proposta di riordino.** Chi compra merce deve sapere cosa è arrivato e se la fattura corrisponde. Oggi il carico avviene in un colpo solo.
6. **Magazzino avanzato: più depositi, trasferimenti, lotti, seriali e scadenze, inventario fisico, costo medio o FIFO.** Alimentari, cosmetica, ricambi ed elettronica hanno bisogno della tracciabilità dei lotti. Il bilancio vuole il magazzino valorizzato.
7. **Ciclo di vendita a documenti: ordine cliente, DDT con la causale del trasporto, fattura differita riepilogativa, evasione parziale.** È il flusso del commercio all'ingrosso e dell'artigiano che consegna. Oggi la fattura nasce da un documento solo.
8. **Contratti ricorrenti con fatture automatiche** (canoni, manutenzioni, abbonamenti). Fanno ricavi fissi senza lavoro manuale. Tutti i concorrenti li hanno, Kubo no.
9. **CRM con pipeline di opportunità** (valore, probabilità, fase, attività). Serve a chi vende servizi o fa preventivi, per sapere cosa entrerà. È un modello di settore più che codice: si fa presto.
10. **Cassa touch con registratore telematico e documento commerciale.** Negozi, bar e ristoranti devono trasmettere i corrispettivi. Senza il collegamento al registratore telematico Kubo non può sostituire la cassa.

Poi vengono la contabilità analitica per centri di costo, le presenze e le note spese, il portale clienti, la distinta base con la produzione, l'helpdesk con gli SLA, la fidelity e la gestione di più aziende.

## Cosa è stato costruito in questo giro (giro 4, squadra «confronto»)

La matrice qui sopra descrive Kubo **prima** di questo giro. Questo giro ha chiuso le lacune dalla 1 alla 5 e una parte della 6:

| lacuna | modulo | adesso |
|---|---|---|
| 1. Scadenzario, termini, solleciti | Tesoreria ([TESORERIA.md](../TESORERIA.md)) | **c'è**: scadenze attive e passive dalle fatture, termini all'italiana (30/60/90 DFFM, +10), acconti, solleciti a tre livelli con il testo pronto |
| 2. Ri.Ba., SDD, bonifici | Tesoreria | **c'è**: Ri.Ba. CBI a 120 caratteri, pain.008.001.02, pain.001.001.03, con i controlli dei dati prima del file |
| 3. Estratto conto e riconciliazione | Tesoreria | **c'è**: CAMT.053, CBI «RH», CSV/Excel; proposte per importo, numero, IBAN, nome, data, somme di più fatture e accrediti di distinta; la sezione dei movimenti è la stessa dell'open banking |
| 4. Previsione di cassa | Tesoreria | **c'è**: settimane o mesi, ritardo medio di ogni cliente, previsioni ricorrenti a mano, F24 del modulo fisco |
| 5. Acquisti | Acquisti ([ACQUISTI.md](../ACQUISTI.md)) | **c'è**: riordino sotto scorta, ordini per fornitore, ricevimenti parziali con costo medio ponderato, confronto ordinato/ricevuto/fatturato |
| 6. Magazzino avanzato | Magazzino ([MAGAZZINO.md](../MAGAZZINO.md)) | **parziale**: registro dei movimenti, valore al costo, inventario fisico con lettore e rettifiche. Mancano più depositi, lotti/seriali/scadenze e FIFO |

Per il giro dopo, nell'ordine: il resto della 6 (depositi, lotti), poi la 7 (ordine cliente → DDT → fattura riepilogativa), la 8 (contratti ricorrenti), la 9 (pipeline CRM) e la 10 (cassa con registratore telematico).
