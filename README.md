# Groundwork

A digging game you play in the browser. Drive a dozer, loader, excavator and dump truck around a forested valley, cut and pile real ground, reroute the river and finish paid jobs. **Nothing ever resets:** every hole, pile and channel stays where you left it, even after you close the page.

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
- `game.js`: the game (ground, water, machines, jobs, saving). Uses three.js 0.160 for the 3D, loaded from jsDelivr.
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
- the phone layout works;
- no script errors.

## History

### Round 1: the game

Built as a game in the same genre as a construction-sandbox reel the owner liked, with our own name, look and machines (it doesn't copy that game). All 10 gameplay checks pass.
