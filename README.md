# Kubo

**Il gestionale open source che ogni azienda monta a modo suo.** Si parte da un modello del proprio settore (negozio, laboratorio, studio), poi si aggiungono campi, sezioni, flussi, automazioni e permessi da soli, senza scrivere codice e senza chiamare nessuno.

> **Stato: primi passi (0.1).** Il motore, le API e l'interfaccia di base funzionano e sono coperti dai test; il resto è nella [tabella di marcia](docs/PROGETTO.md#fasi).

## Perché è diverso

- **I dati restano in azienda.** Un unico file SQLite su un PC o un piccolo server dell'ufficio. Gli altri si collegano dal browser in rete locale. Funziona anche senza internet.
- **Zero dipendenze, zero build.** Basta Node ≥ 22.5: `npm start` e si apre. Il codice si legge e si modifica senza strumenti.
- **Tutto è uno schema.** Sezioni, campi, flussi di stato, formule, automazioni e permessi sono dati che si cambiano dall'interfaccia (**Personalizza**). Liste, schede, kanban e API si generano da lì.
- **Nessuna modifica perde dati.**
  - Rinominare un campo non tocca i valori.
  - Un campo tolto viene archiviato con i suoi valori.
  - Un cambio di tipo che perderebbe valori viene rifiutato e ti dice quali.
  - Ogni cosa finisce nella storia: chi, quando, prima → dopo.
- **Formule alla Excel, in italiano.** Per esempio `SOMMA(righe.totale)` o `SE(giacenza <= soglia; "riordina"; "")`. È lo stesso motore nel server e nel browser, ed è sicuro: niente `eval`.
- **Automazioni.**
  - «Quando la vendita diventa pagata, scala il magazzino.»
  - «Quando il preventivo è accettato, apri la commessa.»
  - «Quando l'appuntamento è fatto, conta la seduta del pacchetto.»

## Prova

```bash
npm start          # http://localhost:4380 · i dati in ./dati/kubo.db
npm start -- --rete   # anche dagli altri PC e telefoni della rete locale
npm test
```

Al primo avvio si sceglie il nome dell'azienda, si crea il titolare e si sceglie da quali modelli partire.

## Modelli inclusi

| | sezioni | automazioni |
|---|---|---|
| **Negozio e bottega** | clienti, fornitori, articoli (giacenza, scorta minima, margine), vendite con righe, ordini ai fornitori | scarico alla vendita pagata, reso all'annullo, carico all'arrivo dell'ordine |
| **Laboratorio e artigiano** | clienti, materiali, preventivi con voci e IVA, commesse a fasi con ore, materiali, costo e margine | il preventivo accettato apre la commessa, l'avvio scala i materiali |
| **Studio e servizi** | clienti, servizi, agenda, pacchetti di sedute | l'appuntamento fatto consuma una seduta |

## Come è fatto

Il disegno completo è in [docs/PROGETTO.md](docs/PROGETTO.md).

- **`server/`** (Node, nessuna dipendenza):
  - `schema.js`: lo schema diventa tabelle, senza perdite;
  - `dati.js`: CRUD generico, righe figlie, calcolati, registro;
  - `formule.js`, `permessi.js`, `automazioni.js`;
  - `auth.js`: scrypt, sessioni, PIN al banco;
  - `api.js`: REST, SSE, file statici.
- **`web/`**: l'interfaccia in moduli ES puri (lista, kanban, scheda, Personalizza, persone e permessi), aggiornata in tempo reale quando un collega modifica.
- **`modelli/`**: i modelli di settore in JSON. Per aggiungerne uno basta scrivere un file.

## Licenza

MIT. Il carattere Geist è © Vercel, con licenza SIL OFL 1.1.
