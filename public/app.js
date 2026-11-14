import { bookmarkletCode } from './vinted.js';

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
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

const remember = (id) => { try { localStorage.setItem('lastInsp', id); } catch {} };
const replaceInsp = (insp) => {
  const i = state.inspirations.findIndex((x) => x.id === insp.id);
  if (i >= 0) state.inspirations[i] = insp;
  else state.inspirations.unshift(insp);
  return insp;
};

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

/* ---------- Analyse d'une nouvelle image ---------- */
const loadingHtml = (what) => `<div class="card loading"><span class="spinner"></span>${what} avec ${esc(providerLabel())}… (10 à 30 s)</div>`;

$('#findForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.imageData) return;
  const btn = $('#analyzeBtn');
  btn.disabled = true;
  $('#result').innerHTML = loadingHtml('Analyse en cours');
  try {
    const insp = replaceInsp(await api('/api/analyze', {
      method: 'POST',
      body: { image: state.imageData, notes: $('#notes').value, board: $('#board').value },
    }));
    showResult(insp);
    renderBoard();
    renderWishInspOptions();
    resetUpload();
  } catch (err) {
    $('#result').innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = !state.imageData;
  }
});

function showResult(insp) {
  remember(insp.id);
  $('#result').innerHTML = `<div class="card">${renderAnalysis(insp)}</div>`;
  bindAnalysisActions($('#result'), insp, showResult);
}

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

/* ---------- Vue d'une inspiration (résultat + détail) ---------- */
function renderAnalysis(insp) {
  const a = insp.analysis;
  const dots = (n) => '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n));
  const head = a
    ? `<h2>${esc(a.piece)}</h2>
       <p class="hint">${esc(a.categorie)} · tableau « ${esc(insp.board)} »</p>
       <p>${esc(a.description)}</p>
       <div class="tags">${[...(a.style || []), ...(a.matieres || [])].map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
       <div>${(a.couleurs || []).map((c) => `<span class="swatch"><i style="background:${/^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : 'transparent'}"></i>${esc(c.nom)}</span>`).join('')}</div>`
    : `<h2>${esc(insp.pinTitle || 'Inspi à analyser')}</h2>
       <p class="hint">tableau « ${esc(insp.board)} »${insp.pinUrl ? ` · <a href="${esc(insp.pinUrl)}" target="_blank" rel="noopener">voir l’épingle</a>` : ''}</p>
       <p>Cette inspi n’est pas encore analysée.</p>
       <button class="primary" data-act="analyze">Analyser et trouver des pièces</button>`;

  const searches = a
    ? `<h3 class="section-title">Rechercher sur Vinted</h3>
       <ul class="searches">
         ${(insp.recherches || []).map((r) => `
           <li class="search">
             <div>
               <strong>${esc(r.requete)}</strong>
               <small>${esc(r.pourquoi)}</small>
               <div class="dots" title="Proximité avec ton inspi : ${r.proximite}/5">${dots(r.proximite)}</div>
             </div>
             <a class="go" href="${esc(r.url)}" target="_blank" rel="noopener" data-act="open-search">Voir sur Vinted ↗</a>
           </li>`).join('')}
       </ul>`
    : '';

  return `
    <div class="analysis">
      <img src="${esc(insp.image)}" alt="">
      <div>${head}${searches}</div>
    </div>
    ${renderFinds(insp)}`;
}

function renderFinds(insp) {
  const finds = insp.finds || [];
  const help = `<p class="hint">Sur une page de résultats Vinted, clique sur ton favori
      <a class="bookmarklet small" href="#" draggable="true">💧 Envoyer à Trouvaille</a>
      (glisse-le d’abord dans ta barre de favoris) : les annonces arrivent ici en photos.</p>`;
  if (!finds.length) {
    return `<div class="finds"><h3 class="section-title">Pièces trouvées</h3>${help}</div>`;
  }
  const ranked = finds.some((f) => f.score != null);
  return `
    <div class="finds">
      <div class="finds-head">
        <h3 class="section-title">Pièces trouvées <span class="count">${finds.length}</span></h3>
        <button class="primary small-btn" data-act="rank">${ranked ? 'Reclasser' : 'Trier par ressemblance'}</button>
      </div>
      <div class="finds-grid">
        ${finds.map((f) => `
          <article class="find">
            ${f.score != null ? `<span class="score" title="${esc(f.raison)}">${f.score}%</span>` : ''}
            <a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>
            <div class="find-body">
              <strong>${f.price != null ? f.price.toFixed(2) + ' €' : ''}</strong>
              <span>${esc(f.title)}</span>
              <small>${[f.brand, f.size, f.condition].filter(Boolean).map(esc).join(' · ')}</small>
              ${f.raison ? `<small class="why">${esc(f.raison)}</small>` : ''}
            </div>
            <div class="find-actions">
              <button class="ghost tiny" data-wish="${esc(f.id)}" title="Ajouter à la wishlist">♡</button>
              <button class="link" data-unfind="${esc(f.id)}" title="Retirer">✕</button>
            </div>
          </article>`).join('')}
      </div>
      ${help}
    </div>`;
}

function bindAnalysisActions(root, insp, rerender) {
  setupBookmarklets(root);
  root.querySelectorAll('[data-act="open-search"]').forEach((a) => a.addEventListener('click', () => remember(insp.id)));

  root.querySelector('[data-act="analyze"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Analyse en cours… (10 à 30 s)';
    try {
      const updated = replaceInsp(await api(`/api/inspirations/${insp.id}/analyze`, { method: 'POST', body: {} }));
      renderBoard();
      renderWishInspOptions();
      rerender(updated);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Réessayer l’analyse';
    }
  });

  root.querySelector('[data-act="rank"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Classement… (10 à 30 s)';
    try {
      rerender(replaceInsp(await api(`/api/inspirations/${insp.id}/rank`, { method: 'POST', body: {} })));
      toast('Pièces classées de la plus ressemblante à la moins');
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Trier par ressemblance';
    }
  });

  root.querySelectorAll('[data-unfind]').forEach((b) =>
    b.addEventListener('click', async () => {
      rerender(replaceInsp(await api(`/api/inspirations/${insp.id}/finds/${b.dataset.unfind}`, { method: 'DELETE' })));
    }),
  );

  root.querySelectorAll('[data-wish]').forEach((b) =>
    b.addEventListener('click', async () => {
      const f = (insp.finds || []).find((x) => x.id === b.dataset.wish);
      if (!f) return;
      const item = await api('/api/wishlist', {
        method: 'POST',
        body: { url: f.url, title: f.title, price: f.price, size: f.size, photo: f.photo, inspirationId: insp.id },
      });
      if (!state.wishlist.some((w) => w.id === item.id)) state.wishlist.unshift(item);
      renderWish();
      b.textContent = '♥';
      toast('Ajoutée à la wishlist');
    }),
  );
}

/* ---------- Favori « Envoyer à Trouvaille » ---------- */
function setupBookmarklets(root = document) {
  const code = bookmarkletCode(location.origin);
  root.querySelectorAll('a.bookmarklet').forEach((a) => {
    a.setAttribute('href', code);
    a.onclick = (e) => {
      e.preventDefault();
      toast('Glisse ce bouton dans ta barre de favoris, puis utilise-le sur Vinted');
    };
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
    .map((i) => {
      const nFinds = (i.finds || []).length;
      const badge = !i.analysis ? '<span class="badge">à analyser</span>' : nFinds ? `<span class="badge ok">${nFinds} pièce(s)</span>` : '';
      return `<button class="pin" data-id="${i.id}">${badge}<img src="${esc(i.image)}" alt="" loading="lazy"><div><strong>${esc(i.analysis?.piece || i.pinTitle || 'Inspi')}</strong><br><small>${esc(i.board)}</small></div></button>`;
    })
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
  remember(id);
  const body = $('#detailBody');
  body.innerHTML = `${renderAnalysis(insp)}
    <div class="dlg-actions">
      <span>
        <button class="ghost" data-act="move">Changer de tableau</button>
        <button class="link" data-act="del">Supprimer</button>
      </span>
      <button class="primary" data-act="close">Fermer</button>
    </div>`;
  bindAnalysisActions(body, insp, (updated) => { renderBoard(); openDetail(updated.id); });
  body.querySelector('[data-act="close"]').onclick = () => $('#detailDlg').close();
  body.querySelector('[data-act="move"]').onclick = async () => {
    const name = prompt('Nom du tableau', insp.board);
    if (name == null) return;
    replaceInsp(await api(`/api/inspirations/${id}`, { method: 'PATCH', body: { board: name } }));
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

/* ---------- Pinterest ---------- */
$('#pinterestBtn').addEventListener('click', () => openPinterest());
$('#pinClose').addEventListener('click', () => $('#pinterestDlg').close());

async function openPinterest() {
  if (!$('#pinterestDlg').open) $('#pinterestDlg').showModal();
  const box = $('#pinAccount');
  box.innerHTML = '<p class="hint">Chargement…</p>';
  const st = await api('/api/pinterest/status').catch((e) => ({ error: e.message }));
  if (st.error) { box.innerHTML = `<p class="error">${esc(st.error)}</p>`; return; }

  if (!st.configured) {
    box.innerHTML = `
      <ol class="steps">
        <li>Va sur <a href="https://developers.pinterest.com/apps/" target="_blank" rel="noopener">developers.pinterest.com/apps</a>, connecte-toi et crée une app (usage perso).</li>
        <li>Dans les réglages de l’app, ajoute cette <strong>adresse de redirection</strong> :
          <code class="copy" title="Cliquer pour copier">${esc(st.redirectUri)}</code></li>
        <li>Copie l’<strong>App ID</strong> et la <strong>clé secrète</strong> ci-dessous. Elles restent sur ton ordinateur.</li>
      </ol>
      <form id="pinConfigForm" class="grid-form">
        <label>App ID <input name="clientId" inputmode="numeric" autocomplete="off" required></label>
        <label>Clé secrète <input name="clientSecret" type="password" autocomplete="off" required></label>
        <button class="primary">Enregistrer</button>
      </form>`;
    box.querySelector('.copy').onclick = (e) => navigator.clipboard?.writeText(e.target.textContent).then(() => toast('Adresse copiée'));
    box.querySelector('#pinConfigForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/pinterest/config', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
        openPinterest();
      } catch (err) { toast(err.message); }
    };
    return;
  }

  if (!st.connected) {
    box.innerHTML = `
      <p>Ton app Pinterest est prête (App ID ${esc(st.clientId)}).</p>
      <div class="dlg-actions">
        <a class="primary" href="/auth/pinterest" style="text-decoration:none">Se connecter à Pinterest</a>
        <button class="link" id="pinReconfig">Changer d’app</button>
      </div>`;
    box.querySelector('#pinReconfig').onclick = () => reconfigure();
    return;
  }

  box.innerHTML = `<p>Connectée${st.username ? ` en tant que <strong>${esc(st.username)}</strong>` : ''}. <button class="link" id="pinLogout">Se déconnecter</button></p>
    <p class="hint">Chargement de tes tableaux…</p>`;
  box.querySelector('#pinLogout').onclick = async () => { await api('/api/pinterest/connection', { method: 'DELETE' }); openPinterest(); };
  try {
    const boardsList = await api('/api/pinterest/boards');
    box.querySelector('.hint').outerHTML = boardsList.length
      ? `<ul class="pin-boards">${boardsList.map((b) => `
          <li>
            ${b.cover ? `<img src="${esc(b.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
            <div><strong>${esc(b.name)}</strong><small>${b.pinCount ?? '?'} épingles${b.privacy === 'SECRET' ? ' · secret' : ''}</small></div>
            <button class="primary small-btn" data-board="${esc(b.id)}" data-name="${esc(b.name)}">Importer</button>
          </li>`).join('')}</ul>`
      : '<p class="hint">Aucun tableau trouvé sur ce compte.</p>';
    box.querySelectorAll('[data-board]').forEach((b) =>
      b.addEventListener('click', () => runImport(b, '/api/pinterest/import', { boardId: b.dataset.board, boardName: b.dataset.name })),
    );
  } catch (err) {
    box.querySelector('.hint').outerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function reconfigure() {
  if (!confirm('Oublier cette app Pinterest et sa connexion ?')) return;
  await api('/api/pinterest/config', { method: 'DELETE' });
  openPinterest();
}

async function runImport(btn, url, body) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Import…';
  try {
    const r = await api(url, { method: 'POST', body });
    state.inspirations = await api('/api/inspirations');
    state.boardFilter = r.board || 'Tous';
    renderBoard();
    renderWishInspOptions();
    toast(`${r.added} épingle(s) importée(s)${r.skipped ? `, ${r.skipped} déjà là` : ''}${r.failed ? `, ${r.failed} en échec` : ''}`);
    btn.textContent = 'Importé ✓';
  } catch (err) {
    toast(err.message);
    btn.textContent = label;
    btn.disabled = false;
  }
}

$('#pinPublicForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runImport(e.submitter || $('#pinPublicForm button'), '/api/pinterest/import-public', { url: e.target.url.value });
});

/* ---------- Wishlist ---------- */
function renderWishInspOptions() {
  const sel = $('#wishInsp');
  const cur = sel.value;
  sel.innerHTML = `<option value="">— aucune —</option>` + state.inspirations.map((i) => `<option value="${i.id}">${esc(i.analysis?.piece || i.pinTitle || 'Inspi')} (${esc(i.board)})</option>`).join('');
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
      const thumb = w.photo || insp?.image;
      return `<li class="wish ${esc(w.status)}">
        ${thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
        <div>
          <a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>
          <div class="meta">${w.price != null ? `${w.price.toFixed(2)} €` : 'prix ?'}${w.size ? ` · ${esc(w.size)}` : ''}${insp ? ` · inspi « ${esc(insp.analysis?.piece || insp.pinTitle || '')} »` : ''}</div>
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
    const item = await api('/api/wishlist', { method: 'POST', body });
    if (!state.wishlist.some((w) => w.id === item.id)) state.wishlist.unshift(item);
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
  setupBookmarklets($('#settingsDlg'));
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
  setupBookmarklets();
  let tab = 'find';
  try { tab = localStorage.getItem('tab') || 'find'; } catch {}

  // Retours d'autres pages : import Vinted (?insp=), connexion Pinterest (?pinterest=)
  const q = new URLSearchParams(location.search);
  if (q.size) history.replaceState(null, '', '/');
  if (q.get('insp')) {
    tab = 'board';
    showTab(tab);
    openDetail(q.get('insp'));
    if (q.get('added') != null) toast(`${q.get('added')} pièce(s) ajoutée(s)`);
  } else if (q.get('pinterest')) {
    tab = 'board';
    showTab(tab);
    openPinterest();
    toast({ ok: 'Pinterest connecté ✓', erreur: 'La connexion Pinterest a échoué', config: 'Configure d’abord ton app Pinterest' }[q.get('pinterest')] || '');
  }
  showTab(tab);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
