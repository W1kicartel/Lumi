# Kubo / Lumi può sostituire il commercialista nella produzione dei documenti?

Ricerca del 7 ottobre 2026: regole in vigore nel 2026, verificate sul web. Le fonti sono in fondo e accanto alle voci. Dove una data o una cifra non l'ho confermata su una fonte primaria lo dico esplicitamente con **[da verificare]**.

## 0. Risposta breve

**Sì per gran parte della produzione e no per la responsabilità.** Un gestionale che ha già fatture, incassi, acquisti e corrispettivi può produrre da solo, in modo corretto e pronto da inviare, circa il **70-80% dei documenti** che oggi passano dal commercialista per una ditta forfettaria o semplificata:
- le fatture XML con bollo, ritenute, cassa, reverse charge e note di credito;
- i registri IVA;
- le liquidazioni IVA;
- gli F24 con i codici tributo;
- il calcolo di imposta sostitutiva, INPS, acconti e saldi;
- le LIPE.

Il titolare può poi inviare quasi tutto da solo con SPID, senza intermediario: fatture via SDI, LIPE e F24 dal sito dell'Agenzia, dichiarazione IVA e Redditi PF via Fisconline o con la precompilata web.

Restano fuori tre cose:
1. Quello che la legge riserva a un professionista: il visto di conformità sopra soglia, le asseverazioni, la revisione legale e la difesa tributaria sopra i 3.000 €.
2. Il **ruolo di intermediario Entratel**: un software non può inviare *per conto* del cliente le dichiarazioni dei redditi e IVA, a meno che dietro non ci sia un intermediario abilitato.
3. La **consulenza**: scelta del regime, pianificazione, concordato preventivo biennale (CPB), contenzioso, operazioni straordinarie, casi non standard.

Per una **SRL in ordinaria** il risparmio è molto minore. Bilancio CEE, nota integrativa, Redditi SC, IRAP, scritture di assestamento e 770 con dipendenti richiedono competenze da ragioniere. Un gestionale li può *preparare*, ma la firma degli amministratori e il controllo di un professionista restano la prassi.

---

## 1. Classificazione: cosa può fare Kubo

| Classe | Significato |
|---|---|
| **A** | Il gestionale può produrre il documento **interamente e correttamente** dai dati che ha, e (dove serve) inviarlo da solo tramite un canale aperto a tutti (SDI). |
| **B** | Il gestionale **prepara il file o l'importo pronto**, ma l'**invio** passa da un canale ufficiale dove il titolare deve autenticarsi (SPID/CIE/CNS su Fatture e Corrispettivi, F24 web, Fisconline, DIRE) oppure da un intermediario Entratel. |
| **C** | Resta **attività professionale** (riserva di legge o responsabilità/consulenza): il software può solo segnalare, stimare o preparare bozze. |

---

## 2. Mappa degli adempimenti per tipo di soggetto

Legenda soggetti: **F** = ditta individuale forfettaria · **S** = ditta individuale / SNC-SAS in contabilità semplificata · **O** = SRL in contabilità ordinaria · **P** = professionista con partita IVA (con cassa o gestione separata, ritenuta d'acconto) · **A** = ASD/associazione.

### 2.1 Fatturazione e documenti di vendita

| Documento | Chi | Quando | Formato tecnico | Invio da solo? | Classe |
|---|---|---|---|---|---|
| Fattura elettronica TD01 (immediata), TD06 (parcella), TD24 (differita con DDT), TD25 | F S O P (A se commerciale) | Immediata: entro 12 giorni dall'operazione. Differita TD24: entro il 15 del mese successivo | **FatturaPA XML, schema FPR12** (fattura ordinaria) / FSM10 (semplificata). **Specifiche tecniche v1.9.1**, utilizzabili dal **15/05/2026** ([AdE v1.9](https://www.agenziaentrate.gov.it/portale/web/guest/specifiche-tecniche-versione-1.9), [informazionefiscale v1.9.1](https://www.informazionefiscale.it/fattura-elettronica-2026-novita-specifiche-tecniche)) | Sì: SDI è aperto a tutti. Canali: **PEC** a `sdi01@pec.fatturapa.it` (gratuito; dopo il primo invio SDI assegna un indirizzo dedicato), upload su "Fatture e Corrispettivi", web service SDICoop / SFTP (richiedono accreditamento) oppure un provider API | **A** |
| Nota di credito TD04 / nota di debito TD05 | idem | Variazioni ex art. 26 DPR 633/72 | FPR12 | Sì | **A** |
| Fattura semplificata TD07 | F (anche oltre 400 € dalla v1.9), S | idem | FSM10 | Sì | **A** |
| Autofattura / integrazione reverse charge: **TD16** (interno), **TD17** (servizi esteri), **TD18** (beni intra-UE), **TD19** (beni ex art. 17 c.2) | S O P (F per TD17-19 quando acquista dall'estero) | Entro il 15 del mese successivo al ricevimento | FPR12 (cedente estero e cessionario = soggetto stesso) | Sì | **A** |
| Fatture verso esteri (ex "esterometro attivo") | S O P F | Nei termini di emissione | FPR12 con CodiceDestinatario `XXXXXXX` | Sì | **A** |
| **TD29**: comunicazione di fattura omessa o irregolare del fornitore (dal 01/04/2025, sostituisce l'uso di TD20) | S O P | Entro 90 giorni dal termine (art. 6 c.8 D.Lgs. 471/97) | FPR12 | Sì | **A** (logica: con quali dati, quando) |
| Autoconsumo / omaggi TD27; splafonamento TD21; San Marino TD28 | S O | — | FPR12 | Sì | **A** |
| **Imposta di bollo virtuale** 2 € su fatture esenti/fuori campo > 77,47 € (tipico del forfettario) | F P A | Si indica in fattura (`DatiBollo`). Versamento trimestrale con F24: Q1 entro **31/5** (rinviabile al 30/9 se ≤ 5.000 €), Q2 entro **30/9** (rinviabile al 30/11 se Q1+Q2 ≤ 5.000 €), Q3 entro **30/11**, Q4 entro **28/2** dell'anno dopo. Codici **2521-2524** ([fonte](https://optlyx.com/guida-imposta-bollo-fattura-elettronica-2026)) | Campo XML + F24 | L'AdE mette a disposizione anche l'importo precalcolato in F&C | **A** (calcolo) + **B** (pagamento F24) |
| Prestazioni sanitarie verso persone fisiche | P sanitari (es. dentisti) | — | **Divieto di fattura via SDI ormai a regime** (D.Lgs. 81/2025): serve fattura cartacea/PDF + invio dati al **Sistema Tessera Sanitaria** ([fonte](https://www.ecnews.it/fiscale/?p=150125)) | Invio STS con credenziali proprie | **A/B** |

Novità della v1.9 (dal 1/4/2025):
- **TD29**;
- regime **RF20** (franchigia IVA transfrontaliera, direttiva UE 2020/285);
- abolito il limite di 400 € per la fattura semplificata di forfettari e RF20.

Novità della **v1.9.1** (dal 15/5/2026):
- nuovo controllo SDI **00327**;
- codifica `AltriDatiGestionali` per i lavoratori sportivi esenti;
- gruppi IVA;
- numero massimo di codici destinatario per canale.

### 2.2 Corrispettivi (negozi, ristoranti, laboratori con vendita al pubblico)

| Documento | Chi | Quando | Formato | Invio | Classe |
|---|---|---|---|---|---|
| Memorizzazione e invio telematico dei corrispettivi + documento commerciale | Commercio al dettaglio, ristorazione | Invio giornaliero entro **12 giorni** | Registratore Telematico (RT) che invia da solo, oppure procedura web "Documento commerciale online" su F&C | L'RT invia da solo; la procedura web si usa con SPID | **B** (Kubo non può sostituire l'RT oggi) |
| **Collegamento POS-RT** (L. 207/2024) | Tutti gli esercenti con RT | Obbligo dal **01/01/2026**. Abbinamento logico matricola RT ↔ POS sul portale F&C, attivo dal **5/3/2026**, entro 45 giorni (Provv. AdE **424470 del 31/10/2025**) ([fonte](https://www.leggioggi.it/pos-registratore-di-cassa-collegati-dal-2026/)) | Servizio web | Il titolare con SPID | **B** (Kubo può guidare l'operazione) |
| **Soluzioni software** al posto dell'RT | — | Specifiche: Provv. **111204 del 7/3/2025** (moduli MF1 locale + MF2 trasmissione). Uso effettivo previsto dal **2027**, con certificazione obbligatoria ([fonte](https://www.studiopizzano.it/corrispettivi-telematici-via-software-la-road-map-verso-il-2027-e-confermata/)) | — | Il software deve essere approvato dall'AdE e validato da un ente certificatore | **opportunità strategica** |
| Ventilazione / registro corrispettivi | Commercio | Mensile | Registro | — | **A** |

### 2.3 IVA periodica e annuale

| Documento | Chi | Quando (2026) | Formato | Invio da solo? | Classe |
|---|---|---|---|---|---|
| **Registri IVA** (vendite, acquisti, corrispettivi) | S O P (non F) | Tenuta continua. Conservazione elettronica entro 3 mesi dal termine della dichiarazione dei redditi | Libero (PDF/XML) + conservazione a norma. Bozze precompilate dall'AdE (sperimentazione estesa al 2026, Provv. 42054 del 3/2/2026, [fonte](https://www.informazionefiscale.it/dichiarazione-iva-2026-lipe-registri-precompilata-novita)) | Non si inviano | **A** |
| **Liquidazione IVA** mensile o trimestrale | S O P | Mensili: **16 del mese dopo** (codici 6001-6012). Trimestrali (volume d'affari ≤ 500k € servizi / 800k € altre attività): **16/5, 20/8, 16/11**, Q4 al 16/3 con la dichiarazione annuale (codici 6031-6033, saldo annuale **6099**), **+1% di interessi** | F24 | F24 web / home banking | **A** (calcolo) + **B** (pagamento) |
| **Acconto IVA** | S O P | **27/12** (6013 mensili, 6035 trimestrali). Non dovuto se < 103,29 € | F24 | idem | **A** + **B** |
| **LIPE**: comunicazione liquidazioni periodiche | S O P | Q1 **1/6/2026**, Q2 **30/9**, Q3 **30/11**, Q4 entro fine febbraio (2/3/2026 per il Q4 2025) ([fonte](https://www.informazionefiscale.it/LIPE-2023-comunicazioni-IVA-trimestrali-scadenza-istruzioni)) | XML secondo il tracciato AdE (schema "Comunicazione liquidazioni periodiche IVA"). Esiste la precompilata | **Sì**: upload o compilazione su **F&C** con SPID, oppure tramite intermediario | **B** (file prodotto da Kubo) |
| **Dichiarazione IVA annuale** | S O P (non F) | **1/2 – 30/4** | Modello IVA (tracciato telematico .txt da controllare con il software di controllo dell'AdE). Esiste la precompilata (sperimentale 2026; esclusi regimi speciali, ventilazione, gruppi IVA) | **Sì** via Fisconline (invio file o precompilata web) | **B** (tracciato complesso) |
| **Visto di conformità** per compensare un credito IVA > **5.000 €** (fino a 50k € per start-up innovative e fino a **70k €** per soggetti ISA premiali o aderenti al CPB) | S O P | Con la dichiarazione | — | Solo commercialisti, consulenti del lavoro, CAF | **C** |
| Integrazioni d'acquisto reverse charge TD16-19 | vedi 2.1 | | | | **A** |
| **Intrastat** | S O con scambi intra-UE oltre soglia | Mensile/trimestrale verso ADM | Tracciato Intr@Web | Con credenziali ADM | **B** **[soglie da verificare]** |

### 2.4 Pagamenti: F24

- I titolari di partita IVA devono pagare l'F24 **solo in via telematica**: home banking/CBI se c'è un saldo a debito senza compensazioni; **servizi dell'AdE (F24 web/online, Entratel/Fisconline)** se ci sono compensazioni o il saldo è zero ([fonte](https://www.informazionefiscale.it/modello-f24-come-si-compila)).
- Kubo può generare **l'F24 completo** (sezioni Erario/INPS/Regioni/IMU, codici tributo, rateazioni, ravvedimento): **classe A**.
- Può anche generare il file in formato **F24 telematico** da caricare su F24 web/Fisconline (tracciato AdE): **classe B**.

Codici tributo più usati:

| Voce | Codici |
|---|---|
| Imposta sostitutiva forfettario | 1790 (1° acconto), 1791 (2° acconto), 1792 (saldo) |
| IRPEF | 4033 / 4034 / 4001 |
| IRES | 2001 / 2002 / 2003 |
| IRAP | 3812 / 3813 / 3800 |
| Ritenute lavoro autonomo | 1040 |
| Ritenute dipendenti | 1001 |
| IVA | 60xx; 6099 annuale |
| Bollo su fatture elettroniche | 2521-2524 |
| Diritto camerale | 3850 |
| Tassa vidimazione libri SRL | 7085 |
| INPS artigiani/commercianti (sezione INPS) | causali AF/CF (fissi), AP/CP (eccedenza) |
| Gestione separata | causale PXX |

Le voci INPS sono **[da verificare singolarmente]** sulla tabella codici.

### 2.5 Ritenute e sostituto d'imposta

| Documento | Chi | Quando | Formato | Invio da solo? | Classe |
|---|---|---|---|---|---|
| Calcolo della ritenuta in fattura (`DatiRitenuta`, `DatiCassaPrevidenziale`) | P (verso clienti sostituti d'imposta) | In fattura | FPR12 | — | **A** |
| Versamento ritenute operate (es. il negozio paga un professionista) | S O P A come sostituti | **16 del mese dopo il pagamento**, codice **1040** | F24 | F24 web / home banking | **A** + **B** |
| **Certificazione Unica (CU)** | Sostituti d'imposta | Invio all'AdE: **16/3** (dipendenti), **30/4** (lavoro autonomo, novità 2026), **31/10** (redditi esenti o esclusi dalla precompilata). Consegna al percipiente: 16/3 ([fonte](https://quifinanza.it/fisco-tasse/certificazione-unica-2026/958706/)) | Tracciato telematico CU | Fisconline per **meno di 20 CU**; oltre serve Entratel o un intermediario | **B** (lavoro autonomo semplice); paghe → consulente |
| **Modello 770** | Sostituti d'imposta | **31/10** (2/11/2026) | Tracciato telematico | Fisconline sotto i 20 soggetti, altrimenti Entratel/intermediario | **B** (casi semplici) / **C** con dipendenti |
| Paghe: LUL, UniEmens, cedolini | Datori di lavoro | Mensile | — | Riserva per chi elabora per terzi (L. 12/1979) | **C** (fuori perimetro: consulente del lavoro) |

**Novità da monitorare: ritenuta B2B.** La Legge di Bilancio 2026 (L. 199/2025, c. 111-115) introduce una **ritenuta d'acconto B2B dello 0,5% dal 2028 e dell'1% dal 2029** sui pagamenti tra imprese ([fonte](https://www.informazionefiscale.it/ritenuta-1-per-cento-imprese-2026-compensazioni)). Se resta in vigore, ogni gestionale dovrà calcolarla e versarla: va messa in roadmap.

### 2.6 Dichiarazioni dei redditi e IRAP

| Documento | Chi | Quando (2026) | Invio da solo? | Classe |
|---|---|---|---|---|
| **Redditi PF**: quadro LM (forfettario), RG (semplificata), RE (professionisti), RR (contributi) | F S P, soci di SNC/SAS | Invio entro il **31/10 (2/11/2026)**. Versamento del saldo e del 1° acconto entro il 30/6; **per ISA e forfettari prorogato al 20/7/2026**, con maggiorazione nei 30 giorni successivi ([ecnews](https://www.ecnews.it/fiscale/in-pratica/guida-agli-adempimenti/contribuenti-forfettari-le-scadenze-di-versamento-delle-imposte/), maggiorazione 0,40% ordinaria; la fonte cita 0,80% **[da verificare]**). 2° acconto **30/11 (1/12/2026)** | **Sì**: **Redditi PF precompilato web** disponibile dal 2025 anche per autonomi e impresa, **compreso il forfettario (quadro LM)**. Online dal 15/4/2026, invio dal 30/4 ([fonte](https://www.partitaiva.it/dichiarazione-redditi-precompilata-2026-guida/)) | **B**: Kubo prepara i valori quadro per quadro (rigo per rigo), il titolare li inserisce o verifica nella precompilata |
| Redditi SP + IRAP | SNC/SAS | 31/10 | Fisconline (legale rappresentante) | **B/C** |
| Redditi SC + IRAP (IRES 24%, IRAP 3,9%) | SRL | 31/10. Versamenti entro l'ultimo giorno del 6° mese dopo la chiusura | Fisconline del legale rappresentante possibile, ma in pratica tramite intermediario | **C** (preparabile in bozza) |
| **ISA** (indici sintetici di affidabilità) | S O P (non F) | Allegato a Redditi | Software gratuito AdE "Il tuo ISA" | **B/C** |
| **Concordato preventivo biennale (CPB) 2026-2027** | Soli soggetti ISA (forfettari **esclusi** dal 2025) | Adesione entro il **30/9** ([fonte](https://arlettipartners.com/it/concordato-preventivo-biennale-2025-2026-novita-su-scadenze-aliquote-e-requisiti/)) | — | **C** (scelta di convenienza) |

### 2.7 Bilancio e adempimenti societari (SRL)

| Documento | Quando | Formato | Invio da solo? | Classe |
|---|---|---|---|---|
| Libro giornale, mastri, libro inventari, registro dei beni ammortizzabili | Tenuta continua | Elettronico + conservazione | — | **A** solo se Kubo fa partita doppia (oggi no?) |
| Scritture di assestamento: ratei/risconti, ammortamenti, TFR, rimanenze, imposte differite | Fine esercizio | — | — | **C** (giudizio professionale) |
| **Bilancio d'esercizio** (abbreviato/micro, art. 2435-bis/ter c.c.) | Approvazione entro 120 giorni (180 in casi particolari) | — | — | **C** (bozza A/B) |
| **Deposito del bilancio** al Registro Imprese | Entro **30 giorni** dall'approvazione | **XBRL** (tassonomia PCI) + verbale + firma digitale | **Sì: l'amministratore con firma digitale** via **DIRE/ComUnica**, senza commercialista ([fonte](https://www.paen.camcom.gov.it/sites/default/files/Allegati_Sito/GUIDA%20DEPOSITO%20BILANCI%20PALERMO%20ENNA%202026.pdf)) | **B** |
| Diritto annuale CCIAA | 30/6 | F24 codice 3850 | Sì | **A** + **B** |
| Tassa vidimazione libri sociali (309,87 €) | 16/3 | F24 codice 7085 | Sì | **A** + **B** |

### 2.8 Previdenza (INPS / casse)

| Voce | Chi | 2026 | Classe |
|---|---|---|---|
| **INPS artigiani/commercianti**: contributi fissi | F S (titolari, soci, collaboratori) | Minimale **18.808 €**. Fissi circa **4.521 € (artigiani) / 4.612 € (commercianti)**. Rate: 18/5, 20/8, 16/11, 16/2 (Circ. INPS **14 del 9/2/2026**, [fonte](https://www.partitaiva.it/contributi-inps-artigiani-commercianti-2026/)) | **A** (importi) + **B** (F24 precompilato nel Cassetto previdenziale) |
| INPS artigiani/commercianti: contributi eccedenti il minimale | idem | **24% / 24,48%** fino a 56.224 €, poi 25% / 25,48% fino al massimale. Pagati con saldo e acconti delle imposte | **A** |
| **Riduzione del 35%** per i forfettari | F | Domanda entro il **28/2** | **B/C** (scelta) |
| **Gestione separata** | P senza cassa | **26,07%** (24% se già pensionati o iscritti ad altra forma). Minimale 18.808 €, massimale **122.295 €** (Circ. INPS 8 del 3/2/2026, [fonte](https://www.informazionefiscale.it/Aliquote-gestione-separata-INPS-2026-importo-contributi)) | **A** |
| Casse professionali (Inarcassa, CNPADC, ENPAM…) | P iscritti | Regole e modelli proprie di ogni cassa: soggettivo, integrativo 2-5% in fattura, comunicazione reddituale annuale | **A** (integrativo in fattura) / **B** (comunicazioni annuali) |

### 2.9 Conservazione

| Voce | Classe |
|---|---|
| **Conservazione a norma delle fatture elettroniche**: servizio **gratuito dell'AdE** (15 anni) da attivare con un'adesione su F&C. Può anche recuperare le fatture dal 2019 ([fonte](https://www.money.it/fattura-elettronica-conservazione-retroattiva-novita-servizio-agenzia-delle-entrate)) | **B** (Kubo spiega e verifica l'adesione) |
| Conservazione di registri e libri: entro 3 mesi dal termine della dichiarazione. Serve un conservatore qualificato (marketplace ACN/AgID) oppure un sistema proprio conforme alle Linee guida AgID | **B** |

### 2.10 ASD / associazioni

| Voce | Classe |
|---|---|
| **Dal 1/1/2026** la riforma fiscale del Terzo settore è pienamente operativa. I servizi sportivi resi a soci e tesserati passano da **esclusi** IVA a **esenti** IVA: molte ASD devono aprire la partita IVA e gestire gli adempimenti relativi ([fonte](https://www.ecnews.it/fiscale/mondo-professione/editoriali/il-fisco-degli-ets-entra-a-regime-cosa-cambia-davvero-dal-2026/)) | **C** (inquadramento) |
| Regime **398/91**: resta solo per ASD e SSD. Se l'ente è anche APS/ETS prevale il regime del Terzo settore ([fonte](https://ilfiscoincontralosport.usacli.it/wp-content/uploads/2026/05/Regime-fiscale-applicabile-dal-2026.pdf)) | **C** |
| **Modello EAS** entro 60 giorni dalla costituzione e variazioni entro il 31/3; iscrizione **RASD**; Redditi ENC; rendiconto | **B/C** |
| Ricevute quote associative, prima nota, rendiconto per cassa | **A** |

---

## 3. Calcoli tipici (formule)

### 3.1 Forfettario (L. 190/2014, art. 1 c. 54-89)

**Requisiti 2026**
- Ricavi o compensi dell'anno precedente ≤ **85.000 €**.
- Se si superano i **100.000 €** si esce dal regime nell'anno stesso, con IVA dall'operazione che fa superare la soglia.
- Spese per dipendenti ≤ 20.000 €.
- Redditi da lavoro dipendente o pensione ≤ **35.000 €**: soglia prorogata per il 2026, dal 2027 torna a 30.000 € salvo nuove proroghe ([fonte](https://www.quotidianopiu.it/dettaglio/13333782/forfetario-2026-confermata-la-soglia-a-35000-euro-per-lavoro-dipendente-e-pensione)).

**Calcolo dell'imposta**
```
RedditoLordo      = Σ ricavi INCASSATI nell'anno (principio di cassa) × coefficiente ATECO
  coefficienti: 40% commercio/alimentari/alloggio-ristorazione; 54% ambulanti non alimentari;
                62% intermediari commercio; 67% altre attività (artigiani tipici);
                78% professioni, scientifiche, tecniche, sanitarie, istruzione; 86% costruzioni e immobiliare
RedditoImponibile = RedditoLordo − contributi previdenziali obbligatori VERSATI nell'anno
Imposta           = RedditoImponibile × 5%  (primi 5 anni, se rispettati i requisiti di nuova attività)
                                       × 15% (ordinaria)
```

**Contributi INPS**
- Artigiani e commercianti:
  ```
  fissi + 24% (24,48% commercianti) × max(0, RedditoLordo − 18.808)
  ```
  Se si sceglie la riduzione, si moltiplica per 0,65.
- Gestione separata:
  ```
  26,07% × RedditoLordo  (fino al massimale)
  ```
  Acconti all'80% del dovuto dell'anno prima (40% + 40%).

**Acconti** (metodo storico)
- Base: 100% dell'imposta dell'anno precedente.
- Se è sotto 51,65 € non è dovuto.
- Se è fino a 257,52 €, si paga in un'unica rata a novembre.
- Altrimenti **50% + 50%** (art. 58 DL 124/2019, esteso ai forfettari).
- C'è anche il metodo previsionale: Lumi può stimare il rischio di sanzione se l'acconto è troppo basso.

**Obblighi formali in fattura**
- Niente IVA: Natura **N2.2**, RegimeFiscale **RF19**.
- Dicitura "operazione effettuata ai sensi dell'art. 1, commi 54-89, L. 190/2014".
- Bollo 2 € se l'importo supera 77,47 €.
- Niente ritenuta, con la dicitura di esonero (c. 67).
- Fattura elettronica obbligatoria per tutti dal 1/1/2024.

### 3.2 Liquidazione IVA
```
Saldo_periodo = IVA vendite (esigibile) − IVA acquisti detraibile − credito periodo precedente
Se Saldo ≤ 25,82 €  → si riporta al periodo successivo
Trimestrale (Q1-Q3): Versamento = Saldo × 1,01   (interessi 1%, art. 7 DPR 542/99)
Q4 trimestrali: col saldo annuale (6099) entro 16/3, maggiorato dell'1%
Acconto 27/12: storico 88% del versato per l'ultimo periodo dell'anno precedente | previsionale 88% | analitico 100% al 20/12
```
Esigibilità differita e split payment (fatture alla PA) vanno gestiti in fattura (`EsigibilitaIVA` D/S) e in liquidazione.

### 3.3 Professionista con ritenuta e cassa
```
Compenso C
Gestione separata → rivalsa 4%: R = 4% × C  (entra nella base IVA E nella base della ritenuta)
Cassa professionale → contributo integrativo: K = 2-5% × C (entra nella base IVA, NON nella base della ritenuta)
Imponibile IVA = C + R (o C + K);   IVA = 22% × imponibile IVA
Ritenuta = 20% × (C + R)   oppure 20% × C se cassa
Netto a pagare = C + R/K + IVA − Ritenuta   (+ bollo 2 € se esente/fuori campo > 77,47)
Committente: versa la ritenuta entro il 16 del mese dopo il pagamento (codice 1040), poi CU entro il 30/4 e 770
```
([fonte](https://fiscomania.com/codice-tributo-1040/))

### 3.4 Ditta in semplificata e SRL (sintesi)
- **IRPEF 2026**: 23% fino a 28.000 € · **33%** da 28.000 a 50.000 € (prima era 35%) · 43% oltre ([fonte](https://www.ecnews.it/lavoro/news-del-giorno/legge-bilancio-2026-revisione-aliquote-irpef/)). Si aggiungono le addizionali regionali e comunali.
- La **semplificata** è "di cassa" (art. 66 TUIR): reddito = ricavi incassati − costi pagati ± rimanenze (con regole particolari).
- **IRES** 24%, **IRAP** 3,9% (aliquote regionali variabili). La base IRAP esclude il costo del personale a tempo indeterminato.

---

## 4. Riserve di legge e cosa resta "C"

| Attività | Perché non la può fare un software |
|---|---|
| **Invio telematico per conto terzi** di dichiarazioni (Redditi, IVA, 770, CU > 20) | Solo intermediari abilitati ex art. 3 c.3 DPR 322/98 (commercialisti, consulenti del lavoro, CAF, associazioni di categoria, ecc.) con Entratel. Il contribuente può però inviare **in proprio** con Fisconline/SPID |
| **Visto di conformità** (art. 35 D.Lgs. 241/97) | Commercialisti, consulenti del lavoro, CAF con polizza |
| Asseverazioni, certificazione tributaria, revisione legale | Professionisti iscritti |
| Elaborazione paghe **per conto terzi** | L. 12/1979: consulenti del lavoro (o commercialisti) |
| Assistenza in contenzioso davanti alla Corte di giustizia tributaria | Difensore abilitato. In proprio solo per liti fino a 3.000 € |
| Scelta di regime, CPB, riduzione INPS, trasformazioni societarie, pianificazione, valutazioni di bilancio | Consulenza: chi la dà ne risponde professionalmente. Lumi può solo **simulare** e **segnalare** |
| Risposte a controlli e avvisi bonari, ravvedimenti complessi | Il calcolo del ravvedimento semplice è **A**; la strategia è **C** |

**Nota importante.** La **tenuta della contabilità NON è un'attività riservata**: il titolare può tenerla da solo o con un software.

---

## 5. Concorrenti: lo standard di mercato

| Prodotto | Cosa fa | Cosa NON fa / come lo fa |
|---|---|---|
| **Fatture in Cloud** (TeamSystem, più di 580k partite IVA) | Fatture SDI (PA/B2B/B2C), firma, conservazione. Piano Forfettari circa 4 €/mese: **monitoraggio della soglia di 85k e stima delle tasse** in tempo reale | Gli **F24 li carica il commercialista** invitato nel software. Non invia dichiarazioni ([fonte](https://www.fattureincloud.it/forfettari)) |
| **Aruba Fatturazione Elettronica** | Fatture SDI e conservazione a circa 30 €/anno, bollo virtuale automatico | Nessun calcolo delle imposte o degli F24 |
| **Danea Easyfatt** (desktop Windows) | Magazzino, DDT, ordini, prima nota, scadenziario, collegamento con il POS | Adempimenti fiscali demandati al commercialista |
| **Fiscozen** (circa 500 €/anno) / Flextax / Quickfisco / Forfettario.it | Software + **commercialista dedicato** che fa da intermediario: F24 compilati, **dichiarazione dei redditi inviata da loro** ([fonte](https://www.fiscozen.it/guide/confronto-tra-gestionali-per-partita-iva-integrazione-f24-dichiarazione-dei-redditi-e-consulenza/)) | Il modello di business è "software + professionista abilitato", non solo software |
| **TeamSystem Studio / Lynfa, Zucchetti, Wolters Kluwer** | Suite per gli studi: tutto, compreso Entratel, bilancio XBRL, 770, paghe | Costose e rivolte al commercialista, non al titolare |
| **Odoo l10n-italy (OCA, open source)** | Precedente open source: FatturaPA, canale SDI via PEC, registri IVA, **LIPE XML**, ritenute, bollo, Intrastat, corrispettivi | Nessuna dichiarazione dei redditi. Va configurato da esperti |

**Lo standard di mercato** è fattura SDI + conservazione + stima delle tasse e della soglia. Chi va oltre (F24, dichiarazione) lo fa **affiancando un commercialista abilitato**.

**Lo spazio libero per Kubo** è un gestionale che, senza intermediario:
1. calcola tutto;
2. prepara gli F24 e i file ufficiali;
3. guida il titolare passo per passo nell'invio con SPID (LIPE su F&C, F24 web, Redditi precompilato);
4. con Lumi spiega ogni numero.

Fiscozen e simili costano 500-1.500 €/anno proprio per questo pezzo.

---

## 6. Priorità per Kubo/Lumi (in ordine di valore per il titolare)

1. **Fattura elettronica completa e corretta** (A): FPR12 conforme alla v1.9.1, controlli SDI prima dell'invio, TD01/04/06/24, bollo, ritenuta e cassa, N2.2/RF19, invio via PEC o provider, ricezione delle fatture passive. È la base di tutto il resto.
2. **Cruscotto tasse del forfettario** (A): incassato vs 85k/100k, imposta sostitutiva, INPS (fissi + eccedenza, riduzione del 35%), acconti 50/50, con la data di ogni scadenza. È il motivo n. 1 per cui il forfettario paga Fiscozen.
3. **F24 pronti** (A + B): imposta sostitutiva, INPS eccedente, bollo 2521-2524, IVA, ritenute 1040, diritto camerale. PDF + istruzioni per F24 web e home banking. Lumi spiega ogni riga.
4. **Liquidazione IVA e registri IVA** (A) per semplificata e professionisti: mensile o trimestrale con l'1%, acconto 27/12, riconciliazione con le bozze precompilate dell'AdE.
5. **LIPE XML** (B): file pronto e guida all'upload su F&C con SPID.
6. **Scadenzario fiscale personalizzato** con promemoria di Lumi: bollo, LIPE, F24, CU 30/4, POS-RT, adesione alla conservazione gratuita.
7. **Prospetto per la dichiarazione dei redditi** (B): valori del quadro LM/RG/RE da riportare nella Redditi PF precompilata web, con verifica incrociata.
8. **Ritenute come sostituto d'imposta e CU per i lavoratori autonomi** (B, meno di 20 CU via Fisconline).
9. **Pacchetto per il commercialista** (export di registri, prima nota, partitari) per tutto ciò che resta C. Lumi deve **dire chiaramente quando serve un professionista**.
10. **Da tenere d'occhio**: certificazione come "soluzione software" per i corrispettivi (dal 2027), ritenuta B2B (2028), ASD dopo la riforma 2026, partita doppia/XBRL per le SRL.

## 7. Fonti principali

- AdE, Specifiche tecniche FatturaPA v1.9: https://www.agenziaentrate.gov.it/portale/web/guest/specifiche-tecniche-versione-1.9
- v1.9.1 dal 15/5/2026: https://www.informazionefiscale.it/fattura-elettronica-2026-novita-specifiche-tecniche · https://www.ipsoa.it/documents/quotidiano/2026/04/02/e-fattura-nuove-specifiche-tecniche-15-maggio-2026
- TD29 / RF20: https://www.informazionefiscale.it/Fattura-elettronica-2025-specifiche-tecniche-codice-TD29
- Collegamento POS-RT, Provv. 424470/2025: https://www.leggioggi.it/pos-registratore-di-cassa-collegati-dal-2026/ · https://www.mysolution.it/fisco/informazioni/news/2025/11/03/pos-e-registratori-telematici-interconnessi-dal-2026-definite-le-modalita-operative/
- Software al posto dell'RT, Provv. 111204/2025: https://www.agendadigitale.eu/documenti/corrispettivi-arrivano-i-software-per-gestirli-cosa-dice-lagenzia-delle-entrate/ · https://www.studiopizzano.it/corrispettivi-telematici-via-software-la-road-map-verso-il-2027-e-confermata/
- Bollo sulle fatture elettroniche 2026: https://optlyx.com/guida-imposta-bollo-fattura-elettronica-2026 · https://www.informazionefiscale.it/bollo-fatture-elettroniche-codici-tributo-istruzioni-documenti-elettronici
- Forfettario 2026: https://www.quotidianopiu.it/dettaglio/13333782/forfetario-2026-confermata-la-soglia-a-35000-euro-per-lavoro-dipendente-e-pensione · https://www.diritto.it/?p=244528
- Acconti e scadenze dei forfettari 2026: https://www.ecnews.it/fiscale/in-pratica/guida-agli-adempimenti/contribuenti-forfettari-le-scadenze-di-versamento-delle-imposte/
- INPS artigiani/commercianti 2026 (Circ. 14/2026): https://www.partitaiva.it/contributi-inps-artigiani-commercianti-2026/
- Gestione separata 2026 (Circ. 8/2026): https://www.informazionefiscale.it/Aliquote-gestione-separata-INPS-2026-importo-contributi
- CU 2026: https://quifinanza.it/fisco-tasse/certificazione-unica-2026/958706/
- 770 via Fisconline sotto i 20 soggetti: https://www.fiscoetasse.com/approfondimenti/10012-modello-770-modalit-di-presentazione.html
- LIPE 2026: https://www.informazionefiscale.it/LIPE-2023-comunicazioni-IVA-trimestrali-scadenza-istruzioni
- IVA precompilata 2026 (Provv. 42054/2026): https://www.informazionefiscale.it/dichiarazione-iva-2026-lipe-registri-precompilata-novita
- Visto di conformità 2026: https://quifinanza.it/fisco-tasse/compensazione-credito-iva-2026/959681/
- Redditi PF precompilato 2026 per partite IVA: https://www.partitaiva.it/dichiarazione-redditi-precompilata-2026-guida/
- F24 e compensazioni: https://www.informazionefiscale.it/modello-f24-come-si-compila
- Codici IVA 6031-6099: https://www.partitaiva.it/codici-tributo/6099/
- Ritenuta 1040: https://fiscomania.com/codice-tributo-1040/
- Ritenuta B2B dal 2028 (L. 199/2025): https://www.informazionefiscale.it/ritenuta-1-per-cento-imprese-2026-compensazioni
- IRPEF 2026: https://www.ecnews.it/lavoro/news-del-giorno/legge-bilancio-2026-revisione-aliquote-irpef/
- Divieto di fattura elettronica per le prestazioni sanitarie a regime: https://www.ecnews.it/fiscale/?p=150125
- CPB 2026-2027: https://arlettipartners.com/it/concordato-preventivo-biennale-2025-2026-novita-su-scadenze-aliquote-e-requisiti/
- Deposito del bilancio da parte dell'amministratore (DIRE): https://www.paen.camcom.gov.it/sites/default/files/Allegati_Sito/GUIDA%20DEPOSITO%20BILANCI%20PALERMO%20ENNA%202026.pdf
- Conservazione gratuita AdE: https://www.money.it/fattura-elettronica-conservazione-retroattiva-novita-servizio-agenzia-delle-entrate
- Terzo settore e ASD 2026: https://www.ecnews.it/fiscale/mondo-professione/editoriali/il-fisco-degli-ets-entra-a-regime-cosa-cambia-davvero-dal-2026/ · https://ilfiscoincontralosport.usacli.it/wp-content/uploads/2026/05/Regime-fiscale-applicabile-dal-2026.pdf
- Invio SDI tramite PEC: https://www.investireoggi.it/fatturazione-elettronica-anche-tramite-pec/
- Concorrenti: https://www.fattureincloud.it/forfettari · https://www.fiscozen.it/guide/confronto-tra-gestionali-per-partita-iva-integrazione-f24-dichiarazione-dei-redditi-e-consulenza/ · https://centrofiscale.com/fatture-in-cloud-vs-aruba-vs-danea-2026/

**Limiti di questa ricerca.** Molte fonti sono testate specializzate e non testi normativi. Prima di implementare, verificare sul sito dell'AdE:
- i codici INPS da usare nell'F24;
- la maggiorazione dello 0,40% sui versamenti di luglio-agosto 2026;
- le soglie Intrastat;
- il tracciato XML della LIPE.

Nota sulle fonti: queste sono sintesi, non citazioni testuali.
