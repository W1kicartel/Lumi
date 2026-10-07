// Posta e PEC: manda le fatture ai clienti (con l'XML FatturaPA in allegato) e i promemoria delle fatture scadute,
// ogni mattina alle 9 (una volta per fattura). La PEC è la stessa cosa con il server SMTP della casella PEC.
import { invia } from './smtp.js';
import { xmlDi } from '../openapi-sdi/connettore.js';
const conf = k => ({ host: k.imp.host, porta: Number(k.imp.porta || 587), sicurezza: k.imp.sicurezza, utente: k.imp.utente, password: k.segreti.password, interni: k.interni() });
// le date nei messaggi ai clienti all'italiana (gg/mm/aaaa), non come le salva il database
const giorno = d => (/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')) || []).slice(1).reverse().join('/') || '—';
// una bozza o una fattura annullata non si manda: per il fisco non esiste (stessa regola dell'invio allo SDI)
export const emessa = (k, f) => { const s = k.valore(f, 'fatture', 'stato'); if (s === 'bozza' || s === 'annullata') throw new Error(`La fattura è ${s === 'bozza' ? 'ancora una bozza' : 'annullata'}: non si manda`); };
const destinatario = (k, f) => { if (!f.cliente?.id) return null; try { const c = k.dati.leggi('clienti', f.cliente.id); return k.valore(c, 'clienti', 'email') || null; } catch { return null; } };
export default {
  id: 'posta', nome: 'Email e PEC', versione: 1, icona: 'documento',
  descrizione: 'Manda fatture e promemoria ai clienti dalla tua casella email o PEC.',
  impostazioni: [
    { id: 'host', nome: 'Server SMTP (es. smtps.pec.aruba.it)' }, { id: 'porta', nome: 'Porta', tipo: 'numero', predefinito: 587 },
    { id: 'sicurezza', nome: 'Sicurezza', tipo: 'scelta', opzioni: ['starttls', 'tls', 'nessuna'], predefinito: 'starttls' },
    { id: 'utente', nome: 'Utente' }, { id: 'password', nome: 'Password (o password per app)', segreto: true },
    { id: 'mittente', nome: 'Mittente (es. Bottega Rossi <info@bottega.it>)' },
  ],
  richiede: { fatture: { numero: {}, data: { tipo: 'data' }, stato: { tipo: 'stato' }, scadenza: { tipo: 'data', facoltativo: true }, cliente: { tipo: 'relazione' } }, clienti: { email: { tipo: ['email'] } } },
  permessi: { fatture: { leggi: true }, clienti: { leggi: true } },
  prova: async k => { await invia(conf(k)); return { ok: true }; },
  azioni: {
    invia_fattura: {
      nome: 'Manda per email', descrizione: 'Manda la fattura al cliente per email, con l\'XML in allegato', su: 'fatture', lumi: true, scrive: true,
      input: { fattura: { tipo: 'relazione', entita: 'fatture', nome: 'La fattura' } },
      proponi: async ({ fattura }, k) => { const a = destinatario(k, fattura), no = (() => { try { emessa(k, fattura); return null; } catch (e) { return e.message; } })();
        return { titolo: 'Fattura per email', righe: [['Fattura', fattura.numero], ['A', a || '—'], ['Totale', k.euro(fattura.totale)]], avvisi: [...(a ? [] : ['Il cliente non ha un indirizzo email']), ...(no ? [no] : [])] }; },
      async esegui({ fattura }, k) {
        emessa(k, fattura); const a = destinatario(k, fattura); if (!a) throw new Error('Il cliente non ha un indirizzo email');
        let allegati = []; try { const x = xmlDi(k, fattura); allegati = [{ nome: x.nome, tipo: 'application/xml', contenuto: x.xml }]; } catch { allegati = []; }
        await invia(conf(k), { da: k.imp.mittente, a, oggetto: `Fattura ${fattura.numero} del ${giorno(fattura.data)}`, testo: `Buongiorno,\nin allegato la fattura ${fattura.numero} del ${giorno(fattura.data)}, totale ${k.euro(fattura.totale)}.\n\nGrazie.`, allegati });
        return { a };
      },
    },
  },
  pianificati: { promemoria: { nome: 'Promemoria delle fatture scadute', alle: '09:00', async giro(k) {
    if (!k.campo('fatture', 'scadenza')) return { mandati: 0 };
    const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: k.fuso() }), fatti = new Set(k.stato.leggi('ricordate') || []); let n = 0;
    for (const f of k.dati.elenca('fatture', { filtri: [{ campo: 'stato', op: '=', valore: 'emessa' }, { campo: 'scadenza', op: '<', valore: oggi }], perPagina: 200 }).righe) {
      const a = destinatario(k, f); if (!a || fatti.has(f.id)) continue;
      await invia(conf(k), { da: k.imp.mittente, a, oggetto: `Promemoria: fattura ${f.numero}`, testo: `Buongiorno,\nla fattura ${f.numero} del ${giorno(f.data)} (${k.euro(f.totale)}) risulta scaduta il ${giorno(k.valore(f, 'fatture', 'scadenza'))}.\nSe l'ha già pagata, non tenga conto di questo messaggio.\n\nGrazie.` });
      // segnata subito: se la casella si ferma a metà giro, domani non riparte un secondo promemoria a chi l'ha già avuto
      fatti.add(f.id); n++; k.stato.scrivi('ricordate', [...fatti].slice(-5000));
    }
    return { mandati: n };
  } } },
  testi: {
    en: { nome: 'Email and PEC', descrizione: 'Send invoices and reminders to customers from your email or PEC mailbox.', 'imp.host': 'SMTP server (e.g. smtps.pec.aruba.it)', 'imp.porta': 'Port', 'imp.sicurezza': 'Security', 'imp.utente': 'User', 'imp.password': 'Password (or app password)', 'imp.mittente': 'Sender (e.g. Rossi Shop <info@shop.it>)', 'az.invia_fattura': 'Send by email', 'giro.promemoria': 'Overdue invoice reminders' },
    es: { nome: 'Email y PEC', descrizione: 'Envía facturas y recordatorios a los clientes desde tu correo o PEC.', 'imp.host': 'Servidor SMTP (p. ej. smtps.pec.aruba.it)', 'imp.porta': 'Puerto', 'imp.sicurezza': 'Seguridad', 'imp.utente': 'Usuario', 'imp.password': 'Contraseña (o contraseña de aplicación)', 'imp.mittente': 'Remitente (p. ej. Tienda Rossi <info@tienda.it>)', 'az.invia_fattura': 'Enviar por email', 'giro.promemoria': 'Recordatorios de facturas vencidas' },
    fr: { nome: 'E-mail et PEC', descrizione: 'Envoyez factures et rappels aux clients depuis votre boîte e-mail ou PEC.', 'imp.host': 'Serveur SMTP (ex. smtps.pec.aruba.it)', 'imp.porta': 'Port', 'imp.sicurezza': 'Sécurité', 'imp.utente': 'Utilisateur', 'imp.password': 'Mot de passe (ou mot de passe d\'application)', 'imp.mittente': 'Expéditeur (ex. Boutique Rossi <info@boutique.it>)', 'az.invia_fattura': 'Envoyer par e-mail', 'giro.promemoria': 'Rappels des factures échues' },
    de: { nome: 'E-Mail und PEC', descrizione: 'Sende Rechnungen und Erinnerungen an Kunden aus deinem E-Mail- oder PEC-Postfach.', 'imp.host': 'SMTP-Server (z. B. smtps.pec.aruba.it)', 'imp.porta': 'Port', 'imp.sicurezza': 'Sicherheit', 'imp.utente': 'Benutzer', 'imp.password': 'Passwort (oder App-Passwort)', 'imp.mittente': 'Absender (z. B. Laden Rossi <info@laden.it>)', 'az.invia_fattura': 'Per E-Mail senden', 'giro.promemoria': 'Erinnerungen an überfällige Rechnungen' },
    pt: { nome: 'Email e PEC', descrizione: 'Envie faturas e lembretes aos clientes pela sua caixa de email ou PEC.', 'imp.host': 'Servidor SMTP (ex. smtps.pec.aruba.it)', 'imp.porta': 'Porta', 'imp.sicurezza': 'Segurança', 'imp.utente': 'Usuário', 'imp.password': 'Senha (ou senha de app)', 'imp.mittente': 'Remetente (ex. Loja Rossi <info@loja.it>)', 'az.invia_fattura': 'Enviar por email', 'giro.promemoria': 'Lembretes de faturas vencidas' },
  },
};
