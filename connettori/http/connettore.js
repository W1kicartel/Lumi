// HTTP / API REST: un servizio qualunque, configurato dall'interfaccia senza codice. Indirizzo base, autenticazione (chiave
// nell'intestazione o nella query, Bearer, Basic, OAuth2 client credentials) e «ricette»: in uscita su una modifica in una
// sezione, azioni (bottone e Lumi, con l'anteprima) e in entrata (un webhook con il codice nell'indirizzo e l'HMAC facoltativo).
// Il motore è server/moduli/connettori-ricette.js, lo stesso dei ponti verso Zapier, Make, n8n e Pipedream.
import { manifestoRicette, testiRicette } from '../../server/moduli/connettori-ricette.js';

export default {
  id: 'http', nome: 'HTTP / API REST', versione: 1, icona: 'ingranaggio', copie: true,   // «copie»: un secondo servizio con indirizzo, accesso e ricette suoi
  descrizione: 'Collega qualsiasi servizio con un\'API REST, senza scrivere codice: ricette in uscita, bottoni e webhook in entrata.',
  catalogo: {
    categoria: 'automazione', sito: 'https://www.rfc-editor.org/rfc/rfc9110', costo: 'gratis', costoNota: 'Gratis in Lumi: paghi solo il servizio che colleghi, se è a pagamento',
    serve: [
      { cosa: 'L\'indirizzo base dell\'API (es. https://api.servizio.it/v1)', dove: 'La documentazione per sviluppatori del servizio' },
      { cosa: 'La chiave, il token o le credenziali OAuth2', dove: 'Le impostazioni del tuo account sul servizio, di solito «API» o «Sviluppatori»' },
    ],
    passi: [
      'Cerca nella documentazione del servizio l\'indirizzo base e il tipo di autenticazione',
      'Scrivi qui l\'indirizzo base, scegli l\'autenticazione e incolla la chiave',
      'Aggiungi una ricetta: in uscita (quando cambia una riga), azione (un bottone nella scheda) o in entrata',
      'Nel percorso e nel corpo usa i segnaposto come {email} o {cliente.titolo}',
      'Per le ricette in entrata copia l\'indirizzo che compare sotto la ricetta e incollalo nel servizio',
      'Salva, prova la connessione e accendi: il registro mostra ogni richiesta partita o arrivata',
    ],
    difficolta: 'difficile', zone: ['IT', 'UE', 'mondo'],
    fonti: ['https://www.rfc-editor.org/rfc/rfc9110', 'https://www.rfc-editor.org/rfc/rfc6749#section-4.4', 'https://www.rfc-editor.org/rfc/rfc2104'],
    prova: 'finto', parole: ['api', 'rest', 'json', 'webhook', 'integrazione', 'smanettoni', 'oauth2', 'bearer', 'su misura', 'custom'],
  },
  ...manifestoRicette({ accesso: true }),
  testi: testiRicette({
    en: { descrizione: 'Connect any service with a REST API, no code: outgoing recipes, buttons and incoming webhooks.', 'cat.costoNota': 'Free in Lumi: you only pay for the service you connect, if it is paid',
      'cat.serve': [{ cosa: 'The API base address (e.g. https://api.service.com/v1)', dove: 'The service\'s developer documentation' }, { cosa: 'The key, token or OAuth2 credentials', dove: 'Your account settings on the service, usually «API» or «Developers»' }],
      'cat.passi': ['Find the base address and the authentication type in the service\'s documentation', 'Type the base address here, pick the authentication and paste the key', 'Add a recipe: outgoing (when a row changes), action (a button on the record) or incoming', 'In the path and body use placeholders like {email} or {cliente.titolo}', 'For incoming recipes copy the address shown under the recipe and paste it into the service', 'Save, test the connection and switch it on: the log shows every request sent or received'] },
    es: { descrizione: 'Conecta cualquier servicio con una API REST, sin código: recetas salientes, botones y webhooks entrantes.' },
    fr: { descrizione: 'Connectez n\'importe quel service avec une API REST, sans code : recettes sortantes, boutons et webhooks entrants.' },
    de: { descrizione: 'Verbinde jeden Dienst mit einer REST-API, ohne Code: ausgehende Rezepte, Buttons und eingehende Webhooks.' },
    pt: { descrizione: 'Conecte qualquer serviço com uma API REST, sem código: receitas de saída, botões e webhooks de entrada.' },
  }),
};
