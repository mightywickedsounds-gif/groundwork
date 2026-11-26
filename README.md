# Flowtown

A town-building and traffic game you play in the browser. You start with a crossroads village in the Central Texas Hill Country: a handful of streets, a few shops and a dozen families. Every person in town has a name, a home, a job and a boss, and drives (or walks) to work, lunch and the shops. Businesses earn coins while their staff are in; you collect it, upgrade them, open new ones, build roads, buy land and add a police station, a fire station and a hospital. Police hide and run radar, pull people over, chase robbers and carjackers; crashes bring police, fire engines and ambulances.

Play it here (from `main`, once merged): https://mightywickedsounds-gif.github.io/groundwork/

## How it plays

- **Coins.** Each business earns while its staff are at work (and from every customer who comes in). The takings wait in the till (a coin over the building): tap the coin or the building to collect. From level 3 a manager banks it for you. Homes pay a little tax each night; services (police, fire, hospital) cost upkeep.
- **Upgrade and expand.** Tap a business to see its staff, who's in, what it earns, and upgrade it (more staff, more income; offices grow taller). Use Build to open a new business or service on any street, or to buy the land next to town (its streets come with it). Roads, extra lanes, lights and roundabouts cost coins.
- **People move in when there's work.** New jobs bring new families: houses on the side streets, apartments on the main roads, and once the town passes about 160 people a downtown that grows taller (up to 7 storeys).
- **Everyone is someone.** Tap any car or person for their name, age, job title, who they report to, where they work and live, what they're doing right now, and whether their car is insured and their tags are current. Follow keeps them in view.
- **Visitors.** Main Street becomes a highway out of town: through traffic and out-of-towners stop at your shops and spend money.
- **The law.** Police cars park out of sight (the corner of a lot, behind trees) and watch the traffic: speeders, red-light runners and expired tags get pulled over and ticketed (the fine is yours). No insurance is another fine, and some drivers floor it instead of pulling over. Robberies and carjackings turn into chases to the edge of town. Crashes block lanes until the police (and an ambulance, and a fire engine if a car catches fire) have dealt with them; drivers with no insurance may flee the scene. Everything shows up on the police scanner (top right): tap a call to go there.
- **Tempers.** A few drivers are reckless: they speed, tailgate, run reds and lean on the horn, and sometimes a driver flips off the one in front.
- **Each day ends** with the day's books (businesses, taxes, fines, upkeep, trips, crashes, arrests) and a goal to aim for next.
- **The city grows back.** When a new or wider road cuts through, buildings in the way are set back (rebuilt smaller) where enough of them is left, and empty land along any street fills in again with new buildings facing that street, at whatever angle it runs.
- **Everyone has somewhere to be.** People drive from home to work in the morning rush (around 8:00), run errands at midday and drive home in the evening rush (around 17:30). Each driver picks the quickest route and switches to another way when they're stuck.
- **Wide roads.** Any road can get 2 or 3 lanes each way and turn lanes. Drivers pick their lane early, move over when there's a gap (the car behind lets them in if they're waiting), and follow the arrows painted in each lane: the kerb lane goes straight or right, the inside lane goes straight or left, and turn lanes in the middle hold the cars turning left so the rest keep moving.
- **Real traffic rules.** Cars keep their distance, slow for turns, queue at junctions and don't block a junction they can't get out of. Plain junctions work first come, first served. Traffic lights switch between directions and end a green early when nobody is waiting. At roundabouts, entering cars give way to cars already on the ring.
- **Gridlock meter (top right).** It rises while lots of drivers are stuck and when drivers give up, and falls when traffic flows. Jams cost you: people late for work, staff not in, shoppers not getting there. Red pulsing circles show the worst junctions.
- **Day and night.** The sun rises in the east, crosses the southern sky and sets in the west, with warm sunrises and sunsets, drifting clouds, and stars and a moon at night. At night windows, headlights (lighting the road ahead), tail lights and street lights come on.

## Your tools

| Tool | Key | What it does |
|---|---|---|
| Build | B | Tap a street to open a business or a service there (the list shows prices; some need more people first). Tap land just outside town to buy it. |
| Road | 1 | Phone: press and hold, then drag to draw a road (a quick drag just moves the map); tap to keep going from the yellow pin. Computer: click to start, click to place; it keeps going from the end. Crossing a road makes a junction; ending near a road (even on its sidewalk) joins it. |
| Curve | 2 | Phone: hold, then drag to draw it, then drag to bend it. Computer: click the start, click the end, move to bend, click. |
| Lights | 3 | Click a junction to add or remove traffic lights. |
| Round | 4 | Tap a junction, a bend or any stretch of road to put a roundabout there. It sizes itself to fit and clears the buildings in the way. A road drawn through a roundabout joins it. |
| One-way | 5 | Click a road: two-way, then one way, then the other way. |
| Lanes | 6 | Click a road (the stretch between two junctions) to step it through: 1 lane + turn lanes, 2 lanes, 2 lanes + turn lanes, 3 lanes + turn lanes, back to 1 lane. Wider roads set back or clear the buildings in the way; the street fills back in later. Where wide roads cross, traffic lights go up by themselves (remove them with Lights if you like). |
| Remove | 7 | Click a road to remove it, or the middle of a roundabout to turn it back into a junction. |
| Traffic view | T | One band per direction of each road, green (moving) to red (jammed). |

Any road you build through buildings or trees clears them.

## Controls

| | Computer | Phone |
|---|---|---|
| Move | Drag, or W A S D | Drag (always; to draw a road, hold first) |
| Turn and tilt | Right-drag, or Q E and R F | Two fingers (twist to turn, slide up/down to tilt) |
| Zoom | Scroll, or Z X | Pinch |
| Use a tool | Click | Tap |
| Drop the tool | Esc, or right-click | Tap the tool again |
| Pause / speed | Space, the speed buttons | Speed buttons |

The game saves in your browser every 10 seconds and when you leave. Menu → Graphics switches High / Medium / Low (phones start on Medium). Menu → Night on/off: with night off the sun never sets.

## Files

- `index.html`: the page (screen layout, buttons, menus)
- `game.js`: the game (title screen, camera, tools, cards, coins, the scanner, day and night, the gridlock meter, saving, sound)
- `life.js`: the people (names, homes, jobs, bosses, daily routines, walks, visitors) and the money (businesses, levels, goals)
- `police.js`: police, fire and ambulances; crashes, traffic stops, robberies, carjackings, chases, road rage
- `scenery.js`: shop signs with names, street trees, power poles and wires, hydrants, street signs, benches, bus stops, grass and wildflowers
- `net.js`: the road network and the traffic (lanes, junction rules, lights, roundabouts, route finding, car following)
- `city.js`: the city (street plan, districts, buildings, trips)
- `draw.js`: everything you see (roads, curbs, sidewalks, markings, buildings with windows, trees, cars, people, lights)
- `sky.js`: the sky (time of day, sunrise and sunset, clouds, stars and moon); it also lights the reflections
- `assets/`: grass photo; `assets/tex/` photo textures for asphalt, sidewalks, brick, limestone, stucco, roof shingles, gravel roofs and lawns (all from Poly Haven, CC0, shrunk for the web); `assets/fonts/` Overpass, a highway-sign style typeface (SIL Open Font License, see `LICENSE.txt`)
- `tests/`: automatic checks (see below)

## Testing

- `node tests/sim.mjs [districts] [hours]` runs the traffic with no browser and reports trips, stuck cars and why they're stuck. `MODE=sig` puts lights on every junction, `MODE=ring` makes every junction a roundabout.
- `node tests/grow.mjs [days]` lets the city grow with no help from the player and prints the gridlock meter over time.
- `node tests/build.mjs [tries]` builds hundreds of random roads, curves and roundabouts and checks no road ever crosses another without a junction.
- `node tests/lanes.mjs [hours]` checks wide roads: the arrows at a crossroads, left turns using the turn lane, and the same city run with plain streets and then with every avenue widened.
- `node tests/life.mjs [days]` runs the starting town: people, jobs, trips, walks, earnings and growth.
- `node tests/law.mjs [days]` adds a police station, fire station and hospital and checks hiding units, stops and tickets, a crash being cleared, a robbery and a chase.
- `node tests/play.cjs [folder]` opens the game in a hidden browser, checks the tools work and saves screenshots.

## History

### Round 1: new direction (traffic game)

The digging game moved to `dig/` (its saves still work). The new game was built from scratch:

- Traffic simulation: each car follows the one ahead smoothly, slows for bends, and waits at junctions until it's its turn and there's room on the other side. Lights adapt to waiting cars. Roundabouts give priority to the ring and stop letting cars in when the ring is nearly full (without that, a full ring locked up completely).
- Test results (no player help): with 3 districts the roads clear every night with almost no drivers giving up. Left alone, the growing city starts jamming on day 3 and locks up near the end of day 3, so the player has to step in around day 2. Lights or roundabouts on every single junction do not beat the plain junctions overall (roundabouts everywhere also knock down 86 buildings); they help where they're placed well, which is the game.
- Speed: one simulation step with 1,400 cars takes about 2-8 ms.

### Round 2: new look for the screen

The see-through panels and floating text are gone. The screen now looks like road signs: a green guide sign (time, day, people, cars, flow, average trip, next district), a yellow warning sign for the gridlock meter (striped fill when it gets bad), a solid asphalt-dark tool dock with yellow for the selected tool and speed, white sign pop-ups (red for "can't do that"), a green sign start screen and a red stop-sign game-over screen. Type is Overpass (modelled on highway signs), served from the site itself. Phones get a two-row dock and shorter labels.

### Round 3: building that works, and a friendlier night

The owner's report: roads often refused to build ("can't build there") or came out glitched, and tapping on a phone was fiddly; roundabouts said "roads too close"; night was too dark to follow.

- **Why roads glitched:** when a new road started at a junction and crossed another road close to it, the crossing was skipped, so the two roads lay on top of each other with no junction (cars drove through each other), and short leftover pieces could silently go missing. A stress test of 400 random roads, curves and roundabouts found 27 such crossings before the fix and **0 after**. Every crossing is now a real junction; if one is too tight to build, nothing is changed and the game says why ("Too close to another road"). As a safety net, any road or roundabout that would still cross a road without a junction is undone.
- **Roads build more often:** in that stress test 95% of random roads now build (68% before). A road ending just past another road joins it; tapping near the end of a road joins that end; a road drawn through a roundabout joins the ring. "There's already a road there" only shows when you really draw over a road.
- **Phones:** with Road or Curve picked, one finger draws (drag) and two fingers move the map. The live preview shows exactly where the road will connect and turns red with the reason if it can't be built. After each road a yellow pin marks its end; tap anywhere to continue from it (tap the pin to let go). Tap distances grow when zoomed out (about 30 pixels on a phone).
- **Bends:** where two roads meet end to end (like a zig-zag), the corner is drawn as one smooth curve instead of a lump. Junction corners no longer make spikes.
- **Roundabouts:** work on junctions, bends, road ends and any stretch of road; they shrink to fit (down to a mini roundabout) and roads leaving at nearly the same angle share an entrance (no more "roads too close"). On the normal city grid every junction (33 of 33) takes one.
- **Night:** a soft moonlit blue instead of black, gentler window lights, and the clock runs three times faster from 21:30 to 5:00. Menu → Night off keeps it daytime.
- Tests: sim, grow, build (0 bad crossings) and the browser checks all pass; phone gestures (drag to draw, tap to continue, two-finger pan, tap a road for a roundabout) were checked with simulated touches.

### Round 4: wide roads and turn lanes

(The request mentioned a video; it didn't come through to me, so this is the usual kind: lanes each way, lane lines, a middle turn lane and arrows painted in each lane. Say what looks different from the video and it can be changed.)

- **New Lanes tool (key 6, Remove is now 7).** Tap a road to step it through 1 lane + turn lanes, 2 lanes, 2 lanes + turn lanes, 3 lanes + turn lanes, then back to 1. It changes the stretch between two junctions (bends included). The hover shows how wide it will be and what it becomes.
- **How it looks:** white dashed lines between lanes, double yellow down the middle of wide roads, and with turn lanes a painted middle strip: hatched where nobody turns, opening into a left-turn lane before each junction where a left turn is possible. Each lane has arrows near the junction showing where it may go. Traffic lights stand at the kerb of wide roads.
- **How drivers use it:** they plan their lane as part of their route, move over when there's a safe gap, slow down and wait near the end if there isn't one, and the car behind lets them in. They drift across smoothly instead of jumping. Busier lanes cost more, so straight traffic spreads over both lanes. Left-turners wait in the turn lane instead of holding up everyone behind them. Where two lanes squeeze into one, cars take turns.
- **Lights where wide roads cross:** a big junction with no lights only lets one direction through at a time, and the tests showed wide crossings without lights jamming worse than narrow ones. So the Lanes tool puts lights up where wide roads cross (3 or more wide roads at a junction). With lights, wide avenues carried 9% to 22% more trips than plain streets in every test city, with fewer drivers giving up and shorter trips.
- **Junction fixes that came up on the way:** a car that was waved into a junction but then found the road beyond full now lets go after 2 seconds, so it doesn't block everyone else; a car changing lanes keeps the start of a road clear for cars leaving the junction; a left-turner waiting more than 12 seconds in a turn lane gets let through by oncoming traffic.
- **Two old building bugs fixed:** a road crossing another exactly on one of its measuring points was wrongly refused as "too close"; and when a new road cut through two roads lying very close together, the two old roads could end up crossing each other without a junction (the safety check now covers every piece a new road creates, so this is refused instead).
- **Saves:** old saves load as before (every road 1 lane); the lane setup of each road is saved.
- **Tests:** sim (plain streets: same numbers as before on the same random seeds), sim with lights everywhere and roundabouts everywhere, grow (left alone, the city still locks up on day 3, a little later than before and with fewer drivers giving up), build (0 crossings without a junction, now with random lane changes mixed in; also 0 in a 1000-road run), the new lanes test and the browser checks all pass. Screens checked on a computer and a phone-sized screen (the dock now has 8 tiles and fits).

### Round 5: moving the map on a phone, roads that join

The owner's report: once a road was placed, trying to drag the view placed more roads instead; and a road drawn up to a street stopped at the sidewalk, not connected (screenshot).

- **A quick drag now always moves the map**, with every tool. To draw a road or curve on a phone, press and hold for a moment (the start point sparkles and the phone buzzes where it can), then drag. Taps work as before (tap to keep going from the pin). Bending a curve that's waiting is still a plain drag.
- **Roads join a street they end next to.** Before, a road end had to land within about 7 to 9 metres of a street's centre line to join it; ending on the sidewalk (about 13 m out) left a dead end with the two sidewalks touching. Now an end that close always joins the street, making a proper junction. On computers too.
- **Torn sidewalks at bends fixed** (owner's second screenshot: thin wedges of grass cutting across the sidewalk where two roads join end to end). The bend between two roads is drawn as one smooth curve in short straight steps; its two ends were set square to its first step instead of square to the road, which opens a sliver on the outer sidewalk, worse where a curved road meets the bend. The ends of every stretch of road now line up exactly with the next piece, and the bend leaves each road at the road's own angle.
- **No trees on roads outside the city:** the woods on land the city hasn't reached are now kept off any road built out there.
- **Busy phones:** whether a touch is a hold (draw) or a quick drag (move the map) is decided from when the finger actually moved, not from a timer, so a phone that's busy drawing the city can't mistake one for the other.
- Tests: browser checks now include real touch gestures on a phone-sized screen (quick drag moves the map and builds nothing, hold-and-drag draws, a road ending on a street's sidewalk joins it, a drag with the pin waiting builds nothing). Build stress test: 0 crossings without a junction. Traffic tests unchanged.

### Round 6: phones keep matching files

The owner's report: the Lanes tool wasn't working on the live site. It works on a fresh load, so the likely cause is the phone mixing files: it fetched the new page (with the Lanes button) but kept the old copy of the game code, which doesn't know the tool. The page now asks for each game file with a version number (`?v=6` in `index.html`), so a new version always loads a matching set. If a phone still shows the old game, close the tab and open the site again.

### Round 7: a city that survives wide roads

The owner's screenshots: after widening the whole grid (and building a rotated grid with roundabouts), the city looked empty and basic, and it didn't look real.

- **Why it looked empty:** a 3-lane road with turn lanes and sidewalks is about 30 m wide, and every building it touched was knocked down. Widening every street to 3 lanes + turn lanes cleared all 205 of 205 buildings in a test city, and nothing ever came back.
- **Buildings are set back instead:** a building in the way of a wider road is rebuilt smaller, away from the road, when at least a third of it and 6 m each way are left (fewer people or jobs to match). In the same test, 77 buildings are set back and 144 cleared, instead of all of them. Parks and parking lots are trimmed the same way.
- **The city grows back:** empty land along any street inside the city fills in again over time, a few buildings at a time, with the kind of building that part of town has (towers downtown, apartments and shops in the middle, houses with gardens outside). Buildings face their street at whatever angle it runs, so a rotated grid gets rotated buildings. In the test, the cleared city went from 87 to 156 buildings in three days; an untouched city doesn't change (no room), so normal games play the same.
- **Roundabouts on wide roads:** they now size themselves to fit the roads coming in (up to 30 m) and get two lanes round the ring when a wide road comes in, with a dashed line between the lanes and an edge line by the island. Both lanes can carry on round or leave (the inside lane to the exit's inside lane). In tests, two-lane roundabouts had far fewer drivers giving up (5 or 6 vs 15 to 31 on single-lane ones).
- **Traffic view:** one band per direction down the middle of that direction's lanes, instead of a stripe on every lane, so the city is still visible underneath.
- **Junction drawing fixes:** where roads meet at sharp angles, sidewalk could be painted over the whole junction (a big pale blob); the sidewalk now always follows the kerb. A road carrying straight on past a junction gets a straight kerb instead of a bulge. The painted median hatching looks less like a ladder.
- **Saves:** buildings remember their angle; older saves load as before.
- **Tests:** new checks in the lanes test (widening sets buildings back, the city regrows within a day, no regrown building overlaps another or a road, saves keep turned buildings), and the growth test now regrows like the game. Traffic (with lights, roundabouts everywhere: same range as before while keeping a third more buildings), growth (left alone, still locks up on day 3), building (0 crossings without a junction) and browser checks all pass.

### Round 8: a Central Texas suburb

The owner's direction: the city should look realistic, styled after a Central Texas Hill Country suburb.

- **Nothing tall any more.** The glass-tower downtown is gone. New cities and new districts are laid out like a suburb:
  - **Neighbourhoods:** houses on lots about 15 to 19 m wide, one or two storeys, in limestone, tan stucco or brick with hipped shingle roofs, a concrete driveway to the street, a front-yard oak and a wooden privacy fence round the back yard.
  - **Along the arterials:** shopping strips with parking lots in front and a plain sign band over the shopfronts, the odd big store (mostly blank walls, a glass entrance, a big lot), 2 to 4 storey offices with parking beside them, and 3-storey garden apartments with pitched roofs. Stores have light-coloured flat roofs with air-conditioning units.
  - **A small town centre** near the middle: 2 to 4 storey buildings up to the sidewalk, shops downstairs.
- **Arterials** (the roads round every district) now start as 2 lanes each way with a centre two-way left-turn lane (solid yellow outside, dashed yellow inside), with traffic lights where they cross. Neighbourhood streets stay 2-lane.
- **Trees:** live oaks (short trunk, wide low crown) and cedars (dense, dark, narrow). The woods outside town are mostly cedar. The grass is a drier olive.
- **Regrowth** builds the same mix: houses on neighbourhood streets, shops, offices and apartments on arterials and wide roads.
- **Traffic balance:** a suburb has fewer people than the old towers (about 1,200 in the first three districts instead of 5,600), but everyone drives, so each person makes more trips. Left alone, the city starts jamming on day 3 and locks up around day 3.5 to 4 (a little later than before, because it now starts with proper arterials and lights).
- **Roundabouts on wide roads are a bit bigger,** leaving real ring road between the entrances. Roundabouts everywhere: 470 trips a day with 6 drivers giving up, up from 300 and 70 in this round's first try.
- Saved cities keep the buildings they already have; their new districts come in the new style. Houses remember their lot size (for fences) in the save.
- **Tests:** sim (636 trips a day, 6 gave up), lights everywhere (629 and 15; the test now only adds lights instead of flipping them), roundabouts everywhere (470 and 6), growth, build (0 crossings without a junction), lanes and browser checks pass. The phone hold-then-draw check failed once in five browser runs while the machine was busy with other tests. It couldn't be reproduced, and the test now reports the on-screen message if it fails again.

### Round 9: a more realistic town

The owner's request: find and fix bugs, and make everything look and move more realistically (graphics, driving, people, buildings, landscaping, trees, grass, sky), using real models from outside if needed.

- **About outside models:** the Sketchfab connection in this workspace refused its key ("Invalid API token"), so nothing could be downloaded from there. Free 3D models from other sources were either millions of triangles (photo scans) or cartoon-style, too heavy or too toy-like for thousands of trees and cars on a phone. So the models are still made in code, but much better, and the surfaces now use **real photo textures** (Poly Haven, free CC0): asphalt with tyre marks, concrete sidewalks with joints, red brick, cream limestone blocks, stucco, roof shingles, gravel roofs and lawn grass. All of them together are under 1 MB.
- **Sky:** the old fixed sky photo is gone. A new sky follows the clock: blue by day, orange and pink at sunrise and sunset, deep blue at dusk, a moonlit night with twinkling stars and a moon. Clouds drift across. Reflections on cars and windows come from the same sky, so they turn warm at sunset. The camera can now tilt lower (when zoomed in) to see the skyline against the sky.
- **Sun:** it now rises in the east, passes to the south at noon and sets in the west, like in Texas, so the sides of buildings facing the usual view are lit instead of in shadow.
- **Hill Country on the horizon:** rolling hills with dark cedar patches and pale limestone ring the town, well beyond the furthest district, fading into the haze.
- **Buildings:** brick, limestone or stucco walls (photo textures); houses have white-trimmed windows, a garage door on the driveway side, a front door, some have a stone chimney, and shrubs along the front. Flat roofs have a parapet with a coping, gravel or white membrane with seams, smaller air-conditioning units and skylights on big stores. Shops and town-centre buildings have a canopy over the shopfronts.
- **Yards:** every house has a lawn; back yards have a patio, and about one in five has a swimming pool with a concrete deck. Fences have pickets.
- **Trees:** new live oaks (a short trunk splitting into long limbs under a wide, soft crown) and cedars (dense, dark, irregular). The leaves have light and shade and ragged edges instead of smooth balls, and they sway a little in the wind. Woods far outside town use simpler trees so phones keep up.
- **Grass:** straw-coloured dry patches mixed into the green, greener mowed lawns in yards and parks.
- **Cars:** real car shapes instead of boxes: sedans, hatchbacks, SUVs, pickup trucks with an open bed, delivery vans, box trucks and yellow school buses, with a glass cabin, wheels, mirrors and bumpers.
- **Driving:** the car body now follows its front and rear wheels, so cars swing smoothly through turns and roundabouts instead of turning in steps. Cars pull out from the kerb when they start a trip and pull in to the kerb when they arrive. They use their turn signals (blinking amber) when changing lanes, turning at the next junction, leaving a roundabout, pulling out and pulling in. Brake lights stay on while a car waits. At night headlights light up the road ahead.
- **People:** walkers have arms and legs that swing as they walk, different skin tones, hair, shirts and trousers, and some are children. At a corner they now walk across to the next street instead of jumping.
- **Street details:** traffic lights are now Texas-style mast arms: a pole at the corner with an arm over the road and a signal head (with a yellow-edged backplate) over each lane. Plain junctions have stop signs. Houses have brick mailboxes by the street. Parking lots have tall lights that light the lot at night. Flat-roofed buildings have a cornice. Some of the bigger parks have a pond. Some driveways have a car (or two) parked at home, front shrubs sit in dark mulch beds, and roundabout islands are landscaped with shrubs and limestone boulders. Many of the wider houses have a lower garage wing standing a little forward on the driveway side. Each shop in a strip centre has its own coloured sign panel, and big stores have a large sign over the entrance (plain colours, no real brands). Lane paint looks a little worn.
- **Weather:** each day has its own sky, from clear to partly cloudy, changing gradually through the day. Cloud shadows drift slowly across the town and the countryside, more of them on cloudier days, when the sunlight is a little softer too.
- **Drivers differ:** some keep a little under the limit, some a little over, so traffic no longer moves in lockstep. Trucks and buses pull away more slowly.
- **Stop signs mean something:** at plain junctions drivers slow right down to a careful rolling stop at the line before going on. Where an avenue or a wide road crosses smaller streets, only the side streets have stop signs: the main road carries on at speed (that's how it works in real towns). Turn-taking at plain junctions is still first come, first served.
- **Balance (honest note):** main roads no longer stop at every side street. Left alone, the city still locks up around day 4, though it now varies more from run to run: in four growth-test runs the meter reached 100% at day 3.9, day 3.9 and day 4.3, and once was only at 78% when the test ended (day 4.3). Before this round it reached 100% just before day 4.
- **Roads can't be built out in the hills** ("Too far out of town"), well beyond the last district.
- **Bugs fixed:**
  - After starting a new city (from the menu or after a game over), the green traffic-view bands showed on the map even though the Traffic button was off.
  - Red "jam" circles pulsed at ordinary traffic lights where cars were just waiting for green; they now show only where cars have waited longer than a full cycle of lights.
  - House windows flickered with a grainy pattern (a rounding problem in the window drawing).
  - Driveways and patios could disappear under the lawn when seen from a low angle.
  - Two crashes that the random-play check caught in this round's own new code, both fixed before release: a parked-car colour could be looked up out of range (it would have frozen the game in some cities), and the new stop-sign check could trip over a junction left behind by an undone edit.
  - A road attempt refused as "Too short" could still have split the road it started on without telling the traffic, so cars kept driving on the old road's lanes; it is now fully undone.
  - After dropping a tool, its glowing cursor ring could stay on the map (mostly on phones) until the next touch.
  - Keyboard shortcuts (tools, Space for pause) worked behind the start screen and the menu, so the city could start running unseen; now keys only work in the game itself (Esc closes the menu).
- **Speed:** the city now draws about as many triangles as before on High (0.87 million in a test city, same as before), and about 40% more on Medium (0.9 million against 0.64), despite all the new detail. Woods outside town and parked cars use simpler models to keep it there.
- **Tests:** sim (583 to 615 trips a day, 1 to 16 gave up; before this round 601 to 649 and 0 to 8, it varies run to run), lights everywhere (629 and 8), roundabouts everywhere (442 and 5), growth (see the balance note), build (0 crossings without a junction), lanes and browser checks all pass. The browser check "lights added where wide roads cross" failed once in about eight runs and "phone: hold then drag draws a road" once (a known timing-sensitive check, see round 8); neither could be reproduced (each run builds a different random city). The first now prints the junction's roads if it fails again. A new random-play check (60 random edits with every tool over 8 game days, then save and reload) and a scenario check (roundabout, widen into it, remove it; a one-way dead end; keep going after game over; night switch; save and reload) found no errors.

### Round 10: from a sandbox to a game

The owner's direction: get ready to sell it on Steam, so make it a real game, not a sandbox: start small and grow with coins earned by the townspeople's jobs, upgrade and expand a day at a time; people with names, jobs and bosses you can tap and follow; wrecks with police, fire and ambulance; police that hide and pull people over, chases after robberies and carjackings, reckless drivers and road rage; a better camera and title screen; fix the grass showing through the roads; and take the digging game out completely.

- **The digging game is gone** from this game and from the repository (it can be restored from the history into its own repository at any time).
- **Title screen:** a loading screen with a bar while the photos and fonts load (nothing pops in half-drawn), then the town circling slowly behind a green city-limit sign with the population on it, and Start / Continue, New city, Settings and Credits. Starting flies the camera down to where you left off while the signs slide in. In game, the menu button (or Esc) pauses with Resume, Settings and Save and quit to title.
- **Camera:** the two-finger twist was backwards (the map turned against your fingers); it now turns with them, and the ground under your fingers stays under them while you pinch and twist. A flick keeps the map gliding a moment, the scroll wheel zooms smoothly, double tap zooms in. Close in, the view leans over to show the street fronts (it can't go flat top-down any more), and far out it looks down more.
- **No more grass through the roads** when zoomed out: the depth range now follows the camera's height (it was 2 m to 9 km, too coarse far out), and the ground is drawn just behind everything on it.
- **A small start:** a crossroads village with 10 stretches of road (Main Street, which runs out of town as a highway, and four side streets), five shops and a dozen houses, about 35 people. Older saves can't carry over (the game is different now); the first start is a new town.
- **Coins and businesses:** diner, coffee shop, salon, gas station, auto repair, hardware store, grocery, offices, bank and supermarket, each with its own staff, opening hours, earnings and five levels; police station, fire station and hospital (upkeep, no income). Each has a name on its storefront sign. Goals give coin rewards (collect, upgrade, build a road, open a business, reach 40 people, build a police station, and so on).
- **People:** everyone in town has a name, an age, a home address and (if working) a job title, a workplace, a boss and work hours. They drive to work (late if traffic is bad), walk to lunch, run errands, go for evening walks; you see them walk from the door to their car and from their car in through the door. Visitors pass through or stop to shop.
- **Police, fire and ambulance:** as described above under How it plays. The police scanner lists the calls (10-50 crash, 10-80 pursuit, 10-31 robbery, 10-52 carjacking, 10-57 hit and run, stops, tickets, arrests).
- **Looks:** car bodies are rounder (curved silhouettes, rounded noses and tails, roofs narrower than the body, glossy clear-coat paint, rounder wheels); police SUVs in black and white with light bars, ambulances, fire engines with ladders, all with flashing red and blue lights that wash over the road. Street trees, power poles with sagging wires, fire hydrants, green street-name signs on every corner, speed limit signs, bus shelters, benches, bins and planters at the shops, bollards at the gas pumps, mailbox banks at apartments, clumps of grass and Hill Country wildflowers in the fields, denser woods. Wrecks give off steam, burning cars smoke.
- **Honest notes:** the cars are still made in code (the Sketchfab connection in this workspace still refuses its key, so no outside models could be downloaded; reconnecting it would allow licensed car models). Buildings can be entered by the people in town (they walk in and are listed as inside), and tapping a building shows who's inside; there are no walk-through 3D interiors. A Steam release will also need a desktop wrapper and Steam's own setup, which is a separate step.
- **Tests:** new `life.mjs` (starting town: 10 roads, 17 buildings, staff for every business, trips, walks, earnings, growth after an upgrade) and `law.mjs` (police hide and run radar, a crash answered with sirens and cleared, stops and tickets, a robbery reported, nothing left blocking the road) both pass. The traffic check (597 trips a day, 11 gave up), lanes and build (0 crossings without a junction) checks pass. The browser check was updated for the new game (title screen, small town, building a police station, upgrading, tapping a driver, police heading out, all the road tools, phone gestures) and passes. The phone check first failed because it aimed at a road that was off screen now the camera leans over when zoomed in; the test now centres the camera first.


### Round 11: room to play on a phone, a real follow camera, reporting drivers

The owner's screenshots from a phone: the green sign and the gridlock sign overlapped and took up too much of the screen; following someone, the big card covered the car being followed, and the follow camera wasn't good enough; and there should be a way to report a driver with expired tags and the like so an officer goes out after them.

- **Smaller signs.** On a phone the green sign is now a slim bar: the time, the day, your coins and the goal on one short line. Tap it to show the people, jobs, cars and flow numbers (tap again to hide them). The gridlock sign is a small yellow tag beside it, and they can no longer overlap. On a computer both signs are a little smaller too. The scanner hides while a card is open on a phone.
- **Follow camera.** Follow now flies down behind the person (or their car) and stays there like a chase camera: low, a little ahead of them, swinging round behind as they turn. Drag with one finger to swing the camera round them yourself (it eases back behind after a few seconds), pinch to zoom; neither stops the follow. While following, the card shrinks to just the name, what they're doing and the buttons, at the bottom out of the way. Stop following to get the full card back.
- **Report a driver.** Anyone with expired tags, no insurance or a reckless streak gets a Report button on their card (you need a police station). It goes out on the scanner as a lookout, and the next time they're behind the wheel the nearest free unit goes after them, leaving the station or pulling out of its hiding spot. They're pulled over and ticketed for everything that's wrong (some try to run). If they get home first, the lookout stays on.
- **Fix:** a ticket could list the same offence twice (and charge it twice) when the reason for the stop was also one of the extras.
- **Tests:** the law check now reports a driver and checks a unit is sent after them; it passes, as do life, traffic (595 trips a day, 9 gave up) and the browser check.

### Round 12: parking lots

The owner's screenshot: many of the shops sat between the grass and the road with no parking, which isn't how a Texas town looks.

- **Businesses get a parking lot out front.** Any business you build (and the five you start with) now stands back from the street behind a striped parking lot with head-in stalls, parked cars and a lot light. It's wider than the building where there's room. Gas stations and garages sit a little closer; a supermarket sits far back behind a big lot. Downtown buildings (once the town has a centre) still come right up to the sidewalk, as they do in real towns.
- **Towns saved before this** get lots added in front of their businesses when they load, wherever there's room between the building and the street.
- **Garden apartments** along the main roads get a lot out front too.
- **A lot follows its building,** whatever angle the street runs at. A lot whose building is knocked down goes with it.
- **People drive a little more:** they only walk to work when it's right next door (under about 90 m, it was 140); lunch, errands nearby and evening strolls are still on foot.
- **Tests:** life (29 car trips to work on the first day), law, build, lanes and the browser check pass. The old no-player growth test still locks up on its own around day 3 (it isn't how the game plays any more; it only checks traffic).

### Round 13: picture quality

The owner's screenshots: from a low angle the fields looked glitched and distorted, and the graphics still looked blocky.

- **The grass clumps are gone.** They were flat painted cards standing up in the fields; up close or from a low angle they looked like cardboard cut-outs and made the view look broken. The ground itself now carries the detail instead: greener grass, a finer grass texture close up, clumps and bare patches every few metres, and the dry straw patches further out.
- **Sharper picture on phones:** Medium quality now draws at twice the screen's basic resolution (it was 1.5 times), so edges, signs and road markings are crisp instead of soft and jagged.
- **Things sit on the ground:** a soft contact shadow under every building and every car (they looked pasted on, especially where the sun's shadow falls the other way).
- **Shopfronts:** glass between thin dark aluminium frames with a transom bar, a stone base under the windows, and a darker cornice line along the top of the walls.
- **Roofs:** store roofs were glaring white in the sun; they're now a grey gravel-and-membrane roof with seams, and the copings on top of the walls are darker. Power line wires are a softer grey.
- **The camera** doesn't go quite as low when zoomed in (it could end up skimming across the fields, which is what made the view look distorted).
- **Tests:** the browser check passes (the drawing changes don't touch the traffic, people or police).

