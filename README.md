# Good People Company

Support web d'un jeu de rôle grandeur nature sur un week-end.
Les joueurs s'y connectent depuis leur téléphone pour consulter leur
portefeuille, le plan du site, le règlement, leurs statistiques, le magasin
et le journal public. L'organisation pilote tout depuis une console dédiée.

- **Hébergement** : GitHub Pages
- **Base de données** : Firebase Firestore (temps réel, SDK compat v9)
- **Pas de build, pas de framework** : HTML / CSS / JS vanilla

---

## Mise en route (15 minutes)

### 1. Créer le projet Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet**
2. Dans le projet : **Build → Firestore Database → Créer une base** (mode production, région `europe-west`)
3. **⚙ Paramètres du projet → Vos applications → `</>` Application Web** → enregistrer l'app
4. Copier l'objet `firebaseConfig` affiché

### 2. Brancher la config

Ouvrir `common/config.js` et remplacer les `"A_REMPLACER"` par les valeurs copiées.
Dans le même fichier, changer `GPC_ADMIN_CODE` (le code d'accès à `admin.html`).

### 3. Publier les règles de sécurité

Console Firebase → **Firestore Database → Règles** → coller le contenu de
`firestore.rules` → **Publier**.

> ⚠️ **À republier chaque fois qu'une collection est ajoutée** : la règle
> fourre-tout en fin de fichier refuse tout ce qui n'est pas listé.

### 4. Activer GitHub Pages

Repo → **Settings → Pages** → Source : `Deploy from a branch`, branche `main`, dossier `/ (root)`.
Le site est en ligne sur `https://jobakledev.github.io/GoodPeopleCompany/`.

Un fichier `.nojekyll` est déjà présent (il évite que Jekyll ignore certains dossiers).

### 5. Créer les joueurs

Ouvrir `admin.html`, saisir le code organisation, onglet **Joueurs** :
un nom d'agent + un code à 4 chiffres par joueur. L'identifiant est déduit du
nom (`Camille Dubreuil` → `camille-dubreuil`).

Imprimer les codes sur les badges : le joueur se connecte avec **son nom + son code**.

---

## Les pages

| Fichier | Qui | Quoi |
|---|---|---|
| `index.html` | joueurs | Accueil + connexion (nom d'agent + code) |
| `perso.html` | joueurs | Dossier personnel, 6 onglets en bas d'écran |
| `admin.html` | organisation | Console : joueurs, magasin, commandes, journal, carte, réglages |

Les six onglets joueur : **Argent** (solde, virements, relevé) · **Plan**
(carte OpenStreetMap, points d'intérêt, position) · **Magasin** · **Journal** ·
**Stats** (dossier perso + indicateurs globaux) · **Règles**.

Tout est en temps réel : un crédit accordé par l'orga apparaît sur le téléphone
du joueur sans rechargement.

---

## Structure

```
index.html            → accueil + login
perso.html            → hub joueur (6 onglets)
admin.html            → console organisation (code: config.js)
common/
  config.js           → firebaseConfig + code admin + réglages par défaut
  app.js              → init Firebase, session, virements, achats, helpers
  style.css           → thème sombre « corporate », mobile-first
data/
  rules.json          → règlement par défaut (surchargé par /config/game.rules)
firestore.rules       → règles à publier dans la console Firebase
.nojekyll
```

### Fonctions clés de `common/app.js`

| Fonction | Rôle |
|---|---|
| `login(pseudo, code)` | Vérifie contre `/players/{slug}`, ouvre la session |
| `getSession()` / `requireSession()` | Session `localStorage` ; `?id=` court-circuite (tests) |
| `loadGame()` | Fusionne `GPC_DEFAULTS` et `/config/game` dans `GAME` |
| `transfer(from, to, amt, label)` | Virement joueur → joueur, **transaction Firestore** |
| `purchase(playerId, itemId, qty)` | Achat : débite le solde **et** décrémente le stock, atomique |
| `adminAdjust(playerId, delta, label)` | Crédit/débit organisation |
| `money()` `when()` `esc()` `slugify()` `miniMd()` `say()` | Formatage et garde-fous d'affichage |

Les trois opérations d'argent passent par `db.runTransaction` : deux joueurs qui
cliquent en même temps ne peuvent pas dupliquer ou perdre des fonds. Chacune
écrit une ligne dans `/ledger`.

---

## Schéma Firestore

```
/players/{slug}        { pseudo, code, role, balance, stats:{}, publicNote,
                         active, sharing, pos:{lat,lng,ts}, createdAt }
/ledger/{auto}         { type:'transfer'|'shop'|'admin', amount,
                         from, fromName, to, toName, label, ts }
/orders/{auto}         { playerId, playerName, itemId, itemName, qty,
                         unitPrice, total, status:'pending'|'delivered', ts }
/shop/catalog          { items:[{ id, name, desc, price, stock?, icon?, img?, hidden }] }
/journal/public        { entries:[{ id, title, text, ts }] }
/map/data              { pois:[{ id, name, desc, lat, lng }] }
/config/game           { gameName, tagline, currency, currencySym, startBalance,
                         mapCenter:[lat,lng], mapZoom, rules }
```

Conventions :

- **`stock` absent ou `null` = stock illimité.** Un nombre active le décompte.
- **`stats`** accepte un nombre brut (compteur) ou `{"value":3,"max":10}` (barre
  de progression). Édité en JSON depuis la console orga.
- Les pseudo-destinataires `__shop__` et `__bank__` dans `/ledger` représentent
  le magasin et l'organisation : ce ne sont pas des joueurs.
- API compat v9 : `snap.exists` **sans parenthèses**.

---

## Sécurité : ce que ça garantit, ce que ça ne garantit pas

Le login est vérifié **dans le navigateur**, sans Firebase Auth. Firestore ne
sait donc pas qui écrit, et les règles sont ouvertes. Concrètement : un joueur
curieux qui ouvre la console de son navigateur peut lire les codes des autres et
changer son solde.

C'est un compromis assumé pour un week-end entre joueurs consentants, à condition
de respecter deux choses :

1. **Aucune donnée personnelle réelle** dans ces documents (pas de téléphone,
   pas d'adresse, pas d'e-mail). Noms de personnage uniquement.
2. **Après le week-end**, repasser les règles en `allow read, write: if false;`
   ou supprimer le projet Firebase.

Pour une vraie étanchéité (si le jeu est rejoué, ou joué avec des inconnus) :
activer Firebase Auth anonyme, stocker l'`uid` dans `/players/{id}.uid`, et
déplacer les mouvements d'argent dans des Cloud Functions — seules habilitées à
écrire `balance` et `/ledger`.

---

## Réglages en cours de partie

Onglet **Réglages** de la console orga (écrit `/config/game`, pris en compte au
prochain chargement côté joueur) :

- nom du jeu, accroche
- nom et symbole de la monnaie, solde de départ des nouveaux dossiers
- centre et zoom de la carte — **à régler sur le lieu réel du GN avant le début**
- le **règlement** complet, en markdown léger (`### Titre`, `- liste`, `**gras**`)

Tant que le champ règlement est vide, c'est `data/rules.json` qui s'affiche.

---

## Avant le début du jeu — liste de contrôle

- [ ] `common/config.js` rempli (firebaseConfig + code organisation changé)
- [ ] `firestore.rules` publié dans la console
- [ ] GitHub Pages actif, site accessible depuis un téléphone en 4G
- [ ] Centre de la carte réglé sur le lieu réel
- [ ] Règlement relu (notamment le mot d'arrêt et les consignes de sécurité)
- [ ] Un dossier joueur par participant, codes imprimés sur les badges
- [ ] Catalogue du magasin rempli, stocks cohérents avec ce que vous avez vraiment
- [ ] Un test complet sur un vrai téléphone : connexion → virement → achat
- [ ] Réseau vérifié sur place (le site ne fonctionne pas hors ligne)
