param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][ValidateRange(1, 99)][int]$Copies
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "The staged print file does not exist."
}

$printer = Get-CimInstance Win32_Printer -Filter "Name='$($PrinterName.Replace("'", "''"))'"
if ($null -eq $printer) {
    throw "The selected Windows printer queue is unavailable."
}

for ($copy = 0; $copy -lt $Copies; $copy++) {
    $process = Start-Process -FilePath $FilePath -Verb PrintTo -ArgumentList @("`"$PrinterName`"") -PassThru
    if ($null -ne $process) {
        $null = $process.WaitForExit(30000)
    }
}
