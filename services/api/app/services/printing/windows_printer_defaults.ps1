param(
    [Parameter(Mandatory = $true)][string]$PrinterName
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$settings = [System.Drawing.Printing.PrinterSettings]::new()
$settings.PrinterName = $PrinterName
if (-not $settings.IsValid) {
    $settings.Dispose()
    throw "The selected Windows printer queue is unavailable."
}

try {
    $page = $settings.DefaultPageSettings
    $resolutionKind = $page.PrinterResolution.Kind.ToString()
    $quality = if ($resolutionKind -eq "Draft") { "draft" } elseif ($resolutionKind -eq "High") { "high" } elseif ($resolutionKind -eq "Medium") { "standard" } else { "auto" }
    $paper = $page.PaperSize
    $payload = [ordered]@{
        orientation = if ($page.Landscape) { "landscape" } else { "portrait" }
        colorMode = if ($page.Color) { "color" } else { "grayscale" }
        quality = $quality
        copies = [Math]::Max(1, [int]$settings.Copies)
        collate = [bool]$settings.Collate
        duplex = $settings.Duplex.ToString().ToLowerInvariant()
        paperName = $paper.PaperName
        paperWidthMm = [Math]::Round($paper.Width * 25.4 / 100, 1)
        paperHeightMm = [Math]::Round($paper.Height * 25.4 / 100, 1)
    }
    $payload | ConvertTo-Json -Compress
}
finally {
    $settings.Dispose()
}
