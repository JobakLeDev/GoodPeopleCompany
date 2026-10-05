/* ============================================================
   Good People Company — configuration
   ⚠️ REMPLACE firebaseConfig par les valeurs de TON projet :
   console.firebase.google.com → ⚙ Paramètres du projet
   → « Vos applications » → Application Web → Configuration du SDK
   ============================================================ */

window.firebaseConfig = {
  apiKey:            "A_REMPLACER",
  authDomain:        "A_REMPLACER.firebaseapp.com",
  projectId:         "A_REMPLACER",
  storageBucket:     "A_REMPLACER.appspot.com",
  messagingSenderId: "A_REMPLACER",
  appId:             "A_REMPLACER"
};

/* Code d'accès de l'organisation (page admin.html) */
window.GPC_ADMIN_CODE = "1234";

/* Réglages du jeu (surchargeables en direct via /config/game dans Firestore) */
window.GPC_DEFAULTS = {
  gameName:   "Good People Company",
  tagline:    "Programme d'intégration citoyenne",
  currency:   "crédits",
  currencySym:"\u20A2",
  startBalance: 500,
  /* Centre de la carte au 1er affichage : [lat, lng] + zoom */
  mapCenter:  [48.8566, 2.3522],
  mapZoom:    15
};
