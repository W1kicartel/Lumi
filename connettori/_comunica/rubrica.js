// I clienti nella rubrica del telefono (CardDAV, Google Contatti): quando un cliente chiama, il telefono mostra il nome.
// Una via sola, da Kubo alla rubrica: le schede che Kubo crea sono sue (UID «kubo-<id>») e un cambio in Kubo le riscrive.
import { e164, telefonoDi, nomeDi, modificateDopo, nomeCognome } from './telefono.js';

// i dati di contatto di un cliente, o null se non ha né telefono né email
export function contattoDi(k, c) {
  const nome = nomeDi(k, c), tel = e164(telefonoDi(k, c), String(k.imp.prefisso || '39')), email = k.valore(c, 'clienti', 'email') || null;
  if (!nome || (!tel && !email)) return null;
  const [n, cg] = nomeCognome(nome);
  return { id: c.id, nome, n, cg, tel, email, azienda: k.imp.etichetta || null };
}
// vCard 3.0 (RFC 2426): va con iCloud, Nextcloud, Fastmail, Synology
const v = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export const vcard = x => ['BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Kubo//Rubrica//IT', `UID:kubo-${x.id}`, `FN:${v(x.nome)}`, `N:${v(x.cg)};${v(x.n)};;;`,
  ...(x.tel ? [`TEL;TYPE=CELL:${x.tel}`] : []), ...(x.email ? [`EMAIL;TYPE=INTERNET:${v(x.email)}`] : []), ...(x.azienda ? [`CATEGORIES:${v(x.azienda)}`] : []), 'END:VCARD', ''].join('\r\n');

// le impostazioni e il giro comuni
export const impRubrica = [
  { id: 'etichetta', nome: 'Etichetta dei contatti (es. «Clienti»)', predefinito: 'Clienti Kubo', obbligatorio: false },
  { id: 'prefisso', nome: 'Prefisso del paese per i numeri senza prefisso', predefinito: '39', schema: /^\d{1,4}$/ },
];
export function giroRubrica(metti) {
  return { nome: 'Tutti i clienti in rubrica', alle: '04:00', async giro(k) {
    const dal = k.stato.leggi('rubrica_dal') || ''; let ultimo = dal, n = 0, saltati = 0;
    for (const c of modificateDopo(k, 'clienti', dal)) {
      const x = contattoDi(k, c); if (x) { await metti(k, x); n++; } else saltati++;
      ultimo = c.modificato || ultimo; k.stato.scrivi('rubrica_dal', ultimo);   // un giro fermato a metà riparte da qui
    }
    return { scritti: n, saltati };
  } };
}
export const uscitaRubrica = metti => ({ clienti: { campi: ['nome', 'telefono', 'email'], async invia(r, k) { const x = contattoDi(k, r); if (x) await metti(k, x); } } });
export const testiRubrica = {
  en: { 'imp.etichetta': 'Contact label (e.g. «Customers»)', 'imp.prefisso': 'Default country code', 'giro.tutti': 'All customers in the address book' },
  es: { 'imp.etichetta': 'Etiqueta de los contactos (p. ej. «Clientes»)', 'imp.prefisso': 'Prefijo de país predeterminado', 'giro.tutti': 'Todos los clientes en la agenda' },
  fr: { 'imp.etichetta': 'Étiquette des contacts (ex. « Clients »)', 'imp.prefisso': 'Indicatif pays par défaut', 'giro.tutti': 'Tous les clients dans le carnet d\'adresses' },
  de: { 'imp.etichetta': 'Kontaktbezeichnung (z. B. „Kunden“)', 'imp.prefisso': 'Standard-Ländervorwahl', 'giro.tutti': 'Alle Kunden im Adressbuch' },
  pt: { 'imp.etichetta': 'Etiqueta dos contatos (ex. «Clientes»)', 'imp.prefisso': 'Indicativo do país padrão', 'giro.tutti': 'Todos os clientes na agenda' },
};
