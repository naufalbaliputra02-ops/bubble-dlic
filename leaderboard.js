// Global leaderboard client for bubble-dlic.
// Submits scores on game over, renders top entries in the side panel.

const LB_API = '/api/leaderboard';
const LB_KEY = 'drift-drop-player';

function playerName() {
  try { return localStorage.getItem(LB_KEY) || ''; } catch { return ''; }
}
function setPlayerName(name) {
  try { localStorage.setItem(LB_KEY, name); } catch { /* storage unavailable */ }
}

function formatScore(n) {
  return String(Math.round(n)).padStart(4, '0');
}

function timeAgo(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

async function fetchLeaderboard() {
  const res = await fetch(LB_API, { method: 'GET' });
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}

async function submitScore(name, score) {
  const res = await fetch(LB_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score }),
  });
  if (!res.ok) throw new Error('submit failed');
  return res.json();
}

function renderList(scores) {
  const list = document.getElementById('leaderboardList');
  const note = document.getElementById('leaderboardNote');
  if (!list) return;
  if (!scores.length) {
    list.innerHTML = '';
    if (note) note.textContent = 'No scores yet — be the first to make a splash.';
    return;
  }
  list.innerHTML = scores.slice(0, 10).map((e, i) => {
    const mine = e.n === playerName() && e.s === (window.__lastSubmitted || -1);
    const cls = i < 3 ? 'lb-row top-' + (i + 1) : 'lb-row';
    return `<li class="${cls}${mine ? ' mine' : ''}"><span class="lb-rank">${i + 1}</span><span class="lb-name">${escapeHtml(e.n)}</span><span class="lb-score">${formatScore(e.s)}</span><span class="lb-time">${timeAgo(e.t)}</span></li>`;
  }).join('');
  if (note) note.textContent = `Top ${Math.min(10, scores.length)} of ${scores.length} global runs`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function promptName() {
  let name = playerName();
  if (name) return name;
  const ask = window.prompt('Leaderboard name (max 14 chars):', '');
  if (ask === null) return null;
  name = ask.trim().slice(0, 14);
  if (!name) name = 'Anonymous';
  setPlayerName(name);
  return name;
}

async function refreshLeaderboard() {
  try {
    const data = await fetchLeaderboard();
    renderList(data.scores || []);
  } catch {
    const note = document.getElementById('leaderboardNote');
    if (note) note.textContent = 'Leaderboard unavailable right now.';
  }
}

async function handleGameOver(score) {
  const name = promptName();
  if (!name) { refreshLeaderboard(); return; }
  try {
    const res = await submitScore(name, score);
    window.__lastSubmitted = score;
    markSubmitted();
    if (res.rank != null && res.rank <= 10) {
      const note = document.getElementById('leaderboardNote');
      if (note) note.textContent = `You ranked #${res.rank} globally! 🎉`;
    }
  } catch { /* silently ignore — game stays playable */ }
  refreshLeaderboard();
}

function markSubmitted() {
  const btn = document.getElementById('submitScore');
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('lb-submitted');
  const live = window.__driftScore ? window.__driftScore() : null;
  btn.innerHTML = `SUBMITTED${live != null ? ' · ' + formatScore(live) : ''} <span aria-hidden="true">✓</span>`;
}

function updateSubmitLabel() {
  const btn = document.getElementById('submitScore');
  if (!btn || btn.disabled || btn.classList.contains('lb-submitted')) return;
  const live = window.__driftScore ? window.__driftScore() : null;
  if (live == null) return;
  btn.innerHTML = `SUBMIT ${formatScore(live)} <span aria-hidden="true">↗</span>`;
}

function wireSubmitButton() {
  const btn = document.getElementById('submitScore');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const live = window.__driftScore ? window.__driftScore() : null;
    if (live == null || live <= 0) {
      const note = document.getElementById('leaderboardNote');
      if (note) note.textContent = 'Score some points first, then submit.';
      return;
    }
    const name = promptName();
    if (!name) return;
    btn.disabled = true;
    btn.textContent = 'SUBMITTING…';
    try {
      await submitScore(name, live);
      window.__lastSubmitted = live;
      markSubmitted();
      const note = document.getElementById('leaderboardNote');
      if (note) note.textContent = `Submitted ${formatScore(live)} as ${name} ✓`;
    } catch {
      btn.disabled = false;
      btn.textContent = 'RETRY SUBMIT ↗';
      const note = document.getElementById('leaderboardNote');
      if (note) note.textContent = 'Submit failed — try again.';
      return;
    }
    refreshLeaderboard();
  });
  // keep the button label in sync with the live score while playing
  setInterval(updateSubmitLabel, 1000);
}

// init
refreshLeaderboard();
wireSubmitButton();
// poll every 45s so the board feels live while playing
setInterval(refreshLeaderboard, 45000);
window.__driftLeaderboard = { refresh: refreshLeaderboard, submit: handleGameOver };
