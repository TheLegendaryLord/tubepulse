#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('\A[1-9][0-9]{16,19}\z')]
    [string] $DiscordApplicationId,
    [ValidatePattern('\A[a-p]{32}\z')]
    [string] $ExtensionId,
    [string] $NodePath,
    [switch] $LaunchChromeAtSignIn
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Setup.Common.ps1')
$payload = Join-Path $PSScriptRoot 'payload'
$startupChanged = $PSBoundParameters.ContainsKey('LaunchChromeAtSignIn')

function Test-DiscordId([string] $Id) {
    $number = [UInt64]0
    return $Id -cmatch '\A[1-9][0-9]{16,19}\z' -and [UInt64]::TryParse($Id, [ref]$number)
}

function Resolve-LiteNode([string] $Path) {
    if (-not $Path) {
        $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { $Path = $command.Source }
    }
    if ($Path -notmatch '\A[A-Z]:\\' -or
        [IO.Path]::GetFileName($Path) -ine 'node.exe' -or -not [IO.File]::Exists($Path)) {
        throw 'Windows Lite needs Node.js 22 or 24 LTS. Install Node.js and reopen setup, or pass -NodePath with the full path to node.exe.'
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    $previousOptions = $env:NODE_OPTIONS
    $previousNodePath = $env:NODE_PATH
    try {
        $env:NODE_OPTIONS = $null
        $env:NODE_PATH = $null
        $versionText = & $resolved --version
        if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '\Av((?:22|24)\.\d+\.\d+)\z' -or
            [version]$Matches[1] -lt [version]'22.13.0') {
            throw 'Windows Lite requires Node.js 22.13 or later in the 22 LTS line, or Node.js 24 LTS.'
        }
    }
    finally {
        $env:NODE_OPTIONS = $previousOptions
        $env:NODE_PATH = $previousNodePath
    }
    return $resolved
}

Invoke-WithSetupLock {
    if (-not [IO.File]::Exists((Join-Path $payload 'TubePulse.exe')) -or
        -not [IO.File]::Exists((Join-Path $payload 'extension\manifest.json'))) {
        throw 'Extract the entire TubePulse Windows ZIP before running Install.ps1.'
    }
    $lite = [IO.File]::Exists((Join-Path $payload 'tubepulse.cjs'))
    $runtimePathFile = 'node-path.txt'
    $previousInstall = Test-Path -LiteralPath $installDir
    if ($previousInstall) {
        Assert-ManagedDirectory $installDir
        Assert-TubePulseStopped
        if ((-not $DiscordApplicationId -or -not $ExtensionId) -and [IO.File]::Exists($configPath)) {
            $previousConfig = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
            if (-not $DiscordApplicationId -and (Test-DiscordId $previousConfig.discordApplicationId)) {
                $DiscordApplicationId = $previousConfig.discordApplicationId
            }
            if (-not $ExtensionId -and $previousConfig.extensionId -cmatch '\A[a-p]{32}\z') {
                $ExtensionId = $previousConfig.extensionId
            }
        }
        $previousRuntimePath = Join-Path $installDir $runtimePathFile
        if ($lite -and -not $NodePath -and [IO.File]::Exists($previousRuntimePath)) {
            $savedNode = [IO.File]::ReadAllText($previousRuntimePath)
            if ([IO.File]::Exists($savedNode)) { $NodePath = $savedNode }
        }
    }
    if (-not $DiscordApplicationId) {
        $DiscordApplicationId = '1569423752796708894'
    }
    if (-not (Test-DiscordId $DiscordApplicationId)) {
        throw 'Enter the numeric Application ID from your Discord application.'
    }
    if ($ExtensionId -and $ExtensionId -cnotmatch '\A[a-p]{32}\z') {
        throw 'Enter the 32-letter lowercase TubePulse ID shown in chrome://extensions.'
    }
    if ($lite) { $NodePath = Resolve-LiteNode $NodePath }
    $startupCommand = if ($LaunchChromeAtSignIn) { Get-ChromeStartupCommand }

    $suffix = [Guid]::NewGuid().ToString('N')
    $stagingDir = Join-Path $localAppData "TubePulse.install-$suffix"
    $backupDir = Join-Path $localAppData "TubePulse.backup-$suffix"
    $promoted = $false
    $backedUp = $false
    [void][IO.Directory]::CreateDirectory($stagingDir)
    [IO.File]::WriteAllText((Join-Path $stagingDir $installationMarker), 'TubePulse setup v1', $utf8)
    try {
        foreach ($item in (Get-ChildItem -LiteralPath $payload -Force)) {
            Copy-Item -LiteralPath $item.FullName -Destination $stagingDir -Recurse -Force
        }
        if ($lite) { [IO.File]::WriteAllText((Join-Path $stagingDir $runtimePathFile), $NodePath, $utf8) }
        foreach ($file in @('Uninstall.ps1', 'Setup.Common.ps1')) {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stagingDir
        }
        if ($previousInstall) {
            Assert-TubePulseStopped
            Move-ManagedDirectory $installDir $backupDir
            $backedUp = $true
        }
        Move-ManagedDirectory $stagingDir $installDir
        $promoted = $true

        if (-not $ExtensionId) {
            Write-Host 'In Google Chrome, open chrome://extensions and enable Developer mode.'
            Write-Host "Click Load unpacked and select '$(Join-Path $installDir 'extension')'."
            $ExtensionId = (Read-Host 'TubePulse extension ID shown on that page').Trim()
        }
        if ($ExtensionId -cnotmatch '\A[a-p]{32}\z') {
            throw 'Enter the 32-letter lowercase TubePulse ID shown in chrome://extensions.'
        }

        $config = @{ discordApplicationId = $DiscordApplicationId; extensionId = $ExtensionId }
        $manifest = @{
            name = $hostName
            description = 'TubePulse native messaging companion'
            path = $executablePath
            type = 'stdio'
            allowed_origins = @("chrome-extension://$ExtensionId/")
        }
        [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8)
        [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $utf8)
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($hostRegistration)
        try { $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $key.Dispose() }
    }
    catch {
        if ($promoted) { Remove-ManagedDirectory $installDir }
        if ($backedUp) { Move-ManagedDirectory $backupDir $installDir }
        throw
    }
    finally {
        if (Test-Path -LiteralPath $stagingDir) { Remove-ManagedDirectory $stagingDir }
    }
    if ($backedUp) { Remove-ManagedDirectory $backupDir }
    if ($startupChanged) { Set-ChromeStartupCommand $startupCommand }

    Write-Host "TubePulse is registered for this Windows user at '$installDir'."
    Write-Host 'Open Chrome and reload TubePulse from chrome://extensions, then open its popup.'
}
