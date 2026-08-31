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

$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$target = [IO.Path]::GetFullPath((Join-Path $repoRoot "scripts\run.bat"))
$icon = [IO.Path]::GetFullPath((Join-Path $repoRoot "apps\desktop\build\icon.ico"))

if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
  Write-Error "Couldn't find $target — run this script from inside the Printing-MS repo."
}
if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) {
  Write-Error "Couldn't find $icon."
}

$commandProcessor = $env:ComSpec
if ([string]::IsNullOrWhiteSpace($commandProcessor) -or -not (Test-Path -LiteralPath $commandProcessor -PathType Leaf)) {
  $commandProcessor = (Get-Command "cmd.exe" -ErrorAction Stop).Source
}

$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
  Write-Error "Windows did not return a usable Desktop folder."
}
$shortcutPath = Join-Path $desktop "Printing-MS.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $commandProcessor
$shortcut.Arguments = '/d /c ""{0}""' -f $target
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = "Printing-MS - The Paper Club"
$shortcut.WindowStyle = 1
$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
  Write-Error "Windows did not create the shortcut at $shortcutPath."
}

Write-Host "Created desktop shortcut: $shortcutPath"
Write-Host "Double-click it any time to launch Printing-MS. Closing the app also closes its launcher terminal."
