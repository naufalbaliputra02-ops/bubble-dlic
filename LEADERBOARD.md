# Drift Drop — Leaderboard Integration Report

**Repo:** `naufalbaliputra02-ops/bubble-dlic`
**Live:** https://bubble-dlic-rouge.vercel.app
**Branch:** `main`
**Commits:** `7a31ce7` (leaderboard), `f32e3f0` (live submit)

---

## Overview

Added a global online leaderboard to a static browser merge game ("Drift Drop").
The game has no build step and no backend of its own — the leaderboard is a
single Vercel serverless function plus a vanilla-JS client script.

**Constraint:** the game's original `game.js` is an IIFE with no exports and no
module system. Integration is done via two globally-exposed hooks so the game
loop and renderer are untouched.

```
game.js          (unchanged gameplay) --exposes--> window.__driftScore()
leaderboard.js   (client) -----------------------> window.__driftLeaderboard.submit()
api/leaderboard.js (serverless) <------------------ POST /api/leaderboard
```

---

## Files changed

| File | Change | LOC |
|---|---|---|
| `api/leaderboard.js` | **NEW** — serverless endpoint (GET/POST) | ~70 |
| `leaderboard.js` | **NEW** — client: fetch, submit, render, polling | ~150 |
| `index.html` | +1 script tag, +5 lines panel markup | +6 |
| `styles.css` | `.leaderboard*`, `.lb-*`, `.lb-submit` rules | +13 |
| `game.js` | +2 lines (game-over hook + score getter) | +2 |

`game.js` internals — physics, renderer, input, sprite loader — not modified.

---

## Architecture

### Server: `api/leaderboard.js`

Vercel Edge/Node function, default export.

- **Store:** in-memory array, module-scoped.
- **Retention:** top 50 by score; entries older than 30 days trimmed every 10 min.
- **Validation:** score must be finite, `0 <= s <= 999999`; name sanitized to
  `[\w .-]`, truncated to 14 chars, defaults to `Anonymous`.
- **CORS:** `Access-Control-Allow-Origin: *` (game may be embedded anywhere).
- **Response (POST):** `{ ok, rank, total }` — `rank` is 1-based, `null` if the
  entry fell out of the top 50.
- **Response (GET):** `{ ok, t, scores: [{ n, s, t }] }`.

### Client: `leaderboard.js`

- Exposes `window.__driftScore = () => score` — reads the game's live score.
- On game over, `game.js` calls `window.__driftLeaderboard.submit(score)`.
- Manual submit button (`#submitScore`) posts the current live score mid-game.
- Polls `GET /api/leaderboard` every 45 s.
- Player name persisted in `localStorage['drift-drop-player']`; prompted once.
- All network failures are swallowed — a broken leaderboard never blocks the game.

---

## Game integration points

**1. Score getter** (appended to `game.js`, after the debug hook):

```js
window.__driftScore = () => score;
```

`score` is a closure variable inside the game's IIFE. This is the only read path.

**2. Game-over hook** (inside the danger/overflow check):

```js
if (window.__driftLeaderboard && score > 0) window.__driftLeaderboard.submit(score);
```

Guarded so the game works even if `leaderboard.js` fails to load.

**3. Submit button** — bound in `leaderboard.js`, label refreshed every 1 s:

```js
btn.innerHTML = `SUBMIT ${formatScore(live)} <span aria-hidden="true">↗</span>`;
```

After a successful submit the button is disabled and restyled (`.lb-submitted`)
to prevent duplicate submissions within one session.

---

## Verification

Headless Chromium (Playwright), viewport 1440×900:

| Check | Result |
|---|---|
| Page load, `pageerror` + console errors | **0 errors** |
| Canvas `#game` present and rendering | **pass** |
| `GET /api/leaderboard` on cold deploy | `{ ok, scores: [] }` |
| `POST` valid score | `{ ok, rank: 1, total: 1 }` |
| `GET` after POST | entry present, correctly sorted |
| Button label at score 0 | `SUBMIT 0000 ↗` |
| Click at score 0 | rejected, note: *"Score some points first, then submit."* |
| Label tracks live score | `SUBMIT 2500 ↗` within 1 s |
| Click with score > 0 → name prompt → submit | **pass**, board renders, button disabled |

Curl round-trip also confirmed server-side ordering and trim behavior.

---

## Known limitations

1. **Storage is in-memory.** A cold start / re-deploy wipes the board. Not
   suitable as the permanent record.
2. **No auth.** Anyone can `POST` arbitrary scores up to 999999. There is no
   proof-of-play. Scores are trusted on an honor basis.
3. **Rate limiting: none.** The endpoint is open. A malicious client could fill
   the 50-slot board in seconds.
4. **Instance-local state.** Vercel may run multiple function instances; boards
   are eventually consistent, not globally identical at any instant.
5. **Name collisions** are not disambiguated — two players with the same name
   appear as separate rows.

---

## Suggested next steps

In rough order of impact:

1. **Move storage to Vercel KV or Supabase** — kills limitations 1 and 4.
   Free tier covers this game's volume easily.
2. **Add a play token** — server issues a signed token at game start, score
   submission requires it. Raises the cost of injection.
3. **Rate limit by IP** (Vercel's built-in or an edge middleware) — kills 3.
4. **Per-player best-score dedup** — store best score per name, show `Δ` vs
   previous best on submit.

---

## Deployment

Static front-end + one function. No build step, no framework.

```
vercel --prod --yes --token <VERCEL_TOKEN>
```

`vercel.json` is unchanged from the repo's existing config; the `/api` directory
is picked up automatically. First deploy created project `bubble-dlic` under the
`babiiihs-projects` Vercel team; production alias `bubble-dlic-rouge.vercel.app`.

GitHub Pages deployment (`.nojekyll`, `main` branch) is unaffected — the static
files still work standalone, leaderboard degrades gracefully to a static note
when `/api/leaderboard` is unavailable.
