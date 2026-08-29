param(
    [ValidateRange(250, 5000)][int]$PollMilliseconds = 750
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$seen = @{}

function Write-JobEvent {
    param(
        [string]$EventType,
        [string]$SpoolerKey,
        $Job
    )

    $submittedAt = if ($null -ne $Job.TimeSubmitted) {
        $Job.TimeSubmitted.ToUniversalTime().ToString("o")
    } else { $null }
    $record = [ordered]@{
        eventType = $EventType
        spoolerKey = $SpoolerKey
        osJobId = [string]$Job.JobId
        printerName = [string]$Job.Name -replace ',\s*\d+$', ''
        documentName = [string]$Job.Document
        owner = if ($null -ne $Job.Owner) { [string]$Job.Owner } else { $null }
        driverName = if ($null -ne $Job.DriverName) { [string]$Job.DriverName } else { $null }
        totalPages = if ($null -ne $Job.TotalPages) { [int]$Job.TotalPages } else { $null }
        pagesPrinted = if ($null -ne $Job.PagesPrinted) { [int]$Job.PagesPrinted } else { $null }
        sizeBytes = if ($null -ne $Job.Size) { [int64]$Job.Size } else { $null }
        status = if ($null -ne $Job.Status) { [string]$Job.Status } else { $null }
        jobStatus = if ($null -ne $Job.JobStatus) { [string]$Job.JobStatus } else { $null }
        submittedAt = $submittedAt
    }
    [Console]::Out.WriteLine(($record | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

while ($true) {
    $jobs = @(Get-CimInstance -ClassName Win32_PrintJob)
    $current = @{}
    foreach ($job in $jobs) {
        $submitted = if ($null -ne $job.TimeSubmitted) { $job.TimeSubmitted.ToUniversalTime().ToString("o") } else { "unknown" }
        $key = "$($job.Name)|$submitted"
        $signature = "$($job.Status)|$($job.JobStatus)|$($job.PagesPrinted)|$($job.TotalPages)|$($job.Size)"
        $current[$key] = $job
        if (-not $seen.ContainsKey($key) -or $seen[$key] -ne $signature) {
            Write-JobEvent -EventType "seen" -SpoolerKey $key -Job $job
        }
        $seen[$key] = $signature
    }

    foreach ($key in @($seen.Keys)) {
        if (-not $current.ContainsKey($key)) {
            $parts = $key -split '\|', 2
            $removed = [pscustomobject]@{
                JobId = ($parts[0] -replace '^.*,\s*', '')
                Name = ($parts[0])
                Document = ""
                Owner = $null
                DriverName = $null
                TotalPages = $null
                PagesPrinted = $null
                Size = $null
                Status = "Released"
                JobStatus = "Released from Windows spooler"
                TimeSubmitted = $null
            }
            Write-JobEvent -EventType "released" -SpoolerKey $key -Job $removed
            $seen.Remove($key)
        }
    }
    Start-Sleep -Milliseconds $PollMilliseconds
}
