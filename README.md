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
| Road | 1 | Click to start, click to place. Keeps going from where you stopped. Crossing a road makes a junction. |
| Curve | 2 | Click the start, then the bend, then the end. |
| Lights | 3 | Click a junction to add or remove traffic lights. |
| Round | 4 | Click a junction to turn it into a roundabout (it clears the corner buildings in the way). |
| One-way | 5 | Click a road: two-way, then one way, then the other way. |
| Remove | 6 | Click a road to remove it, or the middle of a roundabout to turn it back into a junction. |
| Traffic view | T | Colours every lane green (moving) to red (jammed). |

Any road you build through buildings or trees clears them.

## Controls

| | Computer | Phone |
|---|---|---|
| Move | Drag, or W A S D | Drag |
| Turn and tilt | Right-drag, or Q E and R F | Two fingers (twist to turn, slide up/down to tilt) |
| Zoom | Scroll, or Z X | Pinch |
| Use a tool | Click | Tap |
| Drop the tool | Esc, or right-click | Tap the tool again |
| Pause / speed | Space, the speed buttons | Speed buttons |

The game saves in your browser every 10 seconds and when you leave. Menu → Graphics switches High / Medium / Low (phones start on Medium).

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
- `node tests/play.cjs [folder]` opens the game in a hidden browser, checks the tools work and saves screenshots.

## History

### Round 1: new direction (traffic game)

The digging game moved to `dig/` (its saves still work). The new game was built from scratch:

- Traffic simulation: each car follows the one ahead smoothly, slows for bends, and waits at junctions until it's its turn and there's room on the other side. Lights adapt to waiting cars. Roundabouts give priority to the ring and stop letting cars in when the ring is nearly full (without that, a full ring locked up completely).
- Test results (no player help): with 3 districts the roads clear every night with almost no drivers giving up. Left alone, the growing city starts jamming on day 3 and locks up near the end of day 3, so the player has to step in around day 2. Lights or roundabouts on every single junction do not beat the plain junctions overall (roundabouts everywhere also knock down 86 buildings); they help where they're placed well, which is the game.
- Speed: one simulation step with 1,400 cars takes about 2-8 ms.

### Round 2: new look for the screen

The see-through panels and floating text are gone. The screen now looks like road signs: a green guide sign (time, day, people, cars, flow, average trip, next district), a yellow warning sign for the gridlock meter (striped fill when it gets bad), a solid asphalt-dark tool dock with yellow for the selected tool and speed, white sign pop-ups (red for "can't do that"), a green sign start screen and a red stop-sign game-over screen. Type is Overpass (modelled on highway signs), served from the site itself. Phones get a two-row dock and shorter labels.
