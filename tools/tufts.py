# Builds assets/tufts.png (grass tufts for the meadow and reeds for the banks) from Poly Haven (CC0) grass photos,
# in the layout game.js expects (canvas 1024x512, top-left origin):
#   rows y 0-256:   eight short cells 256x128 (meadow tufts), cell k at x (k % 4) * 256, y (k // 4) * 128
#   row  y 256-512: eight tall cells 128x256 (reeds and tall grass at the water), cell k at x k * 128
# Every sprite stands on the bottom edge of its cell, centred. Transparent pixels carry the nearby colour
# (so the cut-out edges don't go dark in the distance).
#   python3 tools/tufts.py (run from the repo folder) <folder with the 2k jpgs: grass_medium_01_Diffuse/_Alpha, grass_bermuda_01_..., grass_medium_02_...>
import random, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

D = sys.argv[1] if len(sys.argv) > 1 else 'src/'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'assets/tufts.png'
GROUND = 'assets/grass.jpg'   # the meadow ground photo the tufts are colour-matched to
random.seed(11)
W, H = 1024, 512
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
src = {}


def load(name):
    if name not in src:
        d = Image.open(D + name + '_Diffuse.jpg').convert('RGB')
        a = Image.open(D + name + '_Alpha.jpg').convert('L')
        src[name] = (d, a)
    return src[name]


def sprite(name, box):
    # box = (y0, y1, x0, x1) in the 2k photo; keep the biggest piece (neighbours poke in at the edges), trim to it
    d, a = load(name)
    y0, y1, x0, x1 = box
    m = np.array(a.crop((x0, y0, x1, y1)))
    lab, n = ndimage.label(ndimage.binary_dilation(m > 100, iterations=3))
    if n > 1:
        big = 1 + int(np.argmax(ndimage.sum(m > 100, lab, range(1, n + 1))))
        m = np.where(lab == big, m, 0).astype(np.uint8)
    ys, xs = np.nonzero(m > 100)
    c = d.crop((x0, y0, x1, y1)).convert('RGBA'); c.putalpha(Image.fromarray(m))
    return c.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def place(spr, cell, pad=4):
    # scale to fit the cell (keeping its shape), stand it on the bottom edge
    cx, cy, cw, ch = cell
    s = min((cw - 2 * pad) / spr.size[0], (ch - pad) / spr.size[1])
    spr = spr.resize((max(1, round(spr.size[0] * s)), max(1, round(spr.size[1] * s))), Image.LANCZOS)
    atlas.alpha_composite(spr, (cx + (cw - spr.size[0]) // 2, cy + ch - spr.size[1]))


def short(k): return ((k % 4) * 256, (k // 4) * 128, 256, 128)
def tall(k): return (k * 128, 256, 128, 256)


# meadow: the five whole clumps of grass_medium_01, three small grass plants of grass_bermuda_01
M1, BE, M2 = 'grass_medium_01', 'grass_bermuda_01', 'grass_medium_02'
# (the clumps are cut at their base: below it the photo sheet has smeared stubs)
for k, (name, box) in enumerate([(M1, (1514, 1806, 396, 1000)), (M1, (1544, 1747, 1175, 1650)), (M1, (1778, 1995, 55, 412)),
                                 (M1, (1815, 2004, 484, 1029)), (M1, (1775, 2028, 1160, 1625)), (BE, (733, 1125, 1098, 1472)),
                                 (BE, (653, 1127, 1588, 1922)), (BE, (824, 1107, 568, 947))]):
    place(sprite(name, box), short(k))

# water's edge: four tall grass plants, one tall tuft, and three reed clumps fanned from long single blades
for k, box in enumerate([(1390, 2026, 92, 354), (1285, 2024, 466, 794), (1399, 2034, 861, 1264), (1357, 2033, 1424, 1776), (56, 643, 724, 969)]):
    place(sprite(BE, box), tall(k))
BLADES = [sprite(M2, b) for b in [(29, 1981, 60, 360), (332, 1996, 299, 618), (470, 1493, 733, 839), (346, 1835, 1368, 1702), (42, 2048, 1754, 2012)]]
for k in (5, 6, 7):
    x0, y0, cw, ch = tall(k)
    cell = Image.new('RGBA', (cw * 2, ch * 2), (0, 0, 0, 0))   # drawn at twice the size, then shrunk (smoother)
    for i in range(9):
        b = random.choice(BLADES)
        hgt = random.uniform(.6, 1.0) * ch * 2 - 8
        b = b.resize((max(1, round(b.size[0] * hgt / b.size[1])), round(hgt)), Image.LANCZOS)
        if random.random() < .5: b = b.transpose(Image.FLIP_LEFT_RIGHT)
        # stand the blade with its foot near the middle of the bottom edge, then lean it about the foot
        fx = int(cw + random.uniform(-14, 14))
        layer = Image.new('RGBA', cell.size, (0, 0, 0, 0)); layer.paste(b, (fx - b.size[0] // 2, ch * 2 - b.size[1]), b)
        cell.alpha_composite(layer.rotate(random.uniform(-14, 14), resample=Image.BICUBIC, center=(fx, ch * 2 - 1)))
    atlas.alpha_composite(cell.resize((cw, ch), Image.LANCZOS), (x0, y0))

# colour-match to the meadow: the photos are yellower than the (colour-corrected) ground photo, so each half of the
# sheet gets the gains that bring its average to the ground's, a touch lighter (blades catch more light than the turf)
ground = np.array(Image.open(GROUND).convert('RGB')).reshape(-1, 3).astype(np.float32).mean(0)
arr = np.array(atlas).astype(np.float32)
for y0, y1 in ((0, 256), (256, 512)):
    part = arr[y0:y1]; m = part[..., 3] > 128
    gain = ground * 1.08 / part[m][:, :3].mean(0)
    part[..., :3] = np.clip(part[..., :3] * gain, 0, 255)
atlas = Image.fromarray(arr.astype(np.uint8), 'RGBA')

# bleed colour into the see-through pixels: blur colour weighted by alpha, a few times wider each pass
a = np.array(atlas).astype(np.float32)
rgb, al = a[..., :3], a[..., 3:] / 255
fill = rgb * al; wsum = al.copy()
for r in (2, 6, 16, 40):
    f = np.stack([ndimage.gaussian_filter(fill[..., c], r) for c in range(3)], -1)
    w = ndimage.gaussian_filter(wsum[..., 0], r)[..., None]
    rgb = np.where(al > .02, rgb, np.where(w > 1e-4, f / np.maximum(w, 1e-4), rgb))
    fill = rgb * np.maximum(al, (w > 1e-4) * .02); wsum = np.maximum(al, (w > 1e-4) * .02)
out = np.concatenate([np.clip(rgb, 0, 255), a[..., 3:]], -1).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(OUT, optimize=True)
print('ok', OUT)
