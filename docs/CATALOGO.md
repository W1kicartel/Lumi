# Catalogo delle integrazioni

Generato da `npm run catalogo` dai manifesti in `connettori/`: non modificarlo a mano. 13 integrazioni in 7 categorie.
Come si scrive un connettore e il suo blocco «catalogo»: [CONNETTORI.md](CONNETTORI.md).

«Provato con un servizio finto» vuol dire che le prove automatiche usano un server finto che risponde come quello vero, secondo la documentazione delle fonti: prima di affidarti, fai una prova nella modalità test del servizio.

| Integrazione | Categoria | Costo | Difficoltà | Provato |
|---|---|---|---|---|
| [Stripe](#stripe) | Pagamenti | A consumo | Media | servizio finto |
| [SumUp](#sumup) | Cassa e POS | A consumo | Facile | servizio finto |
| [Shopify](#shopify) | Negozi online | In abbonamento | Media | servizio finto |
| [WooCommerce](#woocommerce) | Negozi online | Gratis | Media | servizio finto |
| [Openapi SDI](#openapi-sdi) | Fatturazione | A consumo | Media | servizio finto |
| [Email e PEC](#posta) | Email | Gratis | Facile | servizio finto |
| [Calendario](#calendario) | Calendario | Gratis | Facile | servizio finto |
| [HTTP / API REST](#http) | Automazione | Gratis | Per smanettoni | servizio finto |
| [Make](#make) | Automazione | Gratis | Facile | servizio finto |
| [n8n](#n8n) | Automazione | Gratis | Media | servizio finto |
| [Pipedream](#pipedream) | Automazione | Gratis | Media | servizio finto |
| [Webhook](#webhook) | Automazione | Gratis | Media | servizio finto |
| [Zapier](#zapier) | Automazione | In abbonamento | Facile | servizio finto |

## Pagamenti (1)

<a id="stripe"></a>
### Stripe · `stripe`

Pagamenti online e POS: le vendite e le fatture si segnano pagate da sole.

- **Costo:** A consumo (1,5% + 0,25 € per le carte europee standard, senza canone)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave segreta (sk\_live\_…) o con restrizioni (rk\_live\_…)](https://dashboard.stripe.com/apikeys) (Dashboard → Sviluppatori → Chiavi API); [Segreto di firma del webhook (whsec\_…)](https://dashboard.stripe.com/webhooks) (Dashboard → Sviluppatori → Webhook → il tuo endpoint)
- **Passi:** 1. Apri la Dashboard di Stripe e vai in Sviluppatori → Chiavi API 2. Crea una chiave con restrizioni (o copia la chiave segreta) e incollala qui 3. In Sviluppatori → Webhook aggiungi un endpoint con l'indirizzo del webhook di questa pagina 4. Scegli gli eventi payment\_intent.succeeded, checkout.session.completed e checkout.session.async\_payment\_succeeded 5. Copia il segreto di firma (whsec\_…) e incollalo qui 6. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://stripe.com/it) · [fonte 1](https://docs.stripe.com/keys) · [fonte 2](https://docs.stripe.com/webhooks) · [fonte 3](https://stripe.com/it/pricing)

## Cassa e POS (1)

<a id="sumup"></a>
### SumUp · `sumup`

Il POS e i pagamenti SumUp riconciliano gli incassi con le vendite.

- **Costo:** A consumo (Una commissione per transazione, senza canone: la tariffa dipende dal piano e dalla carta)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API segreta (sup\_sk\_…)](https://me.sumup.com/settings/api-keys) (Dashboard SumUp → Impostazioni → Chiavi API); [Codice esercente (merchant code)](https://me.sumup.com) (Dashboard SumUp → Profilo: il codice che inizia con M)
- **Passi:** 1. Entra nella dashboard di SumUp 2. Apri Impostazioni → Chiavi API e crea una chiave segreta 3. Incolla la chiave qui e scrivi il codice esercente 4. Salva, prova la connessione e accendi 5. I checkout creati da Kubo avvisano Kubo da soli: non c'è un webhook da configurare
- **Sito e fonti:** [sito](https://www.sumup.com/it-it/) · [fonte 1](https://developer.sumup.com/api) · [fonte 2](https://developer.sumup.com/online-payments/webhooks/)

## Negozi online (2)

<a id="shopify"></a>
### Shopify · `shopify`

Il negozio Shopify: catalogo e giacenze in comune, gli ordini diventano vendite.

- **Costo:** In abbonamento (Serve un piano Shopify; l'app personalizzata non costa niente in più)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Nome del negozio (….myshopify.com)](https://admin.shopify.com) (Admin di Shopify → Impostazioni → Domini); [Client ID e client secret di un'app](https://shopify.dev/docs/apps/build/dev-dashboard) (Dev Dashboard di Shopify → la tua app → Impostazioni); [Id del magazzino (gid://shopify/Location/…)](https://help.shopify.com/it/manual/locations) (Admin → Impostazioni → Località: il numero in fondo all'indirizzo della località)
- **Passi:** 1. Apri il Dev Dashboard di Shopify e crea un'app 2. Dai all'app gli scope read\_products, write\_products, read\_inventory, write\_inventory e read\_orders 3. Installa l'app sul tuo negozio 4. Copia client ID e client secret e incollali qui 5. Scrivi il nome del negozio e l'id del magazzino 6. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://www.shopify.com/it) · [fonte 1](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant) · [fonte 2](https://shopify.dev/docs/api/admin-graphql)

<a id="woocommerce"></a>
### WooCommerce · `woocommerce`

Il negozio online: catalogo e giacenze in comune, gli ordini del sito diventano vendite.

- **Costo:** Gratis (WooCommerce è gratuito: paghi solo l'hosting del tuo sito WordPress)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Consumer key (ck\_…) e consumer secret (cs\_…) con permessi di lettura e scrittura](https://woocommerce.com/document/woocommerce-rest-api/) (WordPress → WooCommerce → Impostazioni → Avanzate → REST API); [Segreto dei webhook (lo inventi tu)](https://woocommerce.com/document/webhooks/) (WooCommerce → Impostazioni → Avanzate → Webhook)
- **Passi:** 1. Nel pannello di WordPress apri WooCommerce → Impostazioni → Avanzate → REST API 2. Aggiungi una chiave con permessi «Lettura/Scrittura» e copia consumer key e consumer secret 3. Incollale qui insieme all'indirizzo del sito 4. In Avanzate → Webhook crea un webhook «Ordine creato» con l'indirizzo del webhook di questa pagina 5. Inventa un segreto lungo e scrivilo sia nel webhook sia qui 6. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://woocommerce.com) · [fonte 1](https://woocommerce.github.io/woocommerce-rest-api-docs/) · [fonte 2](https://woocommerce.com/document/webhooks/)

## Fatturazione (1)

<a id="openapi-sdi"></a>
### Openapi SDI · `openapi-sdi`

Manda allo SDI le fatture elettroniche di Kubo e ricevi notifiche e fatture dei fornitori.

- **Costo:** A consumo (A consumo per fattura inviata o ricevuta, con credito prepagato: vedi il listino di Openapi)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Token Bearer con gli scope dell'API SDI](https://console.openapi.com) (Console di Openapi → Token)
- **Passi:** 1. Registrati sulla console di Openapi e attiva l'API SDI 2. Crea un token con gli scope dell'API SDI, prima per l'ambiente di prova 3. Incolla il token qui e lascia l'ambiente su «prova» 4. Accendi: Kubo genera il codice segreto del callback 5. Copia l'indirizzo del webhook e registralo come callback nella configurazione SDI di Openapi 6. Quando le prove vanno, passa a «produzione» con un token di produzione
- **Sito e fonti:** [sito](https://openapi.com) · [fonte 1](https://console.openapi.com/apis/sdi/documentation)

## Email (1)

<a id="posta"></a>
### Email e PEC · `posta`

Manda fatture e promemoria ai clienti dalla tua casella email o PEC.

- **Costo:** Gratis (Usa la casella che hai già, email o PEC: nessun costo in più)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** Server SMTP, porta e sicurezza (La guida del tuo provider (per la PEC Aruba: smtps.pec.aruba.it, porta 465, TLS)); [Utente e password (o password per le app)](https://support.google.com/accounts/answer/185833) (Il tuo account email; con Gmail e la verifica in due passaggi serve una password per le app)
- **Passi:** 1. Cerca nella guida del tuo provider i dati SMTP: server, porta e sicurezza 2. Se usi la verifica in due passaggi (Gmail, Outlook), crea una password per le app 3. Scrivi qui server, porta, sicurezza, utente e password 4. Scrivi il mittente come vuoi che lo vedano i clienti 5. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://www.rfc-editor.org/rfc/rfc5321) · [fonte 1](https://www.rfc-editor.org/rfc/rfc5321) · [fonte 2](https://support.google.com/accounts/answer/185833)

## Calendario (1)

<a id="calendario"></a>
### Calendario · `calendario`

L'agenda sul telefono: feed .ics da aggiungere al calendario, oppure Google Calendar.

- **Costo:** Gratis (Il feed .ics e Google Calendar sono gratuiti)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** Niente per il feed .ics: l'indirizzo segreto lo crea Kubo (In questa pagina, dopo l'accensione); [Per Google Calendar (facoltativo): client ID e client secret OAuth](https://console.cloud.google.com/apis/credentials) (Google Cloud Console → API e servizi → Credenziali → ID client OAuth (applicazione web))
- **Passi:** 1. Accendi: Kubo crea l'indirizzo segreto del feed 2. Copia l'indirizzo e aggiungilo al calendario del telefono («Iscriviti a un calendario») 3. Per Google Calendar: in Google Cloud Console abilita la Google Calendar API e crea un ID client OAuth 4. Come URI di reindirizzamento metti l'indirizzo di Kubo seguito da /api/connettori/calendario/oauth/ritorno 5. Incolla client ID e client secret qui e premi «Collega l'account»
- **Sito e fonti:** [sito](https://calendar.google.com) · [fonte 1](https://www.rfc-editor.org/rfc/rfc5545) · [fonte 2](https://developers.google.com/calendar/api/guides/overview) · [fonte 3](https://developers.google.com/identity/protocols/oauth2/web-server)

## Automazione (6)

<a id="http"></a>
### HTTP / API REST · `http`

Collega qualsiasi servizio con un'API REST, senza scrivere codice: ricette in uscita, bottoni e webhook in entrata.

- **Costo:** Gratis (Gratis in Kubo: paghi solo il servizio che colleghi, se è a pagamento)
- **Difficoltà:** Per smanettoni · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** L'indirizzo base dell'API (es. https://api.servizio.it/v1) (La documentazione per sviluppatori del servizio); La chiave, il token o le credenziali OAuth2 (Le impostazioni del tuo account sul servizio, di solito «API» o «Sviluppatori»)
- **Passi:** 1. Cerca nella documentazione del servizio l'indirizzo base e il tipo di autenticazione 2. Scrivi qui l'indirizzo base, scegli l'autenticazione e incolla la chiave 3. Aggiungi una ricetta: in uscita (quando cambia una riga), azione (un bottone nella scheda) o in entrata 4. Nel percorso e nel corpo usa i segnaposto come {email} o {cliente.titolo} 5. Per le ricette in entrata copia l'indirizzo che compare sotto la ricetta e incollalo nel servizio 6. Salva, prova la connessione e accendi: il registro mostra ogni richiesta partita o arrivata
- **Sito e fonti:** [sito](https://www.rfc-editor.org/rfc/rfc9110) · [fonte 1](https://www.rfc-editor.org/rfc/rfc9110) · [fonte 2](https://www.rfc-editor.org/rfc/rfc6749#section-4.4) · [fonte 3](https://www.rfc-editor.org/rfc/rfc2104)

<a id="make"></a>
### Make · `make`

Kubo negli scenari di Make: un evento in una sezione avvia uno scenario, e uno scenario crea o aggiorna righe in Kubo.

- **Costo:** Gratis (Il piano Free ha un numero limitato di operazioni al mese; oltre serve un piano a pagamento)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo del Custom webhook (https://hook.\<zona\>.make.com/…)](https://www.make.com/en/help/tools/webhooks) (Make → scenario → modulo «Webhooks» → «Custom webhook» → Aggiungi)
- **Passi:** 1. In Make crea uno scenario e come primo modulo scegli «Webhooks» → «Custom webhook» 2. Premi «Aggiungi», dai un nome al webhook e copia l'indirizzo 3. Qui aggiungi una ricetta «in uscita»: scegli la sezione e gli eventi, incolla l'indirizzo 4. Accendi, premi «Run once» in Make e crea una riga in Kubo: Make impara la struttura dei dati 5. Per scrivere in Kubo dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all'indirizzo che compare sotto (Kubo deve essere raggiungibile da internet): in Make usa il modulo «HTTP» → «Make a request», metodo POST, corpo JSON 6. Attiva lo scenario
- **Sito e fonti:** [sito](https://www.make.com) · [fonte 1](https://www.make.com/en/help/tools/webhooks) · [fonte 2](https://www.make.com/en/help/app/http)

<a id="n8n"></a>
### n8n · `n8n`

Kubo nei flussi di n8n, anche installato sul tuo computer: eventi verso n8n e righe create da n8n.

- **Costo:** Gratis (Gratis se lo installi tu (Community Edition); n8n Cloud è in abbonamento)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo di produzione del nodo Webhook (…/webhook/\<percorso\>)](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) (n8n → workflow → nodo «Webhook» → Production URL); Se il Webhook usa Header Auth: il nome e il valore dell'intestazione (n8n → nodo «Webhook» → Authentication → Header Auth)
- **Passi:** 1. In n8n crea un workflow con il nodo «Webhook», metodo POST 2. Copia la «Production URL» e attiva il workflow 3. Qui aggiungi una ricetta «in uscita» con quell'indirizzo; se usi Header Auth, mettila in «Intestazioni in più» 4. Se n8n gira in negozio o sullo stesso computer, spunta «Permetti indirizzi della rete interna» 5. Per scrivere in Kubo dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all'indirizzo che compare sotto (Kubo deve essere raggiungibile da internet): in n8n usa il nodo «HTTP Request», metodo POST, «Send Body» in JSON 6. Per leggere e scrivere tutto il resto importa in n8n la descrizione OpenAPI di Kubo con un token personale
- **Sito e fonti:** [sito](https://n8n.io) · [fonte 1](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) · [fonte 2](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)

<a id="pipedream"></a>
### Pipedream · `pipedream`

Kubo nei workflow di Pipedream: eventi verso Pipedream e righe create o aggiornate dai tuoi passi.

- **Costo:** Gratis (Il piano Free ha crediti limitati al mese; oltre serve un piano a pagamento)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo del trigger HTTP (https://….m.pipedream.net)](https://pipedream.com/docs/workflows/building-workflows/triggers/) (Pipedream → nuovo workflow → trigger «HTTP / Webhook» → «New Requests»)
- **Passi:** 1. In Pipedream crea un workflow con il trigger «HTTP / Webhook» → «New Requests» 2. Copia l'indirizzo che ti dà Pipedream 3. Qui aggiungi una ricetta «in uscita»: scegli la sezione e gli eventi, incolla l'indirizzo 4. Accendi e crea una riga in Kubo: l'evento compare nel trigger di Pipedream 5. Per scrivere in Kubo dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all'indirizzo che compare sotto (Kubo deve essere raggiungibile da internet): in Pipedream aggiungi un passo «HTTP / Webhook» → «Send any HTTP Request», metodo POST 6. Fai il deploy del workflow
- **Sito e fonti:** [sito](https://pipedream.com) · [fonte 1](https://pipedream.com/docs/workflows/building-workflows/triggers/) · [fonte 2](https://pipedream.com/docs/)

<a id="webhook"></a>
### Webhook · `webhook`

Webhook generici: gli eventi di una sezione verso qualsiasi indirizzo, firmati, e un indirizzo segreto per scrivere in Kubo.

- **Costo:** Gratis (Gratis: serve solo un server che riceve le richieste)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** L'indirizzo che riceve i POST (il tuo server o un servizio) (Chi ha scritto il programma che riceve); Un segreto per la firma, se chi riceve la controlla (lo inventi tu) (In questa pagina, «Segreto per firmare le richieste in uscita»)
- **Passi:** 1. Aggiungi una ricetta «in uscita»: sezione, eventi e indirizzo completo 2. Lascia il corpo vuoto per mandare tutto l'evento, o scrivi un JSON con i segnaposto come {email} 3. Se chi riceve controlla la firma, inventa un segreto e scrivilo qui: Kubo manda X-Kubo-Tempo e X-Kubo-Firma (sha256 su «tempo.corpo») 4. Per scrivere in Kubo dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all'indirizzo che compare sotto (Kubo deve essere raggiungibile da internet) 5. Accendi e guarda il registro: ogni consegna fallita si riprova da sola
- **Sito e fonti:** [sito](https://www.rfc-editor.org/rfc/rfc9110) · [fonte 1](https://www.rfc-editor.org/rfc/rfc9110) · [fonte 2](https://www.rfc-editor.org/rfc/rfc2104)

<a id="zapier"></a>
### Zapier · `zapier`

Kubo dentro i tuoi Zap: un evento in una sezione fa partire uno Zap, e uno Zap crea o aggiorna righe in Kubo.

- **Costo:** In abbonamento («Webhooks by Zapier» è un'app premium: serve un piano a pagamento)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo del Catch Hook (https://hooks.zapier.com/hooks/catch/…)](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks) (Zapier → nuovo Zap → trigger «Webhooks by Zapier» → «Catch Hook»)
- **Passi:** 1. In Zapier crea uno Zap e scegli come trigger «Webhooks by Zapier» → «Catch Hook» 2. Copia l'indirizzo del webhook che ti dà Zapier 3. Qui aggiungi una ricetta «in uscita»: scegli la sezione e gli eventi, incolla l'indirizzo 4. Accendi, poi crea o modifica una riga in Kubo e premi «Test trigger» in Zapier 5. Per scrivere in Kubo dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all'indirizzo che compare sotto (Kubo deve essere raggiungibile da internet): in Zapier usa l'azione «Webhooks by Zapier» → «POST» con Payload Type «json» 6. Pubblica lo Zap
- **Sito e fonti:** [sito](https://zapier.com) · [fonte 1](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks) · [fonte 2](https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps)
