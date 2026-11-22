import { useFonts } from 'expo-font'
import { WORKOUT_NUMBER_FONT } from '../theme'

const fonts = { [WORKOUT_NUMBER_FONT]: require('../../assets/fonts/BarlowSemiCondensed-SemiBold.ttf') }

export function useAppFontsReady(): boolean {
  const [loaded, error] = useFonts(fonts)
  return loaded || error !== null
}
