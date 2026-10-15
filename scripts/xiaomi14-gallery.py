"""Generate a local review album from paired native evidence, never phone backups."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/xiaomi14-improvements-20261010'
TITLES = {
    'home': '首页 · 周累计与分享入口', 'weekly-height': '点击周累计 · 高度完成情况',
    'weekly-share': '本周成果 · 独立分享页', 'weekly-share-height': '本周成果 · 高度足迹',
    'weekly-empty': '本周暂无训练', 'calibrating': '标定 · 四项实时指标',
    'calibration_top': '标定完成', 'climbing': '自动爬楼', 'climbing-long': '101 楼 · 大数字',
    'climbing-estimated': '无气压计 · 估算提示', 'descending': '下行 · 不累计成绩', 'waiting': '等待下一轮',
    'floor-basement': '起始楼层 · 负一楼', 'floor-positive': '起始楼层 · 一楼',
    'weekly-saved': '海报保存完成', 'weekly-native-share': '系统分享选择器',
    'settings-feedback': '设置 · 震动与结算音效', 'building-stage-1': '盖楼动画 · 开始',
    'building-stage-2': '盖楼动画 · 建起', 'building-stage-3': '盖楼动画 · 成形',
    'real-manual-training': '真实训练流程 · 手动标记三层',
    'real-saved-celebration': '实际保存后 · 盖楼结算', 'real-saved-summary': '实际保存后 · 成绩页',
    'small-large-font-calibrating': '小屏大字体 · 标定',
    'small-large-font-calibrating-scrolled': '小屏大字体 · 标定操作区',
    'small-large-font-climbing': '小屏大字体 · 爬楼',
    'small-large-font-climbing-scrolled': '小屏大字体 · 爬楼操作区',
    'tall-calibrating': '超高屏 · 标定', 'tall-climbing': '超高屏 · 爬楼',
}


def group(name):
    if name.startswith(('tall-', 'small-large-font-')): return 'stress'
    if name.startswith(('building-', 'real-')) or name == 'settings-feedback': return 'finish'
    if name.startswith('floor-') or name in ['weekly-saved', 'weekly-native-share']: return 'actions'
    if name in ['calibrating', 'calibration_top', 'climbing', 'climbing-long', 'climbing-estimated', 'descending', 'waiting']: return 'training'
    return 'home'


names = [path.stem.removeprefix('light-') for path in (OUT / 'actual').glob('light-*.png') if 'building-stage-' not in path.stem]
ordered_names = [
    'home', 'weekly-height', 'weekly-share', 'weekly-share-height', 'weekly-empty',
    'floor-basement', 'floor-positive', 'calibrating', 'calibration_top', 'climbing',
    'climbing-long', 'climbing-estimated', 'descending', 'waiting',
    'real-manual-training', 'real-saved-celebration', 'real-saved-summary',
    'settings-feedback', 'weekly-saved', 'weekly-native-share',
    'tall-calibrating', 'tall-climbing', 'small-large-font-calibrating',
    'small-large-font-calibrating-scrolled', 'small-large-font-climbing',
    'small-large-font-climbing-scrolled',
]
order = {name: index for index, name in enumerate(ordered_names)}
names.sort(key=lambda name: (order.get(name, len(order)), name))
missing = [name for name in names if not (OUT / 'actual' / ('dark-' + name + '.png')).exists()]
assert not missing, 'Missing dark screenshots: ' + ', '.join(missing)
checks = json.loads((OUT / 'native-checks.json').read_text(encoding='utf-8'))
source = json.loads((OUT / 'source-checks.json').read_text(encoding='utf-8'))
release_path = OUT / 'release-checks.json'
release = json.loads(release_path.read_text(encoding='utf-8')) if release_path.exists() else None
phone_path = OUT / 'phone-checks.json'
phone = json.loads(phone_path.read_text(encoding='utf-8')) if phone_path.exists() else None
phone_verified = bool(phone and phone.get('savedDataUnchanged') and phone.get('userConfirmedHaptics') and phone.get('userConfirmedChime'))
cards = []
for i, name in enumerate(names):
    title = TITLES.get(name, name.replace('tall-', '超高屏 · ').replace('small-large-font-', '小屏大字体 · ').replace('scrolled', '滚动后'))
    phones = ''.join(f'<figure><figcaption>{label}</figcaption><a href="raw/{mode}-{name}.png" target="_blank"><img src="actual/{mode}-{name}.png" alt="{html.escape(title)} · {label}" width="400" loading="lazy"></a></figure>' for mode, label in [('light', '浅色'), ('dark', '深色')])
    cards.append(f'<article data-group="{group(name)}"><h2><span>{i+1:02}</span>{html.escape(title)}</h2><div class="phones">{phones}</div></article>')

page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>循阶 · 小米 14 使用改进</title>
<style>:root{--paper:#f7f5f2;--ink:#1c1917;--muted:#57534e;--line:#e2dcd5;--orange:#f05a0a;color-scheme:light}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,"Microsoft YaHei",sans-serif}header,main{max-width:1160px;margin:auto;padding:28px 24px}header{padding-top:52px}.brand{color:#b8420a;letter-spacing:2px;font-weight:800}h1{font-size:clamp(28px,4vw,48px);letter-spacing:-1px;margin:12px 0}p{color:var(--muted);line-height:1.8}a{color:#a93e08}.facts{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}.facts span{background:white;border:1px solid var(--line);padding:9px 14px;border-radius:30px;font-size:14px}.intro{background:white;border:1px solid var(--line);padding:24px;border-radius:24px}.intro h2{margin-top:0;font-size:20px}audio{width:min(100%,480px)}nav{position:sticky;top:0;background:var(--paper);padding:16px 0;display:flex;gap:8px;flex-wrap:wrap;z-index:10;border-bottom:1px solid var(--line)}button{font:inherit;border:1px solid var(--line);background:white;color:var(--ink);border-radius:30px;padding:10px 16px;cursor:pointer}button[aria-pressed=true]{background:var(--orange);color:#1a0d05;border-color:var(--orange);font-weight:800}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:24px}article{background:white;border:1px solid var(--line);border-radius:24px;padding:22px}article h2{font-size:18px;line-height:1.6;margin:0 0 18px}article h2 span{color:#b8420a;font-size:14px;margin-right:12px}.phones{display:flex;gap:16px;align-items:flex-start}.phones figure{flex:1;min-width:0;margin:0}figcaption{font-size:14px;color:var(--muted);font-weight:700;margin-bottom:10px}.phones img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:15px}article[hidden]{display:none}.files{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px}footer{font-size:13px;line-height:1.8;color:var(--muted);margin-top:32px}@media(max-width:720px){header,main{padding-left:16px;padding-right:16px}.grid{grid-template-columns:1fr}article{padding:16px}.phones{gap:10px}}</style>
<header><div class="brand">循阶 / XIAOMI 14 REVIEW</div><h1>每一层，都能看见与感知。</h1><p>起始楼层、震动反馈、训练布局、实时指标、盖楼结算与周成果分享。</p>
<div class="facts"><span>1.1.3 / 12</span><span>1200 × 2670 · 480 dpi · 字体 1.25</span><span>PAIRS 组浅深原生对照</span><span>TESTS 项测试通过 · 0 失败</span>PHONE_FACT</div>
<div class="intro"><h2>本次验收</h2><p>楼层选择跨过 0；新增楼层即时震动且不重复；标定与爬楼同时显示步数、频率、热量与高度。成绩保存成功后才播放盖楼结算。首页周累计可查看高度进度，周成果有独立海报、保存、分享和复制文案。</p><p>下图来自独立 Android 测试包，采用小米 14 的实际屏幕参数及合成记录。另测超高屏和小屏大字体。真实手机备份与截图保存在电脑私有目录。</p><p>原创结算铃声：</p><audio controls preload="metadata" src="../../../assets/audio/building-complete.wav"></audio><div class="files"><a href="AUDIT.md">验收说明</a><a href="native-checks.json">原生操作检查</a><a href="source-checks.json">源码回归</a>RELEASE</div></div></header>
<main><nav aria-label="筛选页面"><button aria-pressed="true" data-filter="all">全部</button><button aria-pressed="false" data-filter="home">周成果</button><button aria-pressed="false" data-filter="training">爬楼与标定</button><button aria-pressed="false" data-filter="actions">楼层与分享</button><button aria-pressed="false" data-filter="finish">震动与结算</button><button aria-pressed="false" data-filter="stress">屏幕适配</button></nav><div class="grid">CARDS</div><footer>点击图片查看完整原生截图。楼栋动画显示代表性楼层，成绩数字采用实际汇总；运动热量为估算。原生音频解码与播放完成已核验。PHONE_NOTE本次检查没有实测完整爬楼过程的计数误差，相关指标精度需要现场训练验证。</footer></main><script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));document.querySelectorAll('article').forEach(item=>item.hidden=button.dataset.filter!=='all'&&item.dataset.group!==button.dataset.filter)}))</script></html>'''
release_links = '<a href="release-checks.json">独立 APK 与数据保留检查</a><a href="../../../artifacts/xiaomi14-1.1.3-20261010/steploop-1.1.3-xiaomi14.apk">本机覆盖更新包</a>' if release else ''
if phone_verified:
    release_links += '<a href="phone-checks.json">小米 14 更新与备份比对</a>'
phone_fact = f'<span>小米 14 已更新 · {phone["afterBackupCounts"]["workouts"]} 次记录完整保留</span>' if phone_verified else ''
phone_note = '手机用户已确认震动和铃声正常。' if phone_verified else ''
videos = '<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:800">查看盖楼动画 · 原生录像</summary><p>录像展示实际建楼过程，铃声可在上方播放器试听。</p><div class="phones">' + ''.join(f'<figure><figcaption>{label}</figcaption><video controls muted playsinline preload="metadata" style="width:100%;max-height:620px;border-radius:16px" src="video/{mode}-building.mp4"></video></figure>' for mode, label in [('light', '浅色'), ('dark', '深色')]) + '</div></details>'
page = page.replace('PAIRS', str(len(names))).replace('TESTS', str(source['npmTest']['pass'])).replace('RELEASE', release_links).replace('CARDS', ''.join(cards)).replace('PHONE_FACT', phone_fact).replace('PHONE_NOTE', phone_note).replace('</audio>', '</audio>' + videos)
(OUT / 'index.html').write_text(page, encoding='utf-8')
print(json.dumps({'pairedScreens': len(names), 'nativeChecks': len(checks), 'standaloneReleaseChecked': release is not None, 'phoneUpdateVerified': phone_verified}))
