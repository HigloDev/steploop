"""Seal the current audit after fresh visual review and standalone acceptance."""
import hashlib
import html
import json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/ui-audit-20261010'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name, data): (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
def esc(value): return html.escape(str(value), quote=True)

findings = json.loads((OUT/'findings.json').read_text(encoding='utf-8'))
history = json.loads((OUT/'interaction-checks.json').read_text(encoding='utf-8'))
latest = {case['case']: case for case in history}
assert all(case['result']=='passed' for case in latest.values()), 'Unresolved interaction check'
visual = json.loads((OUT/'visual-review.json').read_text(encoding='utf-8'))
assert visual['unresolvedFindings']==0 and visual['primaryStatesReviewed']==23
release = json.loads((OUT/'release/release-checks.json').read_text(encoding='utf-8'))
assert release['standaloneColdStart'] and release['releaseFixtureCodeExcluded']
assert release['oldStoredValuesPreserved'] and release['savedWorkoutSurvivesColdStart']
assert release['installedPackageHashMatches']
logo = json.loads((OUT/'logo-checks.json').read_text(encoding='utf-8'))

before_hashes = json.loads((ROOT/'.expo-export-check/ui-audit-20261010/before-source-hashes.json').read_text(encoding='utf-8'))
changed = [name for name, sha in before_hashes.items() if (ROOT/name).exists() and digest(ROOT/name)!=sha]
protected = [name for name in before_hashes if name.startswith(('src/core/','src/services/','src/hooks/'))]
assert not set(protected).intersection(changed), 'Business logic changed during visual audit'
source = {}
for path in sorted((ROOT/'src').rglob('*')):
    if not path.is_file() or 'dev' in path.relative_to(ROOT/'src').parts: continue
    name = path.relative_to(ROOT).as_posix()
    assert digest(path)==digest(Path('G:/pui112')/name), 'Build checkout mismatch: ' + name
    source[name] = digest(path)
for name in ['App.tsx','app.json','index.ts']:
    assert digest(ROOT/name)==digest(Path('G:/pui112')/name), 'Build entry mismatch: ' + name
    source[name]=digest(ROOT/name)
apk = ROOT/'artifacts/ui-audit-1.1.2-20261010/steploop-1.1.2-ui-audit.apk'
assert digest(apk)==release['apkSha256']
now = datetime.now(timezone.utc).isoformat()
write('source-checks.json', {'capturedAt':now,'checkout':str(ROOT),'protectedBusinessFiles':len(protected),
    'businessFilesUnchanged':True,'changedExistingFiles':changed,'productionSourceMatchesBuiltCheckout':True,
    'productionSourceHashes':source,'apkSha256':digest(apk),'physicalDeviceInstalled':False})

states = json.loads((ROOT/'docs/qa/ui-redraw-20261010/manifest.json').read_text(encoding='utf-8'))['states']
for state in states:
    key=state['key']
    state['reference']='after/reference/'+key+'.png'
    state['before']='before/actual/'+key+'.png'
    state['after']='after/actual/'+key+'.png'
    for kind in ['reference','before','after']:
        path=OUT/state[kind]
        assert Image.open(path).size==tuple(state['viewport']), (key,kind,Image.open(path).size)
        state[kind+'Sha256']=digest(path)
    state['afterCapturedAt']=json.loads((OUT/'after/metadata'/f'{key}.json').read_text(encoding='utf-8'))['capturedAt']
    state.pop('actual',None);state.pop('compare',None);state.pop('actualSha256',None)

evidence = {
 'A01':['release/actual/release-launcher.png','release/launch-frames/cold-start-1.png','logo-preview.png'],
 'A02':['after/actual/home.png','after/actual/history.png','after/actual/template.png'],
 'A03':['after/actual/history.png','after/actual/history-more.png','after/actual/history-more-detail.png','after/actual/history-more-share.png'],
 'A04':['after/actual/climbing.png','after/actual/descending.png'],
 'A05':['after/actual/summary.png','after/actual/round-corrected.png'],
 'A06':['after/actual/template.png','after/actual/template-cleared.png','after/actual/template-saved-home.png'],
 'A07':['after/actual/onboarding-1.png','after/actual/onboarding-3.png','after/actual/save-failed.png'],
 'A08':['after/actual/settings.png','after/actual/settings-help-end.png','after/actual/font125-settings.png','after/actual/small130-settings.png'],
 'A09':['after/actual/privacy-reject.png','after/actual/privacy-exited.png'],
 'A10':['after/actual/font125-climbing.png','after/actual/font125-calibrating.png'],
 'A11':['after/actual/settings-lower.png','after/actual/share.png'],
 'A12':['after/actual/waiting.png','after/actual/normal-climbing-101.png','after/actual/small130-climbing-101.png'],
 'A13':['after/actual/small130-onboarding.png','after/actual/small130-onboarding-3.png','after/actual/small130-settings.png'],
 'A14':['review/actual/small130-edit-150-before.png','after/actual/small130-edit-150.png'],
 'A15':['review/actual/light-summary-before.png','after/actual/light-summary.png'],
 'A16':['review/actual/legacy-splits-before.png','after/actual/legacy-splits.png'],
}
for finding in findings['findings']:
    finding.update(status='closed', reviewedAt=now, after=evidence[finding['id']], verification='Fresh screenshots reviewed; relevant final interaction checks passed')
    assert all((OUT/name).exists() for name in finding['after'])
    finding['beforeEvidence']=[]
    for key in finding['before']:
        name=key.removeprefix('../')+'.png' if key.startswith('../review/') else ('before/raw/'+key+'.png' if key=='00-launcher-before' else 'before/actual/'+key+'.png')
        assert (OUT/name).exists(), name
        finding['beforeEvidence'].append(name)
findings['finalReview']={'closed':len(findings['findings']),'unresolved':0,'reviewedAt':now,
    'notAnAllFutureBugsGuarantee':True,'physicalPhoneInstalled':False}
write('findings.json',findings)
write('verification.json',{'sealedAt':now,'primaryPages':10,'primaryStates':23,
    'latestInteractionCases':len(latest),'latestInteractionPasses':len(latest),'historicalFailuresRetained':sum(c['result']=='failed' for c in history),
    'closedFindings':len(findings['findings']),'unresolvedFindings':0,'typescript':True,'gitDiffCheck':True,
    'qaIsolationTests':{'passed':2,'failed':0},'profiles':['390x844 dark','400x817 font125 dark','320x568 font130 dark','390x844 light'],
    'standaloneApk':True,'realClimbingAccuracyTested':False,'talkBackManualTested':False,'phoneInstalled':False})
rejected={'empty-home':'misnamed early fixture capture; not used as an empty-state acceptance image',
          'empty-history':'misnamed early fixture capture; not used as an empty-state acceptance image',
          'interaction-failure':'latest failing test-harness snapshot; history retained, not accepted evidence'}
extras=[]
for folder in ['after/actual','release/actual']:
    for path in sorted((OUT/folder).glob('*.png')):
        if folder=='after/actual' and (path.stem in {s['key'] for s in states} or path.stem in rejected): continue
        extras.append({'name':path.stem,'path':path.relative_to(OUT).as_posix(),'sha256':digest(path),
            'capturedAt':datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()})
write('manifest.json',{'sealedAt':now,'primaryPages':10,'states':states,'extras':extras,
    'excludedEarlyCaptures':rejected,'syntheticData':True,'statusBarsCroppedForComparison':True,
    'physicalPhoneIsOffline':True,'exactPixelEqualityClaimed':False,'productionApkSha256':digest(apk)})

rows=''.join(f'<tr><td>{f["id"]}<br>{f["priority"]}</td><td>{esc(f["problem"])}</td><td>{esc(f["fix"])}</td><td class="pass">已修复<br>复审通过</td></tr>' for f in findings['findings'])
page_groups=[('首页','开始、起始楼层、楼栋管理、重命名键盘、无楼栋状态'),('记录','筛选、趋势、更多菜单、详情修改、分享入口'),('设置','播报与体重持久化、后台提示、备份下载、CSV、取消导入'),
 ('训练','五阶段、返回保护、短按与取消长按、保存失败恢复、独立包实际保存与放弃'),('结算 / 详情','单位与图表、层数修改重算和持久化、150 层边界、模板清空与保存'),
 ('分享','四模板、文案和尺寸编辑、三比例 PNG、系统分享取消、复制脱敏数据'),('新手引导','全部三步、125% 与 130% 字体、完整说明滚动和完成'),
 ('隐私协议','七项完整正文、首次拒绝实际退出、同意记录和首次引导、从设置返回'),('旧版单轮成绩','修正入口、单层用时、完整信息展开'),('传感器诊断','配置、原生采样、标记、无效样本脱敏导出')]
health=''.join(f'<tr><td>{i}. {esc(title)}</td><td>{esc(scope)}</td><td class="pass">通过</td></tr>' for i,(title,scope) in enumerate(page_groups,1))
checks=''.join(f'<li><span class="pass">通过</span> {esc(c["case"])}</li>' for c in latest.values())
document='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>循阶 1.1.2 · 审计与复审</title>
<style>*{box-sizing:border-box}body{margin:0;background:#11100f;color:#f7f5f2;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}a{color:#ff9b5d}header,main,footer{max-width:1400px;margin:auto;padding:28px 22px}header{border-bottom:1px solid #3b332c}h1{font-size:34px;line-height:1.3;margin:0 0 14px}h2{font-size:23px;margin:0 0 12px}p{color:#cdc4b9}nav{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button,select{font:inherit;color:#eee6dc;background:#24201c;border:1px solid #52483f;border-radius:14px;padding:9px 14px;cursor:pointer;min-height:44px}button.active{background:#ff7a2e;color:#17120e;border-color:#ff7a2e}.pass{color:#8bd8a8;font-weight:700}.brand{display:flex;gap:24px;align-items:center}.brand img{width:108px;border-radius:24px}.brand p{margin:4px 0}.cards{display:grid;gap:24px}article,details{background:#1d1a17;padding:20px;border-radius:20px;margin-bottom:22px}.triple{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.triple img{width:100%;max-width:390px;display:block;margin:auto}.triple p{text-align:center;font-weight:700}.meta{font-size:13px;color:#b0a394}.extras{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:18px}.extras img{width:100%;display:block}.extras a{font-size:13px;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #40382f;vertical-align:top}th{color:#ffab76}summary{cursor:pointer;font-weight:700;font-size:19px}.table-wrap{overflow:auto}li{margin-bottom:10px}.controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.logo-preview{max-width:100%;display:block;background:#e5e0d9;border-radius:12px}@media(min-width:1000px){article{padding:24px 34px}}@media(max-width:600px){h1{font-size:26px}.triple{gap:8px;min-width:720px}.comparison-scroll{overflow:auto}article{padding:12px}.brand{gap:14px}.brand img{width:72px}td{min-width:140px}}</style>
<header><h1>循阶 1.1.2 · 审计与复审</h1><p class="pass">10 个页面 · 23 个批准画面 · FINDING_COUNT 项问题已修复 · 本轮审计范围内 0 项未关闭</p>
<p>对照批准设计，先记录当前原生画面，实施修正，再重新截图和操作验收。下方三栏分别是设计稿、修改前、修改后。</p>
<p><a href="AUDIT.md">完整报告</a> · <a href="findings.json">问题与方案</a> · <a href="verification.json">复审结果</a> · <a href="manifest.json">截图时间与哈希</a> · <a href="../../../artifacts/ui-audit-1.1.2-20261010/steploop-1.1.2-ui-audit.apk">新版内部 APK</a></p>
<p>测试使用隔离 Android 包和合成记录；独立 APK 另作冷启动与旧数据保留验证。本轮手机离线，尚未安装到手机。</p></header><main>
<article class="brand"><a href="../../../assets/brand/audit-icon.png"><img src="../../../assets/brand/audit-icon.png" alt="黑橙新版循阶 Logo"></a><div><h2>统一黑橙品牌</h2><p>暖橙 #FF7A2E · 近黑 #11100F · 人物向上爬三阶。</p><p>App、海报、桌面、启动、自适应、单色和通知共用同一母版。</p><p><a href="logo-preview.png">24px 到系统遮罩的检查</a> · <a href="release/actual/release-launcher.png">实际桌面图标</a> · <a href="release/launch-frames/cold-start-1.png">实际启动画面</a> · <a href="../../../assets/brand/AUDIT-20261010.md">资产说明</a></p><p class="meta">桌面截图的黑橙图标为 com.zxn.palou；旁边蓝色图标为隔离测试包。</p></div></article>
<details><summary>逐页审计范围与状态</summary><div class="table-wrap"><table><thead><tr><th>页面</th><th>覆盖路径</th><th>复审</th></tr></thead><tbody>HEALTH</tbody></table></div></details>
<details><summary>FINDING_COUNT 项问题、修改方案与复审</summary><div class="table-wrap"><table><thead><tr><th>编号</th><th>发现的问题</th><th>已实施方案</th><th>结果</th></tr></thead><tbody>FINDINGS</tbody></table></div></details>
<nav id="filters" aria-label="页面筛选"></nav><div class="controls"><label>显示 <select id="mode"><option value="all">设计稿 / 修改前 / 修改后</option><option value="final">仅修改后</option></select></label><span id="count"></span></div><div id="cards" class="cards"></div>
<details><summary>大字体、小屏、浅色与额外操作截图</summary><div id="extras" class="extras"></div></details>
<details><summary>最终操作检查</summary><p>每项以下列最后一次结果为准；<a href="interaction-checks.json">原始记录</a>保留早期失败及重测，未删除失败历史。</p><ul>CHECKS</ul><p><a href="release/release-checks.json">独立安装包检查</a> · <a href="source-checks.json">源码与构建一致性、业务文件保护</a></p></details>
<details open><summary>核验边界</summary><p>主图统一 390 × 844 dp；四张弹层按批准稿使用 390 × 697 dp。另检查 400 × 817 dp / 125% 字体、320 × 568 dp / 130% 字体、浅色主题、三位数楼层与实际键盘。</p><p>真实数据按业务计算；生成稿纹理和局部字形不作为实现规范。用户后来要求训练页常驻保存和放弃按钮，已作为批准稿的明确交互变更保留。没有宣称逐像素相同。</p><p>0 项未关闭仅指本轮明确范围。未做全部 OEM 机型、TalkBack 人工验收和真实楼梯识别准确率验收。手机尚未安装；当前 APK 为沿用原证书的内部包。</p></details></main><footer>截图来自实际 Android 界面；裁除系统栏和统一显示尺寸仅用于对照，没有把设计图片覆盖到运行界面。原始截图及无效早期抓图均保留。</footer>
<script>const states=STATES,extra=EXTRAS;let page='全部';const filters=document.querySelector('#filters'),cards=document.querySelector('#cards'),mode=document.querySelector('#mode');['全部',...new Set(states.map(s=>s.page))].forEach(name=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>{page=name;render()};filters.append(b)});function shot(path,label){return `<div><p>${label}</p><a href="${path}" target="_blank"><img loading="lazy" src="${path}" alt="${label}"></a></div>`}function render(){[...filters.children].forEach(b=>b.classList.toggle('active',b.textContent===page));const list=states.filter(s=>page==='全部'||s.page===page);document.querySelector('#count').textContent=list.length+' 个画面';cards.innerHTML=list.map(s=>`<article><h2>${s.page} · ${s.title}</h2><p class="meta">${s.viewport.join(' × ')} dp · ${s.key} · 最终截图 ${s.afterCapturedAt}</p>${mode.value==='all'?`<div class="comparison-scroll"><div class="triple">${shot(s.reference,'批准视觉稿')}${shot(s.before,'修改前原生')}${shot(s.after,'修改后原生')}</div></div>`:`<div style="max-width:390px;margin:auto">${shot(s.after,'修改后原生')}</div>`}</article>`).join('')}mode.onchange=render;render();document.querySelector('#extras').innerHTML=extra.map(s=>`<a href="${s.path}" target="_blank"><img loading="lazy" src="${s.path}" alt="${s.name}">${s.name}</a>`).join('');</script></html>'''
for token,value in [('FINDING_COUNT',str(len(findings['findings']))),('HEALTH',health),('FINDINGS',rows),('CHECKS',checks),('STATES',json.dumps(states,ensure_ascii=False)),('EXTRAS',json.dumps(extras,ensure_ascii=False))]: document=document.replace(token,value)
(OUT/'index.html').write_text(document,encoding='utf-8')

lines=['# 循阶 1.1.2 完整界面审计与复审','',f'复审时间：{now}。审计对象：{ROOT}。Android 1.1.2 / 11。','',
 f'共发现并实施 {len(findings["findings"])} 项问题；本轮范围内复审 0 项未关闭。10 个注册页面、23 个批准画面，以及字体、主题、滚动、键盘和边界状态纳入验收。',
 '', '[打开三栏对照图册](index.html) · [问题与方案](findings.json) · [截图清单](manifest.json) · [最后操作结果](verification.json)', '', '## 逐页范围与健康状态','',
 '| 页面 | 本轮检查 | 状态 |','|---|---|---|']
lines.extend(f'| {i}. {title} | {scope} | 通过 |' for i,(title,scope) in enumerate(page_groups,1))
lines.extend(['','## 问题与实施',''])
for finding in findings['findings']:
    links=' · '.join(f'[证据 {i}]({path})' for i,path in enumerate(finding['after'],1))
    lines.extend([f'### {finding["id"]} / {finding["priority"]} / 已关闭','',finding['problem'],'',finding['fix'],'',links,''])
lines.extend(['## 复审证据','',f'- {len(latest)} 项操作用例最后结果全部通过；原始记录保留 {sum(c["result"]=="failed" for c in history)} 次早期失败。真实 UI 边界错误已修复，启动时机、测试常量和横向模板查找的脚本错误也已更正并复测。',
 '- TypeScript、差异空白检查和两项隔离包测试通过。',f'- {len(protected)} 个既有核心、服务和 hook 文件哈希与审计前相同；所有生产页面源码与实际构建目录一致。',
 '- 独立 APK 在关闭 QA Metro 后覆盖安装、冷启动，首页/记录/设置可打开；原有存储不变，真实生产 hook 保存两层恰好一次并可重启恢复。',
 '- 四海报模板可选择，三比例导出实际 PNG 为 1080×1350、1080×1080、1080×1440；系统分享取消未记为成功。',
 '- Logo 检查包括小尺寸、alpha 噪声、自适应安全圆、单色资源和实际 Android 启动图。', '', '## 安装包','',
 '[循阶 1.1.2 审计内部 APK](../../../artifacts/ui-audit-1.1.2-20261010/steploop-1.1.2-ui-audit.apk)', '',
 f'SHA-256：`{release["apkSha256"]}`。大小 {release["apkBytes"]:,} 字节，arm64-v8a / x86_64。沿用原 Android Debug 内部证书，未作为商店公开发行包。', '',
 '## 本轮边界','', '手机当前离线，本轮未安装到物理手机。布局矩阵按手机 125% 字体补验，但模拟器不替代 OEM 真机或真实爬楼准确率验收。尚未进行 TalkBack 人工朗读或全部设备组合验证。', '',
 '批准稿为生成图像，允许示例数据、生成纹理、字体细节与实际界面存在规范中明确的差异。训练页常驻保存和放弃按钮遵循用户后续明确要求。0 项未关闭只代表本轮列明范围内的发现已闭环，不是所有未来状态绝无缺陷的保证。', '',
 '原有蓝色母版、审计前源码与资源、旧版密封报告和私有数据备份均保留；不清空、不卸载、不自动导入。全部公开测试记录为隔离包合成数据；诊断导出标为无效模拟器样本。'])
(OUT/'AUDIT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'sealed':True,'pages':10,'primaryStates':23,'closedFindings':len(findings['findings']),'latestCases':len(latest),'extraCaptures':len(extras),'apkSha256':digest(apk)},ensure_ascii=False))
