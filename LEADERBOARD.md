# Drift Drop — Leaderboard

**Repo:** `naufalbaliputra02-ops/bubble-dlic`
**Live:** https://bubble-dlic-rouge.vercel.app
**Commits:** `7a31ce7` → `ddf7917`

## Apa yang ditambah

Leaderboard global online. Game-nya static, jadi tambah 1 serverless function + 1 client script.

```
game.js  --window.__driftScore()-->  leaderboard.js  --POST-->  api/leaderboard.js
```

`game.js` disentuh cuma 2 baris (1 score getter, 1 game-over hook). Fisika, renderer, input: gak diubah.

## Fitur

- **Leaderboard global** — top 50, badge top-3, highlight pemain sendiri, update tiap 45s
- **Submit mid-game** — tombol `SUBMIT`, label skor real-time, anti-spam (1x per sesi)
- **Auto-submit game over** — notifikasi kalau masuk top-10
- **Degradasi graceful** — API mati → game tetap jalan, leaderboard cuma nunjukin note

## Files

| File | Status |
|---|---|
| `api/leaderboard.js` | NEW — serverless, in-memory, top 50, trim 30 hari |
| `leaderboard.js` | NEW — client: fetch/submit/render/poll |
| `index.html` | +6 baris (panel + script tag) |
| `styles.css` | +13 baris (`.lb-*`) |
| `game.js` | +2 baris |

## Verifikasi

Headless Chromium, 0 error. Semua pass: load, render, submit@0 ditolak, label track skor real-time, submit masuk board, tombol ke-lock.

## Limitations

1. **In-memory** — cold start reset board. Perlu KV/Supabase buat permanen.
2. **No auth** — siapa aja bisa POST skor manual.
3. **No rate limit** — endpoint terbuka.

## Next step

Pindah storage ke Vercel KV atau Supabase (gratis) → solve limitation 1. Tambah play-token → solve 2.
