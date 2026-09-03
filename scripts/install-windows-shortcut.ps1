$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'TravelCamera.cmd'
if (-not (Test-Path $launcher)) {
    throw "TravelCamera.cmd not found: $launcher"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Travel Camera Visualizer.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Travel Camera Visualizer - update and launch local app'
$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
Write-Host 'From now on, double-click the shortcut to update and start Travel Camera Visualizer.'
