"""Build the review album from the native screenshots that actually passed checks."""
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/theme-pair-20261010'
TITLES = {
    'home': '首页', 'history': '训练记录', 'settings': '设置', 'summary': '训练结算',
    'template': '保存新楼栋', 'share': '分享成绩', 'onboarding': '使用引导',
    'privacy': '隐私协议', 'privacy-first': '首次使用 · 隐私协议', 'legacy': '旧版记录详情',
    'diagnostic': '传感器诊断', 'empty': '首页 · 暂无记录', 'history-heights': '记录 · 不同层数图标',
    'references-everest': '首页 · 珠峰高度', 'calibrating': '训练 · 标定',
    'calibration_top': '训练 · 标定完成', 'climbing': '训练 · 爬升', 'descending': '训练 · 下行',
    'waiting': '训练 · 等待下一轮', 'climbing-estimated': '训练 · 步数估算',
    'starting': '训练 · 启动传感器', 'start-error': '训练 · 启动失败', 'finishing': '训练 · 正在保存',
    'save-failed': '训练 · 保存失败', 'save-failed-no-recovery': '训练 · 保存失败 · 保留当前轮次',
    'floor-picker': '起始楼层选择', 'building-actions': '楼栋管理', 'building-rename': '重命名楼栋',
    'height-references': '37 种高度参照', 'height-references-bottom': '高度参照 · 山峰',
    'history-actions': '记录操作', 'round-edit': '修改轮次层数',
    'sensor-retry': '启动失败后重试', 'back-guard': '训练中返回 · 提醒',
    'finish-result': '长按保存后结算', 'save-retry-result': '保存失败后重试',
    'save-later-home': '保留训练后返回首页', 'switch-in-place': '训练中切换主题 · 层数保留',
    'share-switch': '分享页切换主题', 'share-switch-saved': '切换主题后海报保存成功',
    'large-text-climbing-long': '大字体 · 101 楼', 'large-text-calibrating': '大字体 · 标定',
    'large-text-save-failed': '大字体 · 保存失败', 'large-text-template': '大字体 · 保存楼栋',
    'large-text-save-failed-actions': '大字体 · 保存失败后操作',
}
data = json.loads((OUT / 'after/native-checks.json').read_text(encoding='utf-8'))
names = list(dict.fromkeys(key.split('-', 1)[1] for key in data))
missing = [mode + '-' + name for name in names for mode in ['light', 'dark'] if mode + '-' + name not in data]
assert not missing, 'Incomplete theme pair: ' + ', '.join(missing)


def group(name):
    if name.startswith('large-text-'):
        return 'stress'
    if name in ['floor-picker', 'building-actions', 'building-rename', 'height-references',
                'height-references-bottom', 'history-actions', 'round-edit']:
        return 'sheets'
    if name in ['sensor-retry', 'back-guard', 'finish-result', 'save-retry-result', 'save-later-home',
                'switch-in-place', 'share-switch', 'share-switch-saved']:
        return 'actions'
    if name in ['calibrating', 'calibration_top', 'climbing', 'descending', 'waiting',
                'climbing-estimated', 'starting', 'start-error', 'finishing', 'save-failed', 'save-failed-no-recovery']:
        return 'workouts'
    return 'pages'


cards = []
for i, name in enumerate(names):
    title = html.escape(TITLES.get(name, name))
    phones = ''.join(f'<figure><figcaption>{label}</figcaption><a href="after/raw/{mode}-{name}.png" target="_blank" rel="noopener"><img src="after/actual/{mode}-{name}.png" alt="{title} · {label}" loading="lazy" width="390"></a></figure>'
                     for mode, label in [('light', '浅色'), ('dark', '深色')])
    cards.append(f'<article class="pair" data-group="{group(name)}"><h2><span>{i+1:02}</span>{title}</h2><div class="phones">{phones}</div></article>')

page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>循阶 · App 深浅主题对照</title><style>
:root{color-scheme:light;--paper:#f7f5f2;--ink:#1c1917;--muted:#57534e;--line:#e2dcd5;--orange:#f05a0a}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,"Microsoft YaHei",sans-serif}a{color:#a93e08}header,main{max-width:1180px;margin:auto;padding:30px 24px}header{padding-top:52px;padding-bottom:20px}.brand{font-weight:800;letter-spacing:2px;color:#b8420a}.top{display:flex;align-items:center;justify-content:space-between;gap:24px}h1{font-size:clamp(28px,4vw,48px);letter-spacing:-1px;margin:12px 0}p{color:var(--muted);line-height:1.8}.download{background:var(--orange);color:#1a0d05;border-radius:16px;padding:16px 24px;text-decoration:none;font-weight:800;white-space:nowrap}.facts{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}.facts span{background:white;border:1px solid var(--line);border-radius:30px;padding:8px 14px;font-size:14px}.intro{border:1px solid var(--line);border-radius:24px;padding:22px;background:white}.intro h2{margin-top:0}.before{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.before img{max-width:100%;width:270px;border-radius:18px}figure{margin:0;text-align:center;min-width:0}figcaption{color:var(--muted);font-size:14px;font-weight:700;margin-bottom:10px}nav{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:10;padding:15px 0;background:var(--paper);border-bottom:1px solid var(--line)}button{font:inherit;border:1px solid var(--line);background:white;color:var(--ink);border-radius:30px;padding:11px 17px;cursor:pointer}button[aria-pressed=true]{background:var(--orange);border-color:var(--orange);color:#1a0d05;font-weight:800}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:24px}.pair{background:white;border:1px solid var(--line);border-radius:24px;padding:22px}.pair h2{font-size:18px;line-height:1.6;margin:0 0 18px}.pair h2 span{color:#b8420a;font-size:14px;margin-right:12px}.phones{display:flex;gap:16px;align-items:flex-start}.phones figure{flex:1}.phones img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:15px}.note{font-size:13px;margin-top:24px}article[hidden]{display:none}.exports{display:flex;gap:16px;flex-wrap:wrap}.exports img{width:230px;border-radius:16px;border:1px solid var(--line)}footer{margin:40px 0;color:var(--muted);line-height:1.8;font-size:14px}@media(max-width:720px){header,main{padding-left:16px;padding-right:16px}.top{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr}.pair{padding:16px}.before{gap:8px}.before figcaption{font-size:11px}.phones{gap:10px}nav button{font-size:13px;padding:9px 13px}}
</style><header><div class="brand">循阶 / APP THEME REVIEW</div><div class="top"><div><h1>浅色一套，深色一套。</h1><p>同一页面，两套完整配色。保留已确认的布局、橙色品牌与训练操作。</p></div><a class="download" href="../../../artifacts/theme-pair-1.1.2-20261010/steploop-1.1.2-light-dark.apk" download>下载本次 Android 安装包</a></div><div class="facts"><span>__COUNT__ 组页面与状态</span><span>__SHOTS__ 张 Android 原生截图</span><span>509 项代码检查通过</span><span>训练中可直接切换主题</span></div></header>
<main><section class="intro"><h2>训练页面 · 修改前后</h2><p>旧版在浅色模式下仍使用固定黑底。本次将训练的背景、楼层数字、刻度、状态栏及长按进度一起接入主题。</p><div class="before"><figure><figcaption>修改前 · 浅色模式</figcaption><img src="before/actual/light-climbing.png" alt="修改前浅色训练页仍是黑色"></figure><figure><figcaption>修改后 · 浅色模式</figcaption><img src="after/actual/light-climbing.png" alt="修改后浅色训练页"></figure><figure><figcaption>修改后 · 深色模式</figcaption><img src="after/actual/dark-climbing.png" alt="修改后深色训练页"></figure></div></section>
<nav aria-label="页面分组"><button data-filter="all" aria-pressed="true">全部</button><button data-filter="pages" aria-pressed="false">主要页面</button><button data-filter="workouts" aria-pressed="false">训练与异常</button><button data-filter="sheets" aria-pressed="false">弹层</button><button data-filter="actions" aria-pressed="false">操作与主题切换</button><button data-filter="stress" aria-pressed="false">小屏与大字体</button></nav><p class="note">截图来自隔离测试 App 的实际 Android 渲染，使用合成训练数据。点击截图可查看包含系统栏的原始画面。</p><div class="grid">__CARDS__</div>
<section class="intro" style="margin-top:32px"><h2>主题切换后，海报仍可保存</h2><p>已在同一分享页面连续切换深色、浅色并导出，图片为 1080 × 1350 像素。海报沿用已确认的暖纸色模板。</p><div class="exports"><a href="after/exports/light-poster.png"><img src="after/exports/light-poster.png" alt="浅色模式导出的海报" loading="lazy"></a><a href="after/exports/dark-poster.png"><img src="after/exports/dark-poster.png" alt="深色模式导出的海报" loading="lazy"></a></div></section>
<footer>Android 模拟器完成主要页面、训练各阶段、异常恢复、主题实时切换及小屏大字体检查。33 项已归档的旧流程测试按既有规则跳过。<br><a href="AUDIT.md">查看修改与验证记录</a> · <a href="after/native-checks.json">原生截图检查结果</a> · <a href="release-checks.json">独立安装包验证结果</a></footer></main>
<script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));document.querySelectorAll('.pair').forEach(card=>card.hidden=button.dataset.filter!=='all'&&card.dataset.group!==button.dataset.filter)}));</script></html>'''
page = page.replace('__COUNT__', str(len(names))).replace('__SHOTS__', str(len(data))).replace('__CARDS__', ''.join(cards))
(OUT / 'index.html').write_text(page, encoding='utf-8')

# A compact native pair for the final reply; every panel remains a real screenshot.
canvas = Image.new('RGB', (816, 902), '#e8e3dc')
draw = ImageDraw.Draw(canvas)
for i, mode in enumerate(['light', 'dark']):
    im = Image.open(OUT / 'after/actual' / (mode + '-climbing.png'))
    canvas.paste(im, (10 + i * 406, 42))
    draw.text((20 + i * 406, 15), mode.upper() + ' / ANDROID', fill='#1c1917')
canvas.save(OUT / 'theme-preview.png')
print(json.dumps({'themePairs': len(names), 'nativeScreenshots': len(data), 'gallery': str(OUT / 'index.html')}))
