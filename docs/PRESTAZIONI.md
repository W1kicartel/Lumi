# Prestazioni

Lumi deve restare veloce anche quando l'azienda ha anni di dati: le liste sotto i 300 ms, gli aggregati sotto il secondo, anche con dieci persone collegate insieme.

## Come si misura

```bash
node test/carico.mjs                      # questo ramo
node test/carico.mjs --radice ../lumi     # un'altra copia (per esempio main): il «prima»
LUMI_SENZA_SQL=1 node test/carico.mjs     # questo ramo senza percorso SQL dei calcolati e senza indici
```

Lo script non fa parte di `npm test`. Crea un database in una cartella temporanea con il modello «negozio»:

- 50.000 articoli;
- 50.000 vendite con 200.000 righe;
- 10 persone collegate.

Poi misura ogni richiesta in due modi: da sola (mediana di 5) e con le 10 persone che la mandano nello stesso istante (la più lenta delle 10). Alla fine stampa il cruscotto widget per widget.

## Prima e dopo

Apple M2, Node 24.18, database su file (WAL). Tempi in millisecondi.

| prova | prima, da sola | prima, 10 insieme | dopo, da sola | dopo, 10 insieme |
|---|---:|---:|---:|---:|
| lista articoli (pagina 1) | 39 | 370 | 7 | 41 |
| lista articoli, pagina 500 | 74 | 719 | 9 | 80 |
| ricerca «tazza 12» | 20 | 186 | 13 | 109 |
| filtro su un calcolato: da riordinare | 77 | 761 | 8 | 63 |
| vendite ordinate per totale (calcolato) | 186 | 2035 | 8 | 59 |
| filtro su un calcolato: totale > 100 € | 173 | 1831 | 8 | 74 |
| aggregato: incassi per mese, un anno | 964 | 9732 | 36 | 312 |
| cruscotto completo | 265 | 2581 | 20 | 161 |
| Lumi riepilogo: venduto nel 2025 | 687 | 7078 | 45 | 420 |

Prima, i filtri e gli ordinamenti sui calcolati davano anche **risultati sbagliati** oltre le 5000 righe, perché si leggevano solo le prime 5000. Per esempio:

- 875 articoli da riordinare invece di 8.750;
- 5.000 vendite invece di 50.000.

Adesso i numeri sono giusti.

## Cosa è cambiato

1. **I calcolati semplici diventano SQL** (`server/moduli/sicurezza-sql.js`). Le formule si traducono in espressioni SQLite quando danno lo stesso risultato del motore: aritmetica, confronti, `E`/`O`/`NON`, `SE`, `ASS`, `ARROTONDA`, `OGGI()`, `GIORNI`, `SOMMA(righe.x)` e `relazione.campo`. Un test confronta ogni volta la strada SQL con quella in memoria. Così filtri e ordinamenti sui calcolati restano nel database, con `LIMIT` e `OFFSET`. Quello che non si traduce (`%`, `^`, `CONTA`, testo unito a numeri…) va per la strada di prima.
2. **Calcolati memorizzati.** `SOMMA(righe.x)` costa una lettura delle righe figlie per ogni riga. Per questo si memorizza in una colonna `m_<campo>` con il suo indice:
   - la colonna si riempie in un colpo solo con la stessa espressione SQL;
   - dopo resta al passo a ogni scrittura del padre o delle righe, nella stessa transazione;
   - se cambia la formula, o cambia una formula delle righe, cambia la traduzione e la colonna si riempie di nuovo.

   Non si memorizza niente che dipenda dal giorno (`OGGI()`) o da una riga collegata.
3. **Letture leggere per gli aggregati.** Cruscotto, `/api/aggregati` e il riepilogo di Lumi leggono solo le colonne che servono (anche i calcolati tradotti). Non passano dai titoli, dalle righe figlie e dai calcoli in memoria di ogni riga. Se qualcosa non si traduce, si torna alla lettura completa.
4. **Indici.** Per ogni entità c'è un indice su `(creato, id)` per l'ordine delle liste e uno per ogni campo data o data e ora. Si creano la prima volta che servono.
   - Non c'è `archiviato` in testa all'indice: altrimenti SQLite lo preferirebbe a quello della data nei filtri per periodo, e leggerebbe tutta la tabella.
   - Niente indici sugli stati: hanno pochi valori e ingannano il pianificatore.

## Limiti noti

- Le righe scritte direttamente nel database, senza passare da `dati.js`, non aggiornano i calcolati memorizzati: script esterni o un database copiato a mano. Si rimette tutto a posto cancellando la riga del campo da `_sicurezza_memo`, e la colonna si riempie di nuovo.
- Il server è un solo processo. Con dieci richieste pesanti nello stesso istante, l'ultima aspetta le altre: si vede nella colonna «10 insieme».
