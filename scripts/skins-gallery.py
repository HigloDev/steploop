"""Build a portable gallery and contact sheets from actual native QA frames."""
import html
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/skins'
EVIDENCE = DOC / 'evidence/20261028'
registry = json.loads((DOC / 'registry.json').read_text(encoding='utf-8'))
skins = registry['skins']
pages = [('home', '首页'), ('climbing', '训练中'), ('summary', '训练完成')]
font_file = Path('C:/Windows/Fonts/msyh.ttc')
bold_file = Path('C:/Windows/Fonts/msyhbd.ttc')
def font(size, bold=False):
    candidate = bold_file if bold else font_file
    return ImageFont.truetype(str(candidate), size) if candidate.exists() else ImageFont.load_default(size=size)

inventory = []
for skin in skins:
    board = Image.new('RGB', (1020, 1645), '#EDF1F6')
    draw = ImageDraw.Draw(board)
    draw.text((24, 18), skin['name'], font=font(30, True), fill='#152239')
    draw.text((24, 62), '1.1.5 基线 · 开发分支 · Android 实际页面 · 合成训练数据', font=font(16), fill='#526176')
    for row, mode in enumerate(['light', 'dark']):
        for col, (page, label) in enumerate(pages):
            name = f'{skin["id"]}-{mode}-{page}.png'
            file = EVIDENCE / name
            assert file.exists(), 'Missing native frame: ' + name
            image = Image.open(file).convert('RGB')
            inventory.append({'file': name, 'size': list(image.size), 'skin': skin['id'], 'mode': mode, 'screen': page})
            thumb = image.resize((316, 702), Image.Resampling.LANCZOS)
            x, y = 20 + col * 336, 138 + row * 758
            draw.text((x, y - 32), ('浅色' if mode == 'light' else '暗色') + ' · ' + label, font=font(18, True), fill='#33445D')
            board.paste(thumb, (x, y))
    board.save(EVIDENCE / (skin['id'] + '-board.png'))

overview = Image.new('RGB', (1732, 1198), '#EDF1F6')
draw = ImageDraw.Draw(overview)
draw.text((20, 16), '循阶 · 七套皮肤 / 浅色与暗色', font=font(30, True), fill='#152239')
draw.text((20, 61), 'Android 原生首页对照 · 1.1.5 基线开发分支 · 未发布', font=font(18), fill='#526176')
for col, skin in enumerate(skins):
    draw.text((20 + col * 244, 103), skin['name'], font=font(18, True), fill='#152239')
    for row, mode in enumerate(['light', 'dark']):
        img = Image.open(EVIDENCE / f'{skin["id"]}-{mode}-home.png').convert('RGB')
        overview.paste(img.resize((228, 507), Image.Resampling.LANCZOS), (20 + col * 244, 142 + row * 526))
overview.save(EVIDENCE / 'all-skins-home.png')
(EVIDENCE / 'inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

options = ''.join(f'<option value="{skin["id"]}">{html.escape(skin["name"])}</option>' for skin in skins)
data = json.dumps([{'id': skin['id'], 'name': skin['name']} for skin in skins], ensure_ascii=False)
document = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>循阶 · 皮肤原生对照图册</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf1f6;color:#152239;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:28px 20px 64px}h1{font-size:28px;margin:0 0 6px}p{color:#526176;margin:0 0 22px}.tools{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:#edf1f6ee;padding:14px 0;backdrop-filter:blur(12px)}select,button{font:inherit;min-height:48px;border:1px solid #8b9bb3;border-radius:10px;background:white;padding:8px 14px;color:#152239}fieldset{display:flex;gap:14px;border:0;padding:0;margin:0}label{min-height:48px;display:inline-flex;gap:6px;align-items:center}input{accent-color:#245cd8}section{margin:16px 0 32px}h2{font-size:18px;margin:0 0 12px}.screens{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0}figcaption{font-size:14px;font-weight:600;margin-bottom:8px}img{width:100%;height:auto;border-radius:18px;display:block;border:1px solid #d2dbe8}a{color:#245cd8}a:focus-visible,select:focus-visible{outline:3px solid #245cd8;outline-offset:4px}.full{display:inline-block;margin-top:16px}footer{margin-top:32px;color:#526176;font-size:13px}@media(max-width:600px){main{padding:18px 12px}.screens{gap:8px}img{border-radius:10px}h1{font-size:24px}figcaption{font-size:12px}.tools{gap:8px}fieldset{gap:8px}}@media(prefers-color-scheme:dark){body,.tools{background:#101b2e;color:#f2f6fe}p,footer{color:#bdc9dc}.tools{background:#101b2eee}select{background:#1b2b44;color:#f2f6fe}a{color:#9cc3ff}}
</style><main><h1>循阶 · 皮肤对照图册</h1><p>七套皮肤，每套浅色与暗色。图片来自 Android 实际运行页面，使用相同合成训练数据。当前为 1.1.5 基线开发分支，公开 APK 尚未更新。</p>
<div class="tools"><label for="skin">皮肤 <select id="skin">OPTIONS</select></label><fieldset aria-label="对照外观"><label><input type="radio" name="mode" value="both" checked>浅暗对照</label><label><input type="radio" name="mode" value="light">浅色</label><label><input type="radio" name="mode" value="dark">暗色</label></fieldset></div><div id="gallery"></div><a class="full" id="board" href="#">打开本套六页对照图</a><footer>完整建设流程：<a href="README.md">建设索引</a> · <a href="CONSTRUCTION.md">建设规范</a> · <a href="VALIDATION.md">验证记录</a>。新增皮肤必须浅暗成对，保留相同训练行为。</footer></main>
<script>const skins=DATA;const skin=document.querySelector('#skin');const gallery=document.querySelector('#gallery');const pages=[['home','首页'],['climbing','训练中'],['summary','训练完成']];function render(){const id=skin.value;const choice=document.querySelector('input[name=mode]:checked').value;const modes=choice==='both'?['light','dark']:[choice];gallery.replaceChildren();for(const mode of modes){const section=document.createElement('section');const title=document.createElement('h2');title.textContent=skins.find(s=>s.id===id).name+' · '+(mode==='light'?'浅色':'暗色');section.append(title);const row=document.createElement('div');row.className='screens';for(const [page,label] of pages){const figure=document.createElement('figure');const caption=document.createElement('figcaption');caption.textContent=label;const link=document.createElement('a');link.href='evidence/20261028/'+id+'-'+mode+'-'+page+'.png';link.target='_blank';link.rel='noopener';const image=document.createElement('img');image.src=link.href;image.alt=title.textContent+' · '+label;link.append(image);figure.append(caption,link);row.append(figure)}section.append(row);gallery.append(section)}document.querySelector('#board').href='evidence/20261028/'+id+'-board.png';history.replaceState(null,'','#'+id)}const initial=location.hash.slice(1);if(skins.some(s=>s.id===initial))skin.value=initial;skin.addEventListener('change',render);document.querySelectorAll('input[name=mode]').forEach(input=>input.addEventListener('change',render));render();</script></html>'''
(DOC / 'preview.html').write_text(document.replace('OPTIONS', options).replace('DATA', data), encoding='utf-8')
print(f'{len(inventory)} native frames; {len(skins)} contact sheets; portable preview.html generated')
