param(
    [Parameter(Mandatory = $true)][string]$ImageDirectory,
    [Parameter(Mandatory = $true)][string]$DocumentName,
    [Parameter(Mandatory = $false)][string]$TrackingId = "",
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][ValidateRange(1, 99)][int]$Copies,
    [Parameter(Mandatory = $true)][ValidateSet("color", "grayscale")][string]$ColorMode,
    [Parameter(Mandatory = $true)][ValidateSet("A4", "Letter", "Legal")][string]$MediaSize,
    [Parameter(Mandatory = $true)][ValidateSet("auto", "portrait", "landscape")][string]$Orientation,
    [Parameter(Mandatory = $true)][ValidateSet("auto", "fit", "fill", "actual_size")][string]$Scaling,
    [Parameter(Mandatory = $true)][ValidateSet("auto", "draft", "standard", "high")][string]$Quality,
    [Parameter(Mandatory = $true)][ValidateSet("true", "false")][string]$Borderless,
    [Parameter(Mandatory = $true)][ValidateSet("true", "false")][string]$Collate
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
$useBorderless = ($Borderless -eq "true")
$useCollation = ($Collate -eq "true")
$document.DocumentName = if ([string]::IsNullOrWhiteSpace($TrackingId)) { $DocumentName } else { "Printing-MS|$TrackingId|$DocumentName" }
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
$document.DefaultPageSettings.Landscape = ($Orientation -eq "landscape")
$document.OriginAtMargins = $false
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$document.PrinterSettings.Copies = 1
$document.PrinterSettings.Collate = $useCollation

$preferredResolutionKind = if ($Quality -eq "draft") { "Draft" } elseif ($Quality -eq "high") { "High" } elseif ($Quality -eq "standard") { "Medium" } else { $null }
$printerResolution = if ($null -ne $preferredResolutionKind) {
    $document.PrinterSettings.PrinterResolutions |
        Where-Object { $_.Kind.ToString() -eq $preferredResolutionKind } |
        Select-Object -First 1
} else { $null }
if ($null -ne $printerResolution) {
    $document.DefaultPageSettings.PrinterResolution = $printerResolution
}

$printPaths = [System.Collections.Generic.List[string]]::new()
if ($useCollation) {
    for ($copy = 0; $copy -lt $Copies; $copy++) {
        foreach ($imagePath in $imagePaths) { $printPaths.Add($imagePath) }
    }
}
else {
    foreach ($imagePath in $imagePaths) {
        for ($copy = 0; $copy -lt $Copies; $copy++) { $printPaths.Add($imagePath) }
    }
}
$script:pageIndex = 0

$document.add_QueryPageSettings({
    param($sender, $eventArgs)
    $probe = [System.Drawing.Image]::FromFile($printPaths[$script:pageIndex])
    try {
        $eventArgs.PageSettings.Landscape = if ($Orientation -eq "auto") { $probe.Width -gt $probe.Height } else { $Orientation -eq "landscape" }
        $eventArgs.PageSettings.Color = ($ColorMode -eq "color")
        $eventArgs.PageSettings.PaperSize = $paperSize
        if ($null -ne $printerResolution) {
            $eventArgs.PageSettings.PrinterResolution = $printerResolution
        }
    }
    finally {
        $probe.Dispose()
    }
})

$document.add_PrintPage({
    param($sender, $eventArgs)
    $image = [System.Drawing.Image]::FromFile($printPaths[$script:pageIndex])
    try {
        # Graphics (0,0) is already the physical printable-area origin when
        # OriginAtMargins is false. Adding HardMarginX/Y here applied the Canon
        # margin twice and also assumed the opposite margins were symmetrical.
        $printableArea = $eventArgs.PageSettings.PrintableArea
        if ($useBorderless -and ($printableArea.X -gt 0.5 -or $printableArea.Y -gt 0.5)) {
            throw "The selected printer driver does not expose borderless printing for $MediaSize. Open its Windows printing preferences and choose a supported borderless paper type."
        }
        $originX = [single]0
        $originY = [single]0
        $availableWidth = [Math]::Max(1, [single]$printableArea.Width)
        $availableHeight = [Math]::Max(1, [single]$printableArea.Height)
        $actualWidth = [single](100 * $image.Width / [Math]::Max(1, $image.HorizontalResolution))
        $actualHeight = [single](100 * $image.Height / [Math]::Max(1, $image.VerticalResolution))
        if ($Scaling -eq "actual_size" -or ($Scaling -eq "auto" -and $actualWidth -le $availableWidth -and $actualHeight -le $availableHeight)) {
            $drawWidth = $actualWidth
            $drawHeight = $actualHeight
        }
        elseif ($Scaling -eq "auto") {
            $shrinkScale = [Math]::Min($availableWidth / $actualWidth, $availableHeight / $actualHeight)
            $drawWidth = [single]($actualWidth * $shrinkScale)
            $drawHeight = [single]($actualHeight * $shrinkScale)
        }
        else {
            $fitScale = [Math]::Min($availableWidth / $image.Width, $availableHeight / $image.Height)
            $fillScale = [Math]::Max($availableWidth / $image.Width, $availableHeight / $image.Height)
            $scale = if ($Scaling -eq "fill") { $fillScale } else { $fitScale }
            $drawWidth = [single]($image.Width * $scale)
            $drawHeight = [single]($image.Height * $scale)
        }
        $left = [single]($originX + (($availableWidth - $drawWidth) / 2))
        $top = [single]($originY + (($availableHeight - $drawHeight) / 2))
        $target = [System.Drawing.RectangleF]::new($left, $top, $drawWidth, $drawHeight)

        $eventArgs.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $eventArgs.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        if ($Scaling -eq "fill") {
            $eventArgs.Graphics.SetClip([System.Drawing.RectangleF]::new($originX, $originY, $availableWidth, $availableHeight))
        }
        $eventArgs.Graphics.DrawImage($image, $target)
    }
    finally {
        $image.Dispose()
    }

    $script:pageIndex++
    $eventArgs.HasMorePages = ($script:pageIndex -lt $printPaths.Count)
})

try {
    $document.Print()
}
finally {
    $document.Dispose()
}
