# 롤 게임 창이 맨 앞에 있을 때만 화면을 찍어 Windows 내장 OCR(한국어)로 글자를 읽습니다.
# 결과는 한 줄짜리 JSON으로 stdout에 출력하고, 마지막 화면은 OutDir\latest.jpg 로 저장합니다.
# 게임 메모리나 파일은 건드리지 않습니다. (화면 캡처 + OCR만)
#   -ImagePath <파일>  : 이미지 한 장만 OCR 하고 종료 (테스트용)
param(
  [string]$OutDir = $env:TEMP,
  [string]$ImagePath,
  [double]$IntervalSec = 0.9,
  [string]$ProcessName = "League of Legends",
  [switch]$TestCapture,
  [string]$TestTitle = "아수라장 코치 테스트 게임"
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][W]::SetProcessDPIAware()
# 전체 화면에서도 되는 캡처(DXGI Desktop Duplication, 실패 시 GDI)
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot "capture.cs"), [Text.Encoding]::UTF8)) -ReferencedAssemblies System.Drawing

if ($TestCapture) {
  # 진단용: 지금 맨 앞 창을 한 번 찍고 방식·밝기만 출력 (화면 내용은 저장하지 않음)
  $h = [W]::GetForegroundWindow(); $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
  $m = ""; $bmp = [DesktopDup]::CaptureRect([Drawing.Rectangle]::FromLTRB($r.L, $r.T, $r.R, $r.B), [ref]$m)
  $sum = 0; $n = 0
  for ($y = 0; $y -lt $bmp.Height; $y += 40) { for ($x = 0; $x -lt $bmp.Width; $x += 40) { $c = $bmp.GetPixel($x, $y); $sum += $c.R + $c.G + $c.B; $n++ } }
  [Console]::Out.WriteLine((@{ method = $m; w = $bmp.Width; h = $bmp.Height; avgBrightness = [int]($sum / [Math]::Max(1, $n) / 3) } | ConvertTo-Json -Compress))
  exit 0
}

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}

$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$lang = [Windows.Globalization.Language]::new("ko")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { Write-Output '{"error":"no-ocr-language"}'; exit 1 }

function Ocr([string]$path) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    # 줄마다 글자와 화면상 가로·세로 위치(0~1, 줄 가운데)를 함께 돌려줍니다 → 왼쪽/가운데/오른쪽 카드 순서 유지
    $W = [double]$bmp.PixelWidth
    , @($res.Lines | ForEach-Object {
      $ws = @($_.Words); $l = $ws[0].BoundingRect.X; $rr = $ws[-1].BoundingRect
      $H = [double]$bmp.PixelHeight
      @{ s = $_.Text; x = [Math]::Round((($l + $rr.X + $rr.Width) / 2) / $W, 3); y = [Math]::Round(($ws[0].BoundingRect.Y + $ws[0].BoundingRect.Height / 2) / $H, 3) }
    })
  } finally { $stream.Dispose() }
}

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

# OCR용 저장 (속도 위해 BMP):
# - 카드·이벤트 안내가 있는 세로 3%~85% 영역만 읽습니다 (아래쪽 HUD 제외 → OCR 시간 절반)
# - 화면이 작으면(1080p 등) 카드 글자가 작아 못 읽으므로 가로 약 3200px 로 키웁니다
# 가로 위치(x)는 잘라내도 그대로라 카드 순서 계산에 영향이 없습니다.
# 윈도우 OCR은 특정 크기의 그림에서 가끔 글자를 거의 못 읽으므로, 프레임마다 3200px / 2600px 를 번갈아 씁니다.
function SaveForOcr($bmp, [string]$path, [double]$targetW = 3200, [double]$top = 0.03, [double]$height = 0.82) {
  $y0 = [int]($bmp.Height * $top); $ch = [int]($bmp.Height * $height)
  $k = [Math]::Min(2.5, $targetW / $bmp.Width)
  if ($k -le 1.05) { $k = 1.0 }
  $out = New-Object System.Drawing.Bitmap ([int]($bmp.Width * $k)), ([int]($ch * $k))
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = if ($k -gt 1) { [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic } else { [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor }
  $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $out.Width, $out.Height), (New-Object System.Drawing.Rectangle 0, $y0, $bmp.Width, $ch), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp); $out.Dispose()
}

# 한 프레임 읽기 (두 번):
#  1) 카드 제목 띠(세로 33~50%)만 잘라서 → 주변 글자가 없어 제목이 훨씬 정확히 읽힘 (넓게 읽으면 "축소 엔진"이 "入 에지"로 깨지는 등)
#  2) 넓은 영역(3~85%) → 귀빈 이벤트 안내, 카드 설명(이름이 깨졌을 때 설명으로 맞춤)
# 줄의 y 는 화면 전체 기준(0~1)으로 바꿔서 돌려줍니다.
$TitleTop = 0.33; $TitleH = 0.17
function ReadFrame($bmp, [string]$dir, [double]$fullW) {
  $tp = Join-Path $dir "frame-title.bmp"; $fp = Join-Path $dir "frame.bmp"
  SaveForOcr $bmp $tp 2200 $TitleTop $TitleH
  SaveForOcr $bmp $fp $fullW 0.03 0.82
  $a = @(foreach ($e in (Ocr $tp)) { @{ s = $e.s; x = $e.x; y = [Math]::Round($TitleTop + $e.y * $TitleH, 3); band = "title" } })
  $b = @(foreach ($e in (Ocr $fp)) { @{ s = $e.s; x = $e.x; y = [Math]::Round(0.03 + $e.y * 0.82, 3) } })
  , @($a + $b)
}

if ($ImagePath) {
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $ImagePath).Path)
  $lines = ReadFrame $src $OutDir 3200; $src.Dispose()
  Emit @{ t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); lines = $lines; source = "file" }
  exit 0
}

$png = Join-Path $OutDir "frame.bmp"
$fastFlag = Join-Path $OutDir "fast.flag"   # 서버가 선택지를 보면 갱신 → 그동안은 빠르게 읽음 (새로고침 즉시 반영)
$lastJpg = [DateTime]::MinValue
$frameNo = 0
$jpgTmp = Join-Path $OutDir "latest.tmp.jpg"
$jpg = Join-Path $OutDir "latest.jpg"
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 70L
Emit @{ ready = $true; lang = $engine.RecognizerLanguage.LanguageTag }

while ($true) {
  try {
    $h = [W]::GetForegroundWindow(); $procId = 0
    [void][W]::GetWindowThreadProcessId($h, [ref]$procId)
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    # 설정 > '게임 없이 테스트'의 가짜 게임 창도 게임으로 봅니다
    $sb = New-Object System.Text.StringBuilder 128; [void][W]::GetWindowText($h, $sb, 128)
    $isTest = $sb.ToString() -eq $TestTitle
    if (-not $isTest -and (-not $p -or $p.ProcessName -ne $ProcessName)) { Emit @{ idle = $true }; Start-Sleep -Seconds 2; continue }
    $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
    $w = $r.R - $r.L; $hgt = $r.B - $r.T
    if ($w -lt 200 -or $hgt -lt 200) { Start-Sleep -Seconds 1; continue }
    $method = ""
    $bmp = [DesktopDup]::CaptureRect([Drawing.Rectangle]::FromLTRB($r.L, $r.T, $r.R, $r.B), [ref]$method)
    $w = $bmp.Width; $hgt = $bmp.Height
    $t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $frameNo++
    $lines = ReadFrame $bmp $OutDir $(if ($frameNo % 2) { 2600 } else { 3200 })
    # AI에게 보낼 미리보기(가로 1600px 이하)는 2초에 한 번만 저장
    if (([DateTime]::Now - $lastJpg).TotalSeconds -ge 2) {
      $scale = [Math]::Min(1.0, 1600.0 / $w)
      $small = New-Object System.Drawing.Bitmap $bmp, ([int]($w * $scale)), ([int]($hgt * $scale))
      $small.Save($jpgTmp, $jpegCodec, $ep)
      $small.Dispose()
      Move-Item -Force $jpgTmp $jpg
      $lastJpg = [DateTime]::Now
    }
    $bmp.Dispose()
    Emit @{ t = $t; lines = $lines; w = $w; h = $hgt; method = $method }
  } catch {
    Emit @{ error = $_.Exception.Message }
  }
  # 선택지가 떠 있으면(최근 6초 안에 서버가 봤으면) 0.2초, 아니면 0.9초 쉬고 다시 읽기
  $fast = (Test-Path $fastFlag) -and (([DateTime]::Now - (Get-Item $fastFlag).LastWriteTime).TotalSeconds -lt 6)
  Start-Sleep -Milliseconds $(if ($fast) { 200 } else { [int]($IntervalSec * 1000) })
}
