import React from 'react'
import { ScrollView, Text, View } from 'react-native'
import { Button } from './ui'
import { useTheme } from '../theme'

function RecoveryScreen({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.paper }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28, paddingVertical: 64 }}>
      <View style={{ gap: 20, width: '100%', maxWidth: 440, alignSelf: 'center' }}>
        <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 28, lineHeight: 38, fontWeight: '800' }}>页面暂时未能打开</Text>
        <Text accessibilityRole="alert" style={{ color: theme.mutedStrong, fontSize: 16, lineHeight: 26 }}>可以重新打开应用界面。此操作不会清空记录；返回首页后，请检查是否有待恢复的训练。</Text>
        <Button title="重新打开" onPress={onRetry} />
      </View>
    </ScrollView>
  )
}

/** Render failures unmount the workout so its normal checkpoint/cleanup runs.
 * Recovery remounts the app without clearing storage or starting a workout. */
export class AppErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[app] 页面渲染失败', error)
  }

  private retry = () => this.setState({ hasError: false })

  render() {
    return this.state.hasError ? <RecoveryScreen onRetry={this.retry} /> : this.props.children
  }
}
