import { registerRootComponent } from 'expo'
import { LogBox } from 'react-native'

// Separate entry selected only by the isolated .uiqa native debug package.
LogBox.ignoreAllLogs(true)
registerRootComponent(require('./src/dev/UiQaApp').default)
