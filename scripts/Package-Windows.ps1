#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$nodeInfo = & $node -p 'JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})' | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $nodeInfo.version -notlike 'v24.*' -or
    $nodeInfo.platform -ne 'win32' -or $nodeInfo.arch -ne 'x64') {
    throw 'Windows packaging requires a Windows x64 build of Node.js 24 LTS.'
}

$nodeLicense = Join-Path (Split-Path -Parent $node) 'LICENSE'
$postject = Join-Path $repoRoot 'node_modules\postject\dist\cli.js'
$companion = Join-Path $repoRoot 'apps\companion\dist\tubepulse.cjs'
$extension = Join-Path $repoRoot 'apps\extension\dist'
if (-not [IO.File]::Exists($nodeLicense)) {
    throw 'Node.js LICENSE is missing next to node.exe. Use the official Node.js Windows ZIP distribution.'
}
if (-not [IO.File]::Exists($postject) -or -not [IO.File]::Exists($companion) -or
    -not [IO.File]::Exists((Join-Path $extension 'manifest.json'))) {
    throw 'Run npm ci and npm run build before packaging.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = New-Object Text.UTF8Encoding($false)
$artifactDir = Join-Path $repoRoot 'artifacts'
[void][IO.Directory]::CreateDirectory($artifactDir)
if ((Get-Item -LiteralPath $artifactDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The artifacts folder must be a regular directory.'
}
$scratch = Join-Path $artifactDir ('.package-' + [Guid]::NewGuid().ToString('N'))
$content = Join-Path $scratch 'package'
$payload = Join-Path $content 'payload'
$licenses = Join-Path $payload 'licenses'
$zipName = "TubePulse-$($package.version)-windows-x64.zip"
$zipPath = Join-Path $artifactDir $zipName
[void][IO.Directory]::CreateDirectory($licenses)

try {
    Copy-Item -LiteralPath $companion -Destination (Join-Path $scratch 'companion.cjs')
    $seaConfig = @{
        main = 'companion.cjs'
        output = 'sea-prep.blob'
        disableExperimentalSEAWarning = $true
        useSnapshot = $false
        useCodeCache = $false
        execArgvExtension = 'none'
    }
    [IO.File]::WriteAllText((Join-Path $scratch 'sea-config.json'), ($seaConfig | ConvertTo-Json), $utf8)
    Copy-Item -LiteralPath $node -Destination (Join-Path $payload 'TubePulse.exe')
    Push-Location -LiteralPath $scratch
    try {
        & $node --experimental-sea-config sea-config.json
        if ($LASTEXITCODE -ne 0) { throw 'Node.js failed to generate the companion executable payload.' }
        & $node $postject 'package\payload\TubePulse.exe' NODE_SEA_BLOB sea-prep.blob `
            --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
        if ($LASTEXITCODE -ne 0) { throw 'Failed to inject the companion executable payload.' }
    }
    finally { Pop-Location }

    Copy-Item -LiteralPath $extension -Destination (Join-Path $payload 'extension') -Recurse
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $licenses 'Node-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $licenses 'TubePulse-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'node_modules\zod\LICENSE') -Destination (Join-Path $licenses 'Zod-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'node_modules\vite\LICENSE.md') -Destination (Join-Path $licenses 'Vite-LICENSE.md')
    foreach ($file in @('Install.ps1', 'Uninstall.ps1', 'Setup.Common.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $content
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\windows.md') -Destination (Join-Path $content 'WINDOWS.md')
    [IO.File]::WriteAllText((Join-Path $content 'BUILD-INFO.txt'), "TubePulse $($package.version)`nNode.js $($nodeInfo.version) (Windows x64)`n", $utf8)

    $temporaryZip = Join-Path $scratch $zipName
    $archive = [IO.Compression.ZipFile]::Open($temporaryZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $timestamp = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $files = [IO.Directory]::GetFiles($content, '*', [IO.SearchOption]::AllDirectories)
        [Array]::Sort($files, [StringComparer]::Ordinal)
        foreach ($file in $files) {
            $entryName = $file.Substring($content.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $timestamp
            $source = [IO.File]::OpenRead($file)
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
    $archiveStream = [IO.File]::OpenRead($zipPath)
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant() }
    finally {
        $archiveStream.Dispose()
        $hasher.Dispose()
    }
    [IO.File]::WriteAllText("$zipPath.sha256", "$hash  $zipName`n", $utf8)
    Write-Host "Created '$zipPath' and its SHA-256 checksum."
}
finally {
    $scratchItem = Get-Item -LiteralPath $scratch -Force
    if ($scratchItem.Parent.FullName -ieq $artifactDir -and
        $scratchItem.Name -cmatch '\A\.package-[0-9a-f]{32}\z' -and
        -not ($scratchItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        [IO.Directory]::Delete($scratchItem.FullName, $true)
    }
}
