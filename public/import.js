import { parseVintedLabel } from './vinted.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let items = [];
try {
  items = JSON.parse(decodeURIComponent(location.hash.slice(1)) || '[]');
} catch {}
items = Array.isArray(items) ? items.filter((i) => i && i.id && i.url && i.photo) : [];
history.replaceState(null, '', location.pathname); // vide l'adresse

if (!items.length) {
  $('#importForm').hidden = true;
  $('#empty').hidden = false;
} else {
  $('#count').textContent = `${items.length} pièce(s) reçue(s) depuis Vinted`;
  $('#grid').innerHTML = items
    .map((it, n) => {
      const f = parseVintedLabel(it.label);
      return `<label class="find selectable">
        <input type="checkbox" checked data-n="${n}">
        <img src="${esc(it.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="find-body">
          <strong>${f.price != null ? f.price.toFixed(2) + ' €' : ''}</strong>
          <span>${esc(f.title)}</span>
          <small>${[f.brand, f.size, f.condition].filter(Boolean).map(esc).join(' · ')}</small>
        </div>
      </label>`;
    })
    .join('');
}

const toast = (msg) => {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
};

(async () => {
  const insps = await fetch('/api/inspirations').then((r) => r.json()).catch(() => []);
  let last = '';
  try { last = localStorage.getItem('lastInsp') || ''; } catch {}
  $('#insp').innerHTML = insps.length
    ? insps.map((i) => `<option value="${i.id}" ${i.id === last ? 'selected' : ''}>${esc(i.analysis?.piece || i.pinTitle || 'Inspi sans titre')} (${esc(i.board)})</option>`).join('')
    : '<option value="">Crée d’abord une inspi dans l’app</option>';
})();

$('#toggleAll').addEventListener('click', () => {
  const boxes = [...document.querySelectorAll('#grid input')];
  const anyChecked = boxes.some((b) => b.checked);
  boxes.forEach((b) => (b.checked = !anyChecked));
  $('#toggleAll').textContent = anyChecked ? 'Tout cocher' : 'Tout décocher';
});

$('#importForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#insp').value;
  if (!id) return toast('Choisis une inspi');
  const chosen = [...document.querySelectorAll('#grid input:checked')].map((b) => items[Number(b.dataset.n)]);
  if (!chosen.length) return toast('Aucune pièce cochée');
  const res = await fetch(`/api/inspirations/${id}/finds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: chosen }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || 'Erreur');
  try { localStorage.setItem('lastInsp', id); } catch {}
  location.href = `/?insp=${encodeURIComponent(id)}&added=${data.added}`;
});
