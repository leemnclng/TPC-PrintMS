# Creates a Desktop shortcut for Printing-MS, with The Paper Club logo as its
# icon, that launches scripts/run.sh through Git Bash — the same way this
# repo's own dev workflow runs it. Run this once:
#
#   powershell -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1
#
# Right-click this file -> "Run with PowerShell" also works. Do NOT
# double-click it directly — Windows opens .ps1 files in a text editor
# instead of running them, which silently does nothing.
#
# After that, use the "Printing-MS" icon it adds to the Desktop instead of
# re-running this script. Requires Git for Windows (the same Git Bash you'd
# use to run scripts/run.sh by hand).

$ErrorActionPreference = "Stop"

function Find-BashLauncher {
  $gitRoots = @()

  $gitOnPath = Get-Command "git.exe" -ErrorAction SilentlyContinue
  if ($gitOnPath) { $gitRoots += (Split-Path -Parent (Split-Path -Parent $gitOnPath.Source)) }

  foreach ($key in @("HKLM:\SOFTWARE\GitForWindows", "HKCU:\SOFTWARE\GitForWindows")) {
    $installPath = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).InstallPath
    if ($installPath) { $gitRoots += $installPath }
  }

  $gitRoots += "$env:ProgramFiles\Git"
  $gitRoots += "${env:ProgramFiles(x86)}\Git"
  $gitRoots += "$env:LocalAppData\Programs\Git"

  $roots = $gitRoots | Where-Object { $_ } | Select-Object -Unique

  # Prefer git-bash.exe: the real Git Bash window the user already knows
  # from running scripts/run.sh by hand (this is also how Git for Windows
  # itself associates .sh files for double-click launching).
  foreach ($root in $roots) {
    $gitBash = Join-Path $root "git-bash.exe"
    if (Test-Path -LiteralPath $gitBash -PathType Leaf) {
      return @{ Path = (Resolve-Path -LiteralPath $gitBash).Path; ArgumentFormat = '"{0}"' }
    }
  }
  # Fall back to the bare bash.exe interpreter if only that is present.
  foreach ($root in $roots) {
    $bash = Join-Path $root "bin\bash.exe"
    if (Test-Path -LiteralPath $bash -PathType Leaf) {
      return @{ Path = (Resolve-Path -LiteralPath $bash).Path; ArgumentFormat = '--login -i "{0}"' }
    }
  }
  return $null
}

try {
  $repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  $target = [IO.Path]::GetFullPath((Join-Path $repoRoot "scripts\run.sh"))
  $icon = [IO.Path]::GetFullPath((Join-Path $repoRoot "apps\desktop\build\icon.ico"))

  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Couldn't find $target — run this script from inside the Printing-MS repo."
  }
  if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) {
    throw "Couldn't find $icon."
  }

  $launcher = Find-BashLauncher
  if (-not $launcher) {
    throw "Couldn't find Git Bash (git-bash.exe or bash.exe) anywhere on this machine. Install Git for Windows (https://git-scm.com/download/win) - it's what run.sh needs to launch through - then run this script again."
  }

  $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
  if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw "Windows did not return a usable Desktop folder."
  }
  $shortcutPath = Join-Path $desktop "Printing-MS.lnk"

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcher.Path
  $shortcut.Arguments = $launcher.ArgumentFormat -f $target
  $shortcut.WorkingDirectory = $repoRoot
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Description = "Printing-MS - The Paper Club"
  $shortcut.WindowStyle = 1
  $shortcut.Save()

  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "Windows did not create the shortcut at $shortcutPath."
  }

  Write-Host "Created desktop shortcut: $shortcutPath"
  Write-Host "Launcher: $($launcher.Path)"
  Write-Host "Double-click the Desktop icon any time to launch Printing-MS through Git Bash. Closing the app also closes its launcher terminal."
}
catch {
  Write-Host ""
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Write-Host ""
  Read-Host "Press Enter to close this window"
}
