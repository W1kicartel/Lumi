// Le lingue di Lumi. Ogni testo per chi usa il pannello sta qui, in un catalogo per lingua: il codice chiama
// t('chiave', { parametri }) e mai una frase scritta a mano. L'italiano è la lingua di partenza e di riserva: se una
// chiave manca in inglese si vede l'italiano (e test/lingua.mjs lo segnala).
// I parametri si scrivono {nome}; i plurali sono oggetti { one, other } scelti con Intl.PluralRules.
// t() NON fa l'escape: chi mette il testo nell'HTML fa l'escape dei parametri che vengono dai dati.

export const LINGUE = {
  it: { nome: 'Italiano', locale: 'it-IT', voce: 'it-IT' },
  en: { nome: 'English', locale: 'en-GB', voce: 'en-US' },
};

export const CATALOGHI = {
  it: {
    'saluto.mattina': 'Buongiorno', 'saluto.pomeriggio': 'Buon pomeriggio', 'saluto.sera': 'Buonasera',
    'saluto.nome': '{saluto}, {nome}.', 'saluto.solo': '{saluto}.',
    'stato.ordine': 'Tutto in ordine.',
    'stato.davedere': { one: 'Una cosa da vedere', other: '{n} cose da vedere' },
    'stato.urgenti': { one: ', una urgente', other: ', {n} urgenti' },
    'stato.aggiornato': '{giorno} · aggiornato alle {ora}',
    'pillola.ordine': 'Tutto in ordine',
    'pillola.davedere': '{n} da vedere',
    'pillola.aria': 'Assistente {nome}: {stato}. Passa sopra o premi {tasti}.',
    'regione': 'Assistente',
    'campo.placeholder': 'Chiedi o cerca…',
    'campo.aria': 'Chiedi o cerca',
    'campo.ascolto': 'Ti ascolto', 'campo.esc': 'Esc annulla', 'campo.attimo': 'Un attimo…',
    'campo.senzaServer': 'Demo senza AI: prova «{esempio}»',
    'mic.parla': 'Parla (oppure tieni premuto {tasti})',
    'mic.noVoce': 'La voce non è disponibile qui: si può scrivere',
    'piede.parla': 'Tieni premuto per parlare',
    'piede.conferma': 'Chiede conferma prima di ogni modifica',
    'piede.schermo': 'Schermo condiviso: niente nomi né cifre a voce',
    'vedere.titolo': 'Da vedere · {n}',
    'vedere.adesso': 'controllato adesso',
    'vedere.altre': 'e altre {n}',
    'vedere.niente': 'Niente in sospeso',
    'vedere.nienteNota': 'Non c\'è niente che aspetta',
    'vedere.apri': 'Apri',
    'drop.titolo': 'Lascia qui il file',
    'drop.nota': '{nome} lo legge: PDF, foto, Excel, Word, CSV, XML, testo',
    'file.leggo': 'leggo', 'file.pronto': 'pronto', 'file.caricato': 'caricato',
    'file.togli': 'Togli {nome}',
    'file.domanda': { one: 'Ho condiviso questo file: leggilo e dimmi in breve che cosa contiene e che cosa posso farci.', other: 'Ho condiviso questi file: leggili e dimmi in breve che cosa contengono e che cosa posso farci.' },
    'file.etichetta': { one: '{nome}', other: '{n} file' },
    'file.nonDisponibile': 'Per leggere i file serve il collegamento a Claude',
    'conferma.titolo': 'Confermi?',
    'conferma.si': 'Conferma', 'conferma.no': 'Annulla',
    'conferma.voce': 'Puoi anche dire «conferma».', 'conferma.scrivi': 'Puoi anche scrivere «sì».',
    'esito.annullato': 'Annullato.', 'esito.annullatoNota': 'Non ho cambiato niente.',
    'esito.fatto': 'Fatto.', 'esito.errore': 'Non è andata: {errore}',
    'risposta.rifiuto': 'Su questo non posso aiutarti.',
    'risposta.vuota': 'Non ho una risposta per questo: prova a chiederlo in un altro modo.',
    'risposta.lunga': 'La risposta era troppo lunga: prova a chiedere una cosa alla volta.',
    'risposta.interrotta': 'La risposta si è interrotta: riprova.',
    'risposta.irraggiungibile': 'Non riesco a raggiungere l\'assistente: controlla la connessione.',
    'risposta.errore': 'L\'assistente non ha risposto (errore {stato}).',
    'risposta.ricomincio': 'Ricomincio da capo: la conversazione era lunga.',
    'risposta.nonCapito': 'Senza Claude capisco solo poche frasi. Prova: {esempi}.',
    'avviso.collega': 'Collega Claude per le risposte vere: questa è la demo senza AI.',
    'avviso.microfono': 'Serve il permesso per il microfono',
    'avviso.noMicrofono': 'Nessun microfono collegato',
    'avviso.noVoce': 'Voce non disponibile adesso',
    'pensa.leggo': 'Guardo i dati…', 'pensa.preparo': 'Preparo la proposta…', 'pensa.mostro': 'Preparo il riepilogo…',
    'mostra.elenco': 'Elenco',
    'riassunto.annullato': 'annullato',
    'tu': 'TU',
  },
  en: {
    'saluto.mattina': 'Good morning', 'saluto.pomeriggio': 'Good afternoon', 'saluto.sera': 'Good evening',
    'saluto.nome': '{saluto}, {nome}.', 'saluto.solo': '{saluto}.',
    'stato.ordine': 'All in order.',
    'stato.davedere': { one: 'One thing to look at', other: '{n} things to look at' },
    'stato.urgenti': { one: ', one urgent', other: ', {n} urgent' },
    'stato.aggiornato': '{giorno} · updated at {ora}',
    'pillola.ordine': 'All in order',
    'pillola.davedere': '{n} to look at',
    'pillola.aria': 'Assistant {nome}: {stato}. Hover or press {tasti}.',
    'regione': 'Assistant',
    'campo.placeholder': 'Ask or search…',
    'campo.aria': 'Ask or search',
    'campo.ascolto': 'Listening', 'campo.esc': 'Esc cancels', 'campo.attimo': 'One moment…',
    'campo.senzaServer': 'Demo without AI: try “{esempio}”',
    'mic.parla': 'Speak (or hold {tasti})',
    'mic.noVoce': 'Voice isn\'t available here: you can type',
    'piede.parla': 'Hold to speak',
    'piede.conferma': 'Asks before every change',
    'piede.schermo': 'Shared screen: no names or figures out loud',
    'vedere.titolo': 'To look at · {n}',
    'vedere.adesso': 'checked just now',
    'vedere.altre': 'and {n} more',
    'vedere.niente': 'Nothing pending',
    'vedere.nienteNota': 'Nothing is waiting',
    'vedere.apri': 'Open',
    'drop.titolo': 'Drop the file here',
    'drop.nota': '{nome} reads it: PDF, photos, Excel, Word, CSV, XML, text',
    'file.leggo': 'reading', 'file.pronto': 'ready', 'file.caricato': 'uploaded',
    'file.togli': 'Remove {nome}',
    'file.domanda': { one: 'I shared this file: read it and tell me briefly what it contains and what I can do with it.', other: 'I shared these files: read them and tell me briefly what they contain and what I can do with them.' },
    'file.etichetta': { one: '{nome}', other: '{n} files' },
    'file.nonDisponibile': 'Reading files needs the connection to Claude',
    'conferma.titolo': 'Confirm?',
    'conferma.si': 'Confirm', 'conferma.no': 'Cancel',
    'conferma.voce': 'You can also say “confirm”.', 'conferma.scrivi': 'You can also type “yes”.',
    'esito.annullato': 'Cancelled.', 'esito.annullatoNota': 'Nothing was changed.',
    'esito.fatto': 'Done.', 'esito.errore': 'It didn\'t work: {errore}',
    'risposta.rifiuto': 'I can\'t help with that.',
    'risposta.vuota': 'I don\'t have an answer for that: try asking another way.',
    'risposta.lunga': 'The answer was too long: try asking one thing at a time.',
    'risposta.interrotta': 'The answer stopped: try again.',
    'risposta.irraggiungibile': 'I can\'t reach the assistant: check the connection.',
    'risposta.errore': 'The assistant didn\'t answer (error {stato}).',
    'risposta.ricomincio': 'Starting over: the conversation was long.',
    'risposta.nonCapito': 'Without Claude I only understand a few sentences. Try: {esempi}.',
    'avviso.collega': 'Connect Claude for real answers: this is the demo without AI.',
    'avviso.microfono': 'The microphone needs permission',
    'avviso.noMicrofono': 'No microphone connected',
    'avviso.noVoce': 'Voice not available right now',
    'pensa.leggo': 'Looking at the data…', 'pensa.preparo': 'Preparing the proposal…', 'pensa.mostro': 'Preparing the summary…',
    'mostra.elenco': 'List',
    'riassunto.annullato': 'cancelled',
    'tu': 'YOU',
  },
};

// la lingua: quella chiesta dall'host, poi quella del browser, poi l'inglese (l'italiano solo se il browser è italiano)
export function scegliLingua(chiesta) {
  if (chiesta && Object.hasOwn(LINGUE, chiesta)) return chiesta;
  const sis = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || '';
  const c = String(sis).slice(0, 2).toLowerCase();
  return Object.hasOwn(LINGUE, c) ? c : 'en';
}

const metti = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (x, k) => (k in p ? String(p[k]) : x)) : String(s));

// un traduttore legato a una lingua: ogni istanza di Lumi ha il suo
export function traduttore(lingua) {
  const cod = Object.hasOwn(LINGUE, lingua) ? lingua : 'it';
  const regole = new Intl.PluralRules(LINGUE[cod].locale);
  const t = (chiave, p) => {
    let v = CATALOGHI[cod][chiave] ?? CATALOGHI.it[chiave];
    if (v == null) return chiave;
    if (typeof v === 'object') v = v[regole.select(Number(p?.n ?? 0))] ?? v.other;
    return metti(v, p);
  };
  t.lingua = cod; t.locale = LINGUE[cod].locale; t.voce = LINGUE[cod].voce;
  return t;
}
