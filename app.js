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

// Campi di riabilitazione per area (§6 del brief).
const RIAB = {
  ginocchio: { titolo: 'Riabilitazione ginocchio', campi: [['ginocchio_pienezza', 'Pienezza'], ['ginocchio_dolore', 'Dolore']] },
  caviglia: { titolo: 'Riabilitazione caviglia', campi: [['malleolo_dolore', 'Malleolo'], ['achille_dolore', 'Achille']] },
};

const TIPI_ES = { peso_rip: 'Peso e ripetizioni', rip: 'Solo ripetizioni', durata: 'Durata', peso_durata: 'Peso e durata', cardio: 'Cardio' };
const TIPI_SERIE = { normale: 'Normale', riscaldamento: 'Riscaldamento', cedimento: 'Cedimento' };
const LATI = { entrambi: 'Entrambi', dx: 'Destro', sx: 'Sinistro' };

// Icone disegnate a mano (SVG), così non servono librerie esterne.
const ICONE = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  dots: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
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

function vivi(scheda) { return [...D[scheda].values()].filter(r => r.eliminato !== SI); }
function riga(scheda, id) { return D[scheda].get(id); }

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
async function salva(...coppie) {
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
  await scriviIn(operazioni);
  codaQuante = (await tutti('coda')).length;
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
  codaQuante = (await tutti('coda')).length;
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
  const scadenza = setTimeout(() => controllo.abort(), 45000);
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
      const lotto = coda.slice(0, 200);
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
      coda = coda.slice(200);
    }
    codaQuante = (await tutti('coda')).length;

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
  if (S.schermata === 'impostazioni' && !document.activeElement.matches('input')) disegna();
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

/* Conto alla rovescia per le serie a durata (isometrie). */
let conto = null; // { serieId, obiettivo, partenza, fase }
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
  const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
  if (se && sessioneAperta(riga('Sessioni', se.sessione_id))) avviaTimer(recuperoDi(se));
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
function eserciziDi(sessioneId) { return vivi('SessioniEsercizi').filter(r => r.sessione_id === sessioneId).sort(perPosizione); }
function serieDi(seId) { return vivi('Serie').filter(r => r.sessione_esercizio_id === seId).sort(perPosizione); }
function voceModello(sess, esercizioId) {
  if (!sess || !sess.modello_id) return null;
  return vivi('ModelliEsercizi').find(m => m.modello_id === sess.modello_id && m.esercizio_id === esercizioId) || null;
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

/* ======================= Navigazione e disegno ======================= */

const S = { schermata: 'oggi', sessioneId: null, ricerca: '', ricercaArchivio: '', nuovoEs: null, foglio: null };

function vai(schermata, extra = {}) {
  Object.assign(S, extra);
  if (S.schermata !== schermata) history.pushState({ schermata, sessioneId: S.sessioneId }, '');
  S.schermata = schermata;
  disegna();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  if (!$('#velo').hidden) chiudiFoglio();
  const st = e.state || { schermata: 'oggi' };
  S.schermata = st.schermata; S.sessioneId = st.sessioneId || S.sessioneId;
  disegna();
});

const SCHERMATE = { oggi: disegnaOggi, sessione: disegnaSessione, storico: disegnaStorico, esercizi: disegnaArchivio, test: disegnaTest, impostazioni: disegnaImpostazioni };

function disegna() {
  daRidisegnare = false;
  const fn = SCHERMATE[S.schermata] || disegnaOggi;
  $('#schermo').innerHTML = fn();
  const tab = S.schermata === 'sessione' ? (sessioneAperta(riga('Sessioni', S.sessioneId)) ? 'oggi' : 'storico') : S.schermata;
  document.querySelectorAll('#barra button').forEach(b => b.classList.toggle('attiva', b.dataset.vai === tab));
  aggiornaCronometro();
}

let daRidisegnare = false;
function ridisegnaSePossibile() {
  const att = document.activeElement;
  if (att && att.matches('input, textarea') && $('#schermo').contains(att)) { daRidisegnare = true; return; }
  disegna();
}
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const att = document.activeElement;
    if (daRidisegnare && !(att && att.matches('input, textarea'))) disegna();
  }, 400);
});

/* ---------- Oggi ---------- */
function disegnaOggi() {
  const inCorso = sessioneInCorso();
  const modelli = vivi('Modelli').sort((a, b) =>
    String(a.cartella).localeCompare(String(b.cartella), 'it') || (num(a.ordine) || 0) - (num(b.ordine) || 0) || String(a.nome).localeCompare(String(b.nome), 'it'));
  const sessioni = vivi('Sessioni');
  const voci = vivi('ModelliEsercizi');
  let html = `<div class="top"><h1>Oggi</h1><button class="icona" data-vai="impostazioni" aria-label="Impostazioni">${ic('settings')}</button></div><div class="pila">`;
  if (inCorso) {
    html += `<div class="card in-corso"><div class="tenue">Sessione in corso</div>
      <div style="font-size:17px;font-weight:500;margin:2px 0 8px">${esc(inCorso.titolo)} · iniziata alle ${fmtOraBreve(dataDa(inCorso.inizio))}</div>
      <button class="btn largo" data-azione="riprendi">Riprendi</button></div>`;
  }
  html += `<button class="btn2 largo" data-azione="nuova-vuota">${ic('plus')} Sessione vuota</button>`;
  let cartella = null;
  modelli.forEach(m => {
    if (m.cartella !== cartella) { cartella = m.cartella; html += `<div class="etichetta">${esc(cartella || 'Senza cartella')}</div>`; }
    const quanti = voci.filter(v => v.modello_id === m.id).length;
    const ultima = sessioni.filter(s => s.modello_id === m.id && s.fine).map(s => s.inizio).sort().pop();
    html += `<button class="card fila modello" data-azione="avvia-modello" data-id="${esc(m.id)}">
      <span><span style="display:block;font-size:16px">${esc(m.nome)}</span><span class="tenue">${quanti} esercizi${ultima ? ' · ultima ' + fmtGiorno(dataDa(ultima)) : ''}</span></span>${ic('play')}</button>`;
  });
  if (!modelli.length) html += `<div class="vuoto-msg">I modelli compariranno qui dopo la prima sincronizzazione con il foglio.</div>`;
  html += `<div class="stato-sync" data-stato-sync>${testoStatoSync()}</div></div>`;
  return html;
}

/* ---------- Sessione ---------- */
function etichettaSerie(serie, s) {
  if (s.tipo === 'riscaldamento') return { testo: 'R', classe: 'risc' };
  const n = serie.filter(x => x.tipo !== 'riscaldamento' && x.lato === s.lato && perPosizione(x, s) <= 0).length;
  return { testo: `<b>${n}</b>${s.lato && s.lato !== 'entrambi' ? ' ' + s.lato : ''}`, classe: s.tipo === 'cedimento' ? 'ced' : '' };
}

function campoNum(s, campo, extra = '') {
  return `<input class="num ${extra}" inputmode="decimal" autocomplete="off" data-serie="${esc(s.id)}" data-campo="${campo}" value="${esc(fmtNum(s[campo]))}">`;
}

function disegnaSerie(es, serie, s) {
  const tipo = es ? es.tipo : 'peso_rip';
  const et = etichettaSerie(serie, s);
  let celle = `<button class="lab-serie ${et.classe}" data-azione="menu-serie" data-serie="${esc(s.id)}">${et.testo}</button>`;
  celle += `<span class="ultima">—</span>`; // «ultima volta»: arriva in fase 2
  if (tipo === 'peso_rip') celle += campoNum(s, 'peso_kg') + campoNum(s, 'rip');
  else if (tipo === 'rip') celle += campoNum(s, 'rip');
  else if (tipo === 'durata') celle += campoNum(s, 'durata_s');
  else if (tipo === 'peso_durata') celle += campoNum(s, 'peso_kg') + campoNum(s, 'durata_s');
  else if (tipo === 'cardio') {
    const min = s.durata_s === '' ? '' : Math.round(num(s.durata_s) / 6) / 10;
    celle += `<input class="num" inputmode="decimal" autocomplete="off" data-serie="${esc(s.id)}" data-campo="durata_min" value="${esc(fmtNum(min))}">`;
  }
  celle += campoNum(s, 'rpe', 'rpe');
  celle += `<button class="spunta" data-azione="spunta" data-serie="${esc(s.id)}" aria-label="Serie fatta">${ic('check')}</button>`;
  return `<div class="scorri"><div class="scorri-fondo">${ic('trash')}${ic('trash')}</div>
    <div class="serie c-${esc(tipo)} ${s.fatta === SI ? 'fatta' : ''}" data-riga-serie="${esc(s.id)}">${celle}</div></div>`;
}

function intestazioneSerie(tipo) {
  const col = { peso_rip: ['kg', 'Rip'], rip: ['Rip'], durata: ['Sec'], peso_durata: ['kg', 'Sec'], cardio: ['Min'] }[tipo] || ['kg', 'Rip'];
  return `<div class="serie intest c-${esc(tipo)}"><span>Serie</span><span>Ultima volta</span>${col.map(c => `<span>${c}</span>`).join('')}<span>RPE</span><span></span></div>`;
}

function disegnaEsercizio(sess, se) {
  const es = riga('Esercizi', se.esercizio_id);
  const tipo = es && TIPI_ES[es.tipo] ? es.tipo : 'peso_rip';
  const serie = serieDi(se.id);
  const me = voceModello(sess, se.esercizio_id);
  const rec = recuperoDi(se);
  let html = `<div class="card" style="padding:12px 8px" data-se="${esc(se.id)}">
    <div class="fila" style="padding:0 4px 8px;align-items:flex-start"><div>
      <div class="es-titolo">${esc(es ? es.nome : 'Esercizio non trovato (' + se.esercizio_id + ')')}</div>
      ${es && RIAB[es.area] ? `<span class="tag">${esc(es.area)}</span>` : ''}${se.superserie_id ? '<span class="tag">superserie</span>' : ''}
      <span class="tenue">${rec ? 'recupero ' + fmtDurata(rec) : 'senza recupero'}</span>
      ${me && me.nota ? `<p class="indicazione">${esc(me.nota)}</p>` : ''}
    </div><button class="icona" data-azione="menu-es" data-se="${esc(se.id)}" aria-label="Opzioni esercizio">${ic('dots')}</button></div>`;
  html += intestazioneSerie(tipo);
  serie.forEach(s => { html += disegnaSerie(es, serie, s); });
  html += `<div class="riga-btn" style="padding:8px 4px 0">
    <button class="btn2" style="font-size:14px" data-azione="aggiungi-serie" data-se="${esc(se.id)}">${ic('plus')} Serie</button>
    <button class="btn2" style="font-size:14px" data-azione="copia-precedente" data-se="${esc(se.id)}">${ic('copy')} Copia precedente</button></div>`;
  if (tipo === 'durata' || tipo === 'peso_durata') {
    const prossima = serie.find(s => s.fatta !== SI);
    if (prossima) {
      const et = etichettaSerie(serie, prossima);
      html += `<div style="padding:8px 4px 0"><button class="btn largo" data-azione="avvia-durata" data-serie="${esc(prossima.id)}">${ic('timer')} Avvia serie ${et.testo.replace(/<[^>]+>/g, '')}${prossima.durata_s !== '' ? ' · ' + prossima.durata_s + '″' : ''}</button></div>`;
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
  esercizi.forEach(se => { html += disegnaEsercizio(sess, se); });
  if (!esercizi.length) html += `<div class="vuoto-msg">Nessun esercizio. Aggiungine uno.</div>`;
  html += `<button class="btn2 largo" data-azione="aggiungi-es">${ic('plus')} Esercizio</button>
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
  let html = `<div class="top"><h1>Storico</h1></div><div class="pila"><div class="card settimana">`;
  nomi.forEach((n, i) => {
    const g = new Date(lun); g.setDate(lun.getDate() + i);
    const chiave = ora(g).slice(0, 10);
    const classi = (giorniFatti.has(chiave) ? 'si ' : '') + (g.toDateString() === oggi.toDateString() ? 'oggi' : '');
    html += `<div>${n}<div class="giorno ${classi}">${g.getDate()}</div></div>`;
  });
  html += `</div>`;
  let gruppo = null;
  sessioni.forEach(s => {
    const d = dataDa(s.inizio);
    const settimane = Math.round((lun - lunedi(d)) / (7 * 864e5));
    const nomeGruppo = settimane === 0 ? 'Questa settimana' : settimane === 1 ? 'Settimana scorsa' : 'Settimana dal ' + lunedi(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    if (nomeGruppo !== gruppo) {
      gruppo = nomeGruppo;
      const quante = sessioni.filter(x => lunedi(dataDa(x.inizio)).getTime() === lunedi(d).getTime()).length;
      html += `<div class="etichetta">${nomeGruppo} · ${quante} ${quante === 1 ? 'seduta' : 'sedute'}</div>`;
    }
    const r = riepilogoSessione(s);
    const elenco = r.nomi.slice(0, 3).join(' · ') + (r.nomi.length > 3 ? ` +${r.nomi.length - 3}` : '');
    html += `<button class="card modello" data-azione="apri-sessione" data-id="${esc(s.id)}">
      <span class="fila"><span style="font-size:16px;font-weight:500">${esc(s.titolo)}</span><span class="tenue">${fmtGiorno(d)}</span></span>
      <span class="tenue" style="display:block;margin-top:4px">${fmtMinuti(r.durata)} · ${r.fatte} serie${r.volume ? ' · ' + fmtKg(r.volume) : ''}</span>
      ${elenco ? `<span style="display:block;font-size:13px;margin-top:6px;color:#cbd2dc">${esc(elenco)}</span>` : ''}</button>`;
  });
  if (!sessioni.length) html += `<div class="vuoto-msg">Le sessioni finite compariranno qui.</div>`;
  return html + `<p class="tenue" style="text-align:center">Grafici e statistiche arrivano nella fase 4.</p></div>`;
}

/* ---------- Esercizi (archivio, solo consultazione in fase 1) ---------- */
function elencoEsercizi(filtro) {
  const f = filtro.trim().toLowerCase();
  return vivi('Esercizi').filter(e => e.archiviato !== SI && (!f || String(e.nome).toLowerCase().includes(f) || String(e.gruppo).toLowerCase().includes(f)))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it'));
}
function disegnaArchivio() {
  const lista = elencoEsercizi(S.ricercaArchivio);
  let html = `<div class="top"><h1>Esercizi</h1></div><div class="pila">
    <input class="testo" type="search" placeholder="Cerca un esercizio" data-ricerca="archivio" value="${esc(S.ricercaArchivio)}">
    <div id="lista-archivio" class="pila">`;
  html += righeArchivio(lista);
  return html + `</div><p class="tenue" style="text-align:center">Modifica di esercizi e modelli: fase 2.</p></div>`;
}
function righeArchivio(lista) {
  if (!lista.length) return `<div class="vuoto-msg">Nessun esercizio trovato.</div>`;
  return lista.map(e => `<div class="card"><div style="font-size:16px">${esc(e.nome)}</div>
    <div class="tenue">${esc(TIPI_ES[e.tipo] || e.tipo)}${e.gruppo ? ' · ' + esc(e.gruppo) : ''}${e.attrezzo ? ' · ' + esc(e.attrezzo) : ''}${RIAB[e.area] ? ` <span class="tag">${esc(e.area)}</span>` : ''}</div></div>`).join('');
}

/* ---------- Test ---------- */
function disegnaTest() {
  return `<div class="top"><h1>Test</h1></div><div class="vuoto-msg">La registrazione dei test (WBLT, heel raise, equilibrio, leg extension, step-down) arriva nella fase 4.</div>`;
}

/* ---------- Impostazioni ---------- */
function disegnaImpostazioni() {
  return `<div class="top"><button class="icona" data-vai="oggi" aria-label="Indietro">${ic('arrow-left')}</button><h1 style="flex:1">Impostazioni</h1></div>
  <div class="pila">
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
      <h2>Copia di sicurezza</h2>
      <p class="tenue" style="margin:8px 0">Scarica in un file tutti i dati presenti sul telefono (senza il token).</p>
      <button class="btn2 largo" data-azione="imp-esporta">Esporta i dati</button>
    </div>
    <p class="tenue" style="text-align:center">Unità di peso: kg · Gym, fase 1</p>
  </div>`;
}

/* ======================= Fogli dal basso ======================= */

function apriFoglio(html) { $('#foglio').innerHTML = html; $('#velo').hidden = false; }
function chiudiFoglio() { $('#velo').hidden = true; $('#foglio').innerHTML = ''; S.foglio = null; }
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

function foglioScelteSerie(s) {
  const gruppo = (nome, opzioni, attuale) => `<div class="scelte">${Object.entries(opzioni).map(([v, t]) =>
    `<button class="scelta ${attuale === v ? 'si' : ''}" data-azione="serie-${nome}" data-serie="${esc(s.id)}" data-valore="${v}">${t}</button>`).join('')}</div>`;
  return `<h2>Serie</h2>
    <div class="tenue">Tipo</div>${gruppo('tipo', TIPI_SERIE, s.tipo || 'normale')}
    <div class="tenue">Lato</div>${gruppo('lato', LATI, s.lato || 'entrambi')}
    <button class="voce" data-azione="serie-copia" data-serie="${esc(s.id)}">${ic('copy')} Duplica questa serie</button>
    <button class="voce" data-azione="serie-elimina" data-serie="${esc(s.id)}" style="color:var(--rosso)">${ic('trash')} Elimina la serie</button>`;
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
    <div class="tenue">Area</div>${gruppo('area', { altro: 'Altro', ginocchio: 'Ginocchio', caviglia: 'Caviglia' })}
    <div class="campo-modulo"><label for="nes-rec">Recupero (secondi, 0 = nessun timer)</label><input class="testo" id="nes-rec" inputmode="numeric" value="${esc(n.recupero_s)}"></div>
    <p class="tenue errore" id="nes-errore"></p>
    <div class="riga-btn"><button class="btn2" data-azione="aggiungi-es">Indietro</button><button class="btn" data-azione="salva-nuovo-es">Crea e aggiungi</button></div>`;
}

/* ======================= Azioni ======================= */

async function rinumera(scheda, righe) {
  const cambiate = [];
  righe.forEach((r, i) => { if (num(r.posizione) !== i + 1) { r.posizione = i + 1; cambiate.push([scheda, r]); } });
  if (cambiate.length) await salva(...cambiate);
}

async function creaSessioneDaModello(modello) {
  const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: modello.nome, modello_id: modello.id, inizio: ora(), fine: '' });
  const daSalvare = [['Sessioni', sess]];
  // Copia del modello: cambiare il modello dopo non tocca questa sessione.
  vivi('ModelliEsercizi').filter(m => m.modello_id === modello.id).sort(perPosizione).forEach((me, i) => {
    const se = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: sess.id, posizione: i + 1, esercizio_id: me.esercizio_id, superserie_id: me.superserie_id || '' });
    daSalvare.push(['SessioniEsercizi', se]);
    const previste = vivi('ModelliSerie').filter(ms => ms.modello_esercizio_id === me.id).sort(perPosizione);
    (previste.length ? previste : [{}]).forEach((ms, j) => {
      daSalvare.push(['Serie', nuovaRiga('Serie', {
        id: nuovoId('SR'), sessione_esercizio_id: se.id, posizione: j + 1,
        tipo: ms.tipo || 'normale', lato: ms.lato || 'entrambi',
        peso_kg: ms.peso_kg ?? '', rip: ms.rip ?? '', durata_s: ms.durata_s ?? '', rpe: '', fatta: NO,
      })]);
    });
  });
  await salva(...daSalvare);
  return sess;
}

async function aggiungiEsercizio(esercizioId) {
  const sess = riga('Sessioni', S.sessioneId);
  const esistenti = eserciziDi(sess.id);
  const se = nuovaRiga('SessioniEsercizi', { id: nuovoId('SX'), sessione_id: sess.id, posizione: esistenti.length + 1, esercizio_id: esercizioId });
  const s = nuovaRiga('Serie', { id: nuovoId('SR'), sessione_esercizio_id: se.id, posizione: 1, tipo: 'normale', lato: 'entrambi', fatta: NO });
  await salva(['SessioniEsercizi', se], ['Serie', s]);
  chiudiFoglio();
  disegna();
  const card = document.querySelector(`[data-se="${CSS.escape(se.id)}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function avvisoSessioneGiaAperta() {
  apriFoglio(`<h2>C'è già una sessione in corso</h2><p class="tenue">Riprendila o terminala prima di iniziarne un'altra.</p>
    <button class="btn largo" data-azione="riprendi">Riprendi</button>`);
}

const AZIONI = {
  'riprendi': () => { chiudiFoglio(); const s = sessioneInCorso(); if (s) { vai('sessione', { sessioneId: s.id }); controllaWakeLock(); } },
  'nuova-vuota': async () => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const sess = nuovaRiga('Sessioni', { id: nuovoId('SE'), titolo: 'Allenamento', modello_id: '', inizio: ora(), fine: '' });
    await salva(['Sessioni', sess]);
    vai('sessione', { sessioneId: sess.id }); controllaWakeLock();
    S.ricerca = ''; apriFoglio(foglioSceltaEsercizio());
  },
  'avvia-modello': async el => {
    if (sessioneInCorso()) return avvisoSessioneGiaAperta();
    const sess = await creaSessioneDaModello(riga('Modelli', el.dataset.id));
    vai('sessione', { sessioneId: sess.id }); controllaWakeLock();
  },
  'apri-sessione': el => vai('sessione', { sessioneId: el.dataset.id }),
  'chiudi-sessione': () => vai('storico'),
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
  'spunta': async el => {
    const s = riga('Serie', el.dataset.serie);
    s.fatta = s.fatta === SI ? NO : SI;
    await salva(['Serie', s]);
    const r = document.querySelector(`[data-riga-serie="${CSS.escape(s.id)}"]`);
    if (r) r.classList.toggle('fatta', s.fatta === SI);
    const se = riga('SessioniEsercizi', s.sessione_esercizio_id);
    if (s.fatta === SI) {
      if (navigator.vibrate) navigator.vibrate(30);
      if (sessioneAperta(riga('Sessioni', se.sessione_id))) avviaTimer(recuperoDi(se));
    }
    const es = riga('Esercizi', se.esercizio_id);
    if (es && (es.tipo === 'durata' || es.tipo === 'peso_durata')) disegna(); // aggiorna «Avvia serie»
  },
  'menu-serie': el => apriFoglio(foglioScelteSerie(riga('Serie', el.dataset.serie))),
  'serie-tipo': async el => { const s = riga('Serie', el.dataset.serie); s.tipo = el.dataset.valore; await salva(['Serie', s]); chiudiFoglio(); disegna(); },
  'serie-lato': async el => { const s = riga('Serie', el.dataset.serie); s.lato = el.dataset.valore; await salva(['Serie', s]); chiudiFoglio(); disegna(); },
  'serie-copia': async el => {
    const s = riga('Serie', el.dataset.serie);
    const lista = serieDi(s.sessione_esercizio_id);
    const copia = nuovaRiga('Serie', Object.assign(soloSchema('Serie', s), { id: nuovoId('SR'), fatta: NO, eliminato: NO }));
    lista.splice(lista.indexOf(s) + 1, 0, copia);
    lista.forEach((r, i) => { r.posizione = i + 1; });
    await salva(...lista.map(r => ['Serie', r]));
    chiudiFoglio(); disegna();
  },
  'serie-elimina': el => { chiudiFoglio(); return eliminaSerie(el.dataset.serie); },
  'aggiungi-serie': async el => {
    const lista = serieDi(el.dataset.se);
    const ultima = lista[lista.length - 1];
    const nuova = nuovaRiga('Serie', { id: nuovoId('SR'), sessione_esercizio_id: el.dataset.se, posizione: lista.length + 1,
      tipo: ultima && ultima.tipo !== 'riscaldamento' ? ultima.tipo : 'normale', lato: ultima ? ultima.lato : 'entrambi', fatta: NO });
    await salva(['Serie', nuova]); disegna();
  },
  'copia-precedente': async el => {
    const lista = serieDi(el.dataset.se);
    const ultima = lista[lista.length - 1];
    const nuova = nuovaRiga('Serie', ultima
      ? Object.assign(soloSchema('Serie', ultima), { id: nuovoId('SR'), posizione: lista.length + 1, fatta: NO, eliminato: NO })
      : { id: nuovoId('SR'), sessione_esercizio_id: el.dataset.se, posizione: 1, tipo: 'normale', lato: 'entrambi', fatta: NO });
    await salva(['Serie', nuova]); disegna();
  },
  'avvia-durata': el => avviaConto(el.dataset.serie),
  'conto-ferma': () => chiudiConto(true),
  'conto-annulla': () => chiudiConto(false),
  'menu-es': el => {
    const se = riga('SessioniEsercizi', el.dataset.se);
    const es = riga('Esercizi', se.esercizio_id);
    apriFoglio(`<h2>${esc(es ? es.nome : 'Esercizio')}</h2>
      <button class="voce" data-azione="sposta-es" data-se="${esc(se.id)}" data-valore="-1">${ic('arrow-up')} Sposta su</button>
      <button class="voce" data-azione="sposta-es" data-se="${esc(se.id)}" data-valore="1">${ic('arrow-down')} Sposta giù</button>
      <button class="voce" data-azione="rimuovi-es" data-se="${esc(se.id)}" style="color:var(--rosso)">${ic('trash')} Rimuovi dalla sessione</button>
      <p class="tenue">Superserie: arrivano nella fase 2.</p>`);
  },
  'sposta-es': async el => {
    const se = riga('SessioniEsercizi', el.dataset.se);
    const lista = eserciziDi(se.sessione_id);
    const i = lista.indexOf(se), j = i + Number(el.dataset.valore);
    if (j >= 0 && j < lista.length) { [lista[i], lista[j]] = [lista[j], lista[i]]; await rinumera('SessioniEsercizi', lista); }
    chiudiFoglio(); disegna();
  },
  'rimuovi-es': async el => {
    const se = riga('SessioniEsercizi', el.dataset.se);
    se.eliminato = SI; await salva(['SessioniEsercizi', se]);
    chiudiFoglio(); disegna();
    mostraAvviso('Esercizio rimosso', async () => { se.eliminato = NO; await salva(['SessioniEsercizi', se]); });
  },
  'aggiungi-es': () => { S.ricerca = ''; apriFoglio(foglioSceltaEsercizio()); },
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
};

async function eliminaSerie(id) {
  const s = riga('Serie', id);
  s.eliminato = SI; await salva(['Serie', s]);
  disegna();
  mostraAvviso('Serie eliminata', async () => { s.eliminato = NO; await salva(['Serie', s]); });
}

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
    setTimeout(() => eliminaSerie(t.r.dataset.rigaSerie), 180);
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
  if (vaiA) { e.preventDefault(); chiudiFoglio(); vai(vaiA.dataset.vai); return; }
  const el = e.target.closest('[data-azione]');
  if (!el || !AZIONI[el.dataset.azione]) return;
  try { await AZIONI[el.dataset.azione](el); }
  catch (err) { mostraAvviso('Qualcosa non va: ' + err.message); }
});

/* Scrittura nei campi: si salva a ogni modifica, senza ridisegnare (il cursore resta dov'è). */
document.addEventListener('input', async e => {
  const el = e.target;
  if (el.dataset.ricerca === 'scelta') { S.ricerca = el.value; $('#lista-scelta').innerHTML = righeScelta(); return; }
  if (el.dataset.ricerca === 'archivio') { S.ricercaArchivio = el.value; $('#lista-archivio').innerHTML = righeArchivio(elencoEsercizi(el.value)); return; }

  if (el.dataset.serie && el.dataset.campo) {
    const s = riga('Serie', el.dataset.serie);
    let v = leggiNum(el.value);
    const limiti = { rpe: [0, 10], peso_kg: [0, 1000], rip: [0, 1000], durata_s: [0, 86400], durata_min: [0, 1440] }[el.dataset.campo];
    const valido = v !== null && (v === '' || (v >= limiti[0] && v <= limiti[1]));
    el.style.outline = valido ? '' : '2px solid var(--rosso)';
    if (!valido) return;
    if (el.dataset.campo === 'durata_min') s.durata_s = v === '' ? '' : Math.round(v * 60);
    else s[el.dataset.campo] = (el.dataset.campo === 'rip' || el.dataset.campo === 'durata_s') && v !== '' ? Math.round(v) : v;
    await salva(['Serie', s]);
    return;
  }
  if (el.dataset.se && el.dataset.seCampo) {
    const se = riga('SessioniEsercizi', el.dataset.se);
    const campo = el.dataset.seCampo;
    if (campo === 'nota' || campo.endsWith('_nota')) se[campo] = el.value;
    else {
      const v = leggiNum(el.value);
      const valido = v !== null && (v === '' || (v >= 0 && v <= 10));
      el.style.outline = valido ? '' : '2px solid var(--rosso)';
      if (!valido) return;
      se[campo] = v;
    }
    await salva(['SessioniEsercizi', se]);
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
