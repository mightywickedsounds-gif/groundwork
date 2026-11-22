# Builds assets/foliage.png from the Poly Haven (CC0) fir twig and leaf photos, in the layout models.js expects:
#   u 0-.5  v .5-1  (canvas x 0-512,  y 0-256):   spruce branch A, twig along +x, trunk end at the left
#   u 0-.5  v 0-.5  (canvas x 0-512,  y 256-512): branch B, denser
#   u .5-.75        (canvas x 512-768, full height): a whole spruce seen from the side
#   u .75-1 v .5-1 / v 0-.5 (canvas x 768-1024, top / bottom): two leaf clumps
import random, sys
from PIL import Image, ImageEnhance
import numpy as np

D = sys.argv[1] if len(sys.argv) > 1 else 'src/'   # folder with Poly Haven's fir_tree_01 twig_diff/twig_alpha and tree_small_02 leaves_diff/leaves_alpha 1k jpgs
OUT = 'assets/foliage.png'
random.seed(7)


def sprites(diff, alpha, boxes, grow=0):
    d = Image.open(D + diff + '.jpg').convert('RGB')
    a = Image.open(D + alpha + '.jpg').convert('L')
    out = []
    for (y0, y1, x0, x1) in boxes:
        c = d.crop((x0, y0, x1, y1)).convert('RGBA')
        m = np.array(a.crop((x0, y0, x1, y1)))
        # keep only the biggest piece in the box (neighbouring twigs poke in at the edges)
        from scipy import ndimage
        lab, n = ndimage.label(m > 128)
        if n > 1:
            big = 1 + int(np.argmax(ndimage.sum(m > 128, lab, range(1, n + 1))))
            keep = ndimage.binary_dilation(lab == big, iterations=2)
            m = np.where(keep, m, 0).astype(np.uint8)
        from PIL import ImageFilter
        mm = Image.fromarray(m)
        if grow: mm = mm.filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(.6))
        c.putalpha(mm)
        out.append(c)
    return out


# fir sprigs point up in the photo (stem at the bottom)
FIR = sprites('fir_tree_01_twig_diff', 'fir_tree_01_twig_alpha',
              [(410, 794, 313, 660), (463, 850, 650, 975), (53, 378, 669, 960), (48, 319, 194, 426), (266, 409, 506, 646)], grow=3)
LEAF = sprites('tree_small_02_leaves_diff', 'tree_small_02_leaves_alpha',
               [(0, 306, 0, 392), (309, 575, 0, 241), (716, 874, 53, 259), (766, 894, 240, 453), (866, 1024, 0, 233)])

W, H = 1024, 512
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))


def tint(im, k):
    rgb = ImageEnhance.Brightness(im.convert('RGB')).enhance(k)
    rgb = rgb.convert('RGBA'); rgb.putalpha(im.getchannel('A')); return rgb


def put(dst, spr, cx, cy, size, angle, bright=1.0, clip=None):
    s = spr.copy()
    sc = size / max(s.size)
    s = s.resize((max(1, int(s.size[0] * sc)), max(1, int(s.size[1] * sc))), Image.LANCZOS)
    s = tint(s, bright)
    s = s.rotate(angle, resample=Image.BICUBIC, expand=True)
    x, y = int(cx - s.size[0] / 2), int(cy - s.size[1] / 2)
    layer = Image.new('RGBA', dst.size, (0, 0, 0, 0)); layer.paste(s, (x, y), s)
    if clip:
        m = Image.new('L', dst.size, 0); m.paste(255, clip)
        layer.putalpha(Image.fromarray(np.minimum(np.array(layer.getchannel('A')), np.array(m))))
    dst.alpha_composite(layer)


def branch(y0, dense):
    box = (0, y0, 512, y0 + 256)
    cy = y0 + 128
    n = 17 if dense else 12
    for i in range(n):
        t = (i + .5) / n
        x = 40 + t * 430
        size = 110 + t * 170 + random.uniform(-20, 20)
        # sprigs point up in the photo; rotate so they point along +x (tip to the right), fanning a little up and down
        ang = -90 + random.uniform(-28, 28)
        put(atlas, FIR[random.randrange(4)], x, cy + random.uniform(-26, 26) * t, size, ang, random.uniform(.85, 1.25), box)
    # the twig itself
    for x in range(4, 470):
        for dy in (-1, 0, 1):
            atlas.putpixel((x, cy + dy), (72, 55, 38, 255)) if atlas.getpixel((x, cy + dy))[3] < 200 else None


branch(0, False)
branch(256, True)

# whole spruce from the side: sprigs from top to bottom, wider lower down, drooping outwards
box = (512, 0, 768, 512)
for i in range(230):
    t = (i / 230) ** .85
    y = 14 + t * 470
    half = 8 + t * 112
    side = -1 if i % 2 else 1
    x = 640 + side * random.uniform(.15, .75) * half
    size = 50 + t * 90
    ang = side * random.uniform(55, 95)   # pointing out and a little down
    put(atlas, FIR[random.randrange(4)], x, y, size, ang, random.uniform(.75, 1.15), box)
for y in range(20, 500):
    for dx in (-1, 0, 1):
        if atlas.getpixel((640 + dx, y))[3] < 120: atlas.putpixel((640 + dx, y), (66, 50, 35, 255))

# leaf clumps: sprigs fanned round a centre
for (cx, cy, seed) in [(896, 128, 1), (896, 384, 2)]:
    random.seed(seed * 31)
    box = (768, cy - 128, 1024, cy + 128)
    for i in range(26):
        a = random.uniform(0, 360)
        r = random.uniform(0, 70)
        x = cx + np.cos(np.radians(a)) * r
        y = cy + np.sin(np.radians(a)) * r * .9
        put(atlas, LEAF[random.randrange(5)], x, y, random.uniform(90, 140), random.uniform(0, 360), random.uniform(.7, 1.1), box)

atlas.save(OUT, optimize=True)
print('ok', atlas.size)
