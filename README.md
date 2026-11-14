# Trouvaille

App web perso et installable (PWA) qui part de tes inspirations mode pour te trouver des pièces de seconde main sur Vinted.

- **Trouver** : tu déposes ou colles une image d'inspi. L'IA décrit la pièce (catégorie, style, matières, couleurs) et te propose 5 recherches Vinted, classées de la plus fidèle à la plus large. Un clic ouvre la recherche sur Vinted, filtrée selon ton budget.
- **Mood board** : toutes tes inspis, rangées par tableaux.
- **Wishlist** : les annonces que tu as repérées, avec le prix, la taille, l'inspi d'origine et un statut (repérée, achetée ou abandonnée).

L'app ne récupère aucune donnée depuis Vinted. Elle construit des liens de recherche que tu ouvres toi-même.
Tes données restent sur ta machine, dans `data/`, qui n'est pas versionné.

## Lancer

Il faut Node.js 20 ou plus récent. Il n'y a aucune dépendance à installer.

```bash
npm start          # http://127.0.0.1:5180
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
| `PORT` / `HOST` | adresse du serveur | `5180` / `127.0.0.1` |
| `DATA_DIR` | dossier des données | `./data` |

## Brancher Luna plus tard

```bash
AI_PROVIDER=luna LUNA_URL=http://localhost:XXXX/analyse npm start
```

Luna recevra un `POST` JSON `{ prompt, image: { mime, base64 }, schema }` et devra renvoyer un objet conforme à `ANALYSIS_SCHEMA` (voir [providers/index.js](providers/index.js)).
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

Ouvre `http://127.0.0.1:5180` dans Chrome ou Edge, puis clique sur l'icône « Installer » dans la barre d'adresse.
Sur le Mac avec Safari, passe par Fichier puis « Ajouter au Dock ».
Pour un usage sur téléphone, il faudra plus tard un accès HTTPS (par exemple via Luna ou un tunnel).
