# Sicurezza

Kubo tiene i dati di un'azienda: clienti, prezzi, costi, fatture. Questa pagina dice cosa lo protegge, cosa si può regolare e cosa resta da fare. Il codice sta in `server/moduli/sicurezza.js` (con `sicurezza-rete.js`, `sicurezza-sql.js` e `sicurezza-migrazioni.js`) e in `web/moduli/sicurezza.js`. I test sono in `test/sicurezza.test.mjs`: ogni falla chiusa ha il suo.

## Accesso

- **Password.** Scrypt, con un sale per utente. Una password nuova (primo avvio, persona nuova, cambio) deve essere robusta:
  - almeno 8 caratteri, fuori dalle più usate;
  - diversa dal proprio nome e dalla propria email;
  - sotto i 12 caratteri, con lettere e cifre o simboli insieme.
- **Cambio della propria password e del PIN del banco.** Serve la password attuale, sia da *Sicurezza* sia da `PATCH /api/utenti/<io>`: chi trova un PC acceso non se li prende. Anche qui vale il limite di 5 tentativi in 15 minuti. Dopo il cambio della password si chiudono tutte le altre sessioni.
- **Cambio obbligatorio (facoltativo).** Chi gestisce le persone può chiedere a qualcuno di cambiare la password al prossimo accesso: *Sicurezza → Persone*. Finché non la cambia, il server risponde solo alle rotte per cambiarla, e l'interfaccia mostra una finestra che non si chiude.
- **Tentativi.** Il server già limitava i tentativi per indirizzo: 10 in 5 minuti. In più, 5 accessi sbagliati in 15 minuti bloccano quell'account, o quel PIN del banco, per 15 minuti. Gli altri account entrano lo stesso.

## Sessioni

- Il cookie è `HttpOnly` e `SameSite=Strict`. Ogni scrittura vuole l'intestazione `X-Kubo: 1`, che una pagina di un altro sito non può aggiungere (CSRF).
- **Inattività.** Una sessione ferma da più di 12 ore si chiude da sola. Il titolare sceglie il tempo, da 5 minuti a 30 giorni.
- **Dispositivi.** *Sicurezza → Dispositivi collegati* elenca le proprie sessioni: browser e sistema, ultimo uso, indirizzo. Si può scollegare un dispositivo o tutti gli altri. Il token non esce mai: ogni sessione ha un'impronta.
- Chi gestisce le persone può scollegare qualcuno da tutti i dispositivi.
- **Eventi in tempo reale.** A ogni evento la sessione si rilegge: un dispositivo scollegato, una persona disattivata o un ruolo cambiato smettono subito di ricevere aggiornamenti.

## Permessi

- **Calcolati che svelano un campo nascosto.** Se il costo è nascosto a un ruolo, anche `margine = (prezzo - costo) / prezzo` lo è: altrimenti il costo si ricava. Vale anche per le righe figlie (`SOMMA(righe.costo)`) e per le righe collegate (`fornitore.sconto`). La regola sta in `permessi.js` (`nascondiDerivati`), quindi vale ovunque: liste, schede, aggregati, esportazioni, stampe, Lumi, OpenAPI.
- **Storia di una riga.** Vale «solo i propri», e i valori dei campi nascosti non compaiono, nemmeno dentro le righe figlie.
- **Ordinamento.** Ordinare per un campo nascosto non ha effetto: l'ordine lo rivelerebbe.
- **Ripristino.** Rispetta «solo i propri».
- **Esportare la FatturaPA** è un potere esplicito del ruolo (`fatturapa`). Ogni esportazione consuma un numero progressivo d'invio, quindi il ruolo «Solo lettura» di base non ce l'ha. Il titolare lo cambia in *Sicurezza → Poteri dei ruoli*. Per un ruolo senza l'impostazione, conta il permesso di modificare le fatture.
- **Lumi per ruolo** (`lumi`): si spegne per un ruolo dalla stessa tabella.
- **Le modifiche di schema restano a chi personalizza.** Prima i campi fiscali dei clienti si aggiungevano da soli in tre momenti: all'avvio del server, a ogni esportazione FatturaPA (anche di un ruolo in sola lettura) e a ogni «crea fattura da». Adesso li aggiunge solo `POST /api/documenti/prepara`, che vuole il potere «schema»: l'interfaccia la chiama per chi ce l'ha.

## Fattura elettronica e indirizzo dei clienti

I modelli di settore avevano un campo libero «Indirizzo»; la fattura elettronica aggiunge via, CAP, comune e provincia. Con `prepara` il testo libero si scompone nei campi nuovi, solo dove questi sono vuoti. Per esempio «Via Roma 1, 20121 Milano (MI)» diventa:

- via: «Via Roma 1»;
- CAP: «20121»;
- comune: «Milano»;
- provincia: «MI».

Il vecchio campo si **archivia**: la colonna e i valori restano e si ripristina da Personalizza. Ogni riga toccata finisce nel registro (tipo `migrazione`, prima → dopo).

## Lumi

- **Budget mensile** di token per tutta l'azienda: *Sicurezza → Lumi: token al mese*, con 0 = nessun limite. I token si contano dall'evento finale dello streaming, per persona e per mese (`GET /api/sicurezza/lumi`). Finito il budget, Lumi risponde «ha usato tutti i token di questo mese».
- La chiave di Claude non arriva mai al browser: questo c'era già, vedi [LUMI.md](LUMI.md).

## Webhook e rete interna (SSRF)

Un webhook verso `127.0.0.1`, `192.168.x.x`, `10.x`, `169.254.169.254` (i metadati dei cloud), `::1` o un nome come `router.lan` farebbe di Kubo un ponte verso i servizi dell'ufficio. Per questo:

- **al salvataggio** si rifiuta l'indirizzo, e anche i numeri scritti in forme strane come `0x7f000001` o `2130706433`;
- **all'invio** si controlla l'indirizzo vero a cui ci si collega, dentro la connessione: un DNS che cambia risposta fra il controllo e l'invio (DNS rebinding) non passa;
- i redirect non si seguono.

Se serve davvero un webhook interno, il titolare lo permette in *Sicurezza* (o con `KUBO_WEBHOOK_INTERNI=1`).

## Allegati

- Niente programmi, script e pagine web: `.exe`, `.bat`, `.ps1`, `.js`, `.html`, `.svg`, `.php`, `.sh`, `.jar`… si rifiutano al caricamento.
- Il limite di dimensione lo sceglie il titolare: da 1 a 25 MB.
- I file si servono già con `Content-Disposition`, `nosniff` e una CSP `sandbox`. Le immagini e i PDF si vedono nel browser, tutto il resto si scarica.

## Intestazioni

L'interfaccia ha una **Content-Security-Policy stretta**:

- `script-src 'self'`: niente script in linea, niente CDN;
- `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`;
- `connect-src` solo verso sé e verso Deepgram, per la voce di Lumi.

In più: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy`.

Gli stili in linea restano permessi (`style-src 'unsafe-inline'`): li usano la stampa dei documenti e Lumi.

## Robustezza del server

- Un indirizzo con `%` rotti faceva cadere il server: una sola richiesta, senza accesso. Ora risponde 400.
- I file statici si servono solo da dentro `web/`, mai da una cartella vicina che inizia con «web».

## Fuso orario dell'azienda

L'impostazione `fuso` (predefinito `Europe/Rome`, in *Sicurezza → Impostazioni*) vale ovunque al posto del fuso del browser o del server:

- `OGGI()` nelle formule, nel server e nel browser;
- periodi e grafici del cruscotto;
- date di «Da vedere» e del riepilogo di Lumi;
- date e ore mostrate nelle liste, nelle schede e nella storia;
- il predefinito «@oggi» dei campi data.

## Per chi scrive moduli

- `k.controllo(f)` (vedi `server/moduli/LEGGIMI.md`) aggiunge un controllo prima di ogni rotta. Restituendo `{ ctx: null }` la richiesta diventa senza accesso.
- `D.estensioni.sqlCalcolato` e `D.estensioni.indici` sono le estensioni del motore usate dal percorso SQL.
- Dati degli utenti mai dentro `innerHTML` o `h(…, { html })`.

## Cosa resta da fare

- Il calendario dell'agenda e i filtri per data della lista calcolano ancora i giorni nel fuso del browser. Il server, le formule e le date mostrate usano già quello dell'azienda.
- I titoli delle righe collegate (es. il nome del fornitore in un articolo) si vedono anche da chi non può leggere quella sezione: fanno parte della riga che li cita.
- Il backup scaricabile contiene tutto il database. È solo del titolare, ma non è cifrato.
- Non c'è l'accesso a due fattori.
- Il blocco per account dopo 5 tentativi sbagliati si può usare per tenere fuori qualcuno per 15 minuti, sbagliando apposta la sua password. È il prezzo di fermare chi prova a indovinarla; il blocco per indirizzo resta separato.
