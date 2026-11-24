// 「疾阶运动（motion-ring）」专属几何与磨砂光效组件：
// 直接提炼自应用 Logo（对角钴蓝底、冰蓝→青色开口圆头运动环、半透明三级圆角磨砂阶梯、克制端头光晕）。
// 全部由 src/theme.ts 语义 Token 驱动；所有装饰层不拦截触摸、不进入读屏顺序；进度环仅绑定真实业务数据。

import React, { memo, useId } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg'
import { isMotionRing, useTheme, type Theme } from '../theme'

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/** 生成从 startDeg 顺时针扫过 sweepDeg 的圆弧路径（0° 为正上方 12 点钟方向）。 */
function describeArc(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const clamped = Math.max(0.5, Math.min(359.5, sweepDeg))
  const start = polar(cx, cy, r, startDeg)
  const end = polar(cx, cy, r, startDeg + clamped)
  const largeArc = clamped > 180 ? 1 : 0
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

/** 设置页「疾阶运动」色卡徽章：一眼识别 Logo 对角钴蓝 + 冰青开口圆环 + 三级磨砂阶梯。 */
export const MotionRingLogoOrb = memo(function MotionRingLogoOrb({
  theme,
  size = 34,
}: {
  theme: Theme
  size?: number
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const v = theme.brandVisual
  const bgId = `morb-bg-${uid}`
  const ringId = `morb-ring-${uid}`
  const glowId = `morb-glow-${uid}`
  const clipId = `morb-clip-${uid}`
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" accessible={false}>
      <Defs>
        <LinearGradient id={bgId} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0%" stopColor={v.gradientStart} />
          <Stop offset="100%" stopColor={v.gradientEnd} />
        </LinearGradient>
        <LinearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={v.ringStart} />
          <Stop offset="62%" stopColor="#6BD2FF" />
          <Stop offset="100%" stopColor={v.ringEnd} />
        </LinearGradient>
        <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={v.ringGlow} stopOpacity={0.75} />
          <Stop offset="100%" stopColor={v.ringGlow} stopOpacity={0} />
        </RadialGradient>
        <ClipPath id={clipId}>
          <Circle cx={18} cy={18} r={9.2} />
        </ClipPath>
      </Defs>
      <Circle cx={18} cy={18} r={17} fill={`url(#${bgId})`} />
      {/* 12 点钟微弱光晕 */}
      <Circle cx={18} cy={6.2} r={5.4} fill={`url(#${glowId})`} />
      {/* 开口圆头运动环（留出顶部 12 点钟品牌缺口） */}
      <Path
        d={describeArc(18, 18, 12.2, 15, 330)}
        fill="none"
        stroke={`url(#${ringId})`}
        strokeWidth={2.9}
        strokeLinecap="round"
      />
      {/* 环内底部三级半透明磨砂圆角阶梯 */}
      <G clipPath={`url(#${clipId})`}>
        <Rect x={8} y={21.6} width={20} height={7} rx={2.2} fill="rgba(218, 240, 255, 0.54)" />
        <Rect x={13.5} y={18.4} width={15} height={10} rx={2.2} fill="rgba(224, 244, 255, 0.64)" />
        <Rect x={19} y={15.2} width={10} height={13} rx={2.2} fill="rgba(235, 248, 255, 0.78)" />
      </G>
    </Svg>
  )
})

/** 首页/引导/结算顶栏品牌角标底板：保留原始 BrandMark，不重画标志。 */
export const MotionBrandBadge = memo(function MotionBrandBadge({
  size = 36,
  children,
}: {
  size?: number
  children: React.ReactNode
}) {
  const theme = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const v = theme.brandVisual
  const bgId = `mbb-bg-${uid}`
  const radius = Math.round(size * 0.31)
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 36 36" style={StyleSheet.absoluteFill} accessible={false}>
        <Defs>
          <LinearGradient id={bgId} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0%" stopColor={v.gradientStart} />
            <Stop offset="100%" stopColor={v.gradientEnd} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={36} height={36} rx={11} fill={`url(#${bgId})`} />
        <Rect
          x={0.75}
          y={0.75}
          width={34.5}
          height={34.5}
          rx={10.25}
          fill="none"
          stroke="rgba(196, 236, 255, 0.42)"
          strokeWidth={1}
        />
      </Svg>
      {children}
    </View>
  )
})

/**
 * 品牌主卡底纹（首页「今日训练」/ 教练主卡 / 结算主卡）：
 * 左深右亮对角钴蓝底 + 右侧冰青开口运动环 + 整体半透明三级圆角磨砂阶梯。
 * 内置左/上/下三向深钴蓝可读性遮罩，保证复杂标题、右上胶囊控制与底部提示在大字号下始终高对比清晰。
 */
export const MotionHeroSurfaceArt = memo(function MotionHeroSurfaceArt({
  variant = 'home',
}: {
  variant?: 'home' | 'coach' | 'summary'
}) {
  const theme = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!isMotionRing(theme)) return null
  const v = theme.brandVisual
  const bgId = `mhero-bg-${uid}`
  const ringId = `mhero-ring-${uid}`
  const glowId = `mhero-glow-${uid}`
  const stairId = `mhero-st-${uid}`
  const clipId = `mhero-clip-${uid}`
  const leftMaskId = `mhero-lm-${uid}`
  const topMaskId = `mhero-tm-${uid}`
  const bottomMaskId = `mhero-bm-${uid}`

  const cx = variant === 'coach' ? 304 : variant === 'summary' ? 304 : 288
  const cy = variant === 'coach' ? 114 : variant === 'summary' ? 108 : 126
  const r = variant === 'coach' ? 60 : variant === 'summary' ? 64 : 70
  const innerR = r - 12
  const head = polar(cx, cy, r, 350)

  // 整体连续三级圆角阶梯轮廓（无叠加接缝，贴合内圆弧裁切）
  const s1x = cx - innerR * 0.92
  const s1y = cy + innerR * 0.34
  const s2x = cx - innerR * 0.32
  const s2y = cy + innerR * 0.04
  const s3x = cx + innerR * 0.24
  const s3y = cy - innerR * 0.26
  const rightX = cx + innerR * 1.05
  const bottomY = cy + innerR * 1.05
  const cr = Math.max(5, innerR * 0.14)
  const unifiedStepsPath = [
    `M ${s1x.toFixed(1)} ${bottomY.toFixed(1)}`,
    `V ${(s1y + cr).toFixed(1)} Q ${s1x.toFixed(1)} ${s1y.toFixed(1)} ${(s1x + cr).toFixed(1)} ${s1y.toFixed(1)}`,
    `H ${s2x.toFixed(1)}`,
    `V ${(s2y + cr).toFixed(1)} Q ${s2x.toFixed(1)} ${s2y.toFixed(1)} ${(s2x + cr).toFixed(1)} ${s2y.toFixed(1)}`,
    `H ${s3x.toFixed(1)}`,
    `V ${(s3y + cr).toFixed(1)} Q ${s3x.toFixed(1)} ${s3y.toFixed(1)} ${(s3x + cr).toFixed(1)} ${s3y.toFixed(1)}`,
    `H ${rightX.toFixed(1)} V ${bottomY.toFixed(1)} Z`,
  ].join(' ')

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 360 220"
        preserveAspectRatio="xMidYMid slice"
        accessible={false}
      >
        <Defs>
          <LinearGradient id={bgId} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0%" stopColor={v.gradientStart} />
            <Stop offset="58%" stopColor="#062F86" />
            <Stop offset="100%" stopColor={v.gradientEnd} />
          </LinearGradient>
          <LinearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={v.ringStart} />
            <Stop offset="52%" stopColor="#72D4FF" />
            <Stop offset="100%" stopColor={v.ringEnd} />
          </LinearGradient>
          <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={v.ringGlow} stopOpacity={0.42} />
            <Stop offset="55%" stopColor={v.ringGlow} stopOpacity={0.10} />
            <Stop offset="100%" stopColor={v.ringGlow} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id={stairId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#E4F4FF" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#8CC4FF" stopOpacity={0.10} />
          </LinearGradient>
          <LinearGradient id={leftMaskId} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#041954" stopOpacity={0.86} />
            <Stop offset="48%" stopColor="#05216A" stopOpacity={0.72} />
            <Stop offset="70%" stopColor="#05216A" stopOpacity={0.22} />
            <Stop offset="90%" stopColor="#05216A" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id={topMaskId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#041C5C" stopOpacity={0.68} />
            <Stop offset="34%" stopColor="#041C5C" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id={bottomMaskId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="58%" stopColor="#041852" stopOpacity={0} />
            <Stop offset="82%" stopColor="#041852" stopOpacity={0.68} />
            <Stop offset="100%" stopColor="#041852" stopOpacity={0.90} />
          </LinearGradient>
          <ClipPath id={clipId}>
            <Circle cx={cx} cy={cy} r={innerR} />
          </ClipPath>
        </Defs>

        {/* 对角深钴蓝→亮电蓝背景 */}
        <Rect x={0} y={0} width={360} height={220} fill={`url(#${bgId})`} />

        {/* 克制的 12 点钟端头光晕 */}
        <Circle cx={head.x} cy={head.y} r={24} fill={`url(#${glowId})`} />

        {/* 整体半透明三级圆角磨砂阶梯（沿圆环内底弧裁切，无重叠接缝） */}
        <G clipPath={`url(#${clipId})`}>
          <Path d={unifiedStepsPath} fill={`url(#${stairId})`} />
          <Path
            d={`M ${(s1x + cr).toFixed(1)} ${s1y.toFixed(1)} H ${s2x.toFixed(1)} M ${(s2x + cr).toFixed(1)} ${s2y.toFixed(1)} H ${s3x.toFixed(1)} M ${(s3x + cr).toFixed(1)} ${s3y.toFixed(1)} H ${rightX.toFixed(1)}`}
            stroke="rgba(244, 251, 255, 0.42)"
            strokeWidth={1.3}
            strokeLinecap="round"
          />
        </G>

        {/* 开口圆头冰蓝→亮青运动环 */}
        <Path
          d={describeArc(cx, cy, r, 14, 336)}
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth={variant === 'coach' ? 9.5 : 10.5}
          strokeLinecap="round"
          strokeOpacity={variant === 'summary' ? 0.50 : variant === 'coach' ? 0.58 : 0.76}
        />

        {/* 左/上/下三向深钴蓝可读性保护遮罩：隔离装饰与前景文案/按钮 */}
        <Rect x={0} y={0} width={360} height={220} fill={`url(#${leftMaskId})`} />
        <Rect x={0} y={0} width={360} height={220} fill={`url(#${topMaskId})`} />
        <Rect x={0} y={0} width={360} height={220} fill={`url(#${bottomMaskId})`} />

        {/* 卡片顶部细冰光描边 */}
        <Path d="M 18 1 H 342" stroke="rgba(202, 238, 255, 0.36)" strokeWidth={1.2} strokeLinecap="round" />
      </Svg>
    </View>
  )
})

/**
 * 真实数据驱动的开口运动环（教练周进度、训练楼栋实时进度、引导页）：
 * - progress ∈ [0, 1] 必须来自真实业务数据；为 0 时仅显示净底轨，绝不伪造装饰进度。
 * - estimated=true 时切为琥珀虚线轨道，保留估算语义不误读。
 */
export const MotionRingArc = memo(function MotionRingArc({
  progress,
  size = 64,
  strokeWidth = 6,
  estimated = false,
  onHero = false,
  reducedMotion = false,
  center,
}: {
  progress: number
  size?: number
  strokeWidth?: number
  estimated?: boolean
  onHero?: boolean
  reducedMotion?: boolean
  center?: React.ReactNode
}) {
  const theme = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const v = theme.brandVisual
  const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  const maxSweep = 332
  const startDeg = 14
  const r = (size - strokeWidth * 2 - 4) / 2
  const cx = size / 2
  const cy = size / 2
  const gradId = `mra-g-${uid}`
  const glowId = `mra-gl-${uid}`
  const sweep = clamped * maxSweep
  const tip = polar(cx, cy, r, startDeg + sweep)
  const trackColor = onHero ? 'rgba(186, 224, 255, 0.24)' : v.ringTrack
  const strokeStart = estimated ? theme.amber : (onHero || theme.isDark ? v.ringStart : '#3588FF')
  const strokeEnd = estimated ? theme.amberInk : (onHero || theme.isDark ? v.ringEnd : theme.brand)

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill} accessible={false}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={strokeStart} />
            <Stop offset="100%" stopColor={strokeEnd} />
          </LinearGradient>
          <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={estimated ? theme.amber : v.ringGlow} stopOpacity={theme.isDark || onHero ? 0.58 : 0.34} />
            <Stop offset="100%" stopColor={estimated ? theme.amber : v.ringGlow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* 开口底轨 */}
        <Path
          d={describeArc(cx, cy, r, startDeg, maxSweep)}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* 真实进度弧 */}
        {clamped > 0.005 ? (
          <>
            {!reducedMotion && !estimated ? (
              <Circle cx={tip.x} cy={tip.y} r={strokeWidth * 1.65} fill={`url(#${glowId})`} />
            ) : null}
            <Path
              d={describeArc(cx, cy, r, startDeg, sweep)}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={estimated ? `${strokeWidth * 1.2} ${strokeWidth * 1.1}` : undefined}
            />
          </>
        ) : null}
      </Svg>
      {center}
    </View>
  )
})

/** 历史页/教练次卡的轻克制右下角磨砂阶梯 + 弧线几何纹理（绝不遮挡文字）。 */
export const MotionCardAccent = memo(function MotionCardAccent({
  style,
}: {
  style?: ViewStyle
}) {
  const theme = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!isMotionRing(theme)) return null
  const v = theme.brandVisual
  const gradId = `mca-${uid}`
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, style]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 180 120" preserveAspectRatio="xMaxYMax meet" accessible={false}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={theme.isDark ? v.ringStart : '#0A5CE8'} stopOpacity={theme.isDark ? 0.22 : 0.12} />
            <Stop offset="100%" stopColor={theme.isDark ? v.ringEnd : '#15B8E8'} stopOpacity={theme.isDark ? 0.34 : 0.18} />
          </LinearGradient>
        </Defs>
        <Path
          d={describeArc(152, 92, 54, 185, 145)}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={5}
          strokeLinecap="round"
        />
        <Rect x={118} y={98} width={54} height={18} rx={5} fill={`url(#${gradId})`} opacity={0.55} />
        <Rect x={136} y={84} width={36} height={32} rx={5} fill={`url(#${gradId})`} opacity={0.68} />
        <Rect x={154} y={70} width={18} height={46} rx={5} fill={`url(#${gradId})`} opacity={0.82} />
      </Svg>
    </View>
  )
})

/** 结算盖楼动效的运动环光环框：托住真实盖楼动画，不干扰 1610ms 音效与楼层比例。 */
export const MotionCompletionHalo = memo(function MotionCompletionHalo({
  size = 228,
  reducedMotion = false,
  children,
}: {
  size?: number
  reducedMotion?: boolean
  children: React.ReactNode
}) {
  const theme = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!isMotionRing(theme)) return <>{children}</>
  const v = theme.brandVisual
  const gradId = `mch-g-${uid}`
  const glowId = `mch-gl-${uid}`
  const bgId = `mch-bg-${uid}`
  const frameSize = Math.round(size * 1.06)
  const cx = frameSize / 2
  const cy = frameSize / 2
  const r = frameSize * 0.45
  const topHead = polar(cx, cy, r, 351)

  return (
    <View style={{ width: frameSize, alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      >
        <Svg width={frameSize} height={frameSize} viewBox={`0 0 ${frameSize} ${frameSize}`} accessible={false}>
          <Defs>
            <RadialGradient id={bgId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={theme.isDark ? '#0B49BD' : '#57C4FF'} stopOpacity={theme.isDark ? 0.30 : 0.16} />
              <Stop offset="72%" stopColor={theme.isDark ? '#06205E' : '#85C4FF'} stopOpacity={theme.isDark ? 0.10 : 0.05} />
              <Stop offset="100%" stopColor={theme.paper} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={theme.isDark ? v.ringStart : '#3388FF'} />
              <Stop offset="100%" stopColor={theme.isDark ? v.ringEnd : '#15C4EE'} />
            </LinearGradient>
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={v.ringGlow} stopOpacity={theme.isDark ? 0.62 : 0.36} />
              <Stop offset="100%" stopColor={v.ringGlow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={r * 0.98} fill={`url(#${bgId})`} />
          {!reducedMotion ? <Circle cx={topHead.x} cy={topHead.y} r={22} fill={`url(#${glowId})`} /> : null}
          <Path
            d={describeArc(cx, cy, r, 14, 336)}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={5}
            strokeLinecap="round"
            strokeOpacity={theme.isDark ? 0.85 : 0.68}
          />
        </Svg>
      </View>
      {children}
    </View>
  )
})

/** 单次分享海报 & 周成果海报的「疾阶运动」同源几何背景（保留高对比度与清晰 view-shot 截屏）。 */
export const MotionPosterBackdrop = memo(function MotionPosterBackdrop({
  width,
  height,
  variant = 'single',
}: {
  width: number
  height: number
  variant?: 'single' | 'weekly'
}) {
  const theme = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!isMotionRing(theme)) return null
  const v = theme.brandVisual
  const bgId = `mpb-bg-${uid}`
  const ringId = `mpb-ring-${uid}`
  const glowId = `mpb-glow-${uid}`
  const stairId = `mpb-st-${uid}`
  const clipId = `mpb-clip-${uid}`

  const dark = theme.isDark
  const cx = variant === 'weekly' ? width * 0.78 : width * 0.5
  const cy = variant === 'weekly' ? height * 0.44 : height * 0.48
  const r = variant === 'weekly' ? width * 0.34 : width * 0.38
  const innerR = r - width * 0.045
  const head = polar(cx, cy, r, 350)

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} accessible={false}>
        <Defs>
          <LinearGradient id={bgId} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0%" stopColor={dark ? '#031546' : '#EBF4FF'} />
            <Stop offset="55%" stopColor={dark ? '#062675' : '#F4F9FF'} />
            <Stop offset="100%" stopColor={dark ? '#0A4FCF' : '#D5ECFF'} />
          </LinearGradient>
          <LinearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={dark ? v.ringStart : '#3388FF'} />
            <Stop offset="55%" stopColor={dark ? '#6CD4FF' : '#0A68F0'} />
            <Stop offset="100%" stopColor={dark ? v.ringEnd : '#15C4EE'} />
          </LinearGradient>
          <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={v.ringGlow} stopOpacity={dark ? 0.52 : 0.28} />
            <Stop offset="100%" stopColor={v.ringGlow} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id={stairId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={dark ? '#E2F3FF' : '#0A5CE8'} stopOpacity={dark ? 0.22 : 0.11} />
            <Stop offset="100%" stopColor={dark ? '#84C4FF' : '#35B8F5'} stopOpacity={dark ? 0.07 : 0.04} />
          </LinearGradient>
          <ClipPath id={clipId}>
            <Circle cx={cx} cy={cy} r={innerR} />
          </ClipPath>
        </Defs>

        <Rect x={0} y={0} width={width} height={height} fill={`url(#${bgId})`} />
        <Circle cx={head.x} cy={head.y} r={width * 0.11} fill={`url(#${glowId})`} />

        {/* 环底三级半透明圆角阶梯 */}
        <G clipPath={`url(#${clipId})`}>
          <Rect x={cx - innerR * 0.9} y={cy + innerR * 0.36} width={innerR * 1.8} height={innerR * 0.72} rx={width * 0.03} fill={`url(#${stairId})`} />
          <Rect x={cx - innerR * 0.32} y={cy + innerR * 0.06} width={innerR * 1.3} height={innerR * 1.0} rx={width * 0.03} fill={`url(#${stairId})`} />
          <Rect x={cx + innerR * 0.24} y={cy - innerR * 0.24} width={innerR * 0.85} height={innerR * 1.3} rx={width * 0.03} fill={`url(#${stairId})`} />
        </G>

        {/* 标志性开口圆头运动环 */}
        <Path
          d={describeArc(cx, cy, r, 14, 336)}
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth={Math.max(4, width * 0.028)}
          strokeLinecap="round"
          strokeOpacity={dark ? 0.68 : 0.32}
        />

        {/* 外沿冰感细框 */}
        <Rect
          x={1}
          y={1}
          width={width - 2}
          height={height - 2}
          rx={width * 0.06}
          fill="none"
          stroke={dark ? 'rgba(128, 224, 255, 0.28)' : 'rgba(10, 92, 232, 0.14)'}
          strokeWidth={1.2}
        />
      </Svg>
    </View>
  )
})
