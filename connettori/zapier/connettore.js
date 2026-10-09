// Zapier: «Webhooks by Zapier» (Catch Hook) riceve gli eventi di Lumi; il passo «POST» scrive in Lumi.
// Un ponte verso una piattaforma di automazione: lo stesso motore di ricette del connettore HTTP (server/moduli/connettori-ricette.js),
// con gli indirizzi completi che dà la piattaforma. In entrata: POST JSON a /api/connettori/zapier/in/<codice>[?ricetta=<id>].
import { manifestoRicette, testiRicette } from '../../server/moduli/connettori-ricette.js';

export default {
  id: 'zapier', nome: 'Zapier', versione: 1, icona: 'ingranaggio',
  descrizione: 'Lumi dentro i tuoi Zap: un evento in una sezione fa partire uno Zap, e uno Zap crea o aggiorna righe in Lumi.',
  catalogo: { categoria: 'automazione', sito: 'https://zapier.com', costo: 'abbonamento', costoNota: '«Webhooks by Zapier» è un\'app premium: serve un piano a pagamento', serve: [{ cosa: 'L\'indirizzo del Catch Hook (https://hooks.zapier.com/hooks/catch/…)', dove: 'Zapier → nuovo Zap → trigger «Webhooks by Zapier» → «Catch Hook»', link: 'https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks' }], passi: ['In Zapier crea uno Zap e scegli come trigger «Webhooks by Zapier» → «Catch Hook»', 'Copia l\'indirizzo del webhook che ti dà Zapier', 'Qui aggiungi una ricetta «in uscita»: scegli la sezione e gli eventi, incolla l\'indirizzo', 'Accendi, poi crea o modifica una riga in Lumi e premi «Test trigger» in Zapier', 'Per scrivere in Lumi dalla piattaforma: aggiungi una ricetta «in entrata» e fai mandare un POST JSON all\'indirizzo che compare sotto (Lumi deve essere raggiungibile da internet): in Zapier usa l\'azione «Webhooks by Zapier» → «POST» con Payload Type «json»', 'Pubblica lo Zap'], difficolta: 'facile', zone: ['IT', 'UE', 'mondo'], fonti: ['https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks', 'https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps'], prova: 'finto', parole: ['zap', 'automazione', 'webhook', 'no-code', 'catch hook', 'automation'] },
  ...manifestoRicette({ accesso: false }),
  testi: testiRicette({
    en: { descrizione: 'Lumi inside your Zaps: an event in a section starts a Zap, and a Zap creates or updates rows in Lumi.', 'cat.costoNota': '«Webhooks by Zapier» is a premium app: you need a paid plan',
      'cat.serve': [{ cosa: 'The Catch Hook address (https://hooks.zapier.com/hooks/catch/…)', dove: 'Zapier → new Zap → trigger «Webhooks by Zapier» → «Catch Hook»' }],
      'cat.passi': ['In Zapier create a Zap and pick «Webhooks by Zapier» → «Catch Hook» as the trigger', 'Copy the webhook address Zapier gives you', 'Here add an «outgoing» recipe: pick the section and the events, paste the address', 'Switch it on, then create or edit a row in Lumi and press «Test trigger» in Zapier', 'To write into Lumi from the platform: add an «incoming» recipe and have it send a JSON POST to the address shown under it (Lumi must be reachable from the internet): in Zapier use the action «Webhooks by Zapier» → «POST» with Payload Type «json»', 'Publish the Zap'] },
    es: { descrizione: 'Lumi dentro de tus Zaps: un evento en una sección inicia un Zap, y un Zap crea o actualiza filas en Lumi.' },
    fr: { descrizione: 'Lumi dans vos Zaps : un événement dans une section lance un Zap, et un Zap crée ou met à jour des lignes dans Lumi.' },
    de: { descrizione: 'Lumi in deinen Zaps: ein Ereignis in einem Bereich startet einen Zap, und ein Zap legt Zeilen in Lumi an oder aktualisiert sie.' },
    pt: { descrizione: 'O Lumi dentro dos seus Zaps: um evento numa seção inicia um Zap, e um Zap cria ou atualiza linhas no Lumi.' },
  }),
};
