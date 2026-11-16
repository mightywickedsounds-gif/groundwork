# Groundwork

A digging game you play in the browser. Drive a dozer, loader, excavator and dump truck around an open forested valley cut by a river and creeks: build crossings, dam creeks, drain a marsh, haul gravel and reshape the ground. **Nothing ever resets:** every hole, pile and channel stays where you left it, even after you close the page.

Play it here (once GitHub Pages is on, see below): https://mightywickedsounds-gif.github.io/groundwork/

## How it plays

- **The ground is real.** The valley is a 256 x 256 m grid of heights. Whatever you dig or pile stays. Dirt piled steeper than it can stand slides down; wet riverbanks slump sooner.
- **Water flows.** A river comes in on the west side and leaves on the east. It runs downhill over whatever you shape: cut a channel and it follows; dam it and a lake fills up behind the dam.
- **Four machines:**
  - **Dozer:** the blade cuts high ground and drops it in low spots. Back up to leave the pile behind.
  - **Loader:** lower the bucket and drive into dirt to fill it, raise it over the truck and dump.
  - **Excavator:** swing, reach, dig, dump (into the truck if it's under the bucket).
  - **Hauler:** carries 12 m³ and tips its bed to dump behind it.
  - Machines knock trees over. Fallen trees stay where they land as logs; push them out of the way.
- **The crew (Menu → Crew):** three workers take the dozer, excavator and hauler and follow you around the valley, finding their own way round deep water and steep ground. Stop at water too deep to drive through and they pick the narrowest spot nearby and build a crossing: the excavator digs a pit and loads the hauler, the hauler backs up to the water and tips, the dozer pushes it out and grades the top. When it's done ("CROSSING READY") they fall in behind you again; drive off and they drop the job and follow. You get the loader. Switch to any of their machines to take it over; the others keep working. Turn the crew off and they stop and get out.
- **Jobs that pay:**
  - **Level the pad:** make the marked area flat at the see-through plane.
  - **Dig the pond:** dig down to the plane.
  - **Stockpile gravel:** bring gravel from the grey gravel pit.
  - Finish one and a new one opens somewhere else.
- **Looks and sounds real:** textured ground (grass, dirt, gravel; darker and shiny where wet), a sky with clouds and sunlight, forest and hills out to the horizon, rippling water that follows the current, grass that sways, boulders the machines shove aside, exhaust smoke, dust and falling clods. Every machine has its own diesel engine, hydraulics, track clatter and backup beeper, placed in 3D where the machine is; plus scraping, dumping, tree cracks, the river, wind and birds.
- **Graphics setting:** Menu → Graphics switches High / Medium / Low (phones start on Medium; Low turns off the grass and softer shadows for older devices).
- **Saving and worlds:** the valley you're playing saves in your browser every 5 seconds and when you leave, so refreshing brings you back to it. Menu → Worlds lets you save a named copy ("Save this world"), load a saved one, delete one, or start a completely fresh valley ("New world"). Before loading or starting fresh, your current valley is kept as "Autosave", so nothing is lost by accident. Each browser or phone keeps its own worlds.

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
- `crew.js`: the crew's brains (following you, planning a crossing, who does what at each stage)
- `construct.js`: what the crew builds (road layers, culverts, rock armour, guardrails, markings, lights, signs, bridge parts) and the list of materials
- `tests/play.cjs`: automatic gameplay checks (see below)

## Testing

`node tests/play.cjs` opens the game in a hidden Chromium browser (needs Playwright) and checks:

- the river reaches the far side;
- the dozer cuts and leaves its pile;
- the loader fills and dumps into the hauler;
- the hauler empties its bed;
- the excavator digs and dumps;
- a full bucket dumps as a heap about a metre tall;
- fallen trees stay as logs and can be pushed;
- the crew gets in, follows you (checked over 50 s), keeps working when you take one machine over, starts building when you stop at the river, has clearly moved the job on within five minutes, finishes the whole crossing within 30 minutes of game time, and gets out when turned off;
- fast water washes loose dirt downstream, but the untouched riverbanks don't erode;
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

### Round 5: rivers in valleys, not canyons (owner feedback from a phone)

- **No more canyons.** Rivers and creeks now sit in wide, gentle valleys: the land slopes down to a grassy floodplain about half a metre above the water, then a natural bank into the channel. Riverbeds are gravel and the banks just above the water are mud. (Before, the banks were 5-6 m walls.)
- **The river shows from inside the cab.** The cab glass was marking itself as solid in the depth check, so anything see-through behind it (water, dust) was skipped. Fixed.
- **Reeds and tall grass** line the water's edge.
- **A little brighter** overall.
- **Faster machines:** about 30% higher top speed and quicker acceleration (dozer 17 km/h, loader 28, excavator 11, hauler 40).
- **More life in the background:** crickets in the grass, frogs at the marsh and along the water, a woodpecker now and then, crows, doves, and longer warbling songbirds, all placed around you in 3D.
- The valley is shaped differently, so this starts a fresh valley again (save version 3; the older saves stay in the browser untouched).

Tested: all 13 checks pass. The dam check now uses a wider dam and a little more time, because the wider valley takes longer to fill. Screenshots checked from above, from the bank and from inside the excavator cab.

### Round 6: a crew, water that fights back, honest dirt, logs instead of vanishing trees

**The crew (new, Menu → Crew: on/off).**
- Three workers in hard hats and hi-vis vests drive the dozer, excavator and hauler. Turning the crew on hands you the loader.
- They work as a team to build a crossing over the nearest river: the excavator digs a pit and fills the hauler; the hauler turns round once, then backs up to the water's edge, tips, and drives back; the dozer pushes the dirt out into the river and grades the top about a metre above the old water level. When the river is crossed they move on to the south creek, and after that they park in the yard.
- Take over any of their machines by switching to it. That worker sits out; the other two keep going. Switch away and the worker gets back in and carries on from wherever you left the machine.
- Crew off: they stop and get out of the cabs. Their progress is saved.
- Crew machines show yellow on the minimap.
- In the automatic tests, a crew built across the main river in about 10-13 minutes of game time.

**Water.**
- Fast water now washes away loose dirt that people have moved (not untouched ground or gravel) and drops it downstream where the water slows. A dam that gets overtopped, or a narrow gap, wears away; a heap dumped in the current gets carried off. The original riverbanks are never eroded (tested).
- Dammed water can now rise further before the river's source "gives up", so it backs up behind dams properly and spills round the ends of a crossing over the floodplain.

**Digging and dumping in proportion.**
- Dumped loads land as a heap about as tall as loose soil stands (a 3 m³ loader bucket makes a pile about a metre tall), then slump if they're too steep. Before, a load was spread in a thin layer, which is why big scoops seemed to vanish.
- Dug-up ground bulks up 20%, like real soil, so a pile is a bit bigger than the hole it came from. Dirt that has already been dug once doesn't bulk again.
- The loads shown in the bucket, blade and bed now match what's really in them.
- A full dozer blade now shoves the heap in front of it along, instead of the dozer driving up over it.
- **Bug fixed:** when the loader dumped on the ground, its dirt was being dropped where the hauler was parked instead of under the bucket. It now lands under the bucket.

**Trees.**
- Knocked-down trees stay as logs lying on the ground (no more shrinking away). Machines push them aside; push near one end and the log swings round. Logs are saved.
- Trees and logs between the camera and your machine thin out, so you can see what you're doing in the forest.

**Minimap** is bigger (240 px on computers, 150 px on phones) and drawn at full detail.

**Graphics: digging.** The ground remembers how it was before you dug. Cut walls show soil layers: dark topsoil, brown subsoil, orange clay further down with a pale sandy band; dumped spoil is lighter and lumpier with clods. Cut faces are slightly rougher.

**Tests:** 13 old checks plus 10 new ones (see Testing). The new pile check is what caught the loader bug. The test browser can't reach jsDelivr from here, so the test can load three.js from a local copy (`THREE_DIR=...`); the game itself still uses jsDelivr. I couldn't play it with a real graphics card or on a phone; screenshots were checked for the piles, pit walls, workers in cabs and the minimap.

### Round 7: the crew follows you (owner: free roam, they do the work)

- The crew no longer works on fixed spots. They drive behind you in a loose convoy (dozer and excavator either side, hauler at the back) wherever you go, planning their own route across the valley on a 2 m grid: round water deeper than each machine can ford and up slopes it can climb. Once a crossing is built, their routes use it.
- Stop at a river or creek too deep to drive through (or have your machine refuse to go in) and after a moment they announce "CREW: BUILDING A CROSSING". They aim straight across the water near you, pick the narrowest line that keeps clear of your machine, and build it with the same team job as before. "CROSSING READY" when it's shallow enough to drive across; then they follow you again.
- Drive more than about 90 m away from a crossing they're building and they drop it and come with you. The dirt they've already moved stays, so stopping there again later picks up where they left off.
- The crossing they're building shows as a yellow line on the minimap. After "CROSSING READY" they won't start another one until you've moved on.
- A dozer with its blade down now shoves a heap in front of it instead of stopping because the heap looks like a slope it can't climb (this affects your dozer too).
- Ground that tracks or wheels have rolled over is compacted and washes away about seven times slower than loose dumped dirt, like real compacted fill. Without this, water flowing round the end of a half-built causeway kept washing the approach away.
- Bugs found while testing: two parts of the crew code had the same name, so the machines stood still during a job; the dozer could wedge itself against your machine; the crossing line could run along the bank instead of across. All fixed.
- In the test runs, with you parked at the river, the crew built a crossing in about 8-9 minutes of game time, and when you drove 70 m away they caught up within a minute.


### Round 8: a real crew on foot, machine damage, rivers that hold their water (owner: too slow, wants a full team)

- **Game speed:** the 1X button top right (or T) cycles 1x / 2x / 4x.
- **Crew stall fixed:** on a bridge job the crane and its delivery truck were dropped off on the same spot, locked into each other and the job froze. Machines caught inside each other now ease apart, and new equipment is dropped where there's room. The bridge now runs through all its stages.
- **The building crew (new, comes on with Menu → Crew):** six workers on foot in hard hats and hi-vis vests (a foreman, two fallers, three framers) build timber buildings in the forest near the yard, one after another (a cabin, a shed, a workshop...):
  1. Fallers with chainsaws walk to each tree, cut it (sawdust, chainsaw sound) and drop it into the clearing, step back, then strip the branches off the log. Stumps stay.
  2. A self-loading log truck drives in, picks up each log with its crane and grapple, stacks it on its bunks and drives off (more trips if needed).
  3. The dozer levels a gravel pad (if it's busy, the crew rakes it level by hand).
  4. A flatbed drops off lumber, sheet board and roofing.
  5. The framers carry every piece from the stacks and nail it in, with hammer sounds: concrete piers, sill beams, floor joists, floor, wall studs and plates with door and window openings, then ladders go up for the ceiling joists, ridge, rafters, roof boards and metal roofing, then wall boards, door, windows and trim. About 300 pieces per cabin.
  6. They rake round the building and the grass comes back, then move to the next site.
- **Machine damage (new):** hitting trees, rocks or another machine at speed, dropping off ledges, rolling on very steep side slopes and sitting in deep water wear a machine down. A damaged machine loses power, smokes grey then black, and shows scuffs and rust; at zero it breaks down. Its condition shows under the machine name. The crew's own driving is gentler on their machines.
- **Mechanic (new):** when a machine breaks down or is badly damaged and stopped, the mechanic drives out in the service truck, kneels at it with a wrench and fixes it. Machines parked in the yard also slowly get fixed.
- **Water:** the rivers were slowly draining (the main river lost half its depth in 10 minutes and the north creek almost dried up), which hid any backing-up behind a dam. River and creek inflow is now about double, so they hold their depth, and a dam makes a lake that rises steadily until it spills over the lowest point of the crest. Dirt dropped into water now pushes the water aside instead of lifting it up on top. Erosion of dumped dirt is a bit gentler so it matches the stronger rivers.
- **Dirt and asphalt:** a full bucket now pours out and the pile builds over most of a second; finer soil grains instead of big clods; soil rolls off the face of the heap in front of a dozer blade; the paver steams and spills hot mix through its augers.
- Tree bark is lighter (trunks and logs were showing nearly black).

**Tested:** all 24 automatic checks pass. In the test runs the building crew cleared a site in 1.5-4 minutes, hauled the logs in about 2.5 minutes and framed a full cabin in about 12 minutes of game time (3 minutes at 4x). Bugs found and fixed while testing: the framers stopped at a quarter of the cabin (pieces out of order); the log truck got stuck among parked machines and couldn't reach logs felled outwards; the dozer's own blade cut the pad below level while grading. Not done this round: better-looking trees and grass. I can't see or hear it on a real screen from here, so please tell me what looks off.
