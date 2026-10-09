# Magazzino: movimenti, valore, inventario

È il primo pezzo del magazzino avanzato, la lacuna numero 6 del [confronto](ricerca/CONFRONTO.md). Copre tre cose:

- sapere **perché** una giacenza è cambiata;
- sapere **quanto vale** il magazzino;
- **contare** la merce e correggere le giacenze senza errori.

Funziona su ogni sezione con il campo `giacenza`: articoli, ricambi, materiali, ingredienti, prodotti.

## Dove sta

| file | cosa fa |
|---|---|
| `server/moduli/magazzino.js` | registro dei movimenti (ascoltatore di `dati.js`), valore, inventari con conte e chiusura, rotte e strumenti di Lumi |
| `web/moduli/magazzino.js` e `.css` | la pagina `#/magazzino` |
| `web/lingue/<codice>/magazzino.js`, `server/moduli/lingue/<codice>.js` (`mag-*`) | i testi e i messaggi nelle sei lingue |
| `test/magazzino.test.mjs` | le prove |

## Il registro dei movimenti

Ogni volta che la giacenza di una riga cambia, da qualsiasi strada, si scrive una riga in `_magazzino_movimenti`. Le strade sono la scheda, l'API, l'import, le automazioni (vendita pagata, ordine arrivato, consumo di materiali), i ricevimenti degli acquisti e l'inventario. La riga dice:

- l'articolo;
- quando;
- di quanto è cambiata la giacenza, con il segno;
- la giacenza dopo il cambio;
- chi l'ha cambiata;
- l'origine.

| origine | quando |
|---|---|
| `iniziale` | l'articolo nasce con una giacenza |
| `modifica` | a mano o via API (anche i ricevimenti degli acquisti) |
| `automazione` | una scrittura interna: vendite, ordini arrivati, consumi |
| `inventario` | la rettifica alla chiusura di un inventario |

Il registro lo scrive un ascoltatore di `dati.js` nella stessa transazione della modifica. Se la modifica si annulla, sparisce anche la riga. Non serve che i modelli o gli altri moduli facciano niente.

## Valore del magazzino

Il valore è **giacenza × costo** dell'articolo. Gli [acquisti](ACQUISTI.md) tengono il costo al costo medio ponderato a ogni ricevimento. La pagina mostra:

- il totale, i pezzi e gli articoli sotto scorta;
- il valore per categoria, se la sezione ha il campo `categoria`;
- il valore articolo per articolo, dal più alto.

Avvisa anche delle giacenze negative e degli articoli in giacenza senza costo, che restano fuori dal valore. **Scarica in CSV** (`GET /api/magazzino/valore.csv`) dà le rimanenze da passare al commercialista.

## Inventario fisico

1. **Inizia un inventario.** Kubo fotografa la giacenza di ogni articolo: è l'«atteso». Per ogni sezione può esserci un solo inventario aperto.
2. **Conta.** Per ogni articolo si scrive la quantità trovata. Si può anche usare il lettore di codici a barre: nel campo «Leggi un codice» ogni lettura del codice a barre (campo `barcode`) o del codice articolo (`codice`) aggiunge 1. I numeri in alto (contati, differenze, valore delle differenze) si aggiornano a ogni conta.
3. **Chiudi l'inventario.** Ogni articolo contato si corregge della **differenza fra contato e atteso**: `nuova giacenza = giacenza di adesso + (contato − atteso)`. Le vendite e i carichi fatti mentre si contava restano giusti. Gli articoli non contati non si toccano. Le rettifiche entrano nel registro con origine `inventario`.

Il valore delle differenze è (contato − atteso) × costo dell'articolo all'apertura.

## Rotte

Si legge con il permesso di leggere la sezione del magazzino; contare e chiudere chiedono il permesso di modificarla.

```
GET  /api/magazzino/sezioni
GET  /api/magazzino/valore?sezione · GET /api/magazzino/valore.csv?sezione
GET  /api/magazzino/movimenti?sezione&articolo&da&a
GET  /api/magazzino/inventari · POST /api/magazzino/inventari { sezione, nome? } · GET /api/magazzino/inventari/:id
POST /api/magazzino/inventari/:id/conta { conte: [{ articolo, contata }] } | { codice, piu? }
POST /api/magazzino/inventari/:id/chiudi
```

## Gli strumenti di Lumi

| strumento | tipo | per |
|---|---|---|
| `magazzino_valore` | leggi | «quanto vale il magazzino?», «cosa ho in negativo?» |
| `magazzino_movimenti` | leggi | «perché i quaderni sono scesi a 3?» |
| `magazzino_chiudi_inventario` | scrivi | chiude l'inventario mostrando prima tutte le differenze; scheda Conferma/Annulla |

## Cosa manca ancora (prossimo giro)

- **Più depositi e trasferimenti.** Serve una giacenza per deposito. La giacenza unica di oggi diventerebbe la somma dei depositi, e vendite e ordini indicherebbero il deposito.
- **Lotti, seriali e scadenze**, con il FEFO (prima quello che scade prima) negli scarichi.
- **FIFO e LIFO** accanto al costo medio, per la valorizzazione di fine anno.
- Il registro non dice ancora **quale documento** ha mosso la merce (quale vendita, quale ordine): oggi dice solo «automazione» o «modifica».
