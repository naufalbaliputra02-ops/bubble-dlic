// Global leaderboard for bubble-dlic.
// Vercel Serverless Function — POST to submit, GET to fetch.
// In-memory store per-instance (hobby plan: no DB). Leaderboard is
// eventually-consistent across instances; good enough for an arcade game.

let STORE = [];
let LAST_TRIM = 0;

const MAX_ENTRIES = 50;
const WINDOW_MS = 1000 * 60 * 60 * 24 * 30; // keep last ~30 days

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function trim(now) {
  if (now - LAST_TRIM < 1000 * 60 * 10) return; // trim every 10 min
  LAST_TRIM = now;
  const cutoff = now - WINDOW_MS;
  STORE = STORE.filter(e => e.t > cutoff).sort((a, b) => b.s - a.s).slice(0, MAX_ENTRIES);
}

export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    const now = Date.now();
    trim(now);
    return res.status(200).json({ ok: true, t: now, scores: STORE.slice(0, MAX_ENTRIES) });
  }
  if (req.method === 'POST') {
    const { name, score } = req.body || {};
    const s = Math.round(Number(score));
    const raw = typeof name === 'string' ? name.trim().slice(0, 14) : 'Anonymous';
    if (!Number.isFinite(s) || s < 0 || s > 999999) {
      return res.status(400).json({ ok: false, error: 'invalid score' });
    }
    const entry = { n: raw.replace(/[^\w .-]/g, '').slice(0, 14) || 'Anonymous', s, t: Date.now() };
    STORE.push(entry);
    const now = Date.now();
    trim(now);
    STORE.sort((a, b) => b.s - a.s);
    STORE = STORE.slice(0, MAX_ENTRIES);
    const rank = STORE.findIndex(e => e === entry);
    return res.status(200).json({ ok: true, rank: rank === -1 ? null : rank + 1, total: STORE.length });
  }
  return res.status(405).json({ ok: false, error: 'method not allowed' });
}
