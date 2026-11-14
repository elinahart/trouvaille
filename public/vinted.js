// Construit un lien de recherche Vinted. Aucune donnée n'est récupérée depuis Vinted :
// l'app ouvre simplement la recherche dans ton navigateur (ou l'app Vinted).
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
