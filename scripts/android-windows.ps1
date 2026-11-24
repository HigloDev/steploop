[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [scriptblock]$Command
)

$ErrorActionPreference = 'Stop'
$systemDrive = [IO.Path]::GetPathRoot($env:SystemRoot)

function Get-PhysicalDirectory([string]$Path) {
  $resolved = & node -e "process.stdout.write(require('node:fs').realpathSync.native(process.argv[1]))" -- $Path
  if ($LASTEXITCODE -ne 0 -or -not $resolved) { throw "Cannot resolve directory: $Path" }
  return $resolved
}

function Confirm-BuildDirectory([string]$Path) {
  $resolved = Get-PhysicalDirectory $Path
  if ([IO.Path]::GetPathRoot($resolved) -ieq $systemDrive) {
    throw "Steploop build directories must be outside the system drive: $resolved"
  }
  return $resolved
}

function New-BuildDirectory([string]$Parent, [string]$Name) {
  $path = Join-Path $Parent $Name
  if (-not (Test-Path -LiteralPath $path -PathType Container)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
  return (Confirm-BuildDirectory $path)
}

$repo = Confirm-BuildDirectory (Join-Path $PSScriptRoot '..')
$expoState = New-BuildDirectory $repo '.expo'
$runtime = New-BuildDirectory $expoState 'android-build-runtime'
$temp = New-BuildDirectory $runtime 'tmp'
$gradleHome = $null
if ($env:GRADLE_USER_HOME -and (Test-Path -LiteralPath $env:GRADLE_USER_HOME -PathType Container)) {
  $configuredHome = Get-PhysicalDirectory $env:GRADLE_USER_HOME
  if ([IO.Path]::GetPathRoot($configuredHome) -ine $systemDrive) { $gradleHome = $configuredHome }
}
if (-not $gradleHome) { $gradleHome = New-BuildDirectory $runtime 'gradle' }

$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { 'java.exe' }
$javaTempOption = '"-Djava.io.tmpdir={0}"' -f $temp.Replace('\', '/')
$environment = @{
  GRADLE_USER_HOME = $gradleHome
  TEMP = $temp
  TMP = $temp
  JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS $javaTempOption".Trim()
  npm_config_cache = (New-BuildDirectory $runtime 'npm-cache')
  # Expo SDK 57 reads this from the shell environment before loading dotenv.
  __UNSAFE_EXPO_HOME_DIRECTORY = (New-BuildDirectory $runtime 'expo-home')
  ANDROID_USER_HOME = (New-BuildDirectory $runtime 'android-user-home')
}
$previous = @{}
foreach ($key in $environment.Keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }

try {
  foreach ($key in $environment.Keys) { [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process') }

  $probe = @'
const { spawnSync } = require('node:child_process')
const result = spawnSync(process.argv[1], ['-XshowSettings:properties', '-version'], {encoding:'utf8', windowsHide:true})
const match = result.stderr?.match(/^\s*java\.io\.tmpdir\s*=\s*(.+)$/m)
if (result.status !== 0 || !match) process.exit(1)
process.stdout.write(JSON.stringify({node:require('node:os').tmpdir(), java:match[1].trim()}))
'@
  $tempCheckJson = & node -e $probe -- $java
  if ($LASTEXITCODE -ne 0) { throw 'Cannot verify the Android build JVM temporary directory.' }
  $tempCheck = $tempCheckJson | ConvertFrom-Json
  if ((Confirm-BuildDirectory $tempCheck.node) -ine $temp -or (Confirm-BuildDirectory $tempCheck.java) -ine $temp) {
    throw 'Node and the JDK must both use the Steploop temporary directory.'
  }

  [pscustomobject]@{
    projectRoot = $repo
    gradleUserHome = $gradleHome
    nodeTemp = $tempCheck.node
    javaTemp = $tempCheck.java
    npmCache = $env:npm_config_cache
    expoHome = $env:__UNSAFE_EXPO_HOME_DIRECTORY
    androidUserHome = $env:ANDROID_USER_HOME
  } | ConvertTo-Json -Compress
  if ($CheckOnly) { return }

  Push-Location -LiteralPath $repo
  try {
    if ($Command) {
      & $Command
    } else {
      & .\android\gradlew.bat -p android --no-daemon :app:assembleRelease --max-workers=4 --console=plain
    }
    if ($LASTEXITCODE -ne 0) { throw "Android build command failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
} finally {
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
