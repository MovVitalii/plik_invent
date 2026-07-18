param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Prefix = "http://localhost:$Port/"
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Prefix)

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".mjs"  = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".csv"  = "text/csv; charset=utf-8"
    ".wasm" = "application/wasm"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

function Send-TextResponse {
    param($Response, [int]$StatusCode, [string]$Text)
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "text/plain; charset=utf-8"
    $Response.ContentLength64 = $Bytes.Length
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
}

try {
    $Listener.Start()
    Write-Host "Materials Analytics uruchomiono: $Prefix" -ForegroundColor Green
    Write-Host "Aby zatrzymać serwer, zamknij to okno albo naciśnij Ctrl+C."
    Start-Process $Prefix

    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        try {
            $RelativePath = [System.Uri]::UnescapeDataString($Context.Request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($RelativePath)) { $RelativePath = "index.html" }
            $Candidate = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
            if (-not $Candidate.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-TextResponse $Context.Response 403 "Forbidden"
                continue
            }
            if ([System.IO.Directory]::Exists($Candidate)) { $Candidate = Join-Path $Candidate "index.html" }
            if (-not [System.IO.File]::Exists($Candidate)) {
                Send-TextResponse $Context.Response 404 "Not found"
                continue
            }

            $Bytes = [System.IO.File]::ReadAllBytes($Candidate)
            $Extension = [System.IO.Path]::GetExtension($Candidate).ToLowerInvariant()
            $Context.Response.StatusCode = 200
            $Context.Response.ContentType = if ($MimeTypes.ContainsKey($Extension)) { $MimeTypes[$Extension] } else { "application/octet-stream" }
            $Context.Response.ContentLength64 = $Bytes.Length
            $Context.Response.Headers["Cache-Control"] = "no-cache"
            $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
        }
        catch {
            try { Send-TextResponse $Context.Response 500 $_.Exception.Message } catch { }
        }
        finally {
            try { $Context.Response.OutputStream.Close() } catch { }
        }
    }
}
finally {
    if ($Listener.IsListening) { $Listener.Stop() }
    $Listener.Close()
}
