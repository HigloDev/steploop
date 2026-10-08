// Signing secrets live outside the repository and are read only by Gradle.
const { withAppBuildGradle } = require('@expo/config-plugins')

const marker = '// palou-release-signing'
function configureSigning(contents) {
  if (contents.includes(marker)) return contents
  const anchor = '    signingConfigs {'
  const releaseAnchor = /release\s*\{[\s\S]*?signingConfig signingConfigs\.debug/
  if (!contents.includes(anchor) || !releaseAnchor.test(contents)) {
    throw new Error('Unsupported Android signing template; refusing debug signing fallback')
  }
  const setup = `
${marker}
def palouSigning = new Properties()
def palouSigningPath = System.getenv('PALOU_SIGNING_PROPERTIES')
def palouInternal = System.getenv('PALOU_INTERNAL_BUILD') == '1'
if (palouSigningPath) {
    def credentials = new File(palouSigningPath)
    if (!credentials.isFile()) throw new GradleException('Signing properties file missing')
    credentials.withInputStream { palouSigning.load(it) }
    ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'].each {
        if (!palouSigning.getProperty(it)) throw new GradleException('Incomplete signing properties')
    }
}
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }
        && !palouSigningPath && !palouInternal) {
        throw new GradleException('Release signing required: set PALOU_SIGNING_PROPERTIES; internal upgrade testing requires PALOU_INTERNAL_BUILD=1')
    }
}
`
  contents = contents.replace(releaseAnchor, match => match.replace(
    'signingConfig signingConfigs.debug',
    'signingConfig palouSigningPath ? signingConfigs.release : signingConfigs.debug',
  ))
  contents = contents.replace('android {', `${setup}\nandroid {`)
  contents = contents.replace(anchor, `${anchor}
        if (palouSigningPath) {
            release {
                storeFile new File(palouSigning.getProperty('storeFile'))
                storePassword palouSigning.getProperty('storePassword')
                keyAlias palouSigning.getProperty('keyAlias')
                keyPassword palouSigning.getProperty('keyPassword')
            }
        }`)
  return contents
}

module.exports = config => withAppBuildGradle(config, mod => {
  if (mod.modResults.language !== 'groovy') throw new Error('Expected Groovy Android project')
  mod.modResults.contents = configureSigning(mod.modResults.contents)
  return mod
})
module.exports.configureSigning = configureSigning
