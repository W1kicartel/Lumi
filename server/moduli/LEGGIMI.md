# Moduli del server

Ogni file `*.js` di questa cartella esporta di default `registra(k)`. Il server li carica all'avvio, in ordine alfabetico.

`k` contiene:

- `r(metodo, percorso, f)`, per aggiungere una rotta come `r('GET', '/api/agenda/:e', ({ ctx, p, q, corpo }) => …)`. La funzione riceve anche `req` e `res`: se risponde da sé (per esempio in streaming, come Lumi), il server non aggiunge niente;
- `db`, il database;
- i moduli del motore: `S` schema, `D` dati, `P` permessi, `A` automazioni, `M` modelli, `U` utenti;
- `meta`, le impostazioni chiave → valore;
- `serve(ctx)`, che pretende un utente con l'accesso fatto;
- `ErroreHttp(stato, messaggio)`;
- `manda(evento)`, che manda un evento in tempo reale ai browser collegati;
- `controllo(f)`, per un controllo che gira prima di ogni rotta `/api/*`. `f({ req, res, ctx, token, metodo, percorso, corpo, ip })` lancia un errore per fermare la richiesta, o restituisce `{ ctx: null }` per trattarla come senza accesso. Per esempio `sicurezza.js` lo usa per le sessioni scadute, le password da cambiare e i tentativi di accesso.

Le regole:

- Ogni modulo usa solo questo contratto e il motore. Non modifica `api.js`.
- Le tabelle di sistema del modulo iniziano con `_<modulo>_`.
