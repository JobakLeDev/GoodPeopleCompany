# Good People Company

Support web d'un jeu grandeur nature d'un week-end : une quarantaine de joueurs
sont les **actionnaires d'une entreprise** et doivent trancher une décision par
un **vote pondéré** à la fin du week-end. Tout le week-end, ils s'échangent des
parts — entre eux, et avec l'organisation au guichet.

- **Hébergement** : GitHub Pages
- **Base de données** : Firebase Firestore (temps réel, SDK compat v9)
- **Pas de build, pas de framework** : HTML / CSS / JS vanilla

---

## Le modèle de jeu, en une page

Une **part** existe sous deux formes :

| | Où | L'app la voit ? | Vote ? |
|---|---|---|---|
| **En banque** | sur le compte du joueur | oui | **oui** |
| **En jetons** | dans sa poche, physiquement | non, jamais | **non** |

Le **guichet de l'organisation** est le seul point de conversion, dans les deux
sens : *retrait* (compte → jetons) et *dépôt* (jetons → compte).

**La règle qui structure tout le week-end** : l'app ne peut compter que ce
qu'elle voit. Un jeton dans une poche est intraçable par construction — donc
**seules les parts en banque sont comptées au scrutin**, et il faut avoir déposé
ses jetons avant la clôture. D'où la ruée au guichet en fin de partie, qui est
une mécanique, pas un effet de bord.

Le jeton est **discret mais muet** ; la part en banque est **bavarde mais elle
compte**. Arbitrer entre les deux est le cœur du jeu.

### Ce que ça donne concrètement

- Un joueur peut **céder des parts en banque** depuis son téléphone : immédiat,
  définitif, tracé dans son relevé et dans celui du destinataire.
- Il peut aussi **tout sortir en jetons** pour négocier sans laisser de trace —
  au risque d'oublier de redéposer avant l'heure.
- Le **registre public** ne montre que les parts en banque. Celui qui garde tout
  en jetons est invisible au classement… et sans voix au scrutin.
- L'indicateur **« en jetons dehors »** dit à tout le monde quelle fraction du
  capital est dans la nature à cet instant.

---

## Mise en route (15 minutes)

### 1. Créer le projet Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet**
2. **Build → Firestore Database → Créer une base** (mode production, région `europe-west`)
3. **⚙ Paramètres du projet → Vos applications → `</>` Application Web** → enregistrer l'app
4. Copier l'objet `firebaseConfig` affiché

### 2. Brancher la config

Dans `common/config.js` : remplacer les `"A_REMPLACER"` par les valeurs copiées,
et changer `GPC_ADMIN_CODE` (le code du guichet).

### 3. Publier les règles de sécurité

Console Firebase → **Firestore Database → Règles** → coller `firestore.rules` → **Publier**.

> ⚠️ **À republier chaque fois qu'une collection est ajoutée** : la règle
> fourre-tout en fin de fichier refuse tout ce qui n'est pas listé.

### 4. Activer GitHub Pages

Repo → **Settings → Pages** → Source `Deploy from a branch`, branche `main`, dossier `/ (root)`.
Site en ligne sur `https://jobakledev.github.io/GoodPeopleCompany/`.

### 5. Créer les 40 actionnaires

`admin.html` → code du guichet → onglet **Actionnaires** → **Création en série** :
coller la liste, un nom par ligne.

```
Camille Dubreuil
Anaïs Berger;4821;Fonds Mercure
Victor Pann;;Petit porteur;5
```

Format : `Nom` · `Nom;code` · `Nom;code;rôle` · `Nom;code;rôle;parts`.
Code vide = tiré au hasard. Parts vides = dotation par défaut.

La page affiche ensuite **le tableau des codes à distribuer**, et le bouton
**🖨 Codes** du registre ouvre une version imprimable pour les badges.

---

## Les pages

| Fichier | Qui | Quoi |
|---|---|---|
| `index.html` | joueurs | Accueil + connexion (nom + code) |
| `perso.html` | joueurs | Compte actionnaire, 6 onglets en bas d'écran |
| `admin.html` | organisation | Guichet, registre, scrutin, magasin, journal, carte, réglages |

**Onglets joueur** : **Parts** (solde, guichet, cession, relevé) · **Vote** ·
**Registre** (top N + où est le capital) · **Magasin** · **Journal** ·
**Infos** (plan, règles, dossier perso).

**Onglets organisation** : **Guichet** (file d'attente + opération directe) ·
**Actionnaires** · **Scrutin** · **Magasin** · **Commandes** · **Journal** ·
**Carte** · **Réglages**.

Tout est en temps réel : une attribution de parts apparaît sur le téléphone du
joueur sans rechargement.

---

## Le guichet, en pratique

Avec 40 personnes, la file d'attente est le goulot. Deux chemins :

1. **Le joueur pose sa demande** depuis son téléphone (onglet Parts → Guichet) :
   « retirer 12 jetons ». Elle apparaît dans la file de la console, avec son
   solde. Tu comptes les jetons, tu cliques une fois. Un joueur ne peut avoir
   qu'une demande en attente à la fois.
2. **Opération directe** : pour qui arrive sans avoir rien posé — sélection,
   quantité, un bouton.

Le compteur rouge sur l'onglet **Guichet** indique le nombre de personnes en
attente.

---

## Le scrutin

Onglet **Scrutin** de la console :

1. Rédiger la **question**, l'**exposé des motifs**, et les **options** (une par
   ligne, format `Intitulé;précision`).
2. Fixer la **clôture** — c'est aussi l'heure limite de dépôt des jetons. Les
   joueurs voient un compte à rebours.
3. **Ouvrir le scrutin**. Avant ça, les joueurs ne voient rien.
4. Pendant le vote : **participation en direct** (votants, % du capital exprimé,
   jetons encore dehors) et la **liste de ceux qui n'ont pas voté** — avec leur
   poids, ce qui en fait une liste de gens à aller chercher.
5. **Clore et dépouiller**.

Détails qui comptent :

- **Le poids est calculé au dépouillement**, pas au moment du vote. Accumuler
  après avoir voté augmente son poids ; céder le diminue. Le total reste
  conservé — pas de double comptage possible.
- Un joueur peut **changer son bulletin** jusqu'à la clôture.
- **Qui a voté est public, ce qu'il a voté ne l'est pas** avant le
  dépouillement. Chaque bulletin vit dans son propre document `/ballots/{id}` ;
  `/vote/current` ne porte que la liste des votants. (Au sens technique le
  secret n'est pas garanti — voir *Sécurité* plus bas.)
- Clore est **réversible** : « Ouvrir » relance le scrutin et efface le résultat
  publié, les bulletins sont conservés.
- En cas d'**égalité parfaite**, l'app le dit et ne tranche pas.

---

## Les leviers de l'organisation

Sur la fiche de chaque actionnaire :

| Bouton | Effet | Capital total |
|---|---|---|
| **＋ Émettre** | crée des parts nouvelles et les lui donne | **augmente** — dilue tous les autres |
| **＋ Attribuer** | les prend dans la trésorerie de la compagnie | inchangé |
| **－ Reprendre** | les renvoie à la trésorerie | inchangé |

La **dilution** est donc un vrai levier narratif : récompenser quelqu'un en
émettant, c'est affaiblir la part de tous les autres — et ça se voit dans le
registre.

Onglet **Réglages** → *Émettre vers la trésorerie* : crée un stock de parts non
attribuées, à distribuer ensuite sans diluer personne.

---

## Structure

```
index.html            → accueil + login
perso.html            → compte actionnaire (6 onglets)
admin.html            → guichet & direction (code: config.js)
common/
  config.js           → firebaseConfig + code guichet + réglages par défaut
  app.js              → session, comptabilité des parts, scrutin, helpers
  style.css           → thème sombre « corporate », mobile-first
data/
  rules.json          → règles par défaut (surchargées par /config/game.rules)
firestore.rules       → règles à publier dans la console Firebase
.nojekyll
```

### Fonctions clés de `common/app.js`

| Fonction | Rôle |
|---|---|
| `login(pseudo, code)` | Vérifie contre `/players/{slug}`, ouvre la session |
| `getSession()` / `requireSession()` | Session `localStorage` ; `?id=` court-circuite (tests) |
| `loadGame()` / `loadTreasury()` | Fusionne les défauts et `/config/*` |
| `shareOp(pid, dShares, dTres, entry)` | **Le cœur** : une opération atomique compte + trésorerie + grand livre |
| `transferShares(from, to, n, label)` | Cession entre actionnaires, transaction Firestore |
| `withdrawTokens` / `depositTokens` | Guichet : compte ⇄ jetons physiques |
| `issueShares` / `grantShares` / `reclaimShares` | Émission (dilution) / attribution / reprise |
| `purchase(pid, itemId, qty)` | Achat : débite les parts **et** décrémente le stock |
| `fileRequest(...)` | Le joueur prend un ticket au guichet |
| `castBallot(...)` / `myBallot(...)` / `tallyVote()` | Scrutin et dépouillement pondéré |
| `num` `parts` `pctOf` `when` `countdown` `esc` `slugify` `miniMd` `say` | Formatage et garde-fous d'affichage |

Toutes les opérations sur les parts passent par `db.runTransaction` : deux
personnes qui cliquent en même temps ne peuvent ni dupliquer ni perdre de parts.
Chacune écrit une ligne dans `/ledger`, que les règles rendent non réinscriptible.

---

## Schéma Firestore

```
/players/{slug}        { pseudo, code, role, shares, stats:{}, publicNote,
                         active, createdAt }
                       shares = parts EN BANQUE (les jetons ne sont pas ici)

/config/treasury       { issued, circulating, company }
                       issued      = capital émis
                       circulating = parts sorties en jetons physiques
                       company     = parts détenues par la compagnie

/ledger/{auto}         { type, shares, from, fromName, to, toName, label, ts }
                       type ∈ transfer | withdraw | deposit | issue | grant
                              | reclaim | shop

/requests/{auto}       { playerId, playerName, kind:'withdraw'|'deposit', qty,
                         status:'pending'|'done'|'cancelled', ts }

/vote/current          { question, detail, options:[{id,label,desc}],
                         status:'draft'|'open'|'closed', closesAt,
                         voted:{playerId:true},        ← qui, jamais quoi
                         results:{ byOption, ranked, expressed, onAccounts,
                                   voters, voidBallots, winnerId, tie, ts } }
/ballots/{playerId}    { playerId, playerName, optionId, ts }

/orders/{auto}         { playerId, playerName, itemId, itemName, qty,
                         unitPrice, total, status:'pending'|'delivered', ts }
/shop/catalog          { items:[{ id, name, desc, price, stock?, icon?, img?, hidden }] }
/journal/public        { entries:[{ id, title, text, ts }] }
/map/data              { pois:[{ id, name, desc, lat, lng }] }
/config/game           { gameName, tagline, unit, units, startShares,
                         registryTop, mapCenter:[lat,lng], mapZoom, rules }
```

### Invariant comptable

```
issued  =  Σ players.shares  +  circulating  +  company
```

La console l'affiche en permanence sous le nom **« Écart comptable »**. Il doit
rester à `0` : toute autre valeur signale une saisie à la main dans la console
Firebase, ou la suppression d'un actionnaire qui détenait encore des parts.

### Conventions

- **`stock` absent ou `null` = stock illimité.** Un nombre active le décompte.
- **`stats`** accepte un nombre brut ou `{"value":3,"max":10}` (barre de
  progression). Édité en JSON depuis la console.
- Les contreparties `__company__`, `__tokens__` et `__issuance__` dans `/ledger`
  ne sont pas des joueurs : ce sont la trésorerie, les jetons en circulation, et
  l'émission.
- Supprimer un actionnaire ne reprend pas ses parts : **reprends-les d'abord**
  si tu veux garder l'invariant juste.
- API compat v9 : `snap.exists` **sans parenthèses**.

---

## Sécurité : ce que ça garantit, ce que ça ne garantit pas

La connexion est vérifiée **dans le navigateur**, sans Firebase Auth. Firestore
ne sait pas qui écrit, et les règles sont ouvertes. Concrètement : un joueur
curieux qui ouvre la console de son navigateur peut lire les codes des autres,
lire les bulletins avant le dépouillement, et modifier son nombre de parts.

C'est tenable pour un week-end entre gens consentants, à deux conditions :

1. **Aucune donnée personnelle réelle** dans ces documents — noms de
   personnage uniquement, pas de téléphone, pas d'e-mail.
2. **Après le week-end**, repasser les règles en `allow read, write: if false;`
   ou supprimer le projet Firebase.

Le **grand livre est la garantie pratique** : il n'est pas réinscriptible par les
règles, donc une part qui apparaît sans ligne de mouvement se repère. L'« écart
comptable » de la console sert exactement à ça.

Pour une vraie étanchéité (jeu rejoué, joueurs inconnus, enjeu réel) : Firebase
Auth anonyme + `uid` dans `/players/{id}` + Cloud Functions seules habilitées à
écrire `shares`, `/ledger` et `/vote`.

---

## Avant le début du jeu — liste de contrôle

- [ ] `common/config.js` rempli (firebaseConfig + code du guichet changé)
- [ ] `firestore.rules` publié dans la console
- [ ] GitHub Pages actif, site ouvert depuis un téléphone **en 4G**
- [ ] **Réseau vérifié sur place** : à la campagne, c'est le vrai risque. Pas de
      réseau = pas de jeu. Teste la couverture dans la pièce où sera le guichet,
      et prévois un partage de connexion ou un point Wi-Fi de secours.
- [ ] Centre de la carte réglé sur l'hébergement (Réglages → latitude/longitude)
- [ ] Points d'intérêt posés : guichet, salle de l'assemblée, zones interdites
- [ ] Règles relues et adaptées — les passages entre `[crochets]` dans
      `data/rules.json` sont à remplir (horaires, pièces interdites, mot d'arrêt)
- [ ] Les 40 dossiers créés, codes imprimés sur les badges
- [ ] **Les jetons physiques comptés**, et leur nombre cohérent avec la dotation
      distribuée : tu ne pourras pas remettre plus de jetons que tu n'en as
- [ ] Catalogue du magasin rempli, prix en parts
- [ ] Question du vote et options rédigées, enregistrées en **brouillon**
- [ ] Un test complet sur un vrai téléphone : connexion → cession → retrait au
      guichet → dépôt → vote → dépouillement
- [ ] Un deuxième appareil de guichet prévu (tablette ou PC), pour que la file
      n'attende pas sur un seul écran
