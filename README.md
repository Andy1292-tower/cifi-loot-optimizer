# CIFI Tools — Loot Score Optimizer

A Chrome extension that adds a **🎯 Optimize** button to [cifi-tools.com](https://cifi-tools.com)
(the Hunter Simulator build tool). For a chosen build it redistributes the build's
existing **talent** and **attribute** points to maximise **Loot Score**, scoring
candidates with the site's own simulation engine — so the numbers match the in-app
Loot Score exactly.

## What it does

- **Legal redistribution only.** Conserves each build's current talent-point total
  (1 pt/talent) and attribute-point total (per-rank costs), respecting every
  per-hunter cap, the attribute prerequisite tree, and level gates (e.g. Ultima
  unlocks at level 70). It can only ever match or beat your current build.
- **Never recommends a worse build.** The search optimises a fast estimate, then
  re-checks the winner at full resolution; if it doesn't actually beat your current
  build, it keeps the current one.
- **All three hunters** — Borge, Ozzy, Knox.
- **Outputs** an importable build code (pastes into the site's *Import*), or saves
  the result directly as a new build.
- Runs entirely in the page; uses a pool of the site's evaluation workers.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select the [`cifi-optimizer-extension/`](cifi-optimizer-extension) folder
4. Open (or reload) **cifi-tools.com** — the 🎯 button appears bottom-right

To update after pulling changes: `chrome://extensions` → click the ↻ reload on the
card, then reload the site. The extension's version is printed to the console on load
(`[CIFI Optimizer vX.Y.Z] …`) so you can confirm which build is running.

## Usage

Click **🎯 Optimize** → pick a hunter and build → **Optimize**. Review the before/after
talent & attribute tables, then **Save as new build** or **Copy build code**.

- **Search iters / Final iters** control simulation resolution. Set them equal (and
  high) to evaluate every candidate at full resolution.
- **Max time (s)** — set to **0** for unlimited (runs until it converges).

## Development

Test against **cifi-tools.com** directly — it receives updates (new talents, cap
changes, build-code/param changes), so always verify there.

1. Edit `cifi-optimizer-extension/optimizer.js` (bump the version in its startup
   log line **and** `manifest.json`).
2. `chrome://extensions` → click **↻ reload** on the extension card.
3. Reload **cifi-tools.com** and test there. The console prints the loaded version
   (`[CIFI Optimizer vX.Y.Z] …`) so you can confirm the reload took.
4. `git add -A && git commit -m "…" && git push`

**Keeping game data current:** the talent/attribute caps, per-rank costs, attribute
prerequisite trees, level gates (e.g. Ultima ≥ lvl 70), and build-code parameter
order must match the game exactly. When the site ships an update, re-verify those
tables against the current live site.

## Files

- `cifi-optimizer-extension/manifest.json` — MV3 manifest (MAIN-world content script)
- `cifi-optimizer-extension/optimizer.js` — the optimizer

## Notes

Private/personal tooling. Not affiliated with cifi-tools.com.
