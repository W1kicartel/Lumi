# L'avvio guidato, i settori e i dati d'esempio

I primi tre minuti decidono se Lumi piace. Per questo il primo avvio non mostra un modulo da riempire ma una domanda per schermata, e alla fine un gestionale già cucito sul lavoro di chi lo usa.

## Il percorso

1. **Il nome dell'attività.**
2. **Le domande** (`DOMANDE` in `server/moduli/avvio-piano.js`): che lavoro fai, prodotti o servizi, magazzino, lavori su misura, appuntamenti, fornitori, fatture, quante persone, chi sono (solo se non sei da solo), Lumi, dati d'esempio. Scegliendo il settore le altre risposte si preimpostano su quelle tipiche; quelle toccate a mano restano.
3. **Il titolare** e il riepilogo di cosa verrà preparato.
4. **«Prepara Lumi»**: tutto in una transazione (se qualcosa non va, non resta niente a metà). Se ci sono altre persone, Lumi mostra una volta le loro password provvisorie.
5. **Il giro guidato**: quattro tappe sopra l'interfaccia vera (sezioni, Personalizza, Lumi, cruscotto). Si salta con «Salta» o Esc e si rifà da *Primi passi → Dati d'esempio e giro*.

## Dalle risposte al piano

`piano(risposte)` non scrive niente: restituisce i modelli da installare, cosa spegnere, i ruoli e le persone, e le sezioni che ne vengono fuori (l'anteprima dell'ultima schermata).

- **Il settore** sceglie il modello di partenza.
- **Le risposte «sì»** aggiungono quello che il settore non ha: i preventivi del laboratorio, l'agenda dello studio, i fornitori del negozio, il modello Fatture. Si può prendere un modello solo in parte: `{ id: "studio", entita: ["clienti", "servizi", "appuntamenti"] }`.
- **Le risposte «no»** spengono quello che ogni modello dichiara nei suoi `interruttori`:

```json
"interruttori": {
  "magazzino": { "campi": ["articoli.giacenza", "articoli.soglia", "articoli.da_riordinare"] },
  "fornitori": { "entita": ["fornitori", "ordini", "righe_ordine"] }
}
```

Le chiavi sono `magazzino`, `su_misura`, `appuntamenti`, `fornitori`, `prodotti` (spenti se vendi solo servizi) e `servizi` (spenti se vendi solo prodotti).

Una **sezione spenta** non si crea; con lei se ne vanno i collegamenti che la puntano, i calcolati che li usano e le righe nascoste rimaste senza padre. Un **campo spento** si crea ma resta archiviato: si riaccende da Personalizza → Ripristina, con i calcolati che dipendono da lui. Un'**automazione** si installa solo se tutto quello che tocca (campi, relazioni, formule) è acceso, perché altrimenti farebbe fallire i salvataggi.

La stessa sezione in due modelli (i clienti del negozio e quelli delle fatture) diventa una sola, con i campi di tutti e due.

## Ruoli e persone

Un modello può dichiarare i suoi `ruoli` (Banco, Sala e Cucina, Tecnico, Istruttore…), nel formato di `server/permessi.js`. Le persone dell'avvio ricevono uno di questi ruoli o uno di quelli di base; un ruolo che non esiste diventa «Collaboratore».

## Il cruscotto

Ogni modello può dichiarare il suo `cruscotto`: `widget` (numeri e grafici, come quelli di `server/moduli/agenda.js`) e voci di `attenzione`. All'avvio Lumi li unisce a quelli che l'agenda sa già fare per negozio, laboratorio e studio, e scarta quelli che usano campi spenti.

## I dati d'esempio

Stanno in `modelli/esempi/<modello>.json`, una lista di righe per sezione:

```json
{
  "clienti": [ { "#": "anna", "nome": "Anna Colombo", "telefono": "320 445 6672" } ],
  "vendite": [ { "data": "@oggi-2", "cliente": "#anna", "stato": "pagata", "righe": [ { "articolo": "#vaso", "quantita": 1, "prezzo": 38 } ] } ],
  "dopo": { "tavoli": [ { "#": "t2", "stato": "libero" } ] }
}
```

- `"#chiave"` dà un nome alla riga; `"#anna"` la collega. `"@oggi"`, `"@oggi-3"`, `"@oggi+1 10:30"` sono date e ore relative a oggi, nel fuso dell'azienda; `"@utente"` è il titolare.
- Si scrive con `dati.js` e i permessi del titolare: formule, numeratori e automazioni lavorano come sempre (la vendita pagata scala davvero il magazzino).
- `dopo` ritocca righe già create, quando le automazioni le hanno cambiate e serve un quadro credibile.
- I valori per campi spenti o sezioni assenti si saltano da soli.

Ogni riga creata, anche dalle automazioni e anche le righe figlie, finisce in `_avvio_esempi`. **«Togli i dati d'esempio»** le cancella tutte insieme al loro registro, scollega le righe vere che le puntavano e rimette la numerazione com'era dove non c'è ancora niente di vero: la prima fattura vera è la numero 1.

## Rotte

| | |
|---|---|
| `GET /api/avvio/domande` | domande, settori e risposte tipiche (prima dell'accesso) |
| `POST /api/avvio/piano` | `{ risposte }` → il piano, senza scrivere |
| `POST /api/avvio/configura` | `{ azienda, nome, email, password, risposte }` → il primo avvio completo |
| `GET /api/avvio/stato` | `{ giro, esempi, titolare }` |
| `POST /api/avvio/giro` | `{ fatto }` |
| `POST`/`DELETE /api/avvio/esempi` | mette o toglie i dati d'esempio (solo il titolare) |

`POST /api/configura` resta com'era, per chi installa i modelli a mano.

## Aggiungere un settore

1. Scrivi `modelli/<id>.json` con `entita`, `automazioni`, `interruttori`, `ruoli` e `cruscotto`. Le righe nascoste vanno prima dei padri, e una sezione che è righe di un'altra va prima di lei.
2. Scrivi `modelli/esempi/<id>.json`.
3. Aggiungi il settore a `SETTORI` in `server/moduli/avvio-piano.js`, con le sue risposte tipiche.
4. `npm test`: `test/avvio.test.mjs` installa ogni modello da solo e con tutti gli altri, mette i dati d'esempio e calcola il cruscotto.
