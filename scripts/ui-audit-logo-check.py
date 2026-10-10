"""Pixel QA and mask previews, without editing the source artwork."""
from collections import Counter
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/ui-audit-20261010'
im = Image.open(ROOT/'assets/brand/audit-adaptive.png').convert('RGBA')
points = [(x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))[3]>128]
r = max(math.hypot(x-im.width/2,y-im.height/2) for x,y in points)
colors = Counter(pixel[:3] for pixel in im.getdata() if pixel[3] == 255)
check = {'canvas':im.size, 'alphaBounds':im.getchannel('A').getbbox(), 'maxRadiusPx':r,
    'safeCircleRadiusPx':im.width*66/108/2, 'withinSafeCircle':r < im.width*66/108/2,
    'opaqueColors': [{'rgb':c, 'pixels':n} for c,n in colors.items()],
    'flatOrange':list(colors)==[(255,122,46)], 'previewSizesPx':[24,32,48,96],
    'geometrySource':'ImageGen; no icon geometry drawn in code'}
assert check['withinSafeCircle'], check
assert check['flatOrange'], check
canvas = Image.new('RGB',(760,430),'#343230');d=ImageDraw.Draw(canvas)
for i,shape in enumerate(['circle','rounded-square','square']):
    # Android foreground is 108dp, clipped to a nominal 72dp launcher mask.
    fg = im.resize((270,270),Image.Resampling.LANCZOS).crop((45,45,225,225))
    tile = Image.new('RGBA',(180,180),'#11100F');tile.alpha_composite(fg)
    mask = Image.new('L',(180,180));md=ImageDraw.Draw(mask)
    if shape=='circle':md.ellipse((0,0,179,179),fill=255)
    elif shape=='rounded-square':md.rounded_rectangle((0,0,179,179),radius=44,fill=255)
    else:md.rectangle((0,0,179,179),fill=255)
    canvas.paste(tile,(30+i*250,40),mask);d.text((30+i*250,230),shape,fill='white')
mark = Image.open(ROOT/'assets/brand/mark-audit.png').convert('RGBA')
for i,size in enumerate([24,32,48,96]):
    v=mark.copy();v.thumbnail((size,size));canvas.paste(v,(40+i*150,300),v)
    d.text((40+i*150,410),str(size)+' px',fill='white')
canvas.save(OUT/'logo-preview.png')
(OUT/'logo-checks.json').write_text(json.dumps(check,indent=2),encoding='utf-8')
print(json.dumps(check))
