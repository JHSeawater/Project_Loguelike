param(
    [string]$Asset = 'all',
    [switch]$Force,
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($ProjectRoot)
$directions = @('down', 'left', 'right', 'up')
$results = @()
$toolFiles = @($PSCommandPath, (Join-Path $PSScriptRoot 'sprite-processor.cs'))

function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Inside([string]$Base, [string]$Relative) {
    $basePath = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
    $path = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (!$path.StartsWith($basePath, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes root: $Relative" }
    return $path
}
function WriteJson($Object, [string]$Path) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Object -Depth 30) + "`n", [Text.UTF8Encoding]::new($false))
}
# One-row sheets (projectiles, pickups): no direction rows; frames sit side by side around a pivot.
function CheckStrip($p) {
    if ($p.id -notmatch '^[a-z][a-z0-9_]*$' -or $p.folder -notin @('projectiles','pickups','effects')) { throw 'Invalid id or folder' }
    if ($p.frame_size.Count -ne 2 -or $p.pivot.Count -ne 2) { throw 'Expected two-dimensional sizes' }
    for ($i=0; $i -lt 2; $i++) { if ($p.frame_size[$i] -lt 4 -or $p.frame_size[$i] -gt 512 -or $p.pivot[$i] -lt 0 -or $p.pivot[$i] -gt $p.frame_size[$i]) { throw 'Invalid frame or pivot' } }
    if ($p.frames -lt 1 -or $p.frames -gt 16 -or $p.fps -le 0 -or $p.target_width -lt 2 -or $p.align -notin @('core','center','bottom') -or $p.alpha -notin @('binary','soft') -or ($p.split -and $p.split -notin @('gap','valley'))) { throw 'Invalid frames, size, align, alpha or split' }
    $null = Inside $root $p.source
    if ($p.palettes -and (@($p.palettes | Where-Object { $_.suffix -notmatch '^[a-z]+$' -or $_.color -notmatch '^#[0-9a-fA-F]{6}$' }).Count -or @($p.palettes.suffix | Sort-Object -Unique).Count -ne $p.palettes.Count)) { throw 'Invalid palettes' }
}
function CheckProfile($p) {
    if ($p.layout -eq 'strip') { CheckStrip $p; return }
    if ($p.id -notmatch '^[a-z][a-z0-9_]*$' -or $p.folder -notin @('characters','summons','enemies')) { throw 'Invalid id or folder' }
    if ($p.frame_size.Count -ne 2 -or $p.anchor.Count -ne 2 -or $p.body_size.Count -ne 2) { throw 'Expected two-dimensional sizes' }
    for ($i=0; $i -lt 2; $i++) {
        if ($p.frame_size[$i] -lt 16 -or $p.frame_size[$i] -gt 256 -or $p.anchor[$i] -lt 2 -or $p.anchor[$i] -gt $p.frame_size[$i]-2 -or $p.body_size[$i] -le 0) { throw 'Invalid frame, anchor or body size' }
    }
    if ($p.target_height -le 0 -or $p.target_height -gt $p.anchor[1]-2 -or $p.magic -notin @('none','green','cyan','red')) { throw 'Invalid height or magic mode' }
    if (($p.source_rows | Sort-Object -Unique).Count -ne 4 -or @($p.source_rows | Where-Object { $_ -notin $directions }).Count) { throw 'Expected all four source directions' }
    # Only assets with both attack and cast (the boss) have four animations.
    if ($p.animations.Count -notin @(3,4) -or @($p.animations.name | Sort-Object -Unique).Count -ne $p.animations.Count -or 'idle' -notin $p.animations.name -or 'walk' -notin $p.animations.name) { throw 'Expected idle, walk and one or two actions' }
    foreach ($a in $p.animations) {
        if ($a.name -notin @('idle','walk','cast','attack') -or $a.columns -lt 3 -or $a.columns -gt 16 -or $a.fps -le 0) { throw 'Invalid animation' }
        $null = Inside $root $a.source
        if ($a.rects -and $a.rects.Count -ne $a.columns*4*4) { throw 'Wrong explicit rectangle count' }
    }
    if ($p.body_alpha -lt 1 -or $p.body_alpha -gt 255 -or $p.core_alpha -lt $p.body_alpha -or $p.core_alpha -gt 255 -or $p.min_component_area -lt 1 -or $p.part_area -lt 1) { throw 'Invalid alpha or component threshold' }
}

$profileFolder = Inside $root 'sprite/profiles'
$profiles = @(Get-ChildItem -LiteralPath $profileFolder -Filter '*.json' | Sort-Object Name)
if ($Asset -ne 'all') { $profiles = @($profiles | Where-Object { $_.BaseName -eq $Asset }) }
if (!$profiles.Count) { throw "No profile found: $Asset" }
foreach ($profileFile in $profiles) {
    $stage = $null
    $currentAnimation = $null
    $result = [ordered]@{ asset=$profileFile.BaseName; status='failed'; preview_required=$false }
    try {
        $p = Get-Content -LiteralPath $profileFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        CheckProfile $p
        if ($p.id -ne $profileFile.BaseName) { throw 'Profile filename must match id' }
        $strip = $p.layout -eq 'strip'
        $sources = if ($strip) { @($p.source) } else { @($p.animations.source) }
        $missing = @($sources | Where-Object { !(Test-Path -LiteralPath (Inside $root $_) -PathType Leaf) })
        if ($missing.Count) {
            $result.status = 'missing'; $result.error = 'Missing source: ' + ($missing -join ', ')
            $results += [pscustomobject]$result
            continue
        }
        $signature = @((Hash $profileFile.FullName)) + @($toolFiles | ForEach-Object { Hash $_ }) + @($sources | ForEach-Object { Hash (Inside $root $_) })
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $inputHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($signature -join ':'))))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
        $output = Inside $root ('public/assets/sprites/' + $p.folder)
        $manifestPath = Inside $output ($p.id + '.json')
        # Keep an array even for one file; a bare string would concatenate with the manifest name below.
        $expected = @(if ($strip -and $p.palettes) { $p.palettes | ForEach-Object { $p.id + '_' + $_.suffix + '.png' } }
        elseif ($strip) { $p.id + '.png' }
        else {
            $p.animations | ForEach-Object {
                $p.id + '_' + $_.name + '.png'
                if ($p.magic -ne 'none') { $p.id + '_' + $_.name + '_magic.png' }
            }
        })
        $cached = $false
        if (!$Force -and (Test-Path -LiteralPath $manifestPath)) {
            try {
                $old = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $cached = $old.input_hash -eq $inputHash -and @($old.outputs.PSObject.Properties).Count -eq $expected.Count
                foreach ($name in $expected) {
                    $file = Inside $output $name
                    if (!(Test-Path -LiteralPath $file) -or $old.outputs.$name -ne (Hash $file)) { $cached = $false; break }
                }
            } catch { $cached = $false }
        }
        if ($cached) { $result.status='cached'; $results += [pscustomobject]$result; continue }
        if (!('SpriteProcessor' -as [type])) {
            Add-Type -AssemblyName System.Drawing
            Add-Type -Path $toolFiles[1] -ReferencedAssemblies System.Drawing,System.Core
        }
        $null = New-Item -ItemType Directory -Path $output -Force
        $stage = Inside $output ('.staging-' + [guid]::NewGuid().ToString('N'))
        $null = New-Item -ItemType Directory -Path $stage
        $previewFolder = Inside $root 'sprite/reports'
        $null = New-Item -ItemType Directory -Path $previewFolder -Force
        $preview = Inside $previewFolder ($p.id + '-preview.png')
        if ($strip) {
            $s = New-Object StripOptions
            $s.Id=$p.id; $s.Frames=$p.frames; $s.Width=$p.frame_size[0]; $s.Height=$p.frame_size[1]
            $s.PivotX=$p.pivot[0]; $s.PivotY=$p.pivot[1]; $s.TargetWidth=$p.target_width; $s.Align=$p.align; $s.BinaryAlpha=$p.alpha -eq 'binary'
            if ($p.split) { $s.Split=$p.split }
            # The first palette keeps the source colors; the others rotate hue from it.
            $colors = if ($p.palettes) { @($p.palettes.color) } else { @('#000000') }
            $s.Colors=[int[]]@($colors | ForEach-Object { [Convert]::ToInt32($_.Substring(1),16) }); $s.BaseColor=$s.Colors[0]
            $s.Suffixes=[string[]]@($(if ($p.palettes) { $p.palettes | ForEach-Object { '_' + $_.suffix } } else { '' }))
            $source = Inside $root $p.source
            $frames = [StripProcessor]::Process($source,$stage,$s)
            foreach ($name in $expected) { [StripProcessor]::Validate((Inside $stage $name),$s.Width,$s.Height,$s.Frames,$s.BinaryAlpha) }
            $animations = @([ordered]@{
                animation='strip'; source=$p.source; source_sha256=(Hash $source); sheets=$expected
                frame_size_px=$p.frame_size; sheet_size_px=@(($s.Width*$s.Frames),$s.Height); frame_count=$p.frames; fps=$p.fps
                pivot_px=$p.pivot; extraction=$frames
            })
            [StripProcessor]::Preview([string[]]@($expected | ForEach-Object { Inside $stage $_ }),$preview,$s.Width,$s.Height,$s.Frames,6)
        } else {
            $o = New-Object SpriteOptions
            $o.Id=$p.id; $o.MagicMode=$p.magic
            $o.Width=$p.frame_size[0]; $o.Height=$p.frame_size[1]; $o.AnchorX=$p.anchor[0]; $o.AnchorY=$p.anchor[1]
            $o.TargetHeight=$p.target_height; $o.Alpha=$p.body_alpha; $o.CoreAlpha=$p.core_alpha
            $o.MinArea=$p.min_component_area; $o.KeepParts=$p.keep_parts; $o.PartArea=$p.part_area
            $o.SourceRows=[int[]]@($directions | ForEach-Object { [Array]::IndexOf([object[]]$p.source_rows, $_) })
            $animations = @()
            foreach ($a in $p.animations) {
                $currentAnimation = $a.name
                $o.Rects = if ($a.rects) { [int[]]$a.rects } else { $null }
                $source = Inside $root $a.source
                $sheet = [SpriteProcessor]::Process($source,$stage,$a.name,$a.columns,$o)
                $body = $p.id + '_' + $a.name + '.png'
                [SpriteProcessor]::Validate((Inside $stage $body),$o.Width,$o.Height,$a.columns,$o.AnchorY,$true,$true)
                $magic = $null
                if ($p.magic -ne 'none') {
                    $magic = $p.id + '_' + $a.name + '_magic.png'
                    [SpriteProcessor]::Validate((Inside $stage $magic),$o.Width,$o.Height,$a.columns,$o.AnchorY,$false,[bool]$a.effect_required)
                }
                $animations += [ordered]@{
                    animation=$a.name; source=$a.source; source_sha256=(Hash $source)
                    body=$body; magic=$magic; frame_size_px=$p.frame_size; sheet_size_px=@(($o.Width*$a.columns),($o.Height*4))
                    frames_per_direction=$a.columns; frame_count=($a.columns*4); fps=$a.fps
                    directions=$directions; anchor_px=$p.anchor
                    body_rect_px=@(($o.AnchorX-$p.body_size[0]/2),($o.AnchorY-$p.body_size[1]),$p.body_size[0],$p.body_size[1])
                    margin_px=0; spacing_px=0; extraction=$sheet.Frames
                }
            }
            $currentAnimation = $null
            [SpriteProcessor]::Preview($stage,$preview,$p.id,[string[]]$p.animations.name,[int[]]$p.animations.columns,$o.Width,$o.Height,$p.magic -ne 'none')
        }
        $outputs = [ordered]@{}
        foreach ($name in $expected) { $outputs[$name] = Hash (Inside $stage $name) }
        $manifest = [ordered]@{ asset=$p.id; input_hash=$inputHash; outputs=$outputs; sheets=$animations }
        $manifestName = $p.id + '.json'
        WriteJson $manifest (Inside $stage $manifestName)
        # Validate everything before publication; restore the previous bytes if a write fails.
        $backup = @{}
        $publish = $expected + @($manifestName)
        foreach ($name in $publish) {
            $file = Inside $output $name
            $backup[$name] = if (Test-Path -LiteralPath $file) { [IO.File]::ReadAllBytes($file) } else { $null }
        }
        try {
            foreach ($name in $publish) {
                $file = Inside $output $name
                $staged = Inside $stage $name
                if (Test-Path -LiteralPath $file) { [IO.File]::Replace($staged,$file,(Inside $stage ($name + '.backup'))) }
                else { [IO.File]::Move($staged,$file) }
            }
        } catch {
            foreach ($name in $publish) {
                $file = Inside $output $name
                if ($null -ne $backup[$name]) { [IO.File]::WriteAllBytes($file,$backup[$name]) }
                elseif (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
            }
            throw
        }
        $result.status='processed'; $result.preview_required=$true
        $result.preview = 'sprite/reports/' + $p.id + '-preview.png'
    } catch { $result.status='failed'; $result.error=$(if ($currentAnimation) { $currentAnimation + ': ' } else { '' }) + $_.Exception.Message }
    finally {
        if ($stage -and (Test-Path -LiteralPath $stage)) {
            $verified = Inside $output ([IO.Path]::GetFileName($stage))
            if ($verified -ne $stage) { throw 'Unsafe staging cleanup' }
            Remove-Item -LiteralPath $verified -Recurse -Force
        }
    }
    $results += [pscustomobject]$result
}
$reportFolder = Inside $root 'sprite/reports'
$null = New-Item -ItemType Directory -Path $reportFolder -Force
WriteJson @($results) (Inside $reportFolder 'processing-report.json')
foreach ($r in $results) { Write-Output ($r.asset + ': ' + $r.status + $(if ($r.error) { ' - ' + $r.error } else { '' })) }
if (@($results | Where-Object { $_.status -in @('failed','missing') }).Count) { exit 1 }
