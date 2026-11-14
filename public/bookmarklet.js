// Favori « Envoyer à Trouvaille » (Vinted).
// Il lit uniquement les annonces que TU as à l'écran sur une page de résultats Vinted,
// et les envoie à l'app pour les afficher en photos à côté de ton inspi.
const SOURCE = `(()=>{
const o=__ORIGIN__;
if(!/(^|\\.)vinted\\./.test(location.hostname)){alert('Trouvaille : ouvre une page de résultats Vinted, puis clique à nouveau.');return}
const seen=new Set(),items=[];
document.querySelectorAll('a[href*="/items/"]').forEach(a=>{const m=a.href.match(/\\/items\\/(\\d+)/);if(!m||seen.has(m[1]))return;
const c=a.closest('[data-testid="grid-item"]')||a.parentElement;const img=c&&c.querySelector('img');
const t=a.getAttribute('title')||(img&&img.alt)||'';if(!img||!img.src||!t)return;seen.add(m[1]);
items.push({id:m[1],url:a.href.split('?')[0],photo:img.src,label:t})});
if(!items.length){alert('Trouvaille : aucune annonce trouvée sur cette page Vinted.');return}
window.open(o+'/import.html#'+encodeURIComponent(JSON.stringify({type:'vinted',items:items.slice(0,60)})),'trouvaille');
})()`;

/** Code du favori à glisser dans la barre de favoris. `origin` = adresse de l'app. */
export function bookmarkletCode(origin) {
  const src = SOURCE.replace('__ORIGIN__', JSON.stringify(origin)).replace(/\n/g, '');
  return 'javascript:' + encodeURIComponent(src);
}
