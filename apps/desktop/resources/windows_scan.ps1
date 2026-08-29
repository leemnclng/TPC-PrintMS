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
$WiaItemCategory = 3
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
$WiaCategoryFlatbed = "fb607b1f-43f3-488b-855b-fb703ec342a6"
$WiaCategoryFeeder = "fe131934-f84c-42ad-8da4-6129cddd7288"
$WiaCategoryFeederFront = "4823175c-3b28-487b-a7e6-eebc17614fd1"
$WiaCategoryFeederBack = "61ca74d4-39db-42aa-89b1-8c19c9cd4c23"

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

function Get-WiaItemSource {
  param($Item)
  $categoryValue = $null
  try {
    $categoryValue = Get-WiaPropertyValue $Item.Properties $WiaItemCategory
  }
  catch {
    $categoryValue = $null
  }
  $category = if ($null -eq $categoryValue) { "" } else { ([string]$categoryValue).Trim("{}".ToCharArray()).ToLowerInvariant() }
  if ($category -eq $WiaCategoryFeeder -or $category -eq $WiaCategoryFeederFront -or $category -eq $WiaCategoryFeederBack) {
    return "feeder"
  }
  if ($category -eq $WiaCategoryFlatbed) {
    return "flatbed"
  }
  $itemName = ""
  try {
    $itemName = [string]$Item.Name
  }
  catch {
    $itemName = ""
  }
  if ($itemName -match "(?i)feeder|document feed|ADF") {
    return "feeder"
  }
  if ($itemName -match "(?i)flatbed|platen|glass") {
    return "flatbed"
  }
  return $null
}

function Find-WiaSourceItem {
  param($Items, [string]$RequestedSource)
  foreach ($item in $Items) {
    $itemSource = Get-WiaItemSource $item
    # Advanced feeder items can expose transferable front/back children while
    # their feeder parent is only a container. Prefer the child when present.
    if ($itemSource -eq "feeder" -and $RequestedSource -eq "feeder") {
      try {
        if ($item.Items.Count -gt 0) {
          $childMatch = Find-WiaSourceItem $item.Items $RequestedSource
          if ($null -ne $childMatch) {
            return $childMatch
          }
        }
      }
      catch {
        # A directly transferable WIA 1.0 feeder item may have no children.
      }
      return $item
    }
    if ($itemSource -eq $RequestedSource) {
      return $item
    }
    try {
      if ($item.Items.Count -gt 0) {
        $childMatch = Find-WiaSourceItem $item.Items $RequestedSource
        if ($null -ne $childMatch) {
          return $childMatch
        }
      }
    }
    catch {
      # Some WIA 1.0 compatibility items do not expose a child collection.
    }
  }
  return $null
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
    # WIA 2.0 represents flatbed and feeder as separate item categories. Some
    # vendor drivers expose those items without mirroring every root capability.
    $supportsFeeder = $supportsFeeder -or ($null -ne (Find-WiaSourceItem $device.Items "feeder"))
    $supportsFlatbed = $supportsFlatbed -or ($null -ne (Find-WiaSourceItem $device.Items "flatbed"))
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
      flatbedReady = if (($status -band $StatusFlatbedReady) -ne 0) { $true } elseif (($capabilities -band $CapabilityDetectFlatbed) -ne 0) { $false } else { $null }
      feederReady = if (($status -band $StatusFeedReady) -ne 0) { $true } elseif (($capabilities -band $CapabilityDetectFeeder) -ne 0) { $false } else { $null }
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
  if ($State.supportsFeeder -and $State.feederReady) {
    return "feeder"
  }
  if ($State.supportsFlatbed -and $State.flatbedReady -and $State.detectsFeeder -and $State.feederReady -eq $false) {
    return "flatbed"
  }
  if ($State.supportsFeeder -and -not $State.supportsFlatbed) {
    return "feeder"
  }
  if ($State.supportsFlatbed -and -not $State.supportsFeeder) {
    return "flatbed"
  }
  # If the driver cannot report feeder paper, prefer the feeder. Defaulting to
  # the first WIA item commonly selects the flatbed even when the ADF is loaded.
  return "feeder"
}

function Set-WiaAcquisitionSettings {
  param($Item, [string]$RequestedContentType, [int]$RequestedDpi, [string]$RequestedPageSize)
  $intent = switch ($RequestedContentType) {
    "grayscale" { 2 }
    "text" { 4 }
    default { 1 }
  }
  $appliedContentType = $RequestedContentType
  $notice = $null
  if (-not (Set-WiaPropertyValue $Item.Properties $WiaCurrentIntent $intent)) {
    if ($RequestedContentType -eq "text" -and (Set-WiaPropertyValue $Item.Properties $WiaCurrentIntent 2)) {
      $appliedContentType = "grayscale"
      $notice = "This Canon driver does not expose native B&W text acquisition through WIA, so the page was acquired in grayscale instead."
    }
    else {
      return [pscustomobject]@{ issue = "The scanner driver does not expose the selected content mode through WIA. Choose another content mode."; appliedContentType = $RequestedContentType; notice = $null }
    }
  }
  if (-not (Set-WiaPropertyValue $Item.Properties $WiaHorizontalResolution $RequestedDpi) -or
      -not (Set-WiaPropertyValue $Item.Properties $WiaVerticalResolution $RequestedDpi)) {
    return [pscustomobject]@{ issue = "The scanner does not support $RequestedDpi DPI for this content mode. Choose another resolution."; appliedContentType = $appliedContentType; notice = $notice }
  }
  if ($RequestedPageSize -eq "auto") {
    return [pscustomobject]@{ issue = $null; appliedContentType = $appliedContentType; notice = $notice }
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
    return [pscustomobject]@{ issue = "The selected page size is outside this scanner source's supported capture area. Choose Automatic or a smaller size."; appliedContentType = $appliedContentType; notice = $notice }
  }
  return [pscustomobject]@{ issue = $null; appliedContentType = $appliedContentType; notice = $notice }
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
  if ($device.Items.Count -eq 0) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "no_scan_item"; message = "The Windows scanner driver did not expose a transferable scan source." })
    exit 0
  }
  $selectedItem = $null
  if ($resolvedSource -ne "auto") {
    # WIA 2.0 exposes feeder and flatbed as distinct items. Select the matching
    # item first; the older root property remains as a compatibility fallback.
    $selectedItem = Find-WiaSourceItem $device.Items $resolvedSource
    $sourceValue = if ($resolvedSource -eq "feeder") { 1 } else { 2 }
    if ($null -eq $selectedItem) {
      $sourceWasSet = Set-WiaPropertyValue $device.Properties $WiaDocumentHandlingSelect $sourceValue
      if (-not $sourceWasSet) {
        foreach ($item in $device.Items) {
          if (Set-WiaPropertyValue $item.Properties $WiaDocumentHandlingSelect $sourceValue) {
            $sourceWasSet = $true
            break
          }
        }
      }
      if (-not $sourceWasSet) {
        Write-Result ([pscustomobject]@{ status = "error"; code = "source_unavailable"; message = "Windows could not select the $resolvedSource source on this scanner. Choose the source explicitly or repair the Canon MP/WIA driver." })
        exit 0
      }
    }
  }
  if ($null -eq $selectedItem) {
    $selectedItem = $device.Items.Item(1)
  }
  $settingsResult = Set-WiaAcquisitionSettings $selectedItem $ContentType $ResolutionDpi $PageSize
  if (-not [string]::IsNullOrWhiteSpace($settingsResult.issue)) {
    Write-Result ([pscustomobject]@{ status = "error"; code = "unsupported_scan_setting"; message = $settingsResult.issue })
    exit 0
  }
  # Printing-MS owns source/profile selection, so do not call ShowSelectItems
  # (that is the redundant Windows settings window). ShowTransfer is retained
  # because some Canon WIA drivers only start their hardware transfer through
  # the common transfer path; it displays transfer progress, not settings.
  $dialog = New-Object -ComObject WIA.CommonDialog

  # WIA drivers commonly return DIB/BMP or TIFF variants that Chromium cannot
  # preview consistently. Normalize every acquired page to a standard PNG
  # before it crosses the Electron IPC boundary.
  $imageProcess = New-Object -ComObject WIA.ImageProcess
  [void]$imageProcess.Filters.Add($imageProcess.FilterInfos.Item("Convert").FilterID)
  $imageProcess.Filters.Item(1).Properties.Item("FormatID").Value = $PngFormat

  # A feeder holds a stack of originals, so one acquisition keeps transferring
  # until the ADF reports empty — the owner loads the stack once and gets
  # every page back from this single call. A flatbed only ever has the one
  # page placed on the glass, so it stops after a single transfer as before.
  $loopSource = $resolvedSource -eq "feeder"
  $acquiredFiles = @()
  $partialMessage = $null
  while ($true) {
    $pageImage = $null
    $pagePreview = $null
    try {
      $pageImage = $dialog.ShowTransfer($selectedItem, $UnspecifiedFormat, $false)
    }
    catch [System.Runtime.InteropServices.COMException] {
      if ($acquiredFiles.Count -eq 0) {
        throw
      }
      # A later sheet in the batch failed after earlier ones already
      # succeeded. Feeder exhaustion (paper_empty) is the normal, silent end
      # of the batch; anything else (jam, etc.) is reported so the owner
      # knows the remaining originals still need to be scanned separately.
      $hresult = "0x{0:X8}" -f ($_.Exception.HResult -band 0xffffffffL)
      if (-not ($loopSource -and $hresult -eq "0x80210003")) {
        $pageWord = if ($acquiredFiles.Count -eq 1) { "page" } else { "pages" }
        $partialMessage = "Stopped after $($acquiredFiles.Count) $pageWord`: the feeder reported an issue partway through. Review the pages, then scan the rest separately."
      }
      break
    }
    if ($null -eq $pageImage) {
      if ($acquiredFiles.Count -gt 0) { break }
      Write-Result ([pscustomobject]@{ status = "error"; code = "empty_transfer"; message = "The scanner completed without returning an image." })
      exit 0
    }
    $pagePreview = $imageProcess.Apply($pageImage)
    $pageFilename = "scan-{0}-{1}.png" -f ([DateTime]::UtcNow.ToString("yyyyMMdd-HHmmssfff")), ($acquiredFiles.Count + 1)
    $pageOutputPath = Join-Path -Path $OutputDirectory -ChildPath $pageFilename
    $pagePreview.SaveFile($pageOutputPath)
    $acquiredFiles += [pscustomobject]@{ path = $pageOutputPath; filename = $pageFilename }
    foreach ($pageComObject in @($pagePreview, $pageImage)) {
      if ($null -ne $pageComObject -and [System.Runtime.InteropServices.Marshal]::IsComObject($pageComObject)) {
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($pageComObject)
      }
    }
    if (-not $loopSource) { break }
  }

  $messageParts = @()
  if ($settingsResult.notice) { $messageParts += $settingsResult.notice }
  if ($partialMessage) {
    $messageParts += $partialMessage
  }
  elseif ($acquiredFiles.Count -gt 1) {
    $messageParts += "$($acquiredFiles.Count) pages were acquired from the feeder."
  }
  Write-Result ([pscustomobject]@{
    status = "acquired"
    files = $acquiredFiles
    deviceName = $state.name
    source = $resolvedSource
    contentType = $settingsResult.appliedContentType
    resolutionDpi = $ResolutionDpi
    pageSize = $PageSize
    message = if ($messageParts.Count -gt 0) { $messageParts -join " " } else { $null }
  })
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
