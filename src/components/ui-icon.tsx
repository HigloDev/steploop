import React from 'react'
import { Image, type ImageProps } from 'react-native'

// Each silhouette is cut from the Steploop ImageGen sheets and tinted by the theme.
const ICON_ASSETS = {
  'climb': require('../../assets/icons/ui/climb.png'),
  'coach': require('../../assets/icons/ui/coach.png'),
  'records': require('../../assets/icons/ui/records.png'),
  'settings': require('../../assets/icons/ui/settings.png'),
  'chevron-left': require('../../assets/icons/ui/chevron-left.png'),
  'chevron-right': require('../../assets/icons/ui/chevron-right.png'),
  'chevron-down': require('../../assets/icons/ui/chevron-down.png'),
  'chevron-up': require('../../assets/icons/ui/chevron-up.png'),
  'arrow-right': require('../../assets/icons/ui/arrow-right.png'),
  'arrow-up': require('../../assets/icons/ui/arrow-up.png'),
  'arrow-down': require('../../assets/icons/ui/arrow-down.png'),
  'arrow-up-right': require('../../assets/icons/ui/arrow-up-right.png'),
  'plus': require('../../assets/icons/ui/plus.png'),
  'minus': require('../../assets/icons/ui/minus.png'),
  'close': require('../../assets/icons/ui/close.png'),
  'close-circle': require('../../assets/icons/ui/close-circle.png'),
  'check': require('../../assets/icons/ui/check.png'),
  'check-circle': require('../../assets/icons/ui/check-circle.png'),
  'checkbox': require('../../assets/icons/ui/checkbox.png'),
  'checkbox-checked': require('../../assets/icons/ui/checkbox-checked.png'),
  'pencil': require('../../assets/icons/ui/pencil.png'),
  'trash': require('../../assets/icons/ui/trash.png'),
  'more': require('../../assets/icons/ui/more.png'),
  'undo': require('../../assets/icons/ui/undo.png'),
  'replay': require('../../assets/icons/ui/replay.png'),
  'alert': require('../../assets/icons/ui/alert.png'),
  'info': require('../../assets/icons/ui/info.png'),
  'help': require('../../assets/icons/ui/help.png'),
  'pause-circle': require('../../assets/icons/ui/pause-circle.png'),
  'play-circle': require('../../assets/icons/ui/play-circle.png'),
  'play': require('../../assets/icons/ui/play.png'),
  'stairs': require('../../assets/icons/ui/stairs.png'),
  'building': require('../../assets/icons/ui/building.png'),
  'elevator-down': require('../../assets/icons/ui/elevator-down.png'),
  'rounds': require('../../assets/icons/ui/rounds.png'),
  'target': require('../../assets/icons/ui/target.png'),
  'compass': require('../../assets/icons/ui/compass.png'),
  'activity': require('../../assets/icons/ui/activity.png'),
  'book-open': require('../../assets/icons/ui/book-open.png'),
  'user': require('../../assets/icons/ui/user.png'),
  'group': require('../../assets/icons/ui/group.png'),
  'smartphone': require('../../assets/icons/ui/smartphone.png'),
  'display': require('../../assets/icons/ui/display.png'),
  'walk': require('../../assets/icons/ui/walk.png'),
  'run': require('../../assets/icons/ui/run.png'),
  'shield': require('../../assets/icons/ui/shield.png'),
  'shield-check': require('../../assets/icons/ui/shield-check.png'),
  'lock': require('../../assets/icons/ui/lock.png'),
  'bell': require('../../assets/icons/ui/bell.png'),
  'battery': require('../../assets/icons/ui/battery.png'),
  'vibrate': require('../../assets/icons/ui/vibrate.png'),
  'sound': require('../../assets/icons/ui/sound.png'),
  'clock': require('../../assets/icons/ui/clock.png'),
  'accessibility': require('../../assets/icons/ui/accessibility.png'),
  'search': require('../../assets/icons/ui/search.png'),
  'download': require('../../assets/icons/ui/download.png'),
  'upload': require('../../assets/icons/ui/upload.png'),
  'share': require('../../assets/icons/ui/share.png'),
  'file-text': require('../../assets/icons/ui/file-text.png'),
  'table': require('../../assets/icons/ui/table.png'),
  'database': require('../../assets/icons/ui/database.png'),
  'chart': require('../../assets/icons/ui/chart.png'),
  'speedometer': require('../../assets/icons/ui/speedometer.png'),
  'fire': require('../../assets/icons/ui/fire.png'),
  'shoe-print': require('../../assets/icons/ui/shoe-print.png'),
  'lightning': require('../../assets/icons/ui/lightning.png'),
  'terrain': require('../../assets/icons/ui/terrain.png'),
  'soccer': require('../../assets/icons/ui/soccer.png'),
  'basketball': require('../../assets/icons/ui/basketball.png'),
  'flag': require('../../assets/icons/ui/flag.png'),
  'flag-checkered': require('../../assets/icons/ui/flag-checkered.png'),
  'layers': require('../../assets/icons/ui/layers.png'),
  'zap': require('../../assets/icons/ui/zap.png'),
  'sun': require('../../assets/icons/ui/sun.png'),
  'feather': require('../../assets/icons/ui/feather.png'),
  'music': require('../../assets/icons/ui/music.png'),
  'droplet': require('../../assets/icons/ui/droplet.png'),
} as const

export type UIIconName = keyof typeof ICON_ASSETS

const DEFAULT_COLOR = '#152239'

/** 读屏标签；图标默认装饰性（accessible=false），开启后暴露该语义。 */
const ICON_LABELS: Record<UIIconName, string> = {
  climb: '向上训练', coach: '教练', records: '记录', settings: '设置',
  'chevron-left': '返回', 'chevron-right': '下一页', 'chevron-down': '展开', 'chevron-up': '收起',
  'arrow-right': '前往', 'arrow-up': '上升', 'arrow-down': '下降', 'arrow-up-right': '外跳',
  plus: '增加', minus: '减少', close: '关闭', 'close-circle': '清空', check: '已选', 'check-circle': '已完成',
  checkbox: '未勾选', 'checkbox-checked': '已勾选',
  pencil: '编辑', trash: '删除', more: '更多', undo: '撤销', replay: '重新开始',
  alert: '注意', info: '说明', help: '帮助', 'pause-circle': '暂停', 'play-circle': '开始', play: '开始',
  stairs: '楼梯', building: '楼栋', 'elevator-down': '电梯下行', rounds: '轮次',
  target: '目标', compass: '路线', activity: '心肺', 'book-open': '课程资料',
  user: '用户', group: '设备组', smartphone: '手机', display: '显示模式', walk: '步行', run: '跑步',
  shield: '权限', 'shield-check': '权限就绪', lock: '隐私', bell: '通知', battery: '电池',
  vibrate: '震动', sound: '声音', clock: '用时', accessibility: '读屏状态',
  search: '搜索', download: '下载', upload: '上传', share: '分享', 'file-text': '文书',
  table: '表格', database: '数据', chart: '图表', speedometer: '频率', fire: '热量',
  'shoe-print': '步数', lightning: '最快',
  terrain: '山峰', soccer: '球门', basketball: '球框', flag: '起点', 'flag-checkered': '终点',
  layers: '分层', zap: '闪电', sun: '阳光', feather: '羽毛', music: '音乐', droplet: '水滴',
}

/**
 * 旧库字形名 → 语义名的确定性映射（用于第二批迁移）。
 * 各库的向右箭头、齿轮、阶梯等按语义合并；注意：四个底部标签请显式用原创名
 * （Train→climb、Coach→coach、History→records、Profile→settings），
 * 其中的 chart-timeline-variant / cog-outline / account-tie-outline 仅作为标签默认合并目标。
 */
export const UI_ICON_ALIASES: Readonly<Record<string, UIIconName>> = Object.freeze({
  // Feather
  sliders: 'settings', 'chevron-right': 'chevron-right', 'chevron-left': 'chevron-left',
  download: 'download', upload: 'upload', 'rotate-ccw': 'undo', shield: 'shield',
  'file-text': 'file-text', 'book-open': 'book-open', info: 'info', 'alert-circle': 'alert',
  smartphone: 'smartphone', check: 'check', activity: 'activity', target: 'target',
  navigation: 'compass', layers: 'layers', feather: 'feather', zap: 'zap', sun: 'sun',
  music: 'music', 'pause-circle': 'pause-circle', droplet: 'droplet',
  // MaterialCommunityIcons
  table: 'table', close: 'close', magnify: 'search', 'close-circle': 'close-circle',
  'stairs-up': 'stairs', stairs: 'stairs', 'dots-horizontal': 'more', 'information-outline': 'info',
  'check-circle': 'check-circle', 'check-circle-outline': 'check-circle', 'export-variant': 'share',
  minus: 'minus', plus: 'plus', 'shield-check-outline': 'shield-check', 'alert-circle-outline': 'alert',
  'menu-down': 'arrow-down', 'undo-variant': 'undo', 'flag-checkered': 'flag-checkered', replay: 'replay',
  'elevator-down': 'elevator-down', 'play-circle-outline': 'play-circle', vibrate: 'vibrate',
  'office-building': 'building', 'office-building-outline': 'building', 'trash-can-outline': 'trash',
  'tune-variant': 'settings', 'arrow-top-right': 'arrow-up-right', 'chevron-down': 'chevron-down',
  'pencil-outline': 'pencil', 'flag-outline': 'flag', 'arrow-right': 'arrow-right', 'arrow-up': 'arrow-up',
  'chart-bar': 'chart', 'lightning-bolt': 'lightning', terrain: 'terrain', soccer: 'soccer',
  'basketball-hoop-outline': 'basketball', database: 'database', 'clock-outline': 'clock', 'help-circle': 'help',
  bell: 'bell', 'battery-charging': 'battery', run: 'run', cellphone: 'smartphone', 'account-group': 'group',
  account: 'user', 'account-tie-outline': 'coach', 'chart-timeline-variant': 'records', 'cog-outline': 'settings',
  speedometer: 'speedometer', 'shoe-print': 'shoe-print', 'shoe-sneaker': 'shoe-print', fire: 'fire',
  'heart-pulse': 'activity', 'bullseye-arrow': 'target', lock: 'lock', play: 'play',
  // MaterialIcons
  'bar-chart': 'chart',
  // Ionicons
  'chevron-back': 'chevron-left', 'chevron-up': 'chevron-up', 'chevron-forward': 'chevron-right',
  'phone-portrait-outline': 'smartphone', 'walk-outline': 'walk', 'shield-checkmark-outline': 'shield-check',
})

/**
 * 旧库字形名（Feather / MaterialCommunityIcons / MaterialIcons / Ionicons）→ 语义名。
 * 供动态图标名调用：先走确定性别名，再接受已是语义名的字符串；未知名直接抛错，
 * 绝不在渲染里静默丢弃图标。
 */
export function resolveUIIconName(name: string): UIIconName {
  const mapped = UI_ICON_ALIASES[name]
  if (mapped) return mapped
  if (Object.hasOwn(ICON_ASSETS, name)) return name as UIIconName
  throw new Error(`UIIcon: 未知图标名 "${name}"，请改用真实枚举中的语义名或补充别名。`)
}

export interface UIIconProps {
  name: UIIconName
  size?: number
  color?: string
  accessible?: boolean
  style?: ImageProps['style']
}

export function UIIcon({ name, size = 24, color = DEFAULT_COLOR, accessible = false, style }: UIIconProps) {
  return (
    <Image
      source={ICON_ASSETS[name]}
      fadeDuration={0}
      resizeMode="contain"
      accessible={accessible}
      accessibilityRole={accessible ? 'image' : undefined}
      accessibilityLabel={accessible ? ICON_LABELS[name] : undefined}
      style={[{ width: size, height: size, flexShrink: 0, tintColor: color }, style]}
    />
  )
}
