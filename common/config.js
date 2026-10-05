/* ============================================================
   Good People Company — configuration
   REMPLACE firebaseConfig par les valeurs de TON projet :
   console.firebase.google.com -> Parametres du projet
   -> « Vos applications » -> Application Web -> Configuration du SDK
   ============================================================ */

window.firebaseConfig = {
  apiKey:            "A_REMPLACER",
  authDomain:        "A_REMPLACER.firebaseapp.com",
  projectId:         "A_REMPLACER",
  storageBucket:     "A_REMPLACER.appspot.com",
  messagingSenderId: "A_REMPLACER",
  appId:             "A_REMPLACER"
};

/* Code d'acces du guichet / console organisation (admin.html) */
window.GPC_ADMIN_CODE = "1234";

/* Reglages de partie (surchargeables en direct via /config/game dans Firestore) */
window.GPC_DEFAULTS = {
  gameName:   "Good People Company",
  tagline:    "Assemblée générale extraordinaire",

  /* Vocabulaire de la part - adapte-le a ton univers */
  unit:       "part",
  units:      "parts",

  /* Dotation par defaut d'un nouvel actionnaire */
  startShares: 20,

  /* Nombre d'actionnaires visibles dans le registre public (0 = aucun) */
  registryTop: 10,

  /* Centre de la carte au 1er affichage : [lat, lng] + zoom.
     A regler sur l'hebergement reel depuis la console -> Reglages. */
  mapCenter:  [48.8566, 2.3522],
  mapZoom:    17
};
