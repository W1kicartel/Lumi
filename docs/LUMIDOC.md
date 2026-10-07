# Lumi per i documenti

Lumi fa le fatture a parole: «fai una fattura a Rossi Srl per 3 ore di consulenza a 80 euro più IVA», «nota di credito della fattura 12», «quanto mi devono i clienti?», «esporta l'XML della fattura 15». Come sempre **l'AI propone e la persona decide**: ogni scrittura è una scheda con Conferma / Annulla, e la scheda mostra i conti e i controlli dello SDI **prima** della conferma.

## Gli strumenti dai moduli (`k.lumi`)

Fino a ieri gli strumenti di Lumi si generavano solo dallo schema, in `web/moduli/lumi/strumenti.js`. Ora un modulo del server può aggiungere i suoi, con il contratto uguale per tutte le squadre:

```js
export default function registra({ lumi, P }) {
  lumi?.strumento({
    nome: 'fattura_emetti', tipo: 'scrivi',                    // 'leggi' risponde subito; 'scrivi' passa dalla scheda
    descrizione: 'Emette una fattura in bozza…', schema: { type: 'object', properties: { … }, required: [ … ] },
    permesso: ctx => P.puo(ctx, 'fatture', 'modifica'),       // chi non può non lo vede nemmeno
    anteprima: async ({ ctx, args, lingua }) => ({ titolo, righe: [[etichetta, valore], …], avvisi: [], nota }),
    esegui: async ({ ctx, args }) => ({ testo: 'Fatto: …', … }),
  });
}
```

Il contratto ha anche quattro aggiunte facoltative:

| | |
|---|---|
| `lumi.istruzioni(testo)` | righe in più per il modello: quando usare gli strumenti del modulo |
| `lumi.scheda(entita, f)` | righe e avvisi in più nella scheda dei `crea_`/`modifica_` generati dallo schema; `f` può anche dire `{ errore }` e fermare la proposta |
| `lumi.sostituisce(nome)` | uno strumento generato dallo schema da non offrire più, perché il modulo ne ha uno migliore |
| `scarica` nel risultato | `{ nome, tipo, contenuto }`: il browser lo salva come file e al modello arriva solo il nome |

Il percorso di una scrittura:

1. Il modello chiama lo strumento.
2. Il browser chiede `POST /api/lumi/strumenti/:nome/anteprima`. Il server controlla gli argomenti contro lo schema, il permesso e chiama `anteprima`, che restituisce la scheda e un **gettone**.
3. La persona vede la scheda e preme Conferma.
4. Il browser chiama `POST /api/lumi/strumenti/:nome/esegui` con il gettone. Il gettone vale solo per la stessa persona, lo stesso strumento e gli stessi argomenti, una volta sola, per 15 minuti. Senza la scheda non si esegue niente, nemmeno chiamando le API a mano.

Gli errori tornano al modello in parole: argomenti sbagliati («args.righe[0].prezzo: obbligatorio»), un dato che manca («manca la natura: chiedila»), un permesso.

| File | |
|---|---|
| `server/moduli/lumi/registro.js` | il registro (`k.lumi`), il gettone, il controllo degli argomenti |
| `server/moduli/lumi-strumenti.js` | le rotte `/api/lumi/strumenti…` e `/api/lumi/scheda/:e` |
| `server/api.js` | crea il registro prima dei moduli e lo passa come `k.lumi` (tre righe) |
| `web/moduli/lumi/strumenti.js` | `daModuli()`: gli strumenti del server diventano strumenti di Lumi |
| `web/moduli/lumi.js` | li rilegge a ogni domanda e salva i file |
| `web/lumi/motore.js`, `interfaccia.js`, `lumi.css` | la scheda mostra gli `avvisi` |

## Gli strumenti delle fatture (`server/moduli/lumidoc.js`)

| Strumento | | Cosa fa |
|---|---|---|
| `fattura_nuova` | scrive | Prepara la fattura in bozza: il cliente per nome e le righe a parole. IVA, natura, ritenuta, cassa e bollo li deduce Kubo |
| `fattura_emetti` | scrive | La bozza prende il numero. Si ferma se l'esportazione non passerebbe |
| `fattura_nota_di_credito` | scrive | Storno totale (uguale al bottone) o parziale (righe scelte o un importo, sempre positivo), mai oltre quello che resta della fattura |
| `fattura_controlla` | legge | Gli stessi controlli dell'esportazione FatturaPA |
| `fattura_esporta_xml` | legge | Il file FatturaPA arriva al browser come download |
| `fattura_stampa` | legge | La stampa in HTML: da lì «Stampa → Salva come PDF» |
| `fatture_da_incassare` | legge | Fatture emesse non pagate, al netto di ritenuta, note di credito e rate già pagate, scadute, per cliente |
| `fatture_da_pagare` | legge | Fatture ricevute da pagare (meno le note di credito ricevute), scadute, per fornitore |

`crea_fatture` (generato dallo schema) lascia il posto a `fattura_nuova`. `modifica_fatture` resta, per le bozze e per segnare una fattura pagata. Su una fattura emessa la sua scheda non parte e il modello legge di proporre la nota di credito. Il blocco vero sta comunque nel motore dei dati (`fatture-regole.js`).

### Cosa deduce `fattura_nuova`

- **IVA**: l'aliquota dell'azienda (Documenti → Dati dell'azienda, predefinita 22%). Un'aliquota diversa da 4, 5, 10 e 22% passa, ma con un avviso (DPR 633/72, art. 16 e Tabella A).
- **Senza IVA** in regime ordinario: serve la natura. Se il modello non la dice, lo strumento risponde di chiederla e di non sceglierla da sé.
- **Forfettario** (RF19): righe a 0% con natura N2.2 e niente ritenuta (L. 190/2014, art. 1 c. 58 e 67).
- **Ritenuta e cassa**: quelle dette dalla persona, altrimenti come nell'ultima fattura emessa (prima allo stesso cliente). La scheda lo dice. Mai la ritenuta verso un privato, che non è sostituto d'imposta. Senza la causale del 770 Lumi la chiede.
- **Bollo**: 2 € quando le operazioni senza IVA superano 77,47 €, di solito addebitato al cliente (regola e fonte in `documenti-calcoli.js`).
- **Controlli dello SDI**: quelli di `controlla()` (`documenti-xml.js`), come se la fattura fosse già emessa. Vanno nella scheda come avvisi, prima della conferma.

### La scheda di conferma

Mostra cliente, righe con quantità, prezzo e IVA, imponibile, IVA, contributo cassa, bollo, totale, ritenuta e il netto da incassare. Le etichette e gli avvisi sono nella lingua di chi guarda (chiavi `lumidoc-…` nei cataloghi del server). Quello che legge solo il modello resta in italiano.

## Le istruzioni al modello

Il modulo aggiunge quattro righe alle istruzioni di Lumi:

- come si usano gli strumenti;
- non inventare mai partite IVA, codici fiscali, codici destinatario, aliquote, nature, causali o codici tributo: se manca un dato, chiederlo;
- una fattura emessa si corregge con la nota di credito;
- quando serve un professionista (visto di conformità, dichiarazioni per conto terzi, scelta del regime, concordato, ravvedimenti, bilanci, consulenza), dirlo con una frase chiara.

## Prove

`test/lumidoc.test.mjs`, senza rete, con il finto Claude di `test/lumi.test.mjs`:

- il contratto da solo (registrazione, permessi, gettone, errori);
- l'inventario e il limite del server di Lumi;
- le cinque frasi, più «emettila», la nota parziale, lo storno oltre il totale, la modifica a parole di una fattura emessa;
- l'XML validato con `xmllint` contro lo schema ufficiale;
- la scheda in inglese;
- i permessi del ruolo «Solo lettura».

In `test/prova-lumi-documenti.test.mjs` il vecchio todo sulla scheda ora passa.

## Cosa manca

- **Mandare la fattura** (email/PEC/SDI): non c'è ancora un connettore di posta. Lumi lo dice e propone di salvare il file.
- Nelle **fatture da incassare**, oltre 500 fatture aperte le rate già pagate non si tolgono (lo strumento lo dice).
- **Ritenuta e cassa** si deducono dalla storia, non da un'impostazione dell'azienda: la prima fattura con la ritenuta va detta a parole.
