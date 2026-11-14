const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = { inspirations: [], wishlist: [], settings: {}, provider: '', boardFilter: 'Tous', imageData: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Onglets ---------- */
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  try { localStorage.setItem('tab', name); } catch {}
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- Image : choix, glisser-déposer, coller ---------- */
const drop = $('#drop');
$('#fileInput').addEventListener('change', (e) => e.target.files[0] && loadImage(e.target.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (f) loadImage(f);
});
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { showTab('find'); loadImage(item.getAsFile()); }
});

// Redimensionne à 1280 px max et ré-encode en JPEG : plus léger à envoyer et à analyser.
async function loadImage(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return toast('Image illisible');
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  state.imageData = canvas.toDataURL('image/jpeg', 0.88);
  $('#preview').src = state.imageData;
  $('#preview').hidden = false;
  $('#dropHint').hidden = true;
  $('#analyzeBtn').disabled = false;
}

/* ---------- Analyse ---------- */
$('#findForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.imageData) return;
  const btn = $('#analyzeBtn');
  btn.disabled = true;
  $('#result').innerHTML = `<div class="card loading"><span class="spinner"></span>Analyse en cours avec ${esc(providerLabel())}… (10 à 30 s)</div>`;
  try {
    const insp = await api('/api/analyze', {
      method: 'POST',
      body: { image: state.imageData, notes: $('#notes').value, board: $('#board').value },
    });
    state.inspirations.unshift(insp);
    $('#result').innerHTML = `<div class="card">${renderAnalysis(insp)}</div>`;
    bindAnalysisActions($('#result'), insp);
    renderBoard();
    renderWishInspOptions();
    resetUpload();
  } catch (err) {
    $('#result').innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = !state.imageData;
  }
});

function resetUpload() {
  state.imageData = null;
  $('#preview').hidden = true;
  $('#dropHint').hidden = false;
  $('#notes').value = '';
  $('#fileInput').value = '';
  $('#analyzeBtn').disabled = true;
}

function providerLabel() {
  return { 'claude-cli': 'Claude (ton compte)', luna: 'Luna', mock: 'le mode test' }[state.provider] || state.provider;
}

function renderAnalysis(insp) {
  const a = insp.analysis || {};
  const dots = (n) => '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n));
  return `
    <div class="analysis">
      <img src="${esc(insp.image)}" alt="">
      <div>
        <h2>${esc(a.piece)}</h2>
        <p class="hint">${esc(a.categorie)} · tableau « ${esc(insp.board)} »</p>
        <p>${esc(a.description)}</p>
        <div class="tags">${[...(a.style || []), ...(a.matieres || [])].map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div>${(a.couleurs || []).map((c) => `<span class="swatch"><i style="background:${/^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : 'transparent'}"></i>${esc(c.nom)}</span>`).join('')}</div>
        <h3 style="margin-top:16px">Pièces proposées sur Vinted</h3>
        <ul class="searches">
          ${(insp.recherches || []).map((r) => `
            <li class="search">
              <div>
                <strong>${esc(r.requete)}</strong>
                <small>${esc(r.pourquoi)}</small>
                <div class="dots" title="Proximité avec ton inspi : ${r.proximite}/5">${dots(r.proximite)}</div>
              </div>
              <a class="go" href="${esc(r.url)}" target="_blank" rel="noopener">Voir sur Vinted ↗</a>
            </li>`).join('')}
        </ul>
        <div class="dlg-actions">
          <button class="ghost" data-act="wish">J’ai trouvé une pièce → wishlist</button>
        </div>
      </div>
    </div>`;
}

function bindAnalysisActions(root, insp) {
  root.querySelector('[data-act="wish"]')?.addEventListener('click', () => {
    $('#detailDlg').close();
    showTab('wish');
    $('#wishInsp').value = insp.id;
    $('#wishForm [name=url]').focus();
  });
}

/* ---------- Mood board ---------- */
function boards() {
  return [...new Set(state.inspirations.map((i) => i.board))];
}

function renderBoard() {
  const list = boards();
  if (state.boardFilter !== 'Tous' && !list.includes(state.boardFilter)) state.boardFilter = 'Tous';
  $('#boardList').innerHTML = list.map((b) => `<option value="${esc(b)}">`).join('');
  $('#boardFilter').innerHTML = ['Tous', ...list]
    .map((b) => `<button aria-pressed="${b === state.boardFilter}" data-b="${esc(b)}">${esc(b)}</button>`)
    .join('');
  const items = state.inspirations.filter((i) => state.boardFilter === 'Tous' || i.board === state.boardFilter);
  $('#boardEmpty').hidden = items.length > 0;
  $('#boardGrid').innerHTML = items
    .map((i) => `<button class="pin" data-id="${i.id}"><img src="${esc(i.image)}" alt="" loading="lazy"><div><strong>${esc(i.analysis?.piece)}</strong><br><small>${esc(i.board)}</small></div></button>`)
    .join('');
}

$('#boardFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.boardFilter = b.dataset.b;
  renderBoard();
});

$('#boardGrid').addEventListener('click', (e) => {
  const pin = e.target.closest('.pin');
  if (pin) openDetail(pin.dataset.id);
});

function openDetail(id) {
  const insp = state.inspirations.find((i) => i.id === id);
  if (!insp) return;
  const body = $('#detailBody');
  body.innerHTML = `${renderAnalysis(insp)}
    <div class="dlg-actions">
      <span>
        <button class="ghost" data-act="move">Changer de tableau</button>
        <button class="link" data-act="del">Supprimer</button>
      </span>
      <button class="primary" data-act="close">Fermer</button>
    </div>`;
  bindAnalysisActions(body, insp);
  body.querySelector('[data-act="close"]').onclick = () => $('#detailDlg').close();
  body.querySelector('[data-act="move"]').onclick = async () => {
    const name = prompt('Nom du tableau', insp.board);
    if (name == null) return;
    Object.assign(insp, await api(`/api/inspirations/${id}`, { method: 'PATCH', body: { board: name } }));
    renderBoard();
    openDetail(id);
  };
  body.querySelector('[data-act="del"]').onclick = async () => {
    if (!confirm('Supprimer cette inspiration ?')) return;
    await api(`/api/inspirations/${id}`, { method: 'DELETE' });
    state.inspirations = state.inspirations.filter((i) => i.id !== id);
    $('#detailDlg').close();
    renderBoard();
    renderWishInspOptions();
    toast('Inspiration supprimée');
  };
  if (!$('#detailDlg').open) $('#detailDlg').showModal();
}

/* ---------- Wishlist ---------- */
function renderWishInspOptions() {
  const sel = $('#wishInsp');
  const cur = sel.value;
  sel.innerHTML = `<option value="">— aucune —</option>` + state.inspirations.map((i) => `<option value="${i.id}">${esc(i.analysis?.piece)} (${esc(i.board)})</option>`).join('');
  sel.value = cur;
}

function renderWish() {
  const active = state.wishlist.filter((w) => w.status === 'repérée');
  const bought = state.wishlist.filter((w) => w.status === 'achetée');
  const sum = (arr) => arr.reduce((s, w) => s + (w.price || 0), 0);
  $('#wishSummary').textContent = state.wishlist.length
    ? `${active.length} repérée(s) · ${sum(active).toFixed(2)} €  —  ${bought.length} achetée(s) · ${sum(bought).toFixed(2)} €`
    : 'Aucune trouvaille pour l’instant.';
  $('#wishList').innerHTML = state.wishlist
    .map((w) => {
      const insp = state.inspirations.find((i) => i.id === w.inspirationId);
      return `<li class="wish ${esc(w.status)}">
        ${insp ? `<img src="${esc(insp.image)}" alt="" title="Inspi : ${esc(insp.analysis?.piece)}">` : '<span class="ph"></span>'}
        <div>
          <a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>
          <div class="meta">${w.price != null ? `${w.price.toFixed(2)} €` : 'prix ?'}${w.size ? ` · ${esc(w.size)}` : ''}${insp ? ` · inspi « ${esc(insp.analysis?.piece)} »` : ''}</div>
        </div>
        <div>
          <select data-id="${w.id}" aria-label="Statut">
            ${['repérée', 'achetée', 'abandonnée'].map((s) => `<option ${s === w.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="link" data-del="${w.id}" aria-label="Supprimer">✕</button>
        </div>
      </li>`;
    })
    .join('');
}

$('#wishForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    state.wishlist.unshift(await api('/api/wishlist', { method: 'POST', body }));
    e.target.reset();
    renderWish();
    toast('Ajoutée à la wishlist');
  } catch (err) {
    toast(err.message);
  }
});

$('#wishList').addEventListener('change', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  const updated = await api(`/api/wishlist/${id}`, { method: 'PATCH', body: { status: e.target.value } });
  Object.assign(state.wishlist.find((w) => w.id === id), updated);
  renderWish();
});

$('#wishList').addEventListener('click', async (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  await api(`/api/wishlist/${id}`, { method: 'DELETE' });
  state.wishlist = state.wishlist.filter((w) => w.id !== id);
  renderWish();
});

/* ---------- Réglages ---------- */
$('#settingsBtn').addEventListener('click', () => {
  const f = $('#settingsForm');
  f.size.value = state.settings.size || '';
  f.budget.value = state.settings.budget || '';
  $('#settingsDlg').showModal();
});
$('#settingsDlg').addEventListener('close', async () => {
  if ($('#settingsDlg').returnValue !== 'ok') return;
  const f = $('#settingsForm');
  state.settings = await api('/api/settings', { method: 'PUT', body: { size: f.size.value, budget: f.budget.value } });
  state.inspirations = await api('/api/inspirations'); // liens Vinted recalculés avec le budget
  renderBoard();
  updateProviderHint();
  toast('Réglages enregistrés');
});

function updateProviderHint() {
  const s = state.settings;
  $('#providerHint').textContent = `Analyse : ${providerLabel()}${s.budget ? ` · budget ${s.budget} €` : ''}${s.size ? ` · taille ${s.size}` : ''}`;
}

/* ---------- Démarrage ---------- */
(async function init() {
  try {
    const [status, insps, wish] = await Promise.all([api('/api/status'), api('/api/inspirations'), api('/api/wishlist')]);
    state.provider = status.provider;
    state.settings = status.settings;
    state.inspirations = insps;
    state.wishlist = wish;
  } catch (err) {
    toast(`Serveur injoignable : ${err.message}`);
  }
  updateProviderHint();
  renderBoard();
  renderWishInspOptions();
  renderWish();
  let tab = 'find';
  try { tab = localStorage.getItem('tab') || 'find'; } catch {}
  showTab(tab);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
