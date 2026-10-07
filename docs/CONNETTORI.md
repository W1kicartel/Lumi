# I connettori di Kubo

Un connettore collega Kubo a un servizio: pagamenti, negozio online, fatturazione elettronica, posta, calendario.
È **una cartella con un file**: `connettori/<id>/connettore.js`. Il connettore dichiara cosa gli serve, e il nucleo
(`server/moduli/connettori.js`) fa il resto:

- custodisce i segreti, cifrati;
- genera la pagina delle impostazioni;
- riceve i webhook e ne verifica la firma;
- chiama il servizio senza aprire la rete interna;
- mette in coda e riprova;
- fa girare i giri pianificati;
- abbina i campi;
- gestisce OAuth;
- tiene il registro;
- dà gli strumenti a Lumi.

Quelli ufficiali sono sette: Stripe, SumUp, WooCommerce, Shopify, Openapi SDI, Email e PEC, Calendario (feed .ics e Google Calendar).

## Un connettore in 10 minuti

Un esempio completo. Un servizio di prenotazioni avvisa Kubo con un webhook firmato in HMAC. Il connettore crea il
cliente e, se Lumi lo chiede, manda un messaggio di conferma:

```js
// connettori/prenota/connettore.js
export default {
  id: 'prenota', nome: 'Prenota', versione: 1, icona: 'calendario', base: 'https://api.prenota.example',
  descrizione: 'Le prenotazioni del sito diventano clienti.',
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
  testi: { en: { descrizione: 'Website bookings become customers.', 'imp.chiave': 'API key', 'imp.firma': 'Webhook secret', 'az.conferma': 'Send the confirmation' } },
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
| `impostazioni` | `{ id, nome, tipo: 'testo'\|'url'\|'numero'\|'si_no'\|'scelta', opzioni, predefinito, schema: /regex/, segreto, generato, obbligatorio }`. `generato: true` vale per un codice creato da Kubo all'accensione (il codice segreto del feed o del callback): solo il titolare lo vede, per copiarlo. Un `url` passa dal controllo SSRF. |
| `richiede` | `{ <sezione>: { <campo>: { tipo, alias, facoltativo } } }`: la pagina propone l'abbinamento e avvisa se un campo manca. Una sezione con tutti i campi facoltativi è facoltativa anche lei. |
| `permessi` | il ruolo dell'identità `servizio:<id>`: un utente spento che non entra mai. Le righe figlie (per esempio le righe di una vendita) seguono il padre. |
| `entrata` | il webhook. `firma.tipo` è uno di questi: `stripe`, `hmac` (`intestazione`, `formato` base64 o hex), `token` (un codice segreto in fondo all'indirizzo: `/in/<codice>`), `nessuna` (si rilegge l'evento dall'API, come per SumUp), oppure `verifica: ({ req, grezzo, segreto, k }) => bool`. `idempotenza(ev, req)` dà la chiave dell'evento. Il nucleo pone un limite di 1 MB e di 120 richieste al minuto per indirizzo. I corpi JSON e form-urlencoded si leggono da soli. |
| `azioni` | `{ nome, su, input, scrive, lumi, proponi, esegui }`. Le righe in `input` si leggono con i permessi di chi chiede; il servizio fa il resto. |
| `pianificati` | `{ <giro>: { ogni: '15m' \| alle: '03:00', giro: async k => risultato } }`. Ogni giro ha un lucchetto. Dopo uno spegnimento si recupera un solo giro. «Sincronizza ora» è nella pagina. |
| `mappe` | `{ <nome>: { entita, id, chiave: [campoKubo, campoRemoto], campi: [{ kubo, remoto, da, comanda: 'kubo' }] } }` per `k.sincro.daRemoto(nome, oggetti)`. |
| `uscita` | `{ <sezione>: { campi, unisci: 'ultimo', quando, invia: async (riga, k) => … } }`: le modifiche fatte in Kubo vanno in coda. Quello che arriva dal connettore stesso non torna indietro (anti-eco). |
| `oauth` | `{ tipo: 'codice'\|'client', autorizza, token, dispositivo, scope, extra }`. Con il codice si usa PKCE S256 e uno `state` che vale una volta per 10 minuti. `client` serve per i client credentials (Shopify). `dispositivo` serve per il device code (un'app desktop senza indirizzo pubblico). I token si rinnovano da soli. |
| `pubbliche` | uscite GET in sola lettura (`/api/connettori/<id>/pub/<nome>`), come il feed .ics. Si proteggono da sole, per esempio con il codice generato. |
| `testi` | le traduzioni: `{ en: { nome, descrizione, 'imp.<id>', 'aiuto.<id>', 'az.<id>', 'giro.<id>' } }`. Senza traduzione resta l'italiano. |

### Il `k` di un connettore

| Strumento | Cosa fa |
|---|---|
| `k.imp`, `k.segreti`, `k.base` | le impostazioni, i segreti decifrati (solo sul server) e l'indirizzo del servizio |
| `k.dati` | `leggi`, `elenca`, `crea`, `modifica`, `trova(sezione, campo, valore)` con i nomi del connettore, tradotti negli id dello schema, con l'identità di servizio e l'origine |
| `k.valore(riga, sezione, campo)` | un valore della riga letto con il nome del connettore |
| `k.http` | `get`, `post`, `put`, `patch`, `delete` (`json`, `form`, `testo`, `bearer`, `basic`, `intestazioni`) e `pagine(url, { totale })`. Restituisce `{ stato, ok, intestazioni, testo, json }`. Riprova su 429 e 5xx, e non va mai verso la rete interna senza il consenso del titolare. |
| `k.sincro` | `daRemoto`, `remoto(sezione, riga)`, `locale(sezione, idRemoto)`, `collega` |
| `k.accoda(tipo, chiave, corpo, { unisci })` | lavori in coda (`lavori: { <tipo>: async (corpo, k) => … }` nel manifesto) con i tentativi di `import-api.js` |
| `k.oauth.token()`, `k.oauth.collegato()` | l'accesso OAuth: il token valido (rinnovato se serve) e se l'account è collegato |
| `k.stato.leggi`, `k.stato.scrivi` | un piccolo stato persistente (cursori, «già ricordate») |
| `k.avvisa(testo)`, `k.annota(...)` | un avviso al registro e ai browser collegati, e una voce del registro |
| `k.interni()` | se il titolare ha permesso la rete interna (per i protocolli non HTTP, come SMTP) |

## Sicurezza

- **Segreti.** Sono cifrati con AES-256-GCM, legati al connettore e al nome (dati associati). La chiave sta in `<dati>/connettori-chiave` con permessi 600. Il backup contiene solo il cifrato: per ripristinare i segreti su un altro computer va copiata anche la chiave. I segreti non tornano mai al browser (la pagina riceve solo «salvato») né a Lumi.
- **Solo il titolare** accende, spegne e configura, e solo dall'interfaccia: con un token API non si può. Prima dell'accensione la pagina mostra cosa potrà fare il connettore.
- **Webhook.** Le rotte `/in` sono pubbliche, ma senza firma valida rispondono 401; un connettore spento risponde 404.
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
Con `scrive: true` lo strumento è di tipo «scrivi»: Lumi mostra l'anteprima (`proponi`) con Conferma e Annulla. Se il modulo di Lumi non offre ancora `k.lumi`, non succede niente.

## Fonti delle regole dei servizi

- [Stripe, verifica della firma](https://docs.stripe.com/webhooks#verify-manually), con una tolleranza di 300 s.
- [SumUp, webhook](https://developer.sumup.com/online-payments/webhooks/): il webhook non è firmato, quindi si rilegge il checkout.
- [WooCommerce, webhook](https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks).
- [Shopify, client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
- [Shopify, inventorySetQuantities](https://shopify.dev/changelog/finalizing-compare-and-swap-redesign-for-inventory-set-quantities): dalla versione 2026-04 servono `changeFromQuantity` e `@idempotent`.
- [Openapi SDI](https://console.openapi.com/apis/sdi/documentation): `POST /invoices`, gli eventi del callback e gli ambienti `sdi.openapi.it` e `test.sdi.openapi.it`.
- RFC 5545 (iCalendar), RFC 5321 (SMTP), RFC 7636 (PKCE), RFC 8628 (device code).
