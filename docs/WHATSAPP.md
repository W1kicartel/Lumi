# WhatsApp in Kubo

Con WhatsApp acceso, Kubo riceve i messaggi dei clienti e li mette in una posta unica, divisa per cliente. Da lì rispondi tu, oppure lo fa Lumi su tua richiesta («scrivi a Rossi che l'ordine è pronto»). Kubo manda anche i messaggi automatici che scegli: promemoria, conferme, fatture, solleciti, auguri.

Kubo usa **solo la WhatsApp Business Platform ufficiale di Meta**: niente trucchi con WhatsApp Web (più sotto spieghiamo perché). Per collegarla scegli **uno** di tre servizi, e ne tieni acceso uno alla volta. La pagina WhatsApp dice sempre quale è attivo.

## Quale servizio scegliere

| | **Meta diretta** (Cloud API) | **Twilio** | **360dialog** |
|---|---|---|---|
| Per chi | chi vuole spendere il minimo e non teme qualche passaggio in più | chi vuole l'iscrizione più guidata | chi preferisce un partner europeo con canone fisso |
| Canone | nessuno | nessuno | circa **49 €/mese** per numero (Regular) o **99 €** (Premium) |
| Costo a messaggio | le tariffe di Meta, senza ricarichi | le tariffe di Meta **+ 0,005 $** per ogni messaggio inviato o ricevuto | le tariffe di Meta, senza ricarichi |
| Difficoltà dell'iscrizione | difficile (Business Manager, app, utente di sistema) | facile (procedura guidata nella console) | media (procedura guidata di 360dialog) |
| Cosa incolli in Kubo | ID del numero, ID dell'account WhatsApp (WABA), token permanente, chiave segreta dell'app | Account SID, Auth Token, numero del mittente, indirizzo pubblico di Kubo | chiave API, indirizzo pubblico di Kubo |
| Webhook (messaggi in arrivo) | lo incolli su Meta, con il token di verifica che genera Kubo | lo incolli su Twilio | Kubo lo registra da solo |
| Modelli creati da Kubo | sì | sì (Content API, poi Twilio chiede l'approvazione a Meta) | sì |

**Il nostro consiglio:** se hai già una pagina Facebook aziendale, scegli **Meta diretta**: costa meno. Se ti blocchi alla parte di Meta, scegli **Twilio**. Se vuoi un fornitore nell'Unione europea e un'assistenza dedicata, scegli **360dialog**.

Per tutti e tre serve un **numero di telefono che non sia già registrato nell'app WhatsApp** (o WhatsApp Business) del telefono. Puoi usare un fisso, oppure un numero nuovo. Se vuoi spostare il numero che usi già, va prima cancellato dall'app.

Per ricevere i messaggi, Kubo deve essere **raggiungibile da internet in https**: per esempio su un server, o con un tunnel se Kubo gira sul computer del negozio. Senza, puoi solo mandare.

## Meta diretta, passo per passo

1. **Portafoglio business.** Vai su [business.facebook.com](https://business.facebook.com/), entra con il tuo profilo Facebook e crea il portafoglio dell'azienda, se non c'è. In *Impostazioni → Centro sicurezza* avvia la **verifica dell'azienda** (servono visura o partita IVA). Senza verifica puoi mandare poco.
2. **App.** Su [developers.facebook.com](https://developers.facebook.com/apps) → *Le mie app* → **Crea app** → tipo **Business** → collegala al portafoglio. Nella pagina dell'app aggiungi il prodotto **WhatsApp** (*Configura*).
3. **Numero.** In *WhatsApp → Configurazione API* (API Setup) premi **Aggiungi numero di telefono**. Scrivi il nome visualizzato (quello che vedranno i clienti) e verifica il numero con il codice via SMS o chiamata. Nella stessa pagina copia due numeri lunghi:
   - **ID del numero di telefono** (Phone number ID);
   - **ID dell'account WhatsApp Business** (WhatsApp Business Account ID, «WABA»).
4. **Utente di sistema e token permanente.** Il token che Meta mostra nella pagina dell'app scade dopo 24 ore: per Kubo ne serve uno che non scade.
   1. Vai su *business.facebook.com → Impostazioni → Utenti → **Utenti di sistema*** → **Aggiungi**: un nome (per esempio «Kubo») e il ruolo **Amministratore**.
   2. **Assegna risorse**: l'app (controllo completo) e l'account WhatsApp (controllo completo).
   3. **Genera nuovo token**: scegli l'app, scadenza **Mai**, e spunta le autorizzazioni **`whatsapp_business_messaging`** e **`whatsapp_business_management`**. Copia il token subito: Meta non lo mostra più.
5. **Chiave segreta dell'app.** In *developers.facebook.com → la tua app → Impostazioni dell'app → **Di base*** premi *Mostra* accanto a **Chiave segreta** (App secret). Kubo la usa per controllare che i messaggi in arrivo vengano davvero da Meta (firma `X-Hub-Signature-256`).
6. **In Kubo.** Apri *Connettori → WhatsApp (Meta Cloud API)* e incolla l'ID del numero, l'ID dell'account, il token e la chiave segreta, poi premi **Accendi**. Kubo genera il **token di verifica** e iscrive l'app agli eventi dell'account WhatsApp.
7. **Webhook.** Nella pagina **WhatsApp → Impostazioni** di Kubo copia l'**indirizzo del webhook**, che finisce con `/api/connettori/whatsapp/in`. Il **token di verifica** è nella pagina del connettore. Su developers.facebook.com, in *WhatsApp → Configurazione → Webhook → Modifica*, incolla l'indirizzo e il token, poi premi **Verifica e salva**. Kubo risponde alla verifica da solo. In *Campi del webhook* iscriviti a **messages** e **message_template_status_update**.
8. **Pagamento e pubblicazione.** In WhatsApp Manager aggiungi un **metodo di pagamento**. Poi metti l'app in modalità **Live** (pubblicata): in modalità sviluppo i webhook dei clienti veri non arrivano.
9. Premi **Prova la connessione**: Kubo mostra il nome verificato, il numero e la qualità.

## Twilio, passo per passo

1. Crea l'account su [twilio.com](https://www.twilio.com/try-twilio) e aggiungi del credito.
2. Dalla prima pagina della [console](https://console.twilio.com/) copia **Account SID** (inizia con `AC`) e **Auth Token**.
3. In *Messaging → Senders → **WhatsApp senders*** premi *Create new sender* e segui la procedura guidata. Accedi con Facebook, scegli o crea il portafoglio Meta e verifica il numero.
4. Nel mittente imposta **Webhook URL for incoming messages** con l'indirizzo che Kubo mostra in *WhatsApp → Impostazioni* (finisce con `/api/connettori/twilio-whatsapp/in`), metodo **POST**.
5. In Kubo apri *Connettori → WhatsApp (Twilio)* e incolla SID, Auth Token, il numero del mittente (`+39…`) e l'**indirizzo pubblico di Kubo** (per esempio `https://kubo.miabottega.it`). L'indirizzo deve essere identico a quello che usa Twilio, perché la firma `X-Twilio-Signature` lo comprende. Kubo lo usa anche per gli stati dei messaggi e per i PDF, che Twilio scarica da un link temporaneo.
6. Premi **Accendi**, poi **Sincronizza i modelli** nella pagina WhatsApp.

## 360dialog, passo per passo

1. Iscriviti su [hub.360dialog.com](https://hub.360dialog.com/) e scegli il piano.
2. Collega il numero con la procedura guidata (*Embedded Signup*): accedi con Facebook e scegli il portafoglio Meta.
3. In *Numbers* premi **Generate API key** e copia la chiave.
4. In Kubo apri *Connettori → WhatsApp (360dialog)*, incolla la chiave e l'**indirizzo pubblico di Kubo**, poi premi **Accendi**. Kubo registra da solo il webhook su 360dialog, con un codice segreto in fondo all'indirizzo: i webhook di 360dialog non sono firmati, e il codice serve proprio a questo.

## I modelli e l'approvazione

Un **modello** (template) è un messaggio scritto prima e approvato da Meta. Serve ogni volta che sei tu a scrivere per primo, o quando la finestra di 24 ore è chiusa. Ogni modello ha:

- un **nome**, solo minuscole, numeri e `_` (per esempio `promemoria_appuntamento`);
- una **lingua**;
- una **categoria**, che decide il prezzo:
  - **utility**: avvisi legati a qualcosa che il cliente ha chiesto, come un appuntamento, un ordine o una fattura;
  - **marketing**: offerte, auguri, «ci manchi»;
  - **authentication**: codici di accesso.
- delle **variabili** `{{1}}`, `{{2}}`…, che Kubo riempie con i campi: in *WhatsApp → Modelli* scegli, per esempio, `{{1}}` = `cliente.nome` e `{{2}}` = `riga.quando`.

Nella pagina dei modelli premi **Sincronizza** per scaricare quelli che hai già, oppure crea un modello da Kubo con **Manda in approvazione**. Meta di solito risponde in pochi minuti, a volte in 24 ore, e Kubo aggiorna lo stato da solo: *in attesa*, *approvato*, *rifiutato* con il motivo, *in pausa*. Meta può anche **cambiare la categoria** di un modello (per esempio da utility a marketing). Il costo segue la categoria di Meta, e la pagina la mostra.

I modelli che portano un **PDF nell'intestazione** (per mandare fatture e preventivi fuori dalla finestra) si creano in *WhatsApp Manager* con un PDF d'esempio, poi si sincronizzano. Con Twilio il PDF parte come messaggio a parte, quindi solo dentro la finestra.

## La regola delle 24 ore

Quando un cliente ti scrive, si apre una **finestra di 24 ore**: dentro rispondi con testo libero, foto e documenti, e queste risposte sono gratis. Ogni suo nuovo messaggio riapre la finestra. Quando la finestra è chiusa, puoi scrivergli solo con un modello approvato.

Kubo lo mostra in ogni conversazione: «Finestra aperta fino alle 15:42» oppure «Finestra chiusa: serve un modello». Il bottone **Invia** propone da solo la strada giusta.

## Consenso (opt-in), STOP e privacy

**Cosa chiede Meta** ([WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)): puoi scrivere per primo solo a chi ti ha dato il numero **e** ha accettato di ricevere messaggi **su WhatsApp** dalla **tua azienda**, nominata nel consenso. Devi rispettare ogni richiesta di non essere più contattato, anche se arriva fuori da WhatsApp. Se troppi clienti bloccano o segnalano i tuoi messaggi, Meta abbassa la qualità del numero e i limiti di invio, e alla fine può bloccarlo.

**Cosa chiede la legge** (GDPR e Codice privacy, art. 130 per le comunicazioni promozionali):

- per i **messaggi promozionali** serve un consenso **libero, specifico e dimostrabile**, separato da quello per i messaggi di servizio;
- l'**informativa** deve dire che usi WhatsApp, cioè Meta, che tratta i dati come responsabile, e come smettere;
- devi poter **dimostrare** quando, come e con quali parole il cliente ha detto sì.

**Cosa fa Kubo:**

- **Registro dei consensi** per numero, con due categorie: *servizio* (promemoria, avvisi, fatture) e *promozioni*. Per ogni scelta salva la data, la fonte (modulo in negozio, sito, a voce…), le **parole esatte** mostrate al cliente e chi l'ha registrata. Lo storico non si cancella: una revoca è una riga nuova.
- **Nessun modello parte senza il consenso** della sua categoria. Il testo libero parte solo dentro la finestra, cioè dopo che il cliente ti ha scritto.
- **STOP ovunque.** Se il cliente scrive STOP, BASTA, ANNULLA, CANCELLAMI, DISISCRIVIMI o UNSUBSCRIBE, Kubo segna il no per tutte e due le categorie e da quel momento non parte più niente: né a mano, né con le automazioni, né con Lumi. Se il cliente scrive START o RIPRENDI, torna attivo il consenso di servizio. Quello promozionale va chiesto di nuovo. Dopo uno STOP un «sì» registrato a mano non basta: lo toglie solo il cliente.
- **Chi vede le chat.** La posta in arrivo segue i permessi della sezione clienti: chi vede solo i clienti creati da lui («solo i propri») vede e scrive solo le loro conversazioni.
- Quando un messaggio non parte, **Kubo dice perché**: nella risposta, nella scheda di Lumi e nel registro «Messaggi fermati o falliti».
- **Ore di silenzio** (predefinite 21:00–9:00): niente messaggi promozionali. Quelli automatici aspettano la fine del silenzio. Se vuoi, il silenzio vale anche per i messaggi automatici di servizio.
- **Limiti:**
  - modelli al giorno in tutto (250 all'inizio, come il primo livello di Meta);
  - modelli al giorno per cliente (3);
  - un messaggio promozionale ogni N giorni per cliente (7).

Un modulo di consenso d'esempio, da adattare con il tuo avvocato o consulente privacy:

> ☐ Acconsento a ricevere da *Bottega Esempio* su WhatsApp promemoria degli appuntamenti e avvisi sui miei ordini.
> ☐ Acconsento a ricevere da *Bottega Esempio* su WhatsApp offerte e novità (al massimo una a settimana).
> Posso smettere in qualsiasi momento scrivendo STOP. Informativa: …

## Le automazioni WhatsApp

In *WhatsApp → Automazioni WhatsApp* le accendi con un clic. Per ognuna scegli il modello e i tempi, e premi **Anteprima** per vedere il messaggio con i dati veri e il costo stimato.

| Automazione | Quando parte | Categoria |
|---|---|---|
| Promemoria appuntamento | 24 e 2 ore prima, o come vuoi (ogni minuto Kubo guarda l'agenda) | utility |
| Conferma prenotazione | appena nasce la prenotazione | utility |
| Ordine pronto o spedito | quando lo stato diventa pronto o spedito, con la spedizione se c'è | utility |
| Fattura o preventivo con PDF | fattura emessa o preventivo inviato | utility |
| Sollecito di pagamento | ogni mattina, per le fatture scadute da N giorni (una volta) | utility |
| Richiesta di recensione | N giorni dopo la vendita, con il tuo link | marketing |
| Auguri di compleanno | la mattina del compleanno | marketing |
| Cliente da riattivare | a chi non torna da N mesi, una volta | marketing |
| Risposta fuori orario | quando ti scrivono a negozio chiuso (testo libero, una volta ogni 12 ore) | servizio |

Le automazioni legate a un evento (conferma, ordine pronto, fattura) girano sul **motore delle automazioni** di Kubo con l'azione «WhatsApp». La stessa azione si usa nelle automazioni scritte a mano:

```json
{ "tipo": "whatsapp", "modello": "ordine_pronto", "lingua": "it", "variabili": { "1": "nome" } }
```

Ogni invio automatico va in **coda**, con i nuovi tentativi in caso di errore. Al momento dell'invio Kubo ricontrolla consenso, STOP, silenzio e limiti. Ogni messaggio parte una volta sola.

## Lumi

- «**Scrivi a Rossi che l'ordine è pronto**». Lumi trova il cliente, controlla consenso e finestra, e prepara la scheda con Conferma e Annulla:
  - con la finestra aperta mette il testo libero;
  - con la finestra chiusa sceglie il modello approvato più adatto e ne riempie le variabili;
  - senza consenso, o dopo uno STOP, si ferma e dice perché.
- «**Cosa mi ha scritto la Bianchi?**», «**chi aspetta una risposta?**»: Lumi riassume la conversazione o elenca i messaggi non letti.

## Costi

Dal 1° luglio 2025 Meta fa pagare **ogni modello consegnato**. Il prezzo dipende dalla categoria e dal paese del cliente:

- le risposte dentro la finestra sono **gratis**;
- i modelli **utility** dentro la finestra sono **gratis**;
- marketing e authentication si pagano sempre.

| Italia (EUR, stima) | € a messaggio |
|---|---|
| Marketing | 0,0658 |
| Utility (fuori dalla finestra) | 0,0248 |
| Authentication | 0,0248 |
| Servizio (risposte nella finestra) | 0 |

Queste cifre vengono da un listino EUR di ottobre 2026 riportato da terzi. La pagina di Meta non scrive gli importi: rimanda ai listini scaricabili. Meta ha **alzato la tariffa marketing per l'Italia dal 1° luglio 2026**. Alcuni rivenditori scrivono che dal 1° ottobre 2026 le risposte di servizio sono gratis solo fino a 1.000 al mese per numero, e che gli utility nella finestra si pagano. La documentazione di Meta che abbiamo letto il 9 ottobre 2026 dice ancora il contrario. In *WhatsApp → Impostazioni → Tariffe* puoi correggere gli importi e impostare la quota gratuita: la stima e il contatore del mese si aggiornano. Fa fede la fattura di Meta o del tuo fornitore.

## Perché Kubo non usa WhatsApp Web «automatizzato»

Ci sono librerie che pilotano WhatsApp Web come se fossi tu al telefono (whatsapp-web.js, Baileys, venom e simili). Costano zero, ma Kubo non le usa e non le userà:

- **violano i Termini di servizio di WhatsApp**, che vietano l'accesso automatico o non autorizzato al servizio;
- **WhatsApp blocca i numeri** che le usano, anche per sempre, e il numero del negozio è difficile da recuperare;
- **non hanno modelli, consensi né STOP gestiti**: è facile scrivere a chi non vuole, che è proprio ciò che il GDPR e Meta vietano;
- la sessione del tuo telefono resterebbe su un server, con l'accesso a tutte le tue chat, anche quelle private;
- smettono di funzionare a ogni aggiornamento di WhatsApp.

La piattaforma ufficiale costa qualche centesimo a messaggio, ma è stabile, legale e tua.

## Per chi sviluppa

| File | |
|---|---|
| `connettori/whatsapp/connettore.js`, `cloud.js` | Meta Cloud API: invii, upload dei PDF, modelli (`message_templates`), webhook (`X-Hub-Signature-256` con la chiave dell'app) |
| `connettori/twilio-whatsapp/connettore.js` | Twilio: Messages API, Content API e approvazioni, `X-Twilio-Signature` (HMAC-SHA1 di URL + parametri ordinati) |
| `connettori/dialog360/connettore.js` | 360dialog (id `dialog360`: gli id dei connettori iniziano con una lettera): Cloud API su `waba-v2.360dialog.io`, `D360-API-KEY`, webhook con codice segreto |
| `server/moduli/whatsapp.js` | posta, consensi, regole, modelli, ricette, costi, strumenti di Lumi `whatsapp_scrivi` e `whatsapp_leggi`; la verifica GET di Meta su `/api/connettori/whatsapp/in` |
| `server/moduli/whatsapp-regole.js` | regole pure: E.164, finestra, silenzio, STOP, variabili, costi, scelta del modello |
| `server/moduli/whatsapp-bus.js`, `whatsapp-lingue.js` | il filo connettori → modulo; i messaggi nelle sei lingue |
| `server/automazioni.js` | l'azione `{ tipo: 'whatsapp' }` (aggiunta, compatibile con le automazioni di prima) |
| `web/moduli/whatsapp.js`, `.css`, `web/lingue/*/whatsapp.js` | l'interfaccia e i testi |
| `test/whatsapp.test.mjs` | finti Meta, Twilio e 360dialog: firme, finestra, consensi, STOP, silenzio, limiti, modelli, Lumi, automazioni |

Ogni servizio offre in `man.whatsapp` la stessa interfaccia: `testo(k, numero, testo)`, `modello(k, numero, { nome, lingua, valori, idRemoto, documento })`, `documento(k, numero, { nome, tipo, dati, link })`, `modelli(k)`, `creaModello(k, def)`, `webhook(k)`. Gli eventi in arrivo diventano `{ tipo: 'messaggio' | 'stato' | 'modello', … }` e vanno al modulo con `whatsapp-bus.js`.

## Fonti

- Meta, [Cloud API: messaggi](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages), [media](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media), [webhook e payload](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples), [verifica GET e firma](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), [modelli](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates), [utente di sistema e token](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started), [prezzi](https://developers.facebook.com/docs/whatsapp/pricing), [listini per valuta](https://whatsappbusiness.com/products/platform-pricing/), [Business Messaging Policy](https://business.whatsapp.com/policy), [Termini di servizio di WhatsApp](https://www.whatsapp.com/legal/terms-of-service-eea).
- Twilio, [WhatsApp API](https://www.twilio.com/docs/whatsapp/api), [sicurezza dei webhook](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [Content API](https://www.twilio.com/docs/content/content-api-resources), [approvazioni](https://www.twilio.com/docs/content/content-api-approvals), [prezzi](https://www.twilio.com/en-us/whatsapp/pricing).
- 360dialog, [webhook](https://docs.360dialog.com/docs/waba-messaging/webhook), [API dei webhook](https://docs.360dialog.com/docs/messaging-api/api-reference/webhooks), [prezzi e piani](https://docs.360dialog.com/docs/360dialog/prices-plans-and-payment-options).
- Garante privacy, [marketing e comunicazioni promozionali](https://www.garanteprivacy.it/temi/marketing); Regolamento (UE) 2016/679, articoli 6, 7 e 13; Codice privacy (D.lgs. 196/2003), articolo 130.
