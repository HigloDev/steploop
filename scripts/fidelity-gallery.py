"""Side-by-side source and native crops in HTML; original bitmaps stay unchanged."""
import argparse
import json
from pathlib import Path
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/skins'
data = []
parser = argparse.ArgumentParser()
parser.add_argument('--all-rounds', action='store_true', help='Development-only view of retained iterations')
args = parser.parse_args()
current_source = source_fingerprint()
for manifest in sorted((DOC / 'evidence/20261028-fidelity').glob('round-*/captures.json')):
    if not args.all_rounds and manifest.parent.name != 'round-6':
        continue
    for item in json.loads(manifest.read_text(encoding='utf-8')):
        if not args.all_rounds and item.get('sourceFingerprint') != current_source:
            continue
        data.append({**item, 'round': manifest.parent.name, 'nativeFile': (manifest.parent / (item['name']+'.png')).relative_to(DOC).as_posix()})
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>循阶 · 原稿与原生逐页对照</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e9edf2;color:#172337;font:14px/1.5 system-ui,"Microsoft YaHei"}main{max-width:1100px;margin:auto;padding:20px}h1{font-size:24px;margin:0}p{color:#4b5b70}.controls{position:sticky;top:0;padding:12px 0;background:#e9edf2f2;display:flex;gap:12px;z-index:4;flex-wrap:wrap}select{min-height:44px;font:inherit;padding:8px;border:1px solid #9caabd;border-radius:7px}.pair{display:flex;gap:24px;align-items:flex-start;justify-content:center}figure{margin:0}figcaption{font-weight:700;margin:8px 0}.clip{position:relative;overflow:hidden;background:transparent;outline:1px solid #b7c2d0}.clip img{position:absolute;max-width:none}a{color:#2853ab}.note{padding:8px 12px;background:white;border-radius:8px}@media(max-width:700px){main{padding:10px}.pair{gap:10px}}</style>
<main><h1>原稿与原生逐页对照</h1><p>左侧为确认稿的对应画面，右侧为真实 Android 页面。仅在浏览器中裁去画板留白与系统栏，原始图片文件保持不变；动态训练数据以实际逻辑为准。</p><div class="controls"><select aria-label="对照页面" id="case"></select><select aria-label="整改轮次" id="round"></select><select aria-label="查看方式" id="view"><option value="full">完整页面</option><option value="detail">细节放大</option></select></div><div class="pair" id="pair"></div><p id="meta"></p><p class="note">此页用于检查设计还原与实际功能；不表示逐像素一致。<a href="GRAPHICS_VALIDATION.md">视觉检查记录</a></p></main>
<script>const data=DATA;const names={'k-on':'K-On','eva-unit-01':'EVA初号机','eva-unit-02':'EVA二号机','night-run':'夜跑竞技',woodland:'山野自然',pikachu:'皮卡丘'},pages={home:'训练首页',coach:'教练',history:'记录',settings:'设置'};const choice=document.querySelector('#case'),round=document.querySelector('#round');
for(const key of [...new Set(data.map(x=>x.name))]){const d=data.find(x=>x.name===key),o=new Option(names[d.skin]+' · '+(d.mode==='light'?'浅色':'暗色')+' · '+pages[key.slice((d.skin+'-'+d.mode+'-').length)],key);choice.add(o)}
function rounds(){round.replaceChildren();for(const r of [...new Set(data.filter(x=>x.name===choice.value).map(x=>x.round))])round.add(new Option(r,r));round.selectedIndex=round.options.length-1;render()}
function imageBox(label,file,rect,width){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),link=document.createElement('a'),clip=document.createElement('div'),img=document.createElement('img');caption.textContent=label;link.href=file;link.target='_blank';link.rel='noopener';clip.className='clip';const scale=width/rect[2];clip.style.width=width+'px';clip.style.height=rect[3]*scale+'px';img.src=file;img.alt=label;img.onload=()=>{img.style.width=img.naturalWidth*scale+'px';img.style.height=img.naturalHeight*scale+'px'};img.style.left=-rect[0]*scale+'px';img.style.top=-rect[1]*scale+'px';clip.append(img);link.append(clip);figure.append(caption,link);return figure}
function render(){const d=data.find(x=>x.name===choice.value&&x.round===round.value);if(!d)return;const pair=document.querySelector('#pair');pair.replaceChildren();history.replaceState(null,'','#'+choice.value);const width=Math.min(390,(window.innerWidth-68)/2,document.querySelector('#view').value==='full'?(window.innerHeight-235)*d.sourceRect[2]/d.sourceRect[3]:Infinity);pair.append(imageBox('确认稿',d.reference,d.sourceRect,width),imageBox('实际运行 · '+d.round,d.nativeFile,d.nativeRect,width));document.querySelector('#meta').textContent='原稿内容 '+d.sourceRect[2]+'×'+d.sourceRect[3]+' px；原生内容 '+d.nativeRect[2]+'×'+d.nativeRect[3]+' px。字体倍率100%，密度'+d.density+'dpi，逻辑宽度'+(d.logicalWidthDp??(d.nativeRect[2]*160/d.density)).toFixed(0)+'dp。'}choice.addEventListener('change',rounds);round.addEventListener('change',render);document.querySelector('#view').addEventListener('change',render);window.addEventListener('resize',render);const initial=location.hash.slice(1);if(data.some(x=>x.name===initial))choice.value=initial;rounds();</script></html>'''
page = page.replace('<option value="detail">细节放大</option>', '<option value="detail">细节放大</option><option value="overview">本皮肤四页</option>')
page = page.replace('function render(){const d=', 'function renderSingle(){const d=')
page = page.replace("choice.addEventListener('change',rounds)", """function render(){
const container=document.querySelector('#pair');
if(document.querySelector('#view').value!=='overview'){container.style.display='flex';container.style.gap='24px';renderSingle();return}
const selected=data.find(x=>x.name===choice.value&&x.round===round.value);if(!selected)return;
container.replaceChildren();container.style.display='grid';container.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';container.style.gap='12px';
const width=Math.min(132,(Math.min(1100,window.innerWidth)-120)/8);
for(const key of ['home','coach','history','settings']){const d=data.find(x=>x.name===selected.skin+'-'+selected.mode+'-'+key&&x.round===selected.round);if(!d)continue;
const group=document.createElement('section'),heading=document.createElement('strong'),row=document.createElement('div');heading.textContent=pages[key];row.style.display='flex';row.style.gap='8px';row.style.fontSize='11px';
row.append(imageBox('确认稿',d.reference,d.sourceRect,width),imageBox('实际运行',d.nativeFile,d.nativeRect,width));group.append(heading,row);container.append(group)}
document.querySelector('#meta').textContent=names[selected.skin]+' · '+(selected.mode==='light'?'浅色':'暗色')+' · 360dp / 100%字号。请选择完整页面或细节放大检查具体控件。';history.replaceState(null,'','#'+choice.value)}
choice.addEventListener('change',rounds)""")
(DOC / 'fidelity-review.html').write_text(page.replace('DATA', json.dumps(data, ensure_ascii=False)), encoding='utf-8')
print(f'{len(data)} comparison captures available')
