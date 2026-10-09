# I connettori di Kubo

Un connettore collega Kubo a un servizio: pagamenti, negozio online, fatturazione elettronica, posta, calendario,
piattaforme di automazione. È **una cartella con un file**: `connettori/<id>/connettore.js`. Il connettore dichiara cosa gli
serve, e il nucleo (`server/moduli/connettori.js`) fa il resto:

- custodisce i segreti, cifrati;
- genera la pagina delle impostazioni;
- riceve i webhook, ne verifica la firma e risponde alle verifiche dei servizi;
- chiama il servizio senza aprire la rete interna;
- mette in coda e riprova;
- fa girare i giri pianificati;
- abbina i campi;
- gestisce OAuth;
- tiene il registro;
- dà gli strumenti a Lumi;
- mostra il connettore nella **Libreria delle integrazioni**, con la guida per accenderlo.

Gli ufficiali, con la guida e il costo di ognuno, sono in [CATALOGO.md](CATALOGO.md): lo scrive `npm run catalogo` dai
manifesti, e `npm run catalogo -- --controlla` fallisce se un blocco «catalogo» non va o se CATALOGO.md è rimasto
indietro rispetto ai manifesti. Per chi smanetta ci sono tre attrezzi
che non chiedono di scrivere codice:

- il connettore **HTTP / API REST**, per un servizio qualunque;
- i **ponti** verso Zapier, Make, n8n, Pipedream e i webhook generici;
- la descrizione **OpenAPI 3.1** delle API di Kubo.

## La Libreria delle integrazioni

`#/connettori` è la libreria. Ha:

- la ricerca, su nome, descrizione e parole chiave, anche senza accenti;
- le categorie, ognuna con il numero di voci;
- i filtri rapidi «Gratis», «Facili» e «Italia»;
- una carta per connettore, con:
  - il monogramma: le iniziali su una tessera colorata (niente loghi dei marchi);
  - la categoria;
  - lo stato: acceso, spento, da configurare, cambiato;
  - l'etichetta «provato con un servizio finto».

Tutto arriva con una sola richiesta, `GET /api/connettori/catalogo`. I filtri girano nel browser (`web/libreria.js`, lo
stesso codice del server) mostrando e nascondendo carte già fatte: resta istantanea anche con centinaia di connettori.

La pagina di un connettore mostra, nell'ordine:

1. cosa fa;
2. **cosa ti serve**: le credenziali e dove trovarle, con i link;
3. la guida **passo per passo**;
4. costo, difficoltà e zone;
5. **cosa potrà toccare**: i permessi dell'identità di servizio;
6. le fonti;
7. le impostazioni, l'accensione, il registro.

`GET /api/connettori/catalogo?q=&categoria=&costo=&difficolta=&zona=` → `{ voci, categorie, totale }`.
- `voci`: le carte, ordinate per nome.
- `categorie`: i conti per categoria. Seguono gli altri filtri ma non la categoria scelta, così ogni bottone dice quante
  voci troveresti scegliendolo. `tutte` è il totale.
- Chi può: il titolare, anche con un token personale (sola lettura).

### Il blocco `catalogo`

Ogni connettore ufficiale ha un blocco `catalogo`. Senza, `test/catalogo.test.mjs` fallisce e dice quale connettore è e
cosa manca. `npm run catalogo -- --controlla` fa lo stesso controllo senza scrivere niente (per la CI).

```js
catalogo: {
  categoria: 'pagamenti',        // una di: pagamenti cassa negozi-online marketplace fatturazione contabilita banche spedizioni
                                 // whatsapp messaggi email sms calendario prenotazioni archivio produttivita marketing
                                 // recensioni firma dati-aziende automazione ia
  sito: 'https://stripe.com/it', // la pagina del servizio, in https
  costo: 'a-consumo',            // gratis | a-consumo | abbonamento | contratto
  costoNota: '1,5% + 0,25 € per le carte europee standard, senza canone',
  serve: [{ cosa: 'Chiave segreta (sk_live_…)', dove: 'Dashboard → Sviluppatori → Chiavi API', link: 'https://dashboard.stripe.com/apikeys' }],
  passi: ['Apri …', 'Crea …', 'Incolla qui …'],   // da 3 a 8 frasi brevi, in italiano
  difficolta: 'media',           // facile | media | difficile
  zone: ['IT', 'UE', 'mondo'],   // 'IT' se va bene per un'azienda italiana: è il filtro «Italia»
  fonti: ['https://docs.stripe.com/keys'],   // la documentazione ufficiale usata, in https
  prova: 'finto',                // 'finto': provato solo con un servizio finto; 'vero' solo se provato davvero
  parole: ['carta', 'checkout'], // per la ricerca
},
```

Le traduzioni stanno in `testi.<lingua>`:
- `'cat.costoNota'`: un testo;
- `'cat.passi'`: un elenco, lungo come quello italiano;
- `'cat.serve'`: un elenco di `{ cosa, dove }`. Il `link` resta quello del blocco italiano.

Ripiego: la lingua di chi guarda, poi l'inglese, poi l'italiano. Il test chiede:
- la `descrizione` nelle sei lingue;
- la guida in inglese (`cat.passi`, `cat.serve`, e `cat.costoNota` se c'è la nota).

Le altre lingue sono facoltative, ma se ci sono devono avere tanti passi e tante voci quanti in italiano.

## Un connettore in 10 minuti

**Prima di scrivere codice**, prova il connettore [HTTP / API REST](#il-connettore-http--api-rest-e-le-ricette): per molti
servizi bastano tre ricette dalla sua pagina. Scrivi un connettore quando ti serve di più: una firma particolare, la
paginazione, gli abbinamenti dei campi, i giri pianificati.

1. **Copia una cartella.** `connettori/stripe` è un buon punto di partenza per un servizio con un webhook firmato,
   `connettori/woocommerce` per uno da sincronizzare. Il nome della cartella è l'`id`: minuscole, cifre e trattini.
2. **Scrivi il manifesto.** Ti servono:
   - le impostazioni: cosa chiedere al titolare (`segreto: true` va cifrato);
   - `permessi`: cosa può toccare in Kubo;
   - `prova`: la «prova la connessione»;
   - `entrata`, `azioni`, `pianificati`: quello che deve fare;
   - il blocco `catalogo` e i `testi` nelle sei lingue.
3. **Scrivi il test** in `test/<id>.test.mjs` con gli attrezzi di `test/connettori-finto.mjs`:
   - `finto()` è il servizio finto;
   - `kubo()` è un Kubo in memoria;
   - `accendi()` accende il connettore;
   - `manda()` manda un webhook.

   Niente rete vera, niente chiavi vere.
4. **Controlla:** `node --test test/<id>.test.mjs test/catalogo.test.mjs`, poi `npm run catalogo` per aggiornare
   [CATALOGO.md](CATALOGO.md).
5. **Usalo.** Per l'azienda: copia la cartella in `<dati>/connettori/<id>/` e accendilo controllando la somma (vedi
   «Installare un connettore di terzi»). Per tutti: proponilo al repository.

Un esempio completo. Un servizio di prenotazioni avvisa Kubo con un webhook firmato in HMAC. Il connettore crea il
cliente e, se Lumi lo chiede, manda un messaggio di conferma:

```js
// connettori/prenota/connettore.js
export default {
  id: 'prenota', nome: 'Prenota', versione: 1, icona: 'calendario', base: 'https://api.prenota.example',
  descrizione: 'Le prenotazioni del sito diventano clienti.',
  // la carta e la guida nella Libreria
  catalogo: {
    categoria: 'prenotazioni', sito: 'https://prenota.example', costo: 'abbonamento', difficolta: 'facile', zone: ['IT'], prova: 'finto',
    serve: [{ cosa: 'Chiave API', dove: 'Prenota → Impostazioni → API', link: 'https://prenota.example/impostazioni/api' },
            { cosa: 'Segreto dei webhook', dove: 'Prenota → Impostazioni → Webhook' }],
    passi: ['Crea una chiave API in Prenota e incollala qui', 'Accendi il connettore e copia l\'indirizzo del webhook',
            'In Prenota aggiungi il webhook con quell\'indirizzo e copia qui il segreto', 'Fai una prenotazione di prova'],
    fonti: ['https://prenota.example/docs/api'], parole: ['agenda', 'appuntamenti'],
  },
  // le impostazioni generano la pagina; «segreto: true» va nell'archivio cifrato e non torna mai al browser
  impostazioni: [
    { id: 'chiave', nome: 'Chiave API', segreto: true },
    { id: 'firma', nome: 'Segreto dei webhook', segreto: true },
  ],
  // i campi che servono. La pagina li abbina a quelli di Kubo per id, e una rinomina non rompe niente
  richiede: { clienti: { nome: { tipo: 'testo' }, email: { tipo: 'email' } } },
  // cosa può toccare: diventa il ruolo dell'identità di servizio, e nella storia le modifiche risultano fatte da «Prenota»
  permessi: { clienti: { leggi: true, crea: true } },
  prova: async k => (await k.http.get(`${k.base}/me`, { bearer: k.segreti.chiave })).ok,
  // POST /api/connettori/prenota/in: pubblica, con il corpo grezzo, firma verificata prima di arrivare qui
  entrata: {
    firma: { tipo: 'hmac', intestazione: 'x-prenota-firma', segreto: 'firma', formato: 'hex' },
    idempotenza: ev => ev.id,
    async gestisci(ev, k) {
      if (ev.tipo !== 'prenotazione') return 'ignorato';
      if (k.dati.trova('clienti', 'email', ev.email)) return 'cliente già presente';
      k.dati.crea('clienti', { nome: ev.nome, email: ev.email });
      return 'cliente creato';
    },
  },
  // azioni: bottoni nella scheda e, con lumi: true, strumenti di Lumi. Con scrive: true prima c'è l'anteprima da confermare
  azioni: {
    conferma: {
      nome: 'Manda la conferma', su: 'clienti', lumi: true, scrive: true,
      input: { cliente: { tipo: 'relazione', entita: 'clienti' } },
      proponi: async ({ cliente }) => ({ titolo: 'Conferma', righe: [['A', cliente.email]], avvisi: [] }),
      esegui: async ({ cliente }, k) => { await k.http.post(`${k.base}/messaggi`, { bearer: k.segreti.chiave, json: { a: cliente.email } }); return { ok: true }; },
    },
  },
  testi: {
    en: { descrizione: 'Website bookings become customers.', 'imp.chiave': 'API key', 'imp.firma': 'Webhook secret', 'az.conferma': 'Send the confirmation',
      'cat.serve': [{ cosa: 'API key', dove: 'Prenota → Settings → API' }, { cosa: 'Webhook secret', dove: 'Prenota → Settings → Webhooks' }],
      'cat.passi': ['Create an API key in Prenota and paste it here', 'Switch the connector on and copy the webhook address',
                    'In Prenota add the webhook with that address and copy the secret here', 'Make a test booking'] },
    es: { descrizione: 'Las reservas de la web se convierten en clientes.' }, fr: { descrizione: 'Les réservations du site deviennent des clients.' },
    de: { descrizione: 'Buchungen der Website werden zu Kunden.' }, pt: { descrizione: 'As reservas do site viram clientes.' },
  },
};
```

Il test va in `test/` e usa gli attrezzi di `test/connettori-finto.mjs`. Non tocca la rete:

```js
import { finto, kubo, accendi, manda, firmaHmacDi } from './connettori-finto.mjs';
const K = await kubo(['negozio']), S = await finto({ 'POST /messaggi': (p, corpo) => ({ id: 1 }) });
await accendi(K, 'prenota', { base: S.url, segreti: { chiave: 'k', firma: 's' } });   // il finto servizio è sulla rete interna: accendi() la permette solo per lui
const corpo = JSON.stringify({ id: 'e1', tipo: 'prenotazione', nome: 'Anna', email: 'anna@esempio.it' });
await manda(K, '/api/connettori/prenota/in', corpo, { 'X-Prenota-Firma': firmaHmacDi('s', corpo, 'hex') });
```

### Il manifesto, voce per voce

| Voce | Cosa fa |
|---|---|
| `impostazioni` | `{ id, nome, tipo: 'testo'\|'url'\|'numero'\|'si_no'\|'scelta', opzioni, predefinito, schema: /regex/, segreto, generato, obbligatorio, minimo }`. `generato: true` vale per un codice creato da Kubo all'accensione (il codice segreto del feed o del callback): solo il titolare lo vede, per copiarlo. Se il titolare lo cambia, o sceglie lui il codice di un webhook con `firma.tipo: 'token'` o `nelPercorso`, servono almeno 16 caratteri (`minimo` alza la soglia per un segreto qualsiasi). Un `url` passa dal controllo SSRF. Un indirizzo pubblico di Kubo chiesto dal connettore ricade su `k.pubblico` quando è vuoto. |
| `richiede` | `{ <sezione>: { <campo>: { tipo, alias, facoltativo } } }`: la pagina propone l'abbinamento e avvisa se un campo manca. Una sezione con tutti i campi facoltativi è facoltativa anche lei. |
| `permessi` | il ruolo dell'identità `servizio:<id>`: un utente spento che non entra mai. Le righe figlie (per esempio le righe di una vendita) seguono il padre. |
| `entrata` | il webhook. `firma.tipo` è uno di questi: `stripe`, `hmac` (`intestazione`, `formato` base64 o hex), `token` (un codice segreto in fondo all'indirizzo: `/in/<codice>`), `nessuna` (si rilegge l'evento dall'API, come per SumUp), oppure `verifica: ({ req, grezzo, segreto, k, nome, q }) => bool` (`nome` è quello che segue `/in/`, `q` la query; con `nelPercorso: true` la pagina mostra l'indirizzo con il codice generato in fondo). `idempotenza(ev, req, { k, q })` dà la chiave dell'evento. `gestisci(ev, k, { req, nome, q })`. Il nucleo pone un limite di 1 MB e di 120 richieste al minuto per indirizzo. I corpi JSON, form-urlencoded e multipart/form-data si leggono da soli (multipart: i campi in UTF-8, i file solo descritti in `_file: [{ campo, nome, tipo, dimensione }]`). Su misura: `verificaGet(q, k, { req, nome })` risponde a `GET /in[/<codice>]` (la sfida di Meta con `sfidaMeta(q, token)` di `connettori-rete.js`, il controllo di Mailchimp; con il codice nell'indirizzo il codice si controlla prima), `risposta` (oggetto o `({ esito, ev, k, req, q, doppione }) => …`) sostituisce il JSON di risposta (il TwiML vuoto di Twilio, il `validationToken` di Microsoft Graph), `rispostaFirma` lo stato e il corpo su una firma sbagliata. Le tre danno `{ stato?, testo? \| json?, tipo? }`. |
| `azioni` | `{ nome, su, input, scrive, lumi, proponi, esegui }`. Le righe in `input` si leggono con i permessi di chi chiede; il servizio fa il resto. Un input con `facoltativo: true` non è obbligatorio nello schema dello strumento di Lumi e, se manca, arriva `undefined`. `proponi(x, k, { ctx })` sa chi guarda l'anteprima (per mascherare quello che solo il titolare deve vedere). |
| `pianificati` | `{ <giro>: { ogni: '15m' \| alle: '03:00', giro: async k => risultato } }`. Ogni giro ha un lucchetto. Dopo uno spegnimento si recupera un solo giro. «Sincronizza ora» è nella pagina. |
| `mappe` | `{ <nome>: { entita, id, chiave: [campoKubo, campoRemoto], campi: [{ kubo, remoto, da, comanda: 'kubo' }] } }` per `k.sincro.daRemoto(nome, oggetti)`. |
| `uscita` | `{ <sezione>: { campi, unisci: 'ultimo', quando, invia: async (riga, k) => … } }`: le modifiche fatte in Kubo vanno in coda. Quello che arriva dal connettore stesso non torna indietro (anti-eco). |
| `oauth` | `{ tipo: 'codice'\|'client', autorizza, token, dispositivo, scope, extra }`. Con il codice si usa PKCE S256 e uno `state` che vale una volta per 10 minuti. `client` serve per i client credentials (Shopify); `token` e `scope` possono essere funzioni di `k`, e `usato: imp => bool` nasconde il collegamento quando l'autenticazione scelta non è OAuth. `dispositivo` serve per il device code (un'app desktop senza indirizzo pubblico): la pagina ha il bottone «Collega con un codice», mostra codice e indirizzo e controlla da sola; la risposta può stare dentro `data`. I token si rinnovano da soli. Opzioni: `basic: true` (client_secret_basic: id e segreto in `Authorization: Basic`, non nel corpo: Xero, QuickBooks, DocuSign, eBay), `corpo: 'json'` (token e device code in JSON: Fatture in Cloud), `pkce: false` (chi rifiuta PKCE), `conserva: ['realmId', 'hostname', 'api_domain']` (valori del ritorno o della risposta del token, in `k.oauth.extra()`; quelli del ritorno ci sono già quando si calcola l'indirizzo del token), `redirect: k => …` (un redirect_uri su misura, come il RuName di eBay: vale per l'autorizzazione e per lo scambio del codice). La pagina mostra l'indirizzo di ritorno da registrare nel servizio. |
| `pubbliche` | uscite GET in sola lettura (`/api/connettori/<id>/pub/<nome>`), come il feed .ics. Si proteggono da sole, per esempio con il codice generato. |
| `testi` | le traduzioni: `{ en: { nome, descrizione, 'imp.<id>', 'aiuto.<id>', 'az.<id>', 'giro.<id>', 'cat.costoNota', 'cat.passi', 'cat.serve' } }`. Senza traduzione resta l'italiano (per il catalogo: lingua → en → it). |
| `catalogo` | la carta e la guida nella Libreria: vedi «Il blocco catalogo». Obbligatorio per i connettori ufficiali. |
| `eventi(ev, k)` | ogni crea/modifica/elimina/ripristina in Kubo che non viene dal connettore stesso (anti-eco), dentro la transazione: per mettere in coda (`k.accoda`), non per chiamare la rete. `ev = { tipo, entita, id, prima, dopo }`. |
| `azioni`, `permessi` come funzioni | `azioni: imp => ({ … })`, `permessi: imp => ({ … })`: dipendono dalle impostazioni salvate (con i predefiniti). Le ricette del connettore HTTP usano questo. Gli strumenti di Lumi si registrano di nuovo a ogni salvataggio. |
| `copie: true` | il titolare può crearne altre istanze con un nome (`<id>-<nome>`), ognuna con impostazioni, segreti, ricette, identità e registro propri. |
| impostazioni `ricette` e `json` | un valore strutturato (elenco o oggetto) salvato nelle impostazioni. `controlla(valore, { interni, S, db })` lo ripulisce o lancia un errore; la pagina ha un editor per `ricette` e un'area di testo per `json`. |

### Il `k` di un connettore

| Strumento | Cosa fa |
|---|---|
| `k.imp`, `k.segreti`, `k.base` | le impostazioni, i segreti decifrati (solo sul server) e l'indirizzo del servizio |
| `k.pubblico` | l'indirizzo pubblico di Kubo (`https://kubo.bottega.it`, senza barra finale) o `''`: vedi «L'indirizzo pubblico di Kubo» |
| `k.dati` | `leggi`, `elenca`, `crea`, `modifica`, `trova(sezione, campo, valore)` con i nomi del connettore, tradotti negli id dello schema, con l'identità di servizio e l'origine |
| `k.valore(riga, sezione, campo)` | un valore della riga letto con il nome del connettore |
| `k.http` | `get`, `post`, `put`, `patch`, `delete` (`json`, `form`, `testo`, `bearer`, `basic`, `intestazioni`) e `pagine(url, { totale })`. Restituisce `{ stato, ok, intestazioni, testo, json }`. Riprova su 429 e 5xx, e non va mai verso la rete interna senza il consenso del titolare. |
| `k.sincro` | `daRemoto`, `remoto(sezione, riga)`, `locale(sezione, idRemoto)`, `collega(sezione, riga, idRemoto)`, `scollega(sezione, { riga } \| { remoto } \| {})` (dimentica i legami: mai `_connettori_mappa` a mano) |
| `k.accoda(tipo, chiave, corpo, { unisci })` | lavori in coda (`lavori: { <tipo>: async (corpo, k) => … }` nel manifesto) con i tentativi di `import-api.js` |
| `k.oauth.token()`, `k.oauth.collegato()`, `k.oauth.extra()` | l'accesso OAuth: il token valido (rinnovato se serve), se l'account è collegato e i valori di `oauth.conserva` |
| `k.stato.leggi`, `k.stato.scrivi` | un piccolo stato persistente (cursori, «già ricordate») |
| `k.avvisa(testo)`, `k.annota(...)` | un avviso al registro e ai browser collegati, e una voce del registro |
| `k.interni()` | se il titolare ha permesso la rete interna (per i protocolli non HTTP, come SMTP) |

## Il connettore HTTP / API REST e le ricette

`connettori/http` collega un servizio qualunque dalla sua pagina, senza codice.

**Le impostazioni:**
- l'indirizzo base;
- l'autenticazione, una di queste:
  - nessuna;
  - chiave in un'intestazione (es. `X-API-Key`);
  - chiave nella query (es. `?api_key=`);
  - Bearer;
  - Basic;
  - OAuth2 client credentials (indirizzo del token, client ID e secret, scope: il token si rinnova da solo ed è cifrato);
- le intestazioni in più, in JSON;
- un percorso per «prova la connessione»;
- le **ricette**.

Il motore è `server/moduli/connettori-ricette.js`, lo stesso dei ponti.

**Più servizi.** Per un secondo servizio REST c'è «Collega un altro servizio così» nella pagina del connettore
(`POST /api/connettori/http/copie { nome }`). Nasce una copia con un id suo, per esempio `http-crm`, e con i suoi:
- indirizzo e autenticazione;
- segreti e ricette;
- identità di servizio e registro.

Una copia spenta si toglie (`DELETE /api/connettori/<id>`) insieme a segreti, impostazioni e registro. Vale per ogni
connettore con `copie: true` nel manifesto (HTTP e webhook). Una ricetta ha `id`, `nome`, `tipo`, `sezione` e
`attiva`, più i campi del suo tipo:

| Tipo | Cosa fa | Campi |
|---|---|---|
| `uscita` | su crea / modifica / elimina / ripristina di una riga della sezione mette in coda una richiesta. La coda è quella del nucleo, con i tentativi crescenti. | `eventi`, `metodo`, `percorso`, `corpo` |
| `azione` | un bottone nella scheda della sezione e uno strumento di Lumi (`connettore_http_<id>`; per la copia `http-crm`, `connettore_http__crm_<id>`). Con `scrive` (predefinito) prima c'è l'anteprima: metodo, indirizzo con la chiave mascherata, corpo. Un indirizzo completo (i ponti) lo vede intero solo il titolare. Se la risposta ha un `url` https, si mostra da copiare. | `metodo`, `percorso`, `corpo`, `scrive`, `conAccesso` |
| `entrata` | `POST /api/connettori/http/in/<codice>[?ricetta=<id>]`: i campi del JSON diventano campi della sezione. | `modo`, `chiave`, `campi`, `elenco`, `idEvento` |

**Accesso e indirizzi completi.** La chiave, il token o il Basic del connettore HTTP vanno solo all'indirizzo base. Una
ricetta con un indirizzo completo su un altro sito parte senza, a meno che il titolare spunti «Manda la chiave o il token
anche se l'indirizzo è su un altro sito» (`conAccesso: true` nella ricetta). Le intestazioni in più non accettano a capo
(CR/LF): si rifiutano al salvataggio.

**Segnaposto.** Nel percorso e nel corpo si scrive `{campo}`:
- il campo è l'id o il nome (`{email}`, `{Ragione sociale}`);
- si scende negli oggetti con il punto (`{cliente.titolo}`);
- ci sono anche `{id}`, `{evento}`, `{sezione}` e `{quando}`.

Nel percorso i valori si codificano per l'indirizzo. Il corpo può essere:
- **vuoto**: parte tutta la riga, con `evento`, `sezione` e `quando`;
- **JSON**: `"{totale}"` da solo tiene il tipo (numero, sì/no, oggetto), dentro un testo diventa testo;
- **altro**: si manda come testo.

Il percorso è relativo all'indirizzo base (`/contatti/{id}`) oppure è un indirizzo completo. Passa dal controllo SSRF
quando si salva e di nuovo quando parte. In un indirizzo completo i segnaposto vanno solo nel percorso e nella query, mai
nel nome del sito o nella porta (`https://{negozio}.com/` è rifiutato): il sito lo sceglie il titolare, non una riga,
altrimenti chi scrive quel campo deciderebbe dove partono la chiave e i dati.

**In entrata.** L'indirizzo ha in fondo un codice segreto generato da Kubo. La pagina lo mostra sotto ogni ricetta.
- **Firma.** Con il «segreto HMAC in entrata», la richiesta deve portare anche la firma HMAC-SHA256 del corpo grezzo,
  in hex o base64 (anche con `sha256=` davanti), nell'intestazione scelta (`X-Signature` se non dici niente).
- **Riga da aggiornare.** `chiave` è il campo di Kubo che ritrova la riga, per esempio l'email. `modo` è uno di:
  - `crea-o-aggiorna`;
  - `crea`;
  - `aggiorna`.
- **Abbinamenti.** `campi` è un elenco di `{ da: 'cliente.email', a: 'email' }`. Senza abbinamenti valgono le chiavi
  del JSON con l'id o il nome dei campi.
- **Più righe.** `elenco` è il percorso di un array con più righe.
- **Doppioni.** `idEvento` (o l'intestazione `Idempotency-Key`) evita di scrivere due volte la stessa cosa.

Tutto avviene in una transazione: se una riga non va, non si scrive niente e la risposta è un 422 con i campi sbagliati.

**Permessi.** L'identità del connettore ricava i permessi dalle ricette:
- legge le sezioni che manda;
- crea e modifica solo dove le ricette in entrata scrivono.

Le righe che arrivano da un servizio non ripartono verso lo stesso servizio (anti-eco).

Gli errori delle ricette sono `ErroreRicetta(chiave, parametri, stato)`, con i messaggi in `connettori-lingue.js`: il
nucleo li traduce nella lingua di chi chiede.

## Ponti verso le piattaforme di automazione

`zapier`, `make`, `n8n`, `pipedream` e `webhook` sono connettori della categoria «automazione». Usano lo stesso motore
di ricette, con l'indirizzo completo che dà la piattaforma: non c'è un indirizzo base.

- **Dall'evento alla piattaforma.** Una ricetta `uscita`: «quando in Articoli si crea una riga → POST al Catch Hook di
  Zapier». Va bene anche per il Custom webhook di Make, il nodo Webhook di n8n e il trigger HTTP di Pipedream.
- **Dalla piattaforma a Kubo.** Una ricetta `entrata`: la piattaforma fa un POST JSON a
  `/api/connettori/<ponte>/in/<codice>`. Kubo deve essere raggiungibile da internet; per n8n sulla stessa rete basta
  permettere la rete interna nella pagina.
- **Firma in uscita.** Con il «segreto per firmare le richieste in uscita», Kubo manda `X-Kubo-Tempo` e
  `X-Kubo-Firma: sha256=<HMAC(segreto, "<tempo>.<corpo>")>`, come i webhook di «API e integrazioni». Un ricevitore
  solo può controllare tutte e due le firme.
- **Per tutto il resto** (leggere, cercare, modificare qualsiasi sezione) le piattaforme usano l'API REST di Kubo con
  un token personale e la descrizione OpenAPI qui sotto.

Le guide passo per passo di ogni piattaforma sono nel loro blocco `catalogo`: si leggono nella Libreria e in
[CATALOGO.md](CATALOGO.md).

## L'indirizzo pubblico di Kubo

Webhook e ritorni OAuth vogliono un indirizzo che il servizio raggiunga da internet. È uno per tutta l'azienda: il titolare
lo scrive in fondo alla Libreria («Indirizzo pubblico di Kubo», `GET`/`PUT /api/connettori/impostazioni { pubblico }`), o
lo dà la variabile `KUBO_PUBBLICO`. I connettori lo leggono in `k.pubblico`; quelli che chiedono un loro indirizzo
(`indirizzo`, `pubblico`) lo usano quando il loro è vuoto, e la pagina di ogni connettore mostra l'indirizzo completo del
webhook costruito da lì (senza, quello del browser).

## Movimenti di banca

I connettori bancari (Enable Banking, Qonto, Revolut Business, Wise: `connettori/_soldi/banca.js`) scrivono nella sezione
`movimenti_banca` della tesoreria, con i suoi campi (`data`, `importo` + entrata / − uscita, `descrizione`, `controparte`,
`iban`, `riferimento`, `conto`, `fonte: openbanking`, `id_esterno` = l'id della banca, niente doppioni). Abbinare i
movimenti alle fatture lo fa solo la tesoreria (pagina Banca, strumento `tesoreria_abbina_movimento`): vedi
[TESORERIA.md](TESORERIA.md). Un nuovo connettore bancario usa `registraMovimenti(k, movimenti)` e `RICHIEDE_BANCA`.

## OpenAPI 3.1

`GET /api/openapi-3.1.json` descrive le API di Kubo come le vede chi chiede. Si apre con la sessione o con
`Authorization: Bearer <token personale>`. Dentro ci sono:

- **le sezioni e i campi** che può leggere, in JSON Schema 2020-12: un campo non obbligatorio è `["string", "null"]`;
- **le operazioni**:
  - `GET`/`POST /api/dati/<sezione>`, `GET`/`PATCH`/`DELETE /api/dati/<sezione>/{id}`;
  - storia e ripristino;
  - `/api/schema`;
  - ognuna con un `operationId` unico (`elenca_clienti`, `crea_clienti`…) e solo i metodi che i permessi concedono;
- **`webhooks`**: le consegne dei webhook di Kubo per ogni sezione, con le intestazioni della firma;
- **per il titolare**, gli indirizzi in entrata dei connettori a ricette accesi, con le loro ricette. Il codice segreto
  non c'è.

Si importa in Postman, Insomnia, n8n (nodo HTTP Request), nelle app personalizzate di Make o in un generatore di client.
`/api/openapi.json` (OpenAPI 3.0.3, `server/moduli/import-api.js`) resta per chi lo usa già.

## Sicurezza

- **Segreti.** Sono cifrati con AES-256-GCM, legati al connettore e al nome (dati associati). La chiave sta in `<dati>/connettori-chiave` con permessi 600. Il backup contiene solo il cifrato: per ripristinare i segreti su un altro computer va copiata anche la chiave. I segreti non tornano mai al browser (la pagina riceve solo «salvato») né a Lumi.
- **Solo il titolare** accende, spegne e configura, e solo dall'interfaccia: con un token API non si può. Prima dell'accensione la pagina mostra cosa potrà fare il connettore.
- **Webhook.** Le rotte `/in` sono pubbliche, ma senza firma valida rispondono 401 (o lo stato di `rispostaFirma`); un connettore spento risponde 404. Il GET risponde solo con `verificaGet`, e con il codice giusto se il codice sta nell'indirizzo. I codici in fondo all'indirizzo scelti dal titolare hanno almeno 16 caratteri.
- **Pulizia.** Una volta al giorno si tolgono le consegne finite da più di 30 giorni (`_connettori_coda`) e gli eventi già visti da più di 90 (`_connettori_eventi`); il registro tiene 90 giorni.
- **Ponti e chiavi.** Gli indirizzi degli hook (Zapier, Make, n8n) valgono come segreti: nelle anteprime chi non è titolare vede solo il sito. La chiave del connettore HTTP non va mai a un altro sito senza `conAccesso`. Niente CR/LF nelle intestazioni.
- **SSRF.** `k.http` controlla l'indirizzo vero a cui si collega, anche contro il DNS rebinding. La rete interna si apre per un solo connettore, con la spunta nella sua pagina.
- **Identità di servizio.** Ogni scrittura risulta fatta da «Stripe», «WooCommerce»… con i soli permessi dichiarati.
- **Anti-eco.** L'origine della scrittura in corso è `origineAttuale()`: una modifica arrivata da un servizio non riparte verso lo stesso servizio.

## Installare un connettore di terzi

1. Copia la cartella in `<dati>/connettori/<id>/`, accanto a `kubo.db`. Il nome della cartella deve essere uguale all'`id` del manifesto.
2. Riavvia Kubo. Il connettore compare nel catalogo come «Installato a mano».
3. Nella sua pagina, **Accendi** mostra la somma SHA-256 del file: confrontala con quella pubblicata dall'autore. Fino a quel momento Kubo non esegue il file (non lo importa nemmeno all'avvio): per questo nome, impostazioni e permessi si vedono solo dopo l'accensione.
4. Se il file cambia dopo l'accensione, al riavvio successivo il connettore non viene caricato e resta fermo («Cambiato») finché il titolare non lo riaccende controllando la nuova somma. Conta la somma di `connettore.js`: se il connettore importa altri file della sua cartella, cambiarli non cambia la somma.

Un connettore è codice che gira con i permessi del server: installa solo quelli di cui ti fidi. Non si caricano mai dall'interfaccia.

## Strumenti di Lumi

Le azioni con `lumi: true` si registrano con il contratto comune `k.lumi?.strumento({ nome: 'connettore_<id>_<azione>', descrizione, schema, tipo, permesso, esegui, anteprima })`.
Il nome dipende solo dalla coppia connettore-azione, così due coppie non si rubano mai lo strumento: il `-` dell'id diventa
`__` (`connettore_google__contatti_crea`); se l'azione ha caratteri da cambiare o il nome passa i 64 caratteri, si accorcia
e prende 8 cifre esadecimali dell'impronta della coppia. Gli input `facoltativo` non sono in `required`.
Con `scrive: true` lo strumento è di tipo «scrivi»: Lumi mostra l'anteprima (`proponi`) con Conferma e Annulla. Se il modulo di Lumi non offre ancora `k.lumi`, non succede niente.

## Fonti delle regole dei servizi

- [Stripe, verifica della firma](https://docs.stripe.com/webhooks#verify-manually), con una tolleranza di 300 s.
- [SumUp, webhook](https://developer.sumup.com/online-payments/webhooks/): il webhook non è firmato, quindi si rilegge il checkout.
- [WooCommerce, webhook](https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks).
- [Shopify, client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
- [Shopify, inventorySetQuantities](https://shopify.dev/changelog/finalizing-compare-and-swap-redesign-for-inventory-set-quantities): dalla versione 2026-04 servono `changeFromQuantity` e `@idempotent`.
- [Openapi SDI](https://console.openapi.com/apis/sdi/documentation): `POST /invoices`, gli eventi del callback e gli ambienti `sdi.openapi.it` e `test.sdi.openapi.it`.
- RFC 5545 (iCalendar), RFC 5321 (SMTP), RFC 7636 (PKCE), RFC 8628 (device code), RFC 6749 §2.3.1 (client_secret_basic).
- Verifiche dei webhook: [Meta, hub.challenge](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), [Microsoft Graph, validationToken](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks), [Mailchimp, webhook](https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/), [Twilio, TwiML vuoto](https://www.twilio.com/docs/messaging/twiml).
- [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0), RFC 9110 (HTTP), RFC 2104 (HMAC), RFC 6749 §4.4 (client credentials).
- Le piattaforme: [Zapier, Catch Hook](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks), [Make, webhook](https://www.make.com/en/help/tools/webhooks), [n8n, Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [Pipedream, trigger](https://pipedream.com/docs/workflows/building-workflows/triggers/).
