param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$dialog = $null
$image = $null

try {
  $dialog = New-Object -ComObject WIA.CommonDialog
  # Scanner device, unspecified intent/bias/format. The Windows WIA and
  # installed vendor driver UI remain authoritative for source, color, DPI,
  # paper size, cropping, and any Canon-specific acquisition controls.
  $image = $dialog.ShowAcquireImage(
    1,
    0,
    0,
    "{00000000-0000-0000-0000-000000000000}",
    $true,
    $true,
    $false
  )

  if ($null -eq $image) {
    [pscustomobject]@{ status = "cancelled" } | ConvertTo-Json -Compress
    exit 0
  }

  $extension = [string]$image.FileExtension
  if ([string]::IsNullOrWhiteSpace($extension) -or $extension -notmatch '^[A-Za-z0-9]{2,5}$') {
    $extension = "bmp"
  }

  $filename = "scan-{0}.{1}" -f ([DateTime]::UtcNow.ToString("yyyyMMdd-HHmmssfff")), $extension.ToLowerInvariant()
  $outputPath = Join-Path -Path $OutputDirectory -ChildPath $filename
  $image.SaveFile($outputPath)

  [pscustomobject]@{
    status = "acquired"
    path = $outputPath
    filename = $filename
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $image) {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($image)
  }
  if ($null -ne $dialog) {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($dialog)
  }
}
