<#
  setup-dev.ps1
  Pregateste masina de dezvoltare pentru Service Auto: instaleaza Node.js si Git
  daca lipsesc, apoi ruleaza npm install.

  Idempotent: poate fi rulat oricand, sare peste ce e deja instalat.
  Fiecare pas verifica explicit rezultatul, nu presupune ca a mers.

  Cascada de instalare pentru fiecare dependinta:
    1. winget (daca e disponibil)
    2. Chocolatey (daca e disponibil)
    3. Descarcare directa a installer-ului oficial + verificare + instalare silentioasa

  Daca toate cele 3 cai esueaza, scriptul se opreste cu un mesaj clar despre
  ce lipseste si un link direct de unde poate fi instalat manual.
#>

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    ATENTIE: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    EROARE: $msg" -ForegroundColor Red }

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
    # Installerele modifica PATH la nivel de masina/user, dar sesiunea curenta
    # de PowerShell nu vede schimbarea pana nu o recitim manual din registry.
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-WingetAvailable {
    return Test-CommandExists 'winget'
}

function Test-ChocoAvailable {
    return Test-CommandExists 'choco'
}

function Install-ViaWinget([string]$WingetId, [string]$FriendlyName) {
    Write-Host "    Incerc instalare prin winget ($WingetId)..."
    try {
        winget install --id $WingetId -e --accept-source-agreements --accept-package-agreements --silent
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "$FriendlyName instalat prin winget."
            return $true
        }
        Write-Warn2 "winget a returnat cod $LASTEXITCODE pentru $FriendlyName."
        return $false
    } catch {
        Write-Warn2 "winget a esuat pentru $FriendlyName`: $($_.Exception.Message)"
        return $false
    }
}

function Install-ViaChoco([string]$ChocoPackage, [string]$FriendlyName) {
    Write-Host "    Incerc instalare prin Chocolatey ($ChocoPackage)..."
    try {
        choco install $ChocoPackage -y --no-progress
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "$FriendlyName instalat prin Chocolatey."
            return $true
        }
        Write-Warn2 "choco a returnat cod $LASTEXITCODE pentru $FriendlyName."
        return $false
    } catch {
        Write-Warn2 "Chocolatey a esuat pentru $FriendlyName`: $($_.Exception.Message)"
        return $false
    }
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Install-NodeDirect {
    Write-Host "    Incerc descarcare directa a Node.js LTS de pe nodejs.org..."
    try {
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 20
        $lts = $index | Where-Object { $_.lts -ne $false } | Select-Object -First 1
        if (-not $lts) { throw "Nu s-a gasit nicio versiune LTS in index." }

        $version = $lts.version
        $msiName = "node-$version-x64.msi"
        $distUrl = "https://nodejs.org/dist/$version"
        $msiUrl = "$distUrl/$msiName"
        $shaSumsUrl = "$distUrl/SHASUMS256.txt"

        $tmpDir = Join-Path $env:TEMP "service-auto-setup"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        $msiPath = Join-Path $tmpDir $msiName

        Write-Host "    Descarc $msiUrl ..."
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -TimeoutSec 120

        Write-Host "    Verific integritatea (SHA256)..."
        $shaSums = Invoke-RestMethod -Uri $shaSumsUrl -TimeoutSec 20
        $expectedLine = ($shaSums -split "`n") | Where-Object { $_ -match [regex]::Escape($msiName) }
        if (-not $expectedLine) { throw "Nu am gasit hash-ul asteptat pentru $msiName." }
        $expectedHash = ($expectedLine -split '\s+')[0].ToLowerInvariant()
        $actualHash = Get-FileSha256 -Path $msiPath

        if ($expectedHash -ne $actualHash) {
            throw "Hash SHA256 nu se potriveste - fisierul descarcat ar putea fi corupt sau alterat. Asteptat $expectedHash, obtinut $actualHash."
        }
        Write-Ok "Integritate verificata."

        Write-Host "    Instalez Node.js $version silentios (poate cere permisiuni administrator)..."
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait -PassThru
        if ($proc.ExitCode -ne 0) { throw "msiexec a returnat cod $($proc.ExitCode)." }

        Write-Ok "Node.js $version instalat direct de pe nodejs.org."
        return $true
    } catch {
        Write-Warn2 "Descarcare/instalare directa Node.js esuata: $($_.Exception.Message)"
        return $false
    }
}

function Install-GitDirect {
    Write-Host "    Incerc descarcare directa a Git for Windows de pe GitHub Releases..."
    try {
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'service-auto-setup' } -TimeoutSec 20
        $asset = $release.assets | Where-Object { $_.name -match '64-bit\.exe$' } | Select-Object -First 1
        if (-not $asset) { throw "Nu am gasit installer-ul 64-bit in release-ul cel mai recent." }

        $tmpDir = Join-Path $env:TEMP "service-auto-setup"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        $exePath = Join-Path $tmpDir $asset.name

        Write-Host "    Descarc $($asset.browser_download_url) ..."
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $exePath -TimeoutSec 180

        # Verificare minimala: fisierul descarcat trebuie sa fie un executabil PE valid, nu o pagina de eroare HTML.
        $bytes = [System.IO.File]::ReadAllBytes($exePath)
        if ($bytes.Length -lt 1000 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
            throw "Fisierul descarcat nu pare un executabil valid (asteptat semnatura MZ)."
        }

        Write-Host "    Instalez Git silentios (poate cere permisiuni administrator)..."
        $proc = Start-Process $exePath -ArgumentList '/VERYSILENT /NORESTART /NOCANCEL /SP-' -Wait -PassThru
        if ($proc.ExitCode -ne 0) { throw "Installer-ul Git a returnat cod $($proc.ExitCode)." }

        Write-Ok "Git instalat direct de pe GitHub Releases."
        return $true
    } catch {
        Write-Warn2 "Descarcare/instalare directa Git esuata: $($_.Exception.Message)"
        return $false
    }
}

function Ensure-Dependency {
    param(
        [string]$CommandName,
        [string]$FriendlyName,
        [string]$WingetId,
        [string]$ChocoPackage,
        [scriptblock]$DirectInstall,
        [string]$ManualUrl
    )

    Write-Step "Verific $FriendlyName"
    if (Test-CommandExists $CommandName) {
        Write-Ok "$FriendlyName este deja instalat."
        return $true
    }

    $installed = $false

    if (Test-WingetAvailable) {
        $installed = Install-ViaWinget -WingetId $WingetId -FriendlyName $FriendlyName
        if ($installed) { Update-SessionPath }
    } else {
        Write-Warn2 "winget nu este disponibil pe acest sistem."
    }

    if (-not $installed) {
        if (Test-ChocoAvailable) {
            $installed = Install-ViaChoco -ChocoPackage $ChocoPackage -FriendlyName $FriendlyName
            if ($installed) { Update-SessionPath }
        } else {
            Write-Warn2 "Chocolatey nu este disponibil pe acest sistem."
        }
    }

    if (-not $installed) {
        $installed = & $DirectInstall
        if ($installed) { Update-SessionPath }
    }

    if (-not $installed -or -not (Test-CommandExists $CommandName)) {
        Write-Fail "$FriendlyName nu a putut fi instalat automat prin nicio metoda (winget, Chocolatey, descarcare directa)."
        Write-Fail "Instaleaza manual de aici: $ManualUrl"
        Write-Fail "Apoi ruleaza din nou acest script."
        return $false
    }

    Write-Ok "$FriendlyName este acum disponibil."
    return $true
}

# --- Flux principal ---

$nodeOk = Ensure-Dependency -CommandName 'node' -FriendlyName 'Node.js' `
    -WingetId 'OpenJS.NodeJS.LTS' -ChocoPackage 'nodejs-lts' `
    -DirectInstall { Install-NodeDirect } -ManualUrl 'https://nodejs.org/'

$gitOk = Ensure-Dependency -CommandName 'git' -FriendlyName 'Git' `
    -WingetId 'Git.Git' -ChocoPackage 'git' `
    -DirectInstall { Install-GitDirect } -ManualUrl 'https://git-scm.com/download/win'

if (-not $nodeOk) {
    Write-Fail "`nNode.js este obligatoriu pentru acest proiect. Scriptul se opreste aici."
    exit 1
}
if (-not $gitOk) {
    Write-Warn2 "`nGit lipseste - nu e obligatoriu pentru a rula aplicatia, dar e recomandat pentru dezvoltare/actualizari."
}

Write-Step "Instalez dependintele proiectului (npm install)"
Push-Location $ProjectRoot
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install a returnat cod $LASTEXITCODE." }
    Write-Ok "Dependinte instalate cu succes."
} catch {
    Write-Fail "npm install a esuat: $($_.Exception.Message)"
    Write-Fail "Verifica mesajele de mai sus si reincearca. Daca problema persista, sterge folderul node_modules si fisierul package-lock.json, apoi ruleaza din nou scriptul."
    Pop-Location
    exit 1
} finally {
    Pop-Location
}

Write-Step "Gata"
Write-Ok "Mediul de dezvoltare este pregatit. Ruleaza 'npm run dev' din $ProjectRoot pentru a porni aplicatia."
