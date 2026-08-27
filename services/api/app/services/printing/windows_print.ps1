param(
    [Parameter(Mandatory = $true)][string]$ImageDirectory,
    [Parameter(Mandatory = $true)][string]$DocumentName,
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][ValidateRange(1, 99)][int]$Copies,
    [Parameter(Mandatory = $true)][ValidateSet("color", "grayscale")][string]$ColorMode,
    [Parameter(Mandatory = $true)][ValidateSet("A4", "Letter", "Legal")][string]$MediaSize
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ImageDirectory -PathType Container)) {
    throw "The rendered print pages do not exist."
}

$imagePaths = @(
    Get-ChildItem -LiteralPath $ImageDirectory -Filter "page-*.png" -File |
        Sort-Object -Property Name |
        Select-Object -ExpandProperty FullName
)
if ($imagePaths.Count -eq 0) {
    throw "No rendered pages were provided to Windows printing."
}

Add-Type -AssemblyName System.Drawing

$document = New-Object System.Drawing.Printing.PrintDocument
$document.DocumentName = $DocumentName
$document.PrinterSettings.PrinterName = $PrinterName
if (-not $document.PrinterSettings.IsValid) {
    $document.Dispose()
    throw "The selected Windows printer queue is unavailable."
}

$paperSize = $document.PrinterSettings.PaperSizes |
    Where-Object { $_.Kind.ToString() -eq $MediaSize } |
    Select-Object -First 1
if ($null -eq $paperSize) {
    $document.Dispose()
    throw "The selected printer does not report support for $MediaSize paper."
}

$document.DefaultPageSettings.PaperSize = $paperSize
$document.DefaultPageSettings.Color = ($ColorMode -eq "color")
$document.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(0, 0, 0, 0)
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$document.PrinterSettings.Copies = 1
$document.PrinterSettings.Collate = $true
$script:pageIndex = 0

$document.add_QueryPageSettings({
    param($sender, $eventArgs)
    $probe = [System.Drawing.Image]::FromFile($imagePaths[$script:pageIndex])
    try {
        $eventArgs.PageSettings.Landscape = ($probe.Width -gt $probe.Height)
        $eventArgs.PageSettings.Color = ($ColorMode -eq "color")
        $eventArgs.PageSettings.PaperSize = $paperSize
    }
    finally {
        $probe.Dispose()
    }
})

$document.add_PrintPage({
    param($sender, $eventArgs)
    $image = [System.Drawing.Image]::FromFile($imagePaths[$script:pageIndex])
    try {
        $hardMarginX = [Math]::Max(0, [single]$eventArgs.PageSettings.HardMarginX)
        $hardMarginY = [Math]::Max(0, [single]$eventArgs.PageSettings.HardMarginY)
        $availableWidth = [Math]::Max(1, [single]$eventArgs.PageBounds.Width - (2 * $hardMarginX))
        $availableHeight = [Math]::Max(1, [single]$eventArgs.PageBounds.Height - (2 * $hardMarginY))
        $scale = [Math]::Min($availableWidth / $image.Width, $availableHeight / $image.Height)
        $drawWidth = [single]($image.Width * $scale)
        $drawHeight = [single]($image.Height * $scale)
        $left = [single]($hardMarginX + (($availableWidth - $drawWidth) / 2))
        $top = [single]($hardMarginY + (($availableHeight - $drawHeight) / 2))
        $target = [System.Drawing.RectangleF]::new($left, $top, $drawWidth, $drawHeight)

        $eventArgs.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $eventArgs.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $eventArgs.Graphics.DrawImage($image, $target)
    }
    finally {
        $image.Dispose()
    }

    $script:pageIndex++
    $eventArgs.HasMorePages = ($script:pageIndex -lt $imagePaths.Count)
})

try {
    for ($copy = 0; $copy -lt $Copies; $copy++) {
        $script:pageIndex = 0
        $document.Print()
    }
}
finally {
    $document.Dispose()
}
