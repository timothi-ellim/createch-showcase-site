$ErrorActionPreference = 'Stop'
$createchRoot = Split-Path -Parent $PSScriptRoot
$createchNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$createchCredential = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CreaTechShowcase/credentials/gmail-staging.xml'
if (!(Test-Path -LiteralPath $createchCredential)) { throw 'Run connect-gmail-staging.ps1 with the Google App Password first.' }
$createchSecure = Import-Clixml -LiteralPath $createchCredential
$createchPrior = $env:CREATECH_GMAIL_APP_PASSWORD
Push-Location -LiteralPath $createchRoot
try {
    $createchLinked = (Get-Content -LiteralPath supabase/.temp/project-ref -Raw).Trim()
    if ($createchLinked -ne 'audbvodildfpmschwyot') { throw 'Unexpected Supabase link.' }
    $createchWorkdir = '.portal-test/gmail-staging'
    $null = New-Item -ItemType Directory -Force -Path "$createchWorkdir/supabase/templates"
    $createchBase = Get-Content -LiteralPath supabase/hosted-staging.toml -Raw
    $createchSmtp = @'

[auth.email.smtp]
enabled = true
host = "smtp.gmail.com"
port = 587
user = "timothiellim@gmail.com"
pass = "env(CREATECH_GMAIL_APP_PASSWORD)"
admin_email = "timothiellim@gmail.com"
sender_name = "CreaTech Showcase"

[auth.email.template.magic_link]
subject = "Your CreaTech sign-in code"
content_path = "./supabase/templates/code-v2.html"

[auth.email.template.confirmation]
subject = "Confirm your CreaTech sign-in"
content_path = "./supabase/templates/code-v2.html"

[auth.email.template.invite]
subject = "Your CreaTech invitation code"
content_path = "./supabase/templates/invite-code-v2.html"
'@
    Set-Content -LiteralPath "$createchWorkdir/supabase/config.toml" -Value ($createchBase + $createchSmtp) -Encoding utf8
    foreach ($createchTemplate in @('code-v2.html','invite-code-v2.html')) {
        Copy-Item -LiteralPath "supabase/templates/$createchTemplate" -Destination "$createchWorkdir/supabase/templates/$createchTemplate"
    }
    $env:CREATECH_GMAIL_APP_PASSWORD = [Net.NetworkCredential]::new('', $createchSecure).Password
    # Config tools may return sensitive provider values: suppress their output.
    $createchResult = & $createchNode node_modules/supabase/dist/supabase.js config push --project-ref audbvodildfpmschwyot --workdir $createchWorkdir --yes --output-format text 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Supabase SMTP configuration was not confirmed. Inspect provider state before retrying.' }
    Write-Host 'Supabase accepted Gmail SMTP and the three numeric-code templates. Inbox delivery still needs testing.'
} finally {
    $createchResult = $null
    $env:CREATECH_GMAIL_APP_PASSWORD = $createchPrior
    $createchSecure.Dispose()
    Pop-Location
}
