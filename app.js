/* Gym — app per registrare gli allenamenti. JavaScript semplice, senza librerie.
 *
 * Come funziona, in breve:
 * - Tutti i dati stanno in memoria (oggetto D) e in IndexedDB, la memoria del telefono.
 * - Ogni modifica passa da salva(): aggiorna «aggiornato_il», scrive in IndexedDB
 *   e mette la riga nella «coda» delle cose da mandare al foglio.
 * - sincronizza() manda la coda al ponte (Apps Script) e poi scarica le novità dal foglio.
 */
'use strict';

/* ======================= Costanti ======================= */

const SI = 'sì', NO = 'no';

// Le colonne di ogni scheda del foglio: sono il «contratto», non vanno cambiate.
const COLONNE = {
  Esercizi: ['id', 'nome', 'nome_strong', 'tipo', 'attrezzo', 'gruppo', 'area', 'recupero_s', 'nota', 'origine', 'archiviato', 'aggiornato_il', 'eliminato'],
  Modelli: ['id', 'nome', 'cartella', 'ordine', 'nota', 'aggiornato_il', 'eliminato'],
  ModelliEsercizi: ['id', 'modello_id', 'posizione', 'esercizio_id', 'superserie_id', 'recupero_s', 'nota', 'aggiornato_il', 'eliminato'],
  ModelliSerie: ['id', 'modello_esercizio_id', 'posizione', 'tipo', 'lato', 'peso_kg', 'rip', 'durata_s', 'rpe_previsto', 'aggiornato_il', 'eliminato'],
  Sessioni: ['id', 'titolo', 'modello_id', 'inizio', 'fine', 'nota', 'aggiornato_il', 'eliminato'],
  SessioniEsercizi: ['id', 'sessione_id', 'posizione', 'esercizio_id', 'superserie_id', 'nota',
    'ginocchio_pienezza', 'ginocchio_pienezza_nota', 'ginocchio_dolore', 'ginocchio_dolore_nota',
    'malleolo_dolore', 'malleolo_dolore_nota', 'achille_dolore', 'achille_dolore_nota', 'aggiornato_il', 'eliminato'],
  Serie: ['id', 'sessione_esercizio_id', 'posizione', 'tipo', 'lato', 'peso_kg', 'rip', 'durata_s', 'rpe', 'fatta', 'aggiornato_il', 'eliminato'],
  Test: ['id', 'data', 'tipo', 'lato', 'valore', 'unita', 'dolore', 'nota', 'aggiornato_il', 'eliminato', 'origine'],
};
const SCHEDE = Object.keys(COLONNE);

// Per ogni scheda «figlia», la colonna che indica la riga «madre».
const PADRE = { Serie: 'sessione_esercizio_id', SessioniEsercizi: 'sessione_id', ModelliSerie: 'modello_esercizio_id', ModelliEsercizi: 'modello_id' };

// Campi di riabilitazione per area (§6 del brief).
const RIAB = {
  ginocchio: { titolo: 'Riabilitazione ginocchio', campi: [['ginocchio_pienezza', 'Pienezza'], ['ginocchio_dolore', 'Dolore']] },
  caviglia: { titolo: 'Riabilitazione caviglia', campi: [['malleolo_dolore', 'Malleolo'], ['achille_dolore', 'Achille']] },
};

const TIPI_ES = { peso_rip: 'Peso e ripetizioni', rip: 'Solo ripetizioni', durata: 'Durata', peso_durata: 'Peso e durata', cardio: 'Cardio' };
const TIPI_SERIE = { normale: 'Normale', riscaldamento: 'Riscaldamento', cedimento: 'Cedimento' };
const LATI = { entrambi: 'Entrambi', dx: 'Destro', sx: 'Sinistro' };
const AREE = { altro: 'Altro', ginocchio: 'Ginocchio', caviglia: 'Caviglia' };
// Quali numeri si scrivono per ogni tipo di esercizio.
const COLONNE_TIPO = {
  peso_rip: [['peso_kg', 'kg'], ['rip', 'Rip']],
  rip: [['rip', 'Rip']],
  durata: [['durata_s', 'Sec']],
  peso_durata: [['peso_kg', 'kg'], ['durata_s', 'Sec']],
  cardio: [['durata_min', 'Min']],
};

// Icone disegnate a mano (SVG), così non servono librerie esterne.
const ICONE = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  dots: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.6 1.5A3.75 3.75 0 0 1 17 18z"/>',
  barbell: '<path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'list-search': '<path d="M4 6h12M4 12h7M4 18h7"/><circle cx="17" cy="15" r="3"/><path d="M19.2 17.2L22 20"/>',
  'ruler-measure': '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v4M15 8v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7"/><path d="M4 4l16 16"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
};
function ic(nome) { return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONE[nome] || ''}</svg>`; }

/* ======================= Piccoli aiuti ======================= */

const $ = (sel, dove = document) => dove.querySelector(sel);

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Data e ora nel fuso di Roma, formato «AAAA-MM-GG HH:mm:ss» (confrontabile come testo).
const FORMATO_ORA = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function ora(d = new Date()) { return FORMATO_ORA.format(d).replace('T', ' '); }
function dataDa(testo) { return testo ? new Date(String(testo).replace(' ', 'T')) : null; }

function nuovoId(prefisso) {
  const lettere = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const casuali = crypto.getRandomValues(new Uint8Array(12));
  return prefisso + '-' + Array.from(casuali, b => lettere[b % lettere.length]).join('');
}

// Numeri: sul telefono si scrive con la virgola, in memoria sono numeri veri.
function fmtNum(v) { return v === '' || v == null ? '' : String(v).replace('.', ','); }
function leggiNum(testo) {
  const t = String(testo).trim();
  if (t === '') return '';
  const n = Number(t.replace(',', '.'));
  return isNaN(n) ? null : n;
}
function num(v) { return typeof v === 'number' ? v : (v === '' || v == null ? NaN : Number(String(v).replace(',', '.'))); }

function fmtDurata(secondi) {
  secondi = Math.max(0, Math.round(secondi));
  const h = Math.floor(secondi / 3600), m = Math.floor(secondi % 3600 / 60), s = secondi % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtMinuti(secondi) {
  const m = Math.round(secondi / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
function fmtGiorno(d) { return d ? d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; }
function fmtOraBreve(d) { return d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtKg(v) { return Math.round(v).toLocaleString('it-IT') + ' kg'; }
function perPosizione(a, b) { return (num(a.posizione) || 0) - (num(b.posizione) || 0); }
function perNome(a, b) { return String(a.nome).localeCompare(String(b.nome), 'it'); }

/* ======================= IndexedDB (memoria del telefono) ======================= */

let idb;
function apriDB() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('gym', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('righe', { keyPath: 'k' });  // copia locale del foglio
      db.createObjectStore('coda', { keyPath: 'k' });   // modifiche da mandare
      db.createObjectStore('meta', { keyPath: 'chiave' }); // impostazioni e stato
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
function tutti(store) {
  return new Promise((ok, ko) => {
    const r = idb.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
function leggiUno(store, k) {
  return new Promise((ok, ko) => {
    const r = idb.transaction(store).objectStore(store).get(k);
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
function contaCoda() {
  return new Promise((ok, ko) => {
    const r = idb.transaction('coda').objectStore('coda').count();
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
// Scrive in una sola transazione: o tutto o niente.
function scriviIn(operazioni) {
  return new Promise((ok, ko) => {
    const stores = [...new Set(operazioni.map(o => o[0]))];
    if (!stores.length) return ok();
    const t = idb.transaction(stores, 'readwrite');
    operazioni.forEach(([store, tipo, valore]) => {
      if (tipo === 'put') t.objectStore(store).put(valore); else t.objectStore(store).delete(valore);
    });
    t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
  });
}

/* ======================= Dati in memoria ======================= */

const D = {};               // D.Esercizi = Map(id -> riga), ecc.
SCHEDE.forEach(s => { D[s] = new Map(); });
const meta = {};            // url, token, cursore, ultimoInvio, ultimoErrore, ...
let codaQuante = 0;
let contatoreVersione = 0;
let versioneDati = 0;       // cambia a ogni modifica: serve a rifare gli indici

function vivi(scheda) { return [...D[scheda].values()].filter(r => r.eliminato !== SI); }
function riga(scheda, id) { return D[scheda].get(id); }

// Indici per trovare in fretta le righe «figlie» (rifatti solo quando i dati cambiano).
const indici = {};
function indice(scheda, campo) {
  const chiave = scheda + '.' + campo;
  let c = indici[chiave];
  if (!c || c.v !== versioneDati) {
    const m = new Map();
    D[scheda].forEach(r => {
      if (r.eliminato === SI) return;
      const k = r[campo];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    m.forEach(a => a.sort(perPosizione));
    c = indici[chiave] = { v: versioneDati, m };
  }
  return c.m;
}
function figli(scheda, padreId) { return (indice(scheda, PADRE[scheda]).get(padreId) || []).slice(); }
const serieDi = id => figli('Serie', id);
const eserciziDi = id => figli('SessioniEsercizi', id);
const vociDi = id => figli('ModelliEsercizi', id);
const previsteDi = id => figli('ModelliSerie', id);
function figliDi(scheda, r) { return scheda === 'SessioniEsercizi' ? serieDi(r.id) : previsteDi(r.id); }
function fratelliDi(scheda, r) { return figli(scheda, r[PADRE[scheda]]); }

function nuovaRiga(scheda, valori) {
  const r = {};
  COLONNE[scheda].forEach(c => { r[c] = ''; });
  r.eliminato = NO;
  return Object.assign(r, valori);
}
function soloSchema(scheda, r) {
  const pulita = {};
  COLONNE[scheda].forEach(c => { pulita[c] = r[c] === undefined || r[c] === null ? '' : r[c]; });
  return pulita;
}

/** Salva subito una o più righe: memoria, IndexedDB e coda di invio. */
function salva(...coppie) { return salvaLista(coppie); }
async function salvaLista(coppie) {
  const adesso = ora();
  const operazioni = [];
  coppie.forEach(([scheda, r]) => {
    r.aggiornato_il = adesso;
    D[scheda].set(r.id, r);
    const k = scheda + '|' + r.id;
    const copia = soloSchema(scheda, r);
    operazioni.push(['righe', 'put', { k, scheda, riga: copia }]);
    operazioni.push(['coda', 'put', { k, scheda, riga: copia, v: Date.now() + '-' + (contatoreVersione++) }]);
  });
  versioneDati++;
  await scriviIn(operazioni);
  codaQuante = await contaCoda();
  aggiornaStatoSync();
  programmaSync();
}

async function salvaMeta(chiave, valore) {
  meta[chiave] = valore;
  await scriviIn([['meta', 'put', { chiave, valore }]]);
}

async function caricaTutto() {
  (await tutti('righe')).forEach(({ scheda, riga: r }) => { if (D[scheda]) D[scheda].set(r.id, r); });
  (await tutti('meta')).forEach(({ chiave, valore }) => { meta[chiave] = valore; });
  codaQuante = await contaCoda();
  versioneDati++;
}

/* ======================= Sincronizzazione con il foglio ======================= */

let syncInCorso = false, syncDiNuovo = false, attesaSync = null;
let statoSync = '';

function programmaSync() {
  clearTimeout(attesaSync);
  attesaSync = setTimeout(() => sincronizza(), 4000);
}

async function chiamaPonte(corpo) {
  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(), 60000);
  try {
    // Testo semplice: così il browser non fa la richiesta preliminare CORS.
    const risposta = await fetch(meta.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: meta.token }, corpo)),
      signal: controllo.signal,
      redirect: 'follow',
      credentials: 'omit',
    });
    if (!risposta.ok) throw new Error('il ponte ha risposto ' + risposta.status);
    let dati;
    try { dati = await risposta.json(); } catch (e) { throw new Error('risposta del ponte non leggibile (indirizzo giusto?)'); }
    if (!dati.ok) throw new Error(dati.errore || 'errore del ponte');
    return dati;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('il ponte non risponde (tempo scaduto)');
    if (e instanceof TypeError) throw new Error('nessuna connessione con il ponte');
    throw e;
  } finally {
    clearTimeout(scadenza);
  }
}

async function sincronizza({ completo = false } = {}) {
  if (syncInCorso) { syncDiNuovo = true; return; }
  if (!meta.url || !meta.token) { statoSync = 'non configurato'; aggiornaStatoSync(); return; }
  if (!navigator.onLine) { statoSync = 'offline'; aggiornaStatoSync(); return; }
  syncInCorso = true; statoSync = 'in corso'; aggiornaStatoSync();
  try {
    // 1) Invio della coda, a blocchi.
    let coda = await tutti('coda');
    while (coda.length) {
      const lotto = coda.slice(0, 500);
      const righe = {};
      lotto.forEach(e => { (righe[e.scheda] = righe[e.scheda] || []).push(e.riga); });
      await chiamaPonte({ azione: 'push', righe });
      const daTogliere = [];
      for (const e of lotto) {
        const attuale = await leggiUno('coda', e.k);
        if (attuale && attuale.v === e.v) daTogliere.push(['coda', 'delete', e.k]); // non è cambiata nel frattempo
      }
      await scriviIn(daTogliere);
      await salvaMeta('ultimoInvio', ora());
      coda = coda.slice(500);
      codaQuante = await contaCoda();
      aggiornaStatoSync();
    }

    // 2) Lettura delle novità. Una volta al giorno si rilegge tutto, per sicurezza.
    const oggi = ora().slice(0, 10);
    const tutto = completo || !meta.cursore || meta.ultimoCompleto !== oggi;
    let dal = '';
    if (!tutto) dal = ora(new Date(dataDa(meta.cursore).getTime() - 3600 * 1000)); // un'ora di margine
    const dati = await chiamaPonte({ azione: 'pull', dal, schede: SCHEDE });
    const cambiate = await unisci(dati.schede || {});
    await salvaMeta('cursore', dati.adesso);
    if (tutto) await salvaMeta('ultimoCompleto', oggi);
    await salvaMeta('ultimaLettura', ora());
    await salvaMeta('ultimoErrore', '');
    statoSync = '';
    if (cambiate) ridisegnaSePossibile();
  } catch (e) {
    const rete = /nessuna connessione|tempo scaduto/.test(e.message);
    statoSync = rete ? 'offline' : 'errore'; // senza rete non è un vero errore: si riprova da soli
    await salvaMeta('ultimoErrore', rete ? '' : ora() + ' · ' + e.message);
  } finally {
    syncInCorso = false;
    aggiornaStatoSync();
    if (syncDiNuovo) { syncDiNuovo = false; programmaSync(); }
  }
}

/** Unisce le righe arrivate dal foglio: vince la più recente (aggiornato_il). */
async function unisci(schede) {
  const operazioni = [];
  let cambiate = 0;
  const inAttesa = new Set((await tutti('coda')).map(e => e.k)); // modifiche locali non ancora inviate
  Object.keys(schede).forEach(scheda => {
    if (!D[scheda]) return;
    (schede[scheda].righe || []).forEach(arrivata => {
      if (!arrivata.id) return;
      if (inAttesa.has(scheda + '|' + arrivata.id)) return; // la versione del telefono partirà al prossimo invio
      const r = soloSchema(scheda, arrivata);
      const locale = D[scheda].get(r.id);
      if (locale && String(r.aggiornato_il) < String(locale.aggiornato_il)) return; // la nostra è più nuova
      if (locale && COLONNE[scheda].every(c => String(locale[c] ?? '') === String(r[c] ?? ''))) return; // identica
      D[scheda].set(r.id, r);
      operazioni.push(['righe', 'put', { k: scheda + '|' + r.id, scheda, riga: r }]);
      cambiate++;
    });
  });
  if (cambiate) versioneDati++;
  await scriviIn(operazioni);
  return cambiate;
}

function testoStatoSync() {
  if (!meta.url || !meta.token) return `<span class="errore">Ponte non configurato</span> · <a href="#" data-vai="impostazioni" style="color:var(--blu-chiaro)">Impostazioni</a>`;
  const coda = codaQuante ? `${codaQuante} in coda` : '0 in coda';
  if (statoSync === 'in corso') return `Sincronizzo… · ${coda}`;
  if (statoSync === 'errore' || meta.ultimoErrore) return `<span class="errore">Errore di sincronizzazione</span> · ${coda}`;
  if (statoSync === 'offline' || !navigator.onLine) return `Senza rete · ${coda}`;
  return codaQuante ? `${ic('cloud')} ${coda}` : `${ic('cloud')} Sincronizzato · 0 in coda`;
}
function aggiornaStatoSync() {
  document.querySelectorAll('[data-stato-sync]').forEach(el => { el.innerHTML = testoStatoSync(); });
  if (S.schermata === 'impostazioni' && !document.activeElement.matches('input') && $('#velo').hidden) disegna();
}

/* ======================= Timer di recupero ======================= */

let audio = null;
function sbloccaAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) { /* senza audio si usa solo la vibrazione */ }
}
function suona() {
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  if (!audio) return;
  [0, 0.35, 0.7].forEach(t => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, audio.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.28);
    o.connect(g); g.connect(audio.destination);
    o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.3);
  });
}

function avviaTimer(secondi) {
  if (!secondi || secondi <= 0) return;
  salvaMeta('timerFine', Date.now() + secondi * 1000);
  aggiornaTimer();
}
function cambiaTimer(delta) {
  if (!meta.timerFine) return;
  salvaMeta('timerFine', Math.max(Date.now() + 1000, meta.timerFine + delta * 1000));
  aggiornaTimer();
}
function fermaTimer() { salvaMeta('timerFine', 0); aggiornaTimer(); }

let timerFinitoFino = 0;
function aggiornaTimer() {
  const box = $('#timer');
  const adesso = Date.now();
  if (meta.timerFine) {
    const resto = Math.ceil((meta.timerFine - adesso) / 1000);
    if (resto <= 0) {
      if (adesso - meta.timerFine < 5000) suona(); // suona solo se è appena finito
      salvaMeta('timerFine', 0);
      timerFinitoFino = adesso + 3000;
      $('#timer-tempo').textContent = 'Via!';
      box.classList.add('finito');
    } else {
      $('#timer-tempo').textContent = fmtDurata(resto);
      box.classList.remove('finito');
    }
  }
  const visibile = !!meta.timerFine || adesso < timerFinitoFino;
  box.hidden = !visibile;
  document.body.classList.toggle('con-timer', visibile);
}

/** Dopo una serie fatta: parte il recupero. Nelle superserie parte solo dopo la coppia. */
function timerDopoSerie(s) {
  const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
  const sess = se && riga('Sessioni', se.sessione_id);
  if (!sessioneAperta(sess)) return;
  const comp = compagno(eserciziDi(sess.id), se);
  if (comp) {
    const k = serieDi(se.id).indexOf(s);
    const sua = serieDi(comp.id)[k];
    if (sua && sua.fatta !== SI) return; // ora tocca all'altro esercizio della coppia
    avviaTimer(Math.max(recuperoDi(se), recuperoDi(comp)));
    return;
  }
  avviaTimer(recuperoDi(se));
}

/* Conto alla rovescia per le serie a durata (isometrie). */
let conto = null; // { serieId, obiettivo, partenza }
function avviaConto(serieId) {
  const s = riga('Serie', serieId);
  const obiettivo = num(s.durata_s);
  conto = { serieId, obiettivo: isNaN(obiettivo) || obiettivo <= 0 ? 0 : obiettivo, partenza: Date.now() + 3000 };
  if (navigator.vibrate) navigator.vibrate(80);
  disegnaConto();
}
function disegnaConto() {
  if (!conto) return;
  const passati = (Date.now() - conto.partenza) / 1000;
  let grande, sotto;
  if (passati < 0) { grande = Math.ceil(-passati); sotto = 'Pronti…'; }
  else if (conto.obiettivo) { grande = fmtDurata(Math.max(0, conto.obiettivo - passati)); sotto = `di ${conto.obiettivo}″`; }
  else { grande = fmtDurata(passati); sotto = 'Cronometro'; }
  // Il foglio si crea una volta sola; poi si aggiornano solo i numeri (i bottoni restano fermi).
  if ($('#velo').hidden || !$('#conto-grande')) {
    apriFoglio(`<h2>Serie a durata</h2>
      <div style="text-align:center;padding:16px 0"><div id="conto-grande" style="font-size:64px;font-weight:500;font-variant-numeric:tabular-nums"></div><div class="tenue" id="conto-sotto"></div></div>
      <div class="riga-btn"><button class="btn2" data-azione="conto-annulla">Annulla</button><button class="btn verde" data-azione="conto-ferma">Ferma e registra</button></div>`);
  }
  $('#conto-grande').textContent = grande;
  $('#conto-sotto').textContent = sotto;
  if (conto.obiettivo && passati >= conto.obiettivo) chiudiConto(true);
}
async function chiudiConto(registra) {
  if (!conto) return;
  const c = conto; conto = null;
  chiudiFoglio();
  if (!registra) return;
  const s = riga('Serie', c.serieId);
  const passati = Math.max(0, Math.round((Date.now() - c.partenza) / 1000));
  s.durata_s = c.obiettivo && passati >= c.obiettivo ? c.obiettivo : passati;
  s.fatta = SI;
  await salva(['Serie', s]);
  if (c.obiettivo && passati >= c.obiettivo) suona();
  timerDopoSerie(s);
  disegna();
}

/* ======================= Schermo sempre acceso ======================= */

let wakeLock = null;
async function tieniAcceso(si) {
  try {
    if (si && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!si && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch (e) { wakeLock = null; }
}
function controllaWakeLock() { tieniAcceso(!!sessioneInCorso()); }

/* ======================= Domande sui dati ======================= */

function sessioneAperta(sess) { return sess && sess.eliminato !== SI && !sess.fine; }
function sessioneInCorso() {
  return vivi('Sessioni').filter(s => !s.fine).sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)))[0] || null;
}
function voceModello(sess, esercizioId) {
  if (!sess || !sess.modello_id) return null;
  return vociDi(sess.modello_id).find(m => m.esercizio_id === esercizioId) || null;
}
function recuperoDi(se) {
  const me = voceModello(riga('Sessioni', se.sessione_id), se.esercizio_id);
  const daModello = me ? num(me.recupero_s) : NaN;
  if (!isNaN(daModello)) return daModello;
  const es = riga('Esercizi', se.esercizio_id);
  const daEsercizio = es ? num(es.recupero_s) : NaN;
  return isNaN(daEsercizio) ? 0 : daEsercizio;
}
function riepilogoSessione(sess) {
  let fatte = 0, totali = 0, volume = 0;
  const nomi = [];
  eserciziDi(sess.id).forEach(se => {
    const es = riga('Esercizi', se.esercizio_id);
    nomi.push(es ? es.nome : '?');
    serieDi(se.id).forEach(s => {
      totali++;
      if (s.fatta === SI) {
        fatte++;
        const p = num(s.peso_kg), r = num(s.rip);
        if (!isNaN(p) && !isNaN(r)) volume += p * r;
      }
    });
  });
  const inizio = dataDa(sess.inizio), fine = sess.fine ? dataDa(sess.fine) : new Date();
  const durata = inizio && fine ? (fine - inizio) / 1000 : 0;
  return { fatte, totali, volume, durata, nomi };
}

/* ----- Superserie: due esercizi con lo stesso superserie_id (solo coppie) ----- */
function compagno(lista, r) {
  if (!r || !r.superserie_id) return null;
  const altri = lista.filter(x => x !== r && x.superserie_id === r.superserie_id);
  return altri.length === 1 ? altri[0] : null;
}
// Divide l'elenco in «blocchi»: un esercizio singolo oppure una coppia di superserie.
function blocchi(lista) {
  const visti = new Set(), out = [];
  lista.forEach(r => {
    if (visti.has(r)) return;
    const c = compagno(lista, r);
    visti.add(r);
    if (c) { visti.add(c); out.push([r, c]); } else out.push([r]);
  });
  return out;
}
async function riordinaBlocchi(scheda, lista) {
  const cambiate = [];
  blocchi(lista).flat().forEach((r, i) => { if (num(r.posizione) !== i + 1) { r.posizione = i + 1; cambiate.push([scheda, r]); } });
  if (cambiate.length) await salvaLista(cambiate);
}

/* ----- Valori dell'ultima volta ----- */
// Le serie fatte dello stesso esercizio nell'ultima sessione precedente che le contiene.
function serieUltimaVolta(sess, se) {
  const candidati = (indice('SessioniEsercizi', 'esercizio_id').get(se.esercizio_id) || [])
    .map(x => ({ x, s: riga('Sessioni', x.sessione_id) }))
    .filter(({ x, s }) => x.id !== se.id && s && s.eliminato !== SI && s.id !== sess.id && String(s.inizio) < String(sess.inizio))
    .sort((a, b) => String(b.s.inizio).localeCompare(String(a.s.inizio)));
  for (const { x } of candidati) {
    const fatte = serieDi(x.id).filter(s => s.fatta === SI);
    if (fatte.length) return fatte;
  }
  return [];
}
// Abbina la serie k-esima dello stesso lato (e dello stesso genere: riscaldamento o no).
function precedenteDi(lista, s, precedenti) {
  const genere = x => (x.lato || 'entrambi') + '|' + (x.tipo === 'riscaldamento' ? 'r' : 'n');
  const k = lista.filter(x => genere(x) === genere(s)).indexOf(s);
  return precedenti.filter(x => genere(x) === genere(s))[k] || null;
}
function fmtPrecedente(tipo, p) {
  const kg = p.peso_kg === '' ? '' : fmtNum(p.peso_kg);
  if (tipo === 'rip') return `${p.rip} rip`;
  if (tipo === 'durata') return `${p.durata_s}″`;
  if (tipo === 'peso_durata') return `${kg || 0} kg × ${p.durata_s}″`;
  if (tipo === 'cardio') return `${Math.round(num(p.durata_s) / 60)} min`;
  return kg === '' ? `${p.rip} rip` : `${kg} × ${p.rip}`;
}

/* ======================= Navigazione e disegno ======================= */

const S = {
  schermata: 'oggi', sessioneId: null, modelloId: null, bozzaEs: null,
  vistaArchivio: 'esercizi', mostraArchiviati: false,
  ricerca: '', ricercaArchivio: '', nuovoEs: null, sceltaPer: 'sessione', importazione: null,
};

function vai(schermata, extra = {}) {
  Object.assign(S, extra);
  if (S.schermata !== schermata) history.pushState({ schermata, sessioneId: S.sessioneId, modelloId: S.modelloId }, '');
  S.schermata = schermata;
  disegna();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  if (!$('#velo').hidden) chiudiFoglio();
  const st = e.state || { schermata: 'oggi' };
  S.schermata = st.schermata;
  S.sessioneId = st.sessioneId || S.sessioneId;
  S.modelloId = st.modelloId || S.modelloId;
  disegna();
});

const SCHERMATE = {
  oggi: disegnaOggi, sessione: disegnaSessione, storico: disegnaStorico, esercizi: disegnaArchivio,
  esercizio: disegnaFormEsercizio, modello: disegnaModello, test: disegnaTest, impostazioni: disegnaImpostazioni,
};
const TAB_DI = { esercizio: 'esercizi', modello: 'esercizi' };

function disegna() {
  daRidisegnare = false;
  const fn = SCHERMATE[S.schermata] || disegnaOggi;
  $('#schermo').innerHTML = fn();
  let tab = TAB_DI[S.schermata] || S.schermata;
  if (S.schermata === 'sessione') tab = sessioneAperta(riga('Sessioni', S.sessioneId)) ? 'oggi' : 'storico';
  document.querySelectorAll('#barra button').forEach(b => b.classList.toggle('attiva', b.dataset.vai === tab));
  aggiornaCronometro();
}

let daRidisegnare = false;
function ridisegnaSePossibile() {
  const att = document.activeElement;
  if (att && att.matches('input, textarea') && $('#schermo').contains(att)) { daRidisegnare = true; return; }
  if (S.schermata === 'esercizio') { daRidisegnare = true; return; } // modulo non ancora salvato
  disegna();
}
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const att = document.activeElement;
    if (daRidisegnare && S.schermata !== 'esercizio' && !(att && att.matches('input, textarea'))) disegna();
  }, 400);
});

function testata(titolo, indietro, destra = '') {
  return `<div class="top">${indietro ? `<button class="icona" data-azione="${indietro}" aria-label="Indietro">${ic('arrow-left')}</button>` : ''}
    <h1 style="flex:1">${titolo}</h1>${destra}</div>`;
}

/* ---------- Oggi ---------- */
function modelliOrdinati() {
  return vivi('Modelli').sort((a, b) =>
    String(a.cartella).localeCompare(String(b.cartella), 'it') || (num(a.ordine) || 0) - (num(b.ordine) || 0) || perNome(a, b));
}
function disegnaOggi() {
  const inCorso = sessioneInCorso();
  const sessioni = vivi('Sessioni');
  let html = testata('Oggi', '', `<button class="icona" data-vai="impostazioni" aria-label="Impostazioni">${ic('settings')}</button>`) + `<div class="pila">`;
  if (inCorso) {
    html += `<div class="card in-corso"><div class="tenue">Sessione in corso</div>
      <div style="font-size:17px;font-weight:500;margin:2px 0 8px">${esc(inCorso.titolo)} · iniziata alle ${fmtOraBreve(dataDa(inCorso.inizio))}</div>
      <button class="btn largo" data-azione="riprendi">Riprendi</button></div>`;
  }
  html += `<button class="btn2 largo" data-azione="nuova-vuota">${ic('plus')} Sessione vuota</button>`;
  let cartella = null;
  const modelli = modelliOrdinati();
  modelli.forEach(m => {
    if (m.cartella !== cartella) { cartella = m.cartella; html += `<div class="etichetta">${esc(cartella || 'Senza cartella')}</div>`; }
    const quanti = vociDi(m.id).length;
    const ultima = sessioni.filter(s => s.modello_id === m.id && s.fine).map(s => s.inizio).sort().pop();
    html += `<button class="card fila modello" data-azione="avvia-modello" data-id="${esc(m.id)}">
      <span><span style="display:block;font-size:16px">${esc(m.nome)}</span><span class="tenue">${quanti} esercizi${ultima ? ' · ultima ' + fmtGiorno(dataDa(ultima)) : ''}</span></span>${ic('play')}</button>`;
  });
  if (!modelli.length) html += `<div class="vuoto-msg">Nessun modello. Puoi crearne uno in Esercizi → Modelli.</div>`;
  html += `<div class="stato-sync" data-stato-sync>${testoStatoSync()}</div></div>`;
  return html;
}

/* ---------- Righe delle serie (sessione e modello) ---------- */
function etichettaSerie(lista, s, lettera = '') {
  if (s.tipo === 'riscaldamento') return { testo: lettera + 'R', classe: 'risc' };
  const n = lista.filter(x => x.tipo !== 'riscaldamento' && x.lato === s.lato && perPosizione(x, s) <= 0).length;
  return { testo: `<b>${lettera}${n}</b>${s.lato && s.lato !== 'entrambi' ? ' ' + s.lato : ''}`, classe: s.tipo === 'cedimento' ? 'ced' : '' };
}

function campoNum(scheda, r, campo) {
  const v = campo === 'durata_min' ? (r.durata_s === '' ? '' : Math.round(num(r.durata_s) / 6) / 10) : r[campo];
  return `<input class="num" inputmode="decimal" autocomplete="off" data-scheda="${scheda}" data-id="${esc(r.id)}" data-campo="${campo}" value="${esc(fmtNum(v))}">`;
}

function rigaSerie(scheda, tipo, lista, s, lettera, precedenti) {
  const sessione = scheda === 'Serie';
  const et = etichettaSerie(lista, s, lettera);
  let celle = `<button class="lab-serie ${et.classe}" data-azione="menu-serie" data-scheda="${scheda}" data-id="${esc(s.id)}">${et.testo}</button>`;
  if (sessione) {
    const p = precedenti && precedenteDi(lista, s, precedenti);
    celle += p
      ? `<button class="ultima" data-azione="usa-precedente" data-id="${esc(s.id)}" data-peso="${esc(p.peso_kg)}" data-rip="${esc(p.rip)}" data-durata="${esc(p.durata_s)}">${esc(fmtPrecedente(tipo, p))}</button>`
      : `<span class="ultima">—</span>`;
  }
  COLONNE_TIPO[tipo].forEach(([c]) => { celle += campoNum(scheda, s, c); });
  celle += campoNum(scheda, s, sessione ? 'rpe' : 'rpe_previsto');
  if (sessione) celle += `<button class="spunta" data-azione="spunta" data-id="${esc(s.id)}" aria-label="Serie fatta">${ic('check')}</button>`;
  return `<div class="scorri"><div class="scorri-fondo">${ic('trash')}${ic('trash')}</div>
    <div class="serie c-${esc(tipo)} ${sessione ? '' : 'mod'} ${s.fatta === SI ? 'fatta' : ''}" data-scheda="${scheda}" data-id="${esc(s.id)}">${celle}</div></div>`;
}

function intestazioneSerie(tipo, sessione) {
  return `<div class="serie intest c-${esc(tipo)} ${sessione ? '' : 'mod'}"><span>Serie</span>${sessione ? '<span>Ultima volta</span>' : ''}
    ${COLONNE_TIPO[tipo].map(([, t]) => `<span>${t}</span>`).join('')}<span>RPE</span>${sessione ? '<span></span>' : ''}</div>`;
}

function tipoDi(es) { return es && COLONNE_TIPO[es.tipo] ? es.tipo : 'peso_rip'; }

/* ---------- Sessione ---------- */
function disegnaEsercizioSessione(sess, se, lettera) {
  const es = riga('Esercizi', se.esercizio_id);
  const tipo = tipoDi(es);
  const serie = serieDi(se.id);
  const me = voceModello(sess, se.esercizio_id);
  const rec = recuperoDi(se);
  const precedenti = serieUltimaVolta(sess, se);
  let html = `<div class="card" style="padding:12px 8px" data-se="${esc(se.id)}">
    <div class="fila" style="padding:0 4px 8px;align-items:flex-start"><div>
      <div class="es-titolo">${lettera ? lettera + ' · ' : ''}${esc(es ? es.nome : 'Esercizio non trovato (' + se.esercizio_id + ')')}</div>
      ${es && RIAB[es.area] ? `<span class="tag">${esc(es.area)}</span>` : ''}
      <span class="tenue">${rec ? 'recupero ' + fmtDurata(rec) : 'senza recupero'}</span>
      ${me && me.nota ? `<p class="indicazione">${esc(me.nota)}</p>` : ''}
    </div><button class="icona" data-azione="menu-es" data-scheda="SessioniEsercizi" data-id="${esc(se.id)}" aria-label="Opzioni esercizio">${ic('dots')}</button></div>`;
  html += intestazioneSerie(tipo, true);
  serie.forEach(s => { html += rigaSerie('Serie', tipo, serie, s, lettera, precedenti); });
  html += `<div class="riga-btn" style="padding:8px 4px 0">
    <button class="btn2" style="font-size:14px" data-azione="aggiungi-serie" data-scheda="Serie" data-padre="${esc(se.id)}">${ic('plus')} Serie</button>
    <button class="btn2" style="font-size:14px" data-azione="copia-precedente" data-scheda="Serie" data-padre="${esc(se.id)}">${ic('copy')} Copia precedente</button></div>`;
  if (tipo === 'durata' || tipo === 'peso_durata') {
    const prossima = serie.find(s => s.fatta !== SI);
    if (prossima) {
      const et = etichettaSerie(serie, prossima, lettera);
      html += `<div style="padding:8px 4px 0"><button class="btn largo" data-azione="avvia-durata" data-id="${esc(prossima.id)}">${ic('timer')} Avvia serie ${et.testo.replace(/<[^>]+>/g, '')}${prossima.durata_s !== '' ? ' · ' + prossima.durata_s + '″' : ''}</button></div>`;
    }
  }
  html += `<div style="padding:8px 4px 0"><input class="testo" placeholder="Nota sull'esercizio" data-se-campo="nota" data-se="${esc(se.id)}" value="${esc(se.nota)}"></div>`;
  const riab = es && RIAB[es.area];
  if (riab) {
    const pieno = riab.campi.some(([c]) => se[c] !== '' || se[c + '_nota']);
    html += `<details class="riab" ${pieno ? 'open' : ''}><summary>${riab.titolo}${ic('chevron-down')}</summary>`;
    riab.campi.forEach(([c, nome]) => {
      html += `<div class="riab-riga"><span class="tenue">${nome}</span>
        <input class="num" inputmode="decimal" autocomplete="off" placeholder="0-10" data-se-campo="${c}" data-se="${esc(se.id)}" value="${esc(fmtNum(se[c]))}">
        <input class="testo" placeholder="nota breve" data-se-campo="${c}_nota" data-se="${esc(se.id)}" value="${esc(se[c + '_nota'])}"></div>`;
    });
    html += `</details>`;
  }
  return html + `</div>`;
}

// Disegna gli esercizi a blocchi: le coppie di superserie stanno in un riquadro comune.
function disegnaBlocchi(lista, disegnaUno) {
  return blocchi(lista).map(b => b.length === 1 ? disegnaUno(b[0], '')
    : `<div class="coppia"><div class="coppia-tit">${ic('link')} Superserie</div>${disegnaUno(b[0], 'A')}${disegnaUno(b[1], 'B')}</div>`).join('');
}

function disegnaSessione() {
  const sess = riga('Sessioni', S.sessioneId);
  if (!sess || sess.eliminato === SI) { S.schermata = 'oggi'; return disegnaOggi(); }
  const aperta = sessioneAperta(sess);
  let html = `<div class="top">
    <button style="background:none;border:none;text-align:left;padding:0;min-height:48px;cursor:pointer" data-azione="rinomina-sessione">
      <div class="tenue">${esc(sess.titolo)} ${aperta ? '' : '· ' + fmtGiorno(dataDa(sess.inizio))}</div>
      <div style="font-size:22px;font-weight:500" id="cronometro"></div></button>
    ${aperta ? `<button class="btn verde" data-azione="fine-sessione">Fine</button>` : `<button class="btn2" data-azione="chiudi-sessione">Chiudi</button>`}
  </div><div class="pila">`;
  const esercizi = eserciziDi(sess.id);
  html += disegnaBlocchi(esercizi, (se, lettera) => disegnaEsercizioSessione(sess, se, lettera));
  if (!esercizi.length) html += `<div class="vuoto-msg">Nessun esercizio. Aggiungine uno.</div>`;
  html += `<button class="btn2 largo" data-azione="aggiungi-es" data-per="sessione">${ic('plus')} Esercizio</button>
    <textarea class="testo" placeholder="Nota sulla sessione" data-sess-campo="nota">${esc(sess.nota)}</textarea>
    <button class="btn2 pericolo largo" data-azione="elimina-sessione">${ic('trash')} ${aperta ? 'Annulla la sessione' : 'Elimina la sessione'}</button>
    <div class="stato-sync" data-stato-sync>${testoStatoSync()}</div></div>`;
  return html;
}

function aggiornaCronometro() {
  const el = $('#cronometro');
  if (!el) return;
  const sess = riga('Sessioni', S.sessioneId);
  if (!sess) return;
  const inizio = dataDa(sess.inizio);
  const fine = sess.fine ? dataDa(sess.fine) : new Date();
  el.textContent = inizio ? fmtDurata((fine - inizio) / 1000) : '';
}

/* ---------- Storico ---------- */
function lunedi(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function disegnaStorico() {
  const sessioni = vivi('Sessioni').filter(s => s.fine).sort((a, b) => String(b.inizio).localeCompare(String(a.inizio)));
  const oggi = new Date(); const lun = lunedi(oggi);
  const giorniFatti = new Set(sessioni.map(s => String(s.inizio).slice(0, 10)));
  const nomi = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  let html = testata('Storico') + `<div class="pila"><div class="card settimana">`;
  nomi.forEach((n, i) => {
    const g = new Date(lun); g.setDate(lun.getDate() + i);
    const chiave = ora(g).slice(0, 10);
    const classi = (giorniFatti.has(chiave) ? 'si ' : '') + (g.toDateString() === oggi.toDateString() ? 'oggi' : '');
    html += `<div>${n}<div class="giorno ${classi}">${g.getDate()}</div></div>`;
  });
  html += `</div>`;
  // Con tanto storico (per esempio dopo l'importazione da Strong) si mostrano le ultime 100.
  const mostrate = sessioni.slice(0, S.storicoTutte ? sessioni.length : 100);
  const perSettimana = new Map();
  sessioni.forEach(s => { const k = lunedi(dataDa(s.inizio)).getTime(); perSettimana.set(k, (perSettimana.get(k) || 0) + 1); });
  let gruppo = null;
  mostrate.forEach(s => {
    const d = dataDa(s.inizio);
    const lunS = lunedi(d);
    const settimane = Math.round((lun - lunS) / (7 * 864e5));
    const nomeGruppo = settimane === 0 ? 'Questa settimana' : settimane === 1 ? 'Settimana scorsa' : 'Settimana dal ' + lunS.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    if (nomeGruppo !== gruppo) {
      gruppo = nomeGruppo;
      const quante = perSettimana.get(lunS.getTime());
      html += `<div class="etichetta">${nomeGruppo} · ${quante} ${quante === 1 ? 'seduta' : 'sedute'}</div>`;
    }
    const r = riepilogoSessione(s);
    const elenco = r.nomi.slice(0, 3).join(' · ') + (r.nomi.length > 3 ? ` +${r.nomi.length - 3}` : '');
    html += `<button class="card modello" data-azione="apri-sessione" data-id="${esc(s.id)}">
      <span class="fila"><span style="font-size:16px;font-weight:500">${esc(s.titolo)}</span><span class="tenue">${fmtGiorno(d)}</span></span>
      <span class="tenue" style="display:block;margin-top:4px">${fmtMinuti(r.durata)} · ${r.fatte} serie${r.volume ? ' · ' + fmtKg(r.volume) : ''}</span>
      ${elenco ? `<span style="display:block;font-size:13px;margin-top:6px;color:#cbd2dc">${esc(elenco)}</span>` : ''}</button>`;
  });
  if (sessioni.length > mostrate.length) html += `<button class="btn2 largo" data-azione="storico-tutte">Mostra tutte (${sessioni.length})</button>`;
  if (!sessioni.length) html += `<div class="vuoto-msg">Le sessioni finite compariranno qui.</div>`;
  return html + `<p class="tenue" style="text-align:center">Grafici e statistiche arrivano nella fase 4.</p></div>`;
}

/* ---------- Esercizi e modelli (archivio) ---------- */
function elencoEsercizi(filtro, conArchiviati = false) {
  const f = filtro.trim().toLowerCase();
  return vivi('Esercizi').filter(e => (conArchiviati || e.archiviato !== SI) && (!f || String(e.nome).toLowerCase().includes(f) || String(e.gruppo).toLowerCase().includes(f)))
    .sort(perNome);
}
function disegnaArchivio() {
  const vista = S.vistaArchivio;
  let html = testata('Esercizi') + `<div class="pila">
    <div class="scelte" style="margin:0">
      <button class="scelta ${vista === 'esercizi' ? 'si' : ''}" data-azione="vista-archivio" data-valore="esercizi">Esercizi</button>
      <button class="scelta ${vista === 'modelli' ? 'si' : ''}" data-azione="vista-archivio" data-valore="modelli">Modelli</button></div>`;
  if (vista === 'modelli') {
    html += `<button class="btn2 largo" data-azione="nuovo-modello">${ic('plus')} Nuovo modello</button>`;
    let cartella = null;
    const modelli = modelliOrdinati();
    modelli.forEach(m => {
      if (m.cartella !== cartella) { cartella = m.cartella; html += `<div class="etichetta">${esc(cartella || 'Senza cartella')}</div>`; }
      html += `<button class="card fila modello" data-azione="apri-modello" data-id="${esc(m.id)}">
        <span><span style="display:block;font-size:16px">${esc(m.nome)}</span><span class="tenue">${vociDi(m.id).length} esercizi</span></span>${ic('chevron-right')}</button>`;
    });
    if (!modelli.length) html += `<div class="vuoto-msg">Nessun modello.</div>`;
    return html + `</div>`;
  }
  html += `<input class="testo" type="search" placeholder="Cerca un esercizio" data-ricerca="archivio" value="${esc(S.ricercaArchivio)}">
    <div class="riga-btn"><button class="btn2" data-azione="nuovo-esercizio">${ic('plus')} Nuovo esercizio</button>
      <button class="btn2" data-azione="mostra-archiviati">${S.mostraArchiviati ? 'Nascondi archiviati' : 'Mostra archiviati'}</button></div>
    <div id="lista-archivio" class="pila">${righeArchivio()}</div></div>`;
  return html;
}
function righeArchivio() {
  const lista = elencoEsercizi(S.ricercaArchivio, S.mostraArchiviati);
  if (!lista.length) return `<div class="vuoto-msg">Nessun esercizio trovato.</div>`;
  return lista.map(e => `<button class="card modello" data-azione="apri-esercizio" data-id="${esc(e.id)}">
    <span style="display:block;font-size:16px">${esc(e.nome)}${e.archiviato === SI ? ' <span class="tenue">(archiviato)</span>' : ''}</span>
    <span class="tenue">${esc(TIPI_ES[e.tipo] || e.tipo)}${e.gruppo ? ' · ' + esc(e.gruppo) : ''}${e.attrezzo ? ' · ' + esc(e.attrezzo) : ''}${RIAB[e.area] ? ` <span class="tag">${esc(e.area)}</span>` : ''}</span></button>`).join('');
}

/* ---------- Modulo di un esercizio (nuovo o da modificare) ---------- */
function datalist(id, valori) {
  return `<datalist id="${id}">${[...new Set(valori.filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}
function disegnaFormEsercizio() {
  const b = S.bozzaEs;
  if (!b) { S.schermata = 'esercizi'; return disegnaArchivio(); }
  const scelte = (campo, opzioni) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${b[campo] === v ? 'si' : ''}" data-azione="bozza-scelta" data-campo="${campo}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  const tutti = vivi('Esercizi');
  return testata(b.id ? 'Esercizio' : 'Nuovo esercizio', 'torna-esercizi') + `<div class="pila"><div class="card">
    <div class="campo-modulo"><label for="f-nome">Nome</label><input class="testo" id="f-nome" value="${esc(b.nome)}"></div>
    <div class="tenue">Tipo</div>${scelte('tipo', TIPI_ES)}
    ${b.id && b.tipoOriginale && b.tipo !== b.tipoOriginale ? '<p class="tenue">Cambiare il tipo non modifica le serie già registrate.</p>' : ''}
    <div class="tenue">Area</div>${scelte('area', AREE)}
    <div class="campo-modulo"><label for="f-attrezzo">Attrezzo</label><input class="testo" id="f-attrezzo" list="l-attrezzi" value="${esc(b.attrezzo)}"></div>
    <div class="campo-modulo"><label for="f-gruppo">Gruppo muscolare</label><input class="testo" id="f-gruppo" list="l-gruppi" value="${esc(b.gruppo)}"></div>
    <div class="campo-modulo"><label for="f-recupero">Recupero predefinito (secondi, 0 = nessun timer)</label><input class="testo" id="f-recupero" inputmode="numeric" value="${esc(b.recupero_s)}"></div>
    <div class="campo-modulo"><label for="f-nota">Nota</label><textarea class="testo" id="f-nota">${esc(b.nota)}</textarea></div>
    <div class="campo-modulo"><label for="f-strong">Nomi in Strong (separati da «; »)</label><input class="testo" id="f-strong" value="${esc(b.nome_strong)}"></div>
    <div class="tenue">Archiviato (nascosto dalla ricerca, resta nello storico)</div>${scelte('archiviato', { no: 'No', 'sì': 'Sì' })}
    <p class="errore" id="f-errore" style="font-size:13px"></p>
    <button class="btn largo" data-azione="salva-esercizio">Salva</button>
    ${datalist('l-attrezzi', tutti.map(e => e.attrezzo))}${datalist('l-gruppi', tutti.map(e => e.gruppo))}
  </div></div>`;
}
function leggiFormEsercizio() {
  const b = S.bozzaEs;
  b.nome = $('#f-nome').value; b.attrezzo = $('#f-attrezzo').value; b.gruppo = $('#f-gruppo').value;
  b.recupero_s = $('#f-recupero').value; b.nota = $('#f-nota').value; b.nome_strong = $('#f-strong').value;
}

/* ---------- Modello (modifica) ---------- */
function disegnaVoceModello(me, lettera) {
  const es = riga('Esercizi', me.esercizio_id);
  const tipo = tipoDi(es);
  const serie = previsteDi(me.id);
  const recEs = es ? num(es.recupero_s) : NaN;
  let html = `<div class="card" style="padding:12px 8px">
    <div class="fila" style="padding:0 4px 8px;align-items:flex-start"><div>
      <div class="es-titolo">${lettera ? lettera + ' · ' : ''}${esc(es ? es.nome : 'Esercizio non trovato (' + me.esercizio_id + ')')}</div>
      ${es && RIAB[es.area] ? `<span class="tag">${esc(es.area)}</span>` : ''}<span class="tenue">${esc(TIPI_ES[tipo])}</span>
    </div><button class="icona" data-azione="menu-es" data-scheda="ModelliEsercizi" data-id="${esc(me.id)}" aria-label="Opzioni esercizio">${ic('dots')}</button></div>
    <div class="riab-riga" style="grid-template-columns:84px minmax(0,1fr);padding:0 4px"><span class="tenue">Recupero (s)</span>
      <input class="testo" inputmode="numeric" data-me-campo="recupero_s" data-id="${esc(me.id)}" value="${esc(fmtNum(me.recupero_s))}" placeholder="${isNaN(recEs) ? 'nessuno' : recEs + ' (dell\'esercizio)'}"></div>
    <div style="padding:0 4px 8px"><input class="testo" placeholder="Indicazione per la sessione (es. lento in discesa)" data-me-campo="nota" data-id="${esc(me.id)}" value="${esc(me.nota)}"></div>`;
  html += intestazioneSerie(tipo, false);
  serie.forEach(s => { html += rigaSerie('ModelliSerie', tipo, serie, s, lettera, null); });
  html += `<div class="riga-btn" style="padding:8px 4px 0">
    <button class="btn2" style="font-size:14px" data-azione="aggiungi-serie" data-scheda="ModelliSerie" data-padre="${esc(me.id)}">${ic('plus')} Serie</button>
    <button class="btn2" style="font-size:14px" data-azione="copia-precedente" data-scheda="ModelliSerie" data-padre="${esc(me.id)}">${ic('copy')} Copia precedente</button></div>`;
  return html + `</div>`;
}
function disegnaModello() {
  const m = riga('Modelli', S.modelloId);
  if (!m || m.eliminato === SI) { S.schermata = 'esercizi'; return disegnaArchivio(); }
  const voci = vociDi(m.id);
  let html = testata('Modello', 'torna-modelli', `<button class="icona" data-azione="menu-modello" aria-label="Opzioni modello">${ic('dots')}</button>`) + `<div class="pila">
    <div class="card">
      <div class="campo-modulo"><label for="m-nome">Nome</label><input class="testo" id="m-nome" data-mod-campo="nome" value="${esc(m.nome)}"></div>
      <div class="campo-modulo"><label for="m-cartella">Cartella</label><input class="testo" id="m-cartella" list="l-cartelle" data-mod-campo="cartella" value="${esc(m.cartella)}"></div>
      <div class="campo-modulo"><label for="m-ordine">Ordine nella cartella</label><input class="testo" id="m-ordine" inputmode="numeric" data-mod-campo="ordine" value="${esc(fmtNum(m.ordine))}"></div>
      <div class="campo-modulo" style="margin:0"><label for="m-nota">Nota</label><textarea class="testo" id="m-nota" data-mod-campo="nota">${esc(m.nota)}</textarea></div>
      ${datalist('l-cartelle', vivi('Modelli').map(x => x.cartella))}
    </div>`;
  html += disegnaBlocchi(voci, disegnaVoceModello);
  if (!voci.length) html += `<div class="vuoto-msg">Nessun esercizio nel modello.</div>`;
  html += `<button class="btn2 largo" data-azione="aggiungi-es" data-per="modello">${ic('plus')} Esercizio</button>
    <button class="btn largo" data-azione="avvia-modello" data-id="${esc(m.id)}">${ic('play')} Inizia una sessione</button></div>`;
  return html;
}

/* ---------- Test ---------- */
function disegnaTest() {
  return testata('Test') + `<div class="vuoto-msg">La registrazione dei test (WBLT, heel raise, equilibrio, leg extension, step-down) arriva nella fase 4.</div>`;
}

/* ---------- Impostazioni ---------- */
function disegnaImpostazioni() {
  return testata('Impostazioni', 'torna-oggi') + `<div class="pila">
    <div class="card">
      <h2>Ponte con il foglio</h2>
      <div class="campo-modulo" style="margin-top:10px"><label for="imp-url">Indirizzo dell'app web (Apps Script)</label>
        <input class="testo" id="imp-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(meta.url || '')}"></div>
      <div class="campo-modulo"><label for="imp-token">Token</label>
        <input class="testo" id="imp-token" type="password" autocomplete="off" placeholder="${meta.token ? 'già impostato: scrivi per cambiarlo' : 'la chiave che hai messo in GYM_TOKEN'}"></div>
      <div class="riga-btn"><button class="btn" data-azione="imp-salva">Salva</button><button class="btn2" data-azione="imp-prova">Prova</button></div>
      <p class="tenue" id="imp-esito"></p>
    </div>
    <div class="card">
      <h2>Sincronizzazione</h2>
      <p class="tenue" style="margin:8px 0">Modifiche in coda: <b>${codaQuante}</b><br>
        Ultimo invio: ${esc(meta.ultimoInvio || 'mai')}<br>Ultima lettura dal foglio: ${esc(meta.ultimaLettura || 'mai')}<br>
        ${meta.ultimoErrore ? `<span class="errore">Ultimo errore: ${esc(meta.ultimoErrore)}</span>` : 'Nessun errore'}</p>
      <div class="riga-btn"><button class="btn2" data-azione="imp-sync">Sincronizza ora</button><button class="btn2" data-azione="imp-riscarica">Rileggi tutto</button></div>
    </div>
    <div class="card">
      <h2>Storico di Strong</h2>
      <p class="tenue" style="margin:8px 0">In Strong, dalle impostazioni, usa la voce per esportare i dati (export): ottieni un file CSV. Poi sceglilo qui. Prima di scrivere ti mostro un riepilogo. Le sessioni già importate non vengono ripetute.</p>
      <button class="btn2 largo" data-azione="scegli-csv">${ic('upload')} Scegli il file CSV</button>
      <input type="file" id="file-strong" accept=".csv,text/csv,text/comma-separated-values,text/plain" hidden>
    </div>
    <div class="card">
      <h2>Copia di sicurezza</h2>
      <p class="tenue" style="margin:8px 0">Scarica in un file tutti i dati presenti sul telefono (senza il token).</p>
      <button class="btn2 largo" data-azione="imp-esporta">Esporta i dati</button>
    </div>
    <p class="tenue" style="text-align:center">Unità di peso: kg · Gym, fase 2</p>
  </div>`;
}

/* ======================= Importazione da Strong ======================= */

function leggiCSV(testo) {
  testo = testo.replace(/^﻿/, '');
  const fineRiga = testo.indexOf('\n');
  const prima = fineRiga === -1 ? testo : testo.slice(0, fineRiga);
  const sep = (prima.match(/;/g) || []).length > (prima.match(/,/g) || []).length ? ';' : ',';
  const righe = [];
  let campo = '', r = [], virgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virgolette) {
      if (c === '"') { if (testo[i + 1] === '"') { campo += '"'; i++; } else virgolette = false; }
      else campo += c;
    } else if (c === '"') virgolette = true;
    else if (c === sep) { r.push(campo); campo = ''; }
    else if (c === '\n') { r.push(campo); righe.push(r); r = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || r.length) { r.push(campo); righe.push(r); }
  return righe.filter(x => x.some(v => v.trim() !== ''));
}

function normalizzaData(t) {
  const m = String(t).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}`;
}
function secondiDaDurata(t) {
  const s = String(t || '');
  const h = s.match(/(\d+)\s*h/), m = s.match(/(\d+)\s*m(?!s)/), sec = s.match(/(\d+)\s*s/);
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (sec ? +sec[1] : 0);
}

/** Analizza il CSV di Strong senza scrivere nulla. Restituisce le righe da salvare e un riepilogo. */
function analizzaStrong(testo) {
  const righe = leggiCSV(testo);
  if (righe.length < 2) throw new Error('il file è vuoto');
  const intest = righe[0].map(h => h.trim());
  const col = nome => intest.indexOf(nome);
  const servono = ['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight', 'Reps'];
  const mancano = servono.filter(n => col(n) === -1);
  if (mancano.length) throw new Error('mancano le colonne: ' + mancano.join(', '));
  const val = (r, nome) => (col(nome) === -1 ? '' : String(r[col(nome)] ?? '').trim());

  // Esercizi conosciuti, cercati per nome di Strong (anche più nomi separati da «;»).
  const perNomeStrong = new Map();
  vivi('Esercizi').forEach(e => String(e.nome_strong || '').split(';').map(n => n.trim().toLowerCase()).filter(Boolean)
    .forEach(n => { if (!perNomeStrong.has(n)) perNomeStrong.set(n, e.id); }));
  // Sessioni già presenti (anche eliminate): stessa ora di inizio e stesso titolo.
  const giaPresenti = new Set([...D.Sessioni.values()].map(s => normalizzaData(s.inizio) + '|' + String(s.titolo).trim()));

  const sessioni = new Map(); // chiave -> { sess, esercizi: Map(nome -> {se, serie[]}) }
  const nuoviEsercizi = new Map();
  let saltate = 0, distanze = 0, lbs = 0, gia = 0;
  const giaViste = new Set();
  for (let i = 1; i < righe.length; i++) {
    const r = righe[i];
    const inizio = normalizzaData(val(r, 'Date'));
    const titolo = val(r, 'Workout Name') || 'Allenamento';
    const nomeEs = val(r, 'Exercise Name');
    if (!inizio || !nomeEs) { saltate++; continue; }
    const chiave = inizio + '|' + titolo;
    if (giaPresenti.has(chiave)) { if (!giaViste.has(chiave)) { giaViste.add(chiave); gia++; } continue; }
    const ordine = val(r, 'Set Order').toUpperCase();
    let tipoSerie;
    if (/^\d+$/.test(ordine) || ordine === 'D') tipoSerie = 'normale';
    else if (ordine === 'W') tipoSerie = 'riscaldamento';
    else if (ordine === 'F') tipoSerie = 'cedimento';
    else { saltate++; continue; } // per esempio le righe del timer di riposo

    let gruppo = sessioni.get(chiave);
    if (!gruppo) {
      const dur = secondiDaDurata(val(r, 'Workout Duration'));
      const fine = dur ? ora(new Date(dataDa(inizio).getTime() + dur * 1000)) : inizio;
      gruppo = { sess: nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo, modello_id: '', inizio, fine, nota: '' }), esercizi: new Map() };
      sessioni.set(chiave, gruppo);
    }
    const notaSess = val(r, 'Workout Notes');
    if (notaSess && !gruppo.sess.nota) gruppo.sess.nota = notaSess;

    let esId = perNomeStrong.get(nomeEs.toLowerCase());
    if (!esId) {
      let nuovo = nuoviEsercizi.get(nomeEs.toLowerCase());
      if (!nuovo) {
        nuovo = nuovaRiga('Esercizi', { id: nuovoId('EX'), nome: nomeEs, nome_strong: nomeEs, tipo: 'peso_rip', area: 'altro', recupero_s: 0, origine: 'app', archiviato: NO });
        nuoviEsercizi.set(nomeEs.toLowerCase(), nuovo);
      }
      esId = nuovo.id;
    }
    let es = gruppo.esercizi.get(esId);
    if (!es) {
      es = { se: nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: gruppo.sess.id, posizione: gruppo.esercizi.size + 1, esercizio_id: esId }), serie: [], note: [] };
      gruppo.esercizi.set(esId, es);
    }
    const nota = val(r, 'Notes');
    if (nota && !es.note.includes(nota)) es.note.push(nota);

    let peso = leggiNum(val(r, 'Weight'));
    if (peso === null) peso = '';
    if (peso !== '' && /lb/i.test(val(r, 'Weight Unit'))) { peso = Math.round(peso * 0.45359237 * 100) / 100; lbs++; }
    let rip = leggiNum(val(r, 'Reps')); if (rip === null) rip = '';
    let sec = leggiNum(val(r, 'Seconds')); if (sec === null || sec === 0) sec = '';
    if (rip === 0 && sec !== '') rip = '';
    let rpe = leggiNum(val(r, 'RPE')); if (rpe === null || rpe === 0) rpe = '';
    if (leggiNum(val(r, 'Distance'))) distanze++;
    es.serie.push(nuovaRiga('Serie', { id: nuovoId('SR'), sessione_esercizio_id: es.se.id, posizione: es.serie.length + 1,
      tipo: tipoSerie, lato: 'entrambi', peso_kg: peso, rip: rip === '' ? '' : Math.round(rip), durata_s: sec === '' ? '' : Math.round(sec), rpe, fatta: SI }));
  }

  const daSalvare = [];
  nuoviEsercizi.forEach(e => daSalvare.push(['Esercizi', e]));
  let nSerie = 0;
  sessioni.forEach(g => {
    daSalvare.push(['Sessioni', g.sess]);
    g.esercizi.forEach(es => {
      es.se.nota = es.note.join('\n'); // le note restano testo: nessuna interpretazione
      daSalvare.push(['SessioniEsercizi', es.se]);
      es.serie.forEach(s => { daSalvare.push(['Serie', s]); nSerie++; });
    });
  });
  return {
    daSalvare, sessioni: sessioni.size, serie: nSerie, gia, saltate, distanze, lbs,
    nuovi: [...nuoviEsercizi.values()].map(e => e.nome).sort((a, b) => a.localeCompare(b, 'it')),
  };
}

function foglioRiepilogoImport(r) {
  const nomi = r.nuovi.slice(0, 40).map(esc).join('<br>') + (r.nuovi.length > 40 ? `<br>… e altri ${r.nuovi.length - 40}` : '');
  return `<h2>Importazione da Strong</h2>
    <div class="riepilogo" style="margin:14px 0"><div><b>${r.sessioni}</b><span class="tenue">sessioni</span></div>
      <div><b>${r.serie}</b><span class="tenue">serie</span></div><div><b>${r.nuovi.length}</b><span class="tenue">esercizi nuovi</span></div></div>
    ${r.gia ? `<p class="tenue">${r.gia} ${r.gia === 1 ? 'sessione era già importata e viene saltata' : 'sessioni erano già importate e vengono saltate'}.</p>` : ''}
    ${r.saltate ? `<p class="tenue">${r.saltate} righe saltate (senza data o esercizio, oppure righe del timer di riposo).</p>` : ''}
    ${r.distanze ? `<p class="tenue">${r.distanze} serie hanno una distanza: il foglio non ha una colonna per la distanza, quindi non viene importata.</p>` : ''}
    ${r.lbs ? `<p class="tenue">${r.lbs} pesi erano in libbre e sono stati convertiti in kg.</p>` : ''}
    ${r.nuovi.length ? `<p class="tenue">Esercizi senza corrispondenza in «nome_strong»: verranno creati come «peso e ripetizioni», area «altro». Potrai correggerli in Esercizi.</p>
      <div class="card" style="max-height:30vh;overflow:auto;font-size:14px">${nomi}</div>` : ''}
    <p class="errore" id="imp-errore" style="font-size:13px"></p>
    <div class="riga-btn" style="margin-top:12px"><button class="btn2" data-azione="chiudi-foglio">Annulla</button>
      ${r.sessioni ? `<button class="btn" data-azione="conferma-import">Importa</button>` : ''}</div>`;
}

/* ======================= Fogli dal basso ======================= */

function apriFoglio(html) { $('#foglio').innerHTML = html; $('#velo').hidden = false; }
function chiudiFoglio() { $('#velo').hidden = true; $('#foglio').innerHTML = ''; }
$('#velo').addEventListener('click', e => { if (e.target.id === 'velo' && !conto) chiudiFoglio(); });

let avvisoTimeout = null, avvisoAzione = null;
function mostraAvviso(testo, annulla) {
  $('#avviso-testo').textContent = testo;
  avvisoAzione = annulla || null;
  $('#avviso-azione').hidden = !annulla;
  $('#avviso').hidden = false;
  clearTimeout(avvisoTimeout);
  avvisoTimeout = setTimeout(() => { $('#avviso').hidden = true; avvisoAzione = null; }, 6000);
}
$('#avviso-azione').addEventListener('click', async () => {
  const f = avvisoAzione; avvisoAzione = null; $('#avviso').hidden = true;
  if (f) { await f(); disegna(); }
});

function foglioScelteSerie(scheda, s) {
  const gruppo = (nome, opzioni, attuale) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${attuale === v ? 'si' : ''}" data-azione="serie-${nome}" data-scheda="${scheda}" data-id="${esc(s.id)}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  return `<h2>Serie</h2>
    <div class="tenue">Tipo</div>${gruppo('tipo', TIPI_SERIE, s.tipo || 'normale')}
    <div class="tenue">Lato</div>${gruppo('lato', LATI, s.lato || 'entrambi')}
    <button class="voce" data-azione="serie-copia" data-scheda="${scheda}" data-id="${esc(s.id)}">${ic('copy')} Duplica questa serie</button>
    <button class="voce" data-azione="serie-elimina" data-scheda="${scheda}" data-id="${esc(s.id)}" style="color:var(--rosso)">${ic('trash')} Elimina la serie</button>`;
}

function foglioSceltaEsercizio() {
  return `<h2>Aggiungi un esercizio</h2>
    <input class="testo" type="search" placeholder="Cerca" data-ricerca="scelta" value="${esc(S.ricerca)}" style="margin-bottom:8px">
    <button class="voce" data-azione="nuovo-es" style="color:var(--blu-chiaro)">${ic('plus')} Nuovo esercizio</button>
    <div id="lista-scelta">${righeScelta()}</div>`;
}
function righeScelta() {
  const lista = elencoEsercizi(S.ricerca);
  if (!lista.length) return `<div class="vuoto-msg">Nessun esercizio trovato.</div>`;
  return lista.map(e => `<button class="voce" data-azione="scegli-es" data-id="${esc(e.id)}"><span>${esc(e.nome)}<br><span class="tenue">${esc(TIPI_ES[e.tipo] || e.tipo)}${RIAB[e.area] ? ' · ' + esc(e.area) : ''}</span></span></button>`).join('');
}

function foglioNuovoEsercizio() {
  const n = S.nuovoEs;
  const gruppo = (campo, opzioni) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${n[campo] === v ? 'si' : ''}" data-azione="nuovo-es-scelta" data-campo="${campo}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  return `<h2>Nuovo esercizio</h2>
    <div class="campo-modulo"><label for="nes-nome">Nome</label><input class="testo" id="nes-nome" value="${esc(n.nome)}"></div>
    <div class="tenue">Tipo</div>${gruppo('tipo', TIPI_ES)}
    <div class="tenue">Area</div>${gruppo('area', AREE)}
    <div class="campo-modulo"><label for="nes-rec">Recupero (secondi, 0 = nessun timer)</label><input class="testo" id="nes-rec" inputmode="numeric" value="${esc(n.recupero_s)}"></div>
    <p class="tenue errore" id="nes-errore"></p>
    <div class="riga-btn"><button class="btn2" data-azione="aggiungi-es">Indietro</button><button class="btn" data-azione="salva-nuovo-es">Crea e aggiungi</button></div>`;
}

/* ======================= Azioni ======================= */

async function creaSessioneDaModello(modello) {
  const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: modello.nome, modello_id: modello.id, inizio: ora(), fine: '' });
  const daSalvare = [['Sessioni', sess]];
  // Copia del modello: cambiare il modello dopo non tocca questa sessione.
  const voci = vociDi(modello.id);
  const nuoviSS = {};
  voci.forEach((me, i) => {
    const ss = compagno(voci, me) ? (nuoviSS[me.superserie_id] = nuoviSS[me.superserie_id] || nuovoId('SS')) : '';
    const se = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: sess.id, posizione: i + 1, esercizio_id: me.esercizio_id, superserie_id: ss });
    daSalvare.push(['SessioniEsercizi', se]);
    const previste = previsteDi(me.id);
    (previste.length ? previste : [{}]).forEach((ms, j) => {
      daSalvare.push(['Serie', nuovaRiga('Serie', {
        id: nuovoId('SR'), sessione_esercizio_id: se.id, posizione: j + 1,
        tipo: ms.tipo || 'normale', lato: ms.lato || 'entrambi',
        peso_kg: ms.peso_kg ?? '', rip: ms.rip ?? '', durata_s: ms.durata_s ?? '', rpe: '', fatta: NO,
      })]);
    });
  });
  await salvaLista(daSalvare);
  return sess;
}

async function aggiungiEsercizio(esercizioId) {
  let nuova;
  if (S.sceltaPer === 'modello') {
    const voci = vociDi(S.modelloId);
    nuova = nuovaRiga('ModelliEsercizi', { id: nuovoId('ME'), modello_id: S.modelloId, posizione: voci.length + 1, esercizio_id: esercizioId, recupero_s: '' });
    const ms = nuovaRiga('ModelliSerie', { id: nuovoId('MS'), modello_esercizio_id: nuova.id, posizione: 1, tipo: 'normale', lato: 'entrambi' });
    await salva(['ModelliEsercizi', nuova], ['ModelliSerie', ms]);
  } else {
    const esistenti = eserciziDi(S.sessioneId);
    nuova = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: S.sessioneId, posizione: esistenti.length + 1, esercizio_id: esercizioId });
    const s = nuovaRiga('Serie', { id: nuovoId('SR'), sessione_esercizio_id: nuova.id, posizione: 1, tipo: 'normale', lato: 'entrambi', fatta: NO });
    await salva(['SessioniEsercizi', nuova], ['Serie', s]);
  }
  chiudiFoglio();
  disegna();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function avvisoSessioneGiaAperta() {
  apriFoglio(`<h2>C'è già una sessione in corso</h2><p class="tenue">Riprendila o terminala prima di iniziarne un'altra.</p>
    <button class="btn largo" data-azione="riprendi">Riprendi</button>`);
}

async function eliminaRiga(scheda, id) {
  const r = riga(scheda, id);
  r.eliminato = SI; await salva([scheda, r]);
  disegna();
  mostraAvviso(scheda.includes('Serie') ? 'Serie eliminata' : 'Eliminato', async () => { r.eliminato = NO; await salva([scheda, r]); });
}

async function duplicaModello(m) {
  const copia = nuovaRiga('Modelli', Object.assign(soloSchema('Modelli', m), { id: nuovoId('MOD'), nome: m.nome + ' (copia)', eliminato: NO }));
  const daSalvare = [['Modelli', copia]];
  const voci = vociDi(m.id);
  const nuoviSS = {};
  voci.forEach(me => {
    const ss = compagno(voci, me) ? (nuoviSS[me.superserie_id] = nuoviSS[me.superserie_id] || nuovoId('SS')) : '';
    const nme = nuovaRiga('ModelliEsercizi', Object.assign(soloSchema('ModelliEsercizi', me), { id: nuovoId('ME'), modello_id: copia.id, superserie_id: ss, eliminato: NO }));
    daSalvare.push(['ModelliEsercizi', nme]);
    previsteDi(me.id).forEach(ms => daSalvare.push(['ModelliSerie',
      nuovaRiga('ModelliSerie', Object.assign(soloSchema('ModelliSerie', ms), { id: nuovoId('MS'), modello_esercizio_id: nme.id, eliminato: NO }))]));
  });
  await salvaLista(daSalvare);
  return copia;
}

function nomeVoce(scheda, r) {
  const es = riga('Esercizi', r.esercizio_id);
  return es ? es.nome : 'Esercizio';
}

const AZIONI = {
  'torna-oggi': () => vai('oggi'),
  'torna-esercizi': () => vai('esercizi', { vistaArchivio: 'esercizi' }),
  'torna-modelli': () => vai('esercizi', { vistaArchivio: 'modelli' }),
  'riprendi': () => { chiudiFoglio(); const s = sessioneInCorso(); if (s) { vai('sessione', { sessioneId: s.id }); controllaWakeLock(); } },
  'nuova-vuota': async () => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: 'Allenamento', modello_id: '', inizio: ora(), fine: '' });
    await salva(['Sessioni', sess]);
    vai('sessione', { sessioneId: sess.id }); controllaWakeLock();
    S.ricerca = ''; S.sceltaPer = 'sessione'; apriFoglio(foglioSceltaEsercizio());
  },
  'avvia-modello': async el => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const sess = await creaSessioneDaModello(riga('Modelli', el.dataset.id));
    vai('sessione', { sessioneId: sess.id }); controllaWakeLock();
  },
  'apri-sessione': el => vai('sessione', { sessioneId: el.dataset.id }),
  'chiudi-sessione': () => vai('storico'),
  'storico-tutte': () => { S.storicoTutte = true; disegna(); },
  'rinomina-sessione': () => {
    const sess = riga('Sessioni', S.sessioneId);
    apriFoglio(`<h2>Titolo della sessione</h2><input class="testo" id="titolo-sess" value="${esc(sess.titolo)}" style="margin-bottom:10px">
      <button class="btn largo" data-azione="salva-titolo">Salva</button>`);
  },
  'salva-titolo': async () => {
    const sess = riga('Sessioni', S.sessioneId);
    const t = $('#titolo-sess').value.trim();
    if (t) { sess.titolo = t; await salva(['Sessioni', sess]); }
    chiudiFoglio(); disegna();
  },
  'fine-sessione': () => {
    const sess = riga('Sessioni', S.sessioneId);
    const r = riepilogoSessione(sess);
    const nonFatte = r.totali - r.fatte;
    apriFoglio(`<h2>Fine della sessione</h2>
      <div class="riepilogo" style="margin:14px 0"><div><b>${fmtMinuti(r.durata)}</b><span class="tenue">durata</span></div>
        <div><b>${r.fatte}</b><span class="tenue">serie fatte</span></div><div><b>${r.volume ? fmtKg(r.volume) : '—'}</b><span class="tenue">volume</span></div></div>
      ${nonFatte ? `<p class="tenue">${nonFatte} ${nonFatte === 1 ? 'serie non spuntata resta registrata' : 'serie non spuntate restano registrate'} come non fatta.</p>` : ''}
      <div class="riga-btn"><button class="btn2" data-azione="chiudi-foglio">Continua</button><button class="btn verde" data-azione="conferma-fine">Salva</button></div>`);
  },
  'conferma-fine': async () => {
    const sess = riga('Sessioni', S.sessioneId);
    sess.fine = ora();
    await salva(['Sessioni', sess]);
    chiudiFoglio(); fermaTimer(); tieniAcceso(false);
    mostraAvviso('Sessione salvata');
    vai('oggi');
    sincronizza();
  },
  'elimina-sessione': () => {
    const aperta = sessioneAperta(riga('Sessioni', S.sessioneId));
    apriFoglio(`<h2>${aperta ? 'Annullare la sessione?' : 'Eliminare la sessione?'}</h2>
      <p class="tenue">Resta nel foglio segnata come eliminata. Puoi annullare subito dopo.</p>
      <div class="riga-btn"><button class="btn2" data-azione="chiudi-foglio">No</button><button class="btn" style="background:#b91c1c" data-azione="conferma-elimina-sessione">Sì, elimina</button></div>`);
  },
  'conferma-elimina-sessione': async () => {
    const sess = riga('Sessioni', S.sessioneId);
    const eraAperta = sessioneAperta(sess);
    sess.eliminato = SI;
    await salva(['Sessioni', sess]);
    chiudiFoglio();
    if (eraAperta) { fermaTimer(); tieniAcceso(false); }
    vai(eraAperta ? 'oggi' : 'storico');
    mostraAvviso('Sessione eliminata', async () => { sess.eliminato = NO; await salva(['Sessioni', sess]); controllaWakeLock(); });
  },

  /* --- Serie (della sessione o previste nel modello) --- */
  'spunta': async el => {
    const s = riga('Serie', el.dataset.id);
    s.fatta = s.fatta === SI ? NO : SI;
    await salva(['Serie', s]);
    const r = document.querySelector(`.serie[data-id="${CSS.escape(s.id)}"]`);
    if (r) r.classList.toggle('fatta', s.fatta === SI);
    if (s.fatta === SI) {
      if (navigator.vibrate) navigator.vibrate(30);
      timerDopoSerie(s);
    }
    const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
    const es = se && riga('Esercizi', se.esercizio_id);
    if (es && (es.tipo === 'durata' || es.tipo === 'peso_durata')) disegna(); // aggiorna «Avvia serie»
  },
  'usa-precedente': async el => {
    const s = riga('Serie', el.dataset.id);
    const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
    const tipo = tipoDi(riga('Esercizi', se.esercizio_id));
    const campi = { peso_kg: 'peso', rip: 'rip', durata_s: 'durata' };
    COLONNE_TIPO[tipo].forEach(([c]) => {
      const reale = c === 'durata_min' ? 'durata_s' : c;
      const v = el.dataset[campi[reale]];
      if (v !== undefined && v !== '') s[reale] = Number(v);
    });
    await salva(['Serie', s]); disegna();
  },
  'menu-serie': el => apriFoglio(foglioScelteSerie(el.dataset.scheda, riga(el.dataset.scheda, el.dataset.id))),
  'serie-tipo': async el => { const s = riga(el.dataset.scheda, el.dataset.id); s.tipo = el.dataset.valore; await salva([el.dataset.scheda, s]); chiudiFoglio(); disegna(); },
  'serie-lato': async el => { const s = riga(el.dataset.scheda, el.dataset.id); s.lato = el.dataset.valore; await salva([el.dataset.scheda, s]); chiudiFoglio(); disegna(); },
  'serie-copia': async el => {
    const scheda = el.dataset.scheda;
    const s = riga(scheda, el.dataset.id);
    const lista = fratelliDi(scheda, s);
    const copia = nuovaRiga(scheda, Object.assign(soloSchema(scheda, s), { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), eliminato: NO }));
    if (scheda === 'Serie') copia.fatta = NO;
    lista.splice(lista.indexOf(s) + 1, 0, copia);
    lista.forEach((r, i) => { r.posizione = i + 1; });
    await salvaLista(lista.map(r => [scheda, r]));
    chiudiFoglio(); disegna();
  },
  'serie-elimina': el => { chiudiFoglio(); return eliminaRiga(el.dataset.scheda, el.dataset.id); },
  'aggiungi-serie': async el => {
    const scheda = el.dataset.scheda;
    const lista = figli(scheda, el.dataset.padre);
    const ultima = lista[lista.length - 1];
    // Se l'ultima era per un lato, la nuova va sull'altro lato (le serie per lato si alternano).
    const lato = !ultima ? 'entrambi' : ultima.lato === 'dx' ? 'sx' : ultima.lato === 'sx' ? 'dx' : ultima.lato;
    const nuova = nuovaRiga(scheda, { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), [PADRE[scheda]]: el.dataset.padre, posizione: lista.length + 1,
      tipo: ultima && ultima.tipo !== 'riscaldamento' ? ultima.tipo : 'normale', lato });
    if (scheda === 'Serie') nuova.fatta = NO;
    await salva([scheda, nuova]); disegna();
  },
  'copia-precedente': async el => {
    const scheda = el.dataset.scheda;
    const lista = figli(scheda, el.dataset.padre);
    const ultima = lista[lista.length - 1];
    const nuova = nuovaRiga(scheda, ultima
      ? Object.assign(soloSchema(scheda, ultima), { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), posizione: lista.length + 1, eliminato: NO })
      : { id: nuovoId(scheda === 'Serie' ? 'SR' : 'MS'), [PADRE[scheda]]: el.dataset.padre, posizione: 1, tipo: 'normale', lato: 'entrambi' });
    if (scheda === 'Serie') nuova.fatta = NO;
    await salva([scheda, nuova]); disegna();
  },
  'avvia-durata': el => avviaConto(el.dataset.id),
  'conto-ferma': () => chiudiConto(true),
  'conto-annulla': () => chiudiConto(false),

  /* --- Esercizi dentro una sessione o un modello --- */
  'menu-es': el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    const comp = compagno(fratelliDi(scheda, r), r);
    const attr = `data-scheda="${scheda}" data-id="${esc(r.id)}"`;
    apriFoglio(`<h2>${esc(nomeVoce(scheda, r))}</h2>
      <button class="voce" data-azione="sposta-es" ${attr} data-valore="-1">${ic('arrow-up')} Sposta su</button>
      <button class="voce" data-azione="sposta-es" ${attr} data-valore="1">${ic('arrow-down')} Sposta giù</button>
      ${comp ? `<button class="voce" data-azione="scollega" ${attr}>${ic('unlink')} Scollega la superserie</button>`
        : `<button class="voce" data-azione="collega-scegli" ${attr}>${ic('link')} Collega in superserie</button>`}
      <button class="voce" data-azione="rimuovi-es" ${attr} style="color:var(--rosso)">${ic('trash')} Rimuovi</button>`);
  },
  'sposta-es': async el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    const bl = blocchi(fratelliDi(scheda, r));
    const i = bl.findIndex(b => b.includes(r)), j = i + Number(el.dataset.valore);
    if (j >= 0 && j < bl.length) {
      [bl[i], bl[j]] = [bl[j], bl[i]];
      const cambiate = [];
      bl.flat().forEach((x, k) => { if (num(x.posizione) !== k + 1) { x.posizione = k + 1; cambiate.push([scheda, x]); } });
      await salvaLista(cambiate);
    }
    chiudiFoglio(); disegna();
  },
  'collega-scegli': el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    const lista = fratelliDi(scheda, r);
    const liberi = lista.filter(x => x !== r && !compagno(lista, x));
    apriFoglio(`<h2>Superserie con…</h2>
      ${liberi.length ? liberi.map(x => `<button class="voce" data-azione="collega" data-scheda="${scheda}" data-id="${esc(r.id)}" data-altro="${esc(x.id)}">${ic('link')} ${esc(nomeVoce(scheda, x))}</button>`).join('')
        : '<p class="tenue">Non ci sono altri esercizi liberi da collegare.</p>'}`);
  },
  'collega': async el => {
    const scheda = el.dataset.scheda;
    const a = riga(scheda, el.dataset.id), b = riga(scheda, el.dataset.altro);
    const id = nuovoId('SS');
    a.superserie_id = id; b.superserie_id = id;
    // B si sposta subito dopo A.
    const lista = fratelliDi(scheda, a).filter(x => x !== b);
    lista.splice(lista.indexOf(a) + 1, 0, b);
    lista.forEach((x, k) => { x.posizione = k + 1; });
    await salvaLista(lista.map(x => [scheda, x]));
    chiudiFoglio(); disegna();
  },
  'scollega': async el => {
    const scheda = el.dataset.scheda;
    const a = riga(scheda, el.dataset.id);
    const b = compagno(fratelliDi(scheda, a), a);
    a.superserie_id = '';
    const daSalvare = [[scheda, a]];
    if (b) { b.superserie_id = ''; daSalvare.push([scheda, b]); }
    await salvaLista(daSalvare);
    chiudiFoglio(); disegna();
  },
  'rimuovi-es': async el => {
    const scheda = el.dataset.scheda;
    const r = riga(scheda, el.dataset.id);
    r.eliminato = SI; await salva([scheda, r]);
    chiudiFoglio(); disegna();
    mostraAvviso('Esercizio rimosso', async () => { r.eliminato = NO; await salva([scheda, r]); });
  },
  'aggiungi-es': el => {
    if (el.dataset.per) S.sceltaPer = el.dataset.per;
    S.ricerca = ''; apriFoglio(foglioSceltaEsercizio());
  },
  'scegli-es': el => aggiungiEsercizio(el.dataset.id),
  'nuovo-es': () => { S.nuovoEs = { nome: S.ricerca, tipo: 'peso_rip', area: 'altro', recupero_s: '90' }; apriFoglio(foglioNuovoEsercizio()); },
  'nuovo-es-scelta': el => {
    S.nuovoEs.nome = $('#nes-nome').value; S.nuovoEs.recupero_s = $('#nes-rec').value;
    S.nuovoEs[el.dataset.campo] = el.dataset.valore; apriFoglio(foglioNuovoEsercizio());
  },
  'salva-nuovo-es': async () => {
    const nome = $('#nes-nome').value.trim();
    const rec = leggiNum($('#nes-rec').value);
    if (!nome) { $('#nes-errore').textContent = 'Scrivi il nome.'; return; }
    if (vivi('Esercizi').some(e => String(e.nome).toLowerCase() === nome.toLowerCase())) { $('#nes-errore').textContent = 'Esiste già un esercizio con questo nome.'; return; }
    if (rec === null || rec < 0) { $('#nes-errore').textContent = 'Il recupero deve essere un numero di secondi.'; return; }
    const es = nuovaRiga('Esercizi', { id: nuovoId('EX'), nome, tipo: S.nuovoEs.tipo, area: S.nuovoEs.area, recupero_s: rec === '' ? 0 : Math.round(rec), origine: 'app', archiviato: NO });
    await salva(['Esercizi', es]);
    await aggiungiEsercizio(es.id);
  },

  /* --- Archivio: esercizi e modelli --- */
  'vista-archivio': el => { S.vistaArchivio = el.dataset.valore; disegna(); },
  'mostra-archiviati': () => { S.mostraArchiviati = !S.mostraArchiviati; disegna(); },
  'nuovo-esercizio': () => vai('esercizio', { bozzaEs: { id: '', nome: S.ricercaArchivio, tipo: 'peso_rip', area: 'altro', attrezzo: '', gruppo: '', recupero_s: '90', nota: '', nome_strong: '', archiviato: NO } }),
  'apri-esercizio': el => {
    const e = riga('Esercizi', el.dataset.id);
    vai('esercizio', { bozzaEs: Object.assign(soloSchema('Esercizi', e), { recupero_s: fmtNum(e.recupero_s), tipoOriginale: e.tipo, archiviato: e.archiviato === SI ? SI : NO }) });
  },
  'bozza-scelta': el => { leggiFormEsercizio(); S.bozzaEs[el.dataset.campo] = el.dataset.valore; disegna(); },
  'salva-esercizio': async () => {
    leggiFormEsercizio();
    const b = S.bozzaEs;
    const errore = t => { $('#f-errore').textContent = t; };
    const nome = b.nome.trim();
    const rec = leggiNum(b.recupero_s);
    if (!nome) return errore('Scrivi il nome.');
    if (vivi('Esercizi').some(e => e.id !== b.id && String(e.nome).trim().toLowerCase() === nome.toLowerCase())) return errore('Esiste già un esercizio con questo nome.');
    if (rec === null || rec < 0) return errore('Il recupero deve essere un numero di secondi.');
    const e = b.id ? riga('Esercizi', b.id) : nuovaRiga('Esercizi', { id: nuovoId('EX'), origine: 'app' });
    Object.assign(e, {
      nome, tipo: b.tipo, area: b.area, attrezzo: b.attrezzo.trim(), gruppo: b.gruppo.trim(),
      recupero_s: rec === '' ? 0 : Math.round(rec), nota: b.nota.trim(),
      nome_strong: b.nome_strong.split(';').map(x => x.trim()).filter(Boolean).join('; '),
      archiviato: b.archiviato === SI ? SI : NO,
    });
    await salva(['Esercizi', e]);
    mostraAvviso('Esercizio salvato');
    vai('esercizi', { vistaArchivio: 'esercizi', bozzaEs: null });
  },
  'nuovo-modello': async () => {
    const modelli = vivi('Modelli');
    const m = nuovaRiga('Modelli', { id: nuovoId('MOD'), nome: 'Nuovo modello', cartella: '', ordine: modelli.length + 1 });
    await salva(['Modelli', m]);
    vai('modello', { modelloId: m.id });
    const campo = $('#m-nome'); if (campo) campo.select();
  },
  'apri-modello': el => vai('modello', { modelloId: el.dataset.id }),
  'menu-modello': () => apriFoglio(`<h2>Modello</h2>
    <button class="voce" data-azione="duplica-modello">${ic('copy')} Duplica il modello</button>
    <button class="voce" data-azione="elimina-modello" style="color:var(--rosso)">${ic('trash')} Elimina il modello</button>
    <p class="tenue">Le sessioni già fatte con questo modello non cambiano.</p>`),
  'duplica-modello': async () => {
    const copia = await duplicaModello(riga('Modelli', S.modelloId));
    chiudiFoglio();
    mostraAvviso('Modello duplicato');
    vai('modello', { modelloId: copia.id });
    S.schermata = 'modello'; disegna();
  },
  'elimina-modello': async () => {
    const m = riga('Modelli', S.modelloId);
    m.eliminato = SI; await salva(['Modelli', m]);
    chiudiFoglio();
    vai('esercizi', { vistaArchivio: 'modelli' });
    mostraAvviso('Modello eliminato', async () => { m.eliminato = NO; await salva(['Modelli', m]); });
  },

  /* --- Varie --- */
  'chiudi-foglio': () => chiudiFoglio(),
  'timer-meno': () => cambiaTimer(-15),
  'timer-piu': () => cambiaTimer(15),
  'timer-stop': () => fermaTimer(),
  'imp-salva': async () => {
    const url = $('#imp-url').value.trim();
    const token = $('#imp-token').value;
    if (url && !/^https:\/\//.test(url)) { $('#imp-esito').textContent = "L'indirizzo deve iniziare con https://"; return; }
    await salvaMeta('url', url);
    if (token) await salvaMeta('token', token);
    await salvaMeta('cursore', ''); // nuovo ponte: si rilegge tutto
    $('#imp-esito').textContent = 'Salvato.';
    sincronizza({ completo: true });
  },
  'imp-prova': async () => {
    $('#imp-esito').textContent = 'Provo…';
    try { await chiamaPonte({ azione: 'ping' }); $('#imp-esito').textContent = 'Connessione riuscita.'; }
    catch (e) { $('#imp-esito').textContent = 'Non riesco: ' + e.message; }
  },
  'imp-sync': () => sincronizza(),
  'imp-riscarica': () => sincronizza({ completo: true }),
  'imp-esporta': () => {
    const dati = { esportato_il: ora(), versione_schema: 1, schede: {} };
    SCHEDE.forEach(s => { dati.schede[s] = [...D[s].values()]; });
    const blob = new Blob([JSON.stringify(dati, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gym-backup-' + ora().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'scegli-csv': () => { const f = $('#file-strong'); f.value = ''; f.click(); },
  'conferma-import': async () => {
    const imp = S.importazione;
    if (!imp) return;
    const bottone = $('[data-azione="conferma-import"]');
    if (bottone) { bottone.disabled = true; bottone.textContent = 'Importo…'; }
    // Si ricontrolla subito prima di scrivere, nel caso il foglio sia cambiato nel frattempo.
    const giaPresenti = new Set([...D.Sessioni.values()].map(s => normalizzaData(s.inizio) + '|' + String(s.titolo).trim()));
    const doppie = imp.daSalvare.some(([sc, r]) => sc === 'Sessioni' && giaPresenti.has(normalizzaData(r.inizio) + '|' + String(r.titolo).trim()));
    if (doppie) { $('#imp-errore').textContent = 'Alcune sessioni risultano già importate: riapri il file.'; return; }
    await salvaLista(imp.daSalvare);
    S.importazione = null;
    chiudiFoglio();
    mostraAvviso(`Importate ${imp.sessioni} sessioni. Le invio al foglio…`);
    disegna();
    sincronizza();
  },
};

/* Scelta del file CSV di Strong. */
document.addEventListener('change', async e => {
  if (e.target.id !== 'file-strong' || !e.target.files.length) return;
  try {
    const testo = await e.target.files[0].text();
    S.importazione = analizzaStrong(testo);
    apriFoglio(foglioRiepilogoImport(S.importazione));
  } catch (err) {
    apriFoglio(`<h2>Non riesco a leggere il file</h2><p class="tenue">${esc(err.message)}</p><button class="btn2 largo" data-azione="chiudi-foglio">Chiudi</button>`);
  }
});

/* Trascinamento di una serie verso destra o sinistra: oltre il 40% della larghezza si elimina. */
let trascina = null, ultimoTrascinamento = 0;
document.addEventListener('pointerdown', e => {
  const r = e.target.closest('.scorri > .serie');
  if (!r || e.button > 0) return;
  trascina = { r, x0: e.clientX, y0: e.clientY, dx: 0, attivo: false, oltre: false, pid: e.pointerId };
});
document.addEventListener('pointermove', e => {
  const t = trascina;
  if (!t || e.pointerId !== t.pid) return;
  const dx = e.clientX - t.x0, dy = e.clientY - t.y0;
  if (!t.attivo) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { trascina = null; return; } // sta scorrendo la pagina
    if (Math.abs(dx) < 12) return;
    t.attivo = true;
    try { t.r.setPointerCapture(e.pointerId); } catch (err) { /* non indispensabile */ }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    t.r.parentNode.classList.add('in-trascinamento');
  }
  t.dx = dx;
  t.r.style.transform = `translateX(${dx}px)`;
  const oltre = Math.abs(dx) > t.r.offsetWidth * 0.4;
  if (oltre !== t.oltre && navigator.vibrate) navigator.vibrate(15); // avvisa quando si supera la soglia
  t.oltre = oltre;
  t.r.parentNode.classList.toggle('oltre', oltre);
});
function fineTrascina() {
  const t = trascina;
  trascina = null;
  if (!t || !t.attivo) return;
  ultimoTrascinamento = Date.now();
  const largo = t.r.offsetWidth;
  t.r.style.transition = 'transform .18s ease-out';
  if (t.oltre) {
    t.r.style.transform = `translateX(${Math.sign(t.dx) * largo}px)`;
    setTimeout(() => eliminaRiga(t.r.dataset.scheda, t.r.dataset.id), 180);
  } else {
    t.r.style.transform = '';
    setTimeout(() => { t.r.style.transition = ''; t.r.parentNode.classList.remove('in-trascinamento', 'oltre'); }, 200);
  }
}
document.addEventListener('pointerup', fineTrascina);
document.addEventListener('pointercancel', fineTrascina);
// Dopo un trascinamento il «clic» finale non deve spuntare la serie né aprire il menu.
document.addEventListener('click', e => {
  if (Date.now() - ultimoTrascinamento < 350) { e.stopPropagation(); e.preventDefault(); }
}, true);

document.addEventListener('click', async e => {
  sbloccaAudio();
  const vaiA = e.target.closest('[data-vai]');
  if (vaiA) {
    e.preventDefault(); chiudiFoglio();
    if (vaiA.dataset.vai === 'esercizi' && TAB_DI[S.schermata] !== 'esercizi') S.vistaArchivio = 'esercizi';
    vai(vaiA.dataset.vai); return;
  }
  const el = e.target.closest('[data-azione]');
  if (!el || !AZIONI[el.dataset.azione]) return;
  try { await AZIONI[el.dataset.azione](el); }
  catch (err) { mostraAvviso('Qualcosa non va: ' + err.message); }
});

/* Scrittura nei campi: si salva a ogni modifica, senza ridisegnare (il cursore resta dov'è). */
const LIMITI = { rpe: [0, 10], rpe_previsto: [0, 10], peso_kg: [0, 1000], rip: [0, 1000], durata_s: [0, 86400], durata_min: [0, 1440] };
function segnaValido(el, valido) { el.style.outline = valido ? '' : '2px solid var(--rosso)'; return valido; }
document.addEventListener('input', async e => {
  const el = e.target;
  if (el.dataset.ricerca === 'scelta') { S.ricerca = el.value; $('#lista-scelta').innerHTML = righeScelta(); return; }
  if (el.dataset.ricerca === 'archivio') { S.ricercaArchivio = el.value; $('#lista-archivio').innerHTML = righeArchivio(); return; }

  // Numeri di una serie (della sessione o prevista nel modello).
  if (el.dataset.scheda && el.dataset.campo && el.dataset.id) {
    const scheda = el.dataset.scheda, campo = el.dataset.campo;
    const s = riga(scheda, el.dataset.id);
    const v = leggiNum(el.value);
    const lim = LIMITI[campo];
    if (!segnaValido(el, v !== null && (v === '' || (v >= lim[0] && v <= lim[1])))) return;
    if (campo === 'durata_min') s.durata_s = v === '' ? '' : Math.round(v * 60);
    else s[campo] = (campo === 'rip' || campo === 'durata_s') && v !== '' ? Math.round(v) : v;
    await salva([scheda, s]);
    return;
  }
  // Campi dell'esercizio nella sessione: nota e riabilitazione.
  if (el.dataset.se && el.dataset.seCampo) {
    const se = riga('SessioniEsercizi', el.dataset.se);
    const campo = el.dataset.seCampo;
    if (campo === 'nota' || campo.endsWith('_nota')) se[campo] = el.value;
    else {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null && (v === '' || (v >= 0 && v <= 10)))) return;
      se[campo] = v;
    }
    await salva(['SessioniEsercizi', se]);
    return;
  }
  // Campi dell'esercizio nel modello: recupero e indicazione.
  if (el.dataset.meCampo) {
    const me = riga('ModelliEsercizi', el.dataset.id);
    if (el.dataset.meCampo === 'recupero_s') {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null && (v === '' || (v >= 0 && v <= 3600)))) return;
      me.recupero_s = v === '' ? '' : Math.round(v);
    } else me.nota = el.value;
    await salva(['ModelliEsercizi', me]);
    return;
  }
  // Campi del modello.
  if (el.dataset.modCampo) {
    const m = riga('Modelli', S.modelloId);
    const campo = el.dataset.modCampo;
    if (campo === 'ordine') {
      const v = leggiNum(el.value);
      if (!segnaValido(el, v !== null)) return;
      m.ordine = v;
    } else if (campo === 'nome') {
      if (!segnaValido(el, el.value.trim() !== '')) return;
      m.nome = el.value.trim();
    } else m[campo] = campo === 'cartella' ? el.value.trim() : el.value;
    await salva(['Modelli', m]);
    return;
  }
  if (el.dataset.sessCampo) {
    const sess = riga('Sessioni', S.sessioneId);
    sess[el.dataset.sessCampo] = el.value;
    await salva(['Sessioni', sess]);
  }
});

/* ======================= Avvio ======================= */

async function avvio() {
  document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ic(el.dataset.ic); });
  try {
    idb = await apriDB();
    await caricaTutto();
  } catch (e) {
    $('#schermo').innerHTML = `<div class="vuoto-msg errore">Non riesco ad aprire la memoria del telefono: ${esc(e.message)}</div>`;
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  history.replaceState({ schermata: 'oggi' }, '');
  const inCorso = sessioneInCorso();
  if (inCorso) { S.schermata = 'sessione'; S.sessioneId = inCorso.id; history.pushState({ schermata: 'sessione', sessioneId: inCorso.id }, ''); }
  disegna();
  controllaWakeLock();
  aggiornaTimer();
  setInterval(() => { aggiornaTimer(); aggiornaCronometro(); if (conto) disegnaConto(); }, 250);
  setInterval(() => sincronizza(), 120000);
  window.addEventListener('online', () => sincronizza());
  window.addEventListener('offline', () => aggiornaStatoSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { controllaWakeLock(); aggiornaTimer(); sincronizza(); }
  });
  sincronizza();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
avvio();
