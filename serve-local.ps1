param([switch]$NoBrowser, [int]$Port = 0)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$url = "http://127.0.0.1:$port/"
Write-Host "Prism is running at $url"
Write-Host 'Keep this window open while using Prism. Close it to stop the server.'
if (-not $NoBrowser) { Start-Process $url }
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 10000
      $client.SendTimeout = 30000
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
      $line = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      do { $header = $reader.ReadLine() } while ($null -ne $header -and $header -ne '')
      $parts = $line.Split(' ')
      $code = 200; $message = 'OK'; $body = $null; $file = $null
      if ($parts.Length -lt 2 -or $parts[0] -notin @('GET', 'HEAD')) {
        $code = 405; $message = 'Method Not Allowed'
      } else {
        try {
          $uri = [Uri]::new('http://localhost' + $parts[1])
          $relative = [Uri]::UnescapeDataString($uri.AbsolutePath).TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
          if ($relative -eq '') { $relative = 'index.html' }
          $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relative))
          if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { $code = 403; $message = 'Forbidden' }
          elseif (-not [IO.File]::Exists($candidate)) { $code = 404; $message = 'Not Found' }
          else { $file = [IO.FileInfo]::new($candidate) }
        } catch { $code = 400; $message = 'Bad Request' }
      }
      if ($file) {
        $contentType = switch ($file.Extension.ToLowerInvariant()) {
          '.html' { 'text/html; charset=utf-8' }
          '.js' { 'text/javascript; charset=utf-8' }
          '.css' { 'text/css; charset=utf-8' }
          '.json' { 'application/json; charset=utf-8' }
          '.wasm' { 'application/wasm' }
          default { 'application/octet-stream' }
        }
        $length = $file.Length
      } else {
        $contentType = 'text/plain; charset=utf-8'
        $body = [Text.Encoding]::UTF8.GetBytes($message)
        $length = $body.Length
      }
      $response = "HTTP/1.1 $code $message`r`nContent-Type: $contentType`r`nContent-Length: $length`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
      $bytes = [Text.Encoding]::ASCII.GetBytes($response)
      $stream.Write($bytes, 0, $bytes.Length)
      if ($parts[0] -ne 'HEAD') {
        if ($file) { $inputFile = [IO.File]::OpenRead($file.FullName); try { $inputFile.CopyTo($stream) } finally { $inputFile.Dispose() } }
        elseif ($body) { $stream.Write($body, 0, $body.Length) }
      }
      $stream.Flush()
    } catch { Write-Warning "Request failed: $($_.Exception.Message)" }
    finally { if ($reader) { $reader.Dispose() }; $client.Dispose(); $reader = $null }
  }
} finally { $listener.Stop() }
