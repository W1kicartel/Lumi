# Catalogo delle integrazioni

Generato da `npm run catalogo` dai manifesti in `connettori/`: non modificarlo a mano. 129 integrazioni in 21 categorie.
Come si scrive un connettore e il suo blocco «catalogo»: [CONNETTORI.md](CONNETTORI.md).

«Provato con un servizio finto» vuol dire che le prove automatiche usano un server finto che risponde come quello vero, secondo la documentazione delle fonti: prima di affidarti, fai una prova nella modalità test del servizio.

| Integrazione | Categoria | Costo | Difficoltà | Provato |
|---|---|---|---|---|
| [Axerve](#axerve) | Pagamenti | Con contratto | Media | servizio finto |
| [GoCardless](#gocardless) | Pagamenti | A consumo | Media | servizio finto |
| [Klarna](#klarna) | Pagamenti | Con contratto | Media | servizio finto |
| [Mollie](#mollie) | Pagamenti | A consumo | Facile | servizio finto |
| [Nexi XPay](#nexi-xpay) | Pagamenti | Con contratto | Media | servizio finto |
| [PayPal](#paypal) | Pagamenti | A consumo | Media | servizio finto |
| [Satispay](#satispay) | Pagamenti | A consumo | Media | servizio finto |
| [Scalapay](#scalapay) | Pagamenti | Con contratto | Media | servizio finto |
| [Square](#square) | Pagamenti | A consumo | Media | servizio finto |
| [Stripe](#stripe) | Pagamenti | A consumo | Media | servizio finto |
| [Registratore telematico Epson](#epson-rt) | Cassa e POS | Gratis | Per smanettoni | servizio finto |
| [Stripe Terminal](#stripe-terminal) | Cassa e POS | A consumo | Media | servizio finto |
| [SumUp](#sumup) | Cassa e POS | A consumo | Facile | servizio finto |
| [BigCommerce](#bigcommerce) | Negozi online | In abbonamento | Facile | servizio finto |
| [Ecwid](#ecwid) | Negozi online | In abbonamento | Facile | servizio finto |
| [Magento / Adobe Commerce](#magento) | Negozi online | Gratis | Media | servizio finto |
| [PrestaShop](#prestashop) | Negozi online | Gratis | Facile | servizio finto |
| [Shopify](#shopify) | Negozi online | In abbonamento | Media | servizio finto |
| [Squarespace Commerce](#squarespace) | Negozi online | In abbonamento | Facile | servizio finto |
| [Wix Stores](#wix) | Negozi online | In abbonamento | Facile | servizio finto |
| [WooCommerce](#woocommerce) | Negozi online | Gratis | Media | servizio finto |
| [Amazon Seller Central](#amazon) | Marketplace | A consumo | Per smanettoni | servizio finto |
| [eBay](#ebay) | Marketplace | A consumo | Media | servizio finto |
| [Etsy](#etsy) | Marketplace | A consumo | Media | servizio finto |
| [A-Cube](#acube) | Fatturazione | A consumo | Media | servizio finto |
| [Aruba Fatturazione Elettronica](#aruba-fe) | Fatturazione | In abbonamento | Media | servizio finto |
| [Fattura24](#fattura24) | Fatturazione | In abbonamento | Facile | servizio finto |
| [Fatture in Cloud](#fatture-in-cloud) | Fatturazione | In abbonamento | Media | servizio finto |
| [Invoicetronic](#invoicetronic) | Fatturazione | A consumo | Facile | servizio finto |
| [Openapi SDI](#openapi-sdi) | Fatturazione | A consumo | Media | servizio finto |
| [Cambi BCE](#bce-cambi) | Contabilità | Gratis | Facile | servizio finto |
| [QuickBooks](#quickbooks) | Contabilità | In abbonamento | Media | servizio finto |
| [Reviso](#reviso) | Contabilità | In abbonamento | Media | servizio finto |
| [Xero](#xero) | Contabilità | In abbonamento | Media | servizio finto |
| [Enable Banking](#enable-banking) | Banche | Gratis | Media | servizio finto |
| [Qonto](#qonto) | Banche | In abbonamento | Facile | servizio finto |
| [Revolut Business](#revolut-business) | Banche | In abbonamento | Per smanettoni | servizio finto |
| [Wise Business](#wise) | Banche | A consumo | Media | servizio finto |
| [DHL](#dhl) | Spedizioni | Con contratto | Media | servizio finto |
| [FedEx](#fedex) | Spedizioni | Gratis | Facile | servizio finto |
| [Packlink PRO](#packlink) | Spedizioni | A consumo | Facile | servizio finto |
| [Qapla'](#qapla) | Spedizioni | In abbonamento | Facile | servizio finto |
| [Sendcloud](#sendcloud) | Spedizioni | In abbonamento | Facile | servizio finto |
| [UPS](#ups) | Spedizioni | Gratis | Facile | servizio finto |
| [WhatsApp (360dialog)](#dialog360) | WhatsApp | In abbonamento | Media | servizio finto |
| [WhatsApp (Twilio)](#twilio-whatsapp) | WhatsApp | A consumo | Facile | servizio finto |
| [WhatsApp (Meta Cloud API)](#whatsapp) | WhatsApp | A consumo | Per smanettoni | servizio finto |
| [Aircall](#aircall) | Messaggi | In abbonamento | Media | servizio finto |
| [Discord](#discord) | Messaggi | Gratis | Facile | servizio finto |
| [Google Chat](#google-chat) | Messaggi | In abbonamento | Facile | servizio finto |
| [Gotify](#gotify) | Messaggi | Gratis | Media | servizio finto |
| [ntfy](#ntfy) | Messaggi | Gratis | Facile | servizio finto |
| [Pushover](#pushover) | Messaggi | Con contratto | Facile | servizio finto |
| [Slack](#slack) | Messaggi | Gratis | Facile | servizio finto |
| [Microsoft Teams](#teams) | Messaggi | In abbonamento | Facile | servizio finto |
| [Telegram](#telegram) | Messaggi | Gratis | Facile | servizio finto |
| [Amazon SES](#amazon-ses) | Email | A consumo | Per smanettoni | servizio finto |
| [Brevo](#brevo) | Email | Gratis | Facile | servizio finto |
| [Gmail](#gmail) | Email | Gratis | Media | servizio finto |
| [MailerSend](#mailersend) | Email | Gratis | Media | servizio finto |
| [Mailgun](#mailgun) | Email | In abbonamento | Media | servizio finto |
| [Mailjet](#mailjet) | Email | Gratis | Facile | servizio finto |
| [Outlook e Microsoft 365 (posta)](#outlook-posta) | Email | Gratis | Media | servizio finto |
| [Email e PEC](#posta) | Email | Gratis | Facile | servizio finto |
| [Postmark](#postmark) | Email | In abbonamento | Facile | servizio finto |
| [Resend](#resend) | Email | Gratis | Media | servizio finto |
| [SendGrid](#sendgrid) | Email | In abbonamento | Media | servizio finto |
| [Aruba SMS](#aruba-sms) | SMS | A consumo | Facile | servizio finto |
| [ClickSend](#clicksend) | SMS | A consumo | Facile | servizio finto |
| [Skebby](#skebby) | SMS | A consumo | Facile | servizio finto |
| [SMSHosting](#smshosting) | SMS | A consumo | Facile | servizio finto |
| [Twilio SMS](#twilio) | SMS | A consumo | Media | servizio finto |
| [Vonage SMS](#vonage) | SMS | A consumo | Media | servizio finto |
| [iCloud, Nextcloud e CalDAV](#caldav) | Calendario | Gratis | Media | servizio finto |
| [Calendario](#calendario) | Calendario | Gratis | Facile | servizio finto |
| [Jitsi Meet](#jitsi) | Calendario | Gratis | Facile | servizio finto |
| [Outlook e Microsoft 365](#outlook) | Calendario | Gratis | Per smanettoni | servizio finto |
| [Microsoft Teams (riunioni)](#teams-riunioni) | Calendario | In abbonamento | Per smanettoni | servizio finto |
| [Whereby](#whereby) | Calendario | A consumo | Facile | servizio finto |
| [Zoom](#zoom) | Calendario | In abbonamento | Media | servizio finto |
| [Acuity Scheduling](#acuity) | Prenotazioni | In abbonamento | Facile | servizio finto |
| [Cal.com](#cal-com) | Prenotazioni | Gratis | Media | servizio finto |
| [Calendly](#calendly) | Prenotazioni | In abbonamento | Media | servizio finto |
| [SimplyBook.me](#simplybook) | Prenotazioni | In abbonamento | Media | servizio finto |
| [Box](#box) | Archivio e file | Gratis | Media | servizio finto |
| [Dropbox](#dropbox) | Archivio e file | Gratis | Facile | servizio finto |
| [Google Drive](#google-drive) | Archivio e file | Gratis | Media | servizio finto |
| [OneDrive](#onedrive) | Archivio e file | Gratis | Media | servizio finto |
| [pCloud](#pcloud) | Archivio e file | Gratis | Media | servizio finto |
| [Archivio S3](#s3) | Archivio e file | A consumo | Media | servizio finto |
| [Archivio WebDAV](#webdav) | Archivio e file | Gratis | Facile | servizio finto |
| [Airtable](#airtable) | Produttività | In abbonamento | Facile | servizio finto |
| [Asana](#asana) | Produttività | Gratis | Facile | servizio finto |
| [Baserow](#baserow) | Produttività | Gratis | Facile | servizio finto |
| [Rubrica CardDAV (iCloud, Nextcloud)](#carddav) | Produttività | Gratis | Media | servizio finto |
| [ClickUp](#clickup) | Produttività | Gratis | Facile | servizio finto |
| [Excel (Microsoft 365)](#excel-online) | Produttività | Gratis | Media | servizio finto |
| [Google Contatti](#google-contatti) | Produttività | Gratis | Media | servizio finto |
| [Fogli Google](#google-sheets) | Produttività | Gratis | Media | servizio finto |
| [Google Tasks](#google-tasks) | Produttività | Gratis | Media | servizio finto |
| [Microsoft To Do](#microsoft-todo) | Produttività | Gratis | Media | servizio finto |
| [Notion](#notion) | Produttività | Gratis | Facile | servizio finto |
| [Todoist](#todoist) | Produttività | Gratis | Facile | servizio finto |
| [Trello](#trello) | Produttività | Gratis | Media | servizio finto |
| [Webhook semplice (n8n, Make, Zapier)](#webhook-semplice) | Produttività | Gratis | Media | servizio finto |
| [ActiveCampaign](#activecampaign) | Marketing | In abbonamento | Facile | servizio finto |
| [Google Ads (moduli per i lead)](#google-ads-lead) | Marketing | A consumo | Media | servizio finto |
| [HubSpot](#hubspot) | Marketing | Gratis | Media | servizio finto |
| [Jotform](#jotform) | Marketing | Gratis | Media | servizio finto |
| [Mailchimp](#mailchimp) | Marketing | In abbonamento | Facile | servizio finto |
| [MailerLite](#mailerlite) | Marketing | Gratis | Facile | servizio finto |
| [MailUp](#mailup) | Marketing | In abbonamento | Media | servizio finto |
| [Meta Lead Ads](#meta-lead) | Marketing | A consumo | Per smanettoni | servizio finto |
| [Pipedrive](#pipedrive) | Marketing | In abbonamento | Facile | servizio finto |
| [Tally](#tally) | Marketing | Gratis | Media | servizio finto |
| [Typeform](#typeform) | Marketing | In abbonamento | Media | servizio finto |
| [Zoho CRM](#zoho-crm) | Marketing | Gratis | Media | servizio finto |
| [Recensioni Google](#google-business) | Recensioni | Gratis | Per smanettoni | servizio finto |
| [Trustpilot](#trustpilot) | Recensioni | In abbonamento | Media | servizio finto |
| [DocuSign](#docusign) | Firma | In abbonamento | Per smanettoni | servizio finto |
| [Yousign](#yousign) | Firma | In abbonamento | Media | servizio finto |
| [Openapi imprese](#openapi-imprese) | Dati delle aziende | A consumo | Facile | servizio finto |
| [VIES (partite IVA UE)](#vies) | Dati delle aziende | Gratis | Facile | servizio finto |
| [HTTP / API REST](#http) | Automazione | Gratis | Per smanettoni | servizio finto |
| [Make](#make) | Automazione | Gratis | Facile | servizio finto |
| [n8n](#n8n) | Automazione | Gratis | Media | servizio finto |
| [Pipedream](#pipedream) | Automazione | Gratis | Media | servizio finto |
| [Webhook](#webhook) | Automazione | Gratis | Media | servizio finto |
| [Zapier](#zapier) | Automazione | In abbonamento | Facile | servizio finto |

## Pagamenti (10)

<a id="axerve"></a>
### Axerve · `axerve`

Link di pagamento sulla pagina sicura Axerve (ex Banca Sella GestPay): Kubo rilegge l'esito dall'API e segna pagate vendite e fatture.

- **Costo:** Con contratto (Le commissioni dipendono dal contratto con Axerve o con Banca Sella (di solito una percentuale per transazione, a volte con un canone mensile; le offerte e-commerce sono sul sito Axerve). Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Shop login e API key (in prova: quelli dell'ambiente di test sandbox)](https://www.axerve.com/) (Back office Axerve › Configurazione › Ambiente › Sicurezza › API key); [Un indirizzo pubblico https di Kubo (facoltativo)](https://api.axerve.com/) (Il tuo dominio o un tunnel verso il computer di Kubo)
- **Passi:** 1. Chiedi ad Axerve (o a Banca Sella) l'attivazione del pagamento online, oppure apri un account di test sandbox. 2. Nel back office genera l'API key e copia lo shop login (prima quelli di test). 3. In Kubo incolla shop login e API key e scegli l'ambiente. 4. Se Kubo ha un indirizzo pubblico https, scrivilo: Kubo lo manda ad Axerve per ogni link e vede l'esito subito; altrimenti controlla ogni 10 minuti. 5. Premi «Prova la connessione» e accendi. 6. Dalla vendita o dalla fattura crea il link Axerve e mandalo al cliente.
- **Sito e fonti:** [sito](https://www.axerve.com/) · [fonte 1](https://api.axerve.com/) · [fonte 2](https://api.paymentorchestra.fabrick.com/) · [fonte 3](https://docs.axerve.com/)

<a id="gocardless"></a>
### GoCardless · `gocardless`

Addebito diretto SEPA: il cliente firma il mandato una volta e le fatture si incassano da sole.

- **Costo:** A consumo (Nessun canone con il piano Standard: circa 1% + 0,20 € per addebito, con un tetto di 4 € per gli addebiti nazionali in euro; gli addebiti internazionali costano di più. Prezzi aggiornati su gocardless.com/it/prezzi.)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Access token (sandbox\_… per provare, live\_… per incassare), con accesso in lettura e scrittura](https://manage.gocardless.com/developers) (Dashboard GoCardless → Developers → Create → Access token); [Segreto dell'endpoint webhook](https://manage.gocardless.com/developers) (Dashboard GoCardless → Developers → Create → Webhook endpoint)
- **Passi:** 1. Crea l'account su gocardless.com (o prima la sandbox su manage-sandbox.gocardless.com) e verifica l'attività. 2. In Developers crea un access token con lettura e scrittura e incollalo in Kubo. 3. In Developers crea un webhook endpoint con l'indirizzo che Kubo mostra (…/api/connettori/gocardless/in). 4. Copia il segreto dell'endpoint e incollalo in Kubo, poi accendi il connettore. 5. Dalla scheda di un cliente usa «Chiedi il mandato SEPA» e mandagli il link da firmare. 6. Quando il mandato è attivo, dalla fattura usa «Addebita la fattura»: si segna pagata quando GoCardless conferma l'incasso.
- **Sito e fonti:** [sito](https://gocardless.com/it/) · [fonte 1](https://docs.gocardless.com/api-reference) · [fonte 2](https://docs.gocardless.com/docs/api-reference/webhooks) · [fonte 3](https://docs.gocardless.com/docs/api-reference/events/payment) · [fonte 4](https://docs.gocardless.com/docs/api-reference/events/mandate) · [fonte 5](https://docs.gocardless.com/docs/api-reference/events/billing-request)

<a id="klarna"></a>
### Klarna · `klarna`

Il cliente paga in 3 rate o dopo con Klarna, tu incassi subito: Kubo rilegge l'ordine da Klarna e segna pagata la vendita o la fattura.

- **Costo:** Con contratto (Nessun canone: Klarna trattiene una commissione su ogni vendita, fissata nel contratto (in Italia di solito una percentuale più una quota fissa per transazione; il listino aggiornato è nel portale commercianti). Il cliente paga in 3 rate senza interessi o dopo 30 giorni, il negozio riceve l'intero importo meno la commissione.)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Nome utente (UID) e password API Klarna (in prova: quelli dell'ambiente Playground)](https://portal.klarna.com/) (Klarna Merchant Portal › Impostazioni › Credenziali API Klarna › Genera nuove credenziali); [Un indirizzo pubblico https di Kubo (facoltativo)](https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/create-session/) (Il tuo dominio o un tunnel verso il computer di Kubo)
- **Passi:** 1. Chiedi a Klarna l'attivazione come commerciante (klarna.com/it/business) e verifica che Klarna Payments e la Hosted Payment Page siano attivi. 2. Per provare crea un account Playground e genera lì le credenziali API. 3. Nel Merchant Portal genera nome utente e password API della regione Europa. 4. Incollali in Kubo e scegli l'ambiente. 5. Se Kubo ha un indirizzo pubblico https, scrivilo: l'incasso si vede appena il cliente torna; altrimenti Kubo controlla ogni 10 minuti. 6. Premi «Prova la connessione» e accendi. 7. Dalla vendita o dalla fattura crea il link Klarna e mandalo al cliente.
- **Sito e fonti:** [sito](https://www.klarna.com/it/business/) · [fonte 1](https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/create-session/) · [fonte 2](https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/read-session/) · [fonte 3](https://docs.klarna.com/payments/other-products/hosted-payment-page/api-documentation/status-callbacks/) · [fonte 4](https://docs.klarna.com/api/payments/) · [fonte 5](https://docs.klarna.com/api/ordermanagement/)

<a id="mollie"></a>
### Mollie · `mollie`

Link di pagamento e POS Mollie: le vendite e le fatture si segnano pagate da sole.

- **Costo:** A consumo (Nessun canone né costo di attivazione: si paga a transazione riuscita. Prezzi indicativi per l'Italia: carte europee da 1,8% + 0,25 €, bonifico SEPA 0,25 €, PayPal 0,10 € più la commissione PayPal, Satispay e altri metodi con tariffe proprie; il POS Mollie ha il costo del terminale. Prezzi aggiornati su mollie.com/it/pricing.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API (test\_… per provare, live\_… per incassare)](https://my.mollie.com/dashboard/developers/api-keys) (Dashboard Mollie → Sviluppatori → Chiavi API); [Codice del terminale POS (term\_…), solo se usi il POS](https://my.mollie.com/dashboard) (Dashboard Mollie → Punto vendita → Terminali)
- **Passi:** 1. Crea l'account su mollie.com e completa la verifica dell'attività. 2. Attiva i metodi di pagamento che vuoi (carte, PayPal, bonifico, Satispay…). 3. Copia la chiave API da Sviluppatori → Chiavi API (prima test\_…, poi live\_…). 4. In Kubo incollala nella pagina di Mollie con l'indirizzo pubblico di Kubo, se ce l'hai. 5. Accendi il connettore: Kubo crea il codice segreto del webhook e lo mette da solo in ogni pagamento. 6. Senza indirizzo pubblico Kubo controlla i pagamenti aperti ogni 15 minuti. 7. Prova con un link di pagamento da una vendita e paga in modalità test.
- **Sito e fonti:** [sito](https://www.mollie.com/it) · [fonte 1](https://docs.mollie.com/reference/create-payment) · [fonte 2](https://docs.mollie.com/reference/get-payment) · [fonte 3](https://docs.mollie.com/reference/webhooks) · [fonte 4](https://docs.mollie.com/reference/authentication) · [fonte 5](https://docs.mollie.com/reference/extra-payment-parameters)

<a id="nexi-xpay"></a>
### Nexi XPay · `nexi-xpay`

Link di pagamento sulla pagina sicura Nexi XPay (il POS virtuale della banca): l'esito con il MAC segna pagate vendite e fatture.

- **Costo:** Con contratto (Le commissioni dipendono dal contratto con Nexi o con la tua banca (XPay è incluso nei pacchetti e-commerce Nexi; le offerte standard partono da un canone mensile più una percentuale per transazione). Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Alias del terminale e chiave segreta per il calcolo del MAC (Pagamento semplice)](https://ecommerce.nexi.it/area-riservata) (Back office Nexi XPay › Admin › Chiavi e alias (in prova: le credenziali dell'ambiente di test che manda Nexi)); [Un indirizzo pubblico https di Kubo](https://ecommerce.nexi.it/specifiche-tecniche/) (Il tuo dominio o un tunnel verso il computer di Kubo)
- **Passi:** 1. Chiedi a Nexi (o alla tua banca) l'attivazione di XPay per il commercio elettronico. 2. Nel back office XPay copia alias e chiave MAC (prima quelli di test). 3. In Kubo incolla alias e chiave, scegli l'ambiente e scrivi l'indirizzo pubblico https di Kubo. 4. Accendi il connettore. 5. Dalla vendita o dalla fattura crea il link: il cliente paga sulla pagina Nexi e Kubo riceve l'esito.
- **Sito e fonti:** [sito](https://www.nexi.it/it/negozi-online) · [fonte 1](https://ecommerce.nexi.it/specifiche-tecniche/codicebase/pagamentosemplice.html) · [fonte 2](https://ecommerce.nexi.it/sites/default/files/specifichetecniche.NEXI.20.4.pdf)

<a id="paypal"></a>
### PayPal · `paypal`

Link di pagamento PayPal per vendite e fatture: l'ordine pagato segna pagata la riga.

- **Costo:** A consumo (Nessun canone. Commissione per le vendite nazionali con PayPal 3,40% + 0,35 € a transazione; altri metodi e Paesi su paypal.com/it/business/paypal-business-fees.)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e Secret di un'app REST](https://developer.paypal.com/dashboard/applications) (developer.paypal.com › Apps & Credentials › Create App (scheda Sandbox per le prove, Live per i pagamenti veri)); [Webhook ID (facoltativo, per l'avviso immediato)](https://developer.paypal.com/dashboard/applications) (La stessa app › Webhooks › Add Webhook con l'indirizzo che mostra Kubo, eventi Checkout order approved e Payment capture completed)
- **Passi:** 1. Accedi a developer.paypal.com con il conto PayPal Business. 2. Crea un'app REST (prima in Sandbox per provare). 3. Copia Client ID e Secret in Kubo e scegli l'ambiente. 4. Se Kubo ha un indirizzo pubblico, aggiungi il webhook con l'indirizzo mostrato da Kubo e incolla il Webhook ID. 5. Senza webhook Kubo controlla gli ordini aperti ogni 10 minuti. 6. Premi «Prova la connessione», accendi e crea il primo link da una vendita o da una fattura.
- **Sito e fonti:** [sito](https://www.paypal.com/it/business) · [fonte 1](https://developer.paypal.com/docs/api/orders/v2/) · [fonte 2](https://developer.paypal.com/api/rest/authentication/) · [fonte 3](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post) · [fonte 4](https://www.paypal.com/it/business/paypal-business-fees)

<a id="satispay"></a>
### Satispay · `satispay`

Link di pagamento Satispay per vendite e fatture: quando il cliente paga, Kubo le segna pagate.

- **Costo:** A consumo (Nessun canone. Pagamenti fino a 10 € senza commissione, sopra 10 € 0,20 € fissi a transazione (listino Satispay Business per i negozi; per l'online verifica la tua offerta).)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Codice di attivazione API (6 caratteri, vale una volta)](https://business.satispay.com/) (Pannello Satispay Business › Negozi online › Crea codice di attivazione)
- **Passi:** 1. Apri un conto Satispay Business e crea un negozio online. 2. Nel pannello genera un codice di attivazione (per le prove: ambiente sandbox). 3. In Kubo incolla il codice, scegli «prova» o «produzione» e salva. 4. Premi «Attiva con il codice»: Kubo crea le chiavi RSA e ottiene il KeyId. 5. Se Kubo ha un indirizzo pubblico https, scrivilo: Satispay avvisa subito; altrimenti Kubo controlla ogni 10 minuti. 6. Accendi il connettore e crea il primo link da una vendita o da una fattura.
- **Sito e fonti:** [sito](https://www.satispay.com/it-it/business/) · [fonte 1](https://developers.satispay.com/reference/create-a-payment) · [fonte 2](https://developers.satispay.com/reference/conventions) · [fonte 3](https://developers.satispay.com/reference/get-the-details-of-a-payment)

<a id="scalapay"></a>
### Scalapay · `scalapay`

Il cliente paga in 3 o 4 rate con Scalapay, tu incassi subito: Kubo cattura l'ordine e segna pagata la vendita o la fattura.

- **Costo:** Con contratto (Nessun canone pubblico: a ogni vendita Scalapay trattiene una commissione concordata nel contratto (non pubblicata, di solito qualche punto percentuale). Il cliente paga in 3 o 4 rate senza interessi, il negozio riceve subito l'intero importo meno la commissione.)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API (in prova: la chiave di test pubblica della documentazione)](https://developers.scalapay.com/docs) (Portale merchant Scalapay › Sviluppatori › Chiavi API (si ottiene dopo l'attivazione del contratto)); [Un indirizzo pubblico https di Kubo (facoltativo)](https://developers.scalapay.com/reference/post_v2-payments-capture) (Il tuo dominio o un tunnel verso il computer di Kubo)
- **Passi:** 1. Chiedi a Scalapay l'attivazione come negozio (modulo su scalapay.com/it/business). 2. Per provare usa l'ambiente «prova» con la chiave di test della documentazione. 3. Incolla la chiave API in Kubo e scegli 3 o 4 rate. 4. Se Kubo ha un indirizzo pubblico https, scrivilo: l'ordine si cattura appena il cliente conferma; altrimenti Kubo controlla ogni 10 minuti. 5. Premi «Prova la connessione» e accendi. 6. Dalla vendita o dalla fattura crea il link Scalapay e mandalo al cliente.
- **Sito e fonti:** [sito](https://www.scalapay.com/it/business) · [fonte 1](https://developers.scalapay.com/reference/post_v2-orders) · [fonte 2](https://developers.scalapay.com/reference/post_v2-payments-capture) · [fonte 3](https://developers.scalapay.com/reference/get_v2-payments-token) · [fonte 4](https://developers.scalapay.com/docs)

<a id="square"></a>
### Square · `square`

Link di pagamento e Square Terminal (Spagna, Francia, Irlanda): le vendite e le fatture si segnano pagate da sole.

- **Costo:** A consumo (Nessun canone: si paga a transazione. Prezzi indicativi con le carte europee: in negozio circa 1,25% in Spagna, 1,65% in Francia e 1,75% in Irlanda; online circa 1,4% + 0,25 €. Il lettore o lo Square Terminal si comprano a parte. Square non è disponibile in Italia. Prezzi aggiornati sul sito Square del tuo Paese.)
- **Difficoltà:** Media · **Dove:** Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Access token dell'applicazione (Sandbox per provare, Production per incassare)](https://developer.squareup.com/apps) (Developer Console Square → Applications → la tua app → Credentials); [Location ID del negozio](https://developer.squareup.com/apps) (Developer Console Square → la tua app → Locations); [Signature key del webhook](https://developer.squareup.com/apps) (Developer Console Square → la tua app → Webhooks → Subscriptions)
- **Passi:** 1. Crea l'account Square nel tuo Paese (Spagna, Francia o Irlanda) e un'applicazione nella Developer Console. 2. Copia l'access token e il Location ID e incollali in Kubo; scegli l'ambiente (prova o produzione). 3. Scrivi in Kubo l'indirizzo pubblico di Kubo. 4. In Webhooks → Subscriptions aggiungi l'indirizzo …/api/connettori/square/in, identico, con gli eventi payment.created, payment.updated e terminal.checkout.updated. 5. Copia la signature key della sottoscrizione in Kubo e accendi il connettore. 6. Per il negozio, abbina lo Square Terminal e scrivi in Kubo il suo Device ID. 7. Prova con un link di pagamento da una vendita in Sandbox.
- **Sito e fonti:** [sito](https://squareup.com/es/es) · [fonte 1](https://developer.squareup.com/reference/square/checkout-api/create-payment-link) · [fonte 2](https://developer.squareup.com/docs/webhooks/step3validate) · [fonte 3](https://developer.squareup.com/reference/square/payments-api/get-payment) · [fonte 4](https://developer.squareup.com/reference/square/orders-api/retrieve-order) · [fonte 5](https://developer.squareup.com/reference/square/terminal-api/create-terminal-checkout)

<a id="stripe"></a>
### Stripe · `stripe`

Pagamenti online e POS: le vendite e le fatture si segnano pagate da sole.

- **Costo:** A consumo (1,5% + 0,25 € per le carte europee standard, senza canone)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave segreta (sk\_live\_…) o con restrizioni (rk\_live\_…)](https://dashboard.stripe.com/apikeys) (Dashboard → Sviluppatori → Chiavi API); [Segreto di firma del webhook (whsec\_…)](https://dashboard.stripe.com/webhooks) (Dashboard → Sviluppatori → Webhook → il tuo endpoint)
- **Passi:** 1. Apri la Dashboard di Stripe e vai in Sviluppatori → Chiavi API 2. Crea una chiave con restrizioni (o copia la chiave segreta) e incollala qui 3. In Sviluppatori → Webhook aggiungi un endpoint con l'indirizzo del webhook di questa pagina 4. Scegli gli eventi payment\_intent.succeeded, checkout.session.completed e checkout.session.async\_payment\_succeeded 5. Copia il segreto di firma (whsec\_…) e incollalo qui 6. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://stripe.com/it) · [fonte 1](https://docs.stripe.com/keys) · [fonte 2](https://docs.stripe.com/webhooks) · [fonte 3](https://stripe.com/it/pricing)

## Cassa e POS (3)

<a id="epson-rt"></a>
### Registratore telematico Epson · `epson-rt`

Dalla vendita di Kubo al documento commerciale sul registratore telematico Epson del negozio, e la chiusura giornaliera.

- **Costo:** Gratis (Il collegamento è gratis: serve un registratore telematico Epson (FP-81 II RT, FP-90 III RT o RT Server), acquistato e attivato dal tuo rivenditore (da circa 400–700 € più l'assistenza annuale obbligatoria).)
- **Difficoltà:** Per smanettoni · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo IP del registratore sulla rete del negozio](https://www.epson.it/it_IT/assistenza) (Sul registratore: menu Impostazioni › Rete (o lo scontrino di configurazione); meglio un IP fisso assegnato dal router); [La tabella dei reparti con le aliquote IVA](https://www.agenziaentrate.gov.it/portale/web/guest/schede/comunicazioni/corrispettivi-telematici) (Chiedila al tuo rivenditore o stampala dal registratore (programmazione reparti))
- **Passi:** 1. Collega il registratore alla stessa rete del computer di Kubo e annota il suo indirizzo IP. 2. Nella pagina del connettore scrivi l'indirizzo (es. http://192.168.1.50) e spunta «permetti la rete interna». 3. Scrivi i reparti per aliquota (es. 22:1, 10:2, 4:3, 0:4) come sono programmati sul registratore. 4. Premi «Prova la connessione»: Kubo chiede lo stato del registratore. 5. Dalla vendita usa «Emetti lo scontrino», oppure accendi «automatico» per stamparlo quando la vendita diventa pagata. 6. A fine giornata premi «Chiusura giornaliera» o accendi la chiusura automatica alle 23:30.
- **Sito e fonti:** [sito](https://www.epson.it/it_IT/prodotti/stampanti/stampanti-fiscali/c/s14000) · [fonte 1](https://www.scontrinosmart.it/en/fp81ii/documents/epos-fiscal-print-solution-dev-guide/info) · [fonte 2](https://www.agenziaentrate.gov.it/portale/documents/20143/4952835/Specifiche_Tecniche_RT_V11.pdf/246859ea-1586-5164-daf9-af01779de295)

<a id="stripe-terminal"></a>
### Stripe Terminal · `stripe-terminal`

Manda l'importo della vendita al lettore di carte Stripe del negozio: il cliente avvicina la carta e la vendita si segna pagata.

- **Costo:** A consumo (Commissione Stripe Terminal per le carte dello Spazio economico europeo: 1,4% + 0,10 € a transazione, nessun canone. Il lettore si compra a parte (Stripe Reader S700 o BBPOS WisePOS E, da circa 250 €).)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave segreta (o con restrizioni: PaymentIntents e Terminal in scrittura)](https://dashboard.stripe.com/apikeys) (Dashboard Stripe › Sviluppatori › Chiavi API); [L'ID del lettore registrato (tmr\_…)](https://dashboard.stripe.com/terminal) (Dashboard Stripe › Terminal › Lettori › il tuo lettore (registralo con il codice che mostra sullo schermo))
- **Passi:** 1. Compra un lettore Stripe compatibile con l'integrazione server (S700 o WisePOS E). 2. Nel Dashboard registralo in una «location» del negozio con il codice che mostra sullo schermo. 3. Copia in Kubo la chiave segreta e l'ID del lettore (tmr\_…), poi premi «Prova la connessione». 4. Per l'incasso immediato accendi anche il connettore Stripe con il suo webhook (evento payment\_intent.succeeded); senza, Kubo controlla ogni minuto. 5. Dalla vendita premi «Incassa con il lettore»: il cliente avvicina la carta e la vendita diventa pagata.
- **Sito e fonti:** [sito](https://stripe.com/it/terminal) · [fonte 1](https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=server-driven) · [fonte 2](https://docs.stripe.com/api/terminal/readers/process_payment_intent) · [fonte 3](https://docs.stripe.com/api/payment_intents/create) · [fonte 4](https://stripe.com/it/pricing)

<a id="sumup"></a>
### SumUp · `sumup`

Il POS e i pagamenti SumUp riconciliano gli incassi con le vendite.

- **Costo:** A consumo (Una commissione per transazione, senza canone: la tariffa dipende dal piano e dalla carta)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API segreta (sup\_sk\_…)](https://me.sumup.com/settings/api-keys) (Dashboard SumUp → Impostazioni → Chiavi API); [Codice esercente (merchant code)](https://me.sumup.com) (Dashboard SumUp → Profilo: il codice che inizia con M)
- **Passi:** 1. Entra nella dashboard di SumUp 2. Apri Impostazioni → Chiavi API e crea una chiave segreta 3. Incolla la chiave qui e scrivi il codice esercente 4. Salva, prova la connessione e accendi 5. I checkout creati da Kubo avvisano Kubo da soli: non c'è un webhook da configurare
- **Sito e fonti:** [sito](https://www.sumup.com/it-it/) · [fonte 1](https://developer.sumup.com/api) · [fonte 2](https://developer.sumup.com/online-payments/webhooks/)

## Negozi online (8)

<a id="bigcommerce"></a>
### BigCommerce · `bigcommerce`

Il negozio BigCommerce: varianti e giacenze in comune, gli ordini pagati diventano vendite.

- **Costo:** In abbonamento (Piani da 29 $ al mese (Standard, fatturato annuale) a 299 $ (Pro); l'API è inclusa in tutti i piani.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Account API del negozio (V2/V3) con Products, Orders e Information & Settings in lettura e scrittura: Access token e store hash](https://support.bigcommerce.com/s/article/Store-API-Accounts) (Pannello › Settings › Store-level API accounts › Create API account)
- **Passi:** 1. Nel pannello di BigCommerce apri Settings › Store-level API accounts › Create API account (tipo V2/V3). 2. Dai i permessi Products modify, Orders modify, Information & Settings read-only e Store inventory modify. 3. Salva: copia l'Access token; lo store hash è la parte dopo /stores/ nell'API path. 4. In Kubo incolla store hash e token, premi «Prova la connessione» e accendi. 5. Premi «Registra i webhook degli ordini» con l'indirizzo pubblico di Kubo: gli ordini arrivano subito (senza, arrivano ogni 15 minuti). 6. Lancia «Prodotti dal negozio»: ogni variante con SKU diventa un articolo.
- **Sito e fonti:** [sito](https://www.bigcommerce.com) · [fonte 1](https://developer.bigcommerce.com/docs/start/authentication/api-accounts) · [fonte 2](https://developer.bigcommerce.com/docs/rest-catalog/products) · [fonte 3](https://developer.bigcommerce.com/docs/rest-management/inventory/adjustments) · [fonte 4](https://developer.bigcommerce.com/docs/integrations/webhooks)

<a id="ecwid"></a>
### Ecwid · `ecwid`

Il negozio Ecwid: catalogo e giacenze in comune, gli ordini pagati diventano vendite.

- **Costo:** In abbonamento (Piano Free fino a 5 prodotti; l'API REST è disponibile dai piani a pagamento (Venture da circa 19 € al mese, Business, Unlimited).)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Store ID e Secret token di un'app personalizzata con gli accessi read\_catalog, update\_catalog, read\_orders, read\_store\_profile](https://docs.ecwid.com/develop-apps/app-types/custom-app) (Pannello Ecwid › App › Le mie app › app personalizzata › Dettagli); [Client secret dell'app per i webhook, con l'indirizzo di Kubo come Webhook URL](https://docs.ecwid.com/develop-apps/webhooks) (Stessa app › Webhooks (eventi order.created, order.updated))
- **Passi:** 1. Nel pannello Ecwid apri App › Le mie app e crea un'app personalizzata (gratuita, solo per il tuo negozio). 2. Chiedi gli accessi read\_catalog, update\_catalog, read\_orders e read\_store\_profile, poi installala. 3. Copia lo Store ID, il Secret token e il Client secret. 4. Nella sezione Webhooks dell'app metti l'indirizzo che Kubo mostra in questa pagina con gli eventi order.created e order.updated. 5. In Kubo incolla i tre valori, premi «Prova la connessione», accendi e lancia «Prodotti dal negozio».
- **Sito e fonti:** [sito](https://www.ecwid.com/it) · [fonte 1](https://docs.ecwid.com/api-reference/rest-api) · [fonte 2](https://docs.ecwid.com/develop-apps/webhooks) · [fonte 3](https://docs.ecwid.com/api-reference/rest-api/orders/search-orders) · [fonte 4](https://docs.ecwid.com/api-reference/rest-api/products/update-product)

<a id="magento"></a>
### Magento / Adobe Commerce · `magento`

Il negozio Magento 2 o Adobe Commerce: catalogo e giacenze in comune, gli ordini pagati diventano vendite.

- **Costo:** Gratis (Magento Open Source è gratuito (paghi hosting e manutenzione); Adobe Commerce ha una licenza annuale a preventivo, in base al fatturato.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Access token di un'integrazione con le risorse Catalogo, Magazzino (Inventory) e Vendite](https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/) (Admin › Sistema › Estensioni › Integrazioni › Aggiungi nuova integrazione › Attiva); [Permesso di usare il token come Bearer (Magento 2.4.4 e successivi)](https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/#integration-tokens) (Negozi › Configurazione › Servizi › OAuth › Consumer Settings)
- **Passi:** 1. In Magento apri Sistema › Integrazioni › Aggiungi nuova integrazione, dai un nome (Kubo) e la tua password di amministratore. 2. In «API» scegli le risorse: Catalogo › Prodotti, Negozi › Magazzino (Inventory), Vendite › Ordini e Spedizioni. 3. Salva, poi «Attiva» e «Consenti»: copia l'Access Token che compare. 4. In Negozi › Configurazione › Servizi › OAuth metti «Sì» su «Allow OAuth Access Tokens to be used as standalone Bearer tokens». 5. In Kubo incolla l'indirizzo del negozio e il token; lascia la sorgente MSI «default» o svuotala se usi il magazzino classico. 6. Premi «Prova la connessione», accendi e lancia «Prodotti dal negozio»: gli articoli si abbinano per SKU.
- **Sito e fonti:** [sito](https://business.adobe.com/products/magento/magento-commerce.html) · [fonte 1](https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/) · [fonte 2](https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/) · [fonte 3](https://developer.adobe.com/commerce/webapi/rest/inventory/manage-source-items/) · [fonte 4](https://developer.adobe.com/commerce/webapi/rest/tutorials/orders/order-create-shipment/)

<a id="prestashop"></a>
### PrestaShop · `prestashop`

Il negozio PrestaShop: catalogo e giacenze in comune, gli ordini pagati diventano vendite.

- **Costo:** Gratis (PrestaShop è open source e gratuito; paghi solo l'hosting e gli eventuali moduli. Il Webservice è incluso.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave del Webservice (32 caratteri) con i permessi su products, combinations, stock\_availables, orders, customers, addresses](https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/) (Back office › Parametri avanzati › Webservice › Aggiungi nuova chiave)
- **Passi:** 1. Nel back office apri Parametri avanzati › Webservice e attiva «Abilita il Webservice di PrestaShop». 2. Clicca «Aggiungi nuova chiave», genera la chiave e spunta GET e PUT per stock\_availables, GET per products, combinations, orders, customers e addresses. 3. In Kubo incolla l'indirizzo del negozio e la chiave, poi premi «Prova la connessione». 4. Controlla l'aliquota IVA e gli stati degli ordini pagati (di serie 2, 3, 4, 5, 11). 5. Accendi il connettore e premi «Sincronizza ora» su «Prodotti dal negozio»: gli articoli si abbinano per riferimento (codice). 6. Se la prova risponde 401 su un hosting in CGI, attiva l'inoltro dell'intestazione Authorization nel file .htaccess.
- **Sito e fonti:** [sito](https://prestashop.com) · [fonte 1](https://devdocs.prestashop-project.org/9/webservice/) · [fonte 2](https://devdocs.prestashop-project.org/9/webservice/tutorials/advanced-use/additional-list-parameters/) · [fonte 3](https://devdocs.prestashop-project.org/9/webservice/resources/stock_availables/)

<a id="shopify"></a>
### Shopify · `shopify`

Il negozio Shopify: catalogo e giacenze in comune, gli ordini diventano vendite.

- **Costo:** In abbonamento (Serve un piano Shopify; l'app personalizzata non costa niente in più)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Nome del negozio (….myshopify.com)](https://admin.shopify.com) (Admin di Shopify → Impostazioni → Domini); [Client ID e client secret di un'app](https://shopify.dev/docs/apps/build/dev-dashboard) (Dev Dashboard di Shopify → la tua app → Impostazioni); [Id del magazzino (gid://shopify/Location/…)](https://help.shopify.com/it/manual/locations) (Admin → Impostazioni → Località: il numero in fondo all'indirizzo della località)
- **Passi:** 1. Apri il Dev Dashboard di Shopify e crea un'app 2. Dai all'app gli scope read\_products, write\_products, read\_inventory, write\_inventory e read\_orders 3. Installa l'app sul tuo negozio 4. Copia client ID e client secret e incollali qui 5. Scrivi il nome del negozio e l'id del magazzino 6. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://www.shopify.com/it) · [fonte 1](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant) · [fonte 2](https://shopify.dev/docs/api/admin-graphql)

<a id="squarespace"></a>
### Squarespace Commerce · `squarespace`

Il negozio Squarespace: varianti e giacenze in comune, gli ordini diventano vendite.

- **Costo:** In abbonamento (Le API di Commerce (ordini, prodotti, magazzino) sono riservate ai piani con il commercio avanzato (Commerce Advanced, dal 2024 «Advanced»): circa 65–99 € al mese con fatturazione annuale.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API con i permessi Orders, Products e Inventory (lettura e scrittura)](https://support.squarespace.com/hc/en-us/articles/236297987-Squarespace-API-keys) (Pannello del sito › Impostazioni › Sviluppatore › Chiavi API › Genera chiave)
- **Passi:** 1. Nel pannello del sito apri Impostazioni › Sviluppatore › Chiavi API e premi «Genera chiave». 2. Dai un nome (Kubo) e spunta Orders, Products e Inventory in lettura e scrittura. 3. Copia la chiave (si vede una volta sola) e incollala in Kubo. 4. Premi «Prova la connessione», accendi e lancia «Prodotti dal negozio»: ogni variante con SKU diventa un articolo. 5. Gli ordini arrivano ogni 15 minuti; la giacenza cambiata in Kubo va al sito.
- **Sito e fonti:** [sito](https://www.squarespace.com) · [fonte 1](https://developers.squarespace.com/commerce-apis/overview) · [fonte 2](https://developers.squarespace.com/commerce-apis/retrieve-all-orders) · [fonte 3](https://developers.squarespace.com/commerce-apis/adjust-stock-quantities) · [fonte 4](https://developers.squarespace.com/commerce-apis/retrieve-all-products)

<a id="wix"></a>
### Wix Stores · `wix`

Il negozio Wix: gli ordini pagati del sito diventano vendite, con il cliente.

- **Costo:** In abbonamento (Per vendere su Wix serve un piano Business (in Italia da circa 26 € al mese con fatturazione annuale). Le chiavi API sono gratuite.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API dell'account con il permesso «Wix eCommerce › Read Orders» (o Manage Orders) sul sito](https://dev.wix.com/docs/rest/articles/getting-started/api-keys) (manage.wix.com › Impostazioni account › Chiavi API › Genera chiave API); [ID del sito](https://dev.wix.com/docs/rest/articles/getting-started/api-keys) (Pannello del sito: il codice dopo /dashboard/ nell'indirizzo)
- **Passi:** 1. Da manage.wix.com apri le Chiavi API dell'account e premi «Genera chiave API». 2. Scegli il sito del negozio e dai il permesso sugli ordini di Wix eCommerce (lettura). 3. Copia la chiave (si vede una volta sola) e l'ID del sito (nell'indirizzo del pannello, dopo /dashboard/). 4. In Kubo incolla chiave e ID, premi «Prova la connessione» e accendi: gli ordini pagati arrivano ogni 15 minuti. 5. Gli articoli si abbinano per SKU: dai lo stesso codice ai prodotti di Wix e agli articoli di Kubo.
- **Sito e fonti:** [sito](https://www.wix.com/ecommerce) · [fonte 1](https://dev.wix.com/docs/rest/articles/getting-started/api-keys) · [fonte 2](https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/search-orders) · [fonte 3](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-update-inventory-items)

<a id="woocommerce"></a>
### WooCommerce · `woocommerce`

Il negozio online: catalogo e giacenze in comune, gli ordini del sito diventano vendite.

- **Costo:** Gratis (WooCommerce è gratuito: paghi solo l'hosting del tuo sito WordPress)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Consumer key (ck\_…) e consumer secret (cs\_…) con permessi di lettura e scrittura](https://woocommerce.com/document/woocommerce-rest-api/) (WordPress → WooCommerce → Impostazioni → Avanzate → REST API); [Segreto dei webhook (lo inventi tu)](https://woocommerce.com/document/webhooks/) (WooCommerce → Impostazioni → Avanzate → Webhook)
- **Passi:** 1. Nel pannello di WordPress apri WooCommerce → Impostazioni → Avanzate → REST API 2. Aggiungi una chiave con permessi «Lettura/Scrittura» e copia consumer key e consumer secret 3. Incollale qui insieme all'indirizzo del sito 4. In Avanzate → Webhook crea un webhook «Ordine creato» con l'indirizzo del webhook di questa pagina 5. Inventa un segreto lungo e scrivilo sia nel webhook sia qui 6. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://woocommerce.com) · [fonte 1](https://woocommerce.github.io/woocommerce-rest-api-docs/) · [fonte 2](https://woocommerce.com/document/webhooks/)

## Marketplace (3)

<a id="amazon"></a>
### Amazon Seller Central · `amazon`

Gli ordini Amazon diventano vendite, la giacenza delle tue offerte segue il magazzino di Kubo, la spedizione si conferma con il tracking.

- **Costo:** A consumo (L'API è gratuita per i venditori. Su Amazon paghi il piano Professionale (39 € al mese + IVA) e le commissioni per categoria (in genere 7–15 %). Dal 2026 Amazon può addebitare un canone annuale agli sviluppatori di app pubbliche; un'app privata per il tuo account no.)
- **Difficoltà:** Per smanettoni · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Profilo sviluppatore privato e un'app SP-API (LWA Client ID e Client secret) con i ruoli Inventario e Prezzi, Gestione ordini](https://developer-docs.amazon.com/sp-api/docs/registering-your-application) (Seller Central › App e servizi › Sviluppa app (Solution Provider Portal) › Aggiungi nuova app client); [Refresh token dell'autorizzazione dell'app sul tuo account](https://developer-docs.amazon.com/sp-api/docs/self-authorization) (Sviluppa app › la tua app › Autorizza › Genera refresh token); [Merchant Token (ID venditore)](https://sellercentral.amazon.it/sw/AccountInfo/MerchantToken/step/MerchantToken) (Seller Central › Impostazioni › Info account › Informazioni sul venditore)
- **Passi:** 1. In Seller Central apri App e servizi › Sviluppa app e registrati come sviluppatore privato (solo per il tuo account). 2. Crea un'app client «SP API» con i ruoli Gestione ordini e Inventario e Prezzi. 3. Apri l'app: copia LWA Client ID e Client secret, poi premi «Autorizza» e copia il refresh token. 4. In Kubo incolla le tre chiavi e il Merchant Token; per Amazon.it lascia regione «eu» e marketplace APJ6JRA9NG5V4. 5. Premi «Prova la connessione», accendi e lancia «Offerte Amazon ↔ articoli»: le offerte si collegano agli articoli con lo stesso SKU. 6. Da qui gli ordini arrivano ogni 15 minuti e la giacenza delle offerte non FBA segue Kubo.
- **Sito e fonti:** [sito](https://sellercentral.amazon.it) · [fonte 1](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api) · [fonte 2](https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference) · [fonte 3](https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference) · [fonte 4](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids) · [fonte 5](https://developer-docs.amazon.com/sp-api/changelog/sp-api-will-no-longer-require-aws-iam-or-aws-signature-version-4) · [fonte 6](https://developer-docs.amazon.com/sp-api/docs/self-authorization)

<a id="ebay"></a>
### eBay · `ebay`

Gli ordini eBay pagati diventano vendite, la giacenza segue il magazzino di Kubo, la spedizione si segna con il tracking.

- **Costo:** A consumo (L'API è gratuita (limiti giornalieri di chiamate generosi). Su eBay paghi le commissioni sul venduto (in Italia per i professionali in genere 4,5–10 % più una quota fissa per ordine) ed eventualmente il Negozio eBay.)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Keyset di produzione: App ID (Client ID) e Cert ID (Client secret)](https://developer.ebay.com/my/keys) (developer.ebay.com › Hi \<nome\> › Application Keysets › Production); [RuName (eBay Redirect URL name) con OAuth abilitato; come «auth accepted URL» l'indirizzo …/api/connettori/ebay/pub/ritorno di Kubo (o una pagina qualsiasi, poi incolli l'indirizzo)](https://developer.ebay.com/api-docs/static/oauth-redirect-uri.html) (developer.ebay.com › User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL); [Esenzione dalle notifiche di cancellazione account (Kubo non salva dati degli acquirenti)](https://developer.ebay.com/marketplace-account-deletion) (Application Keysets › Notifications › Marketplace Account Deletion › Exempted)
- **Passi:** 1. Registrati gratis su developer.ebay.com e crea un keyset di produzione: copia App ID e Cert ID. 2. Nella pagina del keyset scegli «Exempted» per le notifiche Marketplace Account Deletion: Kubo non salva i dati degli acquirenti. 3. Apri User Tokens › Get a Token from eBay via Your Application › Add eBay Redirect URL: abilita OAuth e come «auth accepted URL» metti l'indirizzo pubblico di Kubo seguito da /api/connettori/ebay/pub/ritorno. Copia il RuName. 4. In Kubo incolla App ID, Cert ID e RuName e accendi il connettore. 5. Premi «Collega l'account eBay», apri l'indirizzo, accedi come venditore e consenti. Se Kubo non è raggiungibile da internet, copia l'indirizzo su cui eBay ti rimanda e incollalo in «Completa il collegamento». 6. Il collegamento dura 18 mesi: poi si ripete il consenso. Premi «Prova la connessione». 7. Lancia «Inventario eBay ↔ articoli»: si collegano per SKU le inserzioni create con la Inventory API (quelle di Seller Hub vanno migrate o restano solo per gli ordini).
- **Sito e fonti:** [sito](https://www.ebay.it) · [fonte 1](https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html) · [fonte 2](https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html) · [fonte 3](https://developer.ebay.com/api-docs/static/oauth-ui-tokens.html) · [fonte 4](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders) · [fonte 5](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/bulkUpdatePriceQuantity) · [fonte 6](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/shipping_fulfillment/methods/createShippingFulfillment)

<a id="etsy"></a>
### Etsy · `etsy`

Gli ordini Etsy diventano vendite con il cliente, la giacenza delle inserzioni segue Kubo, il tracking va sulla ricevuta.

- **Costo:** A consumo (L'API è gratuita. Su Etsy paghi 0,20 $ per inserzione (dura 4 mesi), il 6,5 % di commissione sulla transazione e la commissione di pagamento (in Italia 4 % + 0,30 €).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un'app Etsy: Keystring e Shared secret](https://www.etsy.com/developers/your-apps) (etsy.com/developers › Your Apps › Create a New App); [L'indirizzo di ritorno di Kubo tra i Callback URLs dell'app (…/api/connettori/etsy/oauth/ritorno)](https://developer.etsy.com/documentation/essentials/authentication/) (Your Apps › la tua app › Edit › Callback URLs); [Facoltativo: il signing secret (whsec\_…) di un endpoint webhook con l'evento order.paid e l'indirizzo dei webhook di Kubo](https://developer.etsy.com/documentation/essentials/webhooks/) (Manage your apps › la tua app › Go to Webhook portal › Add Endpoint)
- **Passi:** 1. Su etsy.com/developers crea una nuova app (uso personale per il tuo negozio): copia Keystring e Shared secret. 2. Nella stessa app aggiungi come Callback URL l'indirizzo di ritorno che Kubo mostra in questa pagina (finisce con /api/connettori/etsy/oauth/ritorno). 3. In Kubo incolla Keystring e Shared secret e accendi il connettore. 4. Premi «Collega l'account», accedi a Etsy e consenti: Kubo riceve il token e lo rinnova da solo. 5. Lancia «Inserzioni Etsy ↔ articoli»: le varianti si collegano agli articoli con lo stesso SKU. 6. Per avere gli ordini subito: nel Webhook portal dell'app aggiungi l'indirizzo dei webhook di Kubo con l'evento order.paid e incolla il signing secret (senza, arrivano ogni 15 minuti). 7. Il tracking si manda dalla vendita o chiedendolo a Lumi (Etsy deve aver approvato lo scope transactions\_w per la tua app).
- **Sito e fonti:** [sito](https://www.etsy.com/it/sell) · [fonte 1](https://developer.etsy.com/documentation/essentials/authentication/) · [fonte 2](https://developer.etsy.com/documentation/reference/#operation/getShopReceipts) · [fonte 3](https://developer.etsy.com/documentation/tutorials/listings/#updating-a-listings-inventory) · [fonte 4](https://developer.etsy.com/documentation/reference/#operation/createReceiptShipment) · [fonte 5](https://developer.etsy.com/documentation/essentials/webhooks/)

## Fatturazione (6)

<a id="acube"></a>
### A-Cube · `acube`

Manda allo SDI le fatture elettroniche di Kubo con A-Cube e ricevi esiti e fatture dei fornitori.

- **Costo:** A consumo (A consumo, a pacchetti di fatture inviate e ricevute, con sandbox gratuita: il listino è sul sito di A-Cube o su richiesta)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Email e password dell'account A-Cube (sandbox o produzione)](https://dashboard.acubeapi.com) (Dashboard A-Cube → registrazione e onboarding (ricevi utente, password e codice destinatario)); [Due webhook (customer-notification e supplier-invoice) verso l'indirizzo che mostra Kubo](https://docs.acubeapi.com/documentation/italy/gov-it/webhooks) (Dashboard A-Cube → Configurazioni API (ApiConfiguration))
- **Passi:** 1. Registrati ad A-Cube e chiedi l'accesso alla sandbox dell'API gov-it 2. Completa l'onboarding della tua azienda: A-Cube ti dà il codice destinatario per le fatture passive 3. Inserisci qui l'email dell'account e la password, e lascia l'ambiente su «prova» 4. Accendi: Kubo genera il codice segreto dei webhook 5. Nella dashboard di A-Cube crea un webhook customer-notification verso l'indirizzo di Kubo seguito da ?evento=customer-notification 6. Crea un webhook supplier-invoice verso lo stesso indirizzo seguito da ?evento=supplier-invoice 7. Prova l'invio di una fattura emessa; quando va, passa a «produzione» con l'account di produzione
- **Sito e fonti:** [sito](https://www.acubeapi.com) · [fonte 1](https://docs.acubeapi.com/documentation/common/authentication) · [fonte 2](https://docs.acubeapi.com/documentation/italy/gov-it/invoices/) · [fonte 3](https://docs.acubeapi.com/documentation/italy/gov-it/webhooks)

<a id="aruba-fe"></a>
### Aruba Fatturazione Elettronica · `aruba-fe`

Manda allo SDI le fatture elettroniche di Kubo tramite Aruba, segue gli esiti e scarica le fatture dei fornitori.

- **Costo:** In abbonamento (Abbonamento annuale Aruba Fatturazione Elettronica (il piano base costa circa 29,90 € + IVA l'anno, con conservazione a norma inclusa); l'accesso alle API va attivato nel pannello e può richiedere il piano Premium. Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Utente e password dell'API (utenza abilitata ai web service)](https://fatturazioneelettronica.aruba.it/) (Pannello Aruba Fatturazione Elettronica › Configurazione › API / Web service: attiva l'accesso e annota utente e password; per le prove chiedi l'ambiente DEMO)
- **Passi:** 1. Attiva Aruba Fatturazione Elettronica e l'accesso alle API (prima l'ambiente DEMO). 2. Compila in Kubo i dati della tua azienda (Documenti › Azienda): servono per l'XML. 3. Nella pagina del connettore scrivi utente e password dell'API e scegli l'ambiente. 4. Premi «Prova la connessione» (Aruba accetta un accesso al minuto: se fallisce aspetta un minuto). 5. Accendi: da ogni fattura emessa c'è «Invia allo SDI (Aruba)». 6. Ogni 30 minuti Kubo legge gli esiti (consegnata, scartata…) e ogni ora scarica le fatture dei fornitori in «Fatture ricevute».
- **Sito e fonti:** [sito](https://fatturazioneelettronica.aruba.it/) · [fonte 1](https://fatturazioneelettronica.aruba.it/apidoc/docs_EN.html) · [fonte 2](https://fatturazioneelettronica.aruba.it/apidoc/docs.html)

<a id="fattura24"></a>
### Fattura24 · `fattura24`

Le fatture di Kubo create in Fattura24 come fatture elettroniche, pronte da inviare allo SDI.

- **Costo:** In abbonamento (Serve un abbonamento a Fattura24 (dal sito: a partire da 4 € al mese + IVA); quali piani includono la fattura elettronica e l'API si vede su fattura24.com/prezzi. Kubo non aggiunge costi.)
- **Difficoltà:** Facile · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [La API key del tuo account](https://www.fattura24.com/api/introduzione/) (Fattura24 › Configurazione › App e servizi esterni › API (gruppo «E-commerce e API»): copia la chiave)
- **Passi:** 1. In Fattura24 apri Configurazione › App e servizi esterni › API e copia la API key. 2. Compila in Kubo i dati dei clienti: partita IVA o codice fiscale, PEC o codice destinatario. 3. Incolla la chiave nella pagina del connettore e premi «Prova la connessione». 4. Accendi: da ogni fattura emessa c'è «Crea in Fattura24». 5. In Fattura24 apri la fattura creata e premi «Invia a Sdi»: l'API non la invia da sola. 6. Le fatture con ritenuta d'acconto o cassa previdenziale vanno create in Fattura24 a mano (limite dell'API).
- **Sito e fonti:** [sito](https://www.fattura24.com/) · [fonte 1](https://www.fattura24.com/api/introduzione/) · [fonte 2](https://www.fattura24.com/api/verifica/) · [fonte 3](https://www.fattura24.com/api/crea-fattura-elettronica/) · [fonte 4](https://www.fattura24.com/api/crea-documento/)

<a id="fatture-in-cloud"></a>
### Fatture in Cloud · `fatture-in-cloud`

Clienti da Fatture in Cloud, fatture di Kubo copiate in FiC e inviate allo SDI, spese registrate in FiC come fatture ricevute.

- **Costo:** In abbonamento (Serve un abbonamento a Fatture in Cloud (piani da circa 4 € al mese + IVA il primo anno in promozione, poi secondo il listino su fattureincloud.it/prezzi); le API sono incluse. Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Un token manuale (il modo più semplice)](https://developers.fattureincloud.it/docs/authentication/manual-authentication/) (FiC › Impostazioni › Applicazioni collegate › Sviluppatori: crea un'app di tipo «manuale» con i permessi Clienti, Fatture, Spese, Impostazioni e genera il token); [In alternativa Client ID e Client secret di un'app OAuth, con l'indirizzo di ritorno che mostra Kubo](https://console.fattureincloud.it/) (console.fattureincloud.it › Le tue app › Nuova app)
- **Passi:** 1. In Fatture in Cloud crea un'app manuale e genera il token con i permessi su clienti, fatture emesse, spese e impostazioni. 2. Incolla il token in Kubo (se hai più aziende, scrivi anche l'ID dell'azienda). 3. Premi «Prova la connessione» e accendi. 4. Premi «Sincronizza ora» sui clienti: arrivano in Kubo, abbinati per partita IVA. 5. Da ogni fattura emessa usa «Copia in Fatture in Cloud» oppure «Invia allo SDI (Fatture in Cloud)». 6. Ogni 3 ore le spese registrate in FiC entrano in «Fatture ricevute».
- **Sito e fonti:** [sito](https://www.fattureincloud.it/) · [fonte 1](https://developers.fattureincloud.it/docs/basics/) · [fonte 2](https://developers.fattureincloud.it/docs/authentication/manual-authentication/) · [fonte 3](https://developers.fattureincloud.it/docs/authentication/code-flow/) · [fonte 4](https://developers.fattureincloud.it/api-reference/)

<a id="invoicetronic"></a>
### Invoicetronic · `invoicetronic`

Manda allo SDI le fatture elettroniche di Kubo con Invoicetronic e scarica esiti e fatture dei fornitori.

- **Costo:** A consumo (A pacchetti di fatture (inviate e ricevute), con la sandbox gratuita per le prove: vedi il listino aggiornato sul sito di Invoicetronic)
- **Difficoltà:** Facile · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API (di prova per la sandbox, poi quella vera)](https://dashboard.invoicetronic.com) (Dashboard Invoicetronic → API Keys)
- **Passi:** 1. Registrati su Invoicetronic e apri la dashboard 2. Aggiungi la tua azienda (partita IVA) e completa la delega per lo SDI 3. Copia la chiave API di prova 4. Incollala qui e accendi il connettore 5. Prova l'invio di una fattura emessa e «Sincronizza ora» per esiti e passive 6. Quando le prove vanno, sostituisci la chiave con quella vera
- **Sito e fonti:** [sito](https://invoicetronic.com) · [fonte 1](https://invoicetronic.com/en/docs/) · [fonte 2](https://invoicetronic.com/en/docs/apikeys/) · [fonte 3](https://api.invoicetronic.com/v1/docs)

<a id="openapi-sdi"></a>
### Openapi SDI · `openapi-sdi`

Manda allo SDI le fatture elettroniche di Kubo e ricevi notifiche e fatture dei fornitori.

- **Costo:** A consumo (A consumo per fattura inviata o ricevuta, con credito prepagato: vedi il listino di Openapi)
- **Difficoltà:** Media · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Token Bearer con gli scope dell'API SDI](https://console.openapi.com) (Console di Openapi → Token)
- **Passi:** 1. Registrati sulla console di Openapi e attiva l'API SDI 2. Crea un token con gli scope dell'API SDI, prima per l'ambiente di prova 3. Incolla il token qui e lascia l'ambiente su «prova» 4. Accendi: Kubo genera il codice segreto del callback 5. Copia l'indirizzo del webhook e registralo come callback nella configurazione SDI di Openapi 6. Quando le prove vanno, passa a «produzione» con un token di produzione
- **Sito e fonti:** [sito](https://openapi.com) · [fonte 1](https://console.openapi.com/apis/sdi/documentation)

## Contabilità (4)

<a id="bce-cambi"></a>
### Cambi BCE · `bce-cambi`

I cambi di riferimento della Banca centrale europea per convertire importi in valuta. Gratis, senza chiave.

- **Costo:** Gratis (Gratis: sono i cambi pubblici della Banca centrale europea, aggiornati ogni giorno lavorativo verso le 16. Non serve nessuna chiave.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Niente: i file della BCE sono pubblici](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) (—)
- **Passi:** 1. Accendi il connettore: non chiede chiavi. 2. Ogni giorno alle 16:30 Kubo prende i cambi nuovi. 3. Chiedi a Lumi «quanto sono 1.250 dollari in euro?» o «il cambio GBP del 3 settembre». 4. Per una fattura in valuta usa il cambio del giorno della fattura (gli ultimi 90 giorni sono disponibili).
- **Sito e fonti:** [sito](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.it.html) · [fonte 1](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) · [fonte 2](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) · [fonte 3](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml)

<a id="quickbooks"></a>
### QuickBooks · `quickbooks`

Le fatture emesse di Kubo in QuickBooks Online: cliente trovato o creato, righe sull'articolo che scegli.

- **Costo:** In abbonamento (Serve un abbonamento QuickBooks Online (non venduto in Italia: per aziende e commercialisti di Regno Unito, USA, Canada, Australia, Francia e altri Paesi; prezzi su quickbooks.intuit.com). L'API è gratuita nel livello Builder dell'Intuit App Partner Program (scritture gratuite, letture con una quota mensile gratuita). Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e Client secret dell'app](https://developer.intuit.com/app/developer/dashboard) (developer.intuit.com › Dashboard › crea un'app QuickBooks Online and Payments › Keys & credentials (Development per la sandbox, Production per i dati veri)); [L'indirizzo di ritorno OAuth](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) (La stessa app › Keys & credentials › Redirect URIs: l'indirizzo che mostra Kubo (…/api/connettori/quickbooks/oauth/ritorno)); [Il Company ID (realm)](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) (QuickBooks › ingranaggio › Account e impostazioni › Fatturazione e abbonamento › Company ID (in sandbox: developer.intuit.com › Sandbox))
- **Passi:** 1. Su developer.intuit.com crea un'app con lo scope Accounting. 2. Aggiungi nei Redirect URIs l'indirizzo di ritorno che mostra Kubo. 3. Copia Client ID e Client secret in Kubo e scegli l'ambiente (prova = sandbox). 4. Incolla il Company ID della tua azienda QuickBooks. 5. Premi «Collega» e autorizza l'azienda. 6. Controlla l'articolo delle righe (Id 1 di solito è «Services») e, fuori dagli USA, i codici IVA. 7. Esporta una fattura con «Esporta in QuickBooks»; il giro orario porta le nuove.
- **Sito e fonti:** [sito](https://quickbooks.intuit.com) · [fonte 1](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice) · [fonte 2](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer) · [fonte 3](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) · [fonte 4](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions) · [fonte 5](https://developer.intuit.com/app/developer/qbo/docs/get-started/app-partner-program)

<a id="reviso"></a>
### Reviso · `reviso`

Le fatture emesse in Kubo entrano nella contabilità Reviso del commercialista, con i clienti.

- **Costo:** In abbonamento (Serve un abbonamento Reviso (di solito lo ha lo studio del commercialista; listino su reviso.com); l'accesso alle API richiede un'app sviluppatore Reviso, gratuita. Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [L'App secret token di un'app sviluppatore](https://api-docs.reviso.com/) (Portale sviluppatori Reviso › registra un developer agreement › crea l'app: ricevi l'App secret token e il link di installazione); [L'Agreement grant token del contratto Reviso dell'azienda](https://api-docs.reviso.com/) (Chi gestisce Reviso (tu o il commercialista) apre il link di installazione dell'app e la autorizza: al termine compare il grant token)
- **Passi:** 1. Registra un developer agreement su Reviso e crea l'app: annota l'App secret token. 2. Fai autorizzare l'app sul contratto Reviso dell'azienda (anche dal commercialista) e annota l'Agreement grant token. 3. In Reviso guarda i numeri del gruppo clienti, dei termini di pagamento, della zona IVA e, se vuoi, i codici IVA: scrivili nella pagina del connettore. 4. Incolla i due token e premi «Prova la connessione». 5. Accendi: da ogni fattura emessa c'è «Esporta in Reviso»; arriva come bozza, salvo che tu scelga «Registra subito». 6. Se vuoi, imposta i giorni: ogni ora il giro esporta da solo le fatture nuove. 7. Non reinviare allo SDI da Reviso le fatture già partite da Kubo.
- **Sito e fonti:** [sito](https://www.reviso.com/it/) · [fonte 1](https://api-docs.reviso.com/) · [fonte 2](https://rest.reviso.com/schema/customers.post.schema.json) · [fonte 3](https://www.reviso.com/it/)

<a id="xero"></a>
### Xero · `xero`

Le fatture di Kubo nella contabilità Xero: emesse (e, se vuoi, ricevute) esportate con il cliente e le righe.

- **Costo:** In abbonamento (Serve un abbonamento Xero per l'organizzazione (listino per Paese su xero.com/pricing; Xero non ha un'edizione italiana). L'API è gratuita nel livello Starter del listino sviluppatori Xero, fino a 5 organizzazioni collegate all'app. Kubo non aggiunge costi.)
- **Difficoltà:** Media · **Dove:** Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e Client secret di un'app «Web app»](https://developer.xero.com/app/manage) (developer.xero.com › My Apps › New app (tipo Web app) › Configuration › Generate a secret); [L'indirizzo di ritorno OAuth dell'app](https://developer.xero.com/documentation/guides/oauth2/auth-flow) (La stessa app › Configuration › Redirect URIs: l'indirizzo che mostra Kubo (…/api/connettori/xero/oauth/ritorno)); [Codici dei conti e dei tax type](https://central.xero.com/s/article/Add-edit-or-delete-accounts-in-the-chart-of-accounts) (Xero › Accounting › Chart of accounts e Advanced › Tax rates)
- **Passi:** 1. Su developer.xero.com crea un'app di tipo «Web app». 2. Nei Redirect URIs aggiungi l'indirizzo di ritorno che mostra Kubo. 3. Genera il secret e copia Client ID e Client secret in Kubo. 4. Premi «Collega» e scegli l'organizzazione Xero. 5. Controlla il codice conto dei ricavi (200 di solito) e, se serve, i tax type. 6. Esporta una fattura con «Esporta in Xero»; il giro orario porta in Xero quelle nuove.
- **Sito e fonti:** [sito](https://www.xero.com) · [fonte 1](https://developer.xero.com/documentation/api/accounting/invoices) · [fonte 2](https://developer.xero.com/documentation/guides/oauth2/auth-flow) · [fonte 3](https://developer.xero.com/documentation/guides/oauth2/scopes) · [fonte 4](https://devblog.xero.com/upcoming-changes-to-xero-accounting-api-scopes-705c5a9621a0) · [fonte 5](https://developer.xero.com/pricing)

## Banche (4)

<a id="enable-banking"></a>
### Enable Banking · `enable-banking`

I movimenti del conto in banca entrano in Kubo e si abbinano alle fatture da incassare e da pagare.

- **Costo:** Gratis (La sandbox è gratuita. In produzione collegare i conti di cui sei titolare è gratuito (applicazione «ristretta», attivata collegando un tuo conto); per i conti di altri serve un contratto con Enable Banking.)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [L'ID dell'applicazione e la sua chiave privata (.pem), creata alla registrazione](https://enablebanking.com/cp/applications) (Control Panel › API applications › Register new application)
- **Passi:** 1. Crea un account su enablebanking.com e apri il Control Panel. 2. Registra una nuova applicazione (ambiente Production) e scarica la chiave privata .pem. 3. Fra gli indirizzi di ritorno (redirect URL) aggiungi quello che Kubo mostra: \<indirizzo di Kubo\>/api/connettori/enable-banking/pub/ritorno. 4. Attiva l'applicazione collegando un tuo conto, come chiede Enable Banking. 5. In Kubo incolla l'ID dell'applicazione e la chiave privata, scrivi il nome della banca e accendi il connettore. 6. Premi «Collega il conto» e dai il consenso sul sito della banca: dura fino a 180 giorni, poi Kubo ti avvisa di rinnovarlo. 7. Se vuoi tenere i movimenti in Kubo, crea una sezione «Movimenti» con i campi data, importo, descrizione, controparte, conto e fattura; senza, Kubo tiene solo le proposte di abbinamento.
- **Sito e fonti:** [sito](https://enablebanking.com) · [fonte 1](https://enablebanking.com/docs/api/reference/)

<a id="qonto"></a>
### Qonto · `qonto`

I movimenti del conto Qonto entrano in Kubo e si abbinano alle fatture da incassare e da pagare.

- **Costo:** In abbonamento (L'API è compresa nel conto Qonto, senza costi in più; il conto ha un canone mensile che dipende dal piano (i prezzi aggiornati sono su qonto.com/it/pricing).)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Il login dell'organizzazione e la chiave segreta API](https://app.qonto.com) (App Qonto › Impostazioni › Integrazioni e partner › Chiave API)
- **Passi:** 1. Accedi a app.qonto.com con un utente titolare o amministratore. 2. Apri Impostazioni › Integrazioni e partner › Chiave API e premi «Genera». 3. Copia il login (es. bottega-1234) e la chiave segreta. 4. In Kubo incolla login e chiave e accendi il connettore: i movimenti arrivano ogni due ore, o subito con «Sincronizza ora». 5. Se vuoi tenere i movimenti in Kubo, crea una sezione «Movimenti» con i campi data, importo, descrizione, controparte, conto e fattura; senza, Kubo tiene solo le proposte di abbinamento.
- **Sito e fonti:** [sito](https://qonto.com/it) · [fonte 1](https://docs.qonto.com/get-started/business-api/authentication/api-key) · [fonte 2](https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions) · [fonte 3](https://docs.qonto.com/api-reference/business-api/accounts-organizations/organizations/retrieve-the-authenticated-organization-and-list-bank-accounts)

<a id="revolut-business"></a>
### Revolut Business · `revolut-business`

I movimenti dei conti Revolut Business entrano in Kubo e si abbinano alle fatture da incassare e da pagare.

- **Costo:** In abbonamento (L'API Business non costa niente in più: è compresa nei piani Revolut Business, che hanno un canone mensile secondo il piano (c'è anche un piano base senza canone). Prezzi aggiornati su revolut.com/it-IT/business/business-account-plans.)
- **Difficoltà:** Per smanettoni · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il Client ID del certificato API e la sua chiave privata (privatecert.pem)](https://business.revolut.com/settings/api) (Revolut Business web › Impostazioni › API › Business API › Aggiungi certificato)
- **Passi:** 1. Sul computer crea la chiave e il certificato: openssl genrsa -out privatecert.pem 2048 e poi openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825. 2. In Revolut Business (dal web) apri Impostazioni › API › Business API e aggiungi un certificato: incolla publiccert.cer. 3. Come «OAuth redirect URI» scrivi quello che Kubo mostra: \<indirizzo di Kubo\>/api/connettori/revolut-business/pub/ritorno. 4. Copia il Client ID che Revolut ti dà. 5. In Kubo incolla Client ID e chiave privata (privatecert.pem) e accendi il connettore. 6. Premi «Collega il conto» e autorizza Kubo su Revolut: da lì Kubo rinnova l'accesso da solo. 7. Se vuoi tenere i movimenti in Kubo, crea una sezione «Movimenti» con i campi data, importo, descrizione, controparte, conto e fattura; senza, Kubo tiene solo le proposte di abbinamento.
- **Sito e fonti:** [sito](https://www.revolut.com/it-IT/business/) · [fonte 1](https://developer.revolut.com/docs/business/business-api) · [fonte 2](https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request) · [fonte 3](https://github.com/revolut-engineering/revolut-openapi/blob/master/yaml/business.yaml)

<a id="wise"></a>
### Wise Business · `wise`

I movimenti dei saldi in euro di Wise entrano in Kubo e si abbinano alle fatture da incassare e da pagare.

- **Costo:** A consumo (Apertura del conto Business una tantum (circa 50 € in Italia), nessun canone mensile; ricevere euro con le coordinate locali è gratis, i cambi e i bonifici in uscita hanno la commissione mostrata da Wise. L'API è gratuita.)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Token API personale in sola lettura](https://wise.com/settings/api-tokens) (Wise › Impostazioni › Integrazioni e strumenti › Token API › Aggiungi token (permessi: sola lettura)); [La chiave pubblica per la SCA, creata da Kubo](https://wise.com/settings/public-keys) (Wise › Impostazioni › Integrazioni e strumenti › Token API › Gestisci le chiavi pubbliche › Aggiungi)
- **Passi:** 1. Nel conto Wise Business crea un token API in sola lettura. 2. Incollalo in Kubo e premi «Prova la connessione». 3. Premi «Chiavi per la SCA»: Kubo crea le chiavi e mostra la pubblica. 4. Carica la chiave pubblica su Wise (Gestisci le chiavi pubbliche): serve per leggere gli estratti. 5. Accendi: ogni 6 ore i movimenti in euro entrano in Kubo e quelli che pagano una fattura compaiono in «Bonifici da abbinare». 6. Se vuoi tenere tutti i movimenti, crea una sezione «Movimenti» (data, importo, descrizione, controparte, conto, fattura).
- **Sito e fonti:** [sito](https://wise.com/it/business/) · [fonte 1](https://docs.wise.com/api-docs/features/strong-customer-authentication-2fa/personal-token-sca) · [fonte 2](https://docs.wise.com/api-docs/api-reference/balance-statement) · [fonte 3](https://docs.wise.com/api-docs/api-reference/balance) · [fonte 4](https://docs.wise.com/api-docs/api-reference/profile)

## Spedizioni (6)

<a id="dhl"></a>
### DHL · `dhl`

Spedizioni DHL Express con l'etichetta dalla vendita, e il tracking di ogni pacco DHL sulla vendita.

- **Costo:** Con contratto (Le API sono gratuite. Il tracking unificato ha un piano gratuito (250 chiamate al giorno). Per spedire con DHL Express serve un conto aziendale DHL Express con le tariffe del tuo contratto.)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [API key dell'app con «Shipment Tracking – Unified»](https://developer.dhl.com/api-reference/shipment-tracking) (developer.dhl.com › My Apps › Create App › aggiungi Shipment Tracking – Unified); [Utente e password della MyDHL API (solo per creare spedizioni Express) e il numero di conto DHL Express](https://developer.dhl.com/api-reference/dhl-express-mydhl-api) (developer.dhl.com › My Apps › aggiungi DHL Express – MyDHL API (le credenziali arrivano dopo l'approvazione di DHL Express))
- **Passi:** 1. Registrati su developer.dhl.com, crea un'app e aggiungi «Shipment Tracking – Unified»: copia l'API key. 2. Se spedisci con DHL Express, aggiungi alla stessa app «DHL Express – MyDHL API»: DHL ti manda utente e password dopo aver controllato il tuo conto. 3. In Kubo incolla la chiave del tracking (e, se le hai, utente, password e numero di conto), compila il mittente e il pacco standard. 4. Prova con l'ambiente «prova» di MyDHL, poi passa a «produzione». 5. Da una vendita premi «Crea la spedizione DHL Express», oppure collega un tracking fatto altrove con «Collega un tracking DHL»; Lumi risponde a «dov'è il pacco di Rossi?».
- **Sito e fonti:** [sito](https://www.dhl.com/it-it/home.html) · [fonte 1](https://developer.dhl.com/api-reference/dhl-express-mydhl-api) · [fonte 2](https://developer.dhl.com/api-reference/shipment-tracking)

<a id="fedex"></a>
### FedEx · `fedex`

Il tracking delle spedizioni FedEx (anche ex TNT) sulle vendite: lo stato torna da solo e Lumi sa dov'è il pacco.

- **Costo:** Gratis (Le API FedEx sono gratuite con un account FedEx Developer; le spedizioni si pagano con il tuo conto FedEx.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [API key e Secret key di un progetto con la «Track API»](https://developer.fedex.com/api/en-us/get-started.html) (developer.fedex.com › My Projects › Create API Project › Track API)
- **Passi:** 1. Registrati su developer.fedex.com e crea un progetto («Create API Project») con la Track API. 2. Copia API key e Secret key (prima quelle di prova, poi quelle di produzione). 3. In Kubo incollale, scegli l'ambiente, premi «Prova la connessione» e accendi. 4. Da una vendita usa «Collega un tracking FedEx», oppure chiedilo a Lumi: lo stato torna sulla vendita ogni due ore.
- **Sito e fonti:** [sito](https://www.fedex.com/it-it/home.html) · [fonte 1](https://developer.fedex.com/api/en-us/catalog/authorization/docs.html) · [fonte 2](https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html)

<a id="packlink"></a>
### Packlink PRO · `packlink`

Spedizioni scontate con BRT, GLS, SDA, Poste, UPS, DHL: la bozza parte dalla vendita, il tracking ci torna da solo.

- **Costo:** A consumo (Packlink PRO è gratuito: paghi solo le spedizioni, con le tariffe scontate di Packlink (in Italia da pochi euro a pacco). Esistono piani a pagamento con sconti in più per chi spedisce molto.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API di Packlink PRO](https://support-pro.packlink.com/hc/en-gb/articles/213431749) (pro.packlink.it › Impostazioni › Integrazioni (o «Packlink PRO API key»)); [L'indirizzo del mittente e le misure del pacco standard](https://pro.packlink.it) (In Kubo, nelle impostazioni di questo connettore)
- **Passi:** 1. Registrati gratis su pro.packlink.it e, in Impostazioni, genera la chiave API. 2. In Kubo incolla la chiave e compila mittente e pacco standard, poi premi «Prova la connessione» e accendi. 3. Premi «Servizi disponibili» e metti l'id del servizio che usi di solito. 4. Con l'indirizzo pubblico di Kubo premi «Registra l'indirizzo degli eventi»: il tracking torna sulla vendita appena c'è. 5. Da una vendita premi «Prepara la spedizione Packlink» (o chiedilo a Lumi), poi paga e stampa l'etichetta nel pannello Packlink.
- **Sito e fonti:** [sito](https://pro.packlink.it) · [fonte 1](https://support-pro.packlink.com/hc/en-gb/articles/213431749) · [fonte 2](https://github.com/packlink-dev/ecommerce_module_core)

<a id="qapla"></a>
### Qapla' · `qapla`

Il tracking di ogni corriere in un posto: Qapla' avvisa il cliente e lo stato della spedizione torna sulla vendita.

- **Costo:** In abbonamento (Abbonamento mensile in base alle spedizioni tracciate, con prova gratuita; i prezzi aggiornati sono nella pagina dei piani di qapla.it (le API sono incluse).)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [API key del canale (un canale per negozio o per Kubo)](https://api.qapla.dev/1.2/en/) (Pannello Qapla' › Impostazioni › Canali › il canale › API key); [Facoltativo: l'indirizzo del webhook di Kubo (con il codice segreto) nelle notifiche del canale](https://webhook.qapla.dev) (Pannello Qapla' › Impostazioni › Notifiche › Webhook)
- **Passi:** 1. Nel pannello di Qapla' crea (o scegli) un canale per Kubo e copia la sua API key. 2. In Kubo incolla l'API key, premi «Prova la connessione» e accendi. 3. Facoltativo: copia l'indirizzo del webhook che Kubo mostra (finisce con il codice segreto) nelle notifiche webhook del canale, per avere gli stati subito. 4. Quando spedisci, dalla vendita premi «Traccia con Qapla'» con tracking e corriere (BRT, GLS-ITA, SDA, PTI per Poste, DHL, UPS…), oppure chiedilo a Lumi. 5. Lo stato torna sulla vendita (ogni ora, o subito con il webhook) e Lumi risponde a «dov'è il pacco di Rossi?».
- **Sito e fonti:** [sito](https://www.qapla.it) · [fonte 1](https://api.qapla.dev/1.2/en/) · [fonte 2](https://webhook.qapla.dev)

<a id="sendcloud"></a>
### Sendcloud · `sendcloud`

Etichette e tracking per BRT, Poste, GLS, SDA, DHL, UPS: la spedizione parte dalla vendita e lo stato ci torna da solo.

- **Costo:** In abbonamento (Free 0 € (20 etichette al mese), Lite 28 € (400), Growth 87 € (1.000), Premium 175 € (10.000), Pro 639 € (30.000) al mese, -20 % con il pagamento annuale; oltre la soglia 0,15 € a etichetta. Le etichette si pagano alle tariffe Sendcloud o con il tuo contratto.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave pubblica e chiave segreta di un'integrazione «Sendcloud API»](https://support.sendcloud.com/hc/en-us/articles/360024967252) (Pannello Sendcloud › Impostazioni › Integrazioni › Sendcloud API › Connetti); [L'indirizzo dei webhook di Kubo (la «Webhook URL» dell'integrazione)](https://sendcloud.dev/api/v3/webhooks) (Stessa integrazione › Webhook feedback enabled)
- **Passi:** 1. In Sendcloud apri Impostazioni › Integrazioni, cerca «Sendcloud API» e premi Connetti. 2. Dai un nome (Kubo), spunta «Webhook feedback enabled» e incolla come Webhook URL l'indirizzo che Kubo mostra in questa pagina. 3. Salva e copia la chiave pubblica e la chiave segreta in Kubo. 4. Metti l'id dell'indirizzo del mittente (Impostazioni › Indirizzi) e, con «Opzioni di spedizione», il codice dell'opzione che usi di solito. 5. Controlla che i clienti abbiano via, CAP e comune: l'indirizzo del pacco arriva da lì. 6. Accendi: da una vendita premi «Crea l'etichetta Sendcloud», oppure chiedi a Lumi «crea l'etichetta per la vendita 1043».
- **Sito e fonti:** [sito](https://www.sendcloud.com/it/) · [fonte 1](https://sendcloud.dev/api/v3/shipments/create-and-announce-a-shipment-synchronously) · [fonte 2](https://sendcloud.dev/docs/getting-started/api-version-guide) · [fonte 3](https://sendcloud.dev/api/v3/webhooks) · [fonte 4](https://www.sendcloud.com/pricing/)

<a id="ups"></a>
### UPS · `ups`

Il tracking delle spedizioni UPS sulle vendite: lo stato torna da solo e Lumi sa dov'è il pacco.

- **Costo:** Gratis (Le API UPS sono gratuite con un account UPS (anche senza contratto per il solo tracking); le spedizioni si pagano alle tariffe del tuo conto UPS.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e Client secret di un'app con il prodotto «Tracking»](https://developer.ups.com/get-started) (developer.ups.com › Apps › Add Apps (collegata al tuo account UPS))
- **Passi:** 1. Accedi a developer.ups.com con il tuo account UPS e crea un'app («Add Apps»), scegliendo il prodotto Tracking. 2. Copia Client ID e Client secret dell'app. 3. In Kubo incollali, premi «Prova la connessione» e accendi. 4. Da una vendita usa «Collega un tracking UPS» con il numero 1Z…, oppure chiedilo a Lumi: lo stato torna sulla vendita ogni due ore.
- **Sito e fonti:** [sito](https://www.ups.com/it/it) · [fonte 1](https://developer.ups.com/api/reference/oauth/client-credentials) · [fonte 2](https://developer.ups.com/api/reference?loc=en_US&tag=Tracking)

## WhatsApp (3)

<a id="dialog360"></a>
### WhatsApp (360dialog) · `dialog360`

WhatsApp con 360dialog, partner di Meta in Europa: canone fisso al mese e tariffe di Meta senza ricarichi.

- **Costo:** In abbonamento (Canone fisso per numero: circa 49 € al mese (Regular) o 99 € (Premium), più le tariffe di Meta senza ricarichi (in Italia circa 0,066 € marketing, 0,025 € utility).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un account 360dialog con un numero collegato](https://hub.360dialog.com/) (hub.360dialog.com → Sign up); [Il portafoglio Meta Business (l'iscrizione guidata lo collega)](https://business.facebook.com/settings) (hub.360dialog.com → Numbers → Connect); [La chiave API del numero (D360-API-KEY)](https://hub.360dialog.com/) (hub.360dialog.com → Numbers → Generate API key); [L'indirizzo pubblico di Kubo (https)](https://docs.360dialog.com/docs/waba-messaging/webhook) (chi ospita Kubo, o un tunnel)
- **Passi:** 1. Iscriviti su hub.360dialog.com e scegli il piano. 2. Collega il numero con l'iscrizione guidata (Embedded Signup): accedi con Facebook e scegli il portafoglio Meta. 3. In Numbers genera la chiave API del numero e copiala. 4. In Kubo incolla la chiave e l'indirizzo pubblico di Kubo, poi accendi: Kubo registra da sé il webhook con il suo codice segreto. 5. Sincronizza i modelli o creane uno da Kubo e aspetta l'approvazione di Meta.
- **Sito e fonti:** [sito](https://www.360dialog.com) · [fonte 1](https://docs.360dialog.com/docs/messaging-api/api-reference/webhooks) · [fonte 2](https://docs.360dialog.com/docs/waba-messaging/webhook) · [fonte 3](https://docs.360dialog.com/docs/360dialog/prices-plans-and-payment-options) · [fonte 4](https://developers.facebook.com/docs/whatsapp/pricing)

<a id="twilio-whatsapp"></a>
### WhatsApp (Twilio) · `twilio-whatsapp`

WhatsApp con Twilio: iscrizione guidata dalla console, modelli con la Content API. Tariffe di Meta più 0,005 $ a messaggio.

- **Costo:** A consumo (Nessun canone: le tariffe di Meta per i modelli (in Italia circa 0,066 € marketing, 0,025 € utility) più 0,005 $ di Twilio per ogni messaggio inviato o ricevuto.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un account Twilio (con credito)](https://www.twilio.com/try-twilio) (twilio.com → Sign up); [Account SID e Auth Token](https://console.twilio.com/) (Console di Twilio → Account Info); [Un mittente WhatsApp registrato (il tuo numero, collegato al tuo portafoglio Meta)](https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders) (Console → Messaging → Senders → WhatsApp senders); [L'indirizzo pubblico di Kubo (https)](https://www.twilio.com/docs/usage/webhooks/webhooks-security) (chi ospita Kubo, o un tunnel)
- **Passi:** 1. Crea l'account su twilio.com e aggiungi del credito. 2. Copia Account SID e Auth Token dalla prima pagina della console. 3. In Messaging → Senders → WhatsApp senders registra il tuo numero con la procedura guidata (accedi con Facebook e collega il portafoglio Meta). 4. Nel mittente imposta «Webhook URL for incoming messages» e lo stato con l'URL che Kubo ti mostra. 5. In Kubo incolla SID, Auth Token, il numero del mittente e l'indirizzo pubblico di Kubo, poi accendi. 6. Sincronizza i modelli o creane uno da Kubo: Twilio chiede a Meta l'approvazione.
- **Sito e fonti:** [sito](https://www.twilio.com/whatsapp) · [fonte 1](https://www.twilio.com/docs/whatsapp/api) · [fonte 2](https://www.twilio.com/docs/usage/webhooks/webhooks-security) · [fonte 3](https://www.twilio.com/docs/content/content-api-resources) · [fonte 4](https://www.twilio.com/docs/content/content-api-approvals) · [fonte 5](https://www.twilio.com/en-us/whatsapp/pricing)

<a id="whatsapp"></a>
### WhatsApp (Meta Cloud API) · `whatsapp`

Scrivi ai clienti su WhatsApp con l'API ufficiale di Meta: risposte, promemoria, fatture. Le tariffe di Meta, senza ricarichi.

- **Costo:** A consumo (Nessun canone: paghi a Meta solo i modelli consegnati (in Italia circa 0,066 € marketing, 0,025 € utility e autenticazione, listino di ottobre 2026). Le risposte entro 24 ore dal messaggio del cliente sono gratis.)
- **Difficoltà:** Per smanettoni · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un portafoglio Meta Business, meglio se verificato](https://business.facebook.com/settings) (business.facebook.com → Impostazioni → Centro sicurezza); [Un'app di tipo «Business» con il prodotto WhatsApp](https://developers.facebook.com/apps) (developers.facebook.com → Le mie app → Crea app); [Un numero di telefono non registrato nell'app WhatsApp](https://business.facebook.com/wa/manage/phone-numbers/) (WhatsApp Manager → Numeri di telefono); [Il token permanente di un utente di sistema (whatsapp\_business\_messaging, whatsapp\_business\_management)](https://business.facebook.com/settings/system-users) (Impostazioni del business → Utenti → Utenti di sistema → Genera token); [La chiave segreta dell'app (App secret)](https://developers.facebook.com/apps) (L'app → Impostazioni dell'app → Di base); [Un metodo di pagamento sull'account WhatsApp](https://business.facebook.com/billing_hub/) (WhatsApp Manager → Impostazioni di pagamento)
- **Passi:** 1. Crea (o apri) il portafoglio su business.facebook.com e avvia la verifica dell'azienda. 2. Su developers.facebook.com crea un'app di tipo Business e aggiungi il prodotto WhatsApp. 3. In WhatsApp → Configurazione API aggiungi il tuo numero e verificalo con il codice SMS: copia l'ID del numero e l'ID dell'account WhatsApp Business. 4. In Impostazioni del business → Utenti di sistema crea un utente di sistema amministratore, assegnagli l'app e l'account WhatsApp, genera un token senza scadenza con whatsapp\_business\_messaging e whatsapp\_business\_management. 5. Copia la chiave segreta dell'app da Impostazioni dell'app → Di base. 6. In Kubo incolla i quattro valori e accendi il connettore: Kubo genera il token di verifica. 7. In WhatsApp → Configurazione incolla l'URL del webhook e il token di verifica che Kubo ti mostra, poi iscriviti ai campi messages e message\_template\_status\_update. 8. Aggiungi un metodo di pagamento in WhatsApp Manager e prova la connessione.
- **Sito e fonti:** [sito](https://developers.facebook.com/docs/whatsapp/cloud-api) · [fonte 1](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started) · [fonte 2](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples) · [fonte 3](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) · [fonte 4](https://developers.facebook.com/docs/whatsapp/pricing) · [fonte 5](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started#1--acquire-an-access-token-using-a-system-user-or-facebook-login)

## Messaggi (9)

<a id="aircall"></a>
### Aircall · `aircall`

Il centralino Aircall riconosce i clienti: avvisi di chiamata e chiamate perse, una riga nelle note.

- **Costo:** In abbonamento (Abbonamento a utente: Essentials da 30 € al mese a licenza (annuale, minimo 3 licenze), Professional da 50 €; le chiamate oltre il pacchetto si pagano a consumo. API e webhook sono inclusi.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [API ID e API token](https://dashboard.aircall.io/integrations/api-keys) (Aircall Dashboard → Integrations & API → API Keys → Generate an API key); [Un webhook verso l'indirizzo pubblico di Kubo con gli eventi call.created, call.ended, call.voicemail\_left, e il suo token](https://developer.aircall.io/tutorials/how-to-create-a-webhook-integration) (Dashboard → Integrations & API → Webhook → Install; il token si legge con GET /v1/webhooks/{id}); [Per «Chiama»: l'ID del tuo utente e l'ID del numero Aircall](https://developer.aircall.io/api-references/#start-an-outbound-call) (Dashboard → Users e Numbers: l'ID è il numero in fondo all'indirizzo della pagina)
- **Passi:** 1. Nella Dashboard di Aircall apri Integrations & API → API Keys e crea una chiave: copia API ID e API token. 2. Incollali qui e premi «Prova». 3. Crea un webhook verso https://\<il tuo Kubo\>/api/connettori/aircall/in con call.created, call.ended e call.voicemail\_left. 4. Copia il token del webhook in «Token del webhook». 5. Per chiamare dai clienti scrivi l'ID del tuo utente e del numero Aircall. 6. Fai una chiamata di prova: Kubo avvisa e, a fine chiamata, scrive una riga nelle note del cliente.
- **Sito e fonti:** [sito](https://aircall.io) · [fonte 1](https://developers.aircall.io/api-references) · [fonte 2](https://developer.aircall.io/docs/setup-webhooks) · [fonte 3](https://developer.aircall.io/tutorials/how-to-create-a-webhook-integration) · [fonte 4](https://aircall.io/pricing/)

<a id="discord"></a>
### Discord · `discord`

Gli avvisi di Kubo in un canale Discord, con un webhook del canale.

- **Costo:** Gratis (I webhook dei canali Discord sono gratuiti (limite di circa 30 messaggi al minuto per webhook).)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'URL del webhook del canale (https://discord.com/api/webhooks/…)](https://support.discord.com/hc/articles/228383668) (Discord → Impostazioni del server → Integrazioni → Webhook → Nuovo webhook → scegli il canale → Copia URL del webhook)
- **Passi:** 1. In Discord apri Impostazioni del server → Integrazioni 2. «Webhook» → «Nuovo webhook», dagli un nome (es. Kubo) e scegli il canale 3. «Copia URL del webhook» e incollalo qui 4. Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nel canale
- **Sito e fonti:** [sito](https://discord.com) · [fonte 1](https://discord.com/developers/docs/resources/webhook#execute-webhook) · [fonte 2](https://support.discord.com/hc/articles/228383668)

<a id="google-chat"></a>
### Google Chat · `google-chat`

Gli avvisi di Kubo in uno spazio di Google Chat (Google Workspace).

- **Costo:** In abbonamento (Incluso in Google Workspace (da circa 7 € per utente al mese, Business Starter). I webhook non funzionano con gli account Gmail personali.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'URL del webhook dello spazio (https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…)](https://developers.google.com/workspace/chat/quickstart/webhooks) (Google Chat → apri lo spazio → nome dello spazio ▾ → App e integrazioni → Webhook → Aggiungi webhook → copia l'URL)
- **Passi:** 1. In Google Chat apri (o crea) lo spazio della squadra 2. Dal menu dello spazio scegli «App e integrazioni» → «Aggiungi webhook», nome «Kubo» 3. Copia l'URL del webhook e incollalo qui 4. Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nello spazio
- **Sito e fonti:** [sito](https://workspace.google.com/products/chat/) · [fonte 1](https://developers.google.com/workspace/chat/quickstart/webhooks) · [fonte 2](https://developers.google.com/workspace/chat/format-messages)

<a id="gotify"></a>
### Gotify · `gotify`

Notifiche push sul telefono con Gotify, sul tuo server: vendite, appuntamenti, scorte basse.

- **Costo:** Gratis (Gratuito e open source (licenza MIT): lo installi tu su un tuo server, un NAS o un Raspberry Pi; l'app per Android è gratuita (Google Play, F-Droid). Nessun limite di messaggi. Per iPhone non c'è un'app ufficiale.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un server Gotify raggiungibile da Kubo](https://gotify.net/docs/install) (installazione con Docker (gotify/server) o con il file per Linux, Windows, macOS); [Il token di un'applicazione](https://gotify.net/docs/pushmsg) (interfaccia web di Gotify → Apps → Create application → copia il token)
- **Passi:** 1. Installa il server Gotify (es. con Docker) e apri la sua interfaccia web 2. In «Apps» crea un'applicazione «Kubo» e copia il token 3. Installa l'app Gotify sul telefono Android ed entra con il tuo utente 4. Scrivi qui l'indirizzo del server e il token 5. Scegli quali avvisi ricevere 6. Premi «Prova»: arriva la prima notifica
- **Sito e fonti:** [sito](https://gotify.net) · [fonte 1](https://gotify.net/docs/pushmsg) · [fonte 2](https://gotify.net/api-docs) · [fonte 3](https://gotify.net/docs/install) · [fonte 4](https://github.com/gotify/server) · [fonte 5](https://github.com/gotify/android#message-priorities)

<a id="ntfy"></a>
### ntfy · `ntfy`

Notifiche push sul telefono con ntfy: vendite, appuntamenti, scorte basse.

- **Costo:** Gratis (ntfy.sh è gratuito (fino a 250 messaggi al giorno per indirizzo IP); ntfy Pro da 5 $ al mese con argomenti riservati. Il server è open source: puoi installarlo tu, senza limiti.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'app ntfy sul telefono e l'argomento che Kubo genera](https://docs.ntfy.sh/subscribe/phone/) (App ntfy (Google Play, F-Droid, App Store) → + → «Subscribe to topic» → incolla l'argomento che trovi in questa pagina); [Solo con un server tuo protetto: un token di accesso](https://docs.ntfy.sh/config/#access-tokens) (sul server: ntfy token add \<utente\>)
- **Passi:** 1. Installa l'app ntfy sul telefono 2. Accendi il connettore: Kubo genera un argomento segreto 3. Copia l'argomento da questa pagina e nell'app scegli «+ → Subscribe to topic» 4. Scegli quali avvisi ricevere 5. Premi «Prova»: arriva la prima notifica
- **Sito e fonti:** [sito](https://ntfy.sh) · [fonte 1](https://docs.ntfy.sh/publish/) · [fonte 2](https://docs.ntfy.sh/config/#access-tokens) · [fonte 3](https://ntfy.sh/#pricing)

<a id="pushover"></a>
### Pushover · `pushover`

Notifiche push sul telefono con Pushover: vendite, appuntamenti, scorte basse.

- **Costo:** Con contratto (Prova gratuita di 30 giorni, poi una licenza una tantum di 5 $ per piattaforma (Android, iPhone o computer). Ogni applicazione può mandare 10.000 messaggi al mese gratis.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [La User Key (o una Group Key per più persone)](https://pushover.net) (pushover.net → accedi → la chiave è in alto nella pagina principale («Your User Key»)); [L'API Token di un'applicazione](https://pushover.net/apps/build) (pushover.net → Your Applications → Create an Application/API Token → nome «Kubo»)
- **Passi:** 1. Installa l'app Pushover sul telefono e crea l'account 2. Su pushover.net copia la tua User Key 3. Crea un'applicazione «Kubo» e copia il suo API Token 4. Incolla le due chiavi qui e scegli gli avvisi 5. Premi «Prova»: arriva la prima notifica
- **Sito e fonti:** [sito](https://pushover.net) · [fonte 1](https://pushover.net/api) · [fonte 2](https://pushover.net/api#limits) · [fonte 3](https://pushover.net/pricing)

<a id="slack"></a>
### Slack · `slack`

Gli avvisi di Kubo (vendite, appuntamenti, scorte) in un canale Slack della squadra.

- **Costo:** Gratis (Gli Incoming Webhook funzionano anche con il piano Free di Slack (al massimo 10 app installate nell'area di lavoro). Nessun costo per messaggio.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo dell'Incoming Webhook (https://hooks.slack.com/services/…)](https://api.slack.com/apps) (api.slack.com/apps → Create New App → From scratch → Incoming Webhooks → attiva → Add New Webhook to Workspace → scegli il canale → copia l'indirizzo)
- **Passi:** 1. Apri api.slack.com/apps e crea un'app «Kubo» nella tua area di lavoro 2. In «Incoming Webhooks» attiva l'interruttore 3. «Add New Webhook to Workspace», scegli il canale (es. #negozio) e consenti 4. Copia l'indirizzo del webhook e incollalo qui 5. Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nel canale
- **Sito e fonti:** [sito](https://slack.com) · [fonte 1](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks) · [fonte 2](https://developers.mattermost.com/integrate/webhooks/incoming/)

<a id="teams"></a>
### Microsoft Teams · `teams`

Gli avvisi di Kubo in un canale di Microsoft Teams, con un flusso di Workflows.

- **Costo:** In abbonamento (Incluso nei piani Microsoft 365 con Teams (es. Business Basic, circa 5,60 € per utente al mese); il flusso di Workflows usa connettori standard, senza costi in più.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo HTTP POST del flusso «Invia webhook avvisi a un canale»](https://support.microsoft.com/office/creating-a-workflow-from-a-channel-in-teams-242eb8f2-f328-45be-b81f-9817b51a5f0e) (Teams → canale → ⋯ → Workflows → «Send webhook alerts to a channel» (Invia avvisi webhook a un canale) → Avanti → Aggiungi flusso → copia l'indirizzo)
- **Passi:** 1. In Teams apri il canale che deve ricevere gli avvisi 2. Dal menu ⋯ del canale scegli «Workflows» 3. Cerca il modello «Send webhook alerts to a channel», dagli un nome e conferma squadra e canale 4. Copia l'indirizzo che Teams mostra alla fine e incollalo qui 5. Scegli gli avvisi e Accendi: «Prova» scrive un messaggio nel canale
- **Sito e fonti:** [sito](https://www.microsoft.com/microsoft-teams) · [fonte 1](https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook) · [fonte 2](https://support.microsoft.com/office/creating-a-workflow-from-a-channel-in-teams-242eb8f2-f328-45be-b81f-9817b51a5f0e) · [fonte 3](https://adaptivecards.io/explorer/AdaptiveCard.html)

<a id="telegram"></a>
### Telegram · `telegram`

Un bot dell'azienda: avvisi al titolare e messaggi ai clienti che lo aprono dal loro link.

- **Costo:** Gratis (La Bot API di Telegram è gratuita, senza limiti di messaggi per un uso normale (circa 30 messaggi al secondo).)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il token del bot](https://t.me/BotFather) (Telegram → cerca @BotFather → /newbot → scegli nome e username → copia il token)
- **Passi:** 1. Su Telegram apri @BotFather e scrivi /newbot 2. Scegli il nome (es. «Bottega Rossi») e uno username che finisce con «bot» 3. Copia il token e incollalo qui, poi Accendi 4. Copia il «codice del titolare» e apri t.me/\<username del bot\>?start=\<codice\> dal tuo telefono: da lì ti arrivano gli avvisi 5. Scegli quali avvisi ricevere (vendite, appuntamenti, scorte…) 6. Per un cliente: nella sua scheda «Link Telegram per il cliente», poi mandagli il link (o fallo scrivere a Lumi)
- **Sito e fonti:** [sito](https://telegram.org) · [fonte 1](https://core.telegram.org/bots/api#setwebhook) · [fonte 2](https://core.telegram.org/bots/api#getupdates) · [fonte 3](https://core.telegram.org/bots/features#deep-linking)

## Email (11)

<a id="amazon-ses"></a>
### Amazon SES · `amazon-ses`

Email ai clienti con Amazon SES: messaggi, fatture e preventivi in allegato, a pochi centesimi.

- **Costo:** A consumo (0,10 $ ogni 1.000 email (più 0,12 $ per GB di allegati). Per i primi 12 mesi, 3.000 email al mese gratis. All'inizio l'account è in «sandbox»: si scrive solo a indirizzi verificati finché non chiedi l'accesso di produzione.)
- **Difficoltà:** Per smanettoni · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Access key ID e Secret access key di un utente IAM con il permesso ses:SendRawEmail (e ses:GetAccount per la prova)](https://console.aws.amazon.com/iam/home#/users) (Console AWS → IAM → Users → Create user → Attach policies (AmazonSESFullAccess o una policy su misura) → Security credentials → Create access key); [Il dominio o l'email del mittente verificati in SES, e l'accesso di produzione](https://console.aws.amazon.com/ses/home) (Console AWS → Amazon SES → Configuration → Identities → Create identity; poi Account dashboard → Request production access)
- **Passi:** 1. Nella console AWS scegli la regione (es. Europa – Milano, eu-south-1) e apri Amazon SES 2. Crea un'identità per il tuo dominio e aggiungi i record DKIM al DNS 3. Chiedi l'accesso di produzione (Account dashboard), altrimenti scrivi solo a indirizzi verificati 4. In IAM crea un utente con il permesso di inviare (ses:SendRawEmail) e una chiave di accesso 5. Incolla qui Access key ID, Secret e la regione, e l'email del mittente 6. Accendi e premi «Prova»: dice se sei in sandbox o in produzione
- **Sito e fonti:** [sito](https://aws.amazon.com/ses/) · [fonte 1](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html) · [fonte 2](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html) · [fonte 3](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html) · [fonte 4](https://aws.amazon.com/ses/pricing/)

<a id="brevo"></a>
### Brevo · `brevo`

Email e SMS ai clienti, promemoria degli appuntamenti e i clienti in una lista di contatti Brevo.

- **Costo:** Gratis (Piano Free: 300 email al giorno, contatti illimitati. Piani a pagamento da circa 9 € al mese (Starter, 5.000 email). Gli SMS si pagano a crediti prepagati, con un prezzo per paese (listino su brevo.com/it/pricing).)
- **Difficoltà:** Facile · **Dove:** Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [La chiave API v3 (inizia con xkeysib-)](https://app.brevo.com/settings/keys/api) (Brevo → menu del tuo nome in alto a destra → SMTP e API → scheda «Chiavi API» → Genera una nuova chiave API); [Un mittente email verificato (meglio con il dominio autenticato)](https://app.brevo.com/senders/list) (Brevo → Impostazioni → Mittenti, domini e IP dedicati); [Il numero della lista dei contatti (facoltativo)](https://app.brevo.com/contact/list-listing) (Brevo → Contatti → Liste → il numero (ID) accanto al nome)
- **Passi:** 1. Crea un account gratuito su brevo.com 2. Verifica l'email del mittente (Impostazioni → Mittenti) e, se puoi, autentica il dominio 3. Genera la chiave API (SMTP e API → Chiavi API) e incollala qui con l'email del mittente 4. Per la lista: crea una lista in Contatti → Liste e scrivi qui il suo numero 5. Per gli SMS: compra un pacchetto di crediti SMS e scegli il mittente (max 11 caratteri) 6. Per le disiscrizioni: in Transazionali → Impostazioni → Webhook aggiungi l'indirizzo di Kubo con il codice segreto (serve un indirizzo pubblico)
- **Sito e fonti:** [sito](https://www.brevo.com/it/) · [fonte 1](https://developers.brevo.com/docs/send-a-transactional-email) · [fonte 2](https://developers.brevo.com/docs/transactional-sms-endpoints) · [fonte 3](https://developers.brevo.com/reference/import-contacts) · [fonte 4](https://developers.brevo.com/docs/transactional-webhooks) · [fonte 5](https://www.brevo.com/it/pricing/)

<a id="gmail"></a>
### Gmail · `gmail`

Email ai clienti dalla tua casella Gmail o Google Workspace: messaggi, fatture e preventivi in allegato.

- **Costo:** Gratis (Gratis con un account Gmail (fino a circa 500 destinatari al giorno); con Google Workspace (da circa 7 € per utente al mese) fino a 2.000 al giorno.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un client OAuth «Applicazione web» con client ID e client secret](https://console.cloud.google.com/apis/credentials) (console.cloud.google.com → nuovo progetto → API e servizi → Libreria → abilita «Gmail API» → Schermata consenso OAuth → Credenziali → Crea credenziali → ID client OAuth → Applicazione web)
- **Passi:** 1. Su console.cloud.google.com crea un progetto e abilita la Gmail API 2. Configura la schermata di consenso OAuth (tipo Esterno, o Interno con Workspace) e aggiungi l'ambito gmail.send 3. Pubblica l'app («In produzione»): in modalità Test il collegamento scade dopo 7 giorni; per un uso tuo Google mostra solo un avviso «app non verificata» 4. Crea un ID client OAuth di tipo Applicazione web con l'URI di reindirizzamento \<indirizzo di Kubo\>/api/connettori/gmail/oauth/ritorno 5. Incolla qui client ID e client secret, scrivi la tua email come mittente e premi «Collega» 6. Accendi e prova: «Manda la fattura per email» in una fattura emessa
- **Sito e fonti:** [sito](https://workspace.google.com/products/gmail/) · [fonte 1](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) · [fonte 2](https://developers.google.com/workspace/gmail/api/auth/scopes) · [fonte 3](https://developers.google.com/identity/protocols/oauth2/web-server#offline) · [fonte 4](https://support.google.com/a/answer/166852)

<a id="mailersend"></a>
### MailerSend · `mailersend`

Email ai clienti con MailerSend: messaggi, fatture e preventivi in allegato.

- **Costo:** Gratis (Piano Free: 500 email al mese. Hobby da 7 $ al mese (5,60 $ con pagamento annuale).)
- **Difficoltà:** Media · **Dove:** Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un token API con il permesso «Email: accesso completo»](https://app.mailersend.com/api-tokens) (app.mailersend.com → Integrations → API tokens → Manage → Generate new token); [Il dominio del mittente verificato](https://app.mailersend.com/domains) (Domains → Add domain (record SPF, DKIM e Return-Path))
- **Passi:** 1. Crea un account su mailersend.com 2. Aggiungi e verifica il tuo dominio (record DNS) 3. Genera un token API con l'accesso alle email e incollalo qui 4. Scrivi l'email del mittente (dello stesso dominio) 5. Accendi e premi «Prova»: mostra i domini e se sono verificati
- **Sito e fonti:** [sito](https://www.mailersend.com) · [fonte 1](https://developers.mailersend.com/api/v1/email.html#send-an-email) · [fonte 2](https://developers.mailersend.com/api/v1/domains.html) · [fonte 3](https://www.mailersend.com/pricing)

<a id="mailgun"></a>
### Mailgun · `mailgun`

Email ai clienti con Mailgun: messaggi, fatture e preventivi in allegato.

- **Costo:** In abbonamento (Piano Free: 100 email al giorno (un dominio personalizzato). Basic da 15 $ al mese per 10.000 email. Regione UE disponibile (dati in Germania).)
- **Difficoltà:** Media · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [La chiave API (Private API key, o una Sending API key del dominio)](https://app.mailgun.com/settings/api_security) (app.mailgun.com → Settings (ingranaggio) → API Security → Add new key, oppure Sending → Domain settings → Sending API keys); [Il dominio di invio verificato](https://app.mailgun.com/mg/sending/domains) (Sending → Domains → Add new domain (record DNS SPF, DKIM, MX))
- **Passi:** 1. Crea un account su mailgun.com scegliendo la regione UE se lavori in Italia 2. Aggiungi un dominio di invio (es. mg.tuodominio.it) e copia i record DNS dal tuo provider 3. Crea una chiave API e incollala qui con il dominio 4. Scegli la regione uguale a quella dell'account 5. Scrivi l'email del mittente (es. fatture@mg.tuodominio.it) 6. Accendi e premi «Prova»: mostra lo stato del dominio
- **Sito e fonti:** [sito](https://www.mailgun.com) · [fonte 1](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages) · [fonte 2](https://documentation.mailgun.com/docs/mailgun/api-reference/authentication) · [fonte 3](https://www.mailgun.com/pricing/)

<a id="mailjet"></a>
### Mailjet · `mailjet`

Email ai clienti con Mailjet (dati nell'UE): messaggi, fatture e preventivi in allegato.

- **Costo:** Gratis (Piano Free: 6.000 email al mese (200 al giorno). Essential da 19 $ al mese per 15.000 email, senza limite giornaliero.)
- **Difficoltà:** Facile · **Dove:** Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [API Key e Secret Key](https://app.mailjet.com/account/apikeys) (app.mailjet.com → Impostazioni account → REST API → Gestione chiavi API (Principale o secondaria)); [Un mittente o un dominio verificati](https://app.mailjet.com/account/sender) (Impostazioni account → Aggiungi un dominio o un indirizzo mittente)
- **Passi:** 1. Crea un account su mailjet.com 2. Verifica l'indirizzo del mittente o, meglio, il dominio (record SPF e DKIM) 3. Copia API Key e Secret Key e incollale qui 4. Scrivi l'email del mittente verificato 5. Accendi e premi «Prova»: mostra i mittenti e il loro stato
- **Sito e fonti:** [sito](https://www.mailjet.com/it/) · [fonte 1](https://dev.mailjet.com/email/guides/send-api-v31/) · [fonte 2](https://dev.mailjet.com/email/reference/send-emails/) · [fonte 3](https://dev.mailjet.com/email/reference/sender-addresses-and-domains/sender/) · [fonte 4](https://www.mailjet.com/pricing/)

<a id="outlook-posta"></a>
### Outlook e Microsoft 365 (posta) · `outlook-posta`

Email ai clienti dalla tua casella Outlook o Microsoft 365: messaggi, fatture e preventivi in allegato.

- **Costo:** Gratis (Gratis con un account Outlook.com; con Microsoft 365 è incluso nel piano (es. Business Basic, circa 5,60 € per utente al mese). Limite di Exchange Online: 10.000 destinatari al giorno.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'ID applicazione (client) di un'app registrata, con «Consenti flussi client pubblici» attivo e il permesso delegato Mail.Send](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (entra.microsoft.com → Applicazioni → Registrazioni app → Nuova registrazione → Autenticazione → Consenti flussi client pubblici: Sì → Autorizzazioni API → Microsoft Graph → Delegate → Mail.Send, User.Read)
- **Passi:** 1. Su entra.microsoft.com registra una nuova app (tipi di account: anche personali, se usi Outlook.com) 2. In Autenticazione attiva «Consenti flussi client pubblici» 3. In Autorizzazioni API aggiungi Microsoft Graph → Delegate → Mail.Send e User.Read 4. Copia l'ID applicazione (client) e incollalo qui; per gli account personali scrivi «consumers» come tenant 5. Scrivi la tua email come mittente e premi «Collega»: apri microsoft.com/devicelogin e scrivi il codice che Kubo mostra 6. Accendi e premi «Prova»: mostra la casella collegata
- **Sito e fonti:** [sito](https://www.microsoft.com/microsoft-365/outlook) · [fonte 1](https://learn.microsoft.com/graph/api/user-sendmail) · [fonte 2](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code) · [fonte 3](https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online) · [fonte 4](https://learn.microsoft.com/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits)

<a id="posta"></a>
### Email e PEC · `posta`

Manda fatture e promemoria ai clienti dalla tua casella email o PEC.

- **Costo:** Gratis (Usa la casella che hai già, email o PEC: nessun costo in più)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** Server SMTP, porta e sicurezza (La guida del tuo provider (per la PEC Aruba: smtps.pec.aruba.it, porta 465, TLS)); [Utente e password (o password per le app)](https://support.google.com/accounts/answer/185833) (Il tuo account email; con Gmail e la verifica in due passaggi serve una password per le app)
- **Passi:** 1. Cerca nella guida del tuo provider i dati SMTP: server, porta e sicurezza 2. Se usi la verifica in due passaggi (Gmail, Outlook), crea una password per le app 3. Scrivi qui server, porta, sicurezza, utente e password 4. Scrivi il mittente come vuoi che lo vedano i clienti 5. Salva, prova la connessione e accendi
- **Sito e fonti:** [sito](https://www.rfc-editor.org/rfc/rfc5321) · [fonte 1](https://www.rfc-editor.org/rfc/rfc5321) · [fonte 2](https://support.google.com/accounts/answer/185833)

<a id="postmark"></a>
### Postmark · `postmark`

Email ai clienti con Postmark: messaggi, fatture e preventivi in allegato.

- **Costo:** In abbonamento (Gratis fino a 100 email al mese (per provare); piani da 15 $ al mese per 10.000 email.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il Server API Token](https://account.postmarkapp.com/servers) (account.postmarkapp.com → Servers → il tuo server → API Tokens); [Una Sender Signature o il dominio verificato](https://account.postmarkapp.com/signature_domains) (Sender Signatures → Add Domain or Signature)
- **Passi:** 1. Crea un account su postmarkapp.com (l'account va approvato prima di scrivere a indirizzi esterni) 2. Verifica il dominio o l'email del mittente in Sender Signatures 3. Apri il server, scheda API Tokens, copia il token e incollalo qui 4. Scrivi l'email del mittente 5. Accendi e premi «Prova»: mostra il nome del server
- **Sito e fonti:** [sito](https://postmarkapp.com) · [fonte 1](https://postmarkapp.com/developer/api/email-api) · [fonte 2](https://postmarkapp.com/developer/api/overview#authentication) · [fonte 3](https://postmarkapp.com/pricing)

<a id="resend"></a>
### Resend · `resend`

Email ai clienti con Resend: messaggi, fatture e preventivi in allegato.

- **Costo:** Gratis (Piano Free: 3.000 email al mese (100 al giorno), un dominio. Pro da 20 $ al mese per 50.000 email.)
- **Difficoltà:** Media · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Una chiave API (re\_…)](https://resend.com/api-keys) (resend.com → API Keys → Create API Key (permesso «Sending access» basta)); [Il dominio del mittente verificato](https://resend.com/domains) (resend.com → Domains → Add Domain (record DNS SPF e DKIM))
- **Passi:** 1. Crea un account su resend.com 2. Aggiungi il tuo dominio in Domains e copia i record DNS dal pannello del tuo provider (Aruba, Register.it…) 3. Quando il dominio è «Verified», crea una chiave API e incollala qui 4. Scrivi l'email del mittente (es. fatture@tuodominio.it) 5. Accendi e prova: «Manda la fattura per email» in una fattura emessa
- **Sito e fonti:** [sito](https://resend.com) · [fonte 1](https://resend.com/docs/api-reference/emails/send-email) · [fonte 2](https://resend.com/docs/api-reference/domains/list-domains) · [fonte 3](https://resend.com/pricing)

<a id="sendgrid"></a>
### SendGrid · `sendgrid`

Email ai clienti con SendGrid: messaggi, fatture e preventivi in allegato.

- **Costo:** In abbonamento (Prova gratuita di 60 giorni (100 email al giorno), poi piani Email API da circa 19,95 $ al mese (Essentials, 50.000 email).)
- **Difficoltà:** Media · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Una chiave API con il permesso «Mail Send» (SG.…)](https://app.sendgrid.com/settings/api_keys) (app.sendgrid.com → Settings → API Keys → Create API Key → Restricted Access → Mail Send: Full Access); [Un mittente verificato o il dominio autenticato](https://app.sendgrid.com/settings/sender_auth) (Settings → Sender Authentication)
- **Passi:** 1. Crea un account su sendgrid.com 2. Autentica il dominio (Settings → Sender Authentication) o verifica almeno un mittente 3. Crea una chiave API con Mail Send e incollala qui 4. Scrivi l'email del mittente (dello stesso dominio) 5. Se l'account è nella regione UE, scegli «ue» 6. Accendi e prova: «Manda un'email» nella scheda di un cliente
- **Sito e fonti:** [sito](https://sendgrid.com) · [fonte 1](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) · [fonte 2](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys) · [fonte 3](https://sendgrid.com/en-us/pricing)

## SMS (6)

<a id="aruba-sms"></a>
### Aruba SMS · `aruba-sms`

SMS ai clienti e promemoria degli appuntamenti con Aruba SMS.

- **Costo:** A consumo (Pacchetti di SMS prepagati senza canone: il prezzo per SMS scende con la quantità (listino su aruba.it, sezione SMS). Un SMS oltre 160 caratteri usa più crediti. Prezzi IVA esclusa.)
- **Difficoltà:** Facile · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Email (o nome utente) e password del pannello Aruba SMS](https://smspanel.aruba.it) (quelle con cui entri su smspanel.aruba.it); [Un mittente personalizzato (alias) per l'Alta qualità](https://smspanel.aruba.it) (pannello Aruba SMS → Impostazioni → Mittenti (l'alias va approvato da Aruba e da AGCOM))
- **Passi:** 1. Compra un pacchetto di SMS su aruba.it ed entra nel pannello smspanel.aruba.it 2. Registra un mittente (es. il nome del negozio, max 11 caratteri) e aspetta l'approvazione 3. Scrivi qui email (o nome utente) e password del pannello e il mittente 4. Lascia il tipo «N» (Alta qualità): mostra il mittente e dà la notifica di ricezione 5. Accendi e premi «Prova»: mostra gli SMS rimasti per tipo 6. Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo
- **Sito e fonti:** [sito](https://www.aruba.it/sms.aspx) · [fonte 1](https://smsdevelopers.aruba.it/#authentication-api) · [fonte 2](https://smsdevelopers.aruba.it/#send-an-sms-message) · [fonte 3](https://smsdevelopers.aruba.it/#get-user-status)

<a id="clicksend"></a>
### ClickSend · `clicksend`

SMS ai clienti e promemoria degli appuntamenti con ClickSend.

- **Costo:** A consumo (A consumo, senza canone né contratto: si ricarica il credito e ogni SMS costa secondo il paese e la quantità (listino su clicksend.com/it/pricing). Alla registrazione c'è un piccolo credito di prova.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Nome utente API e API key](https://dashboard.clicksend.com/account/subaccounts) (dashboard.clicksend.com → in alto a destra il menu «Developers» → API Credentials); [Facoltativo: un mittente (nome o numero dedicato)](https://dashboard.clicksend.com) (Dashboard → Numbers, oppure Settings → Sender IDs)
- **Passi:** 1. Crea un account su clicksend.com 2. Apri Developers → API Credentials e copia nome utente e API key 3. Incollali qui e, se vuoi, scrivi il mittente (es. il nome del negozio, max 11 caratteri) 4. Accendi e premi «Prova»: mostra il credito 5. Prova «Manda un SMS» dalla scheda di un cliente 6. Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo
- **Sito e fonti:** [sito](https://www.clicksend.com/it/) · [fonte 1](https://developers.clicksend.com/docs/messaging/sms/other/send-sms) · [fonte 2](https://developers.clicksend.com/docs/account/other/view-account) · [fonte 3](https://www.clicksend.com/it/pricing/it/)

<a id="skebby"></a>
### Skebby · `skebby`

SMS ai clienti e promemoria degli appuntamenti con Skebby, il servizio SMS italiano.

- **Costo:** A consumo (Pacchetti di SMS prepagati senza canone né scadenza: il prezzo per SMS scende con la quantità ed è più alto per l'Alta qualità (listino su skebby.it/prezzi/pacchetti-invio-sms). C'è una prova gratuita con alcuni SMS. Prezzi IVA esclusa.)
- **Difficoltà:** Facile · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Email e password dell'account Skebby](https://www.skebby.it/action/free-trial/) (quelle con cui entri su skebby.it); [Un mittente personalizzato (alias) per l'Alta qualità](https://www.skebby.it) (Skebby → Impostazioni → Mittenti SMS → Nuovo mittente (va approvato))
- **Passi:** 1. Crea un account su skebby.it (c'è la prova gratuita) e compra un pacchetto di SMS 2. Registra un mittente (es. il nome del negozio, max 11 caratteri) e aspetta l'approvazione 3. Scrivi qui email e password dell'account e il mittente 4. Scegli la qualità: GP (alta) per mostrare il mittente e avere la conferma di consegna 5. Accendi e premi «Prova»: mostra gli SMS rimasti 6. Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo
- **Sito e fonti:** [sito](https://www.skebby.it) · [fonte 1](https://developers.skebby.it/#authentication-api) · [fonte 2](https://developers.skebby.it/#send-an-sms-message) · [fonte 3](https://developers.skebby.it/#get-user-status)

<a id="smshosting"></a>
### SMSHosting · `smshosting`

SMS ai clienti e promemoria degli appuntamenti con SMSHosting, il servizio SMS italiano.

- **Costo:** A consumo (Credito prepagato senza canone: il prezzo per SMS scende con la quantità acquistata (listino su smshosting.it/it/prezzi-sms). Un SMS oltre 160 caratteri (70 con emoji) conta come più SMS. Prezzi IVA esclusa.)
- **Difficoltà:** Facile · **Dove:** Italia, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API (AUTH\_KEY) e chiave segreta (AUTH\_SECRET)](https://www.smshosting.it) (smshosting.it → Sviluppatori → API REST, HTTP e SOAP); [Un mittente personalizzato (alias)](https://www.smshosting.it) (smshosting.it → Impostazioni → Mittenti (va approvato))
- **Passi:** 1. Crea un account su smshosting.it, attivalo e ricarica il credito 2. Vai in Sviluppatori → API REST, HTTP e SOAP e copia chiave API e chiave segreta 3. Incollale qui e scrivi il mittente approvato 4. Per provare senza spendere accendi la modalità di prova (sandbox): gli SMS non partono davvero 5. Accendi e premi «Prova»: mostra gli SMS e il credito rimasti 6. Se vuoi, accendi il promemoria degli appuntamenti del giorno dopo
- **Sito e fonti:** [sito](https://www.smshosting.it) · [fonte 1](https://help.smshosting.it/it/sms-rest-api) · [fonte 2](https://apidoc.smshosting.it/) · [fonte 3](https://github.com/smshosting/smshosting-api-java-client)

<a id="twilio"></a>
### Twilio SMS · `twilio`

SMS ai clienti e promemoria degli appuntamenti con Twilio, con lo stato della consegna.

- **Costo:** A consumo (A consumo, in dollari: verso l'Italia circa 0,093 $ per SMS (per pezzo da 160 caratteri), 0,02 $ per un SMS ricevuto; un numero mobile italiano costa circa 45 $ al mese (serve il fascicolo normativo). In alternativa un mittente alfanumerico. Prova gratuita con un piccolo credito iniziale.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Account SID e Auth Token](https://console.twilio.com) (console.twilio.com → Account Dashboard → riquadro «Account Info»); [Un mittente: numero Twilio, Messaging Service (MG…) o nome alfanumerico](https://console.twilio.com/us1/develop/phone-numbers/manage/search) (Console → Phone Numbers → Buy a number, oppure Messaging → Services)
- **Passi:** 1. Crea un account su twilio.com e verifica il tuo numero 2. Dalla console copia Account SID e Auth Token e incollali qui 3. Compra un numero (per l'Italia serve un fascicolo normativo) o crea un Messaging Service, e scrivilo come mittente 4. Con la prova gratuita gli SMS arrivano solo ai numeri verificati 5. Per lo stato della consegna e gli SMS in arrivo scrivi l'indirizzo pubblico di Kubo; per gli SMS in arrivo imposta lo stesso indirizzo (…/api/connettori/twilio/in) sul numero, in «A message comes in» 6. Accendi e prova: «Manda un SMS» nella scheda di un cliente
- **Sito e fonti:** [sito](https://www.twilio.com/it-it/messaging) · [fonte 1](https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource) · [fonte 2](https://www.twilio.com/docs/usage/security#validating-requests) · [fonte 3](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status) · [fonte 4](https://www.twilio.com/en-us/sms/pricing/it)

<a id="vonage"></a>
### Vonage SMS · `vonage`

SMS ai clienti e promemoria degli appuntamenti con Vonage (ex Nexmo), con le ricevute di consegna.

- **Costo:** A consumo (A consumo, senza canone: si paga ogni SMS (per pezzo da 160 caratteri, 70 con emoji) secondo il paese di destinazione, con il listino su vonage.com/communications-apis/sms/pricing. Alla registrazione c'è un piccolo credito di prova; un numero virtuale ha un canone mensile, un mittente alfanumerico no.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [API key e API secret](https://dashboard.nexmo.com) (dashboard.nexmo.com → in alto nella pagina iniziale («API key» e «API secret»)); [Un mittente: numero Vonage o nome alfanumerico](https://dashboard.nexmo.com/buy-numbers) (Dashboard → Numbers → Buy numbers, oppure un nome fino a 11 caratteri dove il paese lo permette); [Facoltativo: il signature secret per i webhook firmati](https://dashboard.nexmo.com/settings) (Dashboard → API Settings → «Signature secret» e metodo di firma (la firma dei webhook va chiesta al supporto Vonage))
- **Passi:** 1. Crea un account su vonage.com (c'è un credito di prova) 2. Copia API key e API secret dalla dashboard e incollali qui 3. Scrivi il mittente: un numero Vonage o il nome del negozio (max 11 caratteri) 4. Per le ricevute di consegna scrivi l'indirizzo pubblico di Kubo: Kubo lo manda con ogni SMS; in API Settings → SMS settings scegli il metodo POST (o POST-JSON) 5. Se in Vonage hai i webhook firmati, scrivi qui il signature secret e lo stesso metodo di firma 6. Accendi e premi «Prova»: mostra il credito rimasto
- **Sito e fonti:** [sito](https://www.vonage.it/communications-apis/sms/) · [fonte 1](https://developer.vonage.com/en/api/sms) · [fonte 2](https://developer.vonage.com/en/messaging/sms/guides/delivery-receipts) · [fonte 3](https://developer.vonage.com/en/getting-started/concepts/signing-messages) · [fonte 4](https://developer.vonage.com/en/api/account) · [fonte 5](https://www.vonage.com/communications-apis/sms/pricing/)

## Calendario (7)

<a id="caldav"></a>
### iCloud, Nextcloud e CalDAV · `caldav`

Agenda di Kubo e calendario di iPhone (iCloud), Nextcloud o un altro CalDAV allineati nei due sensi.

- **Costo:** Gratis (Gratis: iCloud (5 GB gratuiti), Nextcloud installato in proprio o un CalDAV del NAS. Fastmail da 5 $ al mese.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [iCloud: una password specifica per app (l'ID Apple deve avere l'autenticazione a due fattori)](https://support.apple.com/it-it/102654) (account.apple.com → Accesso e sicurezza → Password specifiche per le app → Genera); [Nextcloud: l'indirizzo CalDAV e una password per app](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html) (Nextcloud → Calendario → Impostazioni del calendario → Copia l'indirizzo CalDAV primario; Impostazioni personali → Sicurezza → Crea una nuova password per app)
- **Passi:** 1. iCloud: su account.apple.com apri Accesso e sicurezza → Password specifiche per le app e generane una per «Kubo». 2. Nextcloud: copia l'indirizzo CalDAV (https://tuo-nextcloud/remote.php/dav) e crea una password per app in Impostazioni → Sicurezza. 3. Scrivi qui indirizzo, utente (per iCloud l'email dell'ID Apple) e password per app. 4. Premi «Prova»: compaiono i calendari trovati; se vuoi un calendario preciso, usa «Elenca i calendari» e incollane l'indirizzo. 5. Accendi: gli appuntamenti vanno nel calendario e ogni 15 minuti Kubo legge le novità.
- **Sito e fonti:** [sito](https://www.icloud.com/calendar) · [fonte 1](https://www.rfc-editor.org/rfc/rfc4791) · [fonte 2](https://www.rfc-editor.org/rfc/rfc5545) · [fonte 3](https://www.rfc-editor.org/rfc/rfc6764) · [fonte 4](https://support.apple.com/it-it/102654) · [fonte 5](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html)

<a id="calendario"></a>
### Calendario · `calendario`

L'agenda sul telefono: feed .ics da aggiungere al calendario, oppure Google Calendar.

- **Costo:** Gratis (Il feed .ics e Google Calendar sono gratuiti)
- **Difficoltà:** Facile · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** Niente per il feed .ics: l'indirizzo segreto lo crea Kubo (In questa pagina, dopo l'accensione); [Per Google Calendar (facoltativo): client ID e client secret OAuth](https://console.cloud.google.com/apis/credentials) (Google Cloud Console → API e servizi → Credenziali → ID client OAuth (applicazione web))
- **Passi:** 1. Accendi: Kubo crea l'indirizzo segreto del feed 2. Copia l'indirizzo e aggiungilo al calendario del telefono («Iscriviti a un calendario») 3. Per Google Calendar: in Google Cloud Console abilita la Google Calendar API e crea un ID client OAuth 4. Come URI di reindirizzamento metti l'indirizzo di Kubo seguito da /api/connettori/calendario/oauth/ritorno 5. Incolla client ID e client secret qui e premi «Collega l'account»
- **Sito e fonti:** [sito](https://calendar.google.com) · [fonte 1](https://www.rfc-editor.org/rfc/rfc5545) · [fonte 2](https://developers.google.com/calendar/api/guides/overview) · [fonte 3](https://developers.google.com/identity/protocols/oauth2/web-server)

<a id="jitsi"></a>
### Jitsi Meet · `jitsi`

Un link di videochiamata Jitsi per gli appuntamenti a distanza, nelle note. Senza chiavi.

- **Costo:** Gratis (Gratis e open source (Apache 2.0): meet.jit.si non costa niente, senza limiti di durata; un server proprio costa solo il server (da circa 5 € al mese per pochi partecipanti). Jitsi as a Service (8x8) è a pagamento, oltre 25 utenti al mese.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Niente chiavi: basta scegliere il server (meet.jit.si o il tuo)](https://meet.jit.si) (Le impostazioni di questo connettore); [Su meet.jit.si: un account Google, GitHub o Facebook per chi apre la stanza per primo (il moderatore)](https://jitsi.org/blog/authentication-on-meet-jit-si/) (Si chiede all'apertura della stanza; gli ospiti entrano senza account); [Facoltativo: un server Jitsi proprio, per avere le regole di accesso in casa](https://jitsi.github.io/handbook/docs/devops-guide/) (Guida di installazione di Jitsi Meet (Debian/Ubuntu o Docker))
- **Passi:** 1. Accendi il connettore: non servono chiavi. 2. Lascia https://meet.jit.si o scrivi l'indirizzo del tuo server Jitsi. 3. Facoltativo: scrivi l'inizio del nome delle stanze (es. il nome dello studio). 4. Sull'appuntamento premi «Crea la videochiamata Jitsi» (o chiedilo a Lumi): il link va nelle note. 5. Se vuoi il link per tutti gli appuntamenti nuovi, accendi «Crea il link per ogni appuntamento nuovo». 6. Su meet.jit.si entra per primo nella stanza con Google, GitHub o Facebook: sei il moderatore; il cliente apre il link senza account.
- **Sito e fonti:** [sito](https://jitsi.org/jitsi-meet/) · [fonte 1](https://jitsi.github.io/handbook/docs/user-guide/user-guide-start-a-jitsi-meeting/) · [fonte 2](https://jitsi.org/blog/authentication-on-meet-jit-si/) · [fonte 3](https://jitsi.github.io/handbook/docs/devops-guide/) · [fonte 4](https://jaas.8x8.vc/#/pricing)

<a id="outlook"></a>
### Outlook e Microsoft 365 · `outlook`

Agenda di Kubo e calendario di Outlook allineati nei due sensi.

- **Costo:** Gratis (Gratis con un account Microsoft personale (Outlook.com) o con Microsoft 365 (Business Basic da 5,60 € a utente al mese + IVA). Registrare l'app su Microsoft Entra non costa niente.)
- **Difficoltà:** Per smanettoni · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [ID applicazione (client) di un'app registrata, con «Consenti flussi client pubblici» attivo](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (portal.azure.com → Microsoft Entra ID → Registrazioni app → Nuova registrazione → Autenticazione); [Il permesso delegato Calendars.ReadWrite (più offline\_access)](https://learn.microsoft.com/graph/permissions-reference#calendarsreadwrite) (Registrazioni app → la tua app → Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate)
- **Passi:** 1. Su Microsoft Entra apri Registrazioni app → Nuova registrazione; tipi di account: quelli che ti servono (anche personali). 2. In Autenticazione attiva «Consenti flussi client pubblici». 3. In Autorizzazioni API aggiungi Microsoft Graph → delegate → Calendars.ReadWrite e offline\_access. 4. Copia l'ID applicazione (client) e incollalo qui; il tenant resta «common» se non sai cosa mettere. 5. Accendi e premi «Collega con un codice»: apri microsoft.com/devicelogin e scrivi il codice. 6. Gli appuntamenti nuovi vanno in Outlook; ogni 15 minuti Kubo legge le novità del calendario.
- **Sito e fonti:** [sito](https://outlook.office.com/calendar) · [fonte 1](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0) · [fonte 2](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) · [fonte 3](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0) · [fonte 4](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0)

<a id="teams-riunioni"></a>
### Microsoft Teams (riunioni) · `teams-riunioni`

Una riunione Teams per gli appuntamenti a distanza, con il link nelle note.

- **Costo:** In abbonamento (Serve un account di lavoro Microsoft 365 con Teams: Microsoft 365 Business Basic da 5,60 € a utente al mese + IVA (annuale), oppure Teams Essentials da 3,70 €. Gli account personali non possono creare riunioni via API. Registrare l'app su Microsoft Entra non costa niente.)
- **Difficoltà:** Per smanettoni · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [ID applicazione (client) di un'app registrata, con «Consenti flussi client pubblici» attivo](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (entra.microsoft.com → Applicazioni → Registrazioni app → Nuova registrazione → Autenticazione); [Il permesso delegato OnlineMeetings.ReadWrite (più offline\_access e User.Read)](https://learn.microsoft.com/graph/permissions-reference#onlinemeetingsreadwrite) (Registrazioni app → la tua app → Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate)
- **Passi:** 1. Su Microsoft Entra apri Registrazioni app → Nuova registrazione (account di questa organizzazione). 2. In Autenticazione attiva «Consenti flussi client pubblici». 3. In Autorizzazioni API aggiungi Microsoft Graph → delegate → OnlineMeetings.ReadWrite, User.Read e offline\_access. 4. Copia l'ID applicazione (client) e incollalo qui; il tenant resta «organizations» o l'id della tua directory. 5. Accendi e premi «Collega con un codice»: apri microsoft.com/devicelogin e scrivi il codice. 6. Sull'appuntamento premi «Crea la riunione Teams» (o chiedilo a Lumi): il link va nelle note.
- **Sito e fonti:** [sito](https://www.microsoft.com/microsoft-teams) · [fonte 1](https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0) · [fonte 2](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-update?view=graph-rest-1.0) · [fonte 3](https://learn.microsoft.com/en-us/graph/api/onlinemeeting-delete?view=graph-rest-1.0) · [fonte 4](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) · [fonte 5](https://www.microsoft.com/it-it/microsoft-365/business/compare-all-microsoft-365-business-products)

<a id="whereby"></a>
### Whereby · `whereby`

Una stanza video Whereby per gli appuntamenti a distanza, con il link nelle note.

- **Costo:** A consumo (L'API (Whereby Embedded) ha il piano Explore gratuito con 2.000 minuti-partecipante al mese (senza minuti in più); Build costa 10,99 $ al mese con 2.000 minuti inclusi, poi 0,0042 $ al minuto-partecipante (IVA esclusa). Chi entra nella stanza non ha bisogno di un account.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Una chiave API di Whereby Embedded](https://whereby.com/information/embedded/) (whereby.com/org → Configure → API → Generate key (serve un account Whereby Embedded))
- **Passi:** 1. Crea un account Whereby Embedded (gratis per iniziare). 2. Nel pannello apri Configure → API e genera una chiave. 3. Incolla la chiave qui e premi «Prova». 4. Sull'appuntamento premi «Crea la stanza Whereby» (o chiedilo a Lumi): i link vanno nelle note. 5. Se vuoi la stanza per tutti gli appuntamenti nuovi, accendi «Crea la stanza per ogni appuntamento nuovo». 6. Se l'appuntamento si sposta, Kubo crea una stanza nuova; se si annulla, la cancella.
- **Sito e fonti:** [sito](https://whereby.com) · [fonte 1](https://docs.whereby.com/reference/whereby-rest-api-reference/meetings) · [fonte 2](https://docs.whereby.com/creating-and-deleting-rooms) · [fonte 3](https://docs.whereby.com/whereby-product-features/using-the-rest-api/name-prefixes) · [fonte 4](https://whereby.com/information/embedded/pricing/)

<a id="zoom"></a>
### Zoom · `zoom`

Una riunione Zoom per gli appuntamenti a distanza, con il link nelle note.

- **Costo:** In abbonamento (Il piano Basic è gratis ma le riunioni con 3 o più persone durano al massimo 40 minuti; Pro da 13,33 € al mese a licenza (annuale). Le app Server-to-Server OAuth non costano.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un'app Server-to-Server OAuth con Account ID, Client ID e Client secret](https://marketplace.zoom.us/develop/create) (marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth App → App Credentials); [Gli scope per creare e modificare le riunioni](https://developers.zoom.us/docs/internal-apps/s2s-oauth/) (La tua app → Scopes → Add Scopes → Meeting: meeting:write:meeting:admin, meeting:update:meeting:admin, meeting:delete:meeting:admin)
- **Passi:** 1. Su marketplace.zoom.us apri Develop → Build App e scegli Server-to-Server OAuth App (serve un utente amministratore). 2. Copia Account ID, Client ID e Client secret in Kubo. 3. In Scopes aggiungi la creazione, la modifica e la cancellazione delle riunioni. 4. In Activation premi Activate your app. 5. Premi «Prova», poi sull'appuntamento «Crea la riunione Zoom» (o chiedilo a Lumi): il link va nelle note.
- **Sito e fonti:** [sito](https://zoom.us) · [fonte 1](https://developers.zoom.us/docs/internal-apps/s2s-oauth/) · [fonte 2](https://developers.zoom.us/docs/api/meetings/#tag/meetings/POST/users/{userId}/meetings) · [fonte 3](https://zoom.us/pricing)

## Prenotazioni (4)

<a id="acuity"></a>
### Acuity Scheduling · `acuity`

Le prenotazioni di Acuity Scheduling diventano appuntamenti, con il cliente.

- **Costo:** In abbonamento (API e webhook servono il piano Premium: 49 $ al mese con pagamento annuale (61 $ mese per mese); Starter (16 $) e Standard (27 $) non hanno l'API.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [User ID e chiave API](https://secure.acuityscheduling.com/app.php?action=settings&key=api) (Acuity → Integrazioni → API → Visualizza credenziali (in fondo alla pagina)); [Per avere gli avvisi subito: un indirizzo pubblico di Kubo con HTTPS](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel))
- **Passi:** 1. Su Acuity apri Integrazioni → API e premi «Visualizza credenziali». 2. Incolla qui User ID e chiave API, poi premi «Prova la connessione». 3. Premi «Leggi le prenotazioni adesso»: arrivano quelle dei prossimi 60 giorni, poi ogni 15 minuti. 4. Se Kubo ha un indirizzo pubblico, scrivilo e premi «Registra il webhook su Acuity»: le prenotazioni arrivano in pochi secondi. 5. Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.
- **Sito e fonti:** [sito](https://acuityscheduling.com) · [fonte 1](https://developers.acuityscheduling.com/docs/webhooks) · [fonte 2](https://developers.acuityscheduling.com/reference/get-appointments-id) · [fonte 3](https://developers.acuityscheduling.com/reference/post-webhooks) · [fonte 4](https://developers.acuityscheduling.com/docs/quick-start) · [fonte 5](https://acuityscheduling.com/signup.php)

<a id="cal-com"></a>
### Cal.com · `cal-com`

Le prenotazioni di Cal.com diventano appuntamenti, con il cliente.

- **Costo:** Gratis (Il piano Free per una persona ha i webhook; Teams costa 15 $ a utente al mese. Installato in proprio (open source, AGPL) è gratis.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un webhook con il segreto generato da Kubo](https://app.cal.com/settings/developer/webhooks) (Cal.com → Impostazioni → Sviluppatore → Webhook → Nuovo); [Un indirizzo pubblico di Kubo (dominio o tunnel) raggiungibile da Internet](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel))
- **Passi:** 1. Accendi il connettore: Kubo crea il segreto del webhook. 2. Scrivi l'indirizzo pubblico di Kubo (con https). 3. Su Cal.com apri Impostazioni → Sviluppatore → Webhook → Nuovo. 4. Come «Subscriber URL» incolla l'indirizzo che dà l'azione «Indirizzo da dare a Cal.com». 5. Incolla il segreto e scegli Booking Created, Booking Rescheduled e Booking Cancelled. 6. Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.
- **Sito e fonti:** [sito](https://cal.com) · [fonte 1](https://cal.com/docs/developing/guides/automation/webhooks) · [fonte 2](https://cal.com/pricing)

<a id="calendly"></a>
### Calendly · `calendly`

Le prenotazioni di Calendly diventano appuntamenti, con il cliente.

- **Costo:** In abbonamento (I webhook richiedono un piano a pagamento: Standard da 10 $ a utente al mese (annuale), Teams 16 $; il piano Free non li ha.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Token di accesso personale (Personal Access Token)](https://calendly.com/integrations/api_webhooks) (Calendly → Integrazioni e app → API e webhook → Genera nuovo token); [Un indirizzo pubblico di Kubo (dominio o tunnel) raggiungibile da Internet](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel))
- **Passi:** 1. Su Calendly apri Integrazioni e app → API e webhook e genera un token personale. 2. Incolla il token qui. 3. Scrivi l'indirizzo pubblico di Kubo (con https). 4. Accendi il connettore: la chiave di firma la crea Kubo. 5. Premi «Registra il webhook su Calendly». 6. Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.
- **Sito e fonti:** [sito](https://calendly.com) · [fonte 1](https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures) · [fonte 2](https://developer.calendly.com/openapi/calendly-api.yaml) · [fonte 3](https://calendly.com/pricing)

<a id="simplybook"></a>
### SimplyBook.me · `simplybook`

Le prenotazioni di SimplyBook.me diventano appuntamenti, con il cliente.

- **Costo:** In abbonamento (Piano Free gratuito (50 prenotazioni al mese); Basic 11,90 € al mese con pagamento annuale (13,90 € mese per mese, 100 prenotazioni), Standard 24,90 € (500), Premium 49,90 € (2.000). La funzione API va attivata tra le Funzioni personalizzate: controlla che il tuo piano la includa.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il login dell'azienda e un utente amministratore con una chiave utente API (o la sua password)](https://simplybook.me/en/api/developer-api) (SimplyBook → Impostazioni → Funzioni personalizzate → API (attiva) → Impostazioni → chiave utente API); [Per avere le prenotazioni subito: un indirizzo pubblico di Kubo con HTTPS, da incollare in Callback URL](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Funzioni personalizzate → API → Impostazioni → Callback URL, con «create», «change» e «cancel» attivi)
- **Passi:** 1. Su SimplyBook apri Funzioni personalizzate e attiva «API». 2. Nelle impostazioni dell'API crea una chiave utente API per un amministratore. 3. Incolla qui il login dell'azienda, l'utente e la chiave, poi premi «Prova la connessione». 4. Premi «Leggi le prenotazioni adesso»: arrivano quelle dei prossimi 60 giorni, poi ogni 15 minuti. 5. Con un indirizzo pubblico: premi «Indirizzo da dare a SimplyBook» e incollalo in Callback URL, con create, change e cancel. 6. Fai una prenotazione di prova: compare tra gli appuntamenti, con il cliente.
- **Sito e fonti:** [sito](https://simplybook.me) · [fonte 1](https://simplybook.me/en/api/developer-api/tab/guide_api) · [fonte 2](https://simplybook.me/en/api/developer-api/tab/doc_api) · [fonte 3](https://help.simplybook.me/index.php/Company_administration_service_methods) · [fonte 4](https://tech-support.simplybook.me/t/116-simplybook-me-not-calling-callback-url/120) · [fonte 5](https://simplybook.me/en/pricing)

## Archivio e file (7)

<a id="box"></a>
### Box · `box`

Fatture e documenti su Box, cartelle per anno, e il backup del database ogni notte.

- **Costo:** Gratis (Piano Individual gratis con 10 GB (file fino a 250 MB); Personal Pro 100 GB a circa 10 € al mese; Business Starter e Business a partire da pochi euro fino a circa 15 € per utente al mese (fatturazione annuale). L'API non costa.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e Client Secret di un'app «Custom App» con autenticazione «User Authentication (OAuth 2.0)»](https://app.box.com/developers/console) (Box Developer Console → My Platform Apps → Create Platform App → Custom App → scheda Configuration)
- **Passi:** 1. Nella Developer Console di Box crea una «Custom App» con «User Authentication (OAuth 2.0)». 2. Scheda Configuration: in Application Scopes spunta «Write all files and folders stored in Box» e salva. 3. Sempre in Configuration, alla voce Redirect URIs aggiungi http://localhost:\<porta di Kubo\>/api/connettori/box/oauth/ritorno. 4. Copia Client ID e Client Secret, incollali in Kubo, accendi il connettore e premi «Collega». 5. Scegli se salvare da solo le fatture emesse e quanti backup tenere. Un file oltre 50 MB viene rifiutato. 6. Se Kubo resta spento più di 60 giorni il collegamento scade: basta premere di nuovo «Collega».
- **Sito e fonti:** [sito](https://www.box.com) · [fonte 1](https://developer.box.com/reference/post-files-content/) · [fonte 2](https://developer.box.com/reference/post-files-id-content/) · [fonte 3](https://developer.box.com/reference/post-folders/) · [fonte 4](https://developer.box.com/guides/authentication/oauth2/) · [fonte 5](https://www.box.com/pricing)

<a id="dropbox"></a>
### Dropbox · `dropbox`

Fatture e documenti su Dropbox, cartelle per anno, e il backup del database ogni notte.

- **Costo:** Gratis (Dropbox Basic gratis con 2 GB; Plus 2 TB a circa 11,99 €/mese (9,99 €/mese con pagamento annuale). L'API non costa.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [App key e App secret di un'app Dropbox (accesso «App folder» o «Full Dropbox»)](https://www.dropbox.com/developers/apps) (Dropbox App Console → Create app → Scoped access → scheda Settings)
- **Passi:** 1. Nella App Console crea un'app «Scoped access», tipo «App folder» (Kubo vede solo la sua cartella Apps/\<nome app\>). 2. Scheda Permissions: spunta files.metadata.read, files.content.read, files.content.write e premi Submit. 3. Scheda Settings: in Redirect URIs aggiungi http://localhost:\<porta di Kubo\>/api/connettori/dropbox/oauth/ritorno. 4. In Kubo incolla App key e App secret, accendi il connettore e premi «Collega». 5. Scegli se salvare da solo le fatture emesse e quanti backup tenere. Un file oltre 150 MB viene rifiutato.
- **Sito e fonti:** [sito](https://www.dropbox.com) · [fonte 1](https://www.dropbox.com/developers/documentation/http/documentation) · [fonte 2](https://developers.dropbox.com/oauth-guide) · [fonte 3](https://www.dropbox.com/developers/reference/auth-types)

<a id="google-drive"></a>
### Google Drive · `google-drive`

Fatture e documenti su Google Drive, cartelle per anno, e il backup del database ogni notte.

- **Costo:** Gratis (15 GB gratis con un account Google (condivisi con Gmail e Foto); Google One da 100 GB a 1,99 €/mese o 19,99 €/anno. L'API di Drive non costa.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e client secret OAuth (tipo «Applicazione web»)](https://console.cloud.google.com/apis/credentials) (Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth); [L'API Google Drive attivata nel progetto](https://console.cloud.google.com/apis/library/drive.googleapis.com) (Google Cloud Console → API e servizi → Libreria → Google Drive API → Abilita)
- **Passi:** 1. Crea un progetto su Google Cloud Console e abilita la Google Drive API. 2. Schermata di consenso OAuth: tipo «Esterno», aggiungi te stesso come utente di test (o pubblica l'app) e lo scope …/auth/drive.file. 3. Crea un ID client OAuth di tipo «Applicazione web» con URI di reindirizzamento http://localhost:\<porta di Kubo\>/api/connettori/google-drive/oauth/ritorno. 4. In Kubo incolla client ID e client secret, accendi il connettore e premi «Collega». 5. Scegli se salvare da solo le fatture emesse e quanti backup notturni tenere (predefinito 14). 6. Dalla scheda di una fattura usa «Salva su Google Drive», o chiedi a Lumi «salva la fattura 12 su Drive».
- **Sito e fonti:** [sito](https://www.google.com/drive/) · [fonte 1](https://developers.google.com/workspace/drive/api/guides/manage-uploads) · [fonte 2](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) · [fonte 3](https://developers.google.com/identity/protocols/oauth2/web-server)

<a id="onedrive"></a>
### OneDrive · `onedrive`

Fatture e documenti su OneDrive, cartelle per anno, e il backup del database ogni notte.

- **Costo:** Gratis (OneDrive gratis con 5 GB; Microsoft 365 Basic 100 GB a 2 €/mese; Microsoft 365 Personal (1 TB) a 99 €/anno. Microsoft Graph non costa.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [ID applicazione (client) di una registrazione app, con «Consenti flussi client pubblici» attivo](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (Microsoft Entra admin center → Identità → Applicazioni → Registrazioni app → Nuova registrazione → Autenticazione)
- **Passi:** 1. Nell'Entra admin center (o portal.azure.com) crea una registrazione app: tipi di account «qualsiasi directory e account Microsoft personali». 2. Autenticazione: aggiungi la piattaforma «App per dispositivi mobili e desktop» con http://localhost e attiva «Consenti flussi client pubblici» (serve al device code). 3. Autorizzazioni API: Microsoft Graph → delegate → Files.ReadWrite e offline\_access. 4. In Kubo incolla l'ID applicazione (client), lascia il tenant «common» (o metti quello della tua azienda) e accendi il connettore. 5. Collega l'account con il codice dispositivo: apri microsoft.com/devicelogin e scrivi il codice che Kubo mostra (oppure «Collega» con il ritorno su localhost). 6. Scegli se salvare da solo le fatture emesse e quanti backup tenere. Un file oltre 250 MB viene rifiutato.
- **Sito e fonti:** [sito](https://www.microsoft.com/microsoft-365/onedrive/online-cloud-storage) · [fonte 1](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0) · [fonte 2](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) · [fonte 3](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0) · [fonte 4](https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0)

<a id="pcloud"></a>
### pCloud · `pcloud`

Fatture e documenti su pCloud (anche con i dati in Europa), cartelle per anno, e il backup del database ogni notte.

- **Costo:** Gratis (Piano gratuito fino a 10 GB; Premium 500 GB circa 4,99 €/mese o 49,99 €/anno, Premium Plus 2 TB circa 9,99 €/mese; esistono anche i piani a vita (pagamento unico). Lo spazio in UE (Lussemburgo) non costa di più. L'API non costa.)
- **Difficoltà:** Media · **Dove:** Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e Client secret di un'app pCloud](https://docs.pcloud.com/my_apps/) (pCloud → My applications (pagina sviluppatori) → New app → Settings); [La regione dei dati dell'account (Europa o Stati Uniti)](https://www.pcloud.com/data-regions/) (pCloud → Impostazioni → Account → Regione dei dati (si sceglie alla registrazione))
- **Passi:** 1. Accedi a pCloud, apri la pagina «My applications» degli sviluppatori e crea una nuova app. 2. Nelle impostazioni dell'app spunta i permessi di lettura e scrittura dei file. 3. Alla voce Redirect URIs aggiungi http://localhost:\<porta di Kubo\>/api/connettori/pcloud/oauth/ritorno. 4. In Kubo scegli la regione dei dati del tuo account (Europa se ti sei registrato con i dati in UE). 5. Incolla Client ID e Client secret, accendi il connettore e premi «Collega». 6. Premi «Prova la connessione»: se dice di controllare la regione, cambiala e collega di nuovo. 7. Scegli se salvare da solo le fatture emesse e quanti backup notturni tenere (predefinito 14).
- **Sito e fonti:** [sito](https://www.pcloud.com) · [fonte 1](https://docs.pcloud.com/methods/oauth_2.0/authorize.html) · [fonte 2](https://docs.pcloud.com/methods/oauth_2.0/oauth2_token.html) · [fonte 3](https://docs.pcloud.com/methods/oauth_2.0/) · [fonte 4](https://docs.pcloud.com/methods/file/uploadfile.html) · [fonte 5](https://docs.pcloud.com/methods/folder/createfolderifnotexists.html) · [fonte 6](https://docs.pcloud.com/methods/folder/listfolder.html) · [fonte 7](https://docs.pcloud.com/methods/file/deletefile.html)

<a id="s3"></a>
### Archivio S3 · `s3`

Fatture, documenti e backup notturno su AWS S3, Backblaze B2, Wasabi, Cloudflare R2 o un altro S3.

- **Costo:** A consumo (Si paga lo spazio: AWS S3 Standard circa 0,023 $/GB al mese (Milano eu-south-1 poco di più); Backblaze B2 6 $/TB al mese con 10 GB gratis; Wasabi 6,99 $/TB al mese (minimo 1 TB); Cloudflare R2 0,015 $/GB al mese con 10 GB gratis e uscita gratuita. Per i backup di Kubo bastano pochi centesimi al mese.)
- **Difficoltà:** Media · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Un bucket privato e la sua regione](https://s3.console.aws.amazon.com/s3/) (AWS: Console S3 → Crea bucket · B2: Buckets → Create a Bucket · R2: R2 Object Storage → Create bucket); [Chiave di accesso e chiave segreta limitate a quel bucket](https://console.aws.amazon.com/iam/) (AWS: IAM → Utenti → Credenziali di sicurezza → Crea chiave di accesso · B2: Application Keys → Add a New Application Key · R2: Manage R2 API Tokens)
- **Passi:** 1. Crea un bucket privato (meglio in una regione UE: eu-south-1 Milano su AWS, eu-central-003 su B2). 2. Crea una chiave di accesso con i soli permessi di lettura, scrittura e cancellazione su quel bucket. 3. In Kubo scrivi bucket e regione; per B2, Wasabi o R2 anche l'endpoint (es. https://s3.eu-central-003.backblazeb2.com, https://s3.eu-central-1.wasabisys.com, https://\<account\>.r2.cloudflarestorage.com con regione «auto»). 4. Incolla chiave di accesso e chiave segreta, accendi il connettore e premi «Prova». 5. Scegli se salvare da solo le fatture emesse e quanti backup tenere (predefinito 14).
- **Sito e fonti:** [sito](https://aws.amazon.com/s3/) · [fonte 1](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html) · [fonte 2](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html) · [fonte 3](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html) · [fonte 4](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html) · [fonte 5](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api) · [fonte 6](https://developers.cloudflare.com/r2/api/s3/api/)

<a id="webdav"></a>
### Archivio WebDAV · `webdav`

Fatture, documenti e backup notturno su Nextcloud, ownCloud, Synology o qualsiasi WebDAV.

- **Costo:** Gratis (Il protocollo è gratuito: paghi solo lo spazio. Nextcloud o un NAS Synology in ufficio non costano nulla oltre all'hardware; Nextcloud in hosting da circa 3–5 €/mese (es. Hetzner Storage Share da 1 TB), Koofr 10 GB gratis.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Indirizzo WebDAV, utente e una password per app](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html) (Nextcloud: Impostazioni personali → Sicurezza → Dispositivi e sessioni → Crea nuova password per app; l'indirizzo è in File → Impostazioni file (in basso a sinistra) → WebDAV); [Synology: il pacchetto WebDAV Server attivo (HTTPS, porta 5006)](https://kb.synology.com/en-global/DSM/help/WebDAVServer/webdav_server) (DSM → Centro pacchetti → WebDAV Server → Abilita HTTPS)
- **Passi:** 1. Prendi l'indirizzo WebDAV: Nextcloud https://\<server\>/remote.php/dav/files/\<utente\>/, ownCloud https://\<server\>/remote.php/webdav/, Synology https://\<nas\>:5006/. 2. Crea una password per app (Nextcloud: Impostazioni → Sicurezza). Non usare la password principale. 3. In Kubo scrivi indirizzo e utente, incolla la password per app e accendi il connettore. 4. Se il server è un NAS in casa o in ufficio, spunta «permetti la rete interna» nella pagina del connettore. 5. Premi «Prova», poi scegli se salvare da solo le fatture emesse e quanti backup tenere. 6. iCloud Drive non ha WebDAV: per Apple usa un altro archivio (Drive, Dropbox, OneDrive o S3).
- **Sito e fonti:** [sito](https://nextcloud.com) · [fonte 1](https://www.rfc-editor.org/rfc/rfc4918) · [fonte 2](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html) · [fonte 3](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html) · [fonte 4](https://kb.synology.com/en-global/DSM/help/WebDAVServer/webdav_server)

## Produttività (14)

<a id="airtable"></a>
### Airtable · `airtable`

Tiene una tabella di Airtable allineata a una sezione di Kubo.

- **Costo:** In abbonamento (Piano Free: 1.000 righe per base e 1.000 chiamate API al mese. Team da 20 $ per utente al mese (fatturazione annuale), con 100.000 chiamate al mese.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Personal access token con gli scope data.records:read, data.records:write e schema.bases:read, e accesso alla base](https://airtable.com/create/tokens) (Airtable → icona del profilo → Builder hub → Personal access tokens → Create token); [L'id della base (app…) e il nome della tabella](https://support.airtable.com/docs/finding-airtable-ids) (Apri la base: l'indirizzo è airtable.com/appXXXXXXXX/tblYYYYYY/…); [Un campo di testo «Kubo ID» nella tabella, e colonne con gli stessi nomi dei campi di Kubo](https://support.airtable.com/docs/supported-field-types-in-airtable-overview) (Nella tabella: «+» in fondo alle colonne → Single line text)
- **Passi:** 1. Crea in Airtable la tabella e dai alle colonne gli stessi nomi dei campi di Kubo (es. Nome, Email, Telefono). 2. Aggiungi una colonna di testo «Kubo ID»: Kubo la usa per riconoscere le righe già copiate. 3. Crea un personal access token con data.records:read, data.records:write, schema.bases:read e aggiungi la base. 4. Incolla token, id della base (app…), nome della tabella e la sezione di Kubo da copiare. 5. Premi «Prova la connessione», poi «Copia tutto in Airtable»: da lì ogni 15 minuti passano solo le righe cambiate.
- **Sito e fonti:** [sito](https://www.airtable.com) · [fonte 1](https://airtable.com/developers/web/api/update-multiple-records) · [fonte 2](https://airtable.com/developers/web/api/get-base-schema) · [fonte 3](https://airtable.com/developers/web/api/rate-limits) · [fonte 4](https://airtable.com/developers/web/guides/personal-access-tokens) · [fonte 5](https://airtable.com/pricing)

<a id="asana"></a>
### Asana · `asana`

Lumi crea i compiti in Asana; le attività, gli interventi o le commesse nuove diventano compiti.

- **Costo:** Gratis (Piano Personal gratuito (fino a 10 persone), con l'API. Starter circa 10,99 $ per utente al mese con fatturazione annuale; Advanced circa 24,99 $.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un Personal Access Token](https://app.asana.com/0/my-apps) (Asana → Developer console → Personal access tokens → Create new token); [L'id (gid) del progetto](https://developers.asana.com/docs/personal-access-token) (Apri il progetto: è il numero lungo nell'indirizzo, dopo /project/ (o dopo /0/))
- **Passi:** 1. Apri la Developer console di Asana e crea un Personal Access Token: copialo subito, non si rivede. 2. Apri il progetto dove vuoi i compiti e copia il numero lungo dall'indirizzo (il gid del progetto). 3. Incolla token e id del progetto e premi «Prova la connessione». 4. Accendi le sezioni che vuoi trasformare in compiti (attività, interventi, commesse). 5. Da qui chiedi a Lumi «metti in Asana: preparare l'offerta per Bianchi entro il 15»: ti mostra il compito e lo crea dopo la conferma.
- **Sito e fonti:** [sito](https://asana.com) · [fonte 1](https://developers.asana.com/reference/createtask) · [fonte 2](https://developers.asana.com/docs/personal-access-token) · [fonte 3](https://developers.asana.com/reference/getuser) · [fonte 4](https://asana.com/pricing)

<a id="baserow"></a>
### Baserow · `baserow`

Tiene una tabella di Baserow (anche installato in proprio) allineata a una sezione di Kubo.

- **Costo:** Gratis (Open source: installato in proprio è gratuito e senza limiti di righe. Su baserow.io il piano Free è gratuito (fino a 3.000 righe per area di lavoro); Premium circa 10 $ per utente al mese.)
- **Difficoltà:** Facile · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Un token del database con il permesso di creare, leggere e aggiornare righe](https://baserow.io/user-docs/personal-api-tokens) (Baserow → il tuo nome in alto a sinistra → Impostazioni → Token del database → Crea token, scegli l'area di lavoro); [L'id della tabella](https://baserow.io/api-docs) (Apri la tabella: è il numero dopo /table/ nell'indirizzo (o nella documentazione API del database)); [L'indirizzo del server, se Baserow è installato in proprio](https://baserow.io/docs/index) (L'indirizzo che apri nel browser, es. https://baserow.bottega.it)
- **Passi:** 1. Crea in Baserow la tabella e dai alle colonne gli stessi nomi dei campi di Kubo (es. Nome, Email, Telefono). 2. Se vuoi, aggiungi una colonna di testo «Kubo ID»: ci finisce l'id della riga di Kubo. 3. Crea un token del database (Impostazioni → Token del database) con creare, leggere e aggiornare. 4. Incolla indirizzo del server (lascia quello predefinito per baserow.io), token, id della tabella e la sezione di Kubo. 5. Premi «Prova la connessione», poi «Copia tutto in Baserow»: da lì ogni 15 minuti passano solo le righe cambiate.
- **Sito e fonti:** [sito](https://baserow.io) · [fonte 1](https://baserow.io/api-docs) · [fonte 2](https://baserow.io/user-docs/personal-api-tokens) · [fonte 3](https://baserow.io/docs/apis/rest-api) · [fonte 4](https://baserow.io/pricing)

<a id="carddav"></a>
### Rubrica CardDAV (iCloud, Nextcloud) · `carddav`

I clienti nella rubrica del telefono (iCloud, Nextcloud, Fastmail…): quando chiamano, vedi chi è.

- **Costo:** Gratis (Gratis: usa la rubrica che hai già (iCloud, Nextcloud, Fastmail, Synology Contacts).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Per iCloud: l'Apple ID e una password per app](https://account.apple.com) (account.apple.com → Accesso e sicurezza → Password specifiche per le app → Genera (serve l'autenticazione a due fattori)); [Per Nextcloud: l'indirizzo CardDAV e una password per app](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html) (Nextcloud → Contatti → Impostazioni (in basso) → ⋯ della rubrica → Copia link; Impostazioni personali → Sicurezza → Crea una nuova password per app)
- **Passi:** 1. iCloud: genera una password per app su account.apple.com 2. Lascia il server https://contacts.icloud.com e scrivi il tuo Apple ID e la password per app 3. Nextcloud: scrivi come server https://\<tuo-cloud\>/remote.php/dav e utente e password per app 4. Accendi e premi «Prova»: mostra la rubrica trovata (con «Elenca le rubriche» puoi sceglierne un'altra) 5. Premi «Sincronizza ora» su «Tutti i clienti in rubrica»: da lì ogni cliente nuovo o cambiato va in rubrica da solo
- **Sito e fonti:** [sito](https://www.icloud.com/contacts) · [fonte 1](https://datatracker.ietf.org/doc/html/rfc6352) · [fonte 2](https://datatracker.ietf.org/doc/html/rfc2426) · [fonte 3](https://support.apple.com/102654) · [fonte 4](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/contacts.html)

<a id="clickup"></a>
### ClickUp · `clickup`

Lumi crea i compiti in ClickUp; le attività, gli interventi o le commesse nuove diventano compiti.

- **Costo:** Gratis (Piano Free Forever gratuito (100 MB di spazio, utenti illimitati), con l'API. Unlimited circa 7 $ per utente al mese con fatturazione annuale; Business circa 12 $.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il token API personale (inizia con pk\_)](https://app.clickup.com/settings/apps) (ClickUp → avatar in alto → Impostazioni → App → API Token → Generate); [L'id della lista](https://help.clickup.com/hc/en-us/articles/6303426241687-Use-the-ClickUp-API) (Apri la lista nel browser: è il numero dopo /li/ nell'indirizzo (o «Copy link» dal menu della lista))
- **Passi:** 1. In ClickUp apri Impostazioni → App e genera il token API personale (pk\_…). 2. Apri la lista dove vuoi i compiti e copia il numero che segue /li/ nell'indirizzo. 3. Incolla token e id della lista e premi «Prova la connessione»: vedi il nome della lista. 4. Accendi le sezioni che vuoi trasformare in compiti (attività, interventi, commesse). 5. Da qui chiedi a Lumi «metti in ClickUp: ordinare il materiale entro il 20»: ti mostra il compito e lo crea dopo la conferma.
- **Sito e fonti:** [sito](https://clickup.com) · [fonte 1](https://developer.clickup.com/reference/createtask) · [fonte 2](https://developer.clickup.com/docs/authentication) · [fonte 3](https://developer.clickup.com/reference/getlist) · [fonte 4](https://clickup.com/pricing)

<a id="excel-online"></a>
### Excel (Microsoft 365) · `excel-online`

Copia una sezione di Kubo in un file Excel su OneDrive, ogni ora o quando vuoi.

- **Costo:** Gratis (Gratis con un account Microsoft personale (Excel per il web e 5 GB di OneDrive); con Microsoft 365 Business Basic circa 5,60 € per utente al mese. L'API Graph non costa niente.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'ID applicazione (client) di un'app registrata con il permesso delegato Files.ReadWrite e i flussi client pubblici attivi](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (entra.microsoft.com → Registrazioni app → Nuova registrazione → Autenticazione → Consenti flussi client pubblici: Sì → Autorizzazioni API → Microsoft Graph → Delegate → Files.ReadWrite); [Una cartella di lavoro Excel vuota in OneDrive](https://onedrive.live.com) (onedrive.live.com (o OneDrive di lavoro) → Nuovo → Cartella di lavoro di Excel → salvala come Kubo/Kubo.xlsx)
- **Passi:** 1. In OneDrive crea la cartella «Kubo» e dentro una cartella di lavoro Excel vuota «Kubo.xlsx» 2. Su entra.microsoft.com registra un'app, attiva «Consenti flussi client pubblici» e aggiungi il permesso Files.ReadWrite 3. Incolla qui l'ID applicazione; per un account personale scrivi «consumers» come tenant 4. Scegli la sezione da esportare (es. clienti) e premi «Collega»: apri microsoft.com/devicelogin e scrivi il codice 5. Premi «Esporta ora in Excel» (o chiedilo a Lumi): il foglio si riempie, e poi si aggiorna ogni ora
- **Sito e fonti:** [sito](https://www.microsoft.com/microsoft-365/excel) · [fonte 1](https://learn.microsoft.com/graph/api/range-update) · [fonte 2](https://learn.microsoft.com/graph/api/range-clear) · [fonte 3](https://learn.microsoft.com/graph/api/worksheetcollection-add) · [fonte 4](https://learn.microsoft.com/graph/api/worksheet-usedrange) · [fonte 5](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code)

<a id="google-contatti"></a>
### Google Contatti · `google-contatti`

I clienti nella rubrica Google del telefono: quando chiamano, vedi chi è.

- **Costo:** Gratis (Gratis con un account Google (fino a 25.000 contatti). La People API non ha costi.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un client OAuth «Applicazione web» (client ID e client secret) con la People API abilitata](https://console.cloud.google.com/apis/library/people.googleapis.com) (console.cloud.google.com → API e servizi → Libreria → «People API» → Abilita; Credenziali → Crea credenziali → ID client OAuth → Applicazione web)
- **Passi:** 1. Su console.cloud.google.com crea un progetto (o usa quello di Calendario/Gmail) e abilita la People API 2. Nella schermata di consenso OAuth aggiungi l'ambito contacts e pubblica l'app (in Test il collegamento scade dopo 7 giorni) 3. Crea un ID client OAuth di tipo Applicazione web con l'URI di reindirizzamento \<indirizzo di Kubo\>/api/connettori/google-contatti/oauth/ritorno 4. Incolla client ID e secret, premi «Collega» e accetta 5. Premi «Sincronizza ora» su «Tutti i clienti in rubrica»: da lì i clienti nuovi o cambiati vanno in rubrica da soli
- **Sito e fonti:** [sito](https://contacts.google.com) · [fonte 1](https://developers.google.com/people/api/rest/v1/people/createContact) · [fonte 2](https://developers.google.com/people/api/rest/v1/people/updateContact) · [fonte 3](https://developers.google.com/people/v1/contacts#create_a_new_contact) · [fonte 4](https://support.google.com/contacts/answer/7208229)

<a id="google-sheets"></a>
### Fogli Google · `google-sheets`

Copia una sezione di Kubo in un foglio Google, ogni ora o quando vuoi.

- **Costo:** Gratis (Gratis con un account Google personale; con Google Workspace da 7 € circa per utente al mese (Business Starter). L'API di Fogli non costa niente, con limiti di 300 richieste al minuto per progetto.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e client secret OAuth (tipo «Applicazione web»)](https://console.cloud.google.com/apis/credentials) (Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth); [L'API Google Sheets attivata nel progetto](https://console.cloud.google.com/apis/library/sheets.googleapis.com) (Google Cloud Console → API e servizi → Libreria → Google Sheets API → Abilita); [L'id del foglio di calcolo](https://sheets.google.com) (Apri il foglio: è la parte dell'indirizzo tra /d/ e /edit)
- **Passi:** 1. Crea un progetto su Google Cloud Console e abilita la Google Sheets API. 2. Configura la schermata di consenso OAuth (tipo «Esterno», aggiungi te stesso tra gli utenti di prova). 3. Crea un ID client OAuth «Applicazione web» con l'indirizzo di ritorno che Kubo mostra in questa pagina. 4. Incolla client ID e client secret, poi premi «Collega» e accedi con l'account Google proprietario del foglio. 5. Scegli la sezione (es. clienti), incolla l'id del foglio e, se vuoi, il nome della scheda. 6. Premi «Esporta ora»: la scheda si riempie; da lì in poi si aggiorna ogni ora.
- **Sito e fonti:** [sito](https://workspace.google.com/products/sheets/) · [fonte 1](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update) · [fonte 2](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/clear) · [fonte 3](https://developers.google.com/workspace/sheets/api/guides/values) · [fonte 4](https://developers.google.com/identity/protocols/oauth2/web-server)

<a id="google-tasks"></a>
### Google Tasks · `google-tasks`

Lumi segna i compiti in Google Tasks; le attività, gli interventi o le commesse nuove diventano compiti.

- **Costo:** Gratis (Google Tasks è gratuito con qualunque account Google (anche Gmail personale) e incluso in Google Workspace. L'API Tasks non costa (quota di 50.000 richieste al giorno).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Client ID e client secret OAuth (tipo «Applicazione web»)](https://console.cloud.google.com/apis/credentials) (Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth); [L'API Google Tasks attivata nel progetto](https://console.cloud.google.com/apis/library/tasks.googleapis.com) (Google Cloud Console → API e servizi → Libreria → Google Tasks API → Abilita)
- **Passi:** 1. Crea un progetto su Google Cloud Console e abilita la Google Tasks API. 2. Schermata di consenso OAuth: tipo «Esterno», aggiungi te stesso come utente di test (o pubblica l'app) e lo scope …/auth/tasks. 3. Crea un ID client OAuth «Applicazione web» con URI di reindirizzamento http://localhost:\<porta di Kubo\>/api/connettori/google-tasks/oauth/ritorno. 4. In Kubo incolla client ID e client secret, accendi il connettore e premi «Collega». 5. Facoltativo: scrivi il nome della lista dove far cadere i compiti (vuoto: «I miei compiti»). 6. Accendi le sezioni da trasformare in compiti e chiedi a Lumi «aggiungi ai compiti di Google: chiamare il commercialista il 15».
- **Sito e fonti:** [sito](https://workspace.google.com/products/tasks/) · [fonte 1](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/insert) · [fonte 2](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks) · [fonte 3](https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list) · [fonte 4](https://developers.google.com/workspace/tasks/auth) · [fonte 5](https://developers.google.com/identity/protocols/oauth2/web-server)

<a id="microsoft-todo"></a>
### Microsoft To Do · `microsoft-todo`

Lumi segna i compiti in Microsoft To Do; le attività, gli interventi o le commesse nuove diventano compiti.

- **Costo:** Gratis (Microsoft To Do è gratuito con qualunque account Microsoft (anche personale, Outlook.com); incluso nei piani Microsoft 365 aziendali. L'API Graph non costa.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'ID applicazione (client) di un'app registrata come client pubblico](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) (portale Azure / Microsoft Entra → Registrazioni app → Nuova registrazione → Autenticazione → «Consenti flussi client pubblici»: Sì); [Il permesso delegato Tasks.ReadWrite di Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-reference#tasksreadwrite) (La stessa app → Autorizzazioni API → Aggiungi → Microsoft Graph → Autorizzazioni delegate → Tasks.ReadWrite)
- **Passi:** 1. Su Microsoft Entra registra una nuova app: tipi di account «personali e aziendali» (o solo la tua organizzazione). 2. In Autenticazione attiva «Consenti flussi client pubblici»; in Autorizzazioni API aggiungi Tasks.ReadWrite di Microsoft Graph. 3. In Kubo incolla l'ID applicazione; tenant «common» (o «consumers» per un account personale, o l'id della tua directory). 4. Accendi il connettore e premi «Collega»: apri microsoft.com/devicelogin e scrivi il codice che vedi. 5. Facoltativo: scrivi il nome della lista dove far cadere i compiti (vuoto: «Attività»). 6. Accendi le sezioni da trasformare in compiti e chiedi a Lumi «segna su To Do: rinnovare l'assicurazione entro il 30».
- **Sito e fonti:** [sito](https://to-do.office.com) · [fonte 1](https://learn.microsoft.com/en-us/graph/api/todotasklist-post-tasks?view=graph-rest-1.0) · [fonte 2](https://learn.microsoft.com/en-us/graph/api/todo-list-lists?view=graph-rest-1.0) · [fonte 3](https://learn.microsoft.com/en-us/graph/api/resources/todotask?view=graph-rest-1.0) · [fonte 4](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)

<a id="notion"></a>
### Notion · `notion`

Copia una sezione di Kubo in un database di Notion, una pagina per riga.

- **Costo:** Gratis (Il piano Free basta per l'integrazione; Plus da 10 € per utente al mese (fatturazione annuale). L'API non costa niente, con un limite medio di 3 richieste al secondo.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il token di un'integrazione interna (Internal Integration Secret)](https://www.notion.so/profile/integrations) (notion.so/profile/integrations → Nuova integrazione → tipo Interna → Configurazione → Secret); [L'accesso dell'integrazione al database](https://www.notion.com/help/add-and-manage-connections-with-the-api) (Nel database: ••• in alto a destra → Connessioni → aggiungi l'integrazione); [L'id del database](https://developers.notion.com/reference/retrieve-a-database) (Apri il database a tutta pagina → Copia link: sono i 32 caratteri prima di «?v=»)
- **Passi:** 1. In Notion crea un database con le colonne chiamate come i campi di Kubo (es. Nome, Email, Telefono). 2. Crea un'integrazione interna su notion.so/profile/integrations e copia il secret. 3. Nel database apri ••• → Connessioni e aggiungi l'integrazione, altrimenti Notion risponde 404. 4. Incolla il secret, il link o l'id del database e la sezione di Kubo da copiare. 5. Premi «Prova la connessione», poi «Copia tutto in Notion»: da lì ogni 15 minuti passano solo le righe cambiate.
- **Sito e fonti:** [sito](https://www.notion.com) · [fonte 1](https://developers.notion.com/reference/post-page) · [fonte 2](https://developers.notion.com/reference/patch-page) · [fonte 3](https://developers.notion.com/reference/retrieve-a-database) · [fonte 4](https://developers.notion.com/reference/page-property-values) · [fonte 5](https://developers.notion.com/reference/versioning) · [fonte 6](https://developers.notion.com/reference/request-limits)

<a id="todoist"></a>
### Todoist · `todoist`

Lumi segna i compiti in Todoist; le attività, gli interventi o le commesse nuove diventano compiti.

- **Costo:** Gratis (Piano Beginner gratuito (fino a 5 progetti personali), con l'API. Pro circa 4 € al mese con fatturazione annuale; Business circa 6 € per utente al mese.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il token API personale](https://app.todoist.com/app/settings/integrations/developer) (Todoist → Impostazioni → Integrazioni → Sviluppatore → Token API → Copia); [Facoltativo: l'id del progetto predefinito](https://www.todoist.com/help/articles/find-your-project-id-or-task-id-6IqXPXbM) (Apri il progetto nel browser: è il numero (o codice) in fondo all'indirizzo)
- **Passi:** 1. In Todoist apri Impostazioni → Integrazioni → Sviluppatore e copia il token API. 2. Incollalo qui; se vuoi, scrivi l'id del progetto dove far cadere i compiti (vuoto: la Inbox). 3. Premi «Prova la connessione»: vedi quanti progetti hai. 4. Accendi le sezioni che vuoi trasformare in compiti (attività, interventi, commesse). 5. Da qui chiedi a Lumi «ricordami di chiamare Rossi venerdì»: ti mostra il compito e lo crea dopo la conferma.
- **Sito e fonti:** [sito](https://www.todoist.com) · [fonte 1](https://developer.todoist.com/api/v1/#tag/Tasks/operation/create_task_api_v1_tasks_post) · [fonte 2](https://developer.todoist.com/api/v1/#tag/Projects/operation/get_projects_api_v1_projects_get) · [fonte 3](https://developer.todoist.com/api/v1/#tag/Authorization) · [fonte 4](https://www.todoist.com/pricing)

<a id="trello"></a>
### Trello · `trello`

Lumi crea le schede su Trello; le attività, gli interventi o le commesse nuove diventano schede.

- **Costo:** Gratis (Piano Free gratuito (fino a 10 collaboratori per Workspace), con l'API. Standard 5 $ per utente al mese con fatturazione annuale; Premium 10 $.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Una Power-Up (serve per avere la chiave API) e la sua API key](https://trello.com/power-ups/admin) (trello.com/power-ups/admin → Nuovo → compila e crea → API key → Genera una nuova chiave API); [Il token del tuo account](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/) (Nella pagina della API key, link «Token» accanto alla chiave → Consenti); [L'id della lista](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/) (Apri una scheda della lista, aggiungi «.json» all'indirizzo e cerca «idList»)
- **Passi:** 1. Vai su trello.com/power-ups/admin e crea una Power-Up per il tuo Workspace (il nome è libero, es. Kubo). 2. Nella scheda «API key» genera la chiave, poi premi «Token» e consenti l'accesso: copia chiave e token. 3. Trova l'id della lista: apri una sua scheda, aggiungi «.json» all'indirizzo e copia il valore di «idList». 4. Incolla chiave, token e id della lista e premi «Prova la connessione»: vedi il nome della lista. 5. Accendi le sezioni che vuoi trasformare in schede (es. gli interventi dell'officina).
- **Sito e fonti:** [sito](https://trello.com) · [fonte 1](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/#api-cards-post) · [fonte 2](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/) · [fonte 3](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/) · [fonte 4](https://trello.com/pricing)

<a id="webhook-semplice"></a>
### Webhook semplice (n8n, Make, Zapier) · `webhook-semplice`

Manda le novità di Kubo a n8n, Make, Zapier o a un tuo programma, e riceve da loro clienti e appuntamenti.

- **Costo:** Gratis (Il webhook di Kubo è gratis. n8n è gratuito se lo installi tu (open source); Make ha un piano Free con 1.000 operazioni al mese; i webhook di Zapier richiedono un piano a pagamento (da circa 20 $ al mese).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'indirizzo del webhook che riceve gli eventi](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) (n8n: nodo «Webhook» → Production URL; Make: modulo Webhooks → Custom webhook → Copy address; Zapier: trigger «Webhooks by Zapier» → Catch Hook); [Per ricevere: l'indirizzo di Kubo con il codice segreto (serve un indirizzo pubblico)](https://www.make.com/en/help/tools/http) (questa pagina → «Codice segreto per ricevere»: l'indirizzo è …/api/connettori/webhook-semplice/in/\<codice\>)
- **Passi:** 1. In n8n, Make o Zapier crea uno scenario che parte da un webhook e copia il suo indirizzo 2. Incollalo qui e scegli le sezioni da mandare (es. clienti, vendite, appuntamenti) 3. Accendi e premi «Prova»: lo scenario riceve un evento «prova» con cui impostare i campi 4. Per controllare che arrivi da Kubo, verifica X-Kubo-Firma con il «segreto della firma» (HMAC-SHA256 di «t.corpo») 5. Per far creare clienti o appuntamenti da fuori, manda un POST JSON { "azione": "crea", "sezione": "clienti", "valori": { "nome": "…", "email": "…" } } all'indirizzo con il codice segreto
- **Sito e fonti:** [sito](https://n8n.io) · [fonte 1](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) · [fonte 2](https://www.make.com/en/help/tools/webhooks) · [fonte 3](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks) · [fonte 4](https://docs.stripe.com/webhooks#verify-manually)

## Marketing (12)

<a id="activecampaign"></a>
### ActiveCampaign · `activecampaign`

I clienti con il consenso tra i contatti di ActiveCampaign, iscritti a una lista; chi si disiscrive torna in Kubo.

- **Costo:** In abbonamento (Prova gratuita di 14 giorni; piano Starter da circa 15 $ al mese (1.000 contatti, fatturazione annuale), Plus da circa 49 $; il prezzo sale con i contatti. L'API è compresa in tutti i piani.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'URL dell'API e la chiave API](https://help.activecampaign.com/hc/en-us/articles/207317590-Getting-started-with-the-API) (ActiveCampaign → Impostazioni (ingranaggio in basso a sinistra) → Sviluppatore: «URL» e «Chiave»); [L'id della lista (e, se vuoi, di un tag)](https://help.activecampaign.com/hc/en-us/articles/115000867664-How-to-find-the-ID-for-lists-forms-and-other-items) (Contatti → Liste → apri la lista: è il numero «listid=» nell'indirizzo; i tag in Contatti → Gestisci tag)
- **Passi:** 1. In ActiveCampaign apri Impostazioni → Sviluppatore e copia URL e chiave API. 2. Apri Contatti → Liste, scegli la lista dei clienti e copia il numero dopo «listid=» nell'indirizzo. 3. Se vuoi un tag sui clienti di Kubo, crealo e copia il suo id (facoltativo). 4. Incolla URL, chiave, lista e tag; premi «Prova la connessione». 5. Premi «Sincronizza ora con ActiveCampaign»: passano i clienti con email e consenso. 6. Da lì ogni cliente nuovo o cambiato va subito ad ActiveCampaign, e ogni 30 minuti chi si disiscrive perde il consenso in Kubo.
- **Sito e fonti:** [sito](https://www.activecampaign.com) · [fonte 1](https://developers.activecampaign.com/reference/authentication) · [fonte 2](https://developers.activecampaign.com/reference/sync-a-contacts-data) · [fonte 3](https://developers.activecampaign.com/reference/update-list-status-for-contact) · [fonte 4](https://developers.activecampaign.com/reference/list-all-contacts) · [fonte 5](https://developers.activecampaign.com/reference/create-contact-tag) · [fonte 6](https://www.activecampaign.com/pricing)

<a id="google-ads-lead"></a>
### Google Ads (moduli per i lead) · `google-ads-lead`

Chi compila i moduli per i lead delle inserzioni Google diventa un cliente.

- **Costo:** A consumo (Il webhook è gratuito: si pagano solo i clic o le conversioni delle inserzioni, con il budget giornaliero scelto nella campagna (nessun minimo fisso).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un modulo per i lead collegato a una campagna, con l'URL del webhook e la chiave generata da Kubo](https://support.google.com/google-ads/answer/9423234) (Google Ads → Campagne → Asset → + → Modulo per i lead → Opzioni di consegna dei lead → Integrazione webhook); [Un indirizzo pubblico di Kubo con HTTPS raggiungibile da Internet](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel))
- **Passi:** 1. Accendi il connettore: Kubo crea la chiave del webhook. 2. Scrivi l'indirizzo pubblico di Kubo (con https) e premi «Dati da dare a Google Ads». 3. Su Google Ads apri il modulo per i lead → Opzioni di consegna dei lead → Integrazione webhook. 4. Incolla l'URL del webhook e la chiave, poi premi «Invia dati di prova»: Kubo avvisa che il collegamento funziona. 5. Salva il modulo: i lead veri diventano clienti, con la campagna nelle note.
- **Sito e fonti:** [sito](https://ads.google.com) · [fonte 1](https://developers.google.com/google-ads/webhook/docs/overview) · [fonte 2](https://developers.google.com/google-ads/webhook/docs/implementation) · [fonte 3](https://support.google.com/google-ads/answer/9423234)

<a id="hubspot"></a>
### HubSpot · `hubspot`

Clienti di Kubo e contatti di HubSpot allineati nei due sensi; le aziende con P.IVA come company.

- **Costo:** Gratis (HubSpot CRM gratuito (Free tools) con contatti illimitati fino a 1.000.000 e accesso alle API con le Private App; Starter Customer Platform da 9 € al mese per posto (fatturazione annuale).)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'access token di una Private App con gli scope crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.companies.write](https://app.hubspot.com/private-apps/) (HubSpot → Impostazioni (ingranaggio) → Integrazioni → Private App → Crea una Private App → Ambiti → Crea → Mostra token); [Solo per il webhook: il client secret della Private App e un indirizzo pubblico di Kubo](https://developers.hubspot.com/docs/guides/apps/private-apps/create-and-edit-webhook-subscriptions-in-private-apps) (Private App → Webhook (URL di destinazione) e scheda Autenticazione → Client secret)
- **Passi:** 1. In HubSpot apri Impostazioni → Integrazioni → Private App e crea un'app «Kubo». 2. Negli Ambiti spunta crm.objects.contacts.read, crm.objects.contacts.write e crm.objects.companies.write, poi crea l'app. 3. Copia l'access token (pat-…) e incollalo qui; premi «Prova la connessione». 4. Premi «Manda tutti i clienti a HubSpot»: i clienti con email diventano contatti, quelli con P.IVA anche aziende. 5. Da lì ogni cliente cambiato in Kubo va subito a HubSpot, e ogni 15 minuti i contatti cambiati in HubSpot arrivano in Kubo. 6. Facoltativo, se Kubo ha un indirizzo pubblico: nella Private App aggiungi il webhook verso \<indirizzo\>/api/connettori/hubspot/in con gli eventi dei contatti, e incolla qui il client secret.
- **Sito e fonti:** [sito](https://www.hubspot.com) · [fonte 1](https://developers.hubspot.com/docs/guides/api/crm/objects/contacts) · [fonte 2](https://developers.hubspot.com/docs/guides/api/crm/search) · [fonte 3](https://developers.hubspot.com/docs/guides/apps/private-apps/overview) · [fonte 4](https://developers.hubspot.com/docs/api/webhooks/validating-requests) · [fonte 5](https://www.hubspot.com/pricing/crm)

<a id="jotform"></a>
### Jotform · `jotform`

Chi compila un modulo Jotform diventa un cliente, con le risposte nelle note.

- **Costo:** Gratis (Il piano Starter gratuito (5 moduli, 100 risposte al mese) ha webhook e API; Bronze da 34 € al mese (annuale), Silver 39 €, Gold 99 €.)
- **Difficoltà:** Media · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Con indirizzo pubblico: il webhook del modulo con l'indirizzo che contiene il codice segreto di Kubo](https://www.jotform.com/help/245-how-to-setup-a-webhook-with-jotform/) (Jotform → apri il modulo → Impostazioni → Integrazioni → WebHooks); [Senza indirizzo pubblico (o per avere le etichette delle domande): una chiave API in sola lettura e gli id dei moduli](https://www.jotform.com/myaccount/api) (Jotform → Impostazioni dell'account → API → Crea nuova chiave (Read Access); l'id del modulo è il numero nel suo indirizzo)
- **Passi:** 1. Accendi il connettore: Kubo crea il codice segreto dell'indirizzo. 2. Se Kubo ha un indirizzo pubblico, scrivilo e copia l'indirizzo dato da «Indirizzo da dare a Jotform». 3. Su Jotform apri il modulo → Impostazioni → Integrazioni → WebHooks e incolla l'indirizzo. 4. Senza indirizzo pubblico: crea una chiave API (Read Access), incollala qui con gli id dei moduli; il giro passa ogni 15 minuti. 5. Se l'account è nell'UE (eu.jotform.com) scegli «ue» come zona dei dati. 6. Usa i campi Email, Telefono e Nome completo; per un appuntamento il campo Data (con l'ora) o Appuntamento. 7. Compila il modulo: il cliente compare in Kubo.
- **Sito e fonti:** [sito](https://www.jotform.com) · [fonte 1](https://api.jotform.com/docs/) · [fonte 2](https://www.jotform.com/help/245-how-to-setup-a-webhook-with-jotform/) · [fonte 3](https://www.jotform.com/help/253-how-to-create-a-jotform-api-key/) · [fonte 4](https://www.jotform.com/pricing/)

<a id="mailchimp"></a>
### Mailchimp · `mailchimp`

I clienti con il consenso nella lista della newsletter di Mailchimp, con i tag.

- **Costo:** In abbonamento (Piano Free fino a 250 contatti e 500 email al mese (un solo pubblico, l'API c'è). A pagamento da Essentials (circa 13 $ al mese per 500 contatti), il prezzo cresce con i contatti.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Una chiave API (finisce con il data center, es. -us21)](https://us1.admin.mailchimp.com/account/api/) (Mailchimp → icona del profilo → Profile → Extras → API keys → Create A Key); [L'Audience ID del pubblico](https://mailchimp.com/help/find-audience-id/) (Audience → All contacts → Settings → Audience name and defaults → Audience ID)
- **Passi:** 1. In Mailchimp crea una chiave API (Profile → Extras → API keys) e copiala subito: si vede una volta sola. 2. Copia l'Audience ID del pubblico in cui vuoi i clienti. 3. Incolla chiave e Audience ID, scegli se i nuovi iscritti ricevono l'email di conferma (doppio opt-in). 4. Se vuoi, scegli un campo dei clienti da usare come tag (per esempio il tipo: privato o azienda). 5. Premi «Prova la connessione», poi «Sincronizza ora»: passano solo i clienti con il consenso; chi si disiscrive in Mailchimp perde il consenso in Kubo ogni ora.
- **Sito e fonti:** [sito](https://mailchimp.com) · [fonte 1](https://mailchimp.com/developer/marketing/api/list-members/add-or-update-list-member/) · [fonte 2](https://mailchimp.com/developer/marketing/api/list-member-tags/add-or-remove-member-tags/) · [fonte 3](https://mailchimp.com/developer/marketing/api/list-members/list-members-info/) · [fonte 4](https://mailchimp.com/developer/marketing/docs/fundamentals/) · [fonte 5](https://mailchimp.com/pricing/marketing/)

<a id="mailerlite"></a>
### MailerLite · `mailerlite`

I clienti con il consenso tra gli iscritti della newsletter di MailerLite; chi si disiscrive torna in Kubo.

- **Costo:** Gratis (Piano Free gratuito fino a 500 iscritti e 12.000 email al mese, con l'API. Growing Business da circa 10 $ al mese (500 iscritti), il prezzo sale con gli iscritti.)
- **Difficoltà:** Facile · **Dove:** Mondo, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Un token API](https://dashboard.mailerlite.com/integrations/api) (MailerLite → Integrazioni → API → Genera un nuovo token (dagli un nome, es. Kubo)); [Facoltativo: l'id del gruppo](https://www.mailerlite.com/help/how-to-create-and-use-groups) (Iscritti → Gruppi → apri il gruppo: è il numero nell'indirizzo)
- **Passi:** 1. In MailerLite apri Integrazioni → API e genera un token: copialo subito. 2. Se vuoi i clienti in un gruppo, crealo in Iscritti → Gruppi e copia il numero dall'indirizzo. 3. Incolla token e id del gruppo e premi «Prova la connessione». 4. Premi «Sincronizza ora con MailerLite»: passano i clienti con email e consenso. 5. Da lì ogni cliente nuovo o cambiato va subito a MailerLite, e ogni 30 minuti chi si disiscrive perde il consenso in Kubo.
- **Sito e fonti:** [sito](https://www.mailerlite.com) · [fonte 1](https://developers.mailerlite.com/docs/subscribers.html) · [fonte 2](https://developers.mailerlite.com/docs/groups.html) · [fonte 3](https://developers.mailerlite.com/docs/#authentication) · [fonte 4](https://www.mailerlite.com/pricing)

<a id="mailup"></a>
### MailUp · `mailup`

I clienti con il consenso iscritti a una lista di MailUp; chi si disiscrive torna in Kubo senza consenso.

- **Costo:** In abbonamento (Prova gratuita di 30 giorni; piani a invii illimitati per numero di contatti: Basic da circa 75 € al mese (fino a 2.500 contatti, IVA esclusa); l'API è compresa in tutti i piani. Gli SMS si comprano a parte.)
- **Difficoltà:** Media · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Utente e password della console (es. m12345)](https://login.mailup.com) (Sono quelli con cui entri in MailUp); [Client ID e Client secret](https://help.mailup.com/display/mailupapi/Get+a+Developer+Account) (MailUp → Impostazioni → Impostazioni avanzate → Codici sviluppatore (Developer's corner) → Chiavi API: «Crea»); [L'id della lista](https://help.mailup.com/display/MUG/Lists) (Impostazioni → Liste: il numero (ID) accanto al nome della lista)
- **Passi:** 1. In MailUp apri Impostazioni → Impostazioni avanzate → Codici sviluppatore e crea le chiavi API: copia Client ID e Client secret. 2. In Impostazioni → Liste guarda l'ID della lista dove vuoi i clienti (di solito 1). 3. Incolla utente, password, Client ID, Client secret e id della lista; premi «Prova la connessione». 4. Premi «Sincronizza ora con MailUp»: passano i clienti con email e consenso (i cellulari italiani anche per gli SMS). 5. Da lì ogni cliente nuovo o cambiato va subito nella lista, e ogni 30 minuti chi si disiscrive perde il consenso in Kubo.
- **Sito e fonti:** [sito](https://www.mailup.it) · [fonte 1](https://help.mailup.com/display/mailupapi/Authenticating+with+OAuth+v2) · [fonte 2](https://help.mailup.com/display/mailupapi/Recipients) · [fonte 3](https://help.mailup.com/display/mailupapi/Lists+and+Groups) · [fonte 4](https://www.mailup.it/prezzi/)

<a id="meta-lead"></a>
### Meta Lead Ads · `meta-lead`

Chi compila i moduli delle inserzioni su Facebook e Instagram diventa un cliente.

- **Costo:** A consumo (L'API è gratuita: si pagano solo le inserzioni, con il budget scelto in Gestione inserzioni (asta a costo per lead o per impressioni, nessun minimo fisso oltre 1 € circa al giorno).)
- **Difficoltà:** Per smanettoni · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un'app Meta di tipo Business con i permessi leads\_retrieval, pages\_show\_list, pages\_read\_engagement, pages\_manage\_metadata, pages\_manage\_ads](https://developers.facebook.com/apps/) (developers.facebook.com → Le mie app → Crea app → Business → Casi d'uso / Permessi); [Il token di accesso della Pagina di lunga durata (non scade se nasce da un token utente di lunga durata)](https://developers.facebook.com/tools/explorer/) (Graph API Explorer → seleziona l'app e la Pagina → Genera token → poi Strumento di debug del token → Estendi; oppure un utente di sistema in Business Manager); [L'id di ogni modulo](https://business.facebook.com/latest/instant_forms) (Meta Business Suite → Tutti gli strumenti → Moduli istantanei (Strumenti per i moduli): la colonna ID); [Solo per il webhook: l'App Secret e un indirizzo pubblico di Kubo](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) (App → Impostazioni dell'app → Di base → Chiave segreta)
- **Passi:** 1. Crea un'app Meta di tipo Business e aggiungi i permessi leads\_retrieval, pages\_show\_list, pages\_read\_engagement, pages\_manage\_metadata e pages\_manage\_ads. 2. Con Graph API Explorer genera il token della Pagina; estendilo a lunga durata con lo strumento di debug (o usa un utente di sistema del Business Manager). 3. In Meta Business Suite → Strumenti per i moduli dai accesso ai lead all'app («Accesso ai lead» → CRM), altrimenti l'API risponde 403. 4. Incolla il token e gli id dei moduli (separati da virgola), poi premi «Prova la connessione». 5. Premi «Controlla i moduli adesso»: arrivano i lead degli ultimi 30 giorni, poi ogni 15 minuti quelli nuovi. 6. Facoltativo: se Kubo ha un indirizzo pubblico e l'abbonamento al campo «leadgen» è già verificato, punta il webhook a \<indirizzo\>/api/connettori/meta-lead/in e incolla qui l'App Secret.
- **Sito e fonti:** [sito](https://www.facebook.com/business/ads/lead-ads) · [fonte 1](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving) · [fonte 2](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) · [fonte 3](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/#leadgen) · [fonte 4](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived) · [fonte 5](https://developers.facebook.com/docs/permissions/reference/leads_retrieval)

<a id="pipedrive"></a>
### Pipedrive · `pipedrive`

Clienti di Kubo e persone di Pipedrive allineati; le aziende con P.IVA come organizzazioni; i preventivi diventano trattative.

- **Costo:** In abbonamento (Nessun piano gratuito (prova di 14 giorni). Lite da circa 14 € per utente al mese con fatturazione annuale, Growth circa 24 €, Premium circa 49 €, Ultimate circa 69 €. L'API c'è in tutti i piani.)
- **Difficoltà:** Facile · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Il token API personale](https://pipedrive.readme.io/docs/how-to-find-the-api-token) (Pipedrive → icona del profilo → Impostazioni personali → API → Copia il token); [Il dominio dell'azienda](https://pipedrive.readme.io/docs/how-to-get-the-company-domain) (È la prima parte dell'indirizzo che usi: \<azienda\>.pipedrive.com)
- **Passi:** 1. In Pipedrive apri l'icona del profilo → Impostazioni personali → API e copia il token. 2. Incolla qui il token e il dominio dell'azienda (la parte prima di .pipedrive.com). 3. Premi «Prova la connessione»: vedi il tuo nome. 4. Da qui ogni cliente nuovo o cambiato con email o telefono passa a Pipedrive; chi ha la P.IVA anche come organizzazione. 5. Ogni 15 minuti le persone nuove o cambiate in Pipedrive tornano in Kubo come clienti. 6. Su un preventivo premi «Crea la trattativa in Pipedrive», o chiedilo a Lumi.
- **Sito e fonti:** [sito](https://www.pipedrive.com) · [fonte 1](https://developers.pipedrive.com/docs/api/v1/Persons#getPersons) · [fonte 2](https://developers.pipedrive.com/docs/api/v1/Persons#addPerson) · [fonte 3](https://developers.pipedrive.com/docs/api/v1/Persons#searchPersons) · [fonte 4](https://developers.pipedrive.com/docs/api/v1/Organizations#addOrganization) · [fonte 5](https://developers.pipedrive.com/docs/api/v1/Deals#addDeal) · [fonte 6](https://pipedrive.readme.io/docs/core-api-concepts-authentication) · [fonte 7](https://www.pipedrive.com/en/pricing)

<a id="tally"></a>
### Tally · `tally`

Chi compila un modulo Tally diventa un cliente, con le risposte nelle note.

- **Costo:** Gratis (Il piano Free ha moduli e risposte illimitati e i webhook; Pro (29 $ al mese, 24 $ annuale) toglie il marchio e aggiunge domini propri.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un webhook sul modulo con la signing secret generata da Kubo](https://tally.so/help/webhooks) (Tally → apri il modulo → Integrations → Webhooks → Connect → Signing secret); [Un indirizzo pubblico di Kubo (dominio o tunnel) raggiungibile da Internet](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)); [Senza indirizzo pubblico: una chiave API e l'id dei moduli](https://developers.tally.so/api-reference/api-keys) (Tally → Impostazioni → API keys → Create API key; l'id è la parte dopo /forms/ nell'indirizzo del modulo)
- **Passi:** 1. Accendi il connettore: Kubo crea la signing secret. 2. Scrivi l'indirizzo pubblico di Kubo (con https). 3. Su Tally apri il modulo → Integrations → Webhooks → Connect. 4. Come Endpoint URL incolla l'indirizzo dato da «Indirizzo da dare a Tally»; in «Signing secret» incolla il segreto. 5. Usa i blocchi Email e Phone number (e una domanda «Nome»); per un appuntamento i blocchi Date e Time. 6. Compila il modulo: il cliente compare in Kubo (gli invii falliti Tally li riprova da solo). 7. Senza indirizzo pubblico: incolla una chiave API e gli id dei moduli; il giro passa ogni 15 minuti (o chiedi a Lumi di controllare).
- **Sito e fonti:** [sito](https://tally.so) · [fonte 1](https://tally.so/help/webhooks) · [fonte 2](https://developers.tally.so/api-reference/endpoint/forms/submissions/list) · [fonte 3](https://tally.so/pricing)

<a id="typeform"></a>
### Typeform · `typeform`

Chi compila un modulo Typeform diventa un cliente, con le risposte nelle note.

- **Costo:** In abbonamento (Il piano Free (10 risposte al mese) ha già i webhook; Basic da 25 € al mese (annuale) per 100 risposte, Plus 50 €, Business 83 €.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un webhook sul modulo, con il secret generato da Kubo](https://www.typeform.com/help/a/webhooks-360029573471/) (Typeform → apri il modulo → Connect → Webhooks → Add a webhook → poi Edit → Secret); [Un indirizzo pubblico di Kubo (dominio o tunnel) raggiungibile da Internet](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (Il tuo dominio con HTTPS, oppure un tunnel (Cloudflare Tunnel)); [Senza indirizzo pubblico: un token personale (permessi Forms: Read, Responses: Read) e l'id dei moduli](https://admin.typeform.com/user/tokens) (Typeform → Impostazioni dell'account → Personal tokens → Generate a new token; l'id è la parte dopo /to/ nel link del modulo)
- **Passi:** 1. Accendi il connettore: Kubo crea il secret del webhook. 2. Scrivi l'indirizzo pubblico di Kubo (con https). 3. Su Typeform apri il modulo → Connect → Webhooks → Add a webhook e incolla l'indirizzo dato da «Indirizzo da dare a Typeform». 4. Premi Edit sul webhook, incolla il secret in «Secret» e salva; poi accendi il webhook. 5. Per riconoscere il cliente usa le domande «Email» e «Phone number» (e una domanda «Nome»); per un appuntamento una domanda «Date» e una «Ora» (es. 15:30). 6. Premi «Send test request» o compila il modulo: il cliente compare in Kubo. 7. Senza indirizzo pubblico: incolla un token personale e gli id dei moduli; il giro passa ogni 15 minuti (o chiedi a Lumi di controllare).
- **Sito e fonti:** [sito](https://www.typeform.com) · [fonte 1](https://www.typeform.com/developers/webhooks/secure-your-webhooks/) · [fonte 2](https://www.typeform.com/developers/webhooks/example-payload/) · [fonte 3](https://www.typeform.com/developers/responses/reference/retrieve-responses/) · [fonte 4](https://www.typeform.com/developers/get-started/personal-access-token/) · [fonte 5](https://www.typeform.com/pricing/)

<a id="zoho-crm"></a>
### Zoho CRM · `zoho-crm`

Clienti di Kubo e contatti di Zoho CRM allineati nei due sensi; le aziende con P.IVA come Account.

- **Costo:** Gratis (Edizione Free gratuita fino a 3 utenti (con l'API); Standard da 14 € per utente al mese, Professional da 23 € (fatturazione annuale). Le chiamate API al giorno dipendono dall'edizione e dalle licenze.)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Un client «Server-based Applications» con Client ID e Client secret](https://api-console.zoho.eu) (Zoho API Console (api-console.zoho.eu per l'UE) → Add Client → Server-based Applications; come Authorized Redirect URI metti \<indirizzo di Kubo\>/api/connettori/zoho-crm/oauth/ritorno); [Il data center del tuo account](https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html) (È il dominio con cui entri in Zoho: crm.zoho.eu → Europa, crm.zoho.com → Stati Uniti, crm.zoho.in → India…)
- **Passi:** 1. Guarda il dominio con cui entri in Zoho CRM (zoho.eu, zoho.com, zoho.in…) e scegli qui lo stesso data center. 2. Apri la Zoho API Console del tuo data center e aggiungi un client «Server-based Applications». 3. Come Authorized Redirect URI incolla \<indirizzo di Kubo\>/api/connettori/zoho-crm/oauth/ritorno. 4. Copia Client ID e Client secret, incollali qui e premi «Collega»: accetta l'accesso a contatti e aziende. 5. Premi «Manda tutti i clienti a Zoho CRM»: i clienti con email diventano contatti, quelli con P.IVA anche aziende. 6. Da lì ogni cliente cambiato in Kubo va subito a Zoho, e ogni 15 minuti i contatti cambiati in Zoho arrivano in Kubo.
- **Sito e fonti:** [sito](https://www.zoho.com/it/crm/) · [fonte 1](https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html) · [fonte 2](https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html) · [fonte 3](https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html) · [fonte 4](https://www.zoho.com/crm/developer/docs/api/v8/get-records.html) · [fonte 5](https://www.zoho.com/crm/developer/docs/api/v8/scopes.html) · [fonte 6](https://www.zoho.com/it/crm/zohocrm-pricing.html)

## Recensioni (2)

<a id="google-business"></a>
### Recensioni Google · `google-business`

Le recensioni nuove della scheda Google come avviso, e le risposte scritte da Kubo (anche con Lumi).

- **Costo:** Gratis (Il Profilo dell'attività su Google e le sue API sono gratuiti; l'accesso alle API però va chiesto a Google e approvato (quota 300 richieste al minuto dopo l'approvazione).)
- **Difficoltà:** Per smanettoni · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [L'approvazione di Google all'uso delle Business Profile API (modulo «GBP API contact form» → «Application for Basic API Access», con il numero del progetto Google Cloud)](https://developers.google.com/my-business/content/prereqs) (Business Profile APIs → Prerequisiti → modulo di richiesta di accesso; risponde Google per email, anche dopo settimane); [Le API abilitate nel progetto: Google My Business API, My Business Account Management API, My Business Business Information API](https://console.cloud.google.com/apis/library) (Google Cloud Console → API e servizi → Libreria); [Client ID e client secret OAuth (tipo «Applicazione web»)](https://console.cloud.google.com/apis/credentials) (Google Cloud Console → API e servizi → Credenziali → Crea credenziali → ID client OAuth); [L'id dell'account e della sede](https://developers.google.com/my-business/content/basic-setup) (Con l'API: accounts.list (My Business Account Management) e accounts.locations.list (Business Information); oppure in Business Profile Manager → la sede → Impostazioni avanzate → ID della sede)
- **Passi:** 1. Requisiti di Google: una scheda verificata attiva da più di 60 giorni e un sito web indicato nella scheda. 2. Crea un progetto su Google Cloud Console e annota il «Numero di progetto». 3. Compila il modulo di richiesta di accesso alle Business Profile API (Application for Basic API Access) con un'email proprietaria o amministratrice della scheda; l'attesa può essere di settimane. 4. Finché la quota delle Business Profile API in Cloud Console è 0 richieste al minuto non sei approvato; con 300 sì: allora abilita le tre API e crea l'ID client OAuth «Applicazione web» con l'indirizzo di ritorno mostrato qui. 5. Incolla client ID e secret, premi «Collega» e accedi con l'account che gestisce la scheda. 6. Scrivi l'id dell'account e della sede, poi «Prova la connessione»: da lì ogni ora le recensioni nuove arrivano come avviso, e puoi rispondere da Kubo o chiedere a Lumi una bozza.
- **Sito e fonti:** [sito](https://www.google.com/business/) · [fonte 1](https://developers.google.com/my-business/content/review-data) · [fonte 2](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews) · [fonte 3](https://developers.google.com/my-business/content/prereqs) · [fonte 4](https://developers.google.com/my-business/content/basic-setup) · [fonte 5](https://developers.google.com/identity/protocols/oauth2/web-server)

<a id="trustpilot"></a>
### Trustpilot · `trustpilot`

Recensioni Trustpilot come avviso, risposte da Kubo e inviti a recensire mandati ai clienti.

- **Costo:** In abbonamento (Il piano Free permette di raccogliere e rispondere alle recensioni dal sito, ma le chiavi API (lettura, risposte, inviti) sono incluse solo nei piani a pagamento superiori; prezzi su business.trustpilot.com/plans, a partire da alcune centinaia di euro al mese.)
- **Difficoltà:** Media · **Dove:** Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [API key e API secret dell'applicazione](https://businessapp.b2b.trustpilot.com/applications) (Trustpilot Business → Integrations → Developers → API → Create application); [Il dominio dell'azienda come compare su Trustpilot](https://www.trustpilot.com) (È l'indirizzo della pagina pubblica: trustpilot.com/review/\<dominio\>); [L'id dell'utente business (per inviti e risposte con le credenziali dell'applicazione)](https://developers.trustpilot.com/authentication) (Trustpilot Business → Settings → Users: l'utente che firma le risposte; oppure chiedilo al supporto API)
- **Passi:** 1. Verifica che il tuo piano Trustpilot includa l'accesso alle API (altrimenti la sezione Developers non c'è). 2. In Trustpilot Business → Integrations → Developers crea un'applicazione e copia API key e secret. 3. Incolla key, secret e il dominio dell'azienda; premi «Prova la connessione»: Kubo trova la tua pagina. 4. Per risposte e inviti scrivi l'id dell'utente business, il nome del mittente e l'email per le risposte. 5. Da lì ogni ora le recensioni nuove arrivano come avviso; dalla scheda del cliente puoi «Chiedere una recensione», anche tramite Lumi.
- **Sito e fonti:** [sito](https://business.trustpilot.com) · [fonte 1](https://developers.trustpilot.com/authentication) · [fonte 2](https://developers.trustpilot.com/service-reviews-api) · [fonte 3](https://developers.trustpilot.com/invitation-api) · [fonte 4](https://developers.trustpilot.com/business-units-api) · [fonte 5](https://business.trustpilot.com/plans)

## Firma (2)

<a id="docusign"></a>
### DocuSign · `docusign`

Manda i preventivi in firma con DocuSign: quando il cliente firma, il preventivo diventa «accettato».

- **Costo:** In abbonamento (L'invio di buste via API richiede un piano DocuSign con API (piani API da circa 50 $ al mese fatturati annualmente; i piani eSignature Standard e Business Pro partono da circa 25–40 € a utente al mese). L'account sviluppatore per le prove è gratuito.)
- **Difficoltà:** Per smanettoni · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Integration key e una coppia di chiavi RSA dell'app](https://admindemo.docusign.com/apps-and-keys) (DocuSign Admin › Integrations › Apps and Keys › Add App and Integration Key › Generate RSA; aggiungi il Redirect URI https://www.docusign.com); [User ID (API Username) e, se ne hai più d'uno, l'Account ID](https://admindemo.docusign.com/apps-and-keys) (La stessa pagina Apps and Keys, riquadro «My Account Information»); [Chiave HMAC di Connect (facoltativa, per sapere subito quando firmano)](https://admindemo.docusign.com/connect) (Admin › Integrations › Connect › Add Configuration (JSON, eventi Envelope Completed/Declined/Voided) › Include HMAC Signature)
- **Passi:** 1. Crea un account sviluppatore DocuSign (gratuito) e un'app in Apps and Keys. 2. Genera la coppia di chiavi RSA e copia la chiave privata, l'integration key e lo User ID in Kubo. 3. Premi «Dai il consenso», apri l'indirizzo e accetta (una volta sola). 4. Premi «Prova la connessione»: Kubo trova il conto e il suo indirizzo. 5. Per gli avvisi immediati crea una configurazione Connect verso l'indirizzo che mostra Kubo, con la firma HMAC, e incolla la chiave. 6. Dal preventivo usa «Manda in firma (DocuSign)»; per i documenti veri passa all'ambiente di produzione dopo il «Go-Live».
- **Sito e fonti:** [sito](https://www.docusign.com/it-it) · [fonte 1](https://developers.docusign.com/platform/auth/jwt/jwt-get-token/) · [fonte 2](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/) · [fonte 3](https://developers.docusign.com/platform/webhooks/connect/hmac/) · [fonte 4](https://developers.docusign.com/platform/auth/reference/user-info/)

<a id="yousign"></a>
### Yousign · `yousign`

Manda i preventivi in firma elettronica: quando il cliente firma, il preventivo diventa «accettato».

- **Costo:** In abbonamento (L'API è nei piani con accesso API (Pro/Scale, da circa 75 € al mese per 50 richieste di firma; prezzi su richiesta oltre). La sandbox è gratuita: controlla il listino aggiornato sul sito di Yousign)
- **Difficoltà:** Media · **Dove:** Italia, Europa, Mondo
- **Provato:** con un servizio finto
- **Ti serve:** [Chiave API (sandbox o produzione)](https://app.yousign.com) (App Yousign → Developers → API keys); [Segreto del webhook](https://developers.yousign.com/docs/use-webhooks-in-your-app) (App Yousign → Developers → Webhooks → il webhook creato → Secret key)
- **Passi:** 1. Crea un account Yousign con accesso API e apri la sezione Developers 2. Crea una chiave API, prima per la sandbox 3. Incolla la chiave qui e lascia l'ambiente su «prova» 4. Accendi il connettore e copia l'indirizzo del webhook che Kubo mostra 5. In Yousign crea un webhook verso quell'indirizzo con gli eventi signature\_request.done, declined ed expired 6. Copia il segreto del webhook e incollalo qui 7. Prova «Manda in firma» su un preventivo; quando va, passa a «produzione» con la chiave di produzione
- **Sito e fonti:** [sito](https://yousign.com/it-it) · [fonte 1](https://developers.yousign.com/reference) · [fonte 2](https://developers.yousign.com/docs/security) · [fonte 3](https://developers.yousign.com/docs/use-webhooks-in-your-app)

## Dati delle aziende (2)

<a id="openapi-imprese"></a>
### Openapi imprese · `openapi-imprese`

Dalla partita IVA: ragione sociale, sede, PEC e codice destinatario dal Registro imprese, per compilare clienti e fornitori.

- **Costo:** A consumo (A consumo: si paga a richiesta, con prezzi diversi per IT-start, IT-advanced, IT-pec e IT-sdicode (pochi centesimi l'una; listino aggiornato su console.openapi.com). L'ambiente di prova è gratuito.)
- **Difficoltà:** Facile · **Dove:** Italia
- **Provato:** con un servizio finto
- **Ti serve:** [Token Bearer con lo scope «IT-advanced» (company.openapi.com)](https://console.openapi.com/) (console.openapi.com › Token › Crea token: scegli la scadenza e lo scope GET company.openapi.com/IT-advanced)
- **Passi:** 1. Registrati su console.openapi.com e ricarica il credito (per le prove usa la sandbox). 2. Crea un token con lo scope IT-advanced di company.openapi.com. 3. Incolla il token in Kubo e scegli l'ambiente. 4. Premi «Prova la connessione» e accendi. 5. Nella scheda di un cliente o di un fornitore usa «Compila dalla partita IVA»: Kubo aggiunge PEC, codice destinatario e sede nei campi vuoti.
- **Sito e fonti:** [sito](https://openapi.com/products/company) · [fonte 1](https://console.openapi.com/apis/company/documentation) · [fonte 2](https://console.openapi.com/oas/en/company.openapi.json)

<a id="vies"></a>
### VIES (partite IVA UE) · `vies`

Controlla le partite IVA europee e compila clienti e fornitori con ragione sociale e indirizzo. Gratis, senza chiave.

- **Costo:** Gratis (Gratis: è il servizio pubblico della Commissione europea. Non serve nessuna chiave.)
- **Difficoltà:** Facile · **Dove:** Italia, Europa
- **Provato:** con un servizio finto
- **Ti serve:** [Niente: il servizio è pubblico](https://ec.europa.eu/taxation_customs/vies/) (—)
- **Passi:** 1. Accendi il connettore: non chiede chiavi. 2. Nella scheda di un cliente o di un fornitore con la partita IVA usa «Compila dalla partita IVA». 3. Kubo mostra cosa aggiungerà (solo i campi vuoti) e aspetta la conferma. 4. Chiedi a Lumi «controlla la partita IVA 01234567890» per una verifica al volo.
- **Sito e fonti:** [sito](https://ec.europa.eu/taxation_customs/vies/) · [fonte 1](https://ec.europa.eu/taxation_customs/vies/#/technical-information) · [fonte 2](https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/00000000000)

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
