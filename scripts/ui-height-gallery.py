"""Publish genuine native captures, with explicit fixture and evidence labels."""
import hashlib
import html
import json
import re
import shutil
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/height-references-20261010'
OUT.mkdir(parents=True, exist_ok=True)
for name in ['home', 'history']:
    before = OUT / 'before'; before.mkdir(exist_ok=True)
    source = ROOT / 'docs/qa/ui-audit-20261010/after/actual' / (name + '.png')
    shutil.copy2(source, before / (name + '.png'))

sections = [
  ('首页 · 本周高度自动对照', [
    ('home', '常规成绩：新入口与自动参照'), ('references-low', '12 米：故宫城墙'),
    ('references-mid', '632 米：上海中心'), ('references-everest', '8848.86 米：珠峰'),
    ('references-beyond', '18000 米：继续累计'), ('references-zero', '未开始时不会误报达标')]),
  ('37 种参照 · 全部可浏览', [
    ('catalog-top', '清单入口、下一站与进度'), ('catalog-city', '城市地标'), ('catalog-everest', '名山直到珠峰'),
    ('references-everest-catalog', '达到珠峰之后的清单')]),
  ('记录 · 图标随完成层数变化', [
    ('history-low', '2 层与 10 层：矮房子'), ('history-middle', '30、60、100、200、300 层：逐级长高'),
    ('history-high', '高楼与双楼群'), ('history-corrected-31', '30 → 31 层：图标跨档更新'),
    ('history-corrected-persisted', '修改并重启后仍正确')]),
  ('小屏、放大字体与浅色', [
    (prefix + '-' + screen, title + ' · ' + view)
    for prefix, title in [('small-130', '320 小屏 / 字体 130%'), ('font-125', '400 屏宽 / 字体 125%'), ('light', '浅色模式')]
    for screen, view in [('everest', '珠峰数字'), ('everest-scroll', '数字与入口滚动可达'), ('catalog', '参照清单'), ('history', '记录'), ('history-scroll', '记录滚动')]]),
  ('独立 APK · 保留现有数据覆盖安装', [
    ('release-home', '独立包首页'), ('release-catalog', '独立包参照入口'), ('release-history', '独立包记录图标')]),
]

# Cut only actual icon pixels out of native captures, never redraw an evidence glyph.
icons = {}
for name in ['history-low', 'history-middle', 'history-high']:
    png, xml = OUT / 'raw' / (name + '.png'), OUT / 'actual' / (name + '.xml')
    if not png.exists() or not xml.exists(): continue
    image = Image.open(png).convert('RGB')
    for node in ET.parse(xml).iter('node'):
        match = re.match(r'(2|10|30|60|100|200|300) 层训练，', node.get('content-desc', ''))
        bounds = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
        if not match or len(bounds) != 4: continue
        x1, y1, x2, y2 = bounds
        count = int(match.group(1))
        if y1 < 180 or y2 > image.height - 220 or y2 - y1 < 90: continue
        # Card content is a centered horizontal row with a 42 dp SVG at its leading edge.
        center = (y1 + y2) // 2
        icons[count] = image.crop((x1, center - 48, x1 + 100, center + 48))
if len(icons) == 7:
    legend = Image.new('RGB', (840, 144), '#1d1b18')
    draw = ImageDraw.Draw(legend)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
    for index, count in enumerate(sorted(icons)):
        legend.paste(icons[count], (index * 120 + 10, 4))
        draw.text((index * 120 + 36, 110), str(count) + ' F', fill='#f7f5f2', font=font)
    legend.save(OUT / 'building-tiers.png')

cards = []
manifest = []
for title, items in sections:
    images = []
    for name, caption in items:
        path = OUT / 'actual' / (name + '.png')
        if not path.exists(): continue
        images.append(f'<figure><a href="actual/{name}.png"><img src="actual/{name}.png" loading="lazy" alt="{html.escape(caption)}"></a><figcaption>{html.escape(caption)}</figcaption></figure>')
        manifest.append({'id': name, 'caption': caption, 'image': f'actual/{name}.png', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    if images: cards.append(f'<section><h2>{title}</h2><div class="grid">' + ''.join(images) + '</div></section>')

source_hashes = {}
for path in sorted((ROOT / 'src').rglob('*')):
    if path.is_file() and 'dev' not in path.relative_to(ROOT / 'src').parts:
        source_hashes[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
for rel in ['App.tsx', 'app.json', 'index.ts']:
    source_hashes[rel] = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
warm = Path('G:/pui112')
matches = all((warm / rel).exists() and hashlib.sha256((warm / rel).read_bytes()).hexdigest() == digest for rel, digest in source_hashes.items())
assert matches, 'Source does not match standalone build checkout'
previous = json.loads((ROOT / 'docs/qa/ui-audit-20261010/source-checks.json').read_text('utf-8'))['productionSourceHashes']
changed = [rel for rel, digest in source_hashes.items() if previous.get(rel) != digest]
protected = [rel for rel in previous if rel.startswith(('src/core/', 'src/hooks/', 'src/services/')) and rel != 'src/core/landmarks.ts']
assert all(source_hashes[rel] == previous[rel] for rel in protected), 'Unrelated workout or saved-data logic changed'
(OUT / 'source-checks.json').write_text(json.dumps({'sealedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
 'productionSourceMatchesBuiltCheckout': matches, 'productionFileCount': len(source_hashes), 'changedProductionFilesSincePreviousAudit': changed,
 'protectedFilesUnchanged': len(protected), 'productionSourceHashes': source_hashes}, ensure_ascii=False, indent=2), 'utf-8')
latest = {}
for result in json.loads((OUT / 'interaction-checks.json').read_text('utf-8')): latest[result['case']] = result
rejected = [p.stem for p in (OUT / 'actual').glob('failure-*.png')]
(OUT / 'manifest.json').write_text(json.dumps({'capturedOn': '2026-10-10', 'scope': 'Home height references and History floor-aware icons',
 'source': 'Android native screenshots, synthetic QA fixtures; release screenshots from standalone package', 'captures': manifest,
 'latestInteractionResults': latest, 'historicalFailedCaptures': rejected}, ensure_ascii=False, indent=2), 'utf-8')
legend_html = '<img class="legend" src="building-tiers.png" alt="实际 Android 截图中的 7 档记录图标">' if (OUT / 'building-tiers.png').exists() else ''
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>循阶 · 高度参照与记录图标</title>
<style>*{box-sizing:border-box}body{margin:0;background:#11100f;color:#f6f3ee;font-family:system-ui,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto;padding:40px 24px}h1{font-size:34px;letter-spacing:-1px;margin:12px 0}h2{font-size:23px;margin:38px 0 18px}p{color:#bfb8af;line-height:1.8;max-width:850px}a{color:#ff7a2e;text-decoration:none}.tag{color:#ff7a2e;font-size:12px;font-weight:800;letter-spacing:2px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:24px;align-items:start}figure{margin:0;background:#1d1b18;border-radius:24px;padding:14px}figure img{display:block;width:100%;max-width:390px;margin:auto;border-radius:14px}figcaption{padding:14px 4px 8px;line-height:1.6;font-size:14px;color:#cdc5bb}.legend{width:100%;max-width:840px;display:block;margin:24px 0;border-radius:18px}.before{max-width:760px}.links{display:flex;gap:22px;flex-wrap:wrap;margin:24px 0}section{padding-bottom:16px}@media(max-width:640px){main{padding:28px 16px}h1{font-size:27px}.grid{grid-template-columns:1fr}}</style><main>
<span class="tag">STEPLOOP / ANDROID 1.1.2</span><h1>每一步向上，都有新的高度。</h1>
<p>首页加入 37 种独立参照，从身边物体、城市地标到珠峰；记录中的建筑按每次训练累计完成层数分为 7 档。保留已确认的黑橙视觉。以下是实际 Android 画面，使用明确的合成成绩验证边界；原始截图和界面树均随图册保存。</p>
<div class="links"><a href="../ui-audit-20261010/index.html">前一轮完整审计图册</a><a href="../../HEIGHT_REFERENCES_20261010.md">37 项数据与口径来源</a><a href="AUDIT.md">本轮检查与交付说明</a><a href="../../../artifacts/height-references-1.1.2-20261010/steploop-1.1.2-height-references.apk">下载本轮内部 APK</a></div>
<h2>7 档图标 · 来自实际截图</h2>''' + legend_html + '''<p>层数范围：0–5、6–15、16–30、31–60、61–100、101–200、201 层及以上。准确层数仍在记录正文中显示，多轮相加，修改层数后同步更新。</p>
<section class="before"><h2>修改前 · 已验收的原界面</h2><div class="grid"><figure><a href="before/home.png"><img src="before/home.png" alt="修改前首页"></a><figcaption>原首页：9 种参照，没有完整清单入口。</figcaption></figure><figure><a href="before/history.png"><img src="before/history.png" alt="修改前记录"></a><figcaption>原记录：所有层数使用同一个房屋图标。</figcaption></figure></div></section>''' + ''.join(cards) + '</main></html>'
(OUT / 'index.html').write_text(page, 'utf-8')
print(json.dumps({'screenshots': len(manifest), 'iconTiersCaptured': len(icons), 'protectedUnchanged': len(protected), 'productionMatchesBuild': matches}))
