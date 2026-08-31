param(
    [Parameter(Mandatory = $true)][string]$ImageDirectory,
    [Parameter(Mandatory = $true)][string]$DocumentName,
    [Parameter(Mandatory = $false)][string]$TrackingId = "",
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][ValidateRange(1, 99)][int]$Copies,
    [Parameter(Mandatory = $true)][ValidateSet("color", "grayscale")][string]$ColorMode,
    [Parameter(Mandatory = $true)][string]$MediaSize,
    [Parameter(Mandatory = $true)][ValidateRange(55.0, 216.0)][double]$MediaWidthMm,
    [Parameter(Mandatory = $true)][ValidateRange(55.0, 1200.0)][double]$MediaHeightMm,
    [Parameter(Mandatory = $true)][ValidateSet("auto", "plain", "photo_plus_glossy_ii", "photo_pro_luster", "photo_plus_semi_gloss", "glossy_photo", "matte_photo", "envelope", "ink_jet_hagaki_a", "ink_jet_hagaki", "hagaki_k_a", "hagaki_k", "hagaki_a", "hagaki", "inkjet_greeting_card", "card_stock")][string]$MediaType,
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
# -ReferencedAssemblies is required here even though System.Drawing was just
# loaded above: that load only makes the type available to *this script's*
# own PowerShell type resolution (used below by `New-Object
# System.Drawing.Printing.PrintDocument`, etc.). Add-Type -TypeDefinition
# compiles the C# block below as a separate assembly, and that compilation
# does not inherit assemblies already loaded into the session — without this,
# `using System.Drawing.Printing;` fails to resolve with "The type or
# namespace name 'Printing' does not exist in the namespace 'System.Drawing'".
Add-Type -ReferencedAssemblies "System.Drawing.dll" -TypeDefinition @"
using System;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

public static class PrintingMsMediaHint
{
    private const int DM_MEDIATYPE = 0x02000000;
    private const int DMMEDIA_STANDARD = 1;
    private const int DMMEDIA_GLOSSY = 3;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DevMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields;
        public short dmOrientation, dmPaperSize, dmPaperLength, dmPaperWidth, dmScale,
            dmCopies, dmDefaultSource, dmPrintQuality, dmColor, dmDuplex, dmYResolution,
            dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency,
            dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2,
            dmPanningWidth, dmPanningHeight;
    }

    public static void Apply(PrinterSettings settings, bool glossy)
    {
        IntPtr handle = settings.GetHdevmode();
        try
        {
            DevMode mode = (DevMode)Marshal.PtrToStructure(handle, typeof(DevMode));
            mode.dmFields |= DM_MEDIATYPE;
            mode.dmMediaType = glossy ? DMMEDIA_GLOSSY : DMMEDIA_STANDARD;
            Marshal.StructureToPtr(mode, handle, false);
            settings.SetHdevmode(handle);
        }
        finally
        {
            Marshal.FreeHGlobal(handle);
        }
    }
}
"@

$document = New-Object System.Drawing.Printing.PrintDocument
$useBorderless = ($Borderless -eq "true")
$useCollation = ($Collate -eq "true")
$document.DocumentName = if ([string]::IsNullOrWhiteSpace($TrackingId)) { $DocumentName } else { "Printing-MS|$TrackingId|$DocumentName" }
$document.PrinterSettings.PrinterName = $PrinterName
if (-not $document.PrinterSettings.IsValid) {
    $document.Dispose()
    throw "The selected Windows printer queue is unavailable."
}

# Windows' public DEVMODE contract only distinguishes standard and glossy
# media. Canon-specific names remain useful in history and are reduced to the
# closest standard hint here; the installed driver keeps final authority.
if ($MediaType -ne "auto") {
    $glossyMedia = @("photo_plus_glossy_ii", "photo_pro_luster", "photo_plus_semi_gloss", "glossy_photo") -contains $MediaType
    try { [PrintingMsMediaHint]::Apply($document.PrinterSettings, $glossyMedia) } catch { }
}

$targetWidth = [int][Math]::Round($MediaWidthMm * 100 / 25.4)
$targetHeight = [int][Math]::Round($MediaHeightMm * 100 / 25.4)
$normalizedMediaName = ($MediaSize -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()

function Find-MatchingPaperSize {
    param([bool]$RequireBorderlessName)
    $document.PrinterSettings.PaperSizes |
        Where-Object {
            $paperName = ($_.PaperName -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()
            $nameMatch = $_.Kind.ToString() -eq $MediaSize -or $paperName -eq $normalizedMediaName
            $dimensionMatch = [Math]::Abs($_.Width - $targetWidth) -le 2 -and [Math]::Abs($_.Height - $targetHeight) -le 2
            if ($RequireBorderlessName) { $paperName.Contains("borderless") -and ($nameMatch -or $dimensionMatch) }
            else { $nameMatch -or $dimensionMatch }
        } |
        Select-Object -First 1
}

$paperSize = $null
if ($useBorderless) {
    # Many inkjet drivers (Canon included) only expose true edge-to-edge
    # output through a paper entry explicitly named for it (e.g.
    # "4x6 (Borderless)"), distinct from a plain, margined entry of the exact
    # same dimensions. Matching on dimensions alone can silently pick the
    # margined one even when a borderless one also exists.
    $paperSize = Find-MatchingPaperSize -RequireBorderlessName $true
}
if ($null -eq $paperSize) {
    $paperSize = Find-MatchingPaperSize -RequireBorderlessName $false
}
if ($null -eq $paperSize) {
    # Canon and other drivers do not expose every regional/photo name through
    # PaperSizes even when they accept the dimensions. Use a per-job custom
    # PaperSize and let the installed driver reject it if truly unsupported.
    $paperSize = [System.Drawing.Printing.PaperSize]::new("Printing-MS $MediaSize", $targetWidth, $targetHeight)
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
# A PowerShell scriptblock hooked to a .NET event (add_QueryPageSettings /
# add_PrintPage below) does not propagate a thrown error's message through
# Print() the normal way — the caller only ever sees a generic
# "Exception calling "Print" with "0" argument(s)" with the real detail
# (e.g. the borderless-not-supported message below) lost. Both handlers
# catch their own errors, record the message here, and cancel the job;
# Print() is then checked for this afterward and re-thrown as a plain
# PowerShell error, which keeps the real message intact.
$script:printFailure = $null

$document.add_QueryPageSettings({
    param($sender, $eventArgs)
    try {
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
    }
    catch {
        $script:printFailure = $_.Exception.Message
        $eventArgs.Cancel = $true
    }
})

$document.add_PrintPage({
    param($sender, $eventArgs)
    try {
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
    }
    catch {
        $script:printFailure = $_.Exception.Message
        $eventArgs.Cancel = $true
    }
})

try {
    $document.Print()
    if ($null -ne $script:printFailure) {
        throw $script:printFailure
    }
}
finally {
    $document.Dispose()
}
