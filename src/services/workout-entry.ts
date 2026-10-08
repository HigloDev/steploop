import { Alert } from 'react-native'
import { getPreferences, savePreferences } from './preferences'
import { isBackgroundTrainingSupported } from './background-training'

export async function confirmBackgroundRecording(): Promise<boolean> {
  if (isBackgroundTrainingSupported()) return true
  const prefs = await getPreferences()
  if (prefs.backgroundPauseHintSeen === true) return true
  return new Promise<boolean>((resolve) => {
    Alert.alert('训练中保持屏幕点亮',
      '锁屏或切到其它应用时，系统会暂停传感器，这段时间不会记录楼层。返回后会提示后台缺段，可在结束时手动修正最终楼层。',
      [
        { text: '暂不开始', style: 'cancel', onPress: () => resolve(false) },
        { text: '知道了，开始', onPress: () => { void savePreferences({ backgroundPauseHintSeen: true }).then(() => resolve(true)) } },
      ], { cancelable: false })
  })
}
