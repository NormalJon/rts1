# Runs the Unity editor on the project in unity/ without its window, and
# reports what happened. The editor must not already have the project open.
#
#   scripts\unity-batch.ps1                              import and compile only
#   scripts\unity-batch.ps1 -Method Rts.Game.EditorTools.ProjectSetup.Run
#   scripts\unity-batch.ps1 -Tests EditMode              run the tests of that kind
#   scripts\unity-batch.ps1 -Tests PlayMode -Filter MatchSceneTests
#
# Exit code 0 means Unity finished and, for tests, that all of them passed.
# Unity is stopped, with exit code 4, if it has not finished in -TimeoutSeconds
# (a test that waits for something that never comes would otherwise run for ever).
# The full log is unity/Logs/batch.log; test results are unity/Logs/tests-<kind>.xml.

param(
  [string]$Method = '',
  [ValidateSet('', 'EditMode', 'PlayMode')][string]$Tests = '',
  [string]$Filter = '',
  [string[]]$UnityArgs = @(),
  [int]$TimeoutSeconds = 900,
  [int]$ShowLines = 40
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'unity'
$version = (Select-String -Path (Join-Path $project 'ProjectSettings\ProjectVersion.txt') -Pattern '^m_EditorVersion:\s*(\S+)').Matches[0].Groups[1].Value
$editor = "C:\Program Files\Unity\Hub\Editor\$version\Editor\Unity.exe"
if (-not (Test-Path $editor)) { Write-Output "Unity $version is not installed at $editor"; exit 2 }
if (Test-Path (Join-Path $project 'Temp\UnityLockfile')) {
  # Unity Hub keeps a helper running that is also called "unity"; only the editor itself counts.
  $open = Get-Process -Name Unity -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\Editor\Unity.exe' }
  if ($open) { Write-Output 'The Unity editor is running, probably with this project open. Close it first.'; exit 3 }
}

$logs = Join-Path $project 'Logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs 'batch.log'
Remove-Item $log -ErrorAction SilentlyContinue

$arguments = @('-batchmode', '-projectPath', "`"$project`"", '-logFile', "`"$log`"")
$results = ''
if ($Tests -ne '') {
  # -runTests quits by itself when the tests are over; -quit would cut them short.
  $results = Join-Path $logs "tests-$Tests.xml"
  Remove-Item $results -ErrorAction SilentlyContinue
  $arguments += @('-runTests', '-testPlatform', $Tests, '-testResults', "`"$results`"")
  if ($Filter -ne '') { $arguments += @('-testFilter', "`"$Filter`"") }
} else {
  $arguments += '-quit'
  if ($Method -ne '') { $arguments += @('-executeMethod', $Method) }
}
$arguments += $UnityArgs

$started = Get-Date
$process = Start-Process -FilePath $editor -ArgumentList $arguments -PassThru
$finished = $process.WaitForExit($TimeoutSeconds * 1000)
$seconds = [int]((Get-Date) - $started).TotalSeconds
if (-not $finished) {
  Stop-Process -Id $process.Id -Force
  Write-Output "Unity $version had not finished after $seconds s and was stopped. The end of the log:"
  if (Test-Path $log) { Get-Content $log -Tail 15 | ForEach-Object { if ($_.Length -gt 200) { $_.Substring(0, 200) } else { $_ } } }
  exit 4
}
Write-Output "Unity $version exit code $($process.ExitCode) after $seconds s"

if (Test-Path $log) {
  $problems = Select-String -Path $log -Pattern 'error CS\d+|Compilation failed|Scripts have compiler errors|^.*Exception: |No valid Unity Editor license|\[RTS\]|executeMethod .* (threw|could not be found)|Aborting batchmode' |
    ForEach-Object { $_.Line.Trim() } | Select-Object -Unique -First $ShowLines
  if ($problems) { Write-Output '--- from the log ---'; $problems | ForEach-Object { if ($_.Length -gt 300) { $_.Substring(0, 300) } else { $_ } } }
}

if ($results -ne '' -and (Test-Path $results)) {
  [xml]$xml = Get-Content $results
  $run = $xml.'test-run'
  Write-Output "--- tests: $($run.total) run, $($run.passed) passed, $($run.failed) failed, $($run.skipped) skipped, $([int][double]$run.duration) s ---"
  foreach ($case in $xml.SelectNodes('//test-case')) {
    if ($case.result -ne 'Passed') {
      Write-Output "$($case.result): $($case.fullname)"
      $message = $case.SelectSingleNode('failure/message')
      if ($message) { $text = $message.InnerText.Trim(); if ($text.Length -gt 600) { $text = $text.Substring(0, 600) }; Write-Output "    $text" }
    }
  }
  if ([int]$run.failed -gt 0) { exit 1 }
} elseif ($Tests -ne '') {
  Write-Output 'No test results were written: Unity stopped before the tests ran. See the log.'
  exit 1
}

exit $process.ExitCode
