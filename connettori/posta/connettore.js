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
  catalogo: { categoria: 'email', sito: 'https://www.rfc-editor.org/rfc/rfc5321', costo: 'gratis', costoNota: 'Usa la casella che hai già, email o PEC: nessun costo in più', serve: [{ cosa: 'Server SMTP, porta e sicurezza', dove: 'La guida del tuo provider (per la PEC Aruba: smtps.pec.aruba.it, porta 465, TLS)' }, { cosa: 'Utente e password (o password per le app)', dove: 'Il tuo account email; con Gmail e la verifica in due passaggi serve una password per le app', link: 'https://support.google.com/accounts/answer/185833' }], passi: ['Cerca nella guida del tuo provider i dati SMTP: server, porta e sicurezza', 'Se usi la verifica in due passaggi (Gmail, Outlook), crea una password per le app', 'Scrivi qui server, porta, sicurezza, utente e password', 'Scrivi il mittente come vuoi che lo vedano i clienti', 'Salva, prova la connessione e accendi'], difficolta: 'facile', zone: ['IT', 'UE', 'mondo'], fonti: ['https://www.rfc-editor.org/rfc/rfc5321', 'https://support.google.com/accounts/answer/185833'], prova: 'finto', parole: ['smtp', 'pec', 'posta', 'promemoria', 'gmail', 'outlook', 'aruba'] },
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
    en: { 'cat.costoNota': 'It uses the mailbox you already have, email or PEC: no extra cost', 'cat.serve': [{ cosa: 'SMTP server, port and security', dove: 'Your provider\'s guide (for Aruba PEC: smtps.pec.aruba.it, port 465, TLS)' }, { cosa: 'User and password (or app password)', dove: 'Your email account; with Gmail and 2-step verification you need an app password' }], 'cat.passi': ['Look up the SMTP details in your provider\'s guide: server, port and security', 'If you use 2-step verification (Gmail, Outlook), create an app password', 'Type server, port, security, user and password here', 'Type the sender as you want customers to see it', 'Save, test the connection and switch it on'],
      nome: 'Email and PEC', descrizione: 'Send invoices and reminders to customers from your email or PEC mailbox.', 'imp.host': 'SMTP server (e.g. smtps.pec.aruba.it)', 'imp.porta': 'Port', 'imp.sicurezza': 'Security', 'imp.utente': 'User', 'imp.password': 'Password (or app password)', 'imp.mittente': 'Sender (e.g. Rossi Shop <info@shop.it>)', 'az.invia_fattura': 'Send by email', 'giro.promemoria': 'Overdue invoice reminders' },
    es: { nome: 'Email y PEC', descrizione: 'Envía facturas y recordatorios a los clientes desde tu correo o PEC.', 'imp.host': 'Servidor SMTP (p. ej. smtps.pec.aruba.it)', 'imp.porta': 'Puerto', 'imp.sicurezza': 'Seguridad', 'imp.utente': 'Usuario', 'imp.password': 'Contraseña (o contraseña de aplicación)', 'imp.mittente': 'Remitente (p. ej. Tienda Rossi <info@tienda.it>)', 'az.invia_fattura': 'Enviar por email', 'giro.promemoria': 'Recordatorios de facturas vencidas' },
    fr: { nome: 'E-mail et PEC', descrizione: 'Envoyez factures et rappels aux clients depuis votre boîte e-mail ou PEC.', 'imp.host': 'Serveur SMTP (ex. smtps.pec.aruba.it)', 'imp.porta': 'Port', 'imp.sicurezza': 'Sécurité', 'imp.utente': 'Utilisateur', 'imp.password': 'Mot de passe (ou mot de passe d\'application)', 'imp.mittente': 'Expéditeur (ex. Boutique Rossi <info@boutique.it>)', 'az.invia_fattura': 'Envoyer par e-mail', 'giro.promemoria': 'Rappels des factures échues' },
    de: { nome: 'E-Mail und PEC', descrizione: 'Sende Rechnungen und Erinnerungen an Kunden aus deinem E-Mail- oder PEC-Postfach.', 'imp.host': 'SMTP-Server (z. B. smtps.pec.aruba.it)', 'imp.porta': 'Port', 'imp.sicurezza': 'Sicherheit', 'imp.utente': 'Benutzer', 'imp.password': 'Passwort (oder App-Passwort)', 'imp.mittente': 'Absender (z. B. Laden Rossi <info@laden.it>)', 'az.invia_fattura': 'Per E-Mail senden', 'giro.promemoria': 'Erinnerungen an überfällige Rechnungen' },
    pt: { nome: 'Email e PEC', descrizione: 'Envie faturas e lembretes aos clientes pela sua caixa de email ou PEC.', 'imp.host': 'Servidor SMTP (ex. smtps.pec.aruba.it)', 'imp.porta': 'Porta', 'imp.sicurezza': 'Segurança', 'imp.utente': 'Usuário', 'imp.password': 'Senha (ou senha de app)', 'imp.mittente': 'Remetente (ex. Loja Rossi <info@loja.it>)', 'az.invia_fattura': 'Enviar por email', 'giro.promemoria': 'Lembretes de faturas vencidas' },
  },
};
