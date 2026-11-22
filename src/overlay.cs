// 아수라장 코치 화면: 게임 위 오버레이 + 트레이 아이콘 + 설정창
// - 오버레이: 투명·항상 위·포커스를 뺏지 않음·클릭 통과. 증강 카드 위에 AI 등급·점수·이유를 표시
// - 디자인: 롤 클라이언트 색(남색·금색) + Pretendard 글꼴, 카드 구성은 GitHub 아수라장 도우미들(aramgg, mayhem-advisor) 참고
// - 리더 서버(127.0.0.1:PORT)의 /overlay /status /settings 를 사용
// C# 5 문법만 사용 (Windows PowerShell 5.1 Add-Type 호환)
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// ---------- 공통: 글꼴·색·HTTP ----------
public static class Ui
{
    static PrivateFontCollection pfc = new PrivateFontCollection();
    static Dictionary<string, FontFamily> fams = new Dictionary<string, FontFamily>();
    public static string BaseUrl = "http://127.0.0.1:47321";
    /// <summary>'게임 없이 테스트'의 가짜 게임 창 제목. 화면 감시(watcher.ps1)도 같은 제목을 게임으로 봅니다.</summary>
    public const string TestTitle = "아수라장 코치 테스트 게임";
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    /// <summary>이 창이 롤 게임 창(또는 테스트용 가짜 게임 창)인지</summary>
    public static bool IsGameWindow(IntPtr h, string processName)
    {
        StringBuilder sb = new StringBuilder(128);
        GetWindowText(h, sb, 128);
        if (sb.ToString() == TestTitle) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        try { return Process.GetProcessById((int)pid).ProcessName == processName; } catch { return false; }
    }
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr h, string app, string id);
    /// <summary>스크롤바를 어두운 색으로 (Windows 10 1809+). 실패해도 무시</summary>
    public static void DarkScroll(Control c)
    {
        if (c.IsHandleCreated) { try { SetWindowTheme(c.Handle, "DarkMode_Explorer", null); } catch { } }
        else c.HandleCreated += delegate { try { SetWindowTheme(c.Handle, "DarkMode_Explorer", null); } catch { } };
    }
    /// <summary>테스트 창 열기 (트레이가 지정)</summary>
    public static Action OpenTest;
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();

    public static readonly Color Bg = Color.FromArgb(10, 16, 22);
    public static readonly Color Panel = Color.FromArgb(17, 25, 33);
    public static readonly Color PanelLine = Color.FromArgb(33, 44, 55);
    public static readonly Color Gold = Color.FromArgb(200, 170, 110);
    public static readonly Color GoldLight = Color.FromArgb(240, 230, 210);
    public static readonly Color Text = Color.FromArgb(232, 228, 218);
    public static readonly Color Sub = Color.FromArgb(150, 160, 170);
    public static readonly Color Green = Color.FromArgb(94, 214, 140);
    public static readonly Color Amber = Color.FromArgb(240, 180, 80);
    public static readonly Color Pink = Color.FromArgb(240, 120, 170);

    public static void LoadFonts(string dir)
    {
        try
        {
            if (Directory.Exists(dir))
                foreach (string f in Directory.GetFiles(dir, "*.ttf")) pfc.AddFontFile(f);
            foreach (FontFamily ff in pfc.Families) fams[ff.Name] = ff;
        }
        catch { }
    }

    /// <summary>weight: Regular | Medium | SemiBold | Bold | ExtraBold</summary>
    public static Font F(string weight, float px)
    {
        px = Math.Max(6f, px);
        FontFamily ff;
        if (weight == "Bold" && fams.TryGetValue("Pretendard", out ff)) return new Font(ff, px, FontStyle.Bold, GraphicsUnit.Pixel);
        if (weight != "Regular" && fams.TryGetValue("Pretendard " + weight, out ff)) return new Font(ff, px, FontStyle.Regular, GraphicsUnit.Pixel);
        if (fams.TryGetValue("Pretendard", out ff)) return new Font(ff, px, weight == "Regular" ? FontStyle.Regular : FontStyle.Bold, GraphicsUnit.Pixel);
        return new Font("Malgun Gothic", px, weight == "Regular" || weight == "Medium" ? FontStyle.Regular : FontStyle.Bold, GraphicsUnit.Pixel);
    }

    public static string GetRaw(string path)
    {
        try { using (WebClient wc = new WebClient()) { wc.Encoding = Encoding.UTF8; return wc.DownloadString(BaseUrl + path); } }
        catch { return null; }
    }
    public static Dictionary<string, object> Parse(string raw)
    {
        try { return raw == null ? null : json.Deserialize<Dictionary<string, object>>(raw); } catch { return null; }
    }
    public static Dictionary<string, object> Get(string path) { return Parse(GetRaw(path)); }
    public static Dictionary<string, object> Post(string path, object body)
    {
        try
        {
            using (WebClient wc = new WebClient())
            {
                wc.Encoding = Encoding.UTF8; wc.Headers[HttpRequestHeader.ContentType] = "application/json";
                return json.Deserialize<Dictionary<string, object>>(wc.UploadString(BaseUrl + path, body == null ? "{}" : json.Serialize(body)));
            }
        }
        catch { return null; }
    }
    public static string Ser(object o) { return json.Serialize(o); }

    public static string S(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? v.ToString() : null; }
    public static bool B(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v; }
    public static double N(Dictionary<string, object> d, string k, double def) { object v; if (d != null && d.TryGetValue(k, out v) && v != null) { try { return Convert.ToDouble(v); } catch { } } return def; }
    public static Dictionary<string, object> D(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null; }
    public static ArrayList A(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v as ArrayList : null; }

    public static GraphicsPath Round(RectangleF r, float rad)
    {
        GraphicsPath p = new GraphicsPath();
        rad = Math.Max(1f, Math.Min(rad, Math.Min(r.Width, r.Height)));
        p.AddArc(r.X, r.Y, rad, rad, 180, 90); p.AddArc(r.Right - rad, r.Y, rad, rad, 270, 90);
        p.AddArc(r.Right - rad, r.Bottom - rad, rad, rad, 0, 90); p.AddArc(r.X, r.Bottom - rad, rad, rad, 90, 90);
        p.CloseFigure(); return p;
    }

    public static void Fill(Graphics g, RectangleF r, float rad, Color top, Color bottom)
    {
        using (GraphicsPath p = Round(r, rad))
        using (LinearGradientBrush b = new LinearGradientBrush(new RectangleF(r.X, r.Y - 1, r.Width, r.Height + 2), top, bottom, 90f))
            g.FillPath(b, p);
    }
    public static void Stroke(Graphics g, RectangleF r, float rad, Color c, float w)
    {
        using (GraphicsPath p = Round(r, rad)) using (Pen pen = new Pen(c, w)) g.DrawPath(pen, p);
    }

    /// <summary>등급별 색 (위, 아래 그라데이션)</summary>
    public static Color[] GradeColors(string g)
    {
        if (g == "S+") return new Color[] { Color.FromArgb(255, 138, 76), Color.FromArgb(232, 72, 72) };
        if (g == "S") return new Color[] { Color.FromArgb(240, 206, 120), Color.FromArgb(200, 160, 80) };
        if (g == "A") return new Color[] { Color.FromArgb(166, 132, 255), Color.FromArgb(118, 86, 230) };
        if (g == "B") return new Color[] { Color.FromArgb(92, 172, 255), Color.FromArgb(52, 122, 222) };
        if (g == "C") return new Color[] { Color.FromArgb(138, 148, 160), Color.FromArgb(104, 114, 126) };
        if (g == "?") return new Color[] { Color.FromArgb(80, 90, 100), Color.FromArgb(60, 68, 78) };
        return new Color[] { Color.FromArgb(96, 102, 112), Color.FromArgb(70, 76, 86) };
    }
    public static string GradeWord(string g)
    {
        if (g == "S+") return "최상"; if (g == "S") return "아주 좋음"; if (g == "A") return "좋음";
        if (g == "B") return "보통"; if (g == "C") return "아쉬움"; if (g == "D") return "비추천"; return "";
    }

    public static string IconPath = "";
    static string G(double v) { return ((int)v).ToString("N0") + "G"; }
    /// <summary>"지금 살 것" 한 줄: 완성 / 재료 / 골드 부족</summary>
    public static string BuyText(Dictionary<string, object> it)
    {
        Dictionary<string, object> b = D(it, "buy");
        if (b == null) return null;
        string name = S(b, "name"); double cost = N(b, "cost", 0);
        if (B(b, "complete") && B(b, "affordable")) return "지금 살 것: " + name + " 완성 (" + G(cost) + ")";
        if (B(b, "affordable")) return "지금 살 것: " + name + " " + G(cost) + "  → 1번 재료";
        return G(N(b, "need", 0)) + " 더 모으면: " + name + " " + G(cost) + (B(b, "complete") ? "" : "  → 1번 재료");
    }
    /// <summary>순서 아이템 아래 줄: 가진 재료를 뺀 남은 골드</summary>
    public static string RemainText(Dictionary<string, object> o, double gold, bool first)
    {
        double remain = N(o, "remain", -1), total = N(o, "gold", -1);
        if (remain < 0) return total > 0 ? G(total) : "";
        ArrayList used = A(o, "owned");
        string t = "남은 " + G(remain) + (used != null && used.Count > 0 ? " (" + string.Join("·", used.ToArray()) + " 보유)" : "");
        if (first) t += remain <= gold ? " · 살 수 있어요" : " · " + G(remain - gold) + " 부족";
        return t;
    }
    public static Color RemainColor(Dictionary<string, object> o, double gold, bool first)
    {
        return first && N(o, "remain", -1) >= 0 && N(o, "remain", 0) <= gold ? Green : Sub;
    }
    /// <summary>오류 기록: %LOCALAPPDATA%\AramCoach\overlay.log (1MB 넘으면 새로 씀)</summary>
    public static void Log(string msg)
    {
        try
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AramCoach");
            Directory.CreateDirectory(dir);
            string f = Path.Combine(dir, "overlay.log");
            if (File.Exists(f) && new FileInfo(f).Length > 1000000) File.Delete(f);
            File.AppendAllText(f, DateTime.Now.ToString("MM-dd HH:mm:ss") + " " + msg + Environment.NewLine);
        }
        catch { }
    }
    /// <summary>설정창에서 보조 창을 열 때 쓰는 연결 (트레이가 지정)</summary>
    public static Action OpenCompanion;
    static readonly Dictionary<string, Image> iconCache = new Dictionary<string, Image>();
    /// <summary>아이템 아이콘 (한 번 받으면 기억)</summary>
    public static Image IconFor(string url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        Image im;
        if (iconCache.TryGetValue(url, out im)) return im;
        try { using (WebClient wc = new WebClient()) using (MemoryStream ms = new MemoryStream(wc.DownloadData(url))) im = new Bitmap(Image.FromStream(ms)); }
        catch { im = null; }
        iconCache[url] = im; return im;
    }
    /// <summary>/overlay 데이터의 아이템 아이콘을 미리 받아 둡니다</summary>
    public static void Prefetch(Dictionary<string, object> ov)
    {
        ArrayList next = A(D(ov, "items"), "next");
        if (next != null) foreach (object o in next) IconFor(S(o as Dictionary<string, object>, "icon"));
    }
    /// <summary>화면 배율 (200% 모니터면 2). 설정창·트레이 메뉴 크기에 곱합니다.</summary>
    public static float K = 1f;
    public static void InitDpi()
    {
        try { using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) K = Math.Max(1f, g.DpiX / 96f); } catch { K = 1f; }
    }
    /// <summary>96DPI 기준으로 만든 컨트롤들을 배율만큼 키웁니다 (위치·크기·여백·직접 지정한 글꼴).</summary>
    public static void ScaleTree(Control c, float k)
    {
        if (k == 1f) return;
        c.Left = (int)(c.Left * k); c.Top = (int)(c.Top * k);
        FlowLayoutPanel fl = c as FlowLayoutPanel;
        if (fl == null || !fl.AutoSize) { c.Width = (int)(c.Width * k); c.Height = (int)(c.Height * k); }
        c.Margin = new Padding((int)(c.Margin.Left * k), (int)(c.Margin.Top * k), (int)(c.Margin.Right * k), (int)(c.Margin.Bottom * k));
        bool inherited = c.Parent != null && ReferenceEquals(c.Font, c.Parent.Font);
        if (!inherited && c.Font != null && c.Font.Unit == GraphicsUnit.Pixel) c.Font = new Font(c.Font.FontFamily, c.Font.Size * k, c.Font.Style, GraphicsUnit.Pixel);
        foreach (Control ch in c.Controls) ScaleTree(ch, k);
    }
    /// <summary>앱 아이콘: assets/icon.ico (없으면 직접 그림)</summary>
    public static Icon MakeIcon() { return MakeIcon(32); }
    public static Icon MakeIcon(int size)
    {
        try { if (!string.IsNullOrEmpty(IconPath) && File.Exists(IconPath)) return new Icon(IconPath, size, size); } catch { }
        Bitmap b = new Bitmap(64, 64);
        using (Graphics g = Graphics.FromImage(b))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            Fill(g, new RectangleF(2, 2, 60, 60), 18, Color.FromArgb(240, 214, 150), Color.FromArgb(176, 136, 64));
            Stroke(g, new RectangleF(2, 2, 60, 60), 18, Color.FromArgb(90, 60, 20), 2f);
            using (Font f = F("ExtraBold", 40)) using (SolidBrush t = new SolidBrush(Color.FromArgb(24, 26, 32)))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                g.DrawString("A", f, t, new RectangleF(0, 3, 64, 64), sf);
        }
        return Icon.FromHandle(b.GetHicon());
    }
}

// ---------- 게임 위 오버레이 ----------
public class AramOverlay : Form
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    DateTime lastTopmost = DateTime.MinValue;

    readonly string processName;
    readonly Timer poll = new Timer(), mouse = new Timer();
    volatile Dictionary<string, object> data;
    Rectangle game = Rectangle.Empty;
    bool tabDown;
    string lastRaw;
    bool dirty;
    public bool UserHidden;
    static readonly Color Key = Color.FromArgb(1, 2, 3);

    public AramOverlay(string proc)
    {
        processName = proc;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Key;
        TransparencyKey = Key;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        Bounds = new Rectangle(-10000, -10000, 10, 10);
        poll.Interval = 150; poll.Tick += delegate { Tick(); }; poll.Start();
        mouse.Interval = 30; mouse.Tick += delegate { CheckTab(); }; mouse.Start();
        // 클릭 감지는 화면 그리기와 따로(별도 스레드, 10ms 간격): 화면 쪽이 서버 응답·아이콘 다운로드로 잠깐 멈춰도 클릭을 놓치지 않음
        System.Threading.Thread ct = new System.Threading.Thread(ClickLoop) { IsBackground = true, Name = "click" };
        ct.Start();
    }

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000 | 0x8; // LAYERED | TRANSPARENT(클릭 통과) | TOOLWINDOW | NOACTIVATE | TOPMOST
            return cp;
        }
    }

    bool FindGame()
    {
        IntPtr h = GetForegroundWindow();
        if (!Ui.IsGameWindow(h, processName)) return false;
        RECT r; GetWindowRect(h, out r);
        game = Rectangle.FromLTRB(r.L, r.T, r.R, r.B);
        return game.Width > 200 && game.Height > 200;
    }

    /// <summary>아이템 패널을 지금 보여줄지: 죽어 있을 때 / 다음 템 살 골드가 모였을 때(서버 판단) / Tab 누르고 있을 때</summary>
    readonly Dictionary<string, Image> icons = new Dictionary<string, Image>();
    void PrefetchIcons()
    {
        Dictionary<string, object> it = Ui.D(data, "items");
        ArrayList next = Ui.A(it, "next");
        if (next == null) return;
        foreach (object o in next)
        {
            string url = Ui.S(o as Dictionary<string, object>, "icon");
            if (url == null || icons.ContainsKey(url)) continue;
            try { using (WebClient wc = new WebClient()) using (MemoryStream ms = new MemoryStream(wc.DownloadData(url))) icons[url] = new Bitmap(Image.FromStream(ms)); dirty = true; }
            catch { icons[url] = null; }
        }
    }

    bool ItemsVisible()
    {
        Dictionary<string, object> it = Ui.D(data, "items");
        if (it == null || Ui.A(it, "next") == null || Ui.A(it, "next").Count == 0) return false;
        return Ui.B(it, "show") || tabDown;
    }

    void Tick()
    {
        bool front = FindGame();
        string raw = Ui.GetRaw("/overlay");
        if (raw != lastRaw) { lastRaw = raw; data = Ui.Parse(raw); dirty = true; PrefetchIcons(); }
        bool enabled = data != null && (!data.ContainsKey("enabled") || Ui.B(data, "enabled"));
        // 전체 화면(독점) 모드에서는 창을 띄우면 게임이 깜빡이고 어차피 가려지므로 띄우지 않습니다
        bool fullscreen = data != null && Ui.B(data, "fullscreen");
        bool show = !UserHidden && enabled && !fullscreen && front && data != null && (Ui.B(data, "show") || Ui.D(data, "lastPick") != null || ItemsVisible());
        if (show)
        {
            if (Bounds != game) { Bounds = game; dirty = true; }
            if (!Visible) { Show(); dirty = true; lastTopmost = DateTime.MinValue; }
            // 게임 창이 막 만들어진 직후(첫 증강)에는 게임 창이 오버레이 위로 올라오는 일이 있어, 보이는 동안 1초마다 맨 위로 다시 올림
            if ((DateTime.Now - lastTopmost).TotalMilliseconds > 1000)
            {
                SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
                lastTopmost = DateTime.Now;
            }
            if (dirty) { Invalidate(); dirty = false; }
        }
        else if (Visible) Hide();
    }

    void CheckTab()
    {
        bool tab = (GetAsyncKeyState(0x09) & 0x8000) != 0;
        if (tab != tabDown) { tabDown = tab; dirty = true; }
    }

    void ClickLoop()
    {
        bool was = false;
        while (true)
        {
            try
            {
                bool down = (GetAsyncKeyState(0x01) & 0x8000) != 0;
                Dictionary<string, object> d = data; // 화면 쪽에서 통째로 바꿔 끼우므로 참조만 복사해 읽음
                // 클릭 기록은 창이 안 보여도(전체 화면) 게임이 앞에 있고 선택지가 떠 있으면 동작
                if (down && !was && d != null && (Ui.B(d, "show") || Ui.B(d, "clickable")))
                {
                    IntPtr h = GetForegroundWindow();
                    bool isGame = Ui.IsGameWindow(h, processName);
                    RECT r; POINT p;
                    if (isGame && GetWindowRect(h, out r) && GetCursorPos(out p))
                    {
                        Rectangle g = Rectangle.FromLTRB(r.L, r.T, r.R, r.B);
                        if (g.Width > 200 && g.Height > 200 && g.Contains(p.X, p.Y))
                        {
                            double rx = (p.X - g.Left) / (double)g.Width, ry = (p.Y - g.Top) / (double)g.Height;
                            if (ry > 0.17 && ry < 0.66)
                                using (WebClient wc = new WebClient()) wc.UploadString(Ui.BaseUrl + "/click?x=" + rx.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture), "{}");
                        }
                    }
                }
                was = down;
            }
            catch { }
            System.Threading.Thread.Sleep(10);
        }
    }

    /// <summary>테스트/미리보기용: 데이터를 직접 넣고 그리기</summary>
    public void SetData(Dictionary<string, object> d) { data = d; }

    void Pill(Graphics g, string text, float cx, float y, float s, Color fg, Color border)
    {
        using (Font f = Ui.F("SemiBold", 13 * s))
        {
            SizeF sz = g.MeasureString(text, f);
            RectangleF r = new RectangleF(cx - sz.Width / 2 - 14 * s, y, sz.Width + 28 * s, sz.Height + 10 * s);
            Ui.Fill(g, r, r.Height, Color.FromArgb(235, 16, 24, 32), Color.FromArgb(235, 10, 16, 22));
            Ui.Stroke(g, r, r.Height, border, 1.2f * s);
            using (SolidBrush t = new SolidBrush(fg)) g.DrawString(text, f, t, r.X + 14 * s, r.Y + 5 * s);
        }
    }

    // 카드 아래쪽 강조 상자 (시너지·스티커·새로고침 안내)
    float Callout(Graphics g, string text, RectangleF area, float y, float s, Color c)
    {
        using (Font f = Ui.F("SemiBold", 11.5f * s))
        {
            RectangleF r = new RectangleF(area.X, y, area.Width, 22 * s);
            Ui.Fill(g, r, 7 * s, Color.FromArgb(40, c), Color.FromArgb(28, c));
            Ui.Stroke(g, r, 7 * s, Color.FromArgb(150, c), 1f * s);
            using (SolidBrush t = new SolidBrush(c))
            using (StringFormat sf = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap, LineAlignment = StringAlignment.Center })
                g.DrawString(text, f, t, new RectangleF(r.X + 8 * s, r.Y, r.Width - 12 * s, r.Height), sf);
            return r.Bottom + 5 * s;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        if (data == null) return;
        float W = Width, H = Height;
        float s = (H / 1080f) * (float)Ui.N(data, "scale", 1.0);
        float offY = (float)Ui.N(data, "offsetY", 0) / 100f * H;

        Dictionary<string, object> lastPick = Ui.D(data, "lastPick");
        if (lastPick != null) Pill(g, "고른 증강 기록됨 · " + Ui.S(lastPick, "name"), W / 2, H * 0.045f + offY, s, Ui.Green, Color.FromArgb(160, Ui.Green));
        // 증강 선택 중에는 카드가 우선 (아이템 패널은 Tab 누를 때만)
        if (ItemsVisible() && (!Ui.B(data, "show") || tabDown)) DrawItems(g, W, H, s);
        if (!Ui.B(data, "show")) return;
        ArrayList cards = Ui.A(data, "cards");
        if (cards == null || cards.Count == 0) return;

        bool hasPlan = Ui.B(data, "hasPlan");
        string setupState = Ui.S(data, "setupState") ?? "";
        string engine = Ui.S(data, "setupEngine");
        string ev = Ui.S(data, "event");
        string top;
        Color topColor = Ui.Gold;
        if (!hasPlan)
        {
            if (setupState == "진행 중") top = "AI가 이번 판을 분석 중이에요" + (engine != null ? " · " + engine : "");
            else { top = "AI 세팅이 없어요 · 트레이 > 설정에서 AI 연결 확인 또는 채팅에 '세팅'"; topColor = Ui.Amber; }
        }
        else
        {
            string src = (Ui.S(data, "planSource") ?? "").Replace("AI(", "").Replace(")", "").Replace("AI", "");
            top = "AI 추천" + (src.Length > 0 ? " · " + src : "") + (ev != null ? " · 이벤트: " + ev : "");
        }
        Pill(g, top, W / 2, H * 0.012f + offY, s, topColor, Color.FromArgb(140, topColor));

        // 카드 중심 x들 → 패널 폭
        List<float> xs = new List<float>();
        for (int i = 0; i < cards.Count; i++)
        {
            double x = Ui.N(cards[i] as Dictionary<string, object>, "x", -1);
            xs.Add(x < 0 ? (float)((i + 0.5) / cards.Count) : (float)x);
        }
        float gap = 1f;
        for (int i = 1; i < xs.Count; i++) gap = Math.Min(gap, xs[i] - xs[i - 1]);
        float pw = Math.Min(W * 0.17f * (float)Ui.N(data, "scale", 1.0), W * gap * 0.92f);
        float bottomY = H * 0.168f + offY; // 카드 위쪽 끝 바로 위에 패널 아래쪽을 맞춥니다

        for (int i = 0; i < cards.Count; i++)
        {
            Dictionary<string, object> c = cards[i] as Dictionary<string, object>;
            if (!hasPlan) { DrawWaiting(g, xs[i] * W - pw / 2, bottomY, pw, s, setupState == "진행 중"); continue; }
            DrawCard(g, c, xs[i] * W - pw / 2, bottomY, pw, s);
        }
    }

    /// <summary>오른쪽 "다음 아이템" 패널 (죽었을 때 / 골드 모였을 때 / Tab)</summary>
    void DrawItems(Graphics g, float W, float H, float s)
    {
        s *= 1.15f; // 게임 중에 잘 보이도록 글씨를 조금 크게
        Dictionary<string, object> it = Ui.D(data, "items");
        ArrayList next = Ui.A(it, "build") ?? Ui.A(it, "next");
        double gold = Ui.N(it, "gold", 0);
        bool dead = Ui.B(it, "dead"), full = Ui.B(it, "full");
        string buy = full ? "6칸 완성 · 더 살 아이템 없어요" : Ui.BuyText(it), why = Ui.S(it, "why"), src = Ui.S(it, "source");
        bool buyOk = full || Ui.B(Ui.D(it, "buy"), "affordable");
        float pad = 14 * s, rowH = 52 * s, haveH = 32 * s;
        int haveN = 0; foreach (object o in next) if (Ui.B(o as Dictionary<string, object>, "have")) haveN++;
        float w = Math.Min(W * 0.24f, 380 * s);
        float h = pad + 26 * s + (dead ? 24 * s : 0) + (string.IsNullOrEmpty(buy) ? 0 : 36 * s) + haveN * haveH + (next.Count - haveN) * rowH + (string.IsNullOrEmpty(why) ? 0 : 24 * s) + pad;
        RectangleF r = new RectangleF(W - w - W * 0.012f, H * 0.2f, w, h);
        Ui.Fill(g, r, 14 * s, Color.FromArgb(240, 22, 32, 42), Color.FromArgb(240, 11, 17, 23));
        Ui.Stroke(g, r, 14 * s, Ui.Gold, 1.6f * s);
        float y = r.Y + pad;
        using (Font hf = Ui.F("Bold", 16 * s)) using (SolidBrush hb = new SolidBrush(Ui.GoldLight)) g.DrawString("완성 빌드 " + haveN + "/6", hf, hb, r.X + pad, y - 2 * s);
        if (src != null) using (Font sf = Ui.F("Medium", 11.5f * s)) using (SolidBrush sb = new SolidBrush(Ui.Sub))
        {
            string t = Ui.B(it, "busy") ? "AI 다시 고르는 중…" : src;
            SizeF sz = g.MeasureString(t, sf);
            g.DrawString(t, sf, sb, r.Right - pad - sz.Width, y + 2 * s);
        }
        y += 26 * s;
        if (dead)
        {
            double rs = Ui.N(it, "respawnIn", 0);
            using (Font df = Ui.F("SemiBold", 13 * s)) using (SolidBrush db = new SolidBrush(Ui.Amber))
                g.DrawString("지금 상점에서 사세요" + (rs > 0 ? " · 부활 " + ((int)rs) + "초" : ""), df, db, r.X + pad, y);
            y += 24 * s;
        }
        // 맨 위: 지금 살 것 (1번을 완성하거나, 1번 재료 중 지금 골드로 살 수 있는 것)
        if (!string.IsNullOrEmpty(buy)) y = Callout(g, buy, new RectangleF(r.X + pad, y, r.Width - pad * 2, 22 * s), y, s, buyOk ? Ui.Green : Ui.Amber) + 6 * s;
        int k = 0; // 앞으로 살 아이템 번호
        for (int j = 0; j < next.Count; j++)
        {
            Dictionary<string, object> o = next[j] as Dictionary<string, object>;
            string url = Ui.S(o, "icon");
            Image im;
            if (Ui.B(o, "have"))
            {
                // 이미 산 아이템: 작게, ✓ 표시
                RectangleF hc = new RectangleF(r.X + pad + 7 * s, y + 3 * s, 26 * s, 26 * s);
                if (url != null && icons.TryGetValue(url, out im) && im != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(im, hc); }
                using (Font nf = Ui.F("Medium", 13 * s)) using (SolidBrush nb = new SolidBrush(Color.FromArgb(150, Ui.Green)))
                using (StringFormat sfm = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                    g.DrawString("✓ " + Ui.S(o, "name"), nf, nb, new RectangleF(hc.Right + 17 * s, y + 7 * s, r.Right - pad - hc.Right - 17 * s, 20 * s), sfm);
                y += haveH;
                continue;
            }
            int i = k++;
            RectangleF ic = new RectangleF(r.X + pad, y + 4 * s, 42 * s, 42 * s);
            if (url != null && icons.TryGetValue(url, out im) && im != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(im, ic); }
            else Ui.Fill(g, ic, 6 * s, Color.FromArgb(40, 52, 64), Color.FromArgb(30, 40, 50));
            Ui.Stroke(g, ic, 6 * s, i == 0 ? Ui.Gold : Color.FromArgb(70, 84, 98), (i == 0 ? 2f : 1f) * s);
            float tx = ic.Right + 10 * s;
            using (Font nf = Ui.F(i == 0 ? "Bold" : "SemiBold", (i == 0 ? 15 : 14) * s)) using (SolidBrush nb = new SolidBrush(i == 0 ? Ui.Text : Color.FromArgb(200, 206, 214)))
            using (StringFormat sfm = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString((i + 1) + ". " + Ui.S(o, "name"), nf, nb, new RectangleF(tx, y + 4 * s, r.Right - pad - tx, 22 * s), sfm);
            string rt = Ui.RemainText(o, gold, i == 0);
            if (!string.IsNullOrEmpty(rt))
                using (Font pf = Ui.F("Medium", 12 * s)) using (SolidBrush pb = new SolidBrush(Ui.RemainColor(o, gold, i == 0)))
                using (StringFormat sfm = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                    g.DrawString(rt, pf, pb, new RectangleF(tx, y + 27 * s, r.Right - pad - tx, 20 * s), sfm);
            y += rowH;
        }
        if (!string.IsNullOrEmpty(why))
            using (Font wf = Ui.F("Medium", 12 * s)) using (SolidBrush wb = new SolidBrush(Ui.Sub))
            using (StringFormat sfm = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString(why, wf, wb, new RectangleF(r.X + pad, y + 2 * s, r.Width - pad * 2, 20 * s), sfm);
    }

    void DrawWaiting(Graphics g, float x, float bottom, float w, float s, bool running)
    {
        RectangleF r = new RectangleF(x, bottom - 46 * s, w, 46 * s);
        Ui.Fill(g, r, 12 * s, Color.FromArgb(235, 18, 26, 34), Color.FromArgb(235, 11, 17, 23));
        Ui.Stroke(g, r, 12 * s, Color.FromArgb(70, 80, 92), 1.2f * s);
        using (Font f = Ui.F("SemiBold", 13 * s)) using (SolidBrush t = new SolidBrush(Ui.Sub))
        using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            g.DrawString(running ? "AI 분석 중…" : "점수 없음", f, t, r, sf);
    }

    void DrawCard(Graphics g, Dictionary<string, object> c, float x, float bottom, float w, float s)
    {
        string grade = Ui.S(c, "grade") ?? "?";
        bool pick = Ui.B(c, "isPick");
        double score = Ui.N(c, "score", -1);
        string reason = Ui.S(c, "reason");
        string style = Ui.S(c, "style");
        ArrayList notes = Ui.A(c, "notes");
        string sticker = Ui.S(c, "sticker");
        string reroll = Ui.S(c, "rerollHint");

        // 높이 계산 (아래쪽을 카드 위 끝에 맞춤)
        float pad = 12 * s;
        float h = pad + 44 * s + 8 * s + 5 * s + 8 * s;          // 헤더 + 막대
        if (!string.IsNullOrEmpty(reason)) h += 20 * s;
        int callouts = (notes != null ? notes.Count : 0) + (sticker != null ? 1 : 0) + (reroll != null ? 1 : 0);
        h += callouts * 27 * s + pad - 4 * s;
        RectangleF r = new RectangleF(x, bottom - h, w, h);
        Color[] gc = Ui.GradeColors(grade);

        // 1순위: 금색 빛 번짐
        if (pick)
            for (int k = 3; k >= 1; k--)
                Ui.Stroke(g, new RectangleF(r.X - k * 2 * s, r.Y - k * 2 * s, r.Width + k * 4 * s, r.Height + k * 4 * s), (12 + k * 2) * s, Color.FromArgb(28 * (4 - k), Ui.Gold), 2 * s);
        Ui.Fill(g, r, 12 * s, Color.FromArgb(242, 22, 32, 42), Color.FromArgb(242, 11, 17, 23));
        Ui.Stroke(g, r, 12 * s, pick ? Ui.Gold : Color.FromArgb(48, 60, 72), pick ? 2.2f * s : 1.2f * s);

        // 등급 배지
        RectangleF badge = new RectangleF(r.X + pad, r.Y + pad, 44 * s, 44 * s);
        Ui.Fill(g, badge, 10 * s, gc[0], gc[1]);
        using (Font bf = Ui.F("ExtraBold", (grade.Length > 1 ? 21 : 25) * s)) using (SolidBrush wb = new SolidBrush(Color.White))
        using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            g.DrawString(grade, bf, wb, new RectangleF(badge.X, badge.Y + 1 * s, badge.Width, badge.Height), sf);

        // 점수
        float tx = badge.Right + 10 * s;
        using (Font big = Ui.F("ExtraBold", 27 * s)) using (Font small = Ui.F("Medium", 12 * s)) using (Font word = Ui.F("SemiBold", 12 * s))
        {
            string num = score >= 0 ? ((int)score).ToString() : "-";
            using (SolidBrush nb = new SolidBrush(gc[0])) g.DrawString(num, big, nb, tx - 2 * s, r.Y + pad - 4 * s);
            float nw = g.MeasureString(num, big).Width;
            using (SolidBrush sb = new SolidBrush(Ui.Sub)) g.DrawString("/100", small, sb, tx + nw - 8 * s, r.Y + pad + 13 * s);
            using (SolidBrush wb2 = new SolidBrush(Ui.Text)) g.DrawString(Ui.GradeWord(grade), word, wb2, tx, r.Y + pad + 30 * s);
        }

        // 빌드 방향 태그 (오른쪽 위) / 1순위 리본
        if (pick)
        {
            using (Font rf = Ui.F("ExtraBold", 11.5f * s))
            {
                string t = "1순위 추천";
                SizeF sz = g.MeasureString(t, rf);
                RectangleF rb = new RectangleF(r.X + r.Width / 2 - sz.Width / 2 - 10 * s, r.Y - sz.Height / 2 - 4 * s, sz.Width + 20 * s, sz.Height + 6 * s);
                Ui.Fill(g, rb, rb.Height, Ui.GoldLight, Ui.Gold);
                using (SolidBrush tb = new SolidBrush(Color.FromArgb(30, 26, 18))) g.DrawString(t, rf, tb, rb.X + 10 * s, rb.Y + 3 * s);
            }
        }
        if (!string.IsNullOrEmpty(style))
        {
            using (Font pf = Ui.F("SemiBold", 11 * s))
            {
                string t = "→ " + style;
                SizeF sz = g.MeasureString(t, pf);
                float maxW = r.Right - pad - (tx + 70 * s);
                if (sz.Width + 12 * s <= maxW)
                {
                    RectangleF pr = new RectangleF(r.Right - pad - sz.Width - 12 * s, r.Y + pad + 2 * s, sz.Width + 12 * s, sz.Height + 4 * s);
                    Ui.Fill(g, pr, pr.Height, Color.FromArgb(60, Ui.Gold), Color.FromArgb(40, Ui.Gold));
                    Ui.Stroke(g, pr, pr.Height, Color.FromArgb(170, Ui.Gold), 1f * s);
                    using (SolidBrush tb = new SolidBrush(Ui.GoldLight)) g.DrawString(t, pf, tb, pr.X + 6 * s, pr.Y + 2 * s);
                }
            }
        }

        // 진행 막대
        float by = r.Y + pad + 44 * s + 8 * s;
        RectangleF bar = new RectangleF(r.X + pad, by, r.Width - pad * 2, 5 * s);
        Ui.Fill(g, bar, bar.Height, Color.FromArgb(34, 44, 54), Color.FromArgb(28, 36, 44));
        if (score > 0)
        {
            RectangleF fill = new RectangleF(bar.X, bar.Y, Math.Max(bar.Height, bar.Width * (float)(score / 100.0)), bar.Height);
            using (GraphicsPath fp = Ui.Round(fill, bar.Height)) using (LinearGradientBrush lb = new LinearGradientBrush(fill, gc[1], gc[0], 0f)) g.FillPath(lb, fp);
        }

        // 이유
        float y = bar.Bottom + 8 * s;
        RectangleF inner = new RectangleF(r.X + pad, y, r.Width - pad * 2, 20 * s);
        if (!string.IsNullOrEmpty(reason))
        {
            using (Font rf = Ui.F("Medium", 13 * s)) using (SolidBrush rb = new SolidBrush(Color.FromArgb(214, 218, 224)))
            using (StringFormat sf = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString(reason, rf, rb, inner, sf);
            y += 20 * s;
        }
        // 강조 상자들
        y += 3 * s;
        if (notes != null) foreach (object n in notes) y = Callout(g, n.ToString(), inner, y, s, Ui.Green);
        if (sticker != null) y = Callout(g, "HEARTSTEEL · " + sticker, inner, y, s, Ui.Pink);
        if (reroll != null) y = Callout(g, reroll, inner, y, s, Ui.Amber);
    }
}

// ---------- 설정창 ----------
public class SettingsForm : Form
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
    readonly string exePath, version;
    readonly Timer refresh = new Timer();
    readonly Panel body = new Panel();
    readonly List<Button> tabs = new List<Button>();
    string tab = "game";
    Dictionary<string, object> st;
    bool building;
    // '이번 판' 탭: 실시간 화면(LiveView) + 아래 '다시 세팅' 입력줄. 게임이 시작되면 이 창이 보조 모니터에 뜹니다.
    readonly LiveView live = new LiveView();
    readonly Panel noteBar = new Panel();
    readonly Timer saveTimer = new Timer();
    bool loading = true;
    /// <summary>사용자가 X로 닫았는지 (닫았으면 이번 판에는 다시 띄우지 않음)</summary>
    public bool UserClosed;
    /// <summary>게임 시작 때 자동으로 열 때는 게임에서 포커스를 빼앗지 않음 (전체 화면 게임이 내려가는 것 방지)</summary>
    public bool NoActivate;
    protected override bool ShowWithoutActivation { get { return NoActivate; } }
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    /// <summary>
    /// 창 띄우기. 프로그램이 화면 프로세스를 '숨김'으로 실행해서(windowsHide), 윈도우가 이 프로세스의 첫 일반 창 표시를
    /// 숨김으로 바꿔 버립니다(창이 안 열리던 원인). 그래서 Show 뒤에 아직 안 보이면 한 번 더 직접 보이게 합니다.
    /// </summary>
    void ShowReally()
    {
        Show();
        if (IsHandleCreated && !IsWindowVisible(Handle)) ShowWindow(Handle, NoActivate ? 4 : 5); // SW_SHOWNOACTIVATE : SW_SHOW
    }

    public SettingsForm(string exe, string ver)
    {
        exePath = exe; version = ver;
        Text = "아수라장 코치";
        Icon = Ui.MakeIcon();
        BackColor = Ui.Bg; ForeColor = Ui.Text;
        // 크기 조절 가능: '이번 판' 실시간 화면은 창 너비에 맞춰 글씨·상자가 커집니다 (설정·연결 탭은 고정 너비).
        FormBorderStyle = FormBorderStyle.Sizable; MaximizeBox = true;
        float K = Ui.K;
        int wantH = (int)(900 * K), maxH = (int)(Screen.PrimaryScreen.WorkingArea.Height * 0.92);
        ClientSize = new Size((int)(440 * K), Math.Min(wantH, maxH));
        StartPosition = FormStartPosition.Manual; // 위치는 Place()가 정함 (저장된 위치 → 보조 모니터)
        Font = Ui.F("Medium", 14 * K);

        Panel head = new Panel { Dock = DockStyle.Top, Height = (int)(116 * K), BackColor = Ui.Bg };
        head.Paint += delegate (object o, PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.ScaleTransform(Ui.K, Ui.K);
            using (Icon ic = Ui.MakeIcon(Ui.K >= 1.5f ? 128 : 48)) using (Bitmap ib = ic.ToBitmap()) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(ib, new Rectangle(20, 16, 44, 44)); }
            using (Font f = Ui.F("ExtraBold", 22)) using (SolidBrush b = new SolidBrush(Ui.GoldLight)) g.DrawString("아수라장 코치", f, b, 70, 16);
            using (Font f = Ui.F("Medium", 12)) using (SolidBrush b = new SolidBrush(Ui.Sub)) g.DrawString("증강·아이템 AI 도우미  v" + version, f, b, 72, 44);
        };
        string[,] t = { { "game", "이번 판" }, { "settings", "설정" }, { "connect", "연결" } };
        for (int i = 0; i < 3; i++)
        {
            Button b = new Button { Text = t[i, 1], Tag = t[i, 0], Left = 20 + i * 136, Top = 70, Width = 128, Height = 36, FlatStyle = FlatStyle.Flat, Font = Ui.F("SemiBold", 14), Cursor = Cursors.Hand };
            b.FlatAppearance.BorderSize = 0;
            b.Click += delegate (object o, EventArgs e) { tab = (string)((Button)o).Tag; Rebuild(); };
            tabs.Add(b); head.Controls.Add(b); Ui.ScaleTree(b, K);
        }
        body.Dock = DockStyle.Fill; body.AutoScroll = true; body.Padding = new Padding(0); body.HorizontalScroll.Enabled = false; body.HorizontalScroll.Visible = false; body.BackColor = Ui.Bg;
        live.Dock = DockStyle.Fill;
        live.StatusChanged = delegate (Dictionary<string, object> s2) { bool top = Ui.B(Ui.D(s2, "settings"), "companionTopmost"); if (TopMost != top) TopMost = top; };
        BuildNoteBar(K);
        Controls.Add(body); Controls.Add(live); Controls.Add(noteBar); Controls.Add(head);
        Ui.DarkScroll(body);
        Ui.DarkScroll(live);
        // 위치·크기는 바꾼 뒤 1초 지나면 저장 (다음에 열 때 그 자리에)
        saveTimer.Interval = 1000; saveTimer.Tick += delegate { saveTimer.Stop(); SaveBounds(); };
        Move += delegate { if (!loading && Visible) { saveTimer.Stop(); saveTimer.Start(); } };
        Resize += delegate { if (!loading && Visible) { saveTimer.Stop(); saveTimer.Start(); } };
        Load += delegate
        {
            try { int on = 1; DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch { }
            MinimumSize = new Size(Width, (int)(320 * Ui.K));
            Rebuild();
            loading = false;
        };
        FormClosing += delegate (object o, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; UserClosed = true; Hide(); } };
    }

    /// <summary>'이번 판' 아래 '다시 세팅' 입력줄 (Enter = 보내기)</summary>
    void BuildNoteBar(float K)
    {
        noteBar.Dock = DockStyle.Bottom; noteBar.Height = (int)(64 * K); noteBar.BackColor = Color.FromArgb(14, 21, 28);
        noteBar.Paint += delegate (object o, PaintEventArgs e) { using (Pen p = new Pen(Ui.PanelLine, 1)) e.Graphics.DrawLine(p, 0, 0, noteBar.Width, 0); };
        noteBox = new TextBox
        {
            Left = (int)(16 * K), Top = (int)(16 * K), Width = (int)(260 * K), MaxLength = 500,
            BackColor = Color.FromArgb(24, 34, 44), ForeColor = Ui.Text, BorderStyle = BorderStyle.FixedSingle, Font = Ui.F("Medium", 14 * K),
        };
        Button go = new Button { Text = "다시 세팅", Width = (int)(110 * K), Height = (int)(32 * K), Top = (int)(15 * K), FlatStyle = FlatStyle.Flat, Font = Ui.F("SemiBold", 13 * K), Cursor = Cursors.Hand, UseCompatibleTextRendering = true };
        go.BackColor = Ui.Gold; go.ForeColor = Color.FromArgb(24, 22, 16); go.FlatAppearance.BorderColor = Ui.Gold;
        EventHandler send = delegate
        {
            Dictionary<string, object> body2 = new Dictionary<string, object>();
            body2["note"] = noteBox.Text.Trim();
            Dictionary<string, object> r = Ui.Post("/resetup", body2);
            if (r != null && !Ui.B(r, "ok")) MessageBox.Show(Ui.S(r, "message") ?? "다시 세팅하지 못했어요.", "아수라장 코치");
            else noteBox.Text = "";
        };
        go.Click += send;
        noteBox.KeyDown += delegate (object o, KeyEventArgs e) { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; send(o, EventArgs.Empty); } };
        new ToolTip().SetToolTip(noteBox, "AI에게 바랄 점을 적고 Enter (예: 방관템은 하나만, 탱템 위주로). 비워 두면 그냥 다시 분석해요.");
        noteBar.Controls.Add(noteBox); noteBar.Controls.Add(go);
        noteBar.Resize += delegate
        {
            go.Left = noteBar.ClientSize.Width - go.Width - (int)(16 * K);
            noteBox.Width = Math.Max((int)(80 * K), go.Left - noteBox.Left - (int)(8 * K));
        };
    }

    /// <summary>
    /// 창 위치 정하기. 직접 열 때(manual): 저장된 위치가 마우스가 있는 모니터면 그대로, 아니면 그 모니터에.
    /// 게임 시작 때 자동으로 열 때: 저장된 위치, 없으면 보조 모니터.
    /// </summary>
    public void Place(bool manual)
    {
        Screen here = Screen.FromPoint(Cursor.Position);
        string b = Ui.S(Ui.Get("/settings"), "companionBounds");
        if (!string.IsNullOrEmpty(b))
        {
            string[] p = b.Split(',');
            int x0, y0, w0, h0;
            if (p.Length == 4 && int.TryParse(p[0], out x0) && int.TryParse(p[1], out y0) && int.TryParse(p[2], out w0) && int.TryParse(p[3], out h0))
            {
                Rectangle r = new Rectangle(x0, y0, Math.Max(w0, MinimumSize.Width), h0);
                if (manual) { if (here.WorkingArea.IntersectsWith(r)) { Bounds = Clamp(r, here.WorkingArea); return; } }
                else foreach (Screen sc in Screen.AllScreens) if (sc.WorkingArea.IntersectsWith(r)) { Bounds = Clamp(r, sc.WorkingArea); return; }
            }
        }
        Screen target = Screen.PrimaryScreen;
        if (manual) target = here;
        else foreach (Screen sc in Screen.AllScreens) if (!sc.Primary) { target = sc; break; }
        FitTo(target);
    }
    /// <summary>창이 모니터 작업 영역 밖으로 나가거나 더 크지 않게</summary>
    static Rectangle Clamp(Rectangle r, Rectangle wa)
    {
        int w = Math.Min(r.Width, wa.Width), h = Math.Min(r.Height, wa.Height);
        int x = Math.Max(wa.Left, Math.Min(r.Left, wa.Right - w)), y = Math.Max(wa.Top, Math.Min(r.Top, wa.Bottom - h));
        return new Rectangle(x, y, w, h);
    }
    /// <summary>모니터 작업 영역에 맞춰 놓기 (보조 모니터면 거의 꽉 차게)</summary>
    void FitTo(Screen target)
    {
        Rectangle wa = target.WorkingArea;
        int w = target.Primary ? Math.Min(Width, wa.Width) : Math.Min(wa.Width - 20, Math.Max(MinimumSize.Width, (int)(620 * Ui.K)));
        int h = wa.Height - 20;
        Bounds = new Rectangle(target.Primary ? wa.Right - w - 10 : wa.Left + (wa.Width - w) / 2, wa.Top + 10, w, h);
    }
    /// <summary>설정의 '보조 모니터로 옮기기' 버튼</summary>
    public void MoveToSecondary()
    {
        foreach (Screen sc in Screen.AllScreens) if (!sc.Primary) { WindowState = FormWindowState.Normal; FitTo(sc); tab = "game"; Rebuild(); return; }
        MessageBox.Show("보조 모니터를 찾지 못했어요.", "아수라장 코치");
    }
    void SaveBounds()
    {
        if (WindowState != FormWindowState.Normal) return;
        Dictionary<string, object> p = new Dictionary<string, object>();
        p["companionBounds"] = Left + "," + Top + "," + Width + "," + Height;
        Ui.Post("/settings", p);
    }

    /// <summary>'이번 판' 실시간 화면으로 열기. auto=true 면 게임 포커스를 빼앗지 않고 띄웁니다.</summary>
    public void ShowLive(bool auto)
    {
        UserClosed = false;
        NoActivate = auto;
        tab = "game"; Rebuild();
        if (!Visible || !IsWindowVisible(Handle)) { Place(!auto); ShowReally(); }
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        if (!auto) BringFront();
    }
    public void ShowAny()
    {
        UserClosed = false; NoActivate = false;
        if (!Visible || !IsWindowVisible(Handle)) { Place(true); ShowReally(); }
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        BringFront();
    }
    /// <summary>프로그램을 켜면 바로 띄움: 저장된 위치, 없으면 보조 모니터 (게임 전에도 계속 켜 둠)</summary>
    public void ShowAtStart()
    {
        UserClosed = false; NoActivate = false;
        tab = "game";
        Place(false);
        ShowReally();
        BringFront();
    }
    void BringFront()
    {
        bool top = TopMost;
        TopMost = true; TopMost = top;
        Activate();
    }

    // ----- 작은 부품들 -----
    Panel Card(string title, int height)
    {
        Panel p = new Panel { Width = 392, Height = height, Margin = new Padding(0, 0, 0, 12), BackColor = Ui.Bg };
        p.Paint += delegate (object o, PaintEventArgs e)
        {
            Graphics g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.ScaleTransform(Ui.K, Ui.K);
            RectangleF r = new RectangleF(0.5f, 0.5f, p.Width / Ui.K - 1, p.Height / Ui.K - 1);
            Ui.Fill(g, r, 14, Color.FromArgb(20, 30, 40), Color.FromArgb(14, 21, 28));
            Ui.Stroke(g, r, 14, Ui.PanelLine, 1f);
            using (Font f = Ui.F("Bold", 15)) using (SolidBrush b = new SolidBrush(Ui.Gold)) g.DrawString(title, f, b, 16, 12);
        };
        return p;
    }
    Label Lbl(Control parent, string text, int x, int y, int w, int h, string weight, float px, Color c)
    {
        Label l = new Label { Text = text, Left = x, Top = y, Width = w, Height = h, Font = Ui.F(weight, px), ForeColor = c, BackColor = Color.Transparent, UseCompatibleTextRendering = true };
        parent.Controls.Add(l); return l;
    }
    Button Btn(Control parent, string text, int x, int y, int w, bool primary, EventHandler onClick)
    {
        Button b = new Button { Text = text, Left = x, Top = y, Width = w, Height = 36, FlatStyle = FlatStyle.Flat, Font = Ui.F("SemiBold", 13), Cursor = Cursors.Hand, UseCompatibleTextRendering = true };
        b.BackColor = primary ? Ui.Gold : Color.FromArgb(28, 40, 52);
        b.ForeColor = primary ? Color.FromArgb(24, 22, 16) : Ui.Text;
        b.FlatAppearance.BorderColor = primary ? Ui.Gold : Ui.PanelLine;
        b.Click += onClick;
        parent.Controls.Add(b); return b;
    }

    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    string lastStatus;

    string builtTab;
    TextBox noteBox;

    void Rebuild()
    {
        if (building) return;
        building = true;
        // 같은 탭을 새로 그릴 때는 스크롤 위치를 그대로 (1.5초마다 갱신되면서 맨 위로 튀던 문제)
        int keepY = builtTab == tab ? -body.AutoScrollPosition.Y : 0;
        builtTab = tab;
        lastStatus = Ui.GetRaw("/status");
        st = Ui.Parse(lastStatus);
        if (body.IsHandleCreated) SendMessage(body.Handle, 0x000B, IntPtr.Zero, IntPtr.Zero); // WM_SETREDRAW 끔 → 깜빡임 방지
        foreach (Button b in tabs)
        {
            bool on = (string)b.Tag == tab;
            b.BackColor = on ? Ui.Gold : Color.FromArgb(22, 32, 42);
            b.ForeColor = on ? Color.FromArgb(24, 22, 16) : Ui.Sub;
        }
        bool game = tab == "game" && st != null;
        live.Visible = game; noteBar.Visible = game; body.Visible = !game;
        if (game)
        {
            live.Invalidate();
            if (body.IsHandleCreated) SendMessage(body.Handle, 0x000B, (IntPtr)1, IntPtr.Zero);
            building = false;
            return;
        }
        body.SuspendLayout();
        body.AutoScrollPosition = Point.Empty; // 새 내용은 맨 위 기준으로 놓고, 아래에서 스크롤 위치를 되돌림
        body.Controls.Clear();
        FlowLayoutPanel flow = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, BackColor = Ui.Bg, Left = 18, Top = 8, Margin = new Padding(0) };
        if (st == null) { Panel c = Card("연결 안 됨", 80); Lbl(c, "프로그램 서버에 연결하지 못했어요.", 16, 42, 360, 24, "Medium", 13, Ui.Sub); flow.Controls.Add(c); }
        else if (tab == "settings") BuildSettings(flow);
        else BuildConnect(flow);
        Ui.ScaleTree(flow, Ui.K);
        body.Controls.Add(flow);
        body.ResumeLayout();
        body.PerformLayout();
        if (keepY > 0) body.AutoScrollPosition = new Point(0, keepY);
        if (body.IsHandleCreated) { SendMessage(body.Handle, 0x000B, (IntPtr)1, IntPtr.Zero); body.Invalidate(true); }
        building = false;
    }

    void BuildSettings(FlowLayoutPanel flow)
    {
        Dictionary<string, object> s = Ui.D(st, "settings");
        Dictionary<string, object> eng = Ui.D(st, "engines");
        Panel c1 = Card("AI 엔진", 138);
        Lbl(c1, "게임이 시작되면 이 AI가 이번 판 점수표를 만들어요.\n각자 PC에 로그인된 본인 계정을 써요.", 16, 40, 370, 40, "Regular", 12, Ui.Sub);
        ComboBox cb = new ComboBox { Left = 16, Top = 88, Width = 360, DropDownStyle = ComboBoxStyle.DropDownList, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(24, 34, 44), ForeColor = Ui.Text, Font = Ui.F("Medium", 14) };
        string[] keys = { "auto", "claude", "codex", "off" };
        string[] names = {
            "자동 (Claude Code → Codex)",
            "Claude Code" + (Ui.B(eng, "claude") ? "" : " (설치 안 됨)"),
            "Codex" + (Ui.B(eng, "codex") ? "" : " (설치 안 됨)"),
            "끄기 (채팅에서 '세팅')" };
        cb.Items.AddRange(names);
        cb.SelectedIndex = Math.Max(0, Array.IndexOf(keys, Ui.S(s, "aiEngine") ?? "auto"));
        cb.SelectedIndexChanged += delegate { Save("aiEngine", keys[cb.SelectedIndex]); };
        c1.Controls.Add(cb);
        flow.Controls.Add(c1);

        Panel c2 = Card("오버레이", 196);
        CheckBox on = Check(c2, "게임 위에 표시", 16, 42, Ui.B(s, "overlay"));
        on.CheckedChanged += delegate { Save("overlay", on.Checked); };
        Lbl(c2, "크기", 16, 80, 80, 22, "Medium", 13, Ui.Text);
        TrackBar sc = new TrackBar { Left = 90, Top = 74, Width = 282, Minimum = 70, Maximum = 150, TickFrequency = 10, Value = (int)Math.Round(Ui.N(s, "overlayScale", 1) * 100), BackColor = Color.FromArgb(17, 25, 33) };
        sc.MouseUp += delegate { Save("overlayScale", sc.Value / 100.0); };
        c2.Controls.Add(sc);
        Lbl(c2, "세로 위치", 16, 132, 80, 22, "Medium", 13, Ui.Text);
        TrackBar oy = new TrackBar { Left = 90, Top = 126, Width = 282, Minimum = -5, Maximum = 5, TickFrequency = 1, Value = (int)Math.Round(Ui.N(s, "overlayOffsetY", 0)), BackColor = Color.FromArgb(17, 25, 33) };
        oy.MouseUp += delegate { Save("overlayOffsetY", (double)oy.Value); };
        c2.Controls.Add(oy);
        flow.Controls.Add(c2);

        Panel cc = Card("보조 모니터에 띄우기", 196);
        Lbl(cc, "전체 화면으로 게임할 때 이 창의 '이번 판' 화면을 옆 모니터에 띄워 증강 점수와 아이템을 크게 봐요.", 16, 40, 370, 40, "Regular", 12, Ui.Sub);
        CheckBox ca = Check(cc, "게임이 시작되면 보조 모니터에 자동으로 열기", 16, 84, Ui.B(s, "companionAuto"));
        ca.CheckedChanged += delegate { Save("companionAuto", ca.Checked); };
        CheckBox ct = Check(cc, "항상 위에 표시", 16, 114, Ui.B(s, "companionTopmost"));
        ct.CheckedChanged += delegate { Save("companionTopmost", ct.Checked); };
        Btn(cc, "지금 보조 모니터로 옮기기", 16, 148, 360, true, delegate { MoveToSecondary(); });
        flow.Controls.Add(cc);

        Panel ctest = Card("게임 없이 테스트", 128);
        Lbl(ctest, "가짜 게임 창에 증강 카드를 띄워 화면 인식·오버레이·카드 클릭 기록·템 추천·다시 세팅을 실제처럼 확인해요.", 16, 40, 370, 40, "Regular", 12, Ui.Sub);
        Btn(ctest, "테스트 시작", 16, 84, 360, false, delegate { if (Ui.OpenTest != null) Ui.OpenTest(); });
        flow.Controls.Add(ctest);

        Panel c3 = Card("시작", 84);
        CheckBox au = Check(c3, "윈도우 시작 시 자동 실행", 16, 42, Ui.B(s, "autostart"));
        au.CheckedChanged += delegate { Save("autostart", au.Checked); };
        flow.Controls.Add(c3);

        Panel c4 = new Panel { Width = 392, Height = 44, BackColor = Ui.Bg };
        Btn(c4, "프로그램 제거", 0, 4, 392, false, delegate
        {
            if (MessageBox.Show("아수라장 코치를 제거할까요?\n설정과 기록도 함께 지워져요.", "아수라장 코치", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            { Ui.Post("/uninstall", null); Application.Exit(); }
        });
        flow.Controls.Add(c4);
    }

    CheckBox Check(Control parent, string text, int x, int y, bool value)
    {
        CheckBox c = new CheckBox { Text = text, Left = x, Top = y, Width = 360, Height = 26, Checked = value, Font = Ui.F("Medium", 14), ForeColor = Ui.Text, BackColor = Color.Transparent, FlatStyle = FlatStyle.Flat, UseCompatibleTextRendering = true };
        parent.Controls.Add(c); return c;
    }

    void Save(string key, object value)
    {
        Dictionary<string, object> patch = new Dictionary<string, object>();
        patch[key] = value;
        Ui.Post("/settings", patch);
    }

    void BuildConnect(FlowLayoutPanel flow)
    {
        string exe = exePath.Replace("\\", "\\\\");
        Panel c1 = Card("AI 채팅에 연결 (선택)", 236);
        Lbl(c1, "자동 세팅은 연결 없이도 돼요. 채팅에서 \"아칼리가 컸어, 다시 짜줘\"처럼 묻고 싶을 때 연결하세요.", 16, 42, 370, 44, "Regular", 12, Ui.Sub);
        Btn(c1, "Claude 데스크톱 설정 복사", 16, 92, 360, true, delegate
        {
            Clipboard.SetText("{\n  \"mcpServers\": {\n    \"aram\": { \"command\": \"" + exe + "\", \"args\": [\"--mcp\"] }\n  }\n}");
            MessageBox.Show("복사했어요.\n%APPDATA%\\Claude\\claude_desktop_config.json 에 붙여넣고 Claude를 다시 켜세요.", "아수라장 코치");
        });
        Btn(c1, "Claude Code 명령 복사", 16, 136, 360, false, delegate
        {
            Clipboard.SetText("claude mcp add aram -- \"" + exePath + "\" --mcp");
            MessageBox.Show("복사했어요. 터미널에 붙여넣어 실행하세요.", "아수라장 코치");
        });
        Btn(c1, "Codex 설정 복사", 16, 180, 360, false, delegate
        {
            Clipboard.SetText("[mcp_servers.aram]\ncommand = \"" + exe + "\"\nargs = [\"--mcp\"]");
            MessageBox.Show("복사했어요.\n~/.codex/config.toml 에 붙여넣으세요.", "아수라장 코치");
        });
        flow.Controls.Add(c1);

        Dictionary<string, object> up = Ui.D(st, "update");
        Panel c2 = Card("버전", 96);
        string upText = up != null && Ui.B(up, "newer") ? "새 버전 " + Ui.S(up, "latest") + " 이 있어요" : "최신 버전이에요";
        Lbl(c2, "v" + version + " · " + upText, 16, 42, 370, 22, "Medium", 13, up != null && Ui.B(up, "newer") ? Ui.Amber : Ui.Text);
        Lbl(c2, "글꼴: Pretendard (OFL)", 16, 66, 370, 20, "Regular", 11, Ui.Sub);
        flow.Controls.Add(c2);
    }
}

// ---------- 실시간 화면 (설정창 '이번 판' 탭) ----------
// 전체 화면으로 게임할 때 보조 모니터에 띄워 두는 메인 화면. 오버레이와 같은 내용(증강 점수, 아이템)을 글 대신
// 등급 상자·칩·아이콘 칸으로 크게 보여줍니다. /overlay(0.3초)·/status(약 2초)를 직접 받아 그립니다.
public class LiveView : Panel
{
    readonly Timer timer = new Timer();
    Dictionary<string, object> ov, st;
    string ovRaw, stRaw;
    int ticks;
    bool frozen;
    /// <summary>/status 가 바뀌면 알려줌 (창 '항상 위' 설정 반영용)</summary>
    public Action<Dictionary<string, object>> StatusChanged;

    public LiveView()
    {
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        BackColor = Ui.Bg;
        AutoScroll = true;
        Paint += delegate (object o, PaintEventArgs e) { PaintAll(e.Graphics); };
        Resize += delegate { Invalidate(); };
        Scroll += delegate { Invalidate(); };
        MouseWheel += delegate { Invalidate(); };
        timer.Interval = 300; timer.Tick += delegate { Poll(); }; timer.Start();
    }

    /// <summary>테스트/미리보기용: 정해 준 데이터로만 그림</summary>
    public void SetData(Dictionary<string, object> overlay, Dictionary<string, object> status) { ov = overlay; st = status; frozen = true; Invalidate(); }

    void Poll()
    {
        if (!Visible || frozen) return;
        bool changed = false;
        string r1 = Ui.GetRaw("/overlay");
        if (r1 != ovRaw) { ovRaw = r1; ov = Ui.Parse(r1); changed = true; Ui.Prefetch(ov); }
        if (ticks++ % 6 == 0 || st == null)
        {
            string r2 = Ui.GetRaw("/status");
            if (r2 != stRaw) { stRaw = r2; st = Ui.Parse(r2); changed = true; if (StatusChanged != null) StatusChanged(st); }
        }
        if (changed) Invalidate();
    }

    // ----- 그리기 부품 -----
    static void Text1(Graphics g, string t, string weight, float px, Color c, float x, float y, float w)
    {
        using (Font f = Ui.F(weight, px)) using (SolidBrush b = new SolidBrush(c))
        using (StringFormat sf = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
            g.DrawString(t ?? "", f, b, new RectangleF(x, y, Math.Max(1, w), px * 1.45f), sf);
    }
    static float Wrap(Graphics g, string t, string weight, float px, Color c, float x, float y, float w, int maxLines)
    {
        if (string.IsNullOrEmpty(t)) return y;
        using (Font f = Ui.F(weight, px)) using (SolidBrush b = new SolidBrush(c))
        using (StringFormat sf = new StringFormat { Trimming = StringTrimming.EllipsisWord })
        {
            SizeF sz = g.MeasureString(t, f, (int)w, sf);
            float h = Math.Min(sz.Height, px * 1.5f * maxLines);
            g.DrawString(t, f, b, new RectangleF(x, y, w, h + 2), sf);
            return y + h;
        }
    }
    static float TextW(Graphics g, string t, string weight, float px)
    {
        using (Font f = Ui.F(weight, px)) return g.MeasureString(t ?? "", f).Width;
    }
    /// <summary>제목 줄: 금색 글씨 + 오른쪽에 작은 설명</summary>
    static float Heading(Graphics g, string title, string note, float x, float y, float w, float s)
    {
        Text1(g, title, "Bold", 16 * s, Ui.Gold, x, y, w);
        if (!string.IsNullOrEmpty(note))
        {
            float tw = TextW(g, title, "Bold", 16 * s);
            Text1(g, note, "Medium", 12.5f * s, Ui.Sub, x + tw + 6 * s, y + 3 * s, w - tw - 6 * s);
        }
        return y + 28 * s;
    }
    /// <summary>둥근 상자 배경 (카드)</summary>
    static void CardBg(Graphics g, RectangleF r, float s, Color line)
    {
        Ui.Fill(g, r, 12 * s, Color.FromArgb(22, 32, 42), Color.FromArgb(14, 21, 28));
        Ui.Stroke(g, r, 12 * s, line, 1.2f * s);
    }
    /// <summary>알약 모양 칩. 너비를 돌려줌</summary>
    static float Pill(Graphics g, string t, float x, float y, float s, Color c, bool solid)
    {
        float w = TextW(g, t, "SemiBold", 13 * s) + 18 * s, h = 26 * s;
        RectangleF r = new RectangleF(x, y, w, h);
        if (solid) Ui.Fill(g, r, h, Color.FromArgb(60, c), Color.FromArgb(40, c));
        Ui.Stroke(g, r, h, Color.FromArgb(170, c), 1.2f * s);
        Text1(g, t, "SemiBold", 13 * s, c, x + 9 * s, y + 4 * s, w);
        return w;
    }
    /// <summary>한 줄 강조 상자 (지금 살 것, 경고 등)</summary>
    static float Box(Graphics g, string t, float x, float y, float w, float s, Color c)
    {
        RectangleF r = new RectangleF(x, y, w, 32 * s);
        Ui.Fill(g, r, 9 * s, Color.FromArgb(46, c), Color.FromArgb(28, c));
        Ui.Stroke(g, r, 9 * s, Color.FromArgb(170, c), 1.2f * s);
        Text1(g, t, "Bold", 14 * s, c, x + 12 * s, y + 7 * s, w - 20 * s);
        return y + 38 * s;
    }
    /// <summary>점수 → 등급 글자 (추천 목록 색칠용, 점수표 등급과 같은 기준이 아님)</summary>
    static string ScoreGrade(int score) { return score >= 95 ? "S+" : score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : "C"; }

    /// <summary>등급(또는 점수) 상자 + 이름 칩을 줄바꿈하며 놓습니다. 끝난 y를 돌려줌</summary>
    static float ChipFlow(Graphics g, List<string[]> chips, float x, float y, float w, float s, bool numbered)
    {
        float cx = x, rowH = 36 * s, gap = 8 * s;
        int n = 0;
        foreach (string[] c in chips)
        {
            n++;
            string name = c[0], badge = numbered ? n.ToString() : c[1];
            Color[] gc = numbered ? new Color[] { Ui.GoldLight, Ui.Gold } : Ui.GradeColors(c.Length > 2 ? c[2] : "?");
            float bw = Math.Max(30 * s, TextW(g, badge, "ExtraBold", 13 * s) + 12 * s);
            float nw = Math.Min(w - bw - 18 * s, TextW(g, name, "SemiBold", 14 * s) + 4 * s);
            float cw = bw + nw + 18 * s;
            if (cx > x && cx + cw > x + w) { cx = x; y += rowH + gap; }
            RectangleF r = new RectangleF(cx, y, cw, rowH);
            CardBg(g, r, s, Color.FromArgb(70, gc[0]));
            RectangleF br = new RectangleF(cx + 4 * s, y + 4 * s, bw, rowH - 8 * s);
            Ui.Fill(g, br, 8 * s, gc[0], gc[1]);
            using (Font bf = Ui.F("ExtraBold", 13 * s)) using (SolidBrush wb = new SolidBrush(numbered ? Color.FromArgb(30, 26, 18) : Color.White))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                g.DrawString(badge, bf, wb, br, sf);
            Text1(g, name, "SemiBold", 14 * s, Ui.Text, br.Right + 8 * s, y + 8 * s, nw + 4 * s);
            cx += cw + gap;
        }
        return chips.Count > 0 ? y + rowH : y;
    }

    void PaintAll(Graphics g)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.TranslateTransform(AutoScrollPosition.X, AutoScrollPosition.Y);
        // 스크롤바가 생겨도 글씨 크기가 바뀌지 않게 스크롤바 폭을 뺀 너비 기준
        float W = ClientSize.Width - (VerticalScroll.Visible ? 0 : SystemInformation.VerticalScrollBarWidth);
        float s = Math.Max(0.8f * Ui.K, Math.Min(1.7f * Ui.K, W / 420f));
        float pad = 16 * s, x = pad, w = W - pad * 2, y = 12 * s;

        Dictionary<string, object> setup = Ui.D(st, "setup");
        Dictionary<string, object> plan = Ui.D(st, "plan");
        bool inGame = Ui.B(st, "inGame");

        // 1) 상태 칩: 게임 · AI 세팅 · 이벤트
        string champ = Ui.S(st, "champion") ?? Ui.S(plan, "champion");
        string sState = Ui.S(setup, "state") ?? (st == null ? "연결 안 됨" : "대기");
        string step = Ui.S(setup, "step");
        float px0 = x;
        px0 += Pill(g, inGame ? "게임 중" + (champ != null ? " · " + champ : "") : "대기 중", px0, y, s, inGame ? Ui.Green : Ui.Sub, inGame) + 6 * s;
        Color sc = sState == "완료" ? Ui.Green : sState == "실패" || st == null ? Ui.Amber : sState == "진행 중" ? Ui.Gold : Ui.Sub;
        string engine = Ui.S(setup, "engine");
        string aiT = "AI " + sState + (string.IsNullOrEmpty(step) ? "" : " · " + step) + (engine != null ? " · " + engine : "");
        if (px0 + TextW(g, aiT, "SemiBold", 13 * s) + 18 * s > x + w) { px0 = x; y += 32 * s; }
        px0 += Pill(g, aiT, px0, y, s, sc, false) + 6 * s;
        string ev = Ui.S(st, "event");
        if (ev != null) { if (px0 + TextW(g, "이벤트 " + ev, "SemiBold", 13 * s) + 18 * s > x + w) { px0 = x; y += 32 * s; } Pill(g, "이벤트 " + ev, px0, y, s, Ui.Pink, false); }
        y += 32 * s;
        if (!inGame) { Text1(g, "게임이 시작되면 자동으로 분석해요", "Medium", 12.5f * s, Ui.Sub, x, y, w); y += 22 * s; }
        y += 8 * s;

        // 2) 증강 선택지 (뜰 때만, 맨 위에 크게)
        ArrayList cards = Ui.B(ov, "show") ? Ui.A(ov, "cards") : null;
        if (cards != null && cards.Count > 0)
        {
            y = Heading(g, "지금 증강 선택", "점수 높은 순 · 금테 = 1순위", x, y, w, s);
            bool hasPlan = Ui.B(ov, "hasPlan");
            if (!hasPlan) y = Box(g, Ui.S(ov, "setupState") == "진행 중" ? "AI가 분석 중이에요 · 잠시 후 점수가 떠요" : "점수표가 없어요 · 아래 '다시 세팅'", x, y, w, s, Ui.Amber);
            foreach (object o in cards) y = DrawCardRow(g, o as Dictionary<string, object>, x, y, w, s, hasPlan) + 8 * s;
            y += 8 * s;
        }

        // 3) 아이템
        Dictionary<string, object> it = Ui.D(ov, "items") ?? Ui.D(st, "items");
        ArrayList next = Ui.A(it, "build") ?? Ui.A(it, "next");
        if (next != null && next.Count > 0) y = DrawItems(g, it, next, x, y, w, s) + 14 * s;
        else if (plan != null) y = DrawPlannedBuild(g, Ui.D(plan, "build"), x, y, w, s, inGame) + 14 * s;

        // 4) 고른 증강
        ArrayList picks = Ui.A(st, "picks");
        y = Heading(g, "고른 증강", picks != null && picks.Count > 0 ? picks.Count + "개" : null, x, y, w, s);
        if (picks != null && picks.Count > 0)
        {
            List<string[]> pc = new List<string[]>();
            foreach (object p in picks) pc.Add(new string[] { p.ToString(), "" });
            y = ChipFlow(g, pc, x, y, w, s, true) + 14 * s;
        }
        else { Text1(g, "아직 없어요 · 카드를 누르면 자동으로 기록돼요", "Medium", 13 * s, Ui.Sub, x, y, w); y += 30 * s; }

        // 5) 추천 증강 TOP (점수표 상위)
        ArrayList top = Ui.A(plan, "top");
        if (top != null && top.Count > 0)
        {
            y = Heading(g, "추천 증강", "이번 판 점수표 상위", x, y, w, s);
            List<string[]> tc = new List<string[]>();
            foreach (object o in top)
            {
                string t = o.ToString();
                int score = -1, at = t.LastIndexOf(" (");
                if (at > 0 && t.EndsWith(")") && int.TryParse(t.Substring(at + 2, t.Length - at - 3), out score)) t = t.Substring(0, at);
                tc.Add(new string[] { t, score >= 0 ? score.ToString() : "?", score >= 0 ? ScoreGrade(score) : "?" });
            }
            y = ChipFlow(g, tc, x, y, w, s, false) + 14 * s;
        }

        // 6) 이번 판 전략
        if (plan != null && !string.IsNullOrEmpty(Ui.S(plan, "strategy")))
        {
            y = Heading(g, "이번 판 전략", Ui.S(plan, "source"), x, y, w, s);
            using (Font f = Ui.F("Medium", 14 * s))
            using (StringFormat sf = new StringFormat())
            {
                float th = g.MeasureString(Ui.S(plan, "strategy"), f, (int)(w - 28 * s), sf).Height;
                RectangleF r = new RectangleF(x, y, w, th + 26 * s);
                CardBg(g, r, s, Ui.PanelLine);
                using (SolidBrush b = new SolidBrush(Color.FromArgb(214, 218, 224))) g.DrawString(Ui.S(plan, "strategy"), f, b, new RectangleF(x + 14 * s, y + 12 * s, w - 28 * s, th + 4), sf);
                y = r.Bottom + 10 * s;
            }
        }
        string msg = Ui.S(setup, "message");
        if (!string.IsNullOrEmpty(msg)) y = Wrap(g, msg, "Regular", 12 * s, Ui.Sub, x, y, w, 2) + 6 * s;

        y += pad;
        int total = (int)(y - AutoScrollPosition.Y);
        if (Math.Abs(AutoScrollMinSize.Height - total) > 4) AutoScrollMinSize = new Size(0, total);
    }

    /// <summary>게임 중 아이템: 지금 살 것 상자, 보유 아이콘 칸, 다음 아이템 상자들</summary>
    float DrawItems(Graphics g, Dictionary<string, object> it, ArrayList next, float x, float y, float w, float s)
    {
        int haveN = 0; foreach (object o in next) if (Ui.B(o as Dictionary<string, object>, "have")) haveN++;
        double gold = Ui.N(it, "gold", 0);
        y = Heading(g, "아이템 " + haveN + "/6", "보유 " + ((int)gold).ToString("N0") + " G" + (Ui.B(it, "busy") ? " · AI 다시 고르는 중…" : Ui.S(it, "source") != null ? " · " + Ui.S(it, "source") : ""), x, y, w, s);
        if (Ui.B(it, "dead"))
        {
            double rs = Ui.N(it, "respawnIn", 0);
            y = Box(g, "지금 상점에서 사세요" + (rs > 0 ? " · 부활 " + ((int)rs) + "초" : ""), x, y, w, s, Ui.Amber);
        }
        bool full = Ui.B(it, "full");
        string buyT = full ? "6칸 완성 · 더 살 아이템 없어요" : Ui.BuyText(it);
        if (!string.IsNullOrEmpty(buyT)) y = Box(g, buyT, x, y, w, s, full || Ui.B(Ui.D(it, "buy"), "affordable") ? Ui.Green : Ui.Amber);

        // 빌드 6칸: 아이콘 칸을 한 줄로 (산 것은 초록 테두리·체크, 다음 것은 금테)
        int slots = Math.Min(6, next.Count);
        float gap = 8 * s, tile = Math.Min(64 * s, (w - gap * (slots - 1)) / Math.Max(1, slots));
        int firstBuy = -1;
        for (int j = 0; j < next.Count; j++) if (!Ui.B(next[j] as Dictionary<string, object>, "have")) { firstBuy = j; break; }
        for (int j = 0; j < slots; j++)
        {
            Dictionary<string, object> o = next[j] as Dictionary<string, object>;
            RectangleF r = new RectangleF(x + j * (tile + gap), y, tile, tile);
            Image im = Ui.IconFor(Ui.S(o, "icon"));
            bool have = Ui.B(o, "have");
            Ui.Fill(g, r, 8 * s, Color.FromArgb(34, 46, 58), Color.FromArgb(24, 32, 40));
            if (im != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; using (GraphicsPath p = Ui.Round(r, 8 * s)) { g.SetClip(p, CombineMode.Intersect); g.DrawImage(im, r); g.ResetClip(); } }
            if (have)
            {
                using (SolidBrush dim = new SolidBrush(Color.FromArgb(110, 0, 0, 0))) using (GraphicsPath p = Ui.Round(r, 8 * s)) g.FillPath(dim, p);
                Text1(g, "✓", "ExtraBold", 18 * s, Ui.Green, r.X + r.Width / 2 - 7 * s, r.Y + r.Height / 2 - 13 * s, 30 * s);
            }
            Ui.Stroke(g, r, 8 * s, have ? Color.FromArgb(160, Ui.Green) : j == firstBuy ? Ui.Gold : Color.FromArgb(70, 84, 98), (j == firstBuy ? 2.4f : 1.2f) * s);
            RectangleF nb = new RectangleF(r.X + 3 * s, r.Y + 3 * s, 18 * s, 18 * s);
            Ui.Fill(g, nb, 9 * s, Color.FromArgb(220, 10, 14, 18), Color.FromArgb(220, 10, 14, 18));
            using (Font nf = Ui.F("Bold", 11 * s)) using (SolidBrush tb = new SolidBrush(Ui.GoldLight))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                g.DrawString((j + 1).ToString(), nf, tb, nb, sf);
        }
        y += tile + 10 * s;

        // 앞으로 살 아이템: 상자 한 줄씩 (아이콘 · 이름 · 남은 골드)
        int k = 0;
        foreach (object oo in next)
        {
            Dictionary<string, object> o = oo as Dictionary<string, object>;
            if (Ui.B(o, "have")) continue;
            bool first = k == 0;
            float h = (first ? 64 : 54) * s;
            RectangleF r = new RectangleF(x, y, w, h);
            CardBg(g, r, s, first ? Ui.Gold : Color.FromArgb(44, 56, 68));
            if (first) Ui.Stroke(g, r, 12 * s, Ui.Gold, 2f * s);
            float isz = h - 16 * s;
            RectangleF ic = new RectangleF(x + 8 * s, y + 8 * s, isz, isz);
            Image im = Ui.IconFor(Ui.S(o, "icon"));
            if (im != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(im, ic); }
            else Ui.Fill(g, ic, 6 * s, Color.FromArgb(40, 52, 64), Color.FromArgb(30, 40, 50));
            float tx = ic.Right + 12 * s;
            string label = (first ? "다음  " : (k + 1) + ".  ") + Ui.S(o, "name");
            Text1(g, label, first ? "Bold" : "SemiBold", (first ? 17 : 15) * s, first ? Ui.GoldLight : Ui.Text, tx, y + (first ? 9 : 7) * s, x + w - tx - 10 * s);
            string rt = Ui.RemainText(o, gold, first);
            if (!string.IsNullOrEmpty(rt)) Text1(g, rt, "Medium", 13 * s, Ui.RemainColor(o, gold, first), tx, y + (first ? 35 : 30) * s, x + w - tx - 10 * s);
            y = r.Bottom + 6 * s;
            k++;
            if (k >= 4) break;
        }
        string why = Ui.S(it, "why");
        if (!string.IsNullOrEmpty(why)) y = Wrap(g, why, "Regular", 12.5f * s, Ui.Sub, x, y + 2 * s, w, 2);
        return y;
    }

    /// <summary>게임 전·아이템 정보가 오기 전: AI가 짠 핵심 빌드를 번호 칩으로</summary>
    float DrawPlannedBuild(Graphics g, Dictionary<string, object> build, float x, float y, float w, float s, bool inGame)
    {
        ArrayList core = Ui.A(build, "core");
        if (core == null || core.Count == 0) return y;
        y = Heading(g, "추천 빌드", inGame ? "게임 정보가 오면 아이콘·남은 골드가 떠요" : "AI가 짠 순서", x, y, w, s);
        List<string[]> cc = new List<string[]>();
        foreach (object o in core) cc.Add(new string[] { o.ToString(), "" });
        y = ChipFlow(g, cc, x, y, w, s, true) + 8 * s;
        ArrayList sit = Ui.A(build, "situational");
        if (sit != null)
            foreach (object o in sit)
            {
                Dictionary<string, object> d = o as Dictionary<string, object>;
                if (d == null) continue;
                RectangleF r = new RectangleF(x, y, w, 30 * s);
                Ui.Fill(g, r, 8 * s, Color.FromArgb(30, Ui.Amber), Color.FromArgb(18, Ui.Amber));
                Ui.Stroke(g, r, 8 * s, Color.FromArgb(110, Ui.Amber), 1f * s);
                float lw = Math.Min(w * 0.55f, TextW(g, Ui.S(d, "when"), "Medium", 12.5f * s) + 6 * s);
                Text1(g, Ui.S(d, "when"), "Medium", 12.5f * s, Ui.Sub, x + 10 * s, y + 6 * s, lw);
                Text1(g, "→ " + Ui.S(d, "item"), "Bold", 13.5f * s, Ui.Amber, x + 16 * s + lw, y + 5 * s, w - lw - 26 * s);
                y += 36 * s;
            }
        return y;
    }

    float DrawCardRow(Graphics g, Dictionary<string, object> c, float x, float y, float w, float s, bool hasPlan)
    {
        string grade = hasPlan ? (Ui.S(c, "grade") ?? "?") : "?";
        bool pick = Ui.B(c, "isPick");
        double score = Ui.N(c, "score", -1);
        string reason = Ui.S(c, "reason"), style = Ui.S(c, "style"), sticker = Ui.S(c, "sticker"), reroll = Ui.S(c, "rerollHint");
        ArrayList notes = Ui.A(c, "notes");
        float pad = 12 * s;
        int extra = (notes != null ? notes.Count : 0) + (sticker != null ? 1 : 0) + (reroll != null ? 1 : 0);
        float h = pad + 52 * s + 8 * s + 6 * s + 8 * s + (string.IsNullOrEmpty(reason) ? 0 : 24 * s) + extra * 38 * s + pad - 8 * s;
        RectangleF r = new RectangleF(x, y, w, h);
        Color[] gc = Ui.GradeColors(grade);
        Ui.Fill(g, r, 12 * s, Color.FromArgb(24, 34, 44), Color.FromArgb(12, 18, 24));
        Ui.Stroke(g, r, 12 * s, pick ? Ui.Gold : Color.FromArgb(60, gc[0]), pick ? 2.6f * s : 1.4f * s);
        RectangleF badge = new RectangleF(r.X + pad, r.Y + pad, 52 * s, 52 * s);
        Ui.Fill(g, badge, 10 * s, gc[0], gc[1]);
        using (Font bf = Ui.F("ExtraBold", (grade.Length > 1 ? 22 : 27) * s)) using (SolidBrush wb = new SolidBrush(Color.White))
        using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            g.DrawString(grade, bf, wb, new RectangleF(badge.X, badge.Y + 1 * s, badge.Width, badge.Height), sf);
        float tx = badge.Right + 12 * s, tw = r.Right - pad - tx;
        string slot = Ui.S(c, "slot");
        float nameX = tx;
        if (pick)
        {
            using (Font rf = Ui.F("ExtraBold", 12 * s))
            {
                SizeF sz = g.MeasureString("1순위", rf);
                RectangleF rb = new RectangleF(tx, r.Y + pad + 2 * s, sz.Width + 12 * s, sz.Height + 4 * s);
                Ui.Fill(g, rb, rb.Height, Ui.GoldLight, Ui.Gold);
                using (SolidBrush tb = new SolidBrush(Color.FromArgb(30, 26, 18))) g.DrawString("1순위", rf, tb, rb.X + 6 * s, rb.Y + 2 * s);
                nameX = rb.Right + 8 * s;
            }
        }
        Text1(g, Ui.S(c, "name"), "Bold", 19 * s, Ui.Text, nameX, r.Y + pad - 2 * s, r.Right - pad - nameX);
        string meta = (score >= 0 && hasPlan ? ((int)score) + "점 · " + Ui.GradeWord(grade) : "점수 없음") + (slot != null ? "  ·  " + slot : "") + (!string.IsNullOrEmpty(style) ? "  ·  → " + style : "");
        Text1(g, meta, "SemiBold", 13.5f * s, hasPlan ? gc[0] : Ui.Sub, tx, r.Y + pad + 29 * s, tw);
        float by = r.Y + pad + 52 * s + 8 * s;
        RectangleF bar = new RectangleF(r.X + pad, by, r.Width - pad * 2, 6 * s);
        Ui.Fill(g, bar, bar.Height, Color.FromArgb(34, 44, 54), Color.FromArgb(28, 36, 44));
        if (score > 0 && hasPlan)
        {
            RectangleF fill = new RectangleF(bar.X, bar.Y, Math.Max(bar.Height, bar.Width * (float)(score / 100.0)), bar.Height);
            using (GraphicsPath fp = Ui.Round(fill, bar.Height)) using (LinearGradientBrush lb = new LinearGradientBrush(fill, gc[1], gc[0], 0f)) g.FillPath(lb, fp);
        }
        float yy = bar.Bottom + 8 * s;
        if (!string.IsNullOrEmpty(reason)) { Text1(g, reason, "Medium", 14 * s, Color.FromArgb(220, 224, 230), r.X + pad, yy, r.Width - pad * 2); yy += 24 * s; }
        if (notes != null) foreach (object n in notes) yy = Box(g, n.ToString(), r.X + pad, yy, r.Width - pad * 2, s, Ui.Green);
        if (sticker != null) yy = Box(g, "HEARTSTEEL · " + sticker, r.X + pad, yy, r.Width - pad * 2, s, Ui.Pink);
        if (reroll != null) yy = Box(g, reroll, r.X + pad, yy, r.Width - pad * 2, s, Ui.Amber);
        return r.Bottom;
    }
}

// ---------- 게임 없이 테스트: 가짜 게임 창 ----------
// 실제 증강 선택 화면과 같은 위치·비율로 카드를 그립니다. 화면 감시(OCR)·오버레이·클릭 기록은 이 창을 롤 게임으로 보고 그대로 동작합니다.
// 아래쪽 조작줄(세로 87% 아래)은 화면 감시가 읽지 않는 영역이라 인식에 섞이지 않습니다.
public class TestGameForm : Form
{
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    static readonly float[] CardX = { 0.307f, 0.5f, 0.692f };
    const float CardHalfW = 0.083f, CardTop = 0.18f, CardBottom = 0.665f;
    readonly Timer poll = new Timer();
    Dictionary<string, object> st, status;
    string lastRaw, lastStatusRaw;
    int statusTick;
    readonly List<KeyValuePair<RectangleF, Action>> buttons = new List<KeyValuePair<RectangleF, Action>>();
    string toast; DateTime toastAt;

    public TestGameForm()
    {
        Text = Ui.TestTitle;
        Icon = Ui.MakeIcon();
        FormBorderStyle = FormBorderStyle.None; // 실제 게임(테두리 없음)처럼: 창 전체가 게임 화면
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        BackColor = Color.Black;
        Rectangle wa = Screen.PrimaryScreen.WorkingArea;
        int w = Math.Min(1600, (int)(wa.Width * 0.85)), h = w * 9 / 16;
        if (h > wa.Height * 0.88) { h = (int)(wa.Height * 0.88); w = h * 16 / 9; }
        Bounds = new Rectangle(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2, w, h);
        poll.Interval = 300; poll.Tick += delegate { Poll(); }; poll.Start();
        MouseDown += OnDown;
        FormClosed += delegate { poll.Stop(); Ui.Post("/test/action?do=end", null); };
        // 다른 창(브라우저 등) 뒤에 열리지 않게 처음 한 번 맨 앞으로 (화면 감시·오버레이는 맨 앞 창만 게임으로 봄)
        Shown += delegate { TopMost = true; Activate(); BringToFront(); TopMost = false; Activate(); };
        Poll();
    }

    void Act(string what, string arg, string msg)
    {
        Ui.Post("/test/action?do=" + what + (arg != null ? "&arg=" + Uri.EscapeDataString(arg) : ""), null);
        if (msg != null) { toast = msg; toastAt = DateTime.Now; }
        lastRaw = null; Poll();
    }

    void Poll()
    {
        string raw = Ui.GetRaw("/test/state");
        bool changed = raw != lastRaw;
        if (changed) { lastRaw = raw; st = Ui.Parse(raw); }
        if (statusTick++ % 5 == 0)
        {
            string sr = Ui.GetRaw("/status");
            if (sr != lastStatusRaw) { lastStatusRaw = sr; status = Ui.Parse(sr); changed = true; }
        }
        if (toast != null && (DateTime.Now - toastAt).TotalSeconds > 5) { toast = null; changed = true; }
        if (changed) Invalidate();
    }

    RectangleF CardRect(int i)
    {
        float W = ClientSize.Width, H = ClientSize.Height;
        return new RectangleF((CardX[i] - CardHalfW) * W, CardTop * H, CardHalfW * 2 * W, (CardBottom - CardTop) * H);
    }
    RectangleF RerollRect(int i)
    {
        float W = ClientSize.Width, H = ClientSize.Height;
        return new RectangleF(CardX[i] * W - 0.0175f * W, 0.69f * H, 0.035f * W, 0.035f * H);
    }

    void OnDown(object o, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        foreach (KeyValuePair<RectangleF, Action> b in buttons) if (b.Key.Contains(e.Location)) { b.Value(); return; }
        bool cards = st != null && Ui.B(st, "showCards");
        ArrayList names = Ui.A(st, "cards");
        if (cards && names != null)
        {
            for (int i = 0; i < names.Count && i < 3; i++)
            {
                if (RerollRect(i).Contains(e.Location)) { Act("reroll", i.ToString(), null); return; }
                if (CardRect(i).Contains(e.Location))
                {
                    // 실제 게임처럼 카드를 누르면 잠시 뒤 선택 화면이 닫힘 → 2.5초쯤 뒤 '고른 증강 기록됨'이 떠야 정상
                    string picked = names[i].ToString();
                    Timer t = new Timer { Interval = 500 };
                    t.Tick += delegate { t.Stop(); t.Dispose(); Act("hide", null, "고름: " + picked + " → 잠시 뒤 위쪽에 '고른 증강 기록됨'이 떠야 정상"); };
                    t.Start();
                    return;
                }
            }
        }
        // 맨 위 띠를 끌면 창 이동
        if (e.Y < ClientSize.Height * 0.06f) { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        float W = ClientSize.Width, H = ClientSize.Height;
        using (LinearGradientBrush bg = new LinearGradientBrush(new RectangleF(0, 0, W, H), Color.FromArgb(34, 30, 70), Color.FromArgb(14, 22, 40), 90f)) g.FillRectangle(bg, 0, 0, W, H);
        // 위쪽 안내 (증강 이름은 쓰지 않음: 화면 감시가 읽는 영역)
        using (Font f = Ui.F("SemiBold", H * 0.018f)) using (SolidBrush b = new SolidBrush(Color.FromArgb(200, 200, 210)))
            g.DrawString("테스트 모드 · 이 띠를 끌면 창 이동 · 카드를 눌러 고르기 · Tab 누르고 있으면 템 패널", f, b, W * 0.012f, H * 0.012f);

        buttons.Clear();
        if (st != null && Ui.B(st, "showCards")) DrawCards(g, W, H);
        DrawBar(g, W, H);
    }

    void DrawCards(Graphics g, float W, float H)
    {
        ArrayList info = Ui.A(st, "cardInfo");
        if (info == null) return;
        for (int i = 0; i < info.Count && i < 3; i++)
        {
            Dictionary<string, object> c = info[i] as Dictionary<string, object>;
            RectangleF r = CardRect(i);
            Ui.Fill(g, r, W * 0.008f, Color.FromArgb(214, 190, 140), Color.FromArgb(150, 120, 70));
            RectangleF inner = RectangleF.Inflate(r, -W * 0.006f, -W * 0.006f);
            Ui.Fill(g, inner, W * 0.006f, Color.FromArgb(18, 28, 32), Color.FromArgb(10, 18, 22));
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                // 이름: 실제 카드처럼 세로 41% 근처, 흰 굵은 글씨
                using (Font f = Ui.F("Bold", H * 0.021f)) using (SolidBrush b = new SolidBrush(Color.White))
                    g.DrawString(Ui.S(c, "name"), f, b, new RectangleF(r.X, H * 0.395f, r.Width, H * 0.03f), sf);
                ArrayList tags = Ui.A(c, "tags");
                if (tags != null && tags.Count > 0)
                    using (Font f = Ui.F("Medium", H * 0.012f)) using (SolidBrush b = new SolidBrush(Color.FromArgb(170, 170, 170)))
                        g.DrawString(string.Join("  ", tags.ToArray()), f, b, new RectangleF(r.X, H * 0.428f, r.Width, H * 0.02f), sf);
            }
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center })
            using (Font f = Ui.F("Medium", H * 0.0135f)) using (SolidBrush b = new SolidBrush(Color.FromArgb(225, 225, 225)))
                g.DrawString(Ui.S(c, "desc") ?? "", f, b, new RectangleF(r.X + W * 0.012f, H * 0.465f, r.Width - W * 0.024f, H * 0.15f), sf);
            RectangleF rr = RerollRect(i);
            Ui.Fill(g, rr, 4, Color.FromArgb(150, 110, 50), Color.FromArgb(110, 80, 35));
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            using (Font f = Ui.F("Bold", H * 0.02f)) using (SolidBrush b = new SolidBrush(Color.White))
                g.DrawString("↻", f, b, rr, sf);
        }
    }

    void DrawBar(Graphics g, float W, float H)
    {
        // 조작줄: 세로 87% 아래 (화면 감시가 읽지 않는 영역)
        RectangleF bar = new RectangleF(0, H * 0.87f, W, H * 0.13f);
        using (SolidBrush b = new SolidBrush(Color.FromArgb(235, 8, 12, 18))) g.FillRectangle(b, bar);
        Dictionary<string, object> setup = Ui.D(status, "setup");
        ArrayList picks = Ui.A(status, "picks");
        ArrayList its = Ui.A(st, "items");
        string line = "골드 " + ((int)Ui.N(st, "gold", 0)).ToString("N0") + (Ui.B(st, "dead") ? " · 죽음" : " · 살아 있음") + " · 아이템 " + (its != null ? its.Count : 0) + "칸"
            + " · AI 세팅: " + (Ui.S(setup, "state") ?? "-") + (string.IsNullOrEmpty(Ui.S(setup, "step")) ? "" : " (" + Ui.S(setup, "step") + ")")
            + " · 고른 증강: " + (picks != null && picks.Count > 0 ? string.Join(", ", picks.ToArray()) : "없음");
        using (Font f = Ui.F("Medium", H * 0.017f)) using (SolidBrush b = new SolidBrush(toast != null ? Ui.Green : Ui.Text))
        using (StringFormat sf = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
            g.DrawString(toast ?? line, f, b, new RectangleF(W * 0.012f, H * 0.882f, W * 0.976f, H * 0.03f), sf);

        string[] labels = { "새 증강 선택지", "죽기 / 부활", "골드 +1000", "도미닉 경의 인사 사기", "필멸자의 운명 사기", "아이템 비우기", "테스트 끝내기" };
        Action[] acts = {
            delegate { Act("offer", null, "새 선택지를 띄웠어요"); },
            delegate { Act("dead", null, null); },
            delegate { Act("gold", "1000", null); },
            delegate { Act("buy", "3036", "도미닉 경의 인사 구매 → 템 추천에서 필멸자·세릴다가 빠져야 정상"); },
            delegate { Act("buy", "3033", "필멸자의 운명 구매"); },
            delegate { Act("clearItems", null, null); },
            delegate { Close(); },
        };
        float gap = W * 0.008f, bw = (W * 0.976f - gap * (labels.Length - 1)) / labels.Length, bh = H * 0.05f, by = H * 0.93f;
        for (int i = 0; i < labels.Length; i++)
        {
            RectangleF r = new RectangleF(W * 0.012f + i * (bw + gap), by, bw, bh);
            bool last = i == labels.Length - 1;
            Ui.Fill(g, r, 6, last ? Color.FromArgb(120, 50, 50) : Color.FromArgb(40, 56, 72), last ? Color.FromArgb(90, 36, 36) : Color.FromArgb(28, 40, 52));
            Ui.Stroke(g, r, 6, Ui.PanelLine, 1f);
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            using (Font f = Ui.F("SemiBold", H * 0.016f)) using (SolidBrush b = new SolidBrush(Ui.Text))
                g.DrawString(labels[i], f, b, r, sf);
            buttons.Add(new KeyValuePair<RectangleF, Action>(r, acts[i]));
        }
    }
}

// ---------- 트레이 (프로그램 모드) ----------
public class TrayApp : ApplicationContext
{
    readonly NotifyIcon icon = new NotifyIcon();
    readonly AramOverlay overlay;
    readonly SettingsForm settings;
    TestGameForm testForm;
    string companionOpenedFor = "";
    readonly Timer status = new Timer();
    readonly ToolStripMenuItem statusItem = new ToolStripMenuItem("상태 확인 중…") { Enabled = false };
    readonly ToolStripMenuItem overlayItem = new ToolStripMenuItem("오버레이 표시") { Checked = true };
    string lastSetup = "";

    public TrayApp(AramOverlay ov, string exePath, string version)
    {
        overlay = ov;
        settings = new SettingsForm(exePath, version);
        Ui.OpenCompanion = delegate { ShowCompanion(); };
        Ui.OpenTest = delegate
        {
            Dictionary<string, object> r = Ui.Post("/test/action?do=start", null);
            if (r == null || !Ui.B(r, "ok")) { MessageBox.Show(Ui.S(r, "message") ?? "테스트를 시작하지 못했어요.", "아수라장 코치"); return; }
            if (testForm == null || testForm.IsDisposed) testForm = new TestGameForm();
            testForm.Show(); testForm.Activate();
        };
        icon.Icon = Ui.MakeIcon();
        icon.Text = "아수라장 코치";
        ContextMenuStrip m = new ContextMenuStrip();
        m.Font = Ui.F("Medium", 13 * Ui.K);
        m.Items.Add(statusItem);
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("이번 판 화면 열기", null, delegate { ShowCompanion(); });
        m.Items.Add("설정 열기", null, delegate { ShowSettings(); });
        overlayItem.Click += delegate { overlayItem.Checked = !overlayItem.Checked; overlay.UserHidden = !overlayItem.Checked; };
        m.Items.Add(overlayItem);
        m.Items.Add("다시 세팅 (AI 다시 분석)", null, delegate { Ui.Post("/resetup", null); });
        m.Items.Add("게임 없이 테스트", null, delegate { Ui.OpenTest(); });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("종료", null, delegate { Ui.Post("/quit", null); icon.Visible = false; Application.Exit(); });
        icon.ContextMenuStrip = m;
        icon.DoubleClick += delegate { ShowCompanion(); };
        icon.Visible = true;
        icon.ShowBalloonTip(3000, "아수라장 코치", "실행 중이에요. 게임이 시작되면 자동으로 분석해요.", ToolTipIcon.Info);
        overlay.Show();
        // 게임 전에도 메인 창을 계속 띄워 둠 (닫으면 트레이로 숨고, 트레이 아이콘 더블클릭으로 다시 열기)
        try { settings.ShowAtStart(); } catch (Exception e) { Ui.Log("메인 창 열기 실패: " + e); }
        status.Interval = 3000; status.Tick += delegate { UpdateStatus(); }; status.Start();
    }

    public void ShowCompanion() { ShowCompanion(false); }
    /// <summary>보조 창 열기. auto=true 면 게임 포커스를 빼앗지 않고 띄웁니다.</summary>
    public void ShowCompanion(bool auto)
    {
        try { settings.ShowLive(auto); }
        catch (Exception e) { Ui.Log("이번 판 화면 열기 실패: " + e); }
    }

    void ShowSettings() { settings.ShowAny(); }

    void UpdateStatus()
    {
        Dictionary<string, object> st = Ui.Get("/status");
        if (st == null) { statusItem.Text = "프로그램 서버 연결 안 됨"; return; }
        // 게임이 시작되면 보조 창 자동으로 열기 (설정에서 켠 경우, 판마다 한 번)
        string gk = Ui.S(st, "gameKey") ?? "";
        if (Ui.B(st, "inGame") && Ui.B(Ui.D(st, "settings"), "companionAuto"))
        {
            if (gk != companionOpenedFor) { companionOpenedFor = gk; ShowCompanion(true); }
            // 게임 중인데 창이 사라졌으면(사용자가 닫은 게 아니면) 다시 띄움
            else if (!settings.Visible && !settings.UserClosed) { Ui.Log("이번 판 화면이 숨겨져 있어 다시 띄움"); ShowCompanion(true); }
        }
        Dictionary<string, object> setup = Ui.D(st, "setup");
        string s = (Ui.B(st, "inGame") ? "게임 중" : "대기 중") + " · AI 세팅: " + (Ui.S(setup, "state") ?? "대기");
        statusItem.Text = s;
        icon.Text = s.Length > 63 ? s.Substring(0, 63) : s;
        string key = Ui.S(setup, "state") + "|" + Ui.S(setup, "gameKey");
        if (key != lastSetup)
        {
            if (Ui.S(setup, "state") == "완료") icon.ShowBalloonTip(3000, "AI 세팅 완료", Ui.S(setup, "message") ?? "", ToolTipIcon.Info);
            if (Ui.S(setup, "state") == "실패") icon.ShowBalloonTip(4000, "AI 세팅 실패", Ui.S(setup, "message") ?? "", ToolTipIcon.Warning);
            lastSetup = key;
        }
    }
}
