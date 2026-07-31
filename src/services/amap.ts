// 高德 JS API 配置（WebView 内嵌地图使用）。
//
// 说明：
// - JS API 的 key 与安全密钥随 App 包一起分发（WebView 加载内嵌 HTML），
//   无法在客户端做到保密，这是前端 SDK 的通用模型
// - 高德开放平台 Web 端 JS API 提供「域名白名单」：在控制台为应用配置授权
//   域名后，未列入白名单的来源会被拒绝
// - 当前为个人开发者免费 key（官方说明：免费不限调用次数，仅限 QPS）
// - 上线/上架前请按需处理：
//   1) 若以内置 WebView 加载（file:// 或 data: 来源），通常配合
//      securityJsCode 即可，无需域名白名单
//   2) 若未来改用 Web 端部署或遇到被拒访问，请在控制台申请正式 key 并配置
//      实际使用域名的白名单

export const AMAP_JS_KEY = '86de9d2ef905545ffefa7e8559ebbfbd'
export const AMAP_SECURITY_CODE = '1fc0d516d6c4a6f0fca7ee7873e9cb9d'
