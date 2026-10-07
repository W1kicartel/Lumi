# Agenda, cruscotto, viste e filtri

Tre cose che in un gestionale si usano tutti i giorni: il **calendario**, la **pagina iniziale con i numeri** e le **liste filtrate e salvate**. Funzionano per qualsiasi sezione, anche per quelle create con «Personalizza». Non c'è niente di scritto apposta per un settore.

## Calendario

Si apre con il bottone **Calendario** in testa alla lista di una sezione che ha un campo `data` o `data_ora`. Si apre anche dalla voce **Agenda** nella barra laterale, che compare se esiste una sezione con un campo `data_ora`. Se una sezione si chiama già «Agenda», la voce si chiama «Calendario».

- **Mese, settimana, giorno.** Le frecce ← → spostano il periodo, `t` torna a oggi.
- **Colonne per persona o risorsa** nella vista giorno, prese da un campo `utente` («Con») o da una relazione (la poltrona, la sala, il furgone…).
- **Trascina per spostare.** Si salva subito, con le regole e i permessi di sempre. Nella vista giorno, spostare un appuntamento in un'altra colonna cambia anche la persona o la risorsa.
- **Clic su uno spazio vuoto per creare.** La scheda nuova si apre con la data, l'ora e la colonna già messe.
- **Durata:**
  - da un campo `durata` della sezione (in minuti);
  - se non c'è, dalla prima relazione che ne ha uno (es. `servizio.durata`);
  - altrimenti un'ora.
- **Colori** dal primo campo `stato` o `scelta`. Gli annullati e i «non venuto» restano visibili, ma barrati.
- Per una sezione con più date (es. una commessa con «consegna» e «inizio»), si sceglie quale mettere in calendario.
- Si aggiorna da solo quando un collega modifica qualcosa.

API: `GET /api/agenda/:entita?da=AAAA-MM-GG&a=AAAA-MM-GG[&campo=]`, al massimo due mesi alla volta.

## Cruscotto

È la pagina iniziale. I widget sono dati salvati nella tabella `_agenda_cruscotti`. Chi può personalizzare il gestionale li aggiunge, li cambia e li riordina con **Modifica**. Gli altri vedono solo i widget delle sezioni a cui hanno accesso.

| widget | cosa mostra |
|---|---|
| **numero** | Conta, somma o media, con i filtri e il periodo (oggi, questa settimana, questo mese…), confrontata con il periodo prima. Un clic apre la lista con gli stessi filtri. |
| **grafico** | Barre o linea, per giorno, settimana o mese. È disegnato a mano in SVG, senza librerie, e mostra il valore al passaggio del mouse. |
| **attenzione** | Ogni voce conta le righe che rispondono ai suoi filtri: calcolati veri (`da_riordinare`), date scadute (`scadenza < @oggi`), stati fermi da giorni (`modificato < @oggi-7`). |
| **ultime** | Le ultime righe create o modificate, solo quelle che chi guarda può leggere. Si vede chi e quando, ma non i valori. |

Il primo cruscotto si crea da solo, con i widget adatti ai modelli installati:

- **negozio:** incassato oggi e nel mese, vendite del giorno, incassi degli ultimi 30 giorni, articoli da riordinare, ordini in ritardo;
- **laboratorio:** preventivi in attesa, commesse aperte, accettato del mese, commesse in ritardo, preventivi senza risposta;
- **studio:** appuntamenti di oggi, incassato, andamento settimanale, appuntamenti passati da chiudere, pacchetti scaduti.

### Aggregati

`POST /api/aggregati`:

```json
{ "entita": "vendite", "misure": [{ "misura": "conta" }, { "misura": "somma", "campo": "totale" }],
  "filtri": [{ "campo": "stato", "op": "=", "valore": "pagata" }], "campoData": "data", "periodo": "mese",
  "per": "giorno", "confronta": true }
```

- **Misure:** `conta`, `somma`, `media`, `min`, `max`.
- **`per`:** `giorno`, `settimana` (dal lunedì), `mese` o `anno` nel fuso **Europe/Rome**, ora legale compresa. Oppure l'id di un campo `scelta`, `stato`, `relazione`, `utente` o `si_no`.
- **Periodo:**
  - `oggi`, `settimana`, `mese`, `anno`, `ultimi_N`, `sempre`;
  - oppure `da` e `a` in AAAA-MM-GG;
  - `confronta` aggiunge il periodo precedente.
- **Date relative nei filtri:** `@oggi`, `@oggi-7`, `@oggi+30`, `@inizio_settimana`, `@inizio_mese`, `@ora`.
- **Euro:** le valute, compresi i calcolati che le usano come `SOMMA(righe.totale)`, si sommano in centesimi interi. 0,10 + 0,20 fa 0,30.
- **Permessi:** si legge sempre con i permessi di chi chiede. Contano «solo i propri» e i calcolati. Una misura, un raggruppamento o un filtro su un campo nascosto viene rifiutato.

## Filtri e viste salvate (lista)

- **Costruttore di filtri.** Si sceglie il campo, poi l'operatore adatto al tipo, poi il valore con l'editor giusto:
  - **scelta e stato:** «è uno di»;
  - **relazione:** si cerca la riga;
  - **utente:** «io» o una persona;
  - **date:** oggi, ieri, questa settimana, questo mese, ultimi 7 o 30 giorni, prima del, dal, fra;
  - **numeri:** maggiore, minore, fra;
  - **testi:** contiene, inizia con.

  Un clic sul filtro lo cambia. I periodi restano relativi: «questo mese» resta questo mese.
- **Colonne:** quali mostrare e in che ordine.
- **Raggruppamento** per stato, scelta, persona, relazione o sì/no. I **totali** di ogni gruppo e quelli in fondo vengono dal server e contano tutte le righe filtrate, non solo la pagina.
- **Viste salvate.** Filtri, colonne, gruppi, ordine e modo (tabella o kanban) si salvano **per me** o **per tutti**. Le viste per tutti le salva solo chi può personalizzare il gestionale. Se una vista usa campi nascosti per chi la apre, quei filtri e quelle colonne si tolgono e lo si dice.

API: `GET /api/viste/:entita`, `POST /api/viste/:entita`, `PUT /api/viste/:entita/:id`, `DELETE /api/viste/:entita/:id`.

## File

- `server/moduli/agenda.js`: le rotte e il cruscotto predefinito.
- `server/moduli/agenda-aggregati.js`: fuso, periodi, aggregati.
- `web/moduli/agenda.js` e `.css`: il calendario e il cruscotto.
- `web/filtri.js` e `.css`: il costruttore dei filtri e i popover, usati dalla lista e dal cruscotto.
- `test/agenda.test.mjs`.
