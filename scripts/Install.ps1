#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('\A[1-9][0-9]{16,19}\z')]
    [string] $DiscordApplicationId,
    [ValidatePattern('\A[a-p]{32}\z')]
    [string] $ExtensionId,
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

Invoke-WithSetupLock {
    if (-not [IO.File]::Exists((Join-Path $payload 'TubePulse.exe')) -or
        -not [IO.File]::Exists((Join-Path $payload 'extension\manifest.json'))) {
        throw 'Extract the entire TubePulse Windows ZIP before running Install.ps1.'
    }
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
    }
    if (-not $DiscordApplicationId) {
        $DiscordApplicationId = (Read-Host 'Discord Application ID from Developer Portal > General Information').Trim()
    }
    if (-not (Test-DiscordId $DiscordApplicationId)) {
        throw 'Enter the numeric Application ID from your Discord application.'
    }
    if ($ExtensionId -and $ExtensionId -cnotmatch '\A[a-p]{32}\z') {
        throw 'Enter the 32-letter lowercase TubePulse ID shown in chrome://extensions.'
    }
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
        foreach ($file in @('Uninstall.ps1', 'Setup.Common.ps1')) {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stagingDir
        }
        if ($previousInstall) {
            Assert-TubePulseStopped
            [IO.Directory]::Move($installDir, $backupDir)
            $backedUp = $true
        }
        [IO.Directory]::Move($stagingDir, $installDir)
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
        if ($backedUp) { [IO.Directory]::Move($backupDir, $installDir) }
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
