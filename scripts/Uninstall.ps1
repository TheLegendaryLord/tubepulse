#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Setup.Common.ps1')

Invoke-WithSetupLock {
    if (Test-Path -LiteralPath $installDir) {
        Assert-ManagedDirectory $installDir
        Assert-TubePulseStopped
        if ((Get-Location).Provider.Name -eq 'FileSystem' -and
            ((Get-Location).ProviderPath -ieq $installDir -or
             (Get-Location).ProviderPath.StartsWith("$installDir\", [StringComparison]::OrdinalIgnoreCase))) {
            Set-Location -LiteralPath $localAppData
        }
        Remove-ManagedDirectory $installDir
    }

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($hostRegistration)
    if ($key) {
        try { $ownedRegistration = $key.GetValue('') -ieq $manifestPath }
        finally { $key.Dispose() }
        if ($ownedRegistration) {
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($hostRegistration, $false)
        }
    }
    Set-ChromeStartupCommand ''
    Write-Host 'TubePulse companion removed. Remove TubePulse from chrome://extensions to erase its browser settings.'
}
