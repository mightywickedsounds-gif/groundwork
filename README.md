# Flowtown

A traffic game you play in the browser. A city keeps growing on its own, full of cars, buses, trucks and people heading to work, home and the shops. You fly above it with magic tools and reshape the streets so traffic keeps moving. If the jams get bad enough for long enough, the city locks up.

Play it here (from `main`, once merged): https://mightywickedsounds-gif.github.io/groundwork/

The old digging game still works at https://mightywickedsounds-gif.github.io/groundwork/dig/ (also linked from the menu).

## How it plays

- **The city grows by itself.** It starts with three districts. Every few in-game hours a new district opens at the edge with its own streets, homes, offices, shops, parks and parking lots. More people means more cars.
- **Everyone has somewhere to be.** People drive from home to work in the morning rush (around 8:00), run errands at midday and drive home in the evening rush (around 17:30). Each driver picks the quickest route and switches to another way when they're stuck.
- **Real traffic rules.** Cars keep their distance, slow for turns, queue at junctions and don't block a junction they can't get out of. Plain junctions work first come, first served. Traffic lights switch between directions and end a green early when nobody is waiting. At roundabouts, entering cars give way to cars already on the ring.
- **Gridlock meter (top right).** It rises while lots of drivers are stuck and when drivers give up. It falls again when traffic flows. At 100% the city locks up and the game ends (you can keep fixing it or start a new city). Red pulsing circles show the worst junctions.
- **Day and night.** The sun moves through the day; at night windows, headlights, tail lights and street lights come on.

## Your tools

| Tool | Key | What it does |
|---|---|---|
| Road | 1 | Phone: drag a finger to draw a road; tap to keep going from the yellow pin. Computer: click to start, click to place; it keeps going from the end. Crossing a road makes a junction; ending near a road joins it. |
| Curve | 2 | Phone: drag to draw it, then drag to bend it. Computer: click the start, click the end, move to bend, click. |
| Lights | 3 | Click a junction to add or remove traffic lights. |
| Round | 4 | Tap a junction, a bend or any stretch of road to put a roundabout there. It sizes itself to fit and clears the buildings in the way. A road drawn through a roundabout joins it. |
| One-way | 5 | Click a road: two-way, then one way, then the other way. |
| Remove | 6 | Click a road to remove it, or the middle of a roundabout to turn it back into a junction. |
| Traffic view | T | Colours every lane green (moving) to red (jammed). |

Any road you build through buildings or trees clears them.

## Controls

| | Computer | Phone |
|---|---|---|
| Move | Drag, or W A S D | Drag (two fingers while drawing roads) |
| Turn and tilt | Right-drag, or Q E and R F | Two fingers (twist to turn, slide up/down to tilt) |
| Zoom | Scroll, or Z X | Pinch |
| Use a tool | Click | Tap |
| Drop the tool | Esc, or right-click | Tap the tool again |
| Pause / speed | Space, the speed buttons | Speed buttons |

The game saves in your browser every 10 seconds and when you leave. Menu → Graphics switches High / Medium / Low (phones start on Medium). Menu → Night on/off: with night off the sun never sets.

## Files

- `index.html`: the page (screen layout, buttons, menus)
- `game.js`: the game (camera, tools, day and night, the gridlock meter, saving, sound)
- `net.js`: the road network and the traffic (lanes, junction rules, lights, roundabouts, route finding, car following)
- `city.js`: the city (street plan, districts, buildings, trips)
- `draw.js`: everything you see (roads, curbs, sidewalks, markings, buildings with windows, trees, cars, people, lights)
- `assets/`: grass photo and sky lighting (Poly Haven, CC0); `assets/fonts/` Overpass, a highway-sign style typeface (SIL Open Font License, see `LICENSE.txt`)
- `tests/`: automatic checks (see below)
- `dig/`: the old digging game, unchanged

## Testing

- `node tests/sim.mjs [districts] [hours]` runs the traffic with no browser and reports trips, stuck cars and why they're stuck. `MODE=sig` puts lights on every junction, `MODE=ring` makes every junction a roundabout.
- `node tests/grow.mjs [days]` lets the city grow with no help from the player and prints the gridlock meter over time.
- `node tests/build.mjs [tries]` builds hundreds of random roads, curves and roundabouts and checks no road ever crosses another without a junction.
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
