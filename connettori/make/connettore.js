// Make: il modulo «Webhooks → Custom webhook» riceve gli eventi di Lumi; il modulo «HTTP → Make a request» scrive in Lumi.
// Un ponte verso una piattaforma di automazione: lo stesso motore di ricette del connettore HTTP (server/moduli/connettori-ricette.js),
// con gli indirizzi completi che dà la piattaforma. In entrata: POST JSON a /api/connettori/make/in/<codice>[?ricetta=<id>].
import { manifestoRicette, testiRicette } from '../../server/moduli/connettori-ricette.js';

export default {
  id: 'make', nome: 'Make', versione: 1, icona: 'ingranaggio',
  descrizione: 'Lumi negli scenari di Make: un evento in una sezione avvia uno scenario, e uno scenario crea o aggiorna righe in Lumi.',
  catalogo: { categoria: 'automazione', sito: 'https://www.make.com', costo: 'gratis', costoNota: 'Il piano Free ha un numero limitato di operazioni al mese; oltre serve un piano a pagamento', serve: [{ cosa: 'L\'indirizzo del Custom webhook (https://hook.<zona>.make.com/…)', dove: 'Make → scenario → modulo «Webhooks» → «Custom webhook» → Aggiungi', link: 'https://www.make.com/en/help/tools/webhooks' }], passi: ['In Make crea uno scenario e come primo modulo scegli «Webhooks» → «Custom webhook»', 'Premi «Aggiungi», dai un nome al webhook e copia l\'indirizzo', 'Qui aggiungi una ricetta «in uscita»: scegli la sezione e gli eventi, incolla l\'indirizzo', 'Accendi, premi «Run once» in Make e crea una riga in Lumi: Make impara la struttura dei dati', 'Per scrivere in Lumi dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all\'indirizzo che compare sotto (Lumi deve essere raggiungibile da internet): in Make usa il modulo «HTTP» → «Make a request», metodo POST, corpo JSON', 'Attiva lo scenario'], difficolta: 'facile', zone: ['IT', 'UE', 'mondo'], fonti: ['https://www.make.com/en/help/tools/webhooks', 'https://www.make.com/en/help/app/http'], prova: 'finto', parole: ['integromat', 'scenario', 'automazione', 'webhook', 'no-code', 'automation'] },
  ...manifestoRicette({ accesso: false }),
  testi: testiRicette({
    en: { descrizione: 'Lumi in Make scenarios: an event in a section starts a scenario, and a scenario creates or updates rows in Lumi.', 'cat.costoNota': 'The Free plan has a limited number of operations per month; beyond that you need a paid plan',
      'cat.serve': [{ cosa: 'The Custom webhook address (https://hook.<zone>.make.com/…)', dove: 'Make → scenario → «Webhooks» module → «Custom webhook» → Add' }],
      'cat.passi': ['In Make create a scenario and pick «Webhooks» → «Custom webhook» as the first module', 'Press «Add», name the webhook and copy the address', 'Here add an «outgoing» recipe: pick the section and the events, paste the address', 'Switch it on, press «Run once» in Make and create a row in Lumi: Make learns the data structure', 'To write into Lumi from the platform: add an «incoming» recipe and have it send a JSON POST to the address shown under it (Lumi must be reachable from the internet): in Make use the «HTTP» → «Make a request» module, method POST, JSON body', 'Turn the scenario on'] },
    es: { descrizione: 'Lumi en los escenarios de Make: un evento en una sección inicia un escenario, y un escenario crea o actualiza filas en Lumi.' },
    fr: { descrizione: 'Lumi dans les scénarios Make : un événement dans une section lance un scénario, et un scénario crée ou met à jour des lignes dans Lumi.' },
    de: { descrizione: 'Lumi in Make-Szenarien: ein Ereignis in einem Bereich startet ein Szenario, und ein Szenario legt Zeilen in Lumi an oder aktualisiert sie.' },
    pt: { descrizione: 'O Lumi nos cenários do Make: um evento numa seção inicia um cenário, e um cenário cria ou atualiza linhas no Lumi.' },
  }),
};
