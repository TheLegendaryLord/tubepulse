$hostName = 'com.tubepulse.host'
$hostRegistration = "Software\Google\Chrome\NativeMessagingHosts\$hostName"
$startupRegistration = 'Software\Microsoft\Windows\CurrentVersion\Run'
$installationMarker = 'TubePulse.install'
$utf8 = New-Object Text.UTF8Encoding($false)

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'TubePulse setup requires Windows.'
}

if (-not $env:LOCALAPPDATA -or -not [IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
    throw 'Windows did not provide a valid LOCALAPPDATA path.'
}

$localAppData = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
if ($localAppData -eq [IO.Path]::GetPathRoot($env:LOCALAPPDATA).TrimEnd('\')) {
    throw 'LOCALAPPDATA cannot be a drive root.'
}
$installDir = Join-Path $localAppData 'TubePulse'
$configPath = Join-Path $installDir 'config.json'
$manifestPath = Join-Path $installDir "$hostName.json"
$executablePath = Join-Path $installDir 'TubePulse.exe'

function Invoke-WithSetupLock([scriptblock] $Action) {
    $mutex = New-Object Threading.Mutex($false, 'Local\TubePulse.Setup')
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { throw 'Another TubePulse setup is already running.' }
        & $Action
    }
    finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Assert-TubePulseStopped {
    $process = Get-Process -Name TubePulse -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $executablePath }
    if ($process) {
        throw 'TubePulse is still running. Use Chrome menu > Exit and run setup again.'
    }
}

function Assert-ManagedDirectory([string] $Path) {
    $directory = Get-Item -LiteralPath $Path -Force
    if (-not $directory.PSIsContainer -or
        $directory.Parent.FullName -ine $localAppData -or
        $directory.Name -cnotmatch '\ATubePulse(?:\.(?:install|backup)-[0-9a-f]{32})?\z' -or
        ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        -not [IO.File]::Exists((Join-Path $directory.FullName $installationMarker))) {
        throw "Setup cannot verify ownership of '$Path'. Move it aside before continuing."
    }
}

function Remove-ManagedDirectory([string] $Path) {
    Assert-ManagedDirectory $Path
    [IO.Directory]::Delete([IO.Path]::GetFullPath($Path), $true)
}

function Get-ChromeStartupCommand {
    $candidates = foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($base) { Join-Path $base 'Google\Chrome\Application\chrome.exe' }
    }
    foreach ($candidate in $candidates) {
        if ([IO.File]::Exists($candidate)) {
            $command = '"{0}" --no-startup-window' -f $candidate
            if ($command.Length -gt 260) { throw 'The Chrome startup command exceeds the Windows Run entry limit.' }
            return $command
        }
    }
    throw 'Setup could not locate Google Chrome in its standard installation folders.'
}

function Set-ChromeStartupCommand([string] $Command) {
    $key = if ($Command) {
        [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($startupRegistration)
    }
    else {
        [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($startupRegistration, $true)
    }
    if (-not $key) { return }
    try {
        if ($Command) { $key.SetValue('TubePulse', $Command, [Microsoft.Win32.RegistryValueKind]::String) }
        else { $key.DeleteValue('TubePulse', $false) }
    }
    finally { $key.Dispose() }
}
