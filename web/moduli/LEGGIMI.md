# Moduli dell'interfaccia

Ogni file `*.js` di questa cartella esporta di default un oggetto. L'app lo carica dopo l'accesso. I campi dell'oggetto, tutti facoltativi:

- `nome`;
- `avvio(k)`, per le cose sempre presenti, come la pillola di Lumi;
- `lato(k)`, che restituisce le voci della barra laterale: `[{ href: '#/agenda', icona: 'calendario', nome: 'Agenda', sezione? }]`;
- `rotte: { agenda: (contenuto, k, a, b) => … }`, per gestire `#/agenda/a/b` riempiendo `contenuto` (`.testa` e `.corpo`, come le altre viste);
- `azioniLista(def, k)`, che restituisce i bottoni da mettere in testa alla lista di un'entità;
- `azioniScheda(def, riga, k)`, che restituisce i bottoni da mettere in testa alla scheda di una riga (per esempio «Stampa»).

`k = { stato, schema, ricaricaSchema, h, api, get, toast, icona }`. Gli stili del modulo vanno in un suo `<style>` (prefisso delle classi = nome del modulo) oppure in `web/moduli/<nome>.css`.
