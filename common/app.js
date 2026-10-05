/* ============================================================
   Good People Company — socle commun
   Chargé par index.html, perso.html, admin.html
   Dépend de : firebase-app-compat + firebase-firestore-compat, common/config.js
   ============================================================ */

/* ---------- Firebase ---------- */
firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

/* ---------- Constantes de schéma ---------- */
const COL = {
  players: 'players',     // /players/{slug}  = fiche joueur
  ledger:  'ledger',      // /ledger/{auto}   = une transaction
  orders:  'orders',      // /orders/{auto}   = une commande magasin
  shop:    'shop',        // /shop/catalog    = { items:[...] }
  journal: 'journal',     // /journal/public  = { entries:[...] }
  map:     'map',         // /map/data        = { pois:[...] }
  config:  'config'       // /config/game     = réglages de partie
};

/* ---------- Réglages de partie (fusion défauts + Firestore) ---------- */
let GAME = Object.assign({}, window.GPC_DEFAULTS);

/** Charge /config/game une fois. Retourne GAME. */
async function loadGame(){
  try{
    const s = await db.collection(COL.config).doc('game').get();
    if (s.exists) GAME = Object.assign({}, window.GPC_DEFAULTS, s.data());
  }catch(e){ console.warn('config/game indisponible', e); }
  return GAME;
}

/* ---------- Utilitaires ---------- */

/** Échappe le HTML. À utiliser sur TOUTE donnée venant de Firestore. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Identifiant stable à partir d'un pseudo : « Jean-Luc R. » → « jean-luc-r ». */
function slugify(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

/** Formate un montant : 1234 → « 1 234 ₢ ». */
function money(n){
  const v = Math.round(Number(n)||0);
  return v.toLocaleString('fr-FR').replace(/ /g,' ') + ' ' + (GAME.currencySym||'');
}

/** Formate un timestamp (ms ou Firestore Timestamp) → « sam. 14:32 ». */
function when(ts){
  const ms = !ts ? 0 : (typeof ts === 'number' ? ts : (ts.toMillis ? ts.toMillis() : 0));
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR',
    { weekday:'short', hour:'2-digit', minute:'2-digit' });
}

/** Affiche un message dans un conteneur (type 'ok' | 'err'). */
function say(el, text, type){
  const n = typeof el === 'string' ? document.getElementById(el) : el;
  if (!n) return;
  if (!text){ n.innerHTML = ''; return; }
  n.innerHTML = '<div class="msg msg-' + (type === 'ok' ? 'ok' : 'err') + '">' + esc(text) + '</div>';
}

/** Rendu minimal markdown → HTML (### titre, - liste, **gras**, paragraphes). */
function miniMd(src){
  const lines = String(src||'').split('\n');
  let out = '', inUl = false;
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  const closeUl = () => { if (inUl){ out += '</ul>'; inUl = false; } };
  for (const raw of lines){
    const l = raw.trim();
    if (!l){ closeUl(); continue; }
    if (/^#{1,3}\s/.test(l)){ closeUl(); out += '<h3>' + inline(l.replace(/^#{1,3}\s+/,'')) + '</h3>'; }
    else if (/^[-*]\s/.test(l)){ if(!inUl){ out += '<ul>'; inUl = true; } out += '<li>' + inline(l.slice(2)) + '</li>'; }
    else { closeUl(); out += '<p>' + inline(l) + '</p>'; }
  }
  closeUl();
  return out;
}

/* ---------- Session joueur (localStorage) ---------- */
const SESSION_KEY = 'gpc_session';

function setSession(id, code){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify({ id, code })); }catch(e){}
}
function getSession(){
  const q = new URLSearchParams(location.search).get('id');
  if (q) return { id: slugify(q), code: null };   // ?id= pour l'orga / les tests
  try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){ return null; }
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }

/**
 * Vérifie pseudo + code contre /players/{slug}.
 * Retourne { ok:true, id, data } ou { ok:false, error }.
 */
async function login(pseudo, code){
  const id = slugify(pseudo);
  if (!id)   return { ok:false, error:"Entre ton nom d'agent." };
  if (!code) return { ok:false, error:'Entre ton code d’accès.' };
  let snap;
  try{ snap = await db.collection(COL.players).doc(id).get(); }
  catch(e){ return { ok:false, error:'Connexion au serveur impossible. Réessaie.' }; }
  if (!snap.exists) return { ok:false, error:'Nom d’agent inconnu. Vérifie l’orthographe.' };
  const d = snap.data();
  if (String(d.code||'') !== String(code).trim())
    return { ok:false, error:'Code d’accès incorrect.' };
  if (d.active === false)
    return { ok:false, error:'Ce dossier a été suspendu. Vois avec l’organisation.' };
  setSession(id, String(code).trim());
  return { ok:true, id, data:d };
}

/** Redirige vers l'accueil si pas de session. Retourne la session sinon. */
function requireSession(){
  const s = getSession();
  if (!s || !s.id){ location.replace('index.html'); return null; }
  return s;
}

/* ---------- Écriture du grand livre ---------- */
/**
 * Enregistre une ligne de transaction. Ne touche PAS aux soldes
 * (les soldes bougent dans les transactions Firestore des appelants).
 */
function ledgerEntry(tx, entry){
  const ref = db.collection(COL.ledger).doc();
  const data = Object.assign({ ts: Date.now() }, entry);
  if (tx) tx.set(ref, data); else ref.set(data);
  return ref.id;
}

/* ---------- Virement joueur → joueur (transaction atomique) ---------- */
/**
 * @returns {Promise<{ok:boolean,error?:string}>}
 */
async function transfer(fromId, toId, amount, label){
  const amt = Math.round(Number(amount)||0);
  if (amt <= 0)          return { ok:false, error:'Montant invalide.' };
  if (fromId === toId)   return { ok:false, error:'Tu ne peux pas te virer de l’argent à toi-même.' };
  const fromRef = db.collection(COL.players).doc(fromId);
  const toRef   = db.collection(COL.players).doc(toId);
  try{
    await db.runTransaction(async tx => {
      const [fs, ts] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
      if (!fs.exists) throw new Error('Émetteur introuvable.');
      if (!ts.exists) throw new Error('Destinataire introuvable.');
      const fb = Number(fs.data().balance)||0;
      if (fb < amt) throw new Error('Solde insuffisant.');
      tx.update(fromRef, { balance: fb - amt });
      tx.update(toRef,   { balance: (Number(ts.data().balance)||0) + amt });
      ledgerEntry(tx, {
        type:'transfer', amount:amt,
        from:fromId, fromName:fs.data().pseudo || fromId,
        to:toId,     toName:  ts.data().pseudo || toId,
        label: String(label||'Virement').slice(0,120)
      });
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Virement refusé.' }; }
}

/* ---------- Achat magasin (transaction atomique : solde + stock) ---------- */
/**
 * @param {string} playerId
 * @param {string} itemId  id de l'article dans /shop/catalog.items
 * @param {number} qty
 */
async function purchase(playerId, itemId, qty){
  const n = Math.max(1, Math.round(Number(qty)||1));
  const pRef = db.collection(COL.players).doc(playerId);
  const sRef = db.collection(COL.shop).doc('catalog');
  try{
    await db.runTransaction(async tx => {
      const [ps, ss] = await Promise.all([tx.get(pRef), tx.get(sRef)]);
      if (!ps.exists) throw new Error('Dossier joueur introuvable.');
      if (!ss.exists) throw new Error('Catalogue indisponible.');
      const items = (ss.data().items || []).slice();
      const i = items.findIndex(x => x.id === itemId);
      if (i < 0) throw new Error('Article introuvable.');
      const it = Object.assign({}, items[i]);
      // stock illimité si le champ est absent ou null
      const tracked = it.stock !== undefined && it.stock !== null;
      if (tracked && Number(it.stock) < n) throw new Error('Stock insuffisant.');
      const total = (Number(it.price)||0) * n;
      const bal = Number(ps.data().balance)||0;
      if (bal < total) throw new Error('Solde insuffisant.');

      if (tracked){ it.stock = Number(it.stock) - n; items[i] = it; tx.update(sRef, { items }); }
      tx.update(pRef, { balance: bal - total });

      const oRef = db.collection(COL.orders).doc();
      tx.set(oRef, {
        playerId, playerName: ps.data().pseudo || playerId,
        itemId, itemName: it.name || itemId,
        qty:n, unitPrice: Number(it.price)||0, total,
        status:'pending', ts: Date.now()
      });
      ledgerEntry(tx, {
        type:'shop', amount: total,
        from: playerId, fromName: ps.data().pseudo || playerId,
        to: '__shop__',  toName: 'Magasin',
        label: (it.name || itemId) + (n > 1 ? ' ×' + n : '')
      });
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Achat refusé.' }; }
}

/* ---------- Ajustement par l'organisation ---------- */
async function adminAdjust(playerId, delta, label){
  const d = Math.round(Number(delta)||0);
  if (!d) return { ok:false, error:'Montant nul.' };
  const pRef = db.collection(COL.players).doc(playerId);
  try{
    await db.runTransaction(async tx => {
      const ps = await tx.get(pRef);
      if (!ps.exists) throw new Error('Joueur introuvable.');
      const bal = Number(ps.data().balance)||0;
      const next = bal + d;
      if (next < 0) throw new Error('Le solde deviendrait négatif.');
      tx.update(pRef, { balance: next });
      const name = ps.data().pseudo || playerId;
      ledgerEntry(tx, {
        type:'admin', amount: Math.abs(d),
        from: d < 0 ? playerId : '__bank__', fromName: d < 0 ? name : 'Organisation',
        to:   d < 0 ? '__bank__' : playerId, toName:   d < 0 ? 'Organisation' : name,
        label: String(label||'Ajustement').slice(0,120)
      });
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Ajustement refusé.' }; }
}
