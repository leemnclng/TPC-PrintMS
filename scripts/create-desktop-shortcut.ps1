# Creates a Desktop shortcut for Printing-MS, with The Paper Club logo as its
# icon, that launches scripts\run.bat. Run this once:
#
#   powershell -ExecutionPolicy Bypass -File scripts\create-desktop-shortcut.ps1
#
# (or right-click this file -> "Run with PowerShell"). After that, use the
# "Printing-MS" icon it adds to the Desktop instead of re-running this script.
# A plain .bat file can't carry a custom icon on Windows — only a .lnk
# shortcut pointing at it can — which is what this creates.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot "scripts\run.bat"
$icon = Join-Path $repoRoot "apps\desktop\build\icon.ico"

if (-not (Test-Path $target)) {
  Write-Error "Couldn't find $target — run this script from inside the Printing-MS repo."
}
if (-not (Test-Path $icon)) {
  Write-Error "Couldn't find $icon."
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Printing-MS.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = "Printing-MS - The Paper Club"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
Write-Host "Double-click it any time to launch Printing-MS."
