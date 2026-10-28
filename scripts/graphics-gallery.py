"""Index unmodified native captures and build a portable review page.

Images remain byte-for-byte adb screenshots. This does not crop or retouch artwork.
"""
import hashlib
import html
import json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/skins'
EVIDENCE = DOC / 'evidence/20261028-fidelity'
registry = json.loads((DOC / 'registry.json').read_text(encoding='utf-8'))
inventory = []
source = source_fingerprint()
proof = {}
for directory in ['round-6', 'core', 'flows', 'small', 'small-pikachu', 'small-k-on', 'interaction']:
    folder = EVIDENCE / directory
    for name in ['captures.json', 'capture-results.json', 'small-results.json', 'interaction-results.json']:
        manifest = folder / name
        if manifest.exists():
            data = json.loads(manifest.read_text(encoding='utf-8'))
            frames = data if isinstance(data, list) else data.get('frames', [])
            for frame in frames:
                proof[(directory, frame['name'])] = frame.get('sourceFingerprint', data.get('sourceFingerprint') if isinstance(data, dict) else None)
for file in sorted(EVIDENCE.rglob('*.png')):
    if file.parent.name not in ['round-6', 'core', 'flows', 'small', 'small-pikachu', 'small-k-on', 'interaction']:
        continue
    assert proof.get((file.parent.name, file.stem)) == source, 'Stale or missing capture metadata: ' + str(file)
    skin = next((s['id'] for s in registry['skins'] if file.name.startswith(s['id'] + '-')), None)
    if skin:
        tail = file.stem[len(skin) + 1:]
        mode, state = tail.split('-', 1)
    else:
        mode, state = None, file.stem
    with Image.open(file) as img:
        size = list(img.size)
    group = 'core' if file.parent.name == 'round-6' else 'small' if file.parent.name.startswith('small') else file.parent.name
    inventory.append({'file': file.relative_to(DOC).as_posix(), 'group': group,
        'skin': skin, 'mode': mode, 'state': state, 'size': size,
        'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
        'capturedAt': datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).isoformat(), 'sourceFingerprint': source})

record = {'schemaVersion': 1, 'baseVersion': '1.1.7', 'baseCommit': '9c7eed9',
    'package': 'com.zxn.palou.uiqa', 'avd': 'steploop_skins_20261028', 'syntheticData': True,
    'sourceFingerprint': source, 'nativeVisualReview': 'docs/skins/GRAPHICS_VALIDATION.md',
    'frames': inventory}
(EVIDENCE / 'inventory.json').write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
options = ''.join(f'<option value="{s["id"]}">{html.escape(s["name"])}</option>' for s in registry['skins'])
data = json.dumps({'skins': [{'id': s['id'], 'name': s['name'], 'graphicsStatus': s['graphicsStatus']} for s in registry['skins']], 'frames': inventory}, ensure_ascii=False)
document = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>循阶 · 图形皮肤原生图册</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:#172337;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:24px 24px 60px}h1{margin:0;font-size:28px;letter-spacing:-.6px}p{color:#566375;margin:8px 0 20px}.toolbar{display:flex;gap:20px;flex-wrap:wrap;align-items:center;padding:14px 0;position:sticky;top:0;background:#f2f4f7f0;backdrop-filter:blur(12px);z-index:2}.toolbar label{display:inline-flex;gap:8px;align-items:center;min-height:44px}select{font:inherit;min-height:44px;border:1px solid #a0acbd;border-radius:8px;background:white;color:inherit;padding:6px 12px}fieldset{padding:0;border:0;display:flex;gap:12px;margin:0}input{accent-color:#2861bf}.notice{padding:12px 16px;border-left:4px solid #b47716;background:#fff4d6;color:#5a451b;margin:12px 0}h2{font-size:19px;margin:16px 0 10px}.frames{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}figure{margin:0}figcaption{font-weight:600;margin-bottom:8px}img{display:block;width:100%;height:auto;border:1px solid #d7dfe9;border-radius:16px}a{color:#2458ae}a:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #316ee2;outline-offset:3px}footer{margin-top:28px;color:#566375;font-size:13px}.empty{padding:32px;border:1px dashed #a0acbd;border-radius:12px}@media(max-width:900px){main{padding:18px 14px}.frames{gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar{gap:10px}}@media(prefers-color-scheme:dark){body,.toolbar{background:#152033;color:#f4f7fc}.toolbar{background:#152033ef}p,footer{color:#becbdb}select{background:#213047}a{color:#a9c9ff}.notice{background:#40341d;color:#ffdf9b}}
</style><main><h1>循阶 · 图形皮肤</h1><p>1.1.7 综合候选上的 Android 实际页面。四个主入口、训练与教练流程使用合成数据。点击图片查看原始截图。</p>
<div class="toolbar"><label>皮肤<select id="skin">OPTIONS</select></label><label>页面<select id="group"><option value="main">四个一级入口</option><option value="training">训练中与完成</option><option value="coach">教练流程</option><option value="extra">更多状态与分享</option><option value="small">小屏与大字体</option></select></label><fieldset aria-label="明暗对照"><label><input name="mode" type="radio" value="both" checked>浅暗对照</label><label><input name="mode" type="radio" value="light">浅色</label><label><input name="mode" type="radio" value="dark">暗色</label></fieldset></div><div id="notice"></div><div id="gallery"></div><footer>当前原生开发分支，未安装到真实手机、未公开发布。<a href="fidelity-review.html">与原稿逐页对照</a> · <a href="README.md">建设索引</a> · <a href="GRAPHICS_VALIDATION.md">验证范围及剩余项</a> · <a href="evidence/20261028-fidelity/inventory.json">原始截图清单</a>。旧配色图册另行保留。</footer></main>
<script>const data=DATA;
const names={home:'训练首页',coach:'教练',history:'记录',settings:'设置',climbing:'训练中',summary:'训练完成',appearance:'皮肤与外观','coach-active':'已开启的课程','coach-course':'课程详情','coach-goal':'目标表单','coach-session':'课程安排','coach-records':'称重与记录','coach-review':'每周复盘','summary-coach':'课程训练反馈','course-climbing':'课程训练中',calibrating:'标定',descending:'下行',waiting:'下一轮准备','save-failed':'保存失败',share:'单次分享',weekly:'每周分享'};
const skin=document.querySelector('#skin'), group=document.querySelector('#group'), gallery=document.querySelector('#gallery');
function render(){const selected=data.skins.find(s=>s.id===skin.value);const mode=document.querySelector('input[name=mode]:checked').value;const modes=mode==='both'?['light','dark']:[mode];gallery.replaceChildren();document.querySelector('#notice').replaceChildren();if(selected.graphicsStatus==='awaiting-user-asset-method'){const note=document.createElement('p');note.className='notice';note.textContent='皮卡丘目前显示已实现的配色。新的独立图形素材尚未完成，此处不计为图形版通过。';document.querySelector('#notice').append(note)}
const wanted=group.value==='main'?['home','coach','history','settings']:group.value==='training'?['climbing','summary']:group.value==='coach'?['coach-active','coach-course','coach-goal','coach-session','coach-records','coach-review','summary-coach','course-climbing']:['appearance','calibrating','descending','waiting','save-failed','share','weekly'];
for(const m of modes){const frames=data.frames.filter(f=>f.skin===skin.value&&f.mode===m&&(group.value==='small'?f.group==='small':f.group!=='small'&&wanted.includes(f.state))).sort((a,b)=>wanted.indexOf(a.state)-wanted.indexOf(b.state));if(!frames.length)continue;const section=document.createElement('section');const heading=document.createElement('h2');heading.textContent=selected.name+' · '+(m==='light'?'浅色':'暗色');const row=document.createElement('div');row.className='frames';for(const frame of frames){const figure=document.createElement('figure');const caption=document.createElement('figcaption');caption.textContent=names[frame.state]??frame.state.replace('-small-bottom',' · 下方内容').replace('-small',' · 小屏');const a=document.createElement('a');a.href=frame.file;a.target='_blank';a.rel='noopener';const img=document.createElement('img');img.src=frame.file;img.loading='lazy';img.width=frame.size[0];img.height=frame.size[1];img.alt=heading.textContent+' · '+caption.textContent;a.append(img);figure.append(caption,a);row.append(figure)}section.append(heading,row);gallery.append(section)}if(!gallery.children.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='这一组尚无截图。共享流程的补充检查请查看 EVA 初号机或 K-On，完整范围见验证记录。';gallery.append(empty)}history.replaceState(null,'','#'+skin.value)}
const initial=location.hash.slice(1);skin.value=data.skins.some(s=>s.id===initial)?initial:'eva-unit-02';skin.addEventListener('change',render);group.addEventListener('change',render);document.querySelectorAll('input[name=mode]').forEach(el=>el.addEventListener('change',render));render();
</script></html>'''
document = document.replace('img{display:block;width:100%;height:auto;', 'figure a{display:flex;justify-content:center}img{display:block;width:auto;max-width:100%;height:auto;max-height:calc(100vh - 240px);')
document = document.replace('<option value="small">小屏与大字体</option>', '<option value="small">小屏与大字体</option><option value="interaction">切换、保存与重启</option>')
document = document.replace("const skin=document.querySelector", """function frameName(state){
const lifecycle={'tab-roundtrip':'四个入口往返','cold-start':'冷启动恢复','system':'跟随系统','manual-on-dark-system':'系统暗色时手动选浅色','goal-saved':'目标保存后','weight-saved':'称重保存后','review-saved':'复盘保存后','coach-cold-start':'重启后的课程与体重','course-feedback-saved':'训练感受保存后'};
if(lifecycle[state])return lifecycle[state];
const suffix=state.match(/-small(?:-(action|keyboard|bottom))?$/);
if(suffix){const base=state.slice(0,suffix.index);return (names[base]??base)+' · '+({action:'主要操作',keyboard:'输入与键盘',bottom:'下方内容'}[suffix[1]]??'小屏大字体')}
return names[state]??state}
const skin=document.querySelector""")
document = document.replace("group.value==='small'?f.group==='small':f.group!=='small'&&wanted.includes(f.state)", "['small','interaction'].includes(group.value)?f.group===group.value:['core','flows'].includes(f.group)&&wanted.includes(f.state)")
document = document.replace("names[frame.state]??frame.state.replace('-small-bottom',' · 下方内容').replace('-small',' · 小屏')", "frameName(frame.state)")
(DOC / 'graphics-preview.html').write_text(document.replace('OPTIONS',options).replace('DATA',data),encoding='utf-8')
print(f'{len(inventory)} unmodified native frames indexed; graphics-preview.html generated')
