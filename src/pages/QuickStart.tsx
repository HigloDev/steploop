import React, { useEffect } from 'react'
import { RootStackScreen } from '../navigation/types'
/** Old navigation targets converge on the single add-route flow. */
export default function QuickStartScreen({ navigation }: RootStackScreen<'QuickStart'>) {
  useEffect(() => { navigation.replace('AddRoute', { manual: true }) }, [navigation])
  return null
}
