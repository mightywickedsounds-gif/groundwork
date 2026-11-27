# Bug log (round 23: polish and bug hunt)

## Scorecard

- **Found: 25. Fixed: 23. Left: 2.**
  - Crash: 1 found, 1 fixed.
  - Broken: 3 found, 3 fixed.
  - Looks wrong: 14 found, 13 fixed, 1 left (B25, tool buttons on the smallest phones).
  - Minor: 7 found, 6 fixed, 1 partly (B24, a few harmless unused names left in the code).
- **Where they were found:**
  - reading the code: 10
  - screenshots and the layout check: 7
  - the owner's notes and screenshot: 4
  - the ESLint code checker: 2
  - the new soak test (the game playing itself): 1
  - the existing tests: 1
- **Bugs I probably missed:** around 10 to 20. I'm least confident about:
  - touch gestures on a real iPhone (the tests only fake touches);
  - real phone speed and heat (the test browser draws in software, at about 2 frames a second);
  - rare standoffs at busy driveways right next to junctions;
  - police chases, crashes and fires on screen (the soak test only sets them off by chance);
  - very old saves.
- **Thoroughness: 6 out of 10.** The simulation, saving and the phone layout were checked with real tests and a self-playing soak test, but everything visual was judged from software-rendered screenshots, and nothing ran on a real phone or GPU.

## Numbers: before (round 22) and after (round 23)

| Test | Before | After |
|---|---|---|
| bridge | 18 pass, 0 fail | 18 pass, 0 fail |
| life | 12 pass, **1 fail** (a car left waiting unseen in the road; on some runs) | 13 pass, 0 fail (and 6 runs out of 6 in a row) |
| law | 8 pass | 8 pass |
| lanes | 16 pass | 16 pass |
| build | 0 crossings without a junction | 0 crossings without a junction |
| sim (one day, 3 districts; random, so several runs) | old code: 589-647 trips done, 1-7 drivers gave up | 591-619 trips, 3-9 gave up |
| grow (4 days; random) | old code: 43, 77, 82 drivers gave up (3 runs) | 63 gave up |
| browser check (play.cjs) | 23 pass | 23 pass |
| soak (new, 120 actions each at desktop and phone size) | n/a (its first run found the crash B5) | all pass: no page errors, no broken positions, save/reload keeps the town, GPU objects flat (105 down to about 90) |
| page errors while taking screenshots | none (only the test browser's own "GPU stall" notes) | none |
| frame time in the test browser (software drawing, not a phone measure) | phone 664 ms, desktop 791 ms | phone 689 ms, desktop 872 ms (about 4 % and 10 % slower here: the lamp glows and the busier lots; worth checking on a real phone) |

## The bugs

| ID | Where | How to make it happen | Severity | Status |
|---|---|---|---|---|
| B1 | parking.js `clear` / leaving a lot | Busy driveway next to a junction: the car pulling out of the lot reserved its place in the lane, then waited for the car queued right behind that place, which was waiting for it. The car stayed invisible in the lane for minutes (life test failed on some runs) | broken | fixed: cars held up behind its place are ignored; after waiting 6 s the place is kept clear; after 45 s it squeezes out |
| B2 | police.js `rage` | A `break` before the scanner line: "flipped off" road rage calls never reached the scanner (ESLint: unreachable code) | broken | fixed |
| B3 | index.html day summary | The line over "Total" had a gap between the two columns | looks wrong | fixed |
| B4 | index.html / game.js card | The close X sat right after the name, not at the right edge of the card | looks wrong | fixed |
| B5 | game.js `selTick` | Card open on someone who leaves town (or a building that goes): the card closed itself, then the next line read the empty selection: crash ("Cannot read properties of null") found by the soak test | crash | fixed |
| B6 | game.js `disposeGroup` | Every rebuild of the roads, lamps or buildings left the instanced meshes' own GPU buffers behind (memory slowly growing) | minor | fixed |
| B7 | life.js / parking.js | Owner's screenshot: a driver walking straight through parked cars. Drivers walked from the middle of their car out to the street sidewalk and back to the door | looks wrong | fixed: out of the driver's door, along the line between the stalls, along the shop walkway, in at the door (and the same way back) |
| B8 | life.js `carDone` | Drivers who stop at the kerb stepped out of the middle of their car, in the road | looks wrong | fixed: out on the kerb side |
| B9 | net.js lane changes | A car could move over the instant it decided to, with no blinker first | looks wrong | fixed: about a second of blinker first (unless crawling or about to miss the turn) |
| B10 | index.html | `#card.show ~ #scan` never applied (the scanner came before the card in the page), so the scanner sat on top of an open card on phones | looks wrong | fixed (card moved earlier in the page) |
| B11 | index.html phone layout | The Street / Overpass / Underpass buttons and the hint overlapped an open card; on a phone on its side the card ran off the top of the screen | looks wrong | fixed: picking a tool puts the card away, the card scrolls and stays on screen in landscape |
| B12 | index.html phone layout | Tap targets under 44 px: tool buttons 36 px wide, menu 40 px, card close 34 px | minor | fixed on phones 375 px wide and up (tools 44 px); on the smallest phones (320 px) tools are 35 px: not fixed (8 tools don't fit) |
| B13 | game.js `lighting` | Owner: daytime looked dim and orange like evening. With night switched off the day is squeezed, so at 9-10 am the sun was still very low (long shadows, weak light, warm tint) | looks wrong | fixed: the sun climbs quickly after dawn, warm light only at sunrise and sunset, brighter shade |
| B14 | draw.js people | Legs swung wider than the distance walked: feet slid | minor | fixed (stride matched to walking speed) |
| B15 | index.html title | Owner: the big green sign looked a bit AI-made (thick rounded badge, white pill) | looks wrong | fixed: plain city-limit sign on two posts |
| B16 | index.html speed buttons | Owner: the speed strip floating under the gridlock sign felt off | looks wrong | fixed: pause/play and speed tiles in a column under the menu button |
| B17 | draw.js store roofs | Bright white roofs and a thick white rim (inner parapet walls painted the wall colour) looked like toys | looks wrong | fixed: weathered grey membrane, grey inner parapet |
| B18 | game.js coins | Coins over the businesses were huge up close | looks wrong | fixed (smaller, same tap area) |
| B19 | index.html | A later phone rule put the card 124 px up (room for the old second row), leaving a gap | minor | fixed |
| B20 | game.js keys | Space bar: a button clicked last (a tool) was pressed again as well as pausing | minor | fixed |
| B21 | game.js tools | Erase, Lanes, One-way, Lights, Round did nothing at all when tapping empty ground | minor | fixed: a short "Tap a road" / "Tap a junction" |
| B22 | game.js | No way to undo a mistake (a wrong removal knocks down buildings for good) | broken | fixed: Undo button for 8 s after each road edit, Ctrl+Z on desktop, the last 12 edits, coins refunded |
| B23 | game.js brake lights / blinkers | Lamps are a pixel or two at the normal zoom: you can't see who's braking or turning | looks wrong | fixed: a small glow at each lit lamp |
| B24 | (code) unused names in game.js, draw.js, parking.js | ESLint: imports and variables never used | minor | mostly fixed; 6 harmless ones left (city.js `tries`, life.js `ids`, scenery.js `hw`, game.js `night` and two unused arguments) |
| B25 | phones 320 px wide (iPhone SE first generation) | The tool buttons are 35 px wide | looks wrong | not fixed: would need a second row or fewer tools; see ideas |

## Next round ideas (too big or too risky for this round)

- Cars that leave and come home to houses still appear and disappear at the kerb. They could back out of the house driveway, but the parked cars on driveways are drawn as one static mesh, which would need reworking.
- A three-point turn at dead ends instead of a tight U-turn loop.
- Smallest phones: a scrolling tool row or two rows of tools.
- Real-phone checks (frame rate, battery, touch feel) on the owner's iPhone.
- Undo for building a business and for buying land.
