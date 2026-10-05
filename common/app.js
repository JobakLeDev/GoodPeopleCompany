/* ============================================================
   Goodfolks Industries — socle commun
   Charge par index.html, perso.html, admin.html
   Depend de : firebase-app-compat + firebase-firestore-compat, common/config.js

   MODELE DE JEU
   -------------
   Une PART existe sous deux formes :
     · dematerialisee — « en banque », sur le compte du joueur. Seule forme
       que l'app connait : elle paie dans l'app, elle se cede, elle VOTE.
     · au porteur — un jeton physique. Invisible de l'app, par construction :
       il circule de main en main sans laisser de trace.
   Le GUICHET de l'organisation est le seul point de conversion entre les deux
   (retrait = compte -> jeton, depot = jeton -> compte).

   CONSEQUENCE, assumee : seules les parts EN BANQUE peuvent etre converties en
   voix. Un jeton dans une poche ne vaut rien au scrutin. D'ou l'heure limite de
   depot au guichet avant la cloture.

   LE SCRUTIN est un EVENEMENT (le dimanche matin). Au moment du vote, chacun
   ECHANGE des parts de son compte contre des voix : 1 part = 1 voix.
     · il REPARTIT librement entre les options (7 pour A, 3 pour B) ;
     · il ne passe QU'UNE SEULE FOIS : le bulletin est definitif ;
     · les parts engagees sont BLOQUEES (champ `engaged`), puis RENDUES au
       depouillement. Elles ne sont pas depensees.
   Le blocage n'est pas cosmetique : sans lui, on voterait avec 10 parts puis on
   les cederait a quelqu'un qui revoterait avec les memes.
   ============================================================ */

firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();

/* ---------- Collections ---------- */
const COL = {
  players:  'players',    // /players/{slug}      compte (shares = en banque, engaged = au vote)
  ledger:   'ledger',     // /ledger/{auto}       un mouvement de parts
  requests: 'requests',   // /requests/{auto}     demande de retrait/depot au guichet
  ballots:  'ballots',    // /ballots/{playerId}  bulletin : { alloc:{optId:n}, total }
  orders:   'orders',     // /orders/{auto}       commande magasin
  shop:     'shop',       // /shop/catalog        { items:[...] }
  journal:  'journal',    // /journal/public      { entries:[...] }
  map:      'map',        // /map/data            { pois:[...] }
  vote:     'vote',       // /vote/current        le scrutin
  config:   'config'      // /config/game, /config/treasury
};

/* Types de mouvement du grand livre */
const MV = {
  transfer: 'transfer',   // actionnaire -> actionnaire (en banque)
  withdraw: 'withdraw',   // compte -> jetons physiques (guichet)
  deposit:  'deposit',    // jetons physiques -> compte (guichet)
  issue:    'issue',      // creation de parts nouvelles (dilution)
  grant:    'grant',      // tresorerie de la compagnie -> actionnaire
  reclaim:  'reclaim',    // actionnaire -> tresorerie de la compagnie
  shop:     'shop',       // actionnaire -> compagnie, en paiement
  vote:     'vote',       // compte -> parts engagees au scrutin
  release:  'release'     // parts engagees rendues au compte
};

/* Contreparties qui ne sont pas des joueurs */
const PARTY = {
  company:  '__company__',    // tresorerie de la compagnie
  tokens:   '__tokens__',     // les jetons en circulation (hors app)
  issuance: '__issuance__',   // le neant d'ou sortent les parts nouvelles
  urn:      '__urn__'         // les parts engagees au scrutin
};
const PARTY_NAME = {
  __company__:  'Trésorerie',
  __tokens__:   'Jetons en circulation',
  __issuance__: 'Émission',
  __urn__:      'Scrutin'
};

/* Etats du scrutin */
const VOTE_STATUS = {
  draft:     'draft',      // invisible des actionnaires
  announced: 'announced',  // question + heure d'ouverture visibles, vote impossible
  open:      'open',       // conversion des parts en voix possible
  closed:    'closed'      // depouille, resultats publies
};

/* ---------- Reglages de partie ---------- */
let GAME = Object.assign({}, window.GPC_DEFAULTS);

async function loadGame(){
  try{
    const s = await db.collection(COL.config).doc('game').get();
    if (s.exists) GAME = Object.assign({}, window.GPC_DEFAULTS, s.data());
  }catch(e){ console.warn('config/game indisponible', e); }
  return GAME;
}

/* ---------- Utilitaires d'affichage ---------- */

/** Echappe le HTML. A utiliser sur TOUTE donnee venant de Firestore. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** « Jean-Luc R. » -> « jean-luc-r » */
function slugify(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

/** Nombre formate a la francaise : 1234 -> « 1 234 ». */
function num(n){
  return (Math.round(Number(n)||0)).toLocaleString('fr-FR').replace(/ /g,' ');
}

/** 143 -> « 143 parts » ; 1 -> « 1 part ». */
function parts(n){
  const v = Math.round(Number(n)||0);
  return num(v) + ' ' + (Math.abs(v) === 1 ? (GAME.unit||'part') : (GAME.units||'parts'));
}

/** 1 -> « 1 voix » ; 12 -> « 12 voix » (invariable). */
function voix(n){ return num(n) + ' voix'; }

/** Part d'un total, en pourcentage lisible. */
function pctOf(n, total){
  const t = Number(total)||0;
  if (!t) return '—';
  const p = (Number(n)||0) / t * 100;
  return (p >= 10 ? p.toFixed(0) : p.toFixed(1)).replace('.', ',') + ' %';
}

/** ms (ou Firestore Timestamp) -> « sam. 14:32 ». */
function when(ts){
  const ms = !ts ? 0 : (typeof ts === 'number' ? ts : (ts.toMillis ? ts.toMillis() : 0));
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR',
    { weekday:'short', hour:'2-digit', minute:'2-digit' });
}

/** « dimanche 9:00 » — pour annoncer l'ouverture du scrutin. */
function whenLong(ts){
  const ms = Number(ts)||0;
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR',
    { weekday:'long', hour:'2-digit', minute:'2-digit' });
}

/** Duree restante lisible : « 3 h 12 », « 4 min », « délai écoulé ». */
function countdown(toMs){
  const d = Number(toMs) - Date.now();
  if (!toMs || isNaN(d)) return '';
  if (d <= 0) return 'délai écoulé';
  const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000);
  if (h >= 24){ const j = Math.floor(h/24); return j + ' j ' + (h % 24) + ' h'; }
  return h ? (h + ' h ' + String(m).padStart(2,'0')) : (m + ' min');
}

/** Nom affichable d'une contrepartie de mouvement. */
function partyName(id, fallback){
  return PARTY_NAME[id] || fallback || id || '?';
}

/** Parts totales detenues par un actionnaire : en banque + engagees au vote. */
function held(p){
  if (!p) return 0;
  return (Number(p.shares)||0) + (Number(p.engaged)||0);
}

/** Affiche un message dans un conteneur (type 'ok' | 'err'). */
function say(el, text, type){
  const n = typeof el === 'string' ? document.getElementById(el) : el;
  if (!n) return;
  if (!text){ n.innerHTML = ''; return; }
  n.innerHTML = '<div class="msg msg-' + (type === 'ok' ? 'ok' : 'err') + '">' + esc(text) + '</div>';
}

/** Markdown minimal : ### titre, - liste, **gras**, paragraphes. */
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

/* ---------- Session ---------- */
const SESSION_KEY = 'gpc_session';

function setSession(id, code){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify({ id, code })); }catch(e){}
}
function getSession(){
  const q = new URLSearchParams(location.search).get('id');
  if (q) return { id: slugify(q), code: null };   // ?id= pour l'orga et les tests
  try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){ return null; }
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }

async function login(pseudo, code){
  const id = slugify(pseudo);
  if (!id)   return { ok:false, error:'Entre ton nom d’actionnaire.' };
  if (!code) return { ok:false, error:'Entre ton code d’accès.' };
  let snap;
  try{ snap = await db.collection(COL.players).doc(id).get(); }
  catch(e){ return { ok:false, error:'Connexion au serveur impossible. Réessaie.' }; }
  if (!snap.exists) return { ok:false, error:'Nom inconnu au registre. Vérifie l’orthographe.' };
  const d = snap.data();
  if (String(d.code||'') !== String(code).trim())
    return { ok:false, error:'Code d’accès incorrect.' };
  if (d.active === false)
    return { ok:false, error:'Ce compte est suspendu. Vois avec l’organisation.' };
  setSession(id, String(code).trim());
  return { ok:true, id, data:d };
}

function requireSession(){
  const s = getSession();
  if (!s || !s.id){ location.replace('index.html'); return null; }
  return s;
}

/* ============================================================
   TRESORERIE — /config/treasury = { issued, circulating, company }

   Invariant comptable :
       issued  =  somme de (shares + engaged)  +  circulating  +  company

   · issued      parts existantes (le capital)
   · circulating parts sorties en jetons physiques, hors de l'app
   · company     parts detenues par la compagnie (ne votent pas)
   Les parts `engaged` appartiennent toujours au joueur : elles sont bloquees
   le temps du scrutin, pas depensees.
   ============================================================ */
const treasuryRef = () => db.collection(COL.config).doc('treasury');

async function loadTreasury(){
  try{
    const s = await treasuryRef().get();
    const d = s.exists ? s.data() : {};
    return {
      issued:      Number(d.issued)||0,
      circulating: Number(d.circulating)||0,
      company:     Number(d.company)||0
    };
  }catch(e){ return { issued:0, circulating:0, company:0 }; }
}

/** Ecrit une ligne de grand livre (dans une transaction si tx est fourni). */
function ledgerEntry(tx, entry){
  const ref = db.collection(COL.ledger).doc();
  const data = Object.assign({ ts: Date.now() }, entry);
  if (tx) tx.set(ref, data); else ref.set(data);
  return ref.id;
}

/**
 * Coeur de la comptabilite : une operation atomique sur le compte d'UN
 * actionnaire et sur la tresorerie.
 *
 * @param {string} playerId
 * @param {number} dShares  variation du compte (signee)
 * @param {object} dTres    variation de la tresorerie, ex. { circulating:+5 }
 * @param {object} entry    ligne de grand livre
 */
async function shareOp(playerId, dShares, dTres, entry){
  const pRef = db.collection(COL.players).doc(playerId);
  const tRef = treasuryRef();
  try{
    await db.runTransaction(async tx => {
      const [ps, ts] = await Promise.all([tx.get(pRef), tx.get(tRef)]);
      if (!ps.exists) throw new Error('Actionnaire introuvable.');
      const cur  = Number(ps.data().shares)||0;
      const next = cur + dShares;
      if (next < 0) throw new Error('Parts en banque insuffisantes.');

      const t = ts.exists ? ts.data() : {};
      const tNext = {
        issued:      (Number(t.issued)||0)      + (Number(dTres.issued)||0),
        circulating: (Number(t.circulating)||0) + (Number(dTres.circulating)||0),
        company:     (Number(t.company)||0)     + (Number(dTres.company)||0)
      };
      if (tNext.circulating < 0) throw new Error('Plus de jetons en circulation que ça.');
      if (tNext.company     < 0) throw new Error('La trésorerie de la compagnie est à sec.');
      if (tNext.issued      < 0) throw new Error('Émission négative impossible.');

      tx.update(pRef, { shares: next });
      tx.set(tRef, tNext, { merge:true });
      ledgerEntry(tx, Object.assign({
        shares: Math.abs(dShares),
        playerName: ps.data().pseudo || playerId
      }, entry));
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Opération refusée.' }; }
}

/* ---------- Cession entre actionnaires (en banque) ---------- */
async function transferShares(fromId, toId, qty, label){
  const n = Math.round(Number(qty)||0);
  if (n <= 0)          return { ok:false, error:'Nombre de parts invalide.' };
  if (fromId === toId) return { ok:false, error:'Tu ne peux pas te céder des parts à toi-même.' };
  const fromRef = db.collection(COL.players).doc(fromId);
  const toRef   = db.collection(COL.players).doc(toId);
  try{
    await db.runTransaction(async tx => {
      const [fs, ts] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
      if (!fs.exists) throw new Error('Émetteur introuvable.');
      if (!ts.exists) throw new Error('Destinataire introuvable.');
      const fb = Number(fs.data().shares)||0;
      if (fb < n) throw new Error('Tu n’as pas assez de parts en banque.');
      tx.update(fromRef, { shares: fb - n });
      tx.update(toRef,   { shares: (Number(ts.data().shares)||0) + n });
      ledgerEntry(tx, {
        type: MV.transfer, shares: n,
        from: fromId, fromName: fs.data().pseudo || fromId,
        to:   toId,   toName:   ts.data().pseudo || toId,
        label: String(label||'Cession de parts').slice(0,120)
      });
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Cession refusée.' }; }
}

/* ---------- Guichet : compte <-> jetons physiques ---------- */

/** Retrait : le joueur repart avec des jetons. Compte -> circulation. */
function withdrawTokens(playerId, qty, by){
  const n = Math.round(Number(qty)||0);
  if (n <= 0) return Promise.resolve({ ok:false, error:'Nombre de jetons invalide.' });
  return shareOp(playerId, -n, { circulating: +n }, {
    type: MV.withdraw,
    from: playerId, to: PARTY.tokens, toName: PARTY_NAME.__tokens__,
    label: 'Retrait de ' + n + ' jeton' + (n>1?'s':'') + ' au guichet',
    by: by || 'guichet'
  });
}

/** Depot : le joueur rend ses jetons. Circulation -> compte. */
function depositTokens(playerId, qty, by){
  const n = Math.round(Number(qty)||0);
  if (n <= 0) return Promise.resolve({ ok:false, error:'Nombre de jetons invalide.' });
  return shareOp(playerId, +n, { circulating: -n }, {
    type: MV.deposit,
    from: PARTY.tokens, fromName: PARTY_NAME.__tokens__, to: playerId,
    label: 'Dépôt de ' + n + ' jeton' + (n>1?'s':'') + ' au guichet',
    by: by || 'guichet'
  });
}

/* ---------- Leviers de l'organisation ---------- */

/** Emission de parts NOUVELLES : dilue tout le monde. */
function issueShares(playerId, qty, label){
  const n = Math.round(Number(qty)||0);
  if (n <= 0) return Promise.resolve({ ok:false, error:'Nombre de parts invalide.' });
  return shareOp(playerId, +n, { issued: +n }, {
    type: MV.issue,
    from: PARTY.issuance, fromName: PARTY_NAME.__issuance__, to: playerId,
    label: String(label||'Émission de parts nouvelles').slice(0,120)
  });
}

/** Attribution depuis la tresorerie de la compagnie (capital constant). */
function grantShares(playerId, qty, label){
  const n = Math.round(Number(qty)||0);
  if (n <= 0) return Promise.resolve({ ok:false, error:'Nombre de parts invalide.' });
  return shareOp(playerId, +n, { company: -n }, {
    type: MV.grant,
    from: PARTY.company, fromName: PARTY_NAME.__company__, to: playerId,
    label: String(label||'Attribution de la compagnie').slice(0,120)
  });
}

/** Reprise vers la tresorerie de la compagnie. */
function reclaimShares(playerId, qty, label){
  const n = Math.round(Number(qty)||0);
  if (n <= 0) return Promise.resolve({ ok:false, error:'Nombre de parts invalide.' });
  return shareOp(playerId, -n, { company: +n }, {
    type: MV.reclaim,
    from: playerId, to: PARTY.company, toName: PARTY_NAME.__company__,
    label: String(label||'Reprise par la compagnie').slice(0,120)
  });
}

/* ---------- Magasin : paiement en parts ---------- */
async function purchase(playerId, itemId, qty){
  const n = Math.max(1, Math.round(Number(qty)||1));
  const pRef = db.collection(COL.players).doc(playerId);
  const sRef = db.collection(COL.shop).doc('catalog');
  const tRef = treasuryRef();
  try{
    await db.runTransaction(async tx => {
      const [ps, ss, ts] = await Promise.all([tx.get(pRef), tx.get(sRef), tx.get(tRef)]);
      if (!ps.exists) throw new Error('Compte introuvable.');
      if (!ss.exists) throw new Error('Catalogue indisponible.');
      const items = (ss.data().items || []).slice();
      const i = items.findIndex(x => x.id === itemId);
      if (i < 0) throw new Error('Article introuvable.');
      const it = Object.assign({}, items[i]);
      const tracked = it.stock !== undefined && it.stock !== null;
      if (tracked && Number(it.stock) < n) throw new Error('Stock insuffisant.');
      const total = (Number(it.price)||0) * n;
      const bal = Number(ps.data().shares)||0;
      if (bal < total) throw new Error('Tu n’as pas assez de parts en banque.');

      if (tracked){ it.stock = Number(it.stock) - n; items[i] = it; tx.update(sRef, { items }); }
      tx.update(pRef, { shares: bal - total });
      const t = ts.exists ? ts.data() : {};
      tx.set(tRef, { company: (Number(t.company)||0) + total }, { merge:true });

      tx.set(db.collection(COL.orders).doc(), {
        playerId, playerName: ps.data().pseudo || playerId,
        itemId, itemName: it.name || itemId,
        qty:n, unitPrice: Number(it.price)||0, total,
        status:'pending', ts: Date.now()
      });
      ledgerEntry(tx, {
        type: MV.shop, shares: total,
        from: playerId, fromName: ps.data().pseudo || playerId,
        to: PARTY.company, toName: PARTY_NAME.__company__,
        label: (it.name || itemId) + (n > 1 ? ' ×' + n : '')
      });
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Achat refusé.' }; }
}

/* ---------- Guichet : demandes des joueurs ---------- */
async function fileRequest(playerId, playerName, kind, qty){
  const n = Math.round(Number(qty)||0);
  if (n <= 0) return { ok:false, error:'Nombre de jetons invalide.' };
  if (kind !== 'withdraw' && kind !== 'deposit') return { ok:false, error:'Type de demande inconnu.' };
  try{
    const dup = await db.collection(COL.requests)
      .where('playerId','==',playerId).where('status','==','pending').get();
    if (!dup.empty) return { ok:false, error:'Tu as déjà une demande en attente au guichet.' };
    await db.collection(COL.requests).add({
      playerId, playerName, kind, qty:n, status:'pending', ts: Date.now()
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Demande refusée.' }; }
}

/* ============================================================
   SCRUTIN — /vote/current + /ballots/{playerId}

   Cycle : draft -> announced -> open -> closed

   Le bulletin vit dans son propre document : la page joueur ne lit que le
   sien. /vote/current.voted[playerId] ne porte que le NOMBRE de parts
   engagees — jamais la repartition. Qui a vote et combien il pese est public ;
   pour quoi il a vote ne l'est pas, jusqu'au depouillement.
   ============================================================ */
const voteRef = () => db.collection(COL.vote).doc('current');

/**
 * Convertit des parts en voix. UN SEUL passage : definitif.
 * @param {object} alloc  { optionId: nombre de parts }  (repartition libre)
 */
async function castBallot(playerId, playerName, alloc){
  const clean = {}; let total = 0;
  for (const k in (alloc||{})){
    const n = Math.max(0, Math.round(Number(alloc[k])||0));
    if (n > 0){ clean[k] = n; total += n; }
  }
  if (total <= 0) return { ok:false, error:'Engage au moins une part.' };

  const pRef = db.collection(COL.players).doc(playerId);
  const bRef = db.collection(COL.ballots).doc(playerId);
  const vRef = voteRef();
  try{
    await db.runTransaction(async tx => {
      const [ps, bs, vs] = await Promise.all([tx.get(pRef), tx.get(bRef), tx.get(vRef)]);
      if (!ps.exists) throw new Error('Compte introuvable.');
      if (!vs.exists || vs.data().status !== VOTE_STATUS.open)
        throw new Error('Le scrutin n’est pas ouvert.');
      const v = vs.data();
      if (v.closesAt && Date.now() > Number(v.closesAt))
        throw new Error('Le scrutin est clos.');
      // Un seul passage : c'est la regle, et c'est ici qu'elle tient.
      if (bs.exists) throw new Error('Tu as déjà voté. Le bulletin est définitif.');

      const ids = {}; (v.options||[]).forEach(o => { ids[o.id] = true; });
      for (const k in clean) if (!ids[k]) throw new Error('Option inconnue au scrutin.');

      const avail = Number(ps.data().shares)||0;
      if (total > avail)
        throw new Error('Tu n’as que ' + avail + ' part(s) en banque. ' +
                        'Dépose tes jetons au guichet pour en convertir plus.');

      // Les parts sortent du compte et sont BLOQUEES : on ne peut plus les
      // ceder a quelqu'un qui revoterait avec les memes.
      tx.update(pRef, {
        shares:  avail - total,
        engaged: (Number(ps.data().engaged)||0) + total
      });
      tx.set(bRef, { playerId, playerName, alloc: clean, total, ts: Date.now() });
      const upd = {}; upd['voted.' + playerId] = total;   // le poids, pas le detail
      tx.update(vRef, upd);
      ledgerEntry(tx, {
        type: MV.vote, shares: total,
        from: playerId, fromName: playerName || playerId,
        to: PARTY.urn, toName: PARTY_NAME.__urn__,
        label: 'Conversion en ' + total + ' voix'
      });
    });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message || 'Vote refusé.' }; }
}

/** Mon bulletin, ou null. */
async function myBallot(playerId){
  try{
    const s = await db.collection(COL.ballots).doc(playerId).get();
    return s.exists ? s.data() : null;
  }catch(e){ return null; }
}

/**
 * Depouillement : additionne les voix allouees, publie le resultat, puis
 * REND a chaque actionnaire ses parts engagees.
 */
async function tallyVote(){
  try{
    const vs = await voteRef().get();
    if (!vs.exists) return { ok:false, error:'Aucun scrutin.' };
    const v = vs.data();
    const [bs, ps] = await Promise.all([
      db.collection(COL.ballots).get(),
      db.collection(COL.players).get()
    ]);

    const active = {};
    ps.docs.forEach(d => { if (d.data().active !== false) active[d.id] = true; });

    const byOption = {};
    (v.options||[]).forEach(o => { byOption[o.id] = { label:o.label, shares:0, voters:0 }; });

    let voters = 0, voidShares = 0, voidBallots = 0;
    bs.docs.forEach(d => {
      const b = d.data();
      if (!active[b.playerId]){ voidBallots++; return; }   // compte suspendu/supprime
      let counted = false;
      for (const k in (b.alloc||{})){
        const n = Math.max(0, Math.round(Number(b.alloc[k])||0));
        if (!n) continue;
        if (byOption[k]){ byOption[k].shares += n; byOption[k].voters += 1; counted = true; }
        else voidShares += n;                              // option supprimee depuis
      }
      if (counted) voters++; else voidBallots++;
    });

    const expressed = Object.keys(byOption).reduce((a,k) => a + byOption[k].shares, 0);
    const ranked = Object.keys(byOption)
      .map(id => Object.assign({ id }, byOption[id]))
      .sort((a,b) => b.shares - a.shares);
    const tie = !!(ranked.length > 1 && ranked[0].shares === ranked[1].shares && ranked[0].shares > 0);
    const winner = (ranked.length && ranked[0].shares > 0 && !tie) ? ranked[0] : null;

    await voteRef().set({
      status: VOTE_STATUS.closed,
      closedAt: Date.now(),
      results: {
        byOption, ranked, expressed,
        voters, voidShares, voidBallots,
        winnerId: winner ? winner.id : null,
        tie, ts: Date.now()
      }
    }, { merge:true });

    const rel = await releaseEngaged();
    return { ok:true, voters, expressed, released: rel.released };
  }catch(e){ return { ok:false, error: e.message || 'Dépouillement impossible.' }; }
}

/**
 * Rend a chaque actionnaire ses parts engagees (shares += engaged, engaged = 0).
 * Idempotent : relancable sans risque si une execution a ete interrompue.
 */
async function releaseEngaged(){
  try{
    const ps = await db.collection(COL.players).get();
    const todo = ps.docs.filter(d => (Number(d.data().engaged)||0) > 0);
    if (!todo.length) return { ok:true, released:0 };
    // Un lot par tranche de 450 ecritures (limite Firestore : 500 par lot).
    let released = 0;
    for (let i = 0; i < todo.length; i += 225){
      const batch = db.batch();
      todo.slice(i, i+225).forEach(d => {
        const n = Number(d.data().engaged)||0;
        batch.update(d.ref, { shares: (Number(d.data().shares)||0) + n, engaged: 0 });
        batch.set(db.collection(COL.ledger).doc(), {
          type: MV.release, shares: n, ts: Date.now(),
          from: PARTY.urn, fromName: PARTY_NAME.__urn__,
          to: d.id, toName: d.data().pseudo || d.id,
          label: 'Parts rendues après le scrutin'
        });
        released += n;
      });
      await batch.commit();
    }
    return { ok:true, released };
  }catch(e){ return { ok:false, error: e.message }; }
}

/**
 * Remet le scrutin a zero : efface les bulletins, rend les parts engagees,
 * repasse en brouillon. Pour rejouer un scrutin.
 */
async function resetVote(){
  try{
    await releaseEngaged();
    const bs = await db.collection(COL.ballots).get();
    for (let i = 0; i < bs.docs.length; i += 450){
      const batch = db.batch();
      bs.docs.slice(i, i+450).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await voteRef().set({
      status:  VOTE_STATUS.draft,
      voted:   firebase.firestore.FieldValue.delete(),
      results: firebase.firestore.FieldValue.delete()
    }, { merge:true });
    return { ok:true };
  }catch(e){ return { ok:false, error: e.message }; }
}
