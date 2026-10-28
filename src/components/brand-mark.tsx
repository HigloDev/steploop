import React, { useState } from 'react'
import { ColorValue, Image, ImageProps } from 'react-native'
import { getThemeSkinId, useTheme } from '../theme'
import { getSkinArtwork } from '../skin-assets'

const BRAND_MARK = require('../../assets/brand/mark-audit.png')

type BrandMarkProps = Pick<ImageProps, 'style' | 'onLoad' | 'onError' | 'accessible' | 'accessibilityLabel'> & {
  size?: number
  color?: ColorValue
}

/** Classic keeps its original silhouette; graphic skins use their full-color mark. */
export function BrandMark({ size = 24, color, style, accessible = false, accessibilityLabel = '循阶标志', ...props }: BrandMarkProps) {
  const theme = useTheme()
  const skinId = getThemeSkinId(theme), mark = getSkinArtwork(skinId)?.mark
  const [failedSkin, setFailedSkin] = useState<string>()
  const graphic = mark && failedSkin !== skinId ? mark : undefined
  return <Image key={`${skinId}/${graphic ? 'graphic' : 'fallback'}`} {...props} source={graphic ?? BRAND_MARK} resizeMode="contain" resizeMethod="resize" fadeDuration={0}
    onError={event => { if (graphic) setFailedSkin(skinId); else props.onError?.(event) }}
    accessible={accessible} accessibilityLabel={accessible ? accessibilityLabel : undefined}
    style={[{ width: size, height: size, flexShrink: 0, tintColor: graphic ? undefined : color ?? theme.brandText }, style]} />
}
