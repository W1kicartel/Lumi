// Aiuti per i connettori dei compiti (Todoist, Trello, Asana): una riga NUOVA di attività, interventi o commesse diventa
// un compito nel servizio, una volta sola (l'abbinamento riga↔compito sta in k.sincro: le modifiche dopo non ne creano altri).
// Il compito porta cliente, note, scadenza e il link alla riga di Kubo se c'è l'indirizzo pubblico.
import { testo } from './tabelle.js';

export const SEZIONI = ['attivita', 'interventi', 'commesse'];
const NOMI = { attivita: 'Attività', interventi: 'Interventi', commesse: 'Commesse' };
export const permessiCompiti = Object.fromEntries(SEZIONI.map(s => [s, { leggi: true }]));
export const impostazioniCompiti = () => [
  ...SEZIONI.map(s => ({ id: `da_${s}`, nome: `Ogni riga nuova di «${NOMI[s]}» diventa un compito`, tipo: 'si_no', predefinito: false })),
  { id: 'pubblico', nome: 'Indirizzo pubblico di Kubo (facoltativo: il compito porta il link alla riga)', tipo: 'url', obbligatorio: false },
];
const T = {
  en: ['Every new «Activities» row becomes a task', 'Every new «Jobs» row becomes a task', 'Every new «Orders» row becomes a task', 'Public Kubo address (optional: the task links to the row)', 'Create a task'],
  es: ['Cada fila nueva de «Actividades» se convierte en tarea', 'Cada fila nueva de «Intervenciones» se convierte en tarea', 'Cada fila nueva de «Encargos» se convierte en tarea', 'Dirección pública de Kubo (opcional: la tarea enlaza la fila)', 'Crear una tarea'],
  fr: ['Chaque nouvelle ligne « Activités » devient une tâche', 'Chaque nouvelle ligne « Interventions » devient une tâche', 'Chaque nouvelle ligne « Commandes » devient une tâche', 'Adresse publique de Kubo (facultatif : la tâche pointe vers la ligne)', 'Créer une tâche'],
  de: ['Jede neue Zeile in „Aufgaben“ wird ein Task', 'Jede neue Zeile in „Einsätze“ wird ein Task', 'Jede neue Zeile in „Aufträge“ wird ein Task', 'Öffentliche Kubo-Adresse (optional: der Task verlinkt die Zeile)', 'Task anlegen'],
  pt: ['Cada linha nova de «Atividades» vira uma tarefa', 'Cada linha nova de «Intervenções» vira uma tarefa', 'Cada linha nova de «Encomendas» vira uma tarefa', 'Endereço público do Kubo (opcional: a tarefa leva o link da linha)', 'Criar uma tarefa'],
};
// i testi comuni nelle 5 lingue, da unire ai testi del connettore
export const testiCompiti = Object.fromEntries(Object.entries(T).map(([l, t]) => [l, { 'imp.da_attivita': t[0], 'imp.da_interventi': t[1], 'imp.da_commesse': t[2], 'imp.pubblico': t[3], 'az.crea_compito': t[4] }]));
export const unisciTesti = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(l => [l, { ...(b[l] || {}), ...(a[l] || {}) }]));

export function linkDi(k, sem, riga) {
  const b = String(k.imp.pubblico || '').trim().replace(/\/+$/, '');
  return b && riga?.id ? `${b}/#/e/${k.entita(sem)}/${riga.id}` : null;
}
const giorno = v => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
// una riga di Kubo come compito: { titolo, note, scadenza (AAAA-MM-GG o null), link }
export function compitoDi(k, sem, r) {
  const v = c => k.valore(r, sem, c), cliente = testo(v('cliente')), num = v('numero') != null ? ` ${v('numero')}` : '';
  let titolo, note, scadenza;
  if (sem === 'interventi') { const mezzo = testo(v('mezzo')); titolo = `Intervento${num}${mezzo ? ' · ' + mezzo : ''}`; note = v('problema'); scadenza = v('consegna_prevista'); }
  else if (sem === 'commesse') { titolo = `Commessa${num}${v('titolo') ? ' · ' + v('titolo') : ''}`; note = v('note'); scadenza = v('consegna'); }
  else { titolo = v('titolo') || 'Attività'; note = v('note'); scadenza = v('scadenza'); }
  const link = linkDi(k, sem, r);
  return { titolo: String(titolo).slice(0, 500), note: [cliente && `Cliente: ${cliente}`, note && String(note), link && `Kubo: ${link}`].filter(Boolean).join('\n'), scadenza: giorno(scadenza), link };
}
// l'«uscita» del manifesto: crea(k, compito) → id remoto. Solo le sezioni accese, solo le righe non ancora abbinate
export function uscitaCompiti(crea) {
  return Object.fromEntries(SEZIONI.map(sem => [sem, {
    quando: (r, k) => k.imp[`da_${sem}`] === true && !k.sincro.remoto(sem, r.id),
    invia: async (r, k) => {
      if (k.sincro.remoto(sem, r.id)) return;
      const id = await crea(k, compitoDi(k, sem, r)); if (id) k.sincro.collega(sem, r.id, id);
    },
  }]));
}
// un giorno «AAAA-MM-GG» da un testo libero, se c'è (per i servizi che non capiscono «venerdì»)
export const dataDi = s => giorno(String(s || '').trim()) || (/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(s || '').trim()) || []).slice(1).reverse().map(x => x.padStart(2, '0')).join('-') || null;
