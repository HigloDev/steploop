import { TrackedImage } from './tracked-image'
import React, { useState } from 'react'
import { ImageProps } from 'react-native'

/** Decorative page art keeps failures out of the functional UI. Development
 * capture tools must wait for the matching native load event, not page text. */
export function SkinHeaderImage({ identity, ...props }: ImageProps & { identity: string }) {
  const [failed, setFailed] = useState<string>()
  const report = (status: 'loading' | 'loaded' | 'failed', detail?: string) => {
    if (__DEV__) console.info('[skin-image]', JSON.stringify({ identity, status, detail }))
  }
  if (failed === identity) return null
  return <TrackedImage identity={`header/${identity}`} {...props} key={identity}
    onLoadStart={() => report('loading')}
    onLoad={() => report('loaded')}
    onError={event => { report('failed', event.nativeEvent.error); setFailed(identity) }} />
}
