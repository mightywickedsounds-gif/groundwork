# Groundwork

A digging game you play in the browser. Drive a dozer, loader, excavator and dump truck around an open forested valley cut by a river and creeks: build crossings, dam creeks, drain a marsh, haul gravel and reshape the ground. **Nothing ever resets:** every hole, pile and channel stays where you left it, even after you close the page.

Play it here (once GitHub Pages is on, see below): https://mightywickedsounds-gif.github.io/groundwork/

## How it plays

- **The ground is real.** The valley is a 160 x 160 m grid of heights. Whatever you dig or pile stays. Dirt piled steeper than it can stand slides down; wet riverbanks slump sooner.
- **Water flows.** A river comes in on the west side and leaves on the east. It runs downhill over whatever you shape: cut a channel and it follows; dam it and a lake fills up behind the dam.
- **Four machines:**
  - **Dozer:** the blade cuts high ground and drops it in low spots. Back up to leave the pile behind.
  - **Loader:** lower the bucket and drive into dirt to fill it, raise it over the truck and dump.
  - **Excavator:** swing, reach, dig, dump (into the truck if it's under the bucket).
  - **Hauler:** carries 12 m³ and tips its bed to dump behind it.
  - Machines knock trees over.
- **Jobs that pay:**
  - **Level the pad:** make the marked area flat at the see-through plane.
  - **Dig the pond:** dig down to the plane.
  - **Stockpile gravel:** bring gravel from the grey gravel pit.
  - Finish one and a new one opens somewhere else.
- **Looks and sounds real:** textured ground (grass, dirt, gravel; darker and shiny where wet), a sky with clouds and sunlight, forest and hills out to the horizon, rippling water that follows the current, grass that sways, boulders the machines shove aside, exhaust smoke, dust and falling clods. Every machine has its own diesel engine, hydraulics, track clatter and backup beeper, placed in 3D where the machine is; plus scraping, dumping, tree cracks, the river, wind and birds.
- **Graphics setting:** Menu → Graphics switches High / Medium / Low (phones start on Medium; Low turns off the grass and softer shadows for older devices).
- **Saving:** the whole valley saves in your browser every 5 seconds and when you leave. "Start a new valley" in the menu is the only way to wipe it, and it asks first. Each browser or phone keeps its own valley.

## Controls

| | Computer | Phone |
|---|---|---|
| Drive and steer | W A S D or arrow keys | Thumb stick |
| Blade or bucket up/down (excavator: reach) | R / F | Raise / Lower |
| Excavator swing | Q / E | Swing L / Swing R |
| Dig, dump, tip the bed | Space | Big orange button |
| Switch machine | 1-4 or Tab | Next, or the bar at the bottom |
| Cab view | C | Cab view |
| Look around / zoom | Drag / scroll | Drag / pinch |

## Turning it on (one time)

On GitHub, open this repository's **Settings, then Pages**. Under "Build and deployment", pick **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save. About a minute later the game is live at the address above.

## Files

- `index.html`: the page (screen layout, menus, phone buttons)
- `game.js`: the game (ground, water, machines, jobs, saving, effects). Uses three.js 0.160 for the 3D, loaded from jsDelivr.
- `models.js`: the 3D models (machines with track chains, tyres, hydraulic rams and cabs; trees, boulders, grass)
- `textures.js`: all textures, drawn by code when the game starts (no image files)
- `audio.js`: all sounds, synthesized live (no sound files)
- `tests/play.cjs`: automatic gameplay checks (see below)

## Testing

`node tests/play.cjs` opens the game in a hidden Chromium browser (needs Playwright) and checks:

- the river reaches the far side;
- the dozer cuts and leaves its pile;
- the loader fills and dumps into the hauler;
- the hauler empties its bed;
- the excavator digs and dumps;
- a tall pile crumbles until it can stand;
- a finished job pays and a new one appears;
- the valley is identical after a reload;
- no broken numbers reach the sound engine;
- the phone layout works;
- no script errors.

The test runs on the Low graphics setting, because the test browser has no graphics card.

## History

### Round 1: the game

Built as a game in the same genre as a construction-sandbox reel the owner liked, with our own name, look and machines (it doesn't copy that game). All 10 gameplay checks pass.

### Round 2: realistic graphics and sound

**Graphics**
- **Machines rebuilt in detail:** rounded panels, track chains that really move (each shoe runs round the idler and sprocket; the two tracks turn opposite ways when spinning on the spot), lugged tyres, hydraulic rams whose chrome rods slide in and out, cabs with glass, seats and controls, mirrors, ladders, handrails, lights, a flashing beacon on the machine you drive, and model plates. The loader and hauler bend in the middle when steering, like real articulated machines. Bodies rock back when pulling away and lean in turns. Machines get dirtier as they dig and wash off in the river.
- **Ground:** real textures for grass, dirt and gravel, blended smoothly, with small bumps lit by the sun; shadows collect in holes; wet ground darkens and shines. Grass wears off where wheels and tracks keep running.
- **Water:** ripples that move with the current, sky reflections and sun glints, deeper water darker, foam at the edges and in fast water.
- **World:** a real sky with sun and drifting clouds, and a landscape that carries on past the work site (forest, hills, the river flowing in and out) instead of the old floating block.
- **Nature:** pines and broadleaf trees, swaying grass near you, boulders the machines shove aside.
- **Effects:** exhaust smoke (darker when the engine works hard), dust, spray in water, and clods that tumble out of buckets and the dump bed.

**Sound:** all synthesized live, nothing downloaded.
- Each machine has its own diesel engine: firing pulses, injector clatter, turbo whistle that rises with load, and exhaust.
- Hydraulic pump whine when the blade, bucket, arm or bed moves.
- Track clank as the shoes go round, a backup beeper when reversing, and digging and scraping that sound different for gravel.
- Dumps that rumble or rattle, a clang when the bed drops back, tree crack, creak and thud, splashes, and a chime for a finished job.
- Wind, leaves, birds, and the river getting louder as you get close. Sounds come from where they happen.

**Tested:** all 11 gameplay checks pass (one new: no broken numbers reach the sound engine, which caught a real bug where a zero-length frame made a number invalid). I also measured the sound output: the engines are running, and they get louder under load. I haven't been able to listen to it or see it on a real phone; the test browser has no graphics card. If phones stutter, Menu → Graphics → Low.

### Round 3: a game screen, not a web page (owner: less text and boxes)

The big text panels and paragraphs of hints are gone. What's left on screen:
- **Top left:** the machine's name, a thin load gauge and one short line (blade height or bucket position, and what's in it). Speed shows only while moving.
- **Top right:** money, the nearest job with its progress, and a small pause button.
- **Bottom:** four machine silhouettes to switch machines (keys 1-4 still work).
- **Jobs in the world:** a small diamond marker with the job name and percent, no box.
- **Messages:** short prompts like "HAULER FULL" or "LOWER BUCKET INTO DIRT [F]"; a finished job shows "JOB COMPLETE +$450".
- **Controls** only appear on the controls screen (first launch, H, or Pause → Controls). Esc pauses.
- **Phone:** round icon buttons instead of word buttons.

Tested: all 11 gameplay checks pass; desktop and phone screenshots checked for overlaps.

### Round 4: an open world of rivers to cross, smooth ground, realistic trees and sound

**The world is now open and about water.**
- **A bigger valley** (256 x 256 m): a deep river runs through the middle, a creek comes down from the north and another from the south, and there's a marsh in a hollow.
- **The yard** is south of the river. The gravel pit and the logging camp are across water.
- **Fording depth:** each machine has a realistic limit for how deep it can drive through water (dozer 1.0 m, excavator 1.2 m, loader 0.55 m, hauler 0.65 m). It stops at the bank rather than drown its engine.
- **To get across**, you build a crossing: push dirt or gravel into the river until it's shallow enough. Block it completely and the water backs up behind your dam.
- **Goals,** marked with a yellow beam and shown top right:
  1. Cross the river (get the hauler to the gravel pit).
  2. Haul gravel home.
  3. Dam the south creek.
  4. Reach the logging camp with the loader.
  5. Drain the marsh.
  After that, side jobs keep coming.
- **Minimap** in the corner (M hides it).
- The water and loose-dirt simulation now only works where something is happening, so the bigger world doesn't slow things down.

**Ground that looks like ground.**
- Near the camera the terrain is drawn at half-metre detail with smooth curves through the dig grid. Holes come out as rounded hollows and piles as rounded mounds, instead of square steps.
- Bare dirt and gravel get small natural lumps.
- Piles now spread diagonally too, so they come out round instead of diamond-shaped.

**Dirt and particles.**
- The loads in the bucket, bed and in front of the blade are lumpy textured heaps, not boxes.
- Dumping pours out a stream of fine soil grains and small clods that fall and land.

**Trees and distance.**
- Spruces are built from layers of drooping needle branches around a core; leafy trees from leaf clumps on real limbs.
- You can see much further: thinner haze, forest all the way out, and mountain ridges on the horizon.
- Sharper, longer-reaching shadows on High.

**Sound.** I couldn't download real recordings (the free libraries were blocked from here), so the synthesized sounds were rebuilt from scratch:
- Each engine is now generated as an actual recording when the game starts: every cylinder firing is a slightly different pressure pulse ringing the exhaust pipe, with diesel knock on top, as an idle loop and a working-hard loop that blend and speed up with the engine.
- Pouring soil and gravel are thousands of tiny grain impacts.
- The river is a babbling-stream texture.
- The hydraulic pump's pitch follows the engine.

**Note:** this is a new, bigger world, so it starts fresh. The first valley's save is left untouched in the browser, not deleted.

**Tested:** 13 automatic checks pass. New ones:
- Machines refuse water deeper than they can ford. This caught a real bug: at full speed the hauler couldn't stop before the bank.
- A dam backs a creek up.
- Reaching the gravel pit completes the first goal.

Screenshots were checked for the hole, the river, the trees, the horizon and pouring dirt. I can't listen to the sound or try it on a real phone from here.

