# Lumi: quanto è facile collegare altri servizi

7 ottobre 2026. Ho letto il codice del gestionale (main, c56ee89) e ho scritto due integrazioni di prova in un worktree temporaneo (`prova-integrazioni`), con finti server locali. Il worktree e il ramo sono stati rimossi. Il codice di prova e la patch sono in `scratchpad/prova-integrazioni-codice/` (`prova-pagamenti.js`, `prova-negozio.js`, `prova-integrazioni.test.mjs`, `patch-api-prova.diff`).

---

## 1. Facilità di oggi: voto **5/10**

**In sintesi:**
- Le integrazioni **in uscita**, dove Lumi chiama un servizio, si scrivono bene già oggi con il contratto dei moduli.
- Quelle **in entrata**, dove un servizio chiama Lumi, sono **bloccate dal motore**: nessun pagamento tipo Stripe/SumUp, Woo, Shopify o WhatsApp può arrivare a Lumi senza ritoccare `api.js`.
- Tutto il resto si può fare, ma ogni connettore lo riscrive da zero:
  - segreti;
  - impostazioni;
  - coda;
  - pianificazione;
  - registro;
  - mappatura dei campi;
  - strumenti di Lumi.

### Cosa ho provato davvero

| Prova | Solo contratto dei moduli | Con la patch di 9 righe ad `api.js` |
|---|---|---|
| (a) Pagamenti tipo Stripe: webhook firmato `payment_intent.succeeded` → vendita «pagata» | **fallisce**: 403 «Richiesta senza intestazione X-Lumi». Anche aggiungendo X-Lumi a mano: 400, la firma non torna, perché il corpo è già stato trasformato in oggetto e ricostruirlo non dà gli stessi byte | **passa**: firma verificata sul corpo grezzo, tolleranza di 300 s contro il replay, idempotenza per `event.id`, controllo dell'importo, vendita → `pagata` |
| (b) WooCommerce: prodotti in entrata, giacenze in uscita | **passa**: 105 righe | passa |
| Catena completa | — | **passa**: Stripe paga → la vendita diventa `pagata` → l'automazione del modello «negozio» scala la giacenza → la coda manda `PUT stock_quantity` al finto Woo (Lumi 1 · negozio 1) |

La suite completa con i due moduli di prova: **92/93**. L'unica rossa è `lingue.test.mjs`: ogni messaggio d'errore dei moduli deve stare nel catalogo delle sei lingue, e quelli dei connettori non c'erano. È un buon paletto, ma è un altro passo per chi scrive un connettore.

La patch minima ad `api.js` (+9/−6) aggiunge alle rotte un parametro `r(metodo, percorso, f, { pubblica, grezzo })`:
- con `pubblica` la rotta non pretende X-Lumi, e si protegge da sola con la firma;
- con `grezzo` la rotta riceve il `Buffer` originale e il server non fa `JSON.parse` sui corpi che non sono JSON (form-urlencoded di Twilio e PayPal).

La rotta va trovata prima del controllo X-Lumi. Gli altri 92 test restano verdi.

### Attriti trovati (in ordine di gravità)

1. **Nessun webhook in entrata.** Una richiesta non GET pretende `X-Lumi: 1` o un `Bearer`, e nessun servizio esterno può mandarli. Il corpo viene consumato e trasformato con `JSON.parse` prima della rotta, quindi non si può verificare la firma HMAC:
   - Stripe: `Stripe-Signature`, sul corpo grezzo;
   - Woo: `X-WC-Webhook-Signature`, base64 HMAC-SHA256 del corpo;
   - Shopify: `X-Shopify-Hmac-Sha256`.

   I corpi form-urlencoded finiscono in «JSON non valido». Con il contratto attuale l'unico aggiramento è che il modulo apra un secondo server HTTP su un'altra porta, con proxy e TLS da configurare a parte: brutto.
2. **Nessun archivio dei segreti.** Lumi tiene la sua chiave in un file 600 accanto al db. Un connettore ha solo `meta`, che è in chiaro nel database e quindi finisce **nel backup zip**. Manca un posto comune, cifrato o almeno fuori dal db, con «c'è / non c'è / togli» e mai rimandato al browser.
3. **Nessuna identità di servizio.** Un connettore scrive con `ctx = null`, cioè «sistema» senza permessi. Nel `_registro` e in `modificato_da` risulta *nessuno*, non «Stripe» o «WooCommerce». Non si può limitare un connettore a certe sezioni.
4. **Nessuna coda in uscita riusabile.** `import-api.js` ha un'ottima outbox: transazionale, con tentativi crescenti e registro. Però è privata ai webhook. Nella prova Woo l'ho dovuta riscrivere in piccolo: coda, tentativi, «solo l'ultima giacenza conta».
5. **`sicurezza-rete.invia()` non basta come client HTTP.** Tronca la risposta a 4 KB e non restituisce le intestazioni, quindi niente paginazione `X-WP-TotalPages`. Per un'API vera si usa `fetch` e si perde la protezione SSRF/DNS-rebinding.
6. **Nessun pianificatore.** Il connettore usa `setInterval` in memoria:
   - non resta traccia dell'ultimo giro;
   - non si recupera dopo uno spegnimento;
   - non si possono dare orari («alle 3»);
   - niente impedisce due giri sovrapposti.

   Oggi `desktop.js`, `sicurezza.js`, `import-file.js` e `import-api.js` hanno ognuno il suo timer.
7. **Nessuna mappatura dei campi.** Lo schema è un dato: l'utente può rinominare o archiviare `codice`, `giacenza` e `prezzo`, e il connettore si rompe in silenzio. Servono campi «richiesti» dichiarati dal connettore e una tabella di abbinamento modificabile, come quella che l'import da Excel ha già (`proponiAbbinamento`).
8. **Nessun anti-eco negli eventi.** `D.ascolta` passa `interno` ma non l'**origine**. Per non rimandare al negozio ciò che arriva dal negozio serve un flag globale a mano (`ineco`). Inoltre gli ascoltatori sono globali al processo: bisogna sempre controllare `dbEv !== db`.
9. **Lumi non si estende da un modulo.** Gli strumenti si generano solo in `web/moduli/lumi/strumenti.js`, a partire dallo schema. Un connettore non può aggiungere «manda il promemoria WhatsApp» o «controlla il bonifico» senza modificare `lumi.js`, e il contratto dice di non toccare gli altri moduli.
10. **Nessuna pagina impostazioni standard né pagina di stato.** Ogni modulo web disegna da sé il suo modulo «chiave/segreto/URL/prova la connessione», il registro e il «sincronizza ora».
11. **Nessun OAuth.** Mancano il redirect `GET /api/…/oauth/callback` (che deve essere pubblico), lo `state` anti-CSRF e il refresh dei token. Servono per Google Calendar e Business Profile, Fatture in Cloud (OAuth2 code o device code), Shopify (client credentials, token di 24 h) e PayPal.
12. **Traduzioni obbligatorie** dei messaggi d'errore nei 6 cataloghi: è giusto, ma va previsto nel kit.

Quello che invece **c'è già ed è buono**:
- la firma HMAC in uscita con tempo (stile Stripe);
- la outbox transazionale;
- il blocco SSRF;
- i token personali con impronta;
- l'OpenAPI generato dallo schema;
- `D.ascolta` con prima/dopo;
- le automazioni che reagiscono anche alle scritture dei connettori: è la catena verificata sopra;
- `controllo()` e `prima()`;
- il test con finti server, che è facile: `listen(0)`.

---

## 2. Il «kit dei connettori»

### Principi

- **Un connettore è una cartella**: `connettori/<id>/` con `connettore.js`, più facoltativamente `web.js`, `lingue/` e `test.mjs`. Il nucleo `server/moduli/connettori.js` è un modulo come gli altri: carica le cartelle, offre i servizi comuni ed espone le rotte standard.
- **Il connettore dichiara, il nucleo fa.** Segreti, pianificazione, code, firma, registro, OAuth e pagina impostazioni li fornisce il nucleo. Il connettore scrive solo la logica del servizio.
- **L'AI propone, la persona decide**, anche per i connettori: gli strumenti di scrittura esposti a Lumi sono sempre `proponi + esegui`.

### Manifesto e interfaccia

```js
// connettori/stripe/connettore.js
export default {
  id: 'stripe', nome: 'Stripe', versione: 1, icona: 'carta',
  descrizione: 'Pagamenti online e POS: segna pagate le vendite.',
  // le impostazioni generano la pagina standard; «segreto: true» va nell'archivio dei segreti, mai al browser né nel backup in chiaro
  impostazioni: [
    { id: 'chiave', nome: 'Chiave segreta (sk_live_…)', tipo: 'testo', segreto: true, schema: /^sk_(live|test)_\w+$/ },
    { id: 'firma', nome: 'Segreto del webhook (whsec_…)', tipo: 'testo', segreto: true },
    { id: 'pagamento', nome: 'Metodo da segnare', tipo: 'scelta', opzioni: '@vendite.pagamento', predefinito: 'carta' },
  ],
  // i campi di Lumi che servono: il nucleo li abbina (come l'import da Excel) e avvisa se spariscono
  richiede: { vendite: { stato: { tipo: 'stato', opzioni: ['pagata'] }, totale: { tipo: 'calcolato' }, pagamento: { tipo: 'scelta' } } },
  // cosa può toccare: diventa il «ruolo» del connettore (identità di servizio, registro «Stripe»)
  permessi: { vendite: { leggi: true, modifica: true } },

  prova: async ({ http, segreti }) => (await http.get('https://api.stripe.com/v1/balance', { bearer: segreti.chiave })).ok,

  // webhook in entrata: URL pubblico /api/connettori/stripe/in, firma verificata dal nucleo prima di chiamare
  entrata: {
    firma: { tipo: 'stripe', segreto: 'firma' },   // anche 'hmac-base64' (Woo, Shopify), 'twilio', 'nessuna+richiama'
    idempotenza: ev => ev.id,
    async gestisci(ev, k) {
      if (ev.type !== 'payment_intent.succeeded') return 'ignorato';
      const pi = ev.data.object, v = await k.dati.leggi('vendite', pi.metadata.vendita);
      if (!v) return 'vendita sconosciuta';
      if (Math.abs(v.totale - pi.amount_received / 100) > 0.005) return k.avvisa(`Pagamento Stripe di ${pi.amount_received / 100} € diverso dal totale di ${v.numero}`);
      await k.dati.modifica('vendite', v.id, { stato: 'pagata', pagamento: k.imp.pagamento });
      return 'pagata';
    },
  },

  // azioni: bottoni nella scheda, chiamate da API, e (se lumi: true) strumenti di Lumi
  azioni: {
    link_pagamento: {
      nome: 'Crea link di pagamento', su: 'vendite', lumi: true, scrive: true,
      input: { vendita: { tipo: 'relazione', entita: 'vendite' } },
      proponi: async ({ vendita }, k) => ({ righe: [['Vendita', vendita.titolo], ['Importo', k.euro(vendita.totale)]] }),
      esegui: async ({ vendita }, k) => {
        const r = await k.http.post('https://api.stripe.com/v1/payment_links', { bearer: k.segreti.chiave, form: { /* … */ 'metadata[vendita]': vendita.id } });
        return { url: r.json.url };
      },
    },
  },
};
```

```js
// connettori/woocommerce/connettore.js: la parte di sincronizzazione
export default {
  id: 'woocommerce', nome: 'WooCommerce',
  impostazioni: [{ id: 'url', tipo: 'url' }, { id: 'ck', segreto: true }, { id: 'cs', segreto: true }],
  richiede: { articoli: { codice: { tipo: 'testo', unico: true }, nome: {}, prezzo: { tipo: 'valuta' }, giacenza: { tipo: 'numero' } } },
  permessi: { articoli: { leggi: true, crea: true, modifica: true }, vendite: { crea: true } },
  // mappatura proposta, modificabile nella pagina del connettore; «comanda» risolve i conflitti per campo
  mappe: {
    articoli: { remoto: 'products', chiave: ['codice', 'sku'], campi: [
      { locale: 'nome', remoto: 'name', comanda: 'remoto' },
      { locale: 'prezzo', remoto: 'regular_price', da: Number, a: String, comanda: 'remoto' },
      { locale: 'giacenza', remoto: 'stock_quantity', comanda: 'locale' },   // la cassa scala il magazzino: Lumi è il padrone
    ] },
  },
  // giri pianificati: il nucleo tiene «ultimo giro», «prossimo», impedisce i giri sovrapposti e recupera dopo uno spegnimento
  pianificati: { prodotti: { ogni: '15m', async giro(k) {
    for await (const p of k.http.pagine(`${k.imp.url}/wp-json/wc/v3/products?per_page=100`, { basic: [k.segreti.ck, k.segreti.cs], totale: 'x-wp-totalpages' }))
      await k.sincro.daRemoto('articoli', p);   // abbina per chiave, applica la mappa, scrive con origine = 'woocommerce'
  } } },
  // in uscita: il nucleo chiama questo quando cambia un campo mappato con comanda: 'locale', ma non se l'origine è questo connettore
  uscita: { articoli: { async invia(riga, cambiati, k) {
    await k.http.put(`${k.imp.url}/wp-json/wc/v3/products/${k.sincro.remoto(riga)}`, { basic: [k.segreti.ck, k.segreti.cs], json: { manage_stock: true, stock_quantity: riga.giacenza } });
  }, unisci: 'ultimo' } },   // nella coda conta solo l'ultimo valore per riga
  entrata: { firma: { tipo: 'hmac-base64', intestazione: 'x-wc-webhook-signature', segreto: 'webhook' },
    async gestisci(ordine, k) { /* order.created → crea la vendita «pagata»: l'automazione scala la giacenza */ } },
};
```

### Cosa dà il nucleo (`k` dei connettori)

| Servizio | Cosa fa | Da dove si parte |
|---|---|---|
| `k.segreti` | lettura dei soli segreti del connettore. Sono cifrati con AES-256-GCM, la chiave sta in un file 600 accanto al db (come `lumi-chiave`). Il backup contiene il cifrato; la chiave si esporta solo a parte | lo schema di `lumi.js` |
| `k.imp` | impostazioni non segrete, validate dal manifesto | `meta` con prefisso `conn.<id>.` |
| `k.dati` | `D.*` con un **ctx di servizio**: utente virtuale `servizio:<id>` con un ruolo costruito da `permessi`. Ogni scrittura ha `origine: '<id>'` nell'evento e nel registro | `P.ruolo`, `U.aggiungiVerificatore` |
| `k.http` | `get/post/put/pagine`, con timeout, risposta intera (fino a qualche MB), intestazioni, JSON/form, retry su 429/5xx con `Retry-After`. Controllo SSRF come `invia()` (rete interna solo se l'URL è nelle impostazioni del titolare). Mai segreti nei log | `sicurezza-rete.js`, generalizzato |
| entrata | `POST /api/connettori/:id/in[/:nome]`, pubblica e con corpo grezzo (la patch provata). Firme già pronte: `stripe`, `hmac-hex`, `hmac-base64`, `twilio`, `satispay-rsa`, `richiama` (SumUp: niente firma, si rilegge l'evento dall'API). Il nucleo applica idempotenza, limite di dimensione e di frequenza, risponde 200 subito e lavora in coda se serve | la patch di 9 righe |
| uscita | outbox transazionale comune: quella di `import-api.js`, resa riusabile (`accoda(connettore, chiave, corpo, { unisci })`), con gli stessi tentativi `ATTESE` e il registro | `import-api.js` |
| pianificatore | tabella `_connettori_giri(id, ultimo, prossimo, esito, durata)`, un solo timer per processo, un lucchetto per giro, recupero dei giri persi (al massimo uno) all'avvio. Si può scrivere `ogni: '15m'` oppure `alle: '03:00'` nel fuso dell'azienda | `agenda-aggregati.js` (fuso) |
| sincro | `_connettori_mappa(connettore, entita, riga, remoto, impronta, aggiornato)`, abbinamento per chiave, regola `comanda` per campo, anti-eco tramite `origine`, «tombstone» per le eliminazioni | — |
| registro | `_connettori_registro(connettore, quando, verso, esito, dettagli, durata)`, con conservazione di 90 giorni | — |
| OAuth | `oauth: { autorizza, token, scope, pkce: true }` nel manifesto. Il nucleo gestisce `GET /api/connettori/:id/oauth/inizio` (con `state` firmato e legato alla sessione del titolare), `/oauth/ritorno` (pubblica) e il rinnovo automatico del token. Anche *client credentials* (Shopify) e *device code* (Fatture in Cloud, adatto all'app desktop senza URL pubblico) | — |
| Lumi | gli strumenti `connettore_<id>_<azione>` con `lumi: true` si aggiungono a quelli dello schema: `GET /api/connettori/strumenti` restituisce le definizioni, e `strumenti.js` le fonde. Le azioni con `scrive: true` diventano `proponi + esegui`, con la scheda di conferma. Il pannello «Da vedere» riceve anche le voci dei connettori: giri falliti, consegne fallite, segreto mancante | `web/moduli/lumi/strumenti.js` (punto di estensione unico) |
| pagina | `#/connettori` (catalogo con installati e disponibili) e `#/connettori/:id`, generata dal manifesto: impostazioni, segreti («salvato · cambia · togli»), **Prova la connessione**, URL del webhook da copiare, mappatura, giri pianificati, registro, «sincronizza ora». Un `web.js` facoltativo aggiunge le parti speciali | `web/moduli/import.js` («API e integrazioni») |

### Sicurezza

- I segreti sono cifrati a riposo e non tornano mai al browser né a Lumi: Lumi vede solo «c'è / non c'è».
- I connettori si installano solo dalla cartella `connettori/` del server, oppure da un pacchetto con firma o somma SHA-256 pubblicata nel catalogo. Non si caricano dall'interfaccia: un connettore è codice che gira con i privilegi del server. Solo il titolare li attiva.
- Ogni connettore ha un ruolo minimo, dichiarato in `permessi` e mostrato prima dell'attivazione («Stripe potrà: leggere e modificare Vendite»). Le scritture compaiono nella storia come «Stripe».
- Le rotte in entrata sono pubbliche, ma i webhook senza firma valida vengono rifiutati, tranne il tipo `richiama`, che non si fida del corpo. Si applicano tolleranza sul tempo, idempotenza, limite di 1 MB e limite di frequenza per IP.
- `k.http` passa sempre dal controllo SSRF. Gli indirizzi interni (RT in negozio, CalDAV di casa) richiedono un consenso esplicito per singolo connettore, non globale.
- Ogni connettore ha l'interruttore spento/acceso. Spento, le rotte rispondono 404 e i giri si fermano.

### Test con finti server

Il nucleo offre `test/finto.mjs`:
- `finto({ 'GET /products': (q) => [...], 'PUT /products/:id': (p, corpo) => … })` restituisce `{ url, chiamate, chiudi }`;
- `firmaStripe(segreto, corpo)`, `firmaHmac64(...)` e `orologio.avanza('15m')` servono per i giri pianificati.

Ogni connettore ha un `test.mjs` con la stessa forma della prova fatta qui (88 righe), che parte con `npm test`. Nel catalogo entrano solo i connettori con test verdi e messaggi nel catalogo delle lingue.

### Installazione

1. `connettori/<id>/` nel repository: quelli ufficiali, mantenuti con Lumi.
2. `dati/connettori/<id>/` accanto al db: quelli dell'azienda o di terze parti, copiati a mano o scaricati da un catalogo con somma verificata.
3. Il nucleo li carica all'avvio. Se un connettore ha una `versione` diversa dalla precedente, il nucleo esegue la sua `migra(k, da)`.

Ordine di lavoro consigliato:
1. la patch delle rotte pubbliche con corpo grezzo, e l'archivio dei segreti;
2. outbox e pianificatore comuni, cioè la generalizzazione di quelli di `import-api.js`;
3. ctx di servizio e origine negli eventi;
4. pagina generata dal manifesto;
5. estensione degli strumenti di Lumi;
6. OAuth;
7. mappe e sincronizzazione.

Dopo i passi 1–3, i connettori della prova scendono da circa 150 righe a circa 40.

---

## 3. I servizi che un'attività italiana vorrebbe collegare

Priorità: **P1** = il primo anno, **P2** = dopo, **P3** = solo su richiesta. La difficoltà è per il connettore Lumi.

| # | Servizio | Prio | API reale e autenticazione | Costo indicativo | Cosa serve a un piccolo negozio | Difficoltà |
|---|---|---|---|---|---|---|
| 1 | **SDI tramite intermediario**: Openapi.it SDI | P1 | REST, token Bearer. Invio XML FatturaPA, ricezione passive, conservazione a 10 anni | prime 1.440 richieste/giorno gratis, poi da **0,025 € + IVA** a fattura | mandare le fatture già prodotte da `documenti-xml.js` e ricevere quelle dei fornitori | media: Lumi genera già l'XML; restano le notifiche di esito (RC/NS/MC) da tracciare |
| 2 | SDI: **Fatture in Cloud** API v2 | P1 | REST `api-v2.fattureincloud.it`. OAuth2 (codice, **device code**) o token manuale. Webhook | incluso negli abbonamenti FiC | per chi usa già FiC con il commercialista: sincronizzare clienti e fatture invece di inviare da Lumi | media (OAuth) |
| 3 | SDI: **Aruba Fatturazione Elettronica** | P1 | REST `ws.fatturazioneelettronica.aruba.it`, utente API dedicato, al massimo 1 autenticazione al minuto, file fino a 5 MB, ambiente DEMO | ~**29,90 € + IVA/anno** l'abbonamento base (opzione API da attivare) | come sopra, molto diffuso fra i piccoli | media |
| 4 | SDI: **A-Cube**, **Invoicetronic** | P2 | REST. A-Cube è accreditato AdE e Peppol e simula SDI in sandbox (SDI non ha sandbox). Invoicetronic ha SDK aperti | prezzi su richiesta o non pubblici | alternative per volumi o Peppol | media |
| 5 | **Stripe** (online + Terminal) | P1 | REST, chiave segreta. Webhook firmati (`Stripe-Signature`, HMAC sul corpo grezzo) | **1,5% + 0,25 €** carte UE standard, 2,8% + 0,25 € premium, 3,15% + 0,25 € internazionali. Terminal: **1,4% + 0,10 €** SEE | link di pagamento e acconti, vendita «pagata» da sola | **bassa**: provata qui |
| 6 | **SumUp** | P1 | REST, OAuth2 o chiave API. Webhook `CHECKOUT_STATUS_CHANGED` **senza firma**: la documentazione chiede di rileggere il checkout dall'API. Riprova dopo 1 min, 5 min, 20 min, 2 h | commissione per transazione (vedi listino IT) | il POS più diffuso fra i piccoli: riconciliazione degli incassi | bassa (tipo «richiama») |
| 7 | **Satispay** Business | P1 | REST. Firma **RSA** delle richieste (token di attivazione dalla dashboard → coppia di chiavi + keyId). Firma delle risposte facoltativa. Sandbox | commissioni Satispay (piccoli importi gratuiti, verificare il listino) | pagamenti al banco e online molto usati in Italia | media (firma HTTP RSA) |
| 8 | PayPal | P2 | REST, OAuth2 client credentials. Webhook verificati con chiamata API o certificato | commissioni PayPal | e-commerce | media |
| 9 | Nexi XPay | P2 | REST, chiave API e MAC/HMAC | contratto con la banca | chi ha il POS dalla banca | media-alta (documentazione a strati) |
| 10 | **WooCommerce** | P1 | REST `wc/v3`, chiavi consumer (Basic su HTTPS). Webhook con `X-WC-Webhook-Signature` (HMAC-SHA256 base64) | gratis (plugin) | catalogo e giacenze in comune, ordini web → vendite | **bassa**: provata qui |
| 11 | **Shopify** | P1 | Admin GraphQL. **Dal 1° gennaio 2026 niente nuove «custom app» legacy**: si crea l'app nel Dev Dashboard, con *client credentials* e token di 24 h da rinnovare. Webhook `X-Shopify-Hmac-Sha256` | piano Shopify | come Woo | media (token che scade, GraphQL) |
| 12 | PrestaShop | P3 | Webservice REST/XML, chiave | gratis | come Woo | media (XML) |
| 13 | **Google Calendar** | P1 | REST, OAuth2 (`calendar.events`), notifiche push via `watch` | gratis | appuntamenti dell'agenda Lumi sul telefono | media (OAuth) |
| 14 | **iCal (feed .ics) / CalDAV** | P1 | feed .ics in sola lettura con URL segreto; CalDAV con Basic o password per app (iCloud, Nextcloud) | gratis | «vedo l'agenda su iPhone»: il feed .ics è il 90% del valore con il 10% della fatica | bassa (.ics) / media (CalDAV) |
| 15 | **Email SMTP / IMAP + PEC** | P1 | SMTP con login o password per app, IMAP per leggere. La PEC (Aruba, Legalmail, Namirial…) è SMTP/IMAP con ricevute in XML | casella o PEC da ~5–10 €/anno | mandare fatture, preventivi e promemoria; leggere ricevute e PEC | media: SMTP senza dipendenze va scritto a mano (STARTTLS con `node:tls`) |
| 16 | **WhatsApp Business Platform** (Cloud API Meta, o via Twilio) | P1 | REST Graph API, token di sistema. Webhook firmati `X-Hub-Signature-256`. Modelli di messaggio approvati da Meta | a messaggio dal 1° luglio 2025: **utility in Italia ~0,03 $** fuori dalla finestra di 24 h, **gratis** dentro la finestra | promemoria degli appuntamenti, «il tuo ordine è pronto» | media-alta (verifica dell'azienda, modelli, consenso) |
| 17 | SMS (Twilio, Skebby, Aruba SMS) | P2 | REST, chiave. Twilio firma i webhook (`X-Twilio-Signature`, corpo form) | ~0,07–0,09 € a SMS | promemoria per chi non usa WhatsApp | bassa |
| 18 | **Registratore telematico (RT)** | P1 per i negozi | **Locale**: Epson FP-81 II / FP-90 III / RT Server con web service `fpmate.cgi` (XML ePOS-Print Fiscal) sulla rete del negozio. Custom e RCH hanno protocolli loro | gratis (l'RT si compra) | dalla vendita Lumi allo scontrino (documento commerciale) senza ribattere | **alta**: rete interna (va aperta l'eccezione SSRF per singolo connettore), stampanti diverse, errori fiscali, chiusure. Serve un RT fisico per provare |
| 19 | Corrieri via **Sendcloud** | P2 | REST, chiave pubblica e segreta. Un'API per BRT, Poste, GLS e 170+ corrieri | piani da 35 €/mese (28 annuale) + 0,11 € a etichetta. BRT da ~4,99 €, Poste da ~5,04 € | etichette e tracking dagli ordini web | bassa-media |
| 20 | BRT / Poste diretti | P3 | API proprie dei corrieri, con contratto | contratto | chi ha già un contratto | media-alta |
| 21 | **Google Business Profile** | P2 | REST, OAuth2. **Accesso da chiedere con un modulo** (risposta entro ~14 giorni). La scheda dev'essere completa e non appena verificata | gratis | rispondere alle recensioni, orari, post | media (approvazione) |
| 22 | **Open banking (AIS)**: Enable Banking | P2 | REST, chiave JWT dell'applicazione e consenso SCA del cliente ogni 90/180 giorni. Copertura in Italia in crescita: BPER, Poste/Postepay, Iccrea/BCC, Fineco, Banco BPM, Nexi | «Restricted Production» **gratis solo per conti collegati da sé**; produzione con contratto e KYB | movimenti bancari → riconciliare i bonifici con le fatture | alta (consenso, contratti, PSD2) |
| 23 | GoCardless Bank Account Data (ex Nordigen) | — | **niente nuove iscrizioni da luglio 2025**: non usare | — | — | — |
| 24 | Fabrick, Tink, Salt Edge | P3 | AISP regolati, OAuth2 e contratti | prezzi su contratto | per chi ha volumi | alta |
| 25 | Firma digitale (Namirial, InfoCert, Aruba Sign, Yousign) | P3 | REST, chiavi e flussi OTP/SPID | a firma o a pacchetto | contratti di noleggio e preventivi firmati | media |
| 26 | Conservazione sostitutiva | P2 | di solito **inclusa nell'intermediario SDI** (Openapi, Aruba, FiC, A-Cube) | inclusa o pochi €/anno | obbligo per le fatture: farla fare all'intermediario | bassa se legata al n. 1–3 |

### Priorità consigliata (per il negozio tipo, come il modello «negozio»)

1. **Un intermediario SDI**: Openapi.it per il costo a consumo, oppure Aruba o Fatture in Cloud se il cliente li usa già, con conservazione inclusa.
2. **Stripe + SumUp + Satispay**: incassi → vendite pagate.
3. **WooCommerce / Shopify**: catalogo e giacenze.
4. **Feed .ics + Google Calendar** per l'agenda.
5. **Email SMTP/PEC + WhatsApp** per i promemoria.
6. **RT Epson** per gli scontrini.
7. Sendcloud, Google Business, open banking (Enable Banking), firma.

### Fonti

- [Stripe, tariffe Italia](https://stripe.com/it/pricing)
- [Fatture in Cloud, autenticazione API](https://developers.fattureincloud.it/docs/authentication/)
- [Openapi SDI](https://console.openapi.com/apis/sdi/info)
- [Openapi, fatturazione elettronica](https://openapi.it/en/digital-trust/electronic-invoicing)
- [Aruba, API di fatturazione](https://fatturazioneelettronica.aruba.it/apidoc/docs_EN.html)
- [Aruba, recensione 2026 (prezzi)](https://centrofiscale.com/aruba-fatturazione-elettronica-recensione-2026/)
- [Invopop: A-Cube e la sandbox SDI](https://docs.invopop.com/apps/sdi-italy)
- [Invoicetronic, SDK PHP](https://github.com/invoicetronic/php-sdk)
- [GoCardless BAD, annuncio](https://gocardless.com/bank-account-data/announcement)
- [Alternative a GoCardless BAD](https://dev.to/johnfrandsen/gocardless-bank-account-data-alternatives-what-to-use-when-signups-are-disabled-326d)
- [Open banking gratuiti](https://openbankingtracker.com/guides/free-open-banking-apis)
- [Enable Banking, changelog marzo 2026](https://enablebanking.com/blog/2026/04/08/enable-banking-changelogmarch-2026)
- [Satispay, convenzioni API](https://developers.satispay.com/reference/conventions)
- [SumUp, webhook](https://developer.sumup.com/online-payments/webhooks/)
- [Meta, prezzi WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Shopify, custom app legacy dal 2026](https://community.shopify.dev/t/starting-january-1-2026-you-will-not-be-able-to-create-new-legacy-custom-apps-this-will-not-impact-any-existing-apps/26798)
- [Epson ePOS Fiscal Print, guida per sviluppatori](https://www.scontrinosmart.it/en/fp81ii/documents/epos-fiscal-print-solution-dev-guide/info)
- [Agenzia delle Entrate, specifiche RT](https://www.agenziaentrate.gov.it/portale/documents/20143/4952835/Specifiche_Tecniche_RT_V11.pdf/246859ea-1586-5164-daf9-af01779de295)
- [Google Business Profile, prerequisiti](https://developers.google.com/my-business/content/prereqs)
- [Sendcloud, prezzi](https://www.sendcloud.com/it/prezzi/)
- [Sendcloud, BRT API](https://www.sendcloud.com/carrier-apis/brt-api/)

Prezzi da ricontrollare prima di un preventivo: SumUp, Satispay, Nexi, A-Cube e Invoicetronic non pubblicano un listino API chiaro, o non l'ho trovato.
