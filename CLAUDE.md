# Groundwork

A browser digging game, hosted on GitHub Pages from `main` (root): https://mightywickedsounds-gif.github.io/groundwork/. This is a standalone project. The repo is public: never mention or link the owner's other projects, and keep personal details out of files and commit messages.

- `index.html`: page, HUD, menus, touch controls. Has a CSP meta; add any new host there.
- `game.js`: the whole game, an ES module. three.js 0.160 from jsDelivr via the import map. No build step.
  - World v2 (round 4): 256x256 m, `RIVERS` (control points with bed levels, `riverAt` also beyond the map), `SPRINGS`, marsh berm, `GRAVEL`/`YARD`/`CAMP`/`MARSH`, `GOALS` (cross/haul/dam/camp/marsh) + side jobs, `SPEC[].ford` (machines refuse water deeper than this), minimap. Save key `groundwork.save.v3` (older ones left untouched). River profile is `carve()` (valley 3x bank wide, floodplain = water level + .6, channel 1.7x half-width); used by generation and the outer land (`farH`). Glass and other see-through materials must not write depth. Sparse sim: `waterActive` 16 m tiles (`scanWater`), `tileLoose` for `relax`; always call `dirty(k)` after changing `H`.
  - Drawing: terrain in 32 m chunks (`tchunks`, `updateTerrainChunks`), detail 2 (0.5 m, Catmull-Rom `hSmooth` + soil `lump`) near the camera, skirts hide seams; water per chunk; card trees (`spruceGeo`/`leafyGeo`, foliage atlas in textures.js); sounds are generated samples (`engineSample`, `pourSample`, `streamSample` in audio.js).
  - Height grid `H` (1 m cells) with `BED` dig floor and `M` material (0 grass, 1 dirt, 2 gravel, `D` disturbed).
  - Dirt sliding: `relax` (talus .92 dry, .62 wet).
  - Water: virtual-pipes `waterStep`, spring on the west edge (`SPRING_Q`), drain on the east edge.
  - Machines: `SPEC`/`BUILD`/`TOOL` for dozer, loader, excavator, hauler. Loads are `{v, g}` (volume, gravel volume).
  - Jobs: `JOB` (level / pond / stock).
  - Saving: localStorage `groundwork.save.v3`, every 5 s and on pagehide. Never reset or wipe a save except through the confirmed "New world" in Menu → Worlds, which first keeps the current valley as "Autosave" in IndexedDB (`groundwork` db, `worlds` store, `saveData()` JSON).
  - `window.GW.step(n, input)` runs the game without drawing; tests use it.
- `models.js`: machine builders (`buildDozer/Loader/Excavator/Hauler` keep the tool positions the gameplay uses: blade edge z 2.75, loader arm pivot and bucket tip, excavator boom 4.6 + stick 3.3, hauler bed hinge (0,1.62,-4.3)), `buildTrack` (instanced shoes), `Ram` (hydraulic rams), `machineMats` (per-machine grime shader, `U.uGround/uGrime`), trees/rocks/grass geometry.
- `crew.js`: the crew (Menu → Crew, `groundwork.crew`). `makeCrew(G)` gets what it needs from game.js; each worker returns the same control object the player makes (`m.ai`), and `update()` in game.js drives every machine with `m.ctl` (player input, `m.ai` or `ZERO`). With no job the crew follows the player (`convoy`, slots behind the player; `travel` uses A* `findPath` on a 2 m grid that avoids water deeper than each machine's ford and steep grades). Stopping at deep water makes a site with `siteAt` (aimed at the water's centroid, narrowest clear line). Sites are lines across the water (`s` along, `o` across); dozer/excavator/hauler roles with a lock so only one uses the line. `follow` = drive along the site line; `convoy` = follow the player (keep the names distinct). The player's machine has no AI; toasts from machines go through `say(m, msg)` (player's machine only).
- Dirt: `H0` is the ground before digging (rebuilt from the seed on load); `SWELL` bulks never-dug soil; `dropCircle` tips a cone; the terrain shader gets `aDig` (H0, spoil depth) for soil layers. Erosion in `waterStep` only touches cells where `|H - H0| > .05` and not gravel.
- Trees: fallen trees stay (`st` 2, saved in `logs`), `pushLogs` shoves them; `treeFade` dithers trees in the line of sight (`aFade`, own materials, not the far forest's).
- `textures.js`: procedural textures (`makeTextures(quality)`), swapped for photos from `assets/` when they load (grass, dirt, gravel, bark, rock, `ground_h.png` = the three height maps in R/G/B; all CC0 from Poly Haven). `assets/sky.hdr` (Poly Haven, CC0) lights and reflects in the machines (`scene.environment`). Keep assets phone-sized (1k or less).; `audio.js`: `Sound` (per-machine voices via `machine(id,cfg)`/`updateMachine`, one-shots, ambient). Sound values are guarded against NaN; keep that.
- Graphics quality `groundwork.quality` (high/medium/low, `QS` in game.js). Tree count is capped by truncating the generation list (keeps old saves' `gone` indices valid); never add random draws to world generation, it would move trees/rocks in existing saves.
- `tests/play.cjs`: Playwright gameplay checks (`node tests/play.cjs [outdir]`). Run them after any gameplay change. If jsDelivr is unreachable, `npm install three@0.160.0` somewhere and set `THREE_DIR` to its `node_modules/three`.

It's an original game in the construction-sandbox genre: don't copy any existing game's name, art, levels or look.

Screen style (owner): keep the HUD minimal like a real game: no text panels or paragraphs, short uppercase prompts, controls only on the controls screen, no emoji.

The owner isn't a programmer: explain changes in plain English, report test results honestly, and log each round in README.md under History.
