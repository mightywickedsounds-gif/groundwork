# Groundwork

A browser digging game, hosted on GitHub Pages from `main` (root): https://mightywickedsounds-gif.github.io/groundwork/. This is a standalone project. The repo is public: never mention or link the owner's other projects, and keep personal details out of files and commit messages.

- `index.html`: page, HUD, menus, touch controls. Has a CSP meta; add any new host there.
- `game.js`: the whole game, an ES module. three.js 0.160 from jsDelivr via the import map. No build step.
  - Height grid `H` (160x160 m, 1 m cells) with `BED` dig floor and `M` material (0 grass, 1 dirt, 2 gravel, `D` disturbed).
  - Dirt sliding: `relax` (talus .92 dry, .62 wet).
  - Water: virtual-pipes `waterStep`, spring on the west edge (`SPRING_Q`), drain on the east edge.
  - Machines: `SPEC`/`BUILD`/`TOOL` for dozer, loader, excavator, hauler. Loads are `{v, g}` (volume, gravel volume).
  - Jobs: `JOB` (level / pond / stock).
  - Saving: localStorage `groundwork.save.v1`, every 5 s and on pagehide. Never reset or wipe a save except through the menu's confirmed "Start a new valley".
  - `window.GW.step(n, input)` runs the game without drawing; tests use it.
- `models.js`: machine builders (`buildDozer/Loader/Excavator/Hauler` keep the tool positions the gameplay uses: blade edge z 2.75, loader arm pivot and bucket tip, excavator boom 4.6 + stick 3.3, hauler bed hinge (0,1.62,-4.3)), `buildTrack` (instanced shoes), `Ram` (hydraulic rams), `machineMats` (per-machine grime shader, `U.uGround/uGrime`), trees/rocks/grass geometry.
- `textures.js`: procedural textures (`makeTextures(quality)`); `audio.js`: `Sound` (per-machine voices via `machine(id,cfg)`/`updateMachine`, one-shots, ambient). Sound values are guarded against NaN; keep that.
- Graphics quality `groundwork.quality` (high/medium/low, `QS` in game.js). Tree count is capped by truncating the generation list (keeps old saves' `gone` indices valid); never add random draws to world generation, it would move trees/rocks in existing saves.
- `tests/play.cjs`: Playwright gameplay checks (`node tests/play.cjs [outdir]`). Run them after any gameplay change.

It's an original game in the construction-sandbox genre: don't copy any existing game's name, art, levels or look.

The owner isn't a programmer: explain changes in plain English, report test results honestly, and log each round in README.md under History.
