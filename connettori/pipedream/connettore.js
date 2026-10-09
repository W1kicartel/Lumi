// Pipedream: il trigger «HTTP / Webhook» riceve gli eventi di Lumi; un passo HTTP scrive in Lumi.
// Un ponte verso una piattaforma di automazione: lo stesso motore di ricette del connettore HTTP (server/moduli/connettori-ricette.js),
// con gli indirizzi completi che dà la piattaforma. In entrata: POST JSON a /api/connettori/pipedream/in/<codice>[?ricetta=<id>].
import { manifestoRicette, testiRicette } from '../../server/moduli/connettori-ricette.js';

export default {
  id: 'pipedream', nome: 'Pipedream', versione: 1, icona: 'ingranaggio',
  descrizione: 'Lumi nei workflow di Pipedream: eventi verso Pipedream e righe create o aggiornate dai tuoi passi.',
  catalogo: { categoria: 'automazione', sito: 'https://pipedream.com', costo: 'gratis', costoNota: 'Il piano Free ha crediti limitati al mese; oltre serve un piano a pagamento', serve: [{ cosa: 'L\'indirizzo del trigger HTTP (https://….m.pipedream.net)', dove: 'Pipedream → nuovo workflow → trigger «HTTP / Webhook» → «New Requests»', link: 'https://pipedream.com/docs/workflows/building-workflows/triggers/' }], passi: ['In Pipedream crea un workflow con il trigger «HTTP / Webhook» → «New Requests»', 'Copia l\'indirizzo che ti dà Pipedream', 'Qui aggiungi una ricetta «in uscita»: scegli la sezione e gli eventi, incolla l\'indirizzo', 'Accendi e crea una riga in Lumi: l\'evento compare nel trigger di Pipedream', 'Per scrivere in Lumi dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all\'indirizzo che compare sotto (Lumi deve essere raggiungibile da internet): in Pipedream aggiungi un passo «HTTP / Webhook» → «Send any HTTP Request», metodo POST', 'Fai il deploy del workflow'], difficolta: 'media', zone: ['IT', 'UE', 'mondo'], fonti: ['https://pipedream.com/docs/workflows/building-workflows/triggers/', 'https://pipedream.com/docs/'], prova: 'finto', parole: ['workflow', 'automazione', 'webhook', 'serverless', 'automation'] },
  ...manifestoRicette({ accesso: false }),
  testi: testiRicette({
    en: { descrizione: 'Lumi in Pipedream workflows: events to Pipedream and rows created or updated by your steps.', 'cat.costoNota': 'The Free plan has limited credits per month; beyond that you need a paid plan',
      'cat.serve': [{ cosa: 'The HTTP trigger address (https://….m.pipedream.net)', dove: 'Pipedream → new workflow → «HTTP / Webhook» trigger → «New Requests»' }],
      'cat.passi': ['In Pipedream create a workflow with the «HTTP / Webhook» → «New Requests» trigger', 'Copy the address Pipedream gives you', 'Here add an «outgoing» recipe: pick the section and the events, paste the address', 'Switch it on and create a row in Lumi: the event shows up in the Pipedream trigger', 'To write into Lumi from the platform: add an «incoming» recipe and have it send a JSON POST to the address shown under it (Lumi must be reachable from the internet): in Pipedream add a step «HTTP / Webhook» → «Send any HTTP Request», method POST', 'Deploy the workflow'] },
    es: { descrizione: 'Lumi en los workflows de Pipedream: eventos hacia Pipedream y filas creadas o actualizadas por tus pasos.' },
    fr: { descrizione: 'Lumi dans les workflows Pipedream : des événements vers Pipedream et des lignes créées ou mises à jour par vos étapes.' },
    de: { descrizione: 'Lumi in Pipedream-Workflows: Ereignisse an Pipedream und Zeilen, die deine Schritte anlegen oder aktualisieren.' },
    pt: { descrizione: 'O Lumi nos workflows do Pipedream: eventos para o Pipedream e linhas criadas ou atualizadas pelos seus passos.' },
  }),
};
