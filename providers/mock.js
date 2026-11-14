// Fournisseur factice : réponse fixe, sans IA. Sert aux tests et au mode hors-ligne.
export default {
  name: 'mock',
  async analyze() {
    return {
      piece: 'veste harrington',
      categorie: 'veste/manteau',
      description: 'Veste courte zippée au col montant, esprit années 70.',
      style: ['vintage', 'casual'],
      matieres: ['coton'],
      couleurs: [{ nom: 'vert olive', hex: '#6b6b3a' }],
      recherches: [
        { requete: 'veste harrington olive', pourquoi: 'la pièce exacte', proximite: 5 },
        { requete: 'blouson vintage kaki', pourquoi: 'même esprit', proximite: 3 },
      ],
      _meta: { provider: 'mock' },
    };
  },
  // Classement factice : plus le titre contient de mots de la pièce, plus le score est haut.
  async rank({ analysis, items }) {
    const words = String(analysis?.piece || '').toLowerCase().split(/\s+/).filter(Boolean);
    return items.map((i) => {
      const hits = words.filter((w) => i.label.toLowerCase().includes(w)).length;
      return { id: i.id, score: Math.round((hits / (words.length || 1)) * 100), raison: `${hits} mot(s) en commun` };
    });
  },
};
