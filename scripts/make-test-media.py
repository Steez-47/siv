# Generates test-media/ (gitignored): a folder of varied images for trying SIV.
#   python scripts/make-test-media.py
import math, os, random
from PIL import Image, ImageDraw

out = os.path.join(os.path.dirname(__file__), "..", "test-media")
os.makedirs(out, exist_ok=True)

def scene(w, h, seed, title):
    random.seed(seed)
    im = Image.new("RGB", (w, h))
    px = im.load()
    a, b = random.random() * 6, random.random() * 6
    for y in range(0, h):
        for x in range(0, w):
            u, v = x / w, y / h
            r = int(128 + 127 * math.sin(u * 6 + a))
            g = int(128 + 127 * math.sin(v * 5 + b + u * 2))
            bl = int(128 + 127 * math.cos((u + v) * 4 + a * b))
            px[x, y] = (r, g, bl)
    d = ImageDraw.Draw(im)
    for i in range(14):
        cx, cy, rr = random.randint(0, w), random.randint(0, h), random.randint(w // 30, w // 8)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=tuple(random.randint(0, 255) for _ in range(3)), outline=(255, 255, 255), width=max(1, w // 400))
    for i in range(0, w, max(8, w // 48)):
        d.line((i, 0, i, h), fill=(0, 0, 0), width=1)
    d.rectangle((w // 20, h // 20, w // 20 + w // 3, h // 20 + h // 9), fill=(0, 0, 0))
    d.text((w // 20 + 12, h // 20 + 10), title, fill=(255, 255, 255))
    return im

big = scene(1600, 1066, 1, "01 landscape JPEG 6000x4000 (upscaled)").resize((6000, 4000), Image.BICUBIC)
big.save(os.path.join(out, "01 landscape.jpg"), quality=92)
scene(1200, 1600, 2, "02 portrait").save(os.path.join(out, "02 portrait.jpg"), quality=90)
# EXIF orientation 6 (stored landscape, displays portrait)
o = scene(1600, 1200, 3, "03 EXIF rotated: should look PORTRAIT, text upright after rotation")
ex = Image.Exif(); ex[0x0112] = 6; ex[0x010F] = "Steez"; ex[0x0110] = "Steez Cam 1"
o.save(os.path.join(out, "03 exif-rotated.jpg"), quality=90, exif=ex.tobytes())
# PNG with alpha
p = Image.new("RGBA", (900, 900), (0, 0, 0, 0)); d = ImageDraw.Draw(p)
d.ellipse((100, 100, 800, 800), fill=(255, 120, 40, 230)); d.rectangle((300, 300, 600, 600), fill=(40, 160, 255, 140))
p.save(os.path.join(out, "04 transparent.png"))
scene(1000, 700, 5, "05 webp").save(os.path.join(out, "05 colors.webp"), quality=90)
scene(1400, 900, 6, "06 tiff (converted by Rust)").save(os.path.join(out, "06 scan.tiff"))
scene(64, 48, 7, "7").save(os.path.join(out, "07 tiny.png"))
scene(1920, 1080, 8, "08 compare A").save(os.path.join(out, "08 compare A.png"))
scene(1920, 1080, 8, "08 compare A").save(os.path.join(out, "09 compare B.jpg"), quality=20)
scene(800, 600, 10, "10 targa").save(os.path.join(out, "10 legacy.tga"))
print("wrote", out)
