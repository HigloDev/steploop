import { TrackedImage } from './tracked-image'
import React from 'react'
import type { ColorValue, ImageProps } from 'react-native'
import { useTheme } from '../theme'

const BRAND_MARK = require('../../assets/brand/steploop/mark.png')

type BrandMarkProps = Pick<ImageProps, 'style' | 'onLoad' | 'onError' | 'accessible' | 'accessibilityLabel'> & {
  size?: number
  color?: ColorValue
}

/** The same stair symbol appears on the launcher, in the app, and on shared posters. */
export function BrandMark({ size = 24, color, style, accessible = false, accessibilityLabel = '循阶标志', ...props }: BrandMarkProps) {
  const theme = useTheme()
  return <TrackedImage identity="brand/steploop" {...props} source={BRAND_MARK} resizeMode="contain" resizeMethod="resize" fadeDuration={0}
    accessible={accessible} accessibilityLabel={accessible ? accessibilityLabel : undefined}
    style={[{ width: size, height: size, flexShrink: 0, tintColor: color ?? theme.brandText }, style]} />
}
