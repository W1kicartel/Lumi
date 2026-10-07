# Import, export, allegati, API e webhook

Tutto senza dipendenze: lo zip dei file `.xlsx` si legge e si scrive con `node:zlib`, il CSV con un piccolo lettore.

## Importare

**Importa ed esporta** (barra laterale), oppure **Excel → Importa** nella testa di una lista.

1. Scegli dove vanno le righe: una sezione che c'è già, oppure **una nuova sezione dal foglio**.
2. Carica il file `.xlsx` o `.csv`, anche trascinandolo. La prima riga deve avere i nomi delle colonne.
3. Kubo mostra le prime righe e abbina da solo le colonne ai campi: nomi uguali o simili, e sinonimi come «E-mail», «Cell.» e «Ragione sociale». Ogni abbinamento si può cambiare, oppure si sceglie **+ Crea il campo** e il tipo viene indovinato dai valori.
4. **Righe già presenti**: scegli un campo che le riconosce (di solito quello «senza doppioni», come l'email) e cosa fare quando ne trova una: aggiornarla o saltarla. Anche i doppioni dentro lo stesso file finiscono su una riga sola.
5. **Prova senza salvare** fa tutto il giro e poi annulla. **Importa** salva tutto in una transazione.

Il rapporto finale dice quante righe sono state create, aggiornate o saltate e quante hanno errori. Le righe sbagliate si scaricano in un CSV con la colonna «Errore»: le correggi e le reimporti.

Valori accettati:

| campo | esempi |
|---|---|
| numero, importo, percentuale | `1.234,50` · `1234.5` · `€ 12` · `22%` · `(15,00)` = −15 |
| data | `31/12/2026` · `31-12-26` · `31.12.2026` · `2026-12-31` · le date vere di Excel |
| data e ora | `31/12/2026 14:30` · ISO 8601 |
| sì / no | `sì` `si` `x` `vero` `1` · `no` `falso` `0` |
| scelta, stato | l'id o il nome dell'opzione, maiuscole e minuscole non contano |
| collegamento | il nome della riga collegata (per esempio il nome del cliente) o il suo id |
| persona | nome, email o id |

Le celle vuote non cancellano niente. Il CSV può essere UTF-8 o Windows-1252, con separatore `;`, `,` o tabulazione. Il vecchio `.xls` non si legge: va salvato come `.xlsx`.

**Scarica il modello da compilare** produce un `.xlsx` vuoto con le colonne giuste.

## Esportare e fare il backup

- **Excel → Esporta** nella testa di una lista scarica `.xlsx` o `.csv` con la ricerca, i filtri e l'ordine di quel momento. I campi nascosti al tuo ruolo non ci sono. L'xlsx ha importi in euro, date vere, intestazione bloccata e filtri.
- Il CSV usa `;` e la virgola decimale, così Excel in italiano lo apre senza domande. I testi che inizierebbero con `=`, `+`, `-` o `@` prendono un apostrofo davanti, così non diventano formule. Reimportando, l'apostrofo si toglie.
- **Backup completo** (solo il titolare): uno zip con la copia del database fatta con `VACUUM INTO`, coerente anche mentre altri lavorano, più gli allegati e un `LEGGIMI.txt` che spiega come ripristinare.

## Allegati (campi «file» e «immagine»)

- I file si caricano a pezzi da 1 MB in base64: `POST /api/file/carica` e poi `POST /api/file/carica/:id`. Il limite è 25 MB per file e 1 GB al giorno per persona.
- Al salvataggio della riga i file passano in `dati/file/<sezione>/<riga>/<id>`. Sul disco il nome è sempre l'id, mai quello dato dall'utente.
- Il salvataggio si annulla in tre casi: il file non è stato caricato, è stato caricato da un'altra persona, oppure in un campo «immagine» arriva qualcosa che non è un'immagine.
- `GET /api/file/:sezione/:riga/:campo/:id` controlla i permessi della riga («solo i propri» compreso) e dei campi nascosti.
- Solo immagini e PDF si aprono nel browser, con `nosniff` e `CSP sandbox`. Tutto il resto si scarica come allegato.
- Le immagini si vedono in anteprima nella scheda e come miniatura nella prima colonna della lista.

## API pubblica

In **API e integrazioni** ognuno crea i suoi token: un nome, una scadenza (30 giorni, 90, un anno o mai).

- Il token si vede una volta sola. Nel database resta solo la sua impronta SHA-256.
- Con `Authorization: Bearer kubo_…` vale per tutte le `/api/*` e ha gli stessi permessi del ruolo di chi l'ha creato.
- Con un token non si creano altri token, non si gestiscono i webhook e non si scarica il backup.
- La pagina contiene la documentazione generata dallo schema: campi, formati ed esempi `curl` per ogni sezione.
- `GET /api/openapi.json` dà la descrizione OpenAPI 3, utile per Postman, Swagger o per generare un client.

```bash
curl -H "Authorization: Bearer $KUBO_TOKEN" "http://localhost:4380/api/dati/clienti?q=rossi"
curl -X POST -H "Authorization: Bearer $KUBO_TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Bar Centrale","email":"bar@centrale.it"}' http://localhost:4380/api/dati/clienti
```

## Webhook

I webhook li gestisce solo il titolare. Per ogni webhook si sceglie un indirizzo, le sezioni (oppure tutte) e gli eventi: creato, modificato, archiviato, ripristinato. Kubo manda un `POST` JSON:

```json
{ "evento": "clienti.crea", "entita": "clienti", "id": "…", "tipo": "crea", "quando": "…", "da": "<id persona>",
  "dati": { … la riga dopo … }, "prima": { … solo per modifica ed elimina … }, "consegna": 42 }
```

Le intestazioni sono `X-Kubo-Evento`, `X-Kubo-Consegna`, `X-Kubo-Tempo` e `X-Kubo-Firma: sha256=<HMAC-SHA256 del segreto su "<tempo>.<corpo>">`.

- La consegna si scrive nella stessa transazione della modifica: se la modifica si annulla, non parte niente.
- La spedizione avviene dopo.
- Se l'indirizzo non risponde 2xx, Kubo riprova dopo 30 s, 2 min, 10 min, 30 min e 2 h. Dopo l'ultimo tentativo la consegna risulta «fallita» e si può riprovare a mano.
- Il registro mostra stato, tentativi, codice e inizio della risposta.

## File

- `server/moduli/import-formati.js`: zip, xlsx, CSV, valori all'italiana, tipi indovinati, abbinamento. Funzioni pure, senza rotte.
- `server/moduli/import.js`: anteprima, import, export, backup.
- `server/moduli/import-file.js`: caricamenti a pezzi, allegati, scaricamento.
- `server/moduli/import-api.js`: token, OpenAPI, webhook.
- `web/moduli/import.js` e `import.css`: le pagine «Importa ed esporta» e «API e integrazioni», più il menu «Excel» delle liste.
- Le tabelle di sistema sono `_import_caricamenti`, `_import_token`, `_import_webhook` e `_import_consegne`.
- Ritocchi al motore:
  - `api.js`: una rotta può rispondere da sé con `res`;
  - `auth.js`: `aggiungiVerificatore` per i token;
  - `dati.js`: valori dei campi file con `url`, validati;
  - `campi.js`: l'editor degli allegati;
  - `ui.js`: miniature;
  - `viste.js`: colonna immagine e `dataset.query` per l'export;
  - `stile.css`: stile degli allegati, griglia sul telefono.
