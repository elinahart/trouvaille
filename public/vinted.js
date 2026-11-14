// Outils Vinted. L'app ne récupère rien elle-même sur Vinted :
// - elle construit des liens de recherche que tu ouvres ;
// - le favori « Envoyer à Trouvaille » (voir bookmarklet.js) lit les annonces que TU as
//   à l'écran et les envoie à l'app, pour les afficher en visuel à côté de ton inspi.
export const VINTED_BASE = 'https://www.vinted.fr/catalog';

export function vintedSearchUrl(query, { budget } = {}) {
  const params = new URLSearchParams({ search_text: String(query || '').trim(), order: 'relevance' });
  const max = Number(budget);
  if (max > 0) {
    params.set('price_to', String(max));
    params.set('currency', 'EUR');
  }
  return `${VINTED_BASE}?${params}`;
}

/** "Jupe trapèze, Marque: edc, État: Très bon état, Taille: XL, 4.00 €, 4.90 €" → champs */
export function parseVintedLabel(label = '') {
  const s = String(label);
  const field = (k) => new RegExp(`(?:^|, )${k}: (.*?)(?=, (?:Marque|État|Taille): |, [\\d.,]+ €|$)`).exec(s)?.[1]?.trim() || '';
  const cut = s.search(/, (?:Marque|État|Taille): |, [\d.,]+ €/);
  const price = /, ([\d.,]+) €/.exec(s)?.[1];
  return {
    title: (cut > 0 ? s.slice(0, cut) : s).trim(),
    brand: field('Marque'),
    condition: field('État'),
    size: field('Taille'),
    price: price ? Number(price.replace(',', '.')) : null,
  };
}
