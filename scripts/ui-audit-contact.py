"""Arrange genuine captures for human audit; never draws product assets."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/qa/ui-audit-20261010'
PRIVATE=ROOT/'.expo-export-check/ui-audit-20261010'
p=argparse.ArgumentParser();p.add_argument('group',choices=['main','matrix','flows','logo']);a=p.parse_args()
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',17)
if a.group=='main':
    names=[s['key'] for s in json.loads((ROOT/'docs/qa/ui-redraw-20261010/manifest.json').read_text(encoding='utf-8'))['states']]
    paths=[OUT/'after/actual'/f'{n}.png' for n in names]
elif a.group=='matrix':
    paths=[x for x in sorted((OUT/'after/actual').glob('*.png')) if x.stem.startswith(('font125','small130','light'))]
elif a.group=='flows':
    prefixes=('history-more','legacy-','privacy-section','settings-help','diagnostic-config','poster-template','backup-','share-copy-','no-building','empty-filter')
    paths=[x for x in sorted((OUT/'after/actual').glob('*.png')) if x.stem.startswith(prefixes)]
else:
    paths=list(sorted((OUT/'release/launch-frames').glob('*.png')))+list((OUT/'release/actual').glob('release-launcher.png'))
for i in range(0,len(paths),6):
    items=paths[i:i+6];canvas=Image.new('RGB',(1170,1760),'#302920');d=ImageDraw.Draw(canvas)
    for j,path in enumerate(items):
        img=Image.open(path).convert('RGB');img.thumbnail((378,824))
        x=(j%3)*390;y=(j//3)*880
        d.text((x+8,y+8),path.stem,font=font,fill='#ffffff')
        canvas.paste(img,(x+(390-img.width)//2,y+40))
    target=PRIVATE/f'final-{a.group}-{i//6+1}.png';canvas.save(target);print(target)
