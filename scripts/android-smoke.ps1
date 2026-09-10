param(
  [string]$Serial = $env:ANDROID_SERIAL,
  [string]$PackageName = 'com.zxn.palou',
  [string]$ApkPath = 'android\app\build\outputs\apk\debug\app-debug.apk',
  [int]$WaitSeconds = 12,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Invoke-AdbChecked {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & adb @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb failed ($LASTEXITCODE): $($Arguments -join ' ')"
  }
}

if (-not $Serial) {
  $deviceLines = @(adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })
  if ($deviceLines.Count -ne 1) {
    throw 'Please specify one authorized Android device with -Serial or ANDROID_SERIAL.'
  }
  $Serial = ($deviceLines[0] -split "\t")[0]
}

if (-not $SkipInstall) {
  if (-not (Test-Path -LiteralPath $ApkPath)) {
    throw "APK not found: $ApkPath"
  }
  Invoke-AdbChecked -Arguments @('-s', $Serial, 'install', '-r', $ApkPath) | Out-Host
}

Invoke-AdbChecked -Arguments @('-s', $Serial, 'wait-for-device')
Invoke-AdbChecked -Arguments @('-s', $Serial, 'logcat', '-c')
Invoke-AdbChecked -Arguments @('-s', $Serial, 'shell', 'am', 'force-stop', $PackageName)
Invoke-AdbChecked -Arguments @('-s', $Serial, 'shell', 'monkey', '-p', $PackageName, '1') | Out-Host
Start-Sleep -Seconds $WaitSeconds
Invoke-AdbChecked -Arguments @('-s', $Serial, 'shell', 'uiautomator', 'dump', '/sdcard/palou-smoke.xml') | Out-Host
$ui = & adb -s $Serial shell cat /sdcard/palou-smoke.xml
if ($LASTEXITCODE -ne 0 -or -not $ui) {
  throw 'Android smoke failed: unable to read UI hierarchy.'
}

$pidValue = & adb -s $Serial shell pidof $PackageName
if ($LASTEXITCODE -ne 0 -or -not $pidValue) {
  throw 'Android smoke failed: application process is not running.'
}

if ($ui -match 'Unable to load script|rn_redbox|catalyst_redbox') {
  throw 'Android smoke failed: React Native red screen detected.'
}

$fatal = adb -s $Serial logcat -d -v brief |
  Select-String -Pattern "FATAL EXCEPTION|Process: $PackageName|ReactNativeJS.*(Error|Invariant Violation)"
if ($fatal) {
  $fatal | Out-Host
  throw 'Android smoke failed: fatal application log detected.'
}

Write-Host "Android smoke passed: $PackageName on $Serial"
