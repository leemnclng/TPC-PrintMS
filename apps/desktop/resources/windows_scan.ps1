param(
  [ValidateSet("Inspect", "Acquire")]
  [string]$Mode = "Inspect",
  [string]$OutputDirectory = "",
  [string]$DeviceId = "",
  [ValidateSet("auto", "flatbed", "feeder")]
  [string]$Source = "auto",
  [ValidateSet("color", "grayscale", "text")]
  [string]$ContentType = "color",
  [ValidateSet(150, 300, 600)]
  [int]$ResolutionDpi = 300,
  [ValidateSet("auto", "a4", "letter", "legal", "4x6", "5x7", "8x10")]
  [string]$PageSize = "auto"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$WiaScannerDeviceType = 1
$WiaDocumentHandlingCapabilities = 3086
$WiaDocumentHandlingStatus = 3087
$WiaDocumentHandlingSelect = 3088
$WiaCurrentIntent = 6146
$WiaHorizontalResolution = 6147
$WiaVerticalResolution = 6148
$WiaHorizontalStartPosition = 6149
$WiaVerticalStartPosition = 6150
$WiaHorizontalExtent = 6151
$WiaVerticalExtent = 6152
$CapabilityFeed = 0x001
$CapabilityFlatbed = 0x002
$CapabilityDuplex = 0x004
$CapabilityDetectFlatbed = 0x008
$CapabilityDetectFeeder = 0x020
$StatusFeedReady = 0x001
$StatusFlatbedReady = 0x002
$StatusFlatbedCoverUp = 0x008
$StatusPathCoverUp = 0x010
$StatusPaperJam = 0x020
$UnspecifiedFormat = "{B96B3CA9-0728-11D3-9D7B-0000F81EF32E}"
$PngFormat = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"

function Get-WiaPropertyValue {
  param($Properties, [int]$PropertyId)
  foreach ($property in $Properties) {
    if ([int]$property.PropertyID -eq $PropertyId) {
      return $property.Value
    }
  }
  return $null
}

function Set-WiaPropertyValue {
  param($Properties, [int]$PropertyId, [int]$Value)
  foreach ($property in $Properties) {
    if ([int]$property.PropertyID -eq $PropertyId) {
      try {
        $property.Value = $Value
        return $true
      }
      catch {
        return $false
      }
    }
  }
  return $false
}

function Get-DeviceName {
  param($DeviceInfo)
  foreach ($property in $DeviceInfo.Properties) {
    if ([string]$property.Name -eq "Name") {
      return [string]$property.Value
    }
  }
  return "Windows scanner"
}

function Get-ScannerState {
  param($DeviceInfo)
  $name = Get-DeviceName $DeviceInfo
  try {
    $device = $DeviceInfo.Connect()
    $capabilitiesValue = Get-WiaPropertyValue $device.Properties $WiaDocumentHandlingCapabilities
    $statusValue = Get-WiaPropertyValue $device.Properties $WiaDocumentHandlingStatus
    $capabilities = if ($null -eq $capabilitiesValue) { 0 } else { [int]$capabilitiesValue }
    $status = if ($null -eq $statusValue) { 0 } else { [int]$statusValue }
    $supportsFeeder = ($capabilities -band $CapabilityFeed) -ne 0
    $supportsFlatbed = ($capabilities -band $CapabilityFlatbed) -ne 0
    # Some WIA drivers omit the capability property even though they expose a
    # working flatbed item. Keep flatbed available as the conservative fallback.
    if (-not $supportsFeeder -and -not $supportsFlatbed) {
      $supportsFlatbed = $true
    }
    return [pscustomobject]@{
      id = [string]$DeviceInfo.DeviceID
      name = $name
      isOnline = $true
      supportsFlatbed = $supportsFlatbed
      supportsFeeder = $supportsFeeder
      supportsDuplex = ($capabilities -band $CapabilityDuplex) -ne 0
      detectsFlatbed = ($capabilities -band $CapabilityDetectFlatbed) -ne 0
      detectsFeeder = ($capabilities -band $CapabilityDetectFeeder) -ne 0
      flatbedReady = if (($capabilities -band $CapabilityDetectFlatbed) -ne 0) { ($status -band $StatusFlatbedReady) -ne 0 } else { $null }
      feederReady = if (($capabilities -band $CapabilityDetectFeeder) -ne 0) { ($status -band $StatusFeedReady) -ne 0 } else { $null }
      coverOpen = ($status -band ($StatusFlatbedCoverUp -bor $StatusPathCoverUp)) -ne 0
      paperJam = ($status -band $StatusPaperJam) -ne 0
      issue = $null
    }
  }
  catch {
    return [pscustomobject]@{
      id = [string]$DeviceInfo.DeviceID
      name = $name
      isOnline = $false
      supportsFlatbed = $true
      supportsFeeder = $false
      supportsDuplex = $false
      detectsFlatbed = $false
      detectsFeeder = $false
      flatbedReady = $null
      feederReady = $null
      coverOpen = $false
      paperJam = $false
      issue = "Windows found this scanner, but it could not connect. Turn it on and check its USB or network connection."
    }
  }
}

function Get-ScannerDeviceInfos {
  param($Manager)
  $scannerInfos = @()
  foreach ($deviceInfo in $Manager.DeviceInfos) {
    if ([int]$deviceInfo.Type -eq $WiaScannerDeviceType) {
      $scannerInfos += $deviceInfo
    }
  }
  return $scannerInfos
}

function Resolve-ScanSource {
  param($State, [string]$RequestedSource)
  if ($RequestedSource -ne "auto") {
    return $RequestedSource
  }
  if ($State.supportsFeeder -and $State.detectsFeeder -and $State.feederReady) {
    return "feeder"
  }
  if ($State.supportsFlatbed -and $State.detectsFlatbed -and $State.flatbedReady) {
    return "flatbed"
  }
  if (-not $State.detectsFeeder -and -not $State.detectsFlatbed) {
    return "auto"
  }
  if ($State.supportsFeeder -and -not $State.supportsFlatbed) {
    return "feeder"
  }
  if ($State.supportsFlatbed -and -not $State.supportsFeeder) {
    return "flatbed"
  }
  # When the WIA driver cannot report paper presence, leave source selection in
  # its automatic/default state instead of incorrectly forcing either source.
  return "auto"
}

function Set-WiaAcquisitionSettings {
  param($Item, [string]$RequestedContentType, [int]$RequestedDpi, [string]$RequestedPageSize)
  $intent = switch ($RequestedContentType) {
    "grayscale" { 2 }
    "text" { 4 }
    default { 1 }
  }
  if (-not (Set-WiaPropertyValue $Item.Properties $WiaCurrentIntent $intent)) {
    return "The scanner driver does not expose the selected content mode through WIA."
  }
  if (-not (Set-WiaPropertyValue $Item.Properties $WiaHorizontalResolution $RequestedDpi) -or
      -not (Set-WiaPropertyValue $Item.Properties $WiaVerticalResolution $RequestedDpi)) {
    return "The scanner does not support $RequestedDpi DPI for this content mode. Choose another resolution."
  }
  if ($RequestedPageSize -eq "auto") {
    return $null
  }

  $sizesInInches = @{
    "a4" = @(8.2677, 11.6929)
    "letter" = @(8.5, 11.0)
    "legal" = @(8.5, 14.0)
    "4x6" = @(4.0, 6.0)
    "5x7" = @(5.0, 7.0)
    "8x10" = @(8.0, 10.0)
  }
  $dimensions = $sizesInInches[$RequestedPageSize]
  $widthPixels = [int][Math]::Round([double]$dimensions[0] * $RequestedDpi)
  $heightPixels = [int][Math]::Round([double]$dimensions[1] * $RequestedDpi)
  $positionSet = (Set-WiaPropertyValue $Item.Properties $WiaHorizontalStartPosition 0) -and
    (Set-WiaPropertyValue $Item.Properties $WiaVerticalStartPosition 0)
  $extentSet = (Set-WiaPropertyValue $Item.Properties $WiaHorizontalExtent $widthPixels) -and
    (Set-WiaPropertyValue $Item.Properties $WiaVerticalExtent $heightPixels)
  if (-not $positionSet -or -not $extentSet) {
    return "The selected page size is outside this scanner source's supported capture area. Choose Automatic or a smaller size."
  }
  return $null
}

function Write-Result {
  param($Value)
  $Value | ConvertTo-Json -Compress -Depth 6
}

function Write-WiaError {
  param([System.Exception]$Exception)
  $hex = "0x{0:X8}" -f ($Exception.HResult -band 0xffffffffL)
  $known = @{
    "0x80210002" = @("paper_jam", "Paper is jammed in the scanner feeder. Clear the paper path, then refresh readiness.")
    "0x80210003" = @("paper_empty", "No document was detected in the feeder. Insert the originals between the feeder guides, then try again.")
    "0x80210004" = @("paper_problem", "The scanner reported a feeder problem. Reinsert the originals and check the paper guides.")
    "0x80210005" = @("offline", "The scanner is offline. Turn it on and check its USB or network connection.")
    "0x80210006" = @("busy", "The scanner is busy in another application. Finish that scan, then try again.")
    "0x80210007" = @("warming_up", "The scanner is warming up. Wait a moment, then try again.")
    "0x80210008" = @("device_attention", "The scanner needs attention. Check its display, covers, cable, and network connection.")
    "0x8021000A" = @("device_communication", "Windows lost communication with the scanner. Check its USB or network connection.")
    "0x8021000C" = @("hardware_setting", "The scanner settings are not valid for the loaded source. Review the driver settings and try again.")
    "0x8021000D" = @("device_locked", "The scanner is locked by another application. Close the other scanning app, then try again.")
    "0x80210010" = @("cover_open", "A scanner cover or paper path is open. Close it before scanning.")
    "0x80210011" = @("lamp_off", "The scanner lamp is unavailable. Check the device display or restart the scanner.")
    "0x80210015" = @("no_scanner", "No Windows scanner is available. Turn on the Canon device and install or repair its MP/WIA driver.")
    "0x80210020" = @("multiple_feed", "The feeder detected multiple sheets. Separate and reinsert the originals.")
  }
  if ($known.ContainsKey($hex)) {
    Write-Result ([pscustomobject]@{ status = "error"; code = $known[$hex][0]; message = $known[$hex][1] })
    return
  }
  Write-Result ([pscustomobject]@{
    status = "error"
    code = "wia_error"
    message = "Windows could not complete the scan ($hex). Check the scanner display and Canon MP/WIA driver, then try again."
  })
}

$manager = $null
$device = $null
$dialog = $null
$selectedItem = $null
$image = $null
$imageProcess = $null
$previewImage = $null

try {
  $manager = New-Object -ComObject WIA.DeviceManager
  $scannerInfos = @(Get-ScannerDeviceInfos $manager)

  if ($Mode -eq "Inspect") {
    $devices = @($scannerInfos | ForEach-Object { Get-ScannerState $_ })
    Write-Result ([pscustomobject]@{
      status = if ($devices.Count -gt 0) { "ready" } else { "unavailable" }
      message = if ($devices.Count -gt 0) { $null } else { "No Windows scanner was found. Turn on the Canon device and install or repair its MP/WIA driver." }
      devices = $devices
    })
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($OutputDirectory) -or [string]::IsNullOrWhiteSpace($DeviceId)) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "invalid_request"; message = "Select a scanner before starting acquisition." })
    exit 0
  }
  $deviceInfo = $scannerInfos | Where-Object { [string]$_.DeviceID -eq $DeviceId } | Select-Object -First 1
  if ($null -eq $deviceInfo) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "no_scanner"; message = "The selected scanner is no longer available. Refresh devices and check its connection." })
    exit 0
  }

  $state = Get-ScannerState $deviceInfo
  $resolvedSource = Resolve-ScanSource $state $Source
  if (-not $state.isOnline) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "offline"; message = $state.issue })
    exit 0
  }
  if ($state.paperJam) {
    Write-Result ([pscustomobject]@{ status = "not_ready"; code = "paper_jam"; message = "Paper is jammed in the scanner feeder. Clear the paper path before scanning." })
    exit 0
  }
  if ($state.coverOpen) {
    Write-Result ([pscustomobject]@{ status = "not_ready"; code = "cover_open"; message = "A scanner cover or paper path is open. Close it before scanning." })
    exit 0
  }
  if ($resolvedSource -eq "feeder" -and $state.detectsFeeder -and -not $state.feederReady) {
    Write-Result ([pscustomobject]@{ status = "not_ready"; code = "paper_empty"; message = "No document was detected in the feeder. Insert the originals between the guides, then refresh readiness." })
    exit 0
  }
  if ($resolvedSource -eq "flatbed" -and $state.detectsFlatbed -and -not $state.flatbedReady) {
    Write-Result ([pscustomobject]@{ status = "not_ready"; code = "paper_empty"; message = "No document was detected on the flatbed. Place it on the glass and close the cover." })
    exit 0
  }

  $device = $deviceInfo.Connect()
  if ($resolvedSource -ne "auto") {
    $sourceValue = if ($resolvedSource -eq "feeder") { 1 } else { 2 }
    $sourceWasSet = Set-WiaPropertyValue $device.Properties $WiaDocumentHandlingSelect $sourceValue
    if (-not $sourceWasSet) {
      foreach ($item in $device.Items) {
        if (Set-WiaPropertyValue $item.Properties $WiaDocumentHandlingSelect $sourceValue) {
          break
        }
      }
    }
  }
  if ($device.Items.Count -eq 0) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "no_scan_item"; message = "The Windows scanner driver did not expose a transferable scan source." })
    exit 0
  }
  $selectedItem = $device.Items.Item(1)
  $settingsIssue = Set-WiaAcquisitionSettings $selectedItem $ContentType $ResolutionDpi $PageSize
  if (-not [string]::IsNullOrWhiteSpace($settingsIssue)) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "unsupported_scan_setting"; message = $settingsIssue })
    exit 0
  }
  # Printing-MS owns source/profile selection, so do not call ShowSelectItems
  # (that is the redundant Windows settings window). ShowTransfer is retained
  # because some Canon WIA drivers only start their hardware transfer through
  # the common transfer path; it displays transfer progress, not settings.
  $dialog = New-Object -ComObject WIA.CommonDialog
  $image = $dialog.ShowTransfer($selectedItem, $UnspecifiedFormat, $false)
  if ($null -eq $image) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "empty_transfer"; message = "The scanner completed without returning an image." })
    exit 0
  }

  # WIA drivers commonly return DIB/BMP or TIFF variants that Chromium cannot
  # preview consistently. Normalize every acquired page to a standard PNG
  # before it crosses the Electron IPC boundary.
  $imageProcess = New-Object -ComObject WIA.ImageProcess
  [void]$imageProcess.Filters.Add($imageProcess.FilterInfos.Item("Convert").FilterID)
  $imageProcess.Filters.Item(1).Properties.Item("FormatID").Value = $PngFormat
  $previewImage = $imageProcess.Apply($image)
  $filename = "scan-{0}.png" -f ([DateTime]::UtcNow.ToString("yyyyMMdd-HHmmssfff"))
  $outputPath = Join-Path -Path $OutputDirectory -ChildPath $filename
  $previewImage.SaveFile($outputPath)
  Write-Result ([pscustomobject]@{ status = "acquired"; path = $outputPath; filename = $filename; deviceName = $state.name; source = $resolvedSource; contentType = $ContentType; resolutionDpi = $ResolutionDpi; pageSize = $PageSize })
}
catch [System.Runtime.InteropServices.COMException] {
  Write-WiaError $_.Exception
}
catch {
  Write-Result ([pscustomobject]@{
    status = "error"
    code = "scanner_bridge_error"
    message = "Windows could not initialize scanner acquisition. Restart the app and repair the Canon MP/WIA driver if this continues."
  })
}
finally {
  foreach ($comObject in @($previewImage, $imageProcess, $image, $selectedItem, $dialog, $device, $manager)) {
    if ($null -ne $comObject -and [System.Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject)
    }
  }
}
