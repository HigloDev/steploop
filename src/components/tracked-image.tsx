import React, { useContext, useLayoutEffect, useState } from 'react'
import { Dimensions, Image, ImageBackground, ImageBackgroundProps, ImageProps } from 'react-native'
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs'
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native'

const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let nextInstance = 0
// UIQA deliberately replaces Date.now for stable training dates after startup.
const monotonicEpoch = Date.now() - performance.now()
if (__DEV__) console.info('[art-image]', JSON.stringify({ session, status: 'session-start' }))

/** Native load proof is development-only; no visible/accessibility QA markers. */
function useImageEvents(identity: string, props: Pick<ImageProps, 'onLoadStart' | 'onLoad' | 'onError'>) {
  const bottomTabBarHeight = useContext(BottomTabBarHeightContext) ?? 0
  const navigation = useContext(NavigationContext)
  const route = useContext(NavigationRouteContext)
  const [record] = useState(() => ({ instanceId: `${session}/${++nextInstance}`, active: false, status: 'pending',
    node: null as Image | null, timer: undefined as ReturnType<typeof setInterval> | undefined, bottomTabBarHeight, navigation, route }))
  record.bottomTabBarHeight = bottomTabBarHeight
  record.navigation = navigation
  record.route = route
  const emit = (status: string, detail?: string, geometry?: object) => {
    if (__DEV__) console.info('[art-image]', JSON.stringify({ session, instanceId: record.instanceId, identity, status, loadStatus: record.status, detail, ...geometry }))
  }
  const mount = () => {
    if (!record.active) { record.active = true; emit('mount') }
  }
  const stopMeasuring = () => { if (record.timer !== undefined) clearInterval(record.timer); record.timer = undefined }
  const measure = () => {
    if (!record.active || record.status === 'loaded' || record.status === 'failed') return
    record.node?.measureInWindow((x, y, width, height) => {
      if (!record.active || record.status === 'loaded' || record.status === 'failed') return
      const window = Dimensions.get('window')
      emit('visibility', undefined, { rect: { x, y, width, height },
        viewport: { width: window.width, height: window.height - record.bottomTabBarHeight },
        window: { width: window.width, height: window.height }, bottomTabBarHeight: record.bottomTabBarHeight,
        navigationFocused: record.navigation?.isFocused() ?? null, routeKey: record.route?.key ?? null,
        measuredAt: monotonicEpoch + performance.now() })
    })
  }
  const startMeasuring = () => {
    if (__DEV__ && record.timer === undefined && record.status !== 'loaded' && record.status !== 'failed') {
      measure()
      record.timer = setInterval(measure, 500)
    }
  }
  useLayoutEffect(() => {
    mount()
    startMeasuring()
    return () => { stopMeasuring(); record.active = false; emit('unmount') }
  }, [])
  return {
    ref: (node: Image | null) => { record.node = node },
    onLoadStart: () => { mount(); record.status = 'loading'; emit('loading'); startMeasuring(); props.onLoadStart?.() },
    onLoad: ((event) => { mount(); record.status = 'loaded'; stopMeasuring(); emit('loaded'); props.onLoad?.(event) }) as ImageProps['onLoad'],
    onError: ((event) => { mount(); record.status = 'failed'; stopMeasuring(); emit('failed', event.nativeEvent.error); props.onError?.(event) }) as ImageProps['onError'],
  }
}

function ImageInstance({ identity, ...props }: ImageProps & { identity: string }) {
  const events = useImageEvents(identity, props)
  return <Image {...props} {...events} />
}

export function TrackedImage(props: ImageProps & { identity: string }) {
  // A changed source must acquire new native load proof, even at the same role.
  return <ImageInstance key={`${props.identity}/${JSON.stringify(props.source)}`} {...props} />
}

function BackgroundInstance({ identity, ...props }: ImageBackgroundProps & { identity: string }) {
  const { ref, ...events } = useImageEvents(identity, props)
  return <ImageBackground {...props} {...events} imageRef={node => { ref(node); props.imageRef?.(node) }} />
}

export function TrackedImageBackground(props: ImageBackgroundProps & { identity: string }) {
  return <BackgroundInstance key={`${props.identity}/${JSON.stringify(props.source)}`} {...props} />
}
