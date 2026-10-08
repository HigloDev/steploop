const test = require('node:test')
const assert = require('node:assert/strict')
const { configureSigning } = require('../plugins/withAndroidReleaseSigning')

test('release signing changes only release; prebuild is idempotent and secrets stay external', () => {
  const original = `android {
    signingConfigs {
        debug { storeFile file('debug.keystore') }
    }
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release {
            signingConfig signingConfigs.debug
        }
    }
}`
  const next = configureSigning(original)
  assert.match(next, /debug \{ signingConfig signingConfigs\.debug \}/)
  assert.match(next, /signingConfig palouSigningPath \? signingConfigs\.release : signingConfigs\.debug/)
  assert.match(next, /!palouSigningPath && !palouInternal/)
  assert.match(next, /System.getenv\('PALOU_SIGNING_PROPERTIES'\)/)
  assert.equal(configureSigning(next), next)
})

test('unknown native template fails instead of silently producing a debug-signed release', () => {
  assert.throws(() => configureSigning('android {}'), /refusing debug signing fallback/)
})
