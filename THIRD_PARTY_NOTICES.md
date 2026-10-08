# 第三方与素材说明

## 代码

项目根目录保留既有 MIT License 和 Expo 版权声明。新增项目代码随现有项目许可提供。依赖各自的许可证随对应 npm 包提供；`package-lock.json` 固定构建依赖，不能据此改变依赖自身许可。

## 品牌与插画

品牌人物爬楼图标为项目通过图像生成工具制作的资源，来源和派生方式见 `assets/brand/README.md`。楼梯插画与分享背景随源码保留，不包含真人照片。

## 预录语音

1.0.5 使用本机运行的 [Qwen3-TTS-12Hz-0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) 生成固定语音，选择官方预置 Uncle_Fu、Dylan、Serena、Vivian 四种音色。不使用真人参考录音或声音克隆，不使用在线 Edge 语音服务。

官方模型页面和 [Qwen3-TTS 代码仓库](https://github.com/QwenLM/Qwen3-TTS) 标记 Apache-2.0。许可文本保留在 `assets/voice/LICENSE-QWEN.txt`；生成来源、204 段素材文字、尺寸与 SHA-256 保留在 `assets/voice/manifest.json`，生成脚本随素材保留。手机仅播放固定素材和数字片段，无需下载模型或联网合成。模型权重没有随 APK 分发。

旧 1.0.4 使用在线服务生成的 51 段素材，其分发依据没有得到确认；旧 APK 和源码 ZIP 继续保留在维护者可见的旧草稿中，不作为本次公开下载附件。旧素材在本地已备份，1.0.5 包内不保留旧语音文件。

## 地图

可选高德 WebView 地图使用配置者自己的客户端凭据。公开候选构建禁用本机 `.env.local`，不嵌入维护者凭据。自行启用时需遵守地图服务约定，不将客户端 Key 当成秘密。
