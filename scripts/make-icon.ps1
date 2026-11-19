# 아이콘 만들기: assets/icon.ico (16~256px 여러 크기) + assets/icon.png (256px)
# 콘셉트: 증강 카드 3장 부채꼴, 가운데(1순위) 금색 카드 + 반짝임. 남색 배경·금색 테두리.
param([string]$OutDir = (Join-Path $PSScriptRoot "..\assets"))
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Drawing2D;
public static class IconArt {
  static GraphicsPath Round(RectangleF r, float rad) {
    GraphicsPath p = new GraphicsPath(); float d = rad * 2;
    p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
    p.CloseFigure(); return p;
  }
  static GraphicsPath Sparkle(float cx, float cy, float R, float r) {
    GraphicsPath p = new GraphicsPath(); PointF[] pts = new PointF[8];
    for (int i = 0; i < 8; i++) { double a = Math.PI / 4 * i - Math.PI / 2; float rr = i % 2 == 0 ? R : r; pts[i] = new PointF(cx + (float)(Math.Cos(a) * rr), cy + (float)(Math.Sin(a) * rr)); }
    p.AddPolygon(pts); return p;
  }
  static void Card(Graphics g, float k, float angle, float dy, bool gold) {
    GraphicsState st = g.Save();
    g.TranslateTransform(128 * k, 214 * k); g.RotateTransform(angle); g.TranslateTransform(0, dy * k);
    RectangleF r = new RectangleF(-38 * k, -150 * k, 76 * k, 108 * k);
    // 그림자
    using (GraphicsPath sp = Round(new RectangleF(r.X + 3 * k, r.Y + 5 * k, r.Width, r.Height), 11 * k))
    using (SolidBrush sb = new SolidBrush(Color.FromArgb(110, 0, 0, 0))) g.FillPath(sb, sp);
    using (GraphicsPath p = Round(r, 11 * k)) {
      Color c1 = gold ? Color.FromArgb(250, 232, 172) : Color.FromArgb(44, 66, 88);
      Color c2 = gold ? Color.FromArgb(196, 150, 72) : Color.FromArgb(22, 35, 48);
      using (LinearGradientBrush b = new LinearGradientBrush(r, c1, c2, 90f)) g.FillPath(b, p);
      using (Pen pen = new Pen(gold ? Color.FromArgb(255, 246, 214) : Color.FromArgb(120, 140, 160), (gold ? 4f : 3f) * k)) g.DrawPath(pen, p);
      // 카드 안쪽 테두리
      RectangleF inner = RectangleF.Inflate(r, -8 * k, -8 * k);
      using (GraphicsPath ip = Round(inner, 6 * k)) using (Pen ipen = new Pen(gold ? Color.FromArgb(150, 120, 80, 30) : Color.FromArgb(90, 150, 170, 190), 2f * k)) g.DrawPath(ipen, ip);
    }
    if (gold) using (GraphicsPath s = Sparkle(0, r.Y + r.Height / 2, 26 * k, 8 * k)) using (SolidBrush sb = new SolidBrush(Color.FromArgb(18, 30, 44))) g.FillPath(sb, s);
    else using (GraphicsPath s = Sparkle(0, r.Y + r.Height / 2, 14 * k, 5 * k)) using (SolidBrush sb = new SolidBrush(Color.FromArgb(120, 150, 175, 200))) g.FillPath(sb, s);
    g.Restore(st);
  }
  public static Bitmap Draw(int size) {
    Bitmap bmp = new Bitmap(size, size);
    float k = size / 256f;
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = SmoothingMode.AntiAlias; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      RectangleF bg = new RectangleF(6 * k, 6 * k, 244 * k, 244 * k);
      using (GraphicsPath p = Round(bg, 54 * k)) {
        using (LinearGradientBrush b = new LinearGradientBrush(bg, Color.FromArgb(30, 48, 66), Color.FromArgb(8, 14, 20), 60f)) g.FillPath(b, p);
        // 위쪽 은은한 빛
        using (GraphicsPath gp = new GraphicsPath()) {
          gp.AddEllipse(28 * k, -40 * k, 200 * k, 170 * k);
          using (PathGradientBrush pg = new PathGradientBrush(gp)) {
            pg.CenterColor = Color.FromArgb(70, 200, 170, 110); pg.SurroundColors = new Color[] { Color.FromArgb(0, 200, 170, 110) };
            Region old = g.Clip; g.SetClip(p); g.FillPath(pg, gp); g.Clip = old;
          }
        }
        using (LinearGradientBrush lb = new LinearGradientBrush(bg, Color.FromArgb(246, 222, 150), Color.FromArgb(150, 108, 44), 90f))
        using (Pen pen = new Pen(lb, 9 * k)) g.DrawPath(pen, p);
      }
      Card(g, k, -24f, 6f, false);
      Card(g, k, 24f, 6f, false);
      Card(g, k, 0f, -10f, true);
      // 오른쪽 위 작은 반짝임
      using (GraphicsPath s = Sparkle(206 * k, 52 * k, 20 * k, 5 * k)) using (SolidBrush sb = new SolidBrush(Color.FromArgb(250, 230, 170))) g.FillPath(sb, s);
      using (GraphicsPath s = Sparkle(184 * k, 30 * k, 9 * k, 2.5f * k)) using (SolidBrush sb = new SolidBrush(Color.FromArgb(200, 250, 230, 170))) g.FillPath(sb, s);
    }
    return bmp;
  }
}
"@
New-Item -ItemType Directory -Force $OutDir | Out-Null
$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$pngs = @()
foreach ($s in $sizes) {
  # 작은 크기는 큰 그림을 줄이면 흐려지므로 크기마다 직접 그림
  $b = [IconArt]::Draw($s)
  if ($s -ge 256) {
    $ms = New-Object IO.MemoryStream; $b.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $pngs += , $ms.ToArray()
  } else {
    # 256px 미만은 표준 32비트 비트맵(DIB) 항목: 헤더 + 아래→위 BGRA 픽셀 + AND 마스크
    $ms = New-Object IO.MemoryStream; $bw = New-Object IO.BinaryWriter $ms
    $maskRow = [int]([Math]::Ceiling($s / 32.0) * 4)
    $bw.Write([uint32]40); $bw.Write([int32]$s); $bw.Write([int32]($s * 2)); $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]0); $bw.Write([uint32]($s * $s * 4 + $maskRow * $s)); $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    for ($y = $s - 1; $y -ge 0; $y--) { for ($x = 0; $x -lt $s; $x++) { $c = $b.GetPixel($x, $y); $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A) } }
    $bw.Write((New-Object byte[] ($maskRow * $s)))
    $bw.Flush(); $pngs += , $ms.ToArray()
  }
  if ($s -eq 256) { $b.Save((Join-Path $OutDir "icon.png"), [Drawing.Imaging.ImageFormat]::Png) }
  $b.Dispose()
}
$big = [IconArt]::Draw(1024); $big.Save((Join-Path $OutDir "icon-1024.png"), [Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
# ICO 파일 (PNG 압축 항목들)
$ms = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = $pngs[$i]
  $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$d.Length); $w.Write([uint32]$offset); $offset += $d.Length
}
foreach ($d in $pngs) { $w.Write($d) }
$w.Flush(); [IO.File]::WriteAllBytes((Join-Path $OutDir "icon.ico"), $ms.ToArray())
"아이콘 생성 완료: $OutDir\icon.ico ($($sizes -join ', ')px)"
