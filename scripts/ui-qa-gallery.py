"""Build the review gallery from actual native captures, without rendering substitute UI."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/ui-redraw-20261010'
STATES = [
 ('home','首页','主操作、周累计与楼栋'), ('history','记录','成果、筛选与历史'), ('settings','设置','播报、震动与体重'),
 ('climbing','训练','自动计层'), ('summary','结算','总爬升与每轮成果'), ('share','分享','海报、样式与导出'),
 ('onboarding-1','引导','携带方式'), ('onboarding-2','引导','首次标定'), ('onboarding-3','引导','成果核对'),
 ('privacy','隐私','七项摘要与完整协议入口'), ('legacy','旧版成绩','兼容历史与修正'), ('diagnostic','诊断','原生传感器采集与真值标记'),
 ('calibrating','训练','标定中'), ('calibration_top','训练','标定到顶'), ('descending','训练','下行'), ('waiting','训练','等待下一轮'),
 ('start-floor','弹窗','选择起始楼层'), ('manage','弹窗','楼栋管理'), ('rename','弹窗','重命名'), ('edit-round','弹窗','修改每轮层数'),
 ('settings-lower','设置','后台权限、备份与帮助'), ('template','结算','保存楼栋模板'), ('save-failed','训练','保存失败与重试'),
]
manifest=[]
for key,page,title in STATES:
    paths={kind:OUT/kind/f'{key}.png' for kind in ['reference','actual','compare']}
    assert all(path.exists() for path in paths.values()), f'Missing {key}'
    ref,actual=Image.open(paths['reference']),Image.open(paths['actual'])
    assert ref.size==actual.size, f'Density/viewport mismatch: {key}: {ref.size} vs {actual.size}'
    assert len(actual.convert('RGB').getcolors(actual.width*actual.height) or [])>20, f'Blank native frame: {key}'
    manifest.append({'key':key,'page':page,'title':title,'viewport':list(actual.size),
      'reference':f'reference/{key}.png','actual':f'actual/{key}.png','compare':f'compare/{key}.png',
      'actualSha256':hashlib.sha256(paths['actual'].read_bytes()).hexdigest()})
(OUT/'manifest.json').write_text(json.dumps({'version':'1.1.2','package':'com.zxn.palou.uiqa','device':'Android 15 / API 35 emulator-5582',
    'representativeStates':True,'sourceBoardSheetsUseDifferentHomeScale':True,'exactPixelEqualityClaimed':False,
    'density':2,'rawViewport':[780,1834],'cropSystemBars':{'top':98,'bottom':48},'states':manifest},ensure_ascii=False,indent=2),encoding='utf-8')

focus=[('home','主操作',(10,90,380,310)),('history','成果与筛选',(10,115,380,450)),
 ('settings','播报控件',(24,180,370,450)),('summary','成果与轮次',(16,270,375,630)),
 ('share','海报字体',(30,90,360,500)),('onboarding-1','引导排版',(15,365,375,605)),
 ('privacy','协议密度',(24,145,368,730)),('rename','名称输入与操作',(16,415,375,680))]
(OUT/'focused').mkdir(exist_ok=True)
for key,label,box in focus:
    ref=Image.open(OUT/'reference'/f'{key}.png').crop(box)
    actual=Image.open(OUT/'actual'/f'{key}.png').crop(box)
    canvas=Image.new('RGB',(ref.width*2+20,ref.height+30),'#343230')
    canvas.paste(ref,(0,30));canvas.paste(actual,(ref.width+20,30))
    d=ImageDraw.Draw(canvas);d.text((5,8),'REFERENCE',fill='white');d.text((ref.width+25,8),'ANDROID',fill='white')
    canvas.save(OUT/'focused'/f'{key}.png')

data=json.dumps(manifest,ensure_ascii=False)
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>循阶 1.1.2 · 原生实现对照</title><style>
*{box-sizing:border-box}body{margin:0;background:#121110;color:#f5f0ea;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}a{color:#ff8a44}header{padding:36px max(20px,calc((100vw - 1200px)/2));border-bottom:1px solid #35302b}h1{font-size:32px;line-height:1.3;margin:0 0 10px}p{margin:8px 0;color:#c4bcb2}header .tag{color:#ff7a2e;font-weight:700}main{max-width:1240px;margin:auto;padding:24px 20px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}button{cursor:pointer;border:1px solid #494039;border-radius:20px;padding:10px 18px;background:#201d19;color:#e8e0d6;font:inherit}button.active{color:#17120e;background:#ff7a2e;border-color:#ff7a2e}.controls{display:flex;gap:18px;align-items:center;flex-wrap:wrap;background:#211e1a;padding:14px 18px;border-radius:16px;margin-bottom:18px}select{font:inherit;background:#121110;color:#f5f0ea;border:1px solid #5b5148;border-radius:8px;padding:6px}label{display:flex;gap:10px;align-items:center}input[type=range]{accent-color:#ff7a2e}#cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,700px),1fr));gap:24px}article{padding:18px;background:#1c1a18;border-radius:20px}h2{margin:0;font-size:21px}.meta{font-size:13px;color:#a99f93;margin:4px 0 14px}.pair{display:flex;gap:16px;justify-content:center;align-items:start}.shot{width:min(48%,390px)}.shot p{margin:0 0 8px;color:#eae2d8;font-weight:700}.shot img{width:100%;display:block;border-radius:4px}.overlay{position:relative;width:min(100%,390px);margin:auto}.overlay img{width:100%;display:block}.overlay img:last-child{position:absolute;left:0;top:0;opacity:var(--opacity,.5)}details{margin-top:20px;background:#1c1a18;padding:18px;border-radius:18px}summary{cursor:pointer;font-weight:700}.extras{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-top:16px}.extras img{width:100%;display:block}footer{padding:32px 20px;color:#bcb3a8;max-width:1240px;margin:auto}.hidden{display:none!important}@media(max-width:620px){h1{font-size:25px}.pair{gap:8px}article{padding:12px}header{padding:24px 20px}}
</style><header><div class="tag">循阶 · 1.1.2 / 11</div><h1>从视觉稿到真实原生界面</h1><p>10 个页面 · 23 个代表状态。左侧为批准的视觉稿，右侧为 Android 原生运行截图。</p><p>390 × 844 dp；四张弹窗按原稿 390 × 697 dp 对照。测试样本与正式应用数据分开。</p><p><a href="../../visual-redraw-1.1.2-20261010/index.html">原始设计图册</a> · <a href="../../../design-qa.md">视觉验收报告</a> · <a href="runtime-checks.json">原生操作记录</a> · <a href="manifest.json">截图清单与哈希</a></p></header><main>
<nav id="filters" aria-label="页面筛选"></nav><div class="controls"><label>比较方式 <select id="mode"><option value="pair">并排比较</option><option value="overlay">叠加比较</option></select></label><label id="blend" class="hidden">实图透明度 <input id="opacity" type="range" min="0" max="100" value="50"></label><span id="count"></span></div><div id="cards"></div>
<details><summary>验收边界与预期差异</summary><p>参考图使用示例数据。实际界面按本机记录计算数值，热量、日期、楼号和连续训练周数不会被硬编码成图片数据。</p><p>图册规范要求平面图标和稳定色块。原稿生成纹理、局部图标形状、操作系统状态栏、键盘和导航条不作为复制目标。完整隐私正文、后台权限与原有设置功能保留。</p><p>图06弹窗背后的首页比例和图01不一致，实现统一采用图01。生成稿未提供字体文件；字形与部分细小间距仍有P3差异，未宣称逐像素100%相同。</p><p>训练阶段截图复用真实界面，由隔离的开发入口提供状态；它们证明界面覆盖，不证明真实爬楼识别准确率。诊断截图读取模拟器传感器，不能替代手机爬楼验证。</p><p><a href="../../UI_IMPLEMENTATION_1.1.2_20261010.md">完整交付说明</a> · <a href="../../../artifacts/ui-redraw-1.1.2-20261010/steploop-1.1.2-ui-internal.apk">Android独立内部APK</a> · <a href="release-checks.json">独立启动与旧数据保留证明</a></p></details>
<details><summary>额外操作与适配截图</summary><div id="extras" class="extras"></div></details></main><footer>可直接点击图片查看原始像素。最终安装包、测试结果和数据保留记录见交付说明。</footer><script>
const states=__DATA__;let page='全部';const filters=document.querySelector('#filters'),cards=document.querySelector('#cards'),mode=document.querySelector('#mode'),opacity=document.querySelector('#opacity');
['全部',...new Set(states.map(s=>s.page))].forEach(name=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>{page=name;render()};filters.append(b)});
function shot(path,label){return `<div class="shot"><p>${label}</p><a href="${path}" target="_blank"><img loading="lazy" src="${path}" alt="${label}"></a></div>`}
function render(){[...filters.children].forEach(b=>b.classList.toggle('active',b.textContent===page));const list=states.filter(s=>page==='全部'||s.page===page);document.querySelector('#count').textContent=`${list.length} 个状态`;cards.innerHTML=list.map(s=>`<article><h2>${s.page} · ${s.title}</h2><div class="meta">${s.viewport.join(' × ')} dp · ${s.key}</div>${mode.value==='pair'?`<div class="pair">${shot(s.reference,'视觉稿')}${shot(s.actual,'原生运行')}</div>`:`<div class="overlay"><img src="${s.reference}" alt="视觉稿"><img src="${s.actual}" alt="原生运行"></div>`}</article>`).join('');document.querySelector('#blend').classList.toggle('hidden',mode.value!=='overlay')}
mode.onchange=render;opacity.oninput=()=>document.documentElement.style.setProperty('--opacity',opacity.value/100);render();
fetch('extras.json').then(r=>r.json()).then(list=>document.querySelector('#extras').innerHTML=list.map(s=>`<a href="actual/${s}.png" target="_blank"><img loading="lazy" src="actual/${s}.png" alt="${s}">${s}</a>`).join(''));
</script></html>'''.replace('__DATA__',data)
(OUT/'index.html').write_text(html,encoding='utf-8')
extras=[p.stem for p in (OUT/'actual').glob('*.png') if p.stem not in {s[0] for s in STATES} and p.stem not in {'home-first','interaction-failure'}]
(OUT/'extras.json').write_text(json.dumps(extras,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'states':len(manifest),'focused':len(focus),'extras':len(extras)}))
