# 아수라장 코치 화면 실행기 (리더 서버가 자동으로 띄웁니다)
#   -Port        리더 서버 포트
#   -FontDir     Pretendard 글꼴 폴더
#   -Tray        프로그램 모드: 트레이 아이콘 + 설정창도 띄움
#   -ExePath     AramCoach.exe 경로 (연결 설정 복사용)
param(
  [int]$Port = 47321,
  [string]$ProcessName = "League of Legends",
  [string]$FontDir = "",
  [string]$IconPath = "",
  [string]$AppVersion = "",
  [switch]$Tray,
  [string]$ExePath = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot "overlay.cs"), [Text.Encoding]::UTF8)) `
  -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions
[void][AramOverlay]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($true)  # 내장 글꼴(Pretendard)을 컨트롤에도 쓰기 위해
[Ui]::BaseUrl = "http://127.0.0.1:$Port"
if ($FontDir) { [Ui]::LoadFonts($FontDir) }
if ($IconPath) { [Ui]::IconPath = $IconPath }
$overlay = New-Object AramOverlay $ProcessName
if ($Tray) {
  [System.Windows.Forms.Application]::Run((New-Object TrayApp $overlay, $ExePath, $AppVersion))
} else {
  [System.Windows.Forms.Application]::Run($overlay)
}
