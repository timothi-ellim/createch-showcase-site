# Uses the bundled supported runtime when available; otherwise uses installed Node.
# Does not change the machine's Node installation or persistent environment.
$taskNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
$taskNpm = Join-Path (Split-Path (Get-Command npm.cmd -ErrorAction Stop).Source) 'node_modules/npm/bin/npm-cli.js'
$taskOriginalPath = $env:PATH
try {
    $env:PATH = (Split-Path $taskNode) + ';' + $taskOriginalPath
    $env:ASTRO_TELEMETRY_DISABLED = '1'
    & $taskNode $taskNpm @args
    $taskExit = $LASTEXITCODE
} finally {
    $env:PATH = $taskOriginalPath
}
exit $taskExit
