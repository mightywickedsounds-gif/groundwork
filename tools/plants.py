# Builds assets/plants.png: eight wild plants assembled from Poly Haven (CC0) photographed plant parts, side views
# standing on the bottom edge of 256x256 cells (canvas 1024x512, cell k at x (k % 4) * 256, y (k // 4) * 256):
#   0, 1 fern clumps   2 dandelions   3 lesser celandine   4 wood sorrel   5 small leafy bush   6 nettles   7 dock
# Transparent pixels carry the nearby colour (no dark fringes in the distance), as in tools/tufts.py.
#   python3 tools/plants.py <folder with the 2k <name>_Diffuse.jpg / _Alpha.jpg of fern_02, dandelion_01,
#                            celandine_01, shrub_03, shrub_sorrel_01, nettle_plant, weed_plant_02> [out.png]
import math, random, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

D = sys.argv[1] if len(sys.argv) > 1 else 'src/'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'assets/plants.png'
src = {}


def load(name):
    if name not in src:
        d = Image.open(D + name + '_Diffuse.jpg').convert('RGB')
        a = Image.open(D + name + '_Alpha.jpg').convert('L').resize(d.size)
        src[name] = (d, a)
    return src[name]


def part(name, box, whole=False):
    # box = (y0, y1, x0, x1) in the 2k photo; keep the biggest piece unless whole (a flower made of loose petals)
    d, a = load(name)
    y0, y1, x0, x1 = box
    m = np.array(a.crop((x0, y0, x1, y1)))
    if not whole:
        lab, n = ndimage.label(m > 100)
        if n > 1:
            big = 1 + int(np.argmax(ndimage.sum(m > 100, lab, range(1, n + 1))))
            m = np.where(ndimage.binary_dilation(lab == big, iterations=2), m, 0).astype(np.uint8)
    ys, xs = np.nonzero(m > 100)
    c = d.crop((x0, y0, x1, y1)).convert('RGBA'); c.putalpha(Image.fromarray(m))
    return c.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def shade(im, k, warm=0.):
    a = np.array(im).astype(np.float32)
    a[..., :3] *= k
    a[..., 0] *= 1 + warm; a[..., 2] *= 1 - warm
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def stand(cell, spr, foot, length, angle, k=1., warm=0., anchor='bottom'):
    # draw spr scaled to `length` along its long axis, its foot (bottom middle) at `foot`, leaning `angle` degrees
    sc = length / spr.size[1]
    s = spr.resize((max(1, round(spr.size[0] * sc)), max(1, round(length))), Image.LANCZOS)
    s = shade(s, k, warm)
    layer = Image.new('RGBA', cell.size, (0, 0, 0, 0))
    fx, fy = foot
    if anchor == 'bottom': layer.paste(s, (int(fx - s.size[0] / 2), int(fy - s.size[1])), s)
    else: layer.paste(s, (int(fx - s.size[0] / 2), int(fy - s.size[1] / 2)), s)
    cell.alpha_composite(layer.rotate(angle, resample=Image.BICUBIC, center=(fx, fy)))


def stem(cell, x0, y0, x1, y1, w, col):
    g = ImageDraw.Draw(cell)
    mx, my = (x0 + x1) / 2 + (y1 - y0) * .06, (y0 + y1) / 2
    pts = [(x0 + (mx - x0) * t * 2 if t < .5 else mx + (x1 - mx) * (t - .5) * 2, y0 + (y1 - y0) * t) for t in [i / 12 for i in range(13)]]
    g.line(pts, fill=col, width=w, joint='curve')


S2 = 512   # cells are drawn at twice the size and shrunk (smoother edges)
FERN = [part('fern_02', b) for b in [(49, 1565, 640, 934), (53, 1026, 1038, 1351), (221, 1836, 1460, 1716), (227, 1945, 179, 483), (1044, 1979, 1047, 1289)]]
DHEAD = [part('dandelion_01', b) for b in [(38, 500, 1648, 2048), (42, 524, 1184, 1613)]]
DLEAF = [part('dandelion_01', (376, 1634, 400, 825))]
CFLOW = [part('celandine_01', b) for b in [(1516, 1786, 580, 837), (1671, 1895, 936, 1151), (1692, 1958, 136, 385)]]
SLEAF = [part('shrub_sorrel_01', b) for b in [(37, 741, 9, 798), (39, 799, 928, 1766), (875, 1635, 36, 874)]]
SFLOW = part('shrub_sorrel_01', (875, 1563, 963, 1653), whole=True)
BLEAF = [part('shrub_03', b) for b in [(81, 607, 108, 543), (245, 725, 649, 1059), (635, 1327, 62, 639), (776, 1213, 860, 1251), (1235, 1911, 977, 1535), (1280, 1567, 612, 823), (1379, 1847, 101, 498)]]
NLEAF = [part('nettle_plant', b) for b in [(601, 1040, 8, 669), (1146, 1483, 37, 734), (1533, 1832, 55, 551), (562, 1061, 1611, 1945), (854, 1260, 572, 886), (667, 1182, 1025, 1345)]]
DOCK = [part('weed_plant_02', b) for b in [(326, 1596, 1534, 2023), (0, 1185, 20, 515), (998, 1595, 290, 1768), (1560, 2042, 695, 2048), (0, 591, 485, 1730)]]
# leaves photographed lying sideways: turn them upright (stalk at the bottom)
DOCK = [d if d.size[1] >= d.size[0] else d.rotate(-90, expand=True) for d in DOCK]


def fern(seed):
    random.seed(seed); c = Image.new('RGBA', (S2, S2), (0, 0, 0, 0))
    n = 11
    angs = sorted([random.uniform(-72, 72) for _ in range(n)], key=lambda a: -abs(a))   # outer fronds first (behind)
    for a in angs:
        ln = (1 - abs(a) / 110) * random.uniform(360, 470)
        stand(c, random.choice(FERN), (S2 / 2 + random.uniform(-14, 14), S2 - 4), ln, a, k=random.uniform(.75, 1.1) * (.85 + .15 * (1 - abs(a) / 72)))
    return c


def dandelion(seed):
    random.seed(seed); c = Image.new('RGBA', (S2, S2), (0, 0, 0, 0))
    for _ in range(9):   # the rosette, low and spreading
        a = random.choice([-1, 1]) * random.uniform(45, 80)
        stand(c, DLEAF[0], (S2 / 2 + random.uniform(-10, 10), S2 - 4), random.uniform(150, 230), a, k=random.uniform(.8, 1.05))
    for _ in range(random.randint(3, 4)):
        top = random.uniform(150, 290); tx = S2 / 2 + random.uniform(-90, 90)
        stem(c, S2 / 2 + random.uniform(-12, 12), S2 - 6, tx, top, 5, (118, 128, 70, 255))
        h = random.choice(DHEAD); s = random.uniform(70, 95)
        stand(c, h, (tx, top), s, random.uniform(-15, 15), anchor='middle')
    return c


def flowers(seed, fl, leaves, nf, lo, hi, fsize):
    random.seed(seed); c = Image.new('RGBA', (S2, S2), (0, 0, 0, 0))
    for _ in range(12):
        a = random.uniform(-70, 70)
        x = S2 / 2 + random.uniform(-95, 95)
        stand(c, random.choice(leaves), (x, S2 - 4), random.uniform(80, 130), a, k=random.uniform(.75, 1.05))
    for _ in range(nf):
        x0 = S2 / 2 + random.uniform(-100, 100); top = random.uniform(lo, hi); tx = x0 + random.uniform(-30, 30)
        stem(c, x0, S2 - 6, tx, top, 4, (100, 120, 60, 255))
        f = fl if not isinstance(fl, list) else random.choice(fl)
        stand(c, f, (tx, top), random.uniform(*fsize), random.uniform(-25, 25), anchor='middle')
    return c


def bush(seed):
    random.seed(seed); c = Image.new('RGBA', (S2, S2), (0, 0, 0, 0))
    g = ImageDraw.Draw(c)
    for _ in range(9):   # a few woody stems
        tx = S2 / 2 + random.uniform(-170, 170); ty = random.uniform(130, 300)
        g.line([(S2 / 2 + random.uniform(-15, 15), S2 - 2), (tx, ty)], fill=(78, 62, 45, 255), width=6)
    for i in range(260):   # leaves over an uneven dome, darker inside and lower down
        t = i / 260
        a = random.uniform(0, math.pi); r = math.sqrt(random.random())
        bump = 1 + .18 * math.sin(a * 5 + seed) + .1 * math.sin(a * 11)
        x = S2 / 2 + math.cos(a) * r * 200 * bump; y = S2 - 26 - math.sin(a) * r * 360 * bump
        k = (.5 + .55 * t) * (.8 + .2 * r)
        leaf = shade(random.choice(BLEAF), 1, -.08)
        a2 = np.array(leaf).astype(np.float32); a2[..., 0] *= .78; a2[..., 2] *= .72
        stand(c, Image.fromarray(np.clip(a2, 0, 255).astype(np.uint8), 'RGBA'), (x, y), random.uniform(34, 52), random.uniform(0, 360), k=k, anchor='middle')
    return c


def nettle(seed):
    random.seed(seed); c = Image.new('RGBA', (S2, S2), (0, 0, 0, 0))
    for _ in range(4):
        x = S2 / 2 + random.uniform(-75, 75); top = random.uniform(70, 140)
        stem(c, x, S2 - 4, x + random.uniform(-20, 20), top, 6, (92, 104, 58, 255))
        n = 6
        for q in range(n):
            t = q / n; y = S2 - 60 - (S2 - 60 - top) * t; size = 120 - t * 70
            for side in (-1, 1):
                stand(c, random.choice(NLEAF), (x, y), size, side * random.uniform(50, 80), k=random.uniform(.75, 1.05))
    return c


def dock(seed):
    random.seed(seed); c = Image.new('RGBA', (S2, S2), (0, 0, 0, 0))
    for _ in range(9):
        a = random.uniform(-65, 65)
        stand(c, random.choice(DOCK), (S2 / 2 + random.uniform(-12, 12), S2 - 4), random.uniform(260, 400) * (1 - abs(a) / 160), a, k=random.uniform(.75, 1.05))
    return c


cells = [fern(1), fern(2), dandelion(3),
         flowers(4, CFLOW, SLEAF[:1] + DLEAF, 9, 300, 400, (45, 62)),            # celandine: low leaves, yellow stars
         flowers(5, SFLOW, SLEAF, 4, 330, 420, (55, 75)),                      # wood sorrel: clover leaves, pink flowers
         bush(6), nettle(7), dock(8)]
atlas = Image.new('RGBA', (1024, 512), (0, 0, 0, 0))
for k, cimg in enumerate(cells):
    atlas.alpha_composite(cimg.resize((256, 256), Image.LANCZOS), ((k % 4) * 256, (k // 4) * 256))

# bleed colour into the see-through pixels
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
