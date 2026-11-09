#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $repoRoot 'apps\extension\dist'
$manifestPath = Join-Path $extension 'manifest.json'
if (-not [IO.File]::Exists($manifestPath)) {
    throw 'Build the Chrome extension before packaging it.'
}

$manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or $manifest.version -notmatch '\A[0-9]+(?:\.[0-9]+){1,3}\z' -or
    -not $manifest.background.service_worker -or -not $manifest.action.default_popup -or -not $manifest.icons.'128') {
    throw 'The build must contain a versioned Manifest V3 extension with a service worker, popup and 128 px icon.'
}

$files = @{}
foreach ($file in Get-ChildItem -LiteralPath $extension -File -Recurse -Force) {
    $name = $file.FullName.Substring($extension.Length + 1).Replace('\', '/')
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint -or
        $file.Extension -notin @('.js', '.css', '.html', '.json', '.png', '.svg', '.webp')) {
        throw "Unexpected file in Chrome build: '$name'."
    }
    $files[$name] = $file.FullName
}
$references = @($manifest.background.service_worker, $manifest.action.default_popup)
$references += $manifest.icons.PSObject.Properties.Value
$references += $manifest.action.default_icon.PSObject.Properties.Value
foreach ($script in $manifest.content_scripts) {
    $references += @($script.js) + @($script.css)
}
foreach ($reference in $references) {
    if ($reference -and -not $files.ContainsKey($reference)) {
        throw "Chrome manifest references a missing build file: '$reference'."
    }
}

$files['licenses/TubePulse-LICENSE.txt'] = Join-Path $repoRoot 'LICENSE'
$files['licenses/Zod-LICENSE.txt'] = Join-Path $repoRoot 'node_modules\zod\LICENSE'
$files['licenses/Vite-LICENSE.md'] = Join-Path $repoRoot 'node_modules\vite\LICENSE.md'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artifactDir = Join-Path $repoRoot 'artifacts'
[void][IO.Directory]::CreateDirectory($artifactDir)
if ((Get-Item -LiteralPath $artifactDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The artifacts folder must be a regular directory.'
}
$zipName = "TubePulse-$($manifest.version)-chrome.zip"
$zipPath = Join-Path $artifactDir $zipName
$temporaryZip = Join-Path $artifactDir ('.chrome-' + [Guid]::NewGuid().ToString('N') + '.zip')
$names = [string[]]$files.Keys
[Array]::Sort($names, [StringComparer]::Ordinal)
$timestamp = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)

try {
    $archive = [IO.Compression.ZipFile]::Open($temporaryZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $names) {
            $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $timestamp
            $source = [IO.File]::OpenRead($files[$name])
            try {
                $destination = $entry.Open()
                try { $source.CopyTo($destination) }
                finally { $destination.Dispose() }
            }
            finally { $source.Dispose() }
        }
    }
    finally { $archive.Dispose() }

    if ([IO.File]::Exists($zipPath)) { [IO.File]::Replace($temporaryZip, $zipPath, [NullString]::Value) }
    else { [IO.File]::Move($temporaryZip, $zipPath) }

    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($zipPath)
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally {
        $stream.Dispose()
        $hasher.Dispose()
    }
    [IO.File]::WriteAllText("$zipPath.sha256", "$hash  $zipName`n", (New-Object Text.UTF8Encoding($false)))
    Write-Host "Created '$zipPath' and its SHA-256 checksum."
}
finally {
    [IO.File]::Delete($temporaryZip)
}
