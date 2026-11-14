# Trouvaille

App web perso et installable (PWA) qui part de tes inspirations mode pour te trouver des pièces de seconde main sur Vinted.

- **Trouver** : tu déposes ou colles une image d'inspi. L'IA décrit la pièce (catégorie, style, matières, couleurs) et te propose 5 recherches Vinted, classées de la plus fidèle à la plus large. Un clic ouvre la recherche sur Vinted, filtrée selon ton budget.
- **Pièces trouvées, en photos** : sur la page de résultats Vinted, un clic sur le favori « 💧 Envoyer à Trouvaille » envoie les annonces affichées dans l'app. Tu les vois en vignettes à côté de ton inspi, et « Trier par ressemblance » demande à l'IA de les noter de 0 à 100 %.
- **Mood board** : toutes tes inspis rangées par tableaux, avec l'import depuis Pinterest.
- **Wishlist** : les annonces que tu as repérées (♡ depuis une pièce trouvée, ou à la main), avec le prix, la taille, l'inspi d'origine et un statut.

L'app ne va jamais chercher de données sur Vinted toute seule. Elle construit des liens de recherche, et c'est le favori, cliqué par toi, qui lit les annonces que tu as déjà à l'écran.
Tes données restent sur ta machine, dans `data/`, qui n'est pas versionné. Ça inclut les identifiants Pinterest, rangés dans `data/pinterest.json`.

## Installer le favori « Envoyer à Trouvaille »

1. Ouvre Trouvaille, puis **Réglages**.
2. Glisse le bouton « 💧 Envoyer à Trouvaille » dans ta barre de favoris. Pour l'afficher : Ctrl+Maj+B, ou Cmd+Maj+B sur Mac.
3. Sur une page de résultats Vinted, clique sur ce favori. Trouvaille s'ouvre, tu choisis l'inspi, et tu ajoutes les pièces.

Le favori contient l'adresse de l'app. Si tu changes de port ou de machine, réinstalle-le depuis les Réglages.

## Pinterest

Dans le **Mood board**, ouvre « Importer de Pinterest ». Tu as deux possibilités :

- **Tableau public, par son lien** : aucune configuration. Colle le lien d'un tableau et l'app récupère ses ~25 dernières épingles via le flux RSS public de Pinterest. Relance l'import pour récupérer les nouvelles ; les doublons sont ignorés.
- **Avec ton compte** : tu as accès à tous tes tableaux, y compris les secrets. Il faut une fois :
  1. Crée une app sur [developers.pinterest.com/apps](https://developers.pinterest.com/apps/).
  2. Ajoute l'adresse de redirection `http://localhost:5180/auth/pinterest/callback`.
  3. Colle l'App ID et la clé secrète dans Trouvaille, puis clique sur « Se connecter à Pinterest ».

Les épingles importées arrivent « à analyser ». Ouvre-en une et clique sur « Analyser et trouver des pièces ».

## Lancer

Il faut Node.js 20 ou plus récent. Il n'y a aucune dépendance à installer.

```bash
npm start          # http://localhost:5180
npm run demo       # mode test, sans IA (réponse factice)
npm test
```

## IA : connexion par ton compte Claude

Par défaut, l'app appelle la CLI **Claude Code** (`claude -p`) déjà connectée à **ton compte Claude**.
Elle n'utilise **aucune clé API** : elle retire même `ANTHROPIC_API_KEY` de l'environnement avant l'appel.
Avant la première utilisation, lance une fois `claude` dans un terminal et connecte-toi.

| Variable | Rôle | Défaut |
|---|---|---|
| `AI_PROVIDER` | `claude-cli`, `luna` ou `mock` | `claude-cli` |
| `CLAUDE_MODEL` | modèle utilisé par la CLI | `sonnet` |
| `CLAUDE_BIN` | chemin de la CLI | `claude` |
| `PORT` / `HOST` | adresse du serveur | `5180` / cet ordinateur seulement |
| `PUBLIC_ORIGIN` | adresse publique de l'app (redirection Pinterest) | `http://localhost:5180` |
| `DATA_DIR` | dossier des données | `./data` |

## Brancher Luna plus tard

```bash
AI_PROVIDER=luna LUNA_URL=http://localhost:XXXX/analyse npm start
```

Luna recevra un `POST` JSON `{ task, prompt, image: { mime, base64 }, schema }`. Avec `task: "analyze"`, elle devra renvoyer un objet conforme à `ANALYSIS_SCHEMA`. Avec `task: "rank"`, elle devra renvoyer `{ classement: [{ id, score, raison }] }`. Les deux schémas sont dans [providers/index.js](providers/index.js).
Le jeton optionnel `LUNA_TOKEN` est envoyé en `Authorization: Bearer`.
Pour ajouter une autre IA, il suffit de créer un fichier dans `providers/` qui exporte `{ name, analyze() }`.

## Récupérer l'app sur le Mac (via GitHub)

1. Sur GitHub, crée un dépôt vide, par exemple `trouvaille`, en **privé** de préférence.
2. Ici, ajoute le dépôt distant puis envoie le code :

   ```bash
   git remote add origin https://github.com/<ton-compte>/trouvaille.git
   ```

   ```bash
   git push -u origin main
   ```

3. Sur le Mac, avec Node.js installé (par exemple via `brew install node`) et Claude Code connecté à ton compte :

   ```bash
   git clone https://github.com/<ton-compte>/trouvaille.git && cd trouvaille && npm start
   ```

## Installer comme une app

Ouvre `http://localhost:5180` dans Chrome ou Edge, puis clique sur l'icône « Installer » dans la barre d'adresse.
Sur le Mac avec Safari, passe par Fichier puis « Ajouter au Dock ».
Pour un usage sur téléphone, il faudra plus tard un accès HTTPS (par exemple via Luna ou un tunnel).
