# Contratti ricorrenti

Canoni, manutenzioni, assistenza, abbonamenti. Il contratto si scrive una volta: cliente, descrizione, importo per periodo, IVA e periodicità. Poi Lumi prepara le fatture quando scadono. È la lacuna numero 8 del [confronto](ricerca/CONFRONTO.md).

## Dove sta

| file | cosa fa |
|---|---|
| `server/moduli/ricorrenti.js` | la sezione, i periodi dovuti, la creazione delle fatture, il giro automatico, le rotte e Lumi |
| `web/moduli/ricorrenti.js` e `.css` | la pagina `#/ricorrenti` e il bottone «Fatture dovute» nella lista dei contratti |
| `web/lingue/<codice>/ricorrenti.js`, `server/moduli/lingue/<codice>.js` (`ric-modello`) | i testi |
| `test/ricorrenti.test.mjs` | le prove |

## Come funziona

**Aggiungi i contratti ricorrenti** (`POST /api/ricorrenti/prepara`, serve il modello fatture) crea la sezione `contratti_ricorrenti`. Ogni contratto ha:

- numero `CR-AAAA-NNN`;
- cliente, descrizione, importo senza IVA, IVA %;
- periodicità: mensile, bimestrale, trimestrale, semestrale o annuale;
- la data della **prossima fattura** e, se c'è, la data di fine («fino al»);
- uno stato: attivo, sospeso o chiuso;
- come nascono le fatture: **in bozza**, da controllare (è il valore predefinito), oppure **già emesse**.

**Genera** (`POST /api/ricorrenti/genera`) crea una fattura per ogni periodo dovuto fino a oggi. I periodi arretrati si recuperano tutti, fino a 24. Ogni fattura ha:

- la data del periodo;
- la riga «descrizione - periodo dal 01/10/2026 al 31/10/2026»;
- il riferimento «Contratto CR-…».

Poi la prossima data va avanti. Quando supera la data di fine, il contratto passa a «chiuso». Le fatture passano dal modulo fatture, con la sua numerazione, i suoi conti e il blocco dopo l'emissione.

**Giro automatico.** È spento finché non lo accendi dalla pagina: «Ogni giorno crea da solo le fatture dovute». Lumi controlla ogni ora e crea le fatture una volta al giorno.

**Previsione di cassa.** Le fatture future dei contratti attivi entrano nella [previsione della tesoreria](TESORERIA.md) come incassi, IVA compresa, alla data della fattura.

## Lumi

| strumento | tipo | per |
|---|---|---|
| `ricorrenti_dovuti` | leggi | «quali canoni devo fatturare?» |
| `ricorrenti_genera` | scrivi | «fai le fatture dei contratti», con la scheda di tutte le fatture prima del Conferma |

## Cosa non fa ancora

- La rivalutazione ISTAT dei canoni e gli aumenti programmati.
- L'addebito SDD automatico delle fatture dei contratti. Oggi si mettono in una distinta SDD dalla tesoreria.
- Le fatture anticipate o posticipate rispetto al periodo (oggi la fattura ha la data di inizio del periodo).
