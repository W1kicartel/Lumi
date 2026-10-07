# Le lingue di Kubo

Kubo parla italiano, inglese, spagnolo, francese, tedesco e portoghese del Brasile.

L'**italiano resta la lingua di partenza**: ogni testo nasce in italiano, ogni chiave c'è sempre in italiano, e se una traduzione manca si vede l'italiano.

## Cosa cambia con la lingua e cosa no

| Cambia | Non cambia |
|---|---|
| i testi dell'interfaccia: primo avvio, barra laterale, liste, schede, filtri, Personalizza, persone e permessi, agenda, cruscotto, Lumi | i nomi nel codice e i commenti (restano in italiano) |
| i messaggi di errore che il server manda all'interfaccia | gli id di sezioni, campi, opzioni e automazioni |
| numeri, valuta, date, primo giorno della settimana | i dati già salvati, compresi i nomi delle sezioni che ci sono già |
| la lingua in cui risponde Lumi | i log del server |
| i nomi dei modelli **nuovi**, installati nella lingua dell'azienda | |
| i nomi delle funzioni nelle formule (accettati tutti, sempre) | |

**La lingua è della persona, la valuta è dell'azienda.** In un negozio di Lugano la cassiera può avere Kubo in italiano e il titolare in tedesco: tutti e due vedono gli importi in franchi.

## Come si sceglie la lingua

`web/lingua.js` la legge prima di tutto il resto (`await` in cima al modulo). L'ordine:

1. la lingua salvata sul server per l'utente (`GET /api/lingua`, tabella `_lingue_utenti`);
2. l'ultima lingua usata in questo browser (`localStorage['kubo.lingua']`): serve prima dell'accesso, quando ancora non si sa chi è;
3. la prima lingua del browser che Kubo conosce;
4. l'italiano.

Si cambia:

- nella prima pagina e in quella d'accesso, con il menu in alto (resta in questo browser);
- nel piede della barra laterale (IT · EN · ES · FR · DE · PT): si salva sul server per l'utente e vale su ogni dispositivo;
- in **Lingua e valuta** (`#/lingua`, `web/moduli/lingue.js`), che mostra anche un esempio dei formati.

Chi entra la prima volta senza una lingua salvata si ritrova con quella che sta usando, e quella si salva.

## La lingua e la valuta dell'azienda

In **Lingua e valuta** chi può personalizzare sceglie:

- **la lingua dei modelli nuovi**: i modelli installati da lì in poi arrivano con i nomi in quella lingua;
- **la valuta** (EUR predefinito, USD, GBP, CHF, BRL, MXN e altre): cambia solo come si mostrano gli importi, non i valori salvati.

Nella prima pagina le due cose si scelgono prima di creare il titolare. La lingua è quella della pagina e la valuta è proposta dal paese del browser (en-US → USD, pt-BR → BRL, de-CH → CHF). Prima del primo avvio `PUT /api/lingua/azienda` è aperto a tutti, perché non c'è ancora nessun utente. Dopo serve il potere di personalizzare.

## Come si scrive un testo

```js
import { t, minuscole } from './lingua.js';
toast(t('viste.salvata-tutti'));
h('div.vuoto', t('viste.ancora-nessuno', { nome: minuscole(def.nome) }));
```

- **I cataloghi** sono in `web/lingue/<codice>/<area>.js`, con `export default { 'area.chiave': 'testo', … }`. Le aree, elencate in `web/lingue/indice.js`, sono quattro:
  - `comune`: app, ui e parole condivise;
  - `viste`: lista, scheda, campi e filtri;
  - `gestione`: Personalizza, persone e permessi, lingua e valuta;
  - `moduli`: agenda, cruscotto, Lumi, import e documenti.
- **Una chiave nuova** si scrive in tutte e sei le lingue nello stesso commit.
- **Parametri:** `{nome}`. `t()` non fa l'escape: il testo va negli elementi con `h()` (textContent), mai in `innerHTML`.
- **Plurali:** `{ one: '…', other: '{n} …' }` con il parametro `n`, scelti con `Intl.PluralRules`. In portoghese del Brasile lo 0 prende `other` («0 itens»).
- **Frasi intere, non pezzi.** Mai `t('a') + nome + t('b')`: in un'altra lingua l'ordine delle parole cambia.
- **I nomi delle sezioni dentro una frase** passano da `minuscole()`: minuscoli in tutte le lingue tranne il tedesco, dove i nomi restano maiuscoli («In Kunden suchen…»).
- **Chiavi composte** (``t('gestione.tipo-' + tipo)``, ``t('moduli.ag-periodo-' + k)``): la prova le riconosce dal prefisso che finisce con «-».
- **Virgolette:** «…» in italiano, spagnolo e portoghese; « … » in francese; „…“ in tedesco; “…” in inglese.
- **Registro:** si dà del tu in italiano, spagnolo e tedesco, del «vous» in francese e del «você» in portoghese.

## Formati

Tutto viene da `web/lingua.js`, che usa `Intl`. Mai `'it-IT'` scritto a mano.

- `numero(x)`, `soldi(x)` (nella valuta dell'azienda), `soldiCorto`, `numeroCorto`, `data(iso)`, `dataOra(iso)`.
- `leggiNumero('1.234,5')`: legge i numeri scritti nel formato della lingua (gli importi nelle schede e nei filtri).
- `primoGiorno()` e `giorniSettimana()`: lunedì in Europa, domenica negli Stati Uniti e in Brasile (`Intl.Locale.getWeekInfo`, con una piccola tabella dove manca).

Il locale dei formati è quello del browser se è della stessa lingua: con la lingua inglese, en-US dà le date all'americana e en-GB all'inglese. Il portoghese usa sempre pt-BR. Il calendario e il cruscotto usano questi formati: intestazioni dei giorni, mese, settimana, tempi relativi («5 min ago», «hace 5 min»).

## Il server

`server/moduli/lingue.js` non cambia nessun messaggio del motore: il motore continua a lanciare i suoi testi in italiano.

Prima che la risposta parta, un aggancio di `api.js` (`suErrore`) passa il corpo dell'errore al modulo. Il modulo riconosce il messaggio nel catalogo italiano (`server/moduli/lingue/it.js`: chiave → modello con i `{parametri}`), ne estrae i parametri e lo riscrive con la stessa chiave nella lingua della richiesta. Questo vale anche per gli errori per campo (`campi`) e per l'elenco dei `dettagli`.

- I parametri che iniziano con «_» sono messaggi anche loro e si traducono a loro volta (`campo «x»: formula non valida (Carattere non valido «#»)`).
- **La lingua della richiesta** è quella dell'utente, poi `Accept-Language`, poi la lingua dell'azienda.
- **Un messaggio che non è nel catalogo resta in italiano.** La prova `test/lingue.test.mjs` legge tutti i `throw` e gli `errori.push` di `server/` e dei moduli, e fallisce se ce n'è uno che il catalogo non riconosce. Chi aggiunge un messaggio lo aggiunge anche nei sei cataloghi.

## I modelli

I nomi tradotti stanno in `modelli/lingue/<codice>.json`: modello, descrizione, entità, campi, opzioni e automazioni, per id. Gli id non cambiano mai. `M.ritocchi` (in `server/modelli.js`) applica i nomi della lingua dell'azienda al momento dell'installazione. `GET /api/lingua/modelli?l=<codice>` dà i nomi tradotti alla prima pagina.

Il cruscotto predefinito nasce con i titoli in italiano. Nell'interfaccia si vedono tradotti finché nessuno li cambia (`nomeW` in `web/moduli/agenda.js`).

## Le formule

Le funzioni si scrivono in italiano, inglese, spagnolo, francese, tedesco o portoghese, con o senza accenti:

| | | | | | |
|---|---|---|---|---|---|
| SOMMA | SUM | SUMA | SOMME | SUMME | SOMA |
| SE | IF | SI | SI | WENN | SE |
| MEDIA | AVERAGE | PROMEDIO | MOYENNE | MITTELWERT | MÉDIA |
| OGGI | TODAY | HOY | AUJOURDHUI | HEUTE | HOJE |

Valgono anche CONTA, VUOTO, ARROTONDA, CONCATENA, MAIUSCOLO, MINUSCOLO, LUNGHEZZA, ADESSO, GIORNI, AGGIUNGIGIORNI, ANNO e MESE (`ALTRI_NOMI` in `server/formule.js`), e VERO/FALSO nelle sei lingue. Già nell'analisi ogni nome diventa quello italiano, quindi la formula salvata funziona per tutti. Gli argomenti si separano con «;» (come in Excel nelle lingue europee) oppure con «,».

## Lumi

- **Il pannello** ha i suoi cataloghi in `web/lumi/lingua.js`, nelle sei lingue.
- **Le impostazioni** (`#/lumi`) usano il catalogo `moduli`.
- **Le istruzioni al modello** sono in italiano per l'italiano e in inglese per le altre lingue, con la riga «Reply in Spanish / French / German / Brazilian Portuguese» e il registro giusto (`server/moduli/lumi/nucleo.js`).
- Per confermare una proposta Lumi capisce anche «sí», «oui», «ja», «sim» e per annullarla «non», «nein», «não».

## Le prove

`npm test` comprende `test/lingue.test.mjs`, che controlla:

- **i cataloghi web:** stesse chiavi e stessi parametri in tutte le lingue, plurali con `other`;
- **le chiavi:** ogni `t('…')` del codice è nel catalogo, e ogni chiave italiana serve a qualcosa;
- **i testi a mano:** nei file del motore web e nei moduli tradotti non restano frasi italiane scritte fuori da `t()`;
- **niente variabili locali chiamate `t`** nei file che usano `t()` (coprirebbero la funzione);
- **la sintassi** dei file web toccati;
- **i formati:** lingua scelta, plurali, numeri, valute, primo giorno della settimana;
- **il server:** parità dei cataloghi, ogni messaggio riconosciuto, traduzione annidata, `Accept-Language`;
- **l'API:** la lingua dell'utente, gli errori nella sua lingua, il modello installato in inglese con gli stessi id;
- **le formule** nelle sei lingue;
- **i modelli tradotti:** ogni nome punta a un id che esiste, e non manca nessun nome.

## Cosa manca ancora

Tutte le schermate sono tradotte, compresi documenti, import ed export e **API e integrazioni**; gli esempi di codice (curl, verifica della firma) restano come sono. I loro messaggi d'errore dal server invece sono già tradotti. L'import accetta numeri nei due formati («1.234,50» e «1,234.50»), ma le date solo con il giorno prima («31/12/2026») e il sì/no come «sì», «yes», «1», «x». Restano in italiano anche:

- gli avvisi delle automazioni (`ev.testo`);
- le stampe dei documenti;
- il contesto che l'interfaccia manda a Lumi (sono dati per il modello, che li capisce comunque).
