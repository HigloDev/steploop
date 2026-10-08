# 爬楼训练语音反馈

实施日期：2026-10-04。范围：当前 Android 应用；语音资源及事件规则可复用。

## 产品决定

- 默认开启标准播报，可在全局设置和训练时选择精简、标准、教练或关闭；关闭会立即停止正在播放的语音。
- 精简只播本轮完成、返回起点、整场完成；标准增加新轮开始、时间、消耗、电梯下行和确认修正；教练再增加步数、楼层和长时间休息提醒。
- 时间里程碑默认为 20、30、40、60、90、120 分钟。
- 消耗里程碑默认为 100、200、300、500 千卡，播报中明确“约”以说明估算属性。
- 步数里程碑默认为 1000、3000、5000、10000 步；楼层里程碑为 10、20、30、40、50、60 层，此后每 10 层继续。步数、楼层和休息提醒默认由教练模式播报。
- 每轮完成后休息达到 3 分钟，教练模式轻声提醒一次；电梯返回时间不触发此提醒。
- 鼓励由独立录音构成，可关闭；开启时轮换文案池，避免相邻重复。关闭后固定单位和完成确认仍正常播报。
- 语速可选 0.8、1、1.2 倍；支持仅蓝牙输出、压低音乐，以及本地时间 22:00 至次日 07:00 静音。蓝牙不可用、未允许压低且音乐正在播放或处于夜间静音时，日志记录抑制，不能记为已播放。
- 完成本轮、实际开始下一轮、结束整场、修正楼层均有反馈。自动与全自动模式还可播报实际检测到的电梯下行与确认返回起点。
- “正在乘电梯”只能由电梯检测结果触发，不能因用户打开返回阶段就声称在电梯里；“已返回”只能由实际确认事件触发。
- 回到起点播报“准备好了，再开始下一轮”，实际爬升后才播报“第 N 轮开始”。
- 同一事件只播一次。恢复中断训练时不重播过去的轮次和里程碑；一次跳过多个时间/卡路里阈值，只播最新阈值。
- 首次完成且已修正楼层时，将确认楼层并入同一个完成播报。例如“第 1 轮完成，爬升了 14 层……已按你确认的 15 楼保存”；后续再次修改同轮时再独立播报修正，既往恢复快照保持静音。
- 结束整场优先于其余提示，并取消已过时的排队内容。队列串行播放，默认相邻播报间隔至少 600 毫秒。
- 成果数字使用本次累计实际爬升层数。例如实际累计 73 层，最终语音就是 73 层，不固定为 60 层。

## 音频资源与来源

`assets/voice/catalog.json` 是固定文案源，`manifest.json` 记录每段的文案、字节数和 SHA-256。资源版本 2 当前共 51 段，含固定语句/单位、步数/楼层/休息文案、独立鼓励池、十进制数字、十百千万和负号、小数点。旧组合素材保留兼容，但默认模板采用纯单位和可关闭的独立鼓励。

素材为 **构建时通过在线神经语音服务生成、随后随应用打包的预录音频**，并非真人录音。当前发音人 `zh-CN-XiaoxiaoNeural`，语速 -5%，单声道 24 kHz MP3；生成脚本用 ffmpeg 剪除多余首尾静音并统一至 -18 LUFS。

构建时生成方式来自 [edge-tts 项目说明](https://github.com/rany2/edge-tts)。运行中的应用不调用该服务、不上传训练信息，也不依赖在线生成固定句子。可随时将固定素材替换为产品自己的真人录音，保持 ID 与资源格式即可；替换后应更新 manifest 并重新构建。

重新生成：

```powershell
python assets/voice/generate-assets.py
```

此命令需要 edge-tts、ffmpeg 和网络；仅用于制作素材，不是应用运行时依赖。

## 播放方案

`AndroidWorkoutVoice` 原生模块使用 MediaPlayer 串行播放素材。动态数字经过严格验证，只允许带正负号的最多六位十进制数字及两位小数，随后交给 Android TextToSpeech 合成单个数字。

**固定文案、单位和鼓励语全部是音频。TTS 没有任意句子接口，任何包含“分钟”“楼”或其他文字的输入都会拒绝。**

数字 TTS 初始化失败、缺少中文发音或合成超过 5 秒时，使用已打包的中文数字片段按十百千万规则拼接。此降级仍能报出实际数字，只会增加片段感；不会把整句文案交给离线 TTS。播放日志的 `numericFallback` 会如实标明。

允许压低音乐时，整段播报取得可压低其他音乐的暂时音频焦点；关闭压低音乐且音乐活跃时抑制播报，否则在安静状态取得暂时焦点以处理来电等中断。播报结束、取消、失败后均释放焦点。不强制切换扬声器，遵从系统输出；仅蓝牙模式先静音检查实际路由，确认蓝牙后才放声，路由断开即停止。其他音频夺取焦点时停止当前播报，记录 `audio_focus_lost`，不恢复过时内容，也不影响训练。

实现依据已核对的 [Expo SDK 57 文档](https://docs.expo.dev/versions/v57.0.0/)、[Android 音频焦点接口](https://developer.android.com/reference/android/media/AudioFocusRequest) 与 [TextToSpeech 接口](https://developer.android.com/reference/android/speech/tts/TextToSpeech)。原生模块沿用本项目现有定位模块的 ReactPackage/config-plugin 注入方式，保留已使用的 SDK 57 / React Native 0.86 工程结构。

## 配置和接入

`src/core/voice-templates.json` 是可版本化替换的文案模板库（当前 `xiaoxiao-zh-cn / 2.0.0`）。每段模板由固定 clip ID、数值 slot、可选鼓励池构成，可配置优先级、过期时间和修正完成时追加的确认楼层片段。`parseVoiceTemplateLibrary()` 严格验证导入结构，拒绝任意文字 TTS、无效 clip ID 或未知数字 slot；调用 `setSettings({ templateLibrary: parsedLibrary })` 即可替换模板，无须修改触发代码。新增录音资源须一同打包；远程更新和更多发音人作为后续扩展，不展示尚未提供的角色选择。

默认时间、卡路里、步数、楼层阈值及休息提醒来自独立版本化配置 `src/core/voice-milestones.json`（当前 `1.0.0`）；训练设置快照保存该版本和实际生效数组，供电脑分析核对触发规则。

`VoiceSettings` 支持 `detailMode`、`enabled`、`volume`、`rate`、`bluetoothOnly`、`duckMusic`、`nightQuiet`、`encouragementEnabled`、时间/卡路里/步数/楼层阈值、单类事件开关和模板覆盖。`floorMilestoneInterval` 控制配置末尾之后的延伸步长（0 表示不延伸），`restReminderMinutes` 控制长休息阈值。用户从标准切换为教练或从静音恢复，不补播此前已跨过的里程碑。

示例：

```typescript
const voice = createWorkoutVoiceService({
  settings: { enabled: true, detailMode: 'standard', calorieMilestones: [100, 200, 300, 500] },
  onJournal: (entry) => updateVoiceStatus(entry),
})

voice.observe({
  workoutId: workout.id,
  mode: 'full_auto',
  phase: machine.phase,
  currentRoundNumber: machine.currentRoundNumber,
  elapsedMs: metrics.totalElapsedMs,
  calories: estimatedCalories,
  cumulativeFloors: actualCumulativeFloors,
  cumulativeSteps: metrics.steps,
  restElapsedMs: timer.phaseElapsedMs,
  startFloor: workout.routeSnapshot.startFloor,
  elevatorDescending: detector.elevatorDescending,
  completedRounds: workout.rounds.map((round) => ({
    id: round.id,
    roundNumber: round.roundNumber,
    floorsCompleted: actualRoundFloors(round),
    confirmedTopFloor: round.finalFloor,
    correctionRevision: round.corrections?.length ?? round.userCorrectionCount ?? 0,
    returnedToStartAt: round.returnedToStartAt,
  })),
})

voice.setSettings({ enabled: false })
// 结束整场已 observe(workout_complete) 后，导航可立即进行，结果播报继续排空。
await voice.finish(workout.id)
```

普通离开页面使用 `dispose()` 中断并释放资源；结束训练后应调用 `finish()` 排空最终结果，避免页面卸载立即取消成果播报。

构建注册 `./plugins/withAndroidVoiceModule.js`。该插件复制源码与全部 51 段音频至生成的 Android 工程，注册 AndroidVoicePackage，并加入 Android 11+ 数字 TTS 服务可见性查询。注册可重复执行，缺少素材时构建失败，避免静默缺音。

## 日志、导出与故障

每次排队、实际播完、失败、过期、关闭、取消、静音抑制和被成果播报替代均记录结构化日志，含 workoutId、eventId、事件类型、时间和结果。排队和结果记录文案库 ID/版本、模板 ID、详细程度；实际播放记录 clip IDs、数字文本、真正完成数字 TTS 音频播放的文本及引擎类型、音量/语速/路由策略、播放片段数、使用的引擎及数字降级标记。同段播报混用数字 TTS 和录音数字时，不能把录音数字误标为 TTS；旧模块不提供实际文本清单时，此字段保留未知。`playbackSource` 明确区分预录素材、预录加数字 TTS、预录数字降级；蓝牙或音乐抑制的结果为 `suppressed`，不声称完整播完，可单独记录中断前的片段数。

`src/services/voice-journal.ts` 使用独立的 per-workout AsyncStorage 键保存，串行写入；不改动已有训练记录。每次训练最多保留 1000 条结果。提供：

- `voice.getJournal()`：当前内存日志。
- `voice.flushJournal(workoutId)`：等待存储完成，失败明确抛出。
- `loadVoiceJournal(workoutId)`：读取保存的日志，供训练原始数据导出一起附带。
- `exportVoiceJournal(workoutId)`：导出可分享的 JSON 文件 URI。
- `voiceJournalWriteError(workoutId)`：查询最近存储错误。

存储写入失败不阻塞音频或训练，但不能声称日志已保存成功。临时失败保留最多 1000 条待写结果，后续写入成功时一并补存，不因一次空间不足丢掉先前已播结果；已有损坏日志保持原文，不静默覆盖。缺少原生模块的 Expo Go、Web 或 iOS 会记录 unavailable，不把震动冒充声音。

## 验证记录与能力边界

自动测试：`node --test scripts/test-voice.cjs scripts/test-voice-assets.cjs`，当前 32 项通过。验证真实资源哈希及 MP3 解码、插件全资源复制与幂等注册、数字限制、数字离线降级、四种详细程度、阈值去重与超过 60 层延伸、恢复不重播、休息提醒、首次人工修正确认楼层、版本化模板替换、可关与轮换鼓励、实际累计成果、队列优先级、取消、焦点错误、播放选项、静音抑制、夜间边界和主动中断、日志元数据、混合数字来源、临时写入失败恢复、持久化与导出。

这些测试证明代码和资源行为，不替代实际手机听感及耳机/蓝牙、后台、锁屏场景。Android 系统对后台请求音频焦点存在限制，本模块不自行宣称可以在没有训练前台服务的情况下持续后台记录或触发新播报。iOS 和 Web 尚无原生播放后端，当前必须明确呈现不支持，不承诺可用。

真机证据由整体验收记录统一登记；只有获取实际设备播放、打包资源与日志证据后，才可将相应项目标记为通过。
