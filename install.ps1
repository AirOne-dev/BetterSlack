<#
    Install BetterSlack on Windows.

        git clone https://github.com/AirOne-dev/BetterSlack.git
        cd BetterSlack
        powershell -ExecutionPolicy Bypass -File .\install.ps1

    The counterpart of install.sh, and it makes the same promise: nothing has to
    be installed first. Node is found if it is there and fetched into
    %USERPROFILE%\.betterslack\runtime if it is not, pnpm comes from Corepack,
    and everything is written under the user's own profile -- no administrator,
    no PATH changes, nothing in Program Files.

    The -ExecutionPolicy Bypass above is not a detail to leave out: the default
    policy on Windows refuses to run a downloaded script at all, and the error
    it gives does not say that this is what happened.
#>

$ErrorActionPreference = 'Stop'

# PowerShell 5.1 still defaults to TLS 1.0 for Invoke-WebRequest, which
# nodejs.org refuses. Without this the download fails with a connection error
# that says nothing about protocols.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$BsHome = if ($env:BETTERSLACK_HOME) { $env:BETTERSLACK_HOME } else { Join-Path $env:USERPROFILE '.betterslack' }
$Runtime = Join-Path $BsHome 'runtime'

# The LTS line to fetch when the machine has no usable Node. It only has to
# satisfy package.json's engines, which scripts\node-ok.cjs checks against the
# downloaded copy too -- so a wrong guess here fails loudly rather than
# installing something that cannot run the loader.
$NodeLine = '22.x'

function Say  { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "==> $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "==> $m" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# A Node that can actually run this
# ---------------------------------------------------------------------------
#
# Chosen by version, never by whichever node.exe is first on PATH: a machine
# with nvm-windows or fnm on it points that at whatever version was last
# selected, and an old one cannot parse the loader at all. scripts\node-ok.cjs
# is the judge and reads the range out of package.json, so there is no version
# arithmetic here.

$Node = $null
$NodeKey = 0

function Consider {
    param($Candidate)
    if (-not $Candidate) { return }
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return }
    $key = & $Candidate (Join-Path $Repo 'scripts\node-ok.cjs') 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $key) { return }
    if ([int]$key -gt $script:NodeKey) {
        $script:NodeKey = [int]$key
        $script:Node = $Candidate
    }
}

# What the user's own shell would run comes first; only then do we go looking.
$onPath = Get-Command node.exe -ErrorAction SilentlyContinue
if ($onPath) { Consider $onPath.Source }

if (-not $Node) {
    $candidates = @(
        (Join-Path $Runtime 'node\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Volta\bin\node.exe')
    )
    # nvm-windows and fnm keep one directory per version; take them all and let
    # the judge above sort out which are usable.
    foreach ($root in @((Join-Path $env:APPDATA 'nvm'), (Join-Path $env:LOCALAPPDATA 'fnm\node-versions'))) {
        if (Test-Path -LiteralPath $root) {
            $candidates += (Get-ChildItem -LiteralPath $root -Recurse -Filter 'node.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        }
    }
    foreach ($c in $candidates) { Consider $c }
}

# ---------------------------------------------------------------------------
# ...or one fetched, checksummed, and kept to ourselves
# ---------------------------------------------------------------------------
#
# nodejs.org publishes SHASUMS256.txt per release line, naming the exact file
# and its digest in one request -- so no version is pinned here to go stale, and
# nothing has to parse JSON on a machine that has no Node yet. The archive is
# verified before it is unpacked.

function Get-NodeRuntime {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
    $base = "https://nodejs.org/download/release/latest-v$NodeLine"
    Say "No usable Node found. Fetching the current $NodeLine LTS build for $arch..."

    try { $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content }
    catch { Die "could not reach nodejs.org to download Node: $_" }

    $line = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape('node-v'))[\d.]+-$arch\.zip$" } | Select-Object -First 1)
    if (-not $line) { Die "nodejs.org listed no $arch build for the $NodeLine line." }
    $parts = $line.Trim() -split '\s+'
    $sum = $parts[0]
    $file = $parts[-1]

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $archive = Join-Path $tmp $file
        Invoke-WebRequest -Uri "$base/$file" -OutFile $archive -UseBasicParsing
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        if ($actual -ne $sum.ToUpper()) { Die 'the Node download did not match its published checksum.' }

        $target = Join-Path $Runtime 'node'
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Expand-Archive -LiteralPath $archive -DestinationPath $tmp -Force

        # The zip wraps everything in one node-vX-win-x64 directory; move its
        # contents up so the layout matches what the launcher expects.
        $unpacked = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
        Get-ChildItem -LiteralPath $unpacked.FullName -Force | Move-Item -Destination $target

        $script:Node = Join-Path $target 'node.exe'
        if (-not (Test-Path -LiteralPath $script:Node)) { Die 'the Node archive unpacked without a usable binary.' }
        & $script:Node (Join-Path $Repo 'scripts\node-ok.cjs') | Out-Null
        if ($LASTEXITCODE -ne 0) { Die "the Node that was downloaded does not satisfy this project's engines." }
    }
    finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

if (-not $Node) { Get-NodeRuntime }
Say "Node: $(& $Node -v) ($Node)"

# ---------------------------------------------------------------------------
# pnpm, from Corepack, at the version package.json pins
# ---------------------------------------------------------------------------
#
# Corepack ships inside Node, so this needs nothing installed and gets the exact
# pnpm named by packageManager. It has to be pnpm: esbuild fetches its platform
# binary in an install script, and only pnpm-workspace.yaml says which install
# scripts may run.

$NodeDir = Split-Path -Parent $Node
$env:PATH = "$NodeDir;$env:PATH"
# This may be running unattended, and a prompt nobody answers looks like a hang.
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

$Corepack = Join-Path $NodeDir 'corepack.cmd'
$UseCorepack = Test-Path -LiteralPath $Corepack
if (-not $UseCorepack) {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        Warn 'Corepack is missing; falling back to the pnpm already on this machine.'
    } else {
        Die "neither Corepack nor pnpm is available. Corepack ships with Node -- try 'corepack enable'."
    }
}

# A function rather than an array of command words: splatting the tail of a
# one-element array asks PowerShell for $a[1..0], which is a descending range
# and hands back the array reversed instead of nothing.
function Invoke-Pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    if ($UseCorepack) { & $Corepack pnpm @Arguments } else { & pnpm @Arguments }
}

Push-Location $Repo
try {
    Say 'Installing build dependencies...'
    Invoke-Pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Die 'the dependency install failed.' }

    Say 'Building...'
    Invoke-Pnpm run build
    if ($LASTEXITCODE -ne 0) { Die 'the build failed.' }
}
finally { Pop-Location }

# ---------------------------------------------------------------------------
# The install itself
# ---------------------------------------------------------------------------
#
# scripts\stage-install.mjs decides what an install contains, for all three
# platforms alike, so this script has no opinion about it.

Say 'Staging the install...'
& $Node (Join-Path $Repo 'scripts\stage-install.mjs') --home $BsHome --node $Node | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'staging the install failed.' }
$App = Join-Path $BsHome 'app'

# ---------------------------------------------------------------------------
# Something to double-click
# ---------------------------------------------------------------------------
#
# Two small files rather than one, because they answer two different needs.
#
# betterslack.cmd runs the loader and prints to whatever console started it, so
# it is the thing to run from a terminal when you want to watch it work.
# betterslack.vbs runs that same .cmd with no console at all and the output
# appended to a log, and it is what the Start menu shortcut points at. A
# shortcut aimed straight at node.exe would flash a console window on every
# launch and leave one open for as long as Slack ran.
#
# Both read the node-path file the macOS and Linux launchers read, and for the
# same reason: a process started from a shortcut inherits none of the user's
# shell setup, so the Node has to be the one the installer wrote down.

$LogFile = Join-Path $BsHome 'betterslack.log'

$cmd = @"
@echo off
rem Written by install.ps1 -- edit that, not this.
setlocal
set "APP=%~dp0"
set "NODE="
if exist "%APP%node-path" set /p NODE=<"%APP%node-path"
rem The recorded Node can be pruned or upgraded away; whatever is on PATH is
rem worth a try before giving up.
if not exist "%NODE%" set "NODE=node.exe"
if not exist "%APP%bin\betterslack.mjs" (
  echo BetterSlack is not installed. Run install.ps1 again from the repository.
  exit /b 1
)
rem Judged, not assumed. A recorded Node that has been pruned leaves whatever is
rem on PATH, which on a machine with nvm is its default version and can be far
rem too old to parse the loader -- a SyntaxError and nothing else.
"%NODE%" "%APP%scripts\node-ok.cjs" >nul 2>&1
if errorlevel 1 (
  echo BetterSlack cannot find a Node.js it can run on. Run install.ps1 again.
  exit /b 1
)
"%NODE%" "%APP%bin\betterslack.mjs" %*
"@

$cmdPath = Join-Path $App 'betterslack.cmd'
Set-Content -LiteralPath $cmdPath -Value $cmd -Encoding ASCII

$vbs = @"
' Starts BetterSlack with no console window, logging where someone can read it.
' Written by install.ps1 -- edit that, not this.
Option Explicit
Dim fso, shell, app, node, stream
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
app = fso.GetParentFolderName(WScript.ScriptFullName)

If Not fso.FileExists(app & "\bin\betterslack.mjs") Then
  MsgBox "BetterSlack is not installed." & vbCrLf & vbCrLf & _
         "Clone the repository and run install.ps1 again.", 16, "BetterSlack"
  WScript.Quit 1
End If

node = ""
If fso.FileExists(app & "\node-path") Then
  Set stream = fso.OpenTextFile(app & "\node-path", 1)
  If Not stream.AtEndOfStream Then node = Trim(stream.ReadLine())
  stream.Close
End If
If node = "" Or Not fso.FileExists(node) Then node = "node.exe"

' Checked here, before anything is launched. From a shortcut there is no console
' for an error to appear in, so a Node too old to parse the loader means the app
' simply never opens -- which is the failure this whole installer exists to
' prevent. node-ok.cjs answers in about the time it takes Node to start.
If shell.Run("cmd /c """"" & node & """ """ & app & "\scripts\node-ok.cjs"" >nul 2>&1""", 0, True) <> 0 Then
  MsgBox "BetterSlack cannot find a Node.js it can run on." & vbCrLf & vbCrLf & _
         "Run install.ps1 again from the repository; it fetches one if this " & _
         "machine has none.", 16, "BetterSlack"
  WScript.Quit 1
End If

' cmd /c with the whole command line in one more pair of quotes: that is how cmd
' wants a command whose program and arguments are each already quoted.
shell.Run "cmd /c """"" & app & "\betterslack.cmd"" >> ""$LogFile"" 2>&1""", 0, False
"@

$vbsPath = Join-Path $App 'betterslack.vbs'
Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startMenu 'BetterSlack.lnk'))
$link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$link.Arguments = """$vbsPath"""
$link.WorkingDirectory = $App
$link.Description = 'Start Slack with your themes and plugins applied'
# assets\icon.ico is not in the repository yet, so the shortcut wears the
# default icon until somebody adds one. Guarded rather than assumed, so the day
# it appears this needs no edit.
$icon = Join-Path $Repo 'assets\icon.ico'
if (Test-Path -LiteralPath $icon) { $link.IconLocation = $icon }
$link.Save()

Say 'Done.'
Write-Host ''
Write-Host "  BetterSlack is installed in $App"
Write-Host '  Launch it from the Start menu.'
Write-Host "  From a terminal, to watch it work: $cmdPath"
Write-Host "  Logs: $LogFile"
Write-Host ''
Write-Host '  This checkout is no longer needed and can be deleted.'
Write-Host '  Keep it only to work on BetterSlack itself.'
