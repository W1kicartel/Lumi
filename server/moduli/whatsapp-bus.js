// Il filo fra i connettori WhatsApp (connettori/whatsapp, twilio-whatsapp, 360dialog) e il modulo server/moduli/whatsapp.js.
// Un file senza dipendenze: il connettore lo importa senza tirarsi dietro il nucleo (che lo sta caricando: si bloccherebbe).
// db → { ricevi(provider, eventi), lavora(corpo) }
export const bus = new WeakMap();
export const PROVIDER = ['whatsapp', 'twilio-whatsapp', 'dialog360'];
