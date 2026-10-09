# Acquisti: riordino, ordini, ricevimenti, fatture dei fornitori

Il giro completo di chi compra merce:

1. capire cosa riordinare;
2. ordinarlo al fornitore giusto;
3. caricare in magazzino quello che arriva, anche in più volte;
4. controllare che la fattura del fornitore corrisponda a quello che è arrivato.

È la lacuna numero 5 del [confronto con gli altri gestionali](ricerca/CONFRONTO.md).

## Dove sta

| file | cosa fa |
|---|---|
| `server/moduli/acquisti.js` | preparazione delle sezioni, proposta di riordino, ordini dalla proposta, ricevimenti con carico e costo medio, confronto con la fattura, rotte e strumenti di Lumi |
| `web/moduli/acquisti.js` e `.css` | la pagina `#/acquisti`, più «Ricevi merce» e «Confronta» nella scheda di un ordine |
| `web/lingue/<codice>/acquisti.js` | i testi nelle sei lingue (area `acquisti`) |
| `server/moduli/lingue/<codice>.js` | i messaggi d'errore (chiavi `acq-*`) |
| `test/acquisti.test.mjs` | le prove |

## Prepara gli acquisti

La prima volta, **Acquisti → Prepara**. Solo chi può personalizzare può farlo. Kubo:

- **sceglie la sezione del magazzino**: quella con la giacenza, cioè articoli nel negozio, ricambi nell'officina, materiali nel laboratorio, ingredienti nel ristorante, prodotti nel beauty. Se ce ne sono più di una si sceglie dalla tendina;
- **usa gli «Ordini ai fornitori» che ci sono già** (il modello negozio), oppure li crea con le loro righe: numero `OF-AAAA-NNN`, data, fornitore, stato, consegna prevista, articoli, totale, note. Se c'è una sezione «ordini» che non è degli acquisti, crea `ordini_acquisto`. Se mancano i fornitori, crea anche quelli;
- **aggiunge, senza toccare il resto**:
  - la «quantità ricevuta» sulle righe;
  - lo stato «arrivato in parte», con le sue transizioni;
  - il DDT del fornitore;
  - la «fattura del fornitore», collegata alle fatture ricevute, se c'è il modello fatture;
- **corregge l'automazione «Ordine arrivato: carica il magazzino»** del negozio. Prima caricava tutte le quantità, ora carica solo **quello che non è già arrivato** con i ricevimenti: `SE(VUOTO(ricevuta); quantita; quantita - ricevuta)`. Chi segna «arrivato» a mano, senza ricevimenti, ottiene lo stesso carico di prima. Chi ha ricevuto una parte e poi segna «arrivato» carica solo il resto. Mai due volte. Nei modelli senza ordini l'automazione viene creata uguale.

## Da riordinare

Un articolo va riordinato quando la sua giacenza, più quanto è già ordinato e non ancora arrivato (ordini in bozza, inviati o arrivati in parte), non supera la soglia. Gli articoli con soglia 0 o vuota restano fuori.

Kubo propone di tornare a **due volte la soglia**: quantità = 2 × soglia − giacenza − in arrivo, almeno 1. Il moltiplicatore si cambia con `PUT /api/acquisti/impostazioni { scorta }`, da 1 a 12. Le proposte sono divise per fornitore, quello scritto nella scheda dell'articolo, con il totale stimato al costo dell'articolo.

Nella pagina si ritoccano le quantità, si tolgono le righe che non servono e si sceglie il fornitore per gli articoli che non ce l'hanno. **Crea gli ordini** fa un ordine in bozza per ogni fornitore, con le righe al costo dell'articolo. Se il fornitore ha i «giorni di consegna», calcola anche la consegna prevista. Gli articoli già ordinati non vengono riproposti.

## In arrivo e ricevimento della merce

**In arrivo** mostra gli ordini inviati o arrivati in parte. Per ogni riga c'è una barra con quanto è arrivato, e gli ordini oltre la consegna prevista sono segnati in ritardo.

**Ricevi merce**, dalla pagina o dalla scheda dell'ordine, propone per ogni riga quello che manca. Si corregge la quantità arrivata e si scrivono il DDT e la data. **Carica in magazzino**:

- aumenta la giacenza dell'articolo;
- aggiorna il **costo dell'articolo al costo medio ponderato**: (giacenza × costo attuale + arrivato × costo d'acquisto) / (giacenza + arrivato). Se la giacenza era zero, il costo diventa quello d'acquisto;
- scrive la quantità ricevuta sulla riga e registra il ricevimento in `_acquisti_ricevimenti` (data, DDT, quantità, costo, chi);
- porta l'ordine ad «arrivato in parte», oppure ad «arrivato» quando è arrivato tutto. Un ordine ancora in bozza passa prima da «inviato».

Non si riceve più di quello che manca, e un ordine arrivato o annullato non si riceve più. Tutto avviene in una transazione: se una riga non va, non si carica niente.

## Fatture dei fornitori

**Fatture dei fornitori** elenca gli ordini con merce arrivata e ancora senza fattura, con la fattura candidata. **Confronta** mette uno accanto all'altro:

- l'**ordinato**: quantità × costo delle righe;
- il **ricevuto**: quantità ricevute × costo;
- il **fatturato**: l'imponibile, senza IVA, della fattura ricevuta abbinata.

Le candidate sono le fatture ricevute dello stesso fornitore, non ancora abbinate a un altro ordine e datate dal giorno dell'ordine in poi. Vengono ordinate per differenza dal ricevuto. Una fattura **torna** se la differenza sta entro 1 € o l'1%. **Abbina** la collega all'ordine, **Togli** la scollega. Una fattura di un altro fornitore, o già usata, viene rifiutata. È il confronto a tre vie (ordine, ricevimento, fattura) dei gestionali grandi, fatto sul valore. Le righe della fattura ricevuta non sono una sezione di Kubo, quindi il confronto riga per riga non si può ancora fare.

## Rotte

Tutte con la sessione di chi chiede e con i permessi di ordini e articoli (dati.js). Si legge se si vedono gli ordini; la preparazione la fa solo chi può personalizzare.

```
GET/PUT /api/acquisti/impostazioni                     { ordini, righe, articoli, fornitori, scorta } · PUT cambia solo «scorta»
POST    /api/acquisti/prepara { articoli? }
GET     /api/acquisti/riordino                         { articoli, gruppi: [{ fornitore, righe: [{ articolo, giacenza, soglia, in_arrivo, proposta, costo }], totale }] }
POST    /api/acquisti/ordini { righe: [{ articolo, quantita, fornitore? }] }
GET     /api/acquisti/arrivo
POST    /api/acquisti/ordini/:id/ricevi { righe?: [{ riga, quantita }], data?, ddt? }
GET     /api/acquisti/ordini/:id/confronto
POST    /api/acquisti/ordini/:id/fattura { fattura | null }
GET     /api/acquisti/fatture
```

## Gli strumenti di Lumi

| strumento | tipo | per |
|---|---|---|
| `acquisti_riordino` | leggi | «cosa devo ordinare?» |
| `acquisti_in_arrivo` | leggi | «cosa sta arrivando? chi è in ritardo?» |
| `acquisti_crea_ordini` | scrivi | «fai gli ordini per quello che è sotto scorta», anche con articoli e quantità indicati; scheda Conferma/Annulla |
| `acquisti_ricevi` | scrivi | «è arrivato l'ordine OF-2026-004, DDT 123», tutto o in parte; scheda Conferma/Annulla |

## Cosa non fa ancora

- Più depositi, trasferimenti, lotti, seriali e scadenze, inventario fisico, FIFO: sono il magazzino avanzato, la lacuna numero 6.
- Non manda l'ordine al fornitore. Si stampa dal bottone Stampa dei documenti, come tutte le sezioni con righe, oppure lo manderà un connettore di posta.
- La proposta usa la soglia, non i consumi medi. La previsione dai consumi (vendite e scarichi degli ultimi mesi) è il passo dopo.
- Il confronto con la fattura è sul valore. Quello riga per riga arriverà quando le righe delle fatture ricevute saranno una sezione.
