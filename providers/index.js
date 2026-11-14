// Choix du fournisseur d'IA qui analyse les images.
// AI_PROVIDER=claude-cli (défaut) | luna | mock
//
// Chaque fournisseur expose : name, analyze({ imagePath, notes, size, budget }) -> Analyse
// Une "Analyse" a la forme décrite dans ANALYSIS_SCHEMA : c'est aussi le contrat
// que Luna devra respecter plus tard.

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    piece: { type: 'string', description: 'Nom court de la pièce principale, ex. "veste harrington"' },
    categorie: { type: 'string', description: 'haut, bas, robe, veste/manteau, chaussures, sac, accessoire…' },
    description: { type: 'string', description: 'Une ou deux phrases sur la pièce et son style' },
    style: { type: 'array', items: { type: 'string' }, description: 'Mots-clés de style, ex. vintage, y2k, minimal' },
    matieres: { type: 'array', items: { type: 'string' } },
    couleurs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nom: { type: 'string' }, hex: { type: 'string' } },
        required: ['nom', 'hex'],
      },
    },
    recherches: {
      type: 'array',
      description: 'De la plus précise à la plus large. Requêtes courtes, comme tapées sur Vinted.',
      items: {
        type: 'object',
        properties: {
          requete: { type: 'string', description: '2 à 5 mots, en français, marque si identifiable' },
          pourquoi: { type: 'string', description: 'Ce que cette recherche cible, en quelques mots' },
          proximite: { type: 'integer', description: 'Proximité attendue avec l’inspiration, de 1 à 5' },
        },
        required: ['requete', 'pourquoi', 'proximite'],
      },
    },
  },
  required: ['piece', 'categorie', 'description', 'style', 'matieres', 'couleurs', 'recherches'],
};

export async function getProvider(name = process.env.AI_PROVIDER || 'claude-cli') {
  switch (name) {
    case 'claude-cli':
      return (await import('./claude-cli.js')).default;
    case 'luna':
      return (await import('./luna.js')).default;
    case 'mock':
      return (await import('./mock.js')).default;
    default:
      throw new Error(`Fournisseur IA inconnu : ${name}`);
  }
}

export function buildPrompt({ notes, size, budget } = {}) {
  const lines = [
    'Analyse cette image d’inspiration mode.',
    'Identifie la pièce principale et propose 5 recherches Vinted, de la plus fidèle à la plus large.',
  ];
  if (size) lines.push(`Taille de l’utilisatrice : ${size} (ne l’ajoute pas dans les requêtes).`);
  if (budget) lines.push(`Budget max : ${budget} €.`);
  if (notes) lines.push(`Précision de l’utilisatrice : ${notes}`);
  return lines.join('\n');
}

// Classement des pièces trouvées sur Vinted par ressemblance avec l'inspiration.
// Chaque fournisseur peut exposer : rank({ imagePath, analysis, items: [{ id, label }] }) -> [{ id, score, raison }]
export const RANK_SCHEMA = {
  type: 'object',
  properties: {
    classement: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'integer', description: 'Ressemblance avec l’inspiration, de 0 à 100' },
          raison: { type: 'string', description: 'Quelques mots : ce qui colle ou pas' },
        },
        required: ['id', 'score', 'raison'],
      },
    },
  },
  required: ['classement'],
};

export function buildRankPrompt({ analysis, items }) {
  return [
    'Voici une image d’inspiration mode et une liste d’annonces Vinted (titre, marque, état, taille, prix).',
    analysis?.piece ? `Pièce recherchée : ${analysis.piece} — ${analysis.description || ''}` : '',
    'Note chaque annonce de 0 à 100 selon sa ressemblance probable avec l’inspiration (type de pièce, coupe, couleur, matière, style).',
    'Annonces :',
    ...items.map((i) => `- id=${i.id} : ${i.label}`),
  ].filter(Boolean).join('\n');
}
