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

// Expo CLI 会在构建时静态替换 EXPO_PUBLIC_*。高德 JS Key 本质上仍会出现在
// 客户端包内，因此生产环境还必须在高德控制台限制应用来源并定期轮换。
export const AMAP_JS_KEY = process.env.EXPO_PUBLIC_AMAP_JS_KEY?.trim() ?? ''
export const AMAP_SECURITY_CODE =
  process.env.EXPO_PUBLIC_AMAP_SECURITY_CODE?.trim() ?? ''

export function assertAmapConfigured(): void {
  if (!AMAP_JS_KEY || !AMAP_SECURITY_CODE) {
    throw new Error(
      '地图服务尚未配置。请设置 EXPO_PUBLIC_AMAP_JS_KEY 和 EXPO_PUBLIC_AMAP_SECURITY_CODE。',
    )
  }
}
