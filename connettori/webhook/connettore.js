// Webhook generico: gli eventi di Kubo verso qualsiasi indirizzo, firmati come i webhook di Kubo (X-Kubo-Firma); POST JSON in entrata con il codice segreto.
// Un ponte verso una piattaforma di automazione: lo stesso motore di ricette del connettore HTTP (server/moduli/connettori-ricette.js),
// con gli indirizzi completi che dà la piattaforma. In entrata: POST JSON a /api/connettori/webhook/in/<codice>[?ricetta=<id>].
import { manifestoRicette, testiRicette } from '../../server/moduli/connettori-ricette.js';

export default {
  id: 'webhook', nome: 'Webhook', versione: 1, icona: 'ingranaggio',
  descrizione: 'Webhook generici: gli eventi di una sezione verso qualsiasi indirizzo, firmati, e un indirizzo segreto per scrivere in Kubo.',
  catalogo: { categoria: 'automazione', sito: 'https://www.rfc-editor.org/rfc/rfc9110', costo: 'gratis', costoNota: 'Gratis: serve solo un server che riceve le richieste', serve: [{ cosa: 'L\'indirizzo che riceve i POST (il tuo server o un servizio)', dove: 'Chi ha scritto il programma che riceve' }, { cosa: 'Un segreto per la firma, se chi riceve la controlla (lo inventi tu)', dove: 'In questa pagina, «Segreto per firmare le richieste in uscita»' }], passi: ['Aggiungi una ricetta «in uscita»: sezione, eventi e indirizzo completo', 'Lascia il corpo vuoto per mandare tutto l\'evento, o scrivi un JSON con i segnaposto come {email}', 'Se chi riceve controlla la firma, inventa un segreto e scrivilo qui: Kubo manda X-Kubo-Tempo e X-Kubo-Firma (sha256 su «tempo.corpo»)', 'Per scrivere in Kubo dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all\'indirizzo che compare sotto (Kubo deve essere raggiungibile da internet)', 'Accendi e guarda il registro: ogni consegna fallita si riprova da sola'], difficolta: 'media', zone: ['IT', 'UE', 'mondo'], fonti: ['https://www.rfc-editor.org/rfc/rfc9110', 'https://www.rfc-editor.org/rfc/rfc2104'], prova: 'finto', parole: ['webhook', 'hmac', 'post', 'json', 'eventi', 'callback', 'smanettoni'] },
  ...manifestoRicette({ accesso: false }),
  testi: testiRicette({
    en: { descrizione: 'Generic webhooks: a section\'s events to any address, signed, and a secret address to write into Kubo.', 'cat.costoNota': 'Free: you only need a server that receives the requests',
      'cat.serve': [{ cosa: 'The address that receives the POSTs (your server or a service)', dove: 'Whoever wrote the receiving program' }, { cosa: 'A signing secret, if the receiver checks it (you make it up)', dove: 'On this page, «Secret to sign outgoing requests»' }],
      'cat.passi': ['Add an «outgoing» recipe: section, events and full address', 'Leave the body empty to send the whole event, or write a JSON with placeholders like {email}', 'If the receiver checks the signature, make up a secret and type it here: Kubo sends X-Kubo-Tempo and X-Kubo-Firma (sha256 over «time.body»)', 'To write into Kubo from the platform: add an «incoming» recipe and have it send a JSON POST to the address shown under it (Kubo must be reachable from the internet)', 'Switch it on and watch the log: every failed delivery is retried on its own'] },
    es: { descrizione: 'Webhooks genéricos: los eventos de una sección hacia cualquier dirección, firmados, y una dirección secreta para escribir en Kubo.' },
    fr: { descrizione: 'Webhooks génériques : les événements d\'une section vers n\'importe quelle adresse, signés, et une adresse secrète pour écrire dans Kubo.' },
    de: { descrizione: 'Generische Webhooks: Ereignisse eines Bereichs an jede Adresse, signiert, und eine geheime Adresse, um in Kubo zu schreiben.' },
    pt: { descrizione: 'Webhooks genéricos: os eventos de uma seção para qualquer endereço, assinados, e um endereço secreto para escrever no Kubo.' },
  }),
};
