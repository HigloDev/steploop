import React from 'react'
import { ColorValue, Image, ImageProps } from 'react-native'
import { useTheme } from '../theme'

const BRAND_MARK = require('../../assets/brand/mark.png')

type BrandMarkProps = Pick<ImageProps, 'style' | 'onLoad' | 'onError' | 'accessible' | 'accessibilityLabel'> & {
  size?: number
  color?: ColorValue
}

/** The transparent brand silhouette follows the surrounding theme and tab tint. */
export function BrandMark({ size = 24, color, style, accessible = false, accessibilityLabel = '循阶标志', ...props }: BrandMarkProps) {
  const theme = useTheme()
  return <Image {...props} source={BRAND_MARK} resizeMode="contain" fadeDuration={0}
    accessible={accessible} accessibilityLabel={accessible ? accessibilityLabel : undefined}
    style={[{ width: size, height: size, flexShrink: 0, tintColor: color ?? theme.green }, style]} />
}
