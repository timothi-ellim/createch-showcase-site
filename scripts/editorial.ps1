# Runs the organiser CLI directly so PowerShell/npm do not consume its flags.
$taskNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
$taskCli = Join-Path $PSScriptRoot '../editorial/cli.ts'
& $taskNode $taskCli @args
exit $LASTEXITCODE
