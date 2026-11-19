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
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    readonly string processName;
    readonly Timer poll = new Timer(), mouse = new Timer();
    Dictionary<string, object> data;
    Rectangle game = Rectangle.Empty;
    bool wasDown, tabDown;
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
        mouse.Interval = 30; mouse.Tick += delegate { CheckClick(); }; mouse.Start();
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
        uint pid; GetWindowThreadProcessId(h, out pid);
        try { if (Process.GetProcessById((int)pid).ProcessName != processName) return false; }
        catch { return false; }
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
            if (!Visible) { Show(); dirty = true; }
            if (dirty) { Invalidate(); dirty = false; }
        }
        else if (Visible) Hide();
    }

    void CheckClick()
    {
        bool tab = (GetAsyncKeyState(0x09) & 0x8000) != 0;
        if (tab != tabDown) { tabDown = tab; dirty = true; }
        bool down = (GetAsyncKeyState(0x01) & 0x8000) != 0;
        // 클릭 기록은 창이 안 보여도(전체 화면) 게임이 앞에 있고 선택지가 떠 있으면 동작
        if (down && !wasDown && data != null && Ui.B(data, "show") && FindGame())
        {
            POINT p; GetCursorPos(out p);
            if (game.Contains(p.X, p.Y))
            {
                double rx = (p.X - game.Left) / (double)game.Width, ry = (p.Y - game.Top) / (double)game.Height;
                if (ry > 0.17 && ry < 0.66)
                    Ui.Post("/click?x=" + rx.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture), null);
            }
        }
        wasDown = down;
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
        Dictionary<string, object> it = Ui.D(data, "items");
        ArrayList next = Ui.A(it, "next");
        double gold = Ui.N(it, "gold", 0);
        bool dead = Ui.B(it, "dead");
        string now = Ui.S(it, "now"), why = Ui.S(it, "why"), src = Ui.S(it, "source");
        float pad = 14 * s, rowH = 52 * s;
        float w = Math.Min(W * 0.2f, 380 * s);
        float h = pad + 26 * s + (dead ? 24 * s : 0) + next.Count * rowH + (string.IsNullOrEmpty(now) ? 0 : 30 * s) + (string.IsNullOrEmpty(why) ? 0 : 24 * s) + pad;
        RectangleF r = new RectangleF(W - w - W * 0.012f, H * 0.2f, w, h);
        Ui.Fill(g, r, 14 * s, Color.FromArgb(240, 22, 32, 42), Color.FromArgb(240, 11, 17, 23));
        Ui.Stroke(g, r, 14 * s, Ui.Gold, 1.6f * s);
        float y = r.Y + pad;
        using (Font hf = Ui.F("Bold", 16 * s)) using (SolidBrush hb = new SolidBrush(Ui.GoldLight)) g.DrawString("다음 아이템", hf, hb, r.X + pad, y - 2 * s);
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
        for (int i = 0; i < next.Count; i++)
        {
            Dictionary<string, object> o = next[i] as Dictionary<string, object>;
            string url = Ui.S(o, "icon");
            RectangleF ic = new RectangleF(r.X + pad, y + 4 * s, 42 * s, 42 * s);
            Image im; if (url != null && icons.TryGetValue(url, out im) && im != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(im, ic); }
            else Ui.Fill(g, ic, 6 * s, Color.FromArgb(40, 52, 64), Color.FromArgb(30, 40, 50));
            Ui.Stroke(g, ic, 6 * s, i == 0 ? Ui.Gold : Color.FromArgb(70, 84, 98), (i == 0 ? 2f : 1f) * s);
            float tx = ic.Right + 10 * s;
            using (Font nf = Ui.F(i == 0 ? "Bold" : "SemiBold", (i == 0 ? 15 : 14) * s)) using (SolidBrush nb = new SolidBrush(i == 0 ? Ui.Text : Color.FromArgb(200, 206, 214)))
            using (StringFormat sfm = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString((i + 1) + ". " + Ui.S(o, "name"), nf, nb, new RectangleF(tx, y + 4 * s, r.Right - pad - tx, 22 * s), sfm);
            double price = Ui.N(o, "gold", -1);
            if (price > 0)
                using (Font pf = Ui.F("Medium", 12 * s))
                {
                    bool ok = gold >= price;
                    string t = ((int)price).ToString("N0") + " G" + (ok ? " · 살 수 있어요" : " · " + ((int)(price - gold)).ToString("N0") + " 부족");
                    using (SolidBrush pb = new SolidBrush(ok ? Ui.Green : Ui.Sub)) g.DrawString(t, pf, pb, tx, y + 27 * s);
                }
            y += rowH;
        }
        RectangleF inner = new RectangleF(r.X + pad, y, r.Width - pad * 2, 22 * s);
        if (!string.IsNullOrEmpty(now)) { y = Callout(g, "지금: " + now, inner, y, s, Ui.Green); }
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

    public SettingsForm(string exe, string ver)
    {
        exePath = exe; version = ver;
        Text = "아수라장 코치";
        Icon = Ui.MakeIcon();
        BackColor = Ui.Bg; ForeColor = Ui.Text;
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        float K = Ui.K;
        int wantH = (int)(700 * K), maxH = (int)(Screen.PrimaryScreen.WorkingArea.Height * 0.92);
        ClientSize = new Size((int)(440 * K), Math.Min(wantH, maxH));
        StartPosition = FormStartPosition.CenterScreen;
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
        Controls.Add(body); Controls.Add(head);
        refresh.Interval = 1500; refresh.Tick += delegate { if (tab == "game" && Visible) { string raw = Ui.GetRaw("/status"); if (raw != lastStatus) Rebuild(); } }; refresh.Start();
        Load += delegate { try { int on = 1; DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch { } Rebuild(); };
        FormClosing += delegate (object o, FormClosingEventArgs e) { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
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

    void Rebuild()
    {
        if (building) return;
        building = true;
        lastStatus = Ui.GetRaw("/status");
        st = Ui.Parse(lastStatus);
        if (body.IsHandleCreated) SendMessage(body.Handle, 0x000B, IntPtr.Zero, IntPtr.Zero); // WM_SETREDRAW 끔 → 깜빡임 방지
        foreach (Button b in tabs)
        {
            bool on = (string)b.Tag == tab;
            b.BackColor = on ? Ui.Gold : Color.FromArgb(22, 32, 42);
            b.ForeColor = on ? Color.FromArgb(24, 22, 16) : Ui.Sub;
        }
        body.SuspendLayout();
        body.Controls.Clear();
        FlowLayoutPanel flow = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, BackColor = Ui.Bg, Left = 18, Top = 8, Margin = new Padding(0) };
        if (st == null) { Panel c = Card("연결 안 됨", 80); Lbl(c, "프로그램 서버에 연결하지 못했어요.", 16, 42, 360, 24, "Medium", 13, Ui.Sub); flow.Controls.Add(c); }
        else if (tab == "game") BuildGame(flow);
        else if (tab == "settings") BuildSettings(flow);
        else BuildConnect(flow);
        Ui.ScaleTree(flow, Ui.K);
        body.Controls.Add(flow);
        body.ResumeLayout();
        if (body.IsHandleCreated) { SendMessage(body.Handle, 0x000B, (IntPtr)1, IntPtr.Zero); body.Invalidate(true); }
        building = false;
    }

    void BuildGame(FlowLayoutPanel flow)
    {
        Dictionary<string, object> setup = Ui.D(st, "setup");
        Dictionary<string, object> plan = Ui.D(st, "plan");
        bool inGame = Ui.B(st, "inGame");

        Panel c1 = Card("상태", 118);
        Lbl(c1, inGame ? "게임 중" + (Ui.S(st, "champion") != null ? " · " + Ui.S(st, "champion") : "") : "대기 중 (게임이 시작되면 자동으로 분석해요)", 16, 42, 370, 22, "SemiBold", 14, inGame ? Ui.Green : Ui.Text);
        string sState = Ui.S(setup, "state") ?? "대기";
        string step = Ui.S(setup, "step");
        Lbl(c1, "AI 세팅: " + sState + (Ui.S(setup, "engine") != null ? " · " + Ui.S(setup, "engine") : "") + (!string.IsNullOrEmpty(step) ? " · " + step : ""), 16, 68, 370, 20, "Medium", 13, sState == "완료" ? Ui.Green : sState == "실패" ? Ui.Amber : Ui.Sub);
        Lbl(c1, Ui.S(setup, "message") ?? "", 16, 90, 370, 36, "Regular", 12, Ui.Sub);
        flow.Controls.Add(c1);

        if (plan != null)
        {
            Panel c2 = Card("이번 판 전략 · " + (Ui.S(plan, "source") ?? ""), 200);
            Lbl(c2, Ui.S(plan, "strategy") ?? "", 16, 42, 370, 96, "Medium", 13, Ui.Text);
            ArrayList top = Ui.A(plan, "top");
            if (top != null) Lbl(c2, "상위: " + string.Join(", ", top.ToArray()), 16, 142, 370, 50, "Regular", 12, Ui.Sub);
            flow.Controls.Add(c2);
        }
        Dictionary<string, object> iv = Ui.D(st, "items");
        ArrayList nx = Ui.A(iv, "next");
        if (nx != null && nx.Count > 0)
        {
            List<string> names = new List<string>();
            foreach (object o in nx) { Dictionary<string, object> d = o as Dictionary<string, object>; double p = Ui.N(d, "gold", -1); names.Add(Ui.S(d, "name") + (p > 0 ? " (" + ((int)p).ToString("N0") + "G)" : "")); }
            Panel ci = Card("다음 아이템 · " + (Ui.S(iv, "source") ?? ""), 126);
            Lbl(ci, string.Join("  →  ", names.ToArray()), 16, 42, 370, 40, "SemiBold", 13, Ui.Text);
            string nowT = Ui.S(iv, "now"), whyT = Ui.S(iv, "why");
            Lbl(ci, (string.IsNullOrEmpty(nowT) ? "" : "지금: " + nowT + "   ") + (whyT ?? ""), 16, 84, 370, 36, "Regular", 12, Ui.Sub);
            flow.Controls.Add(ci);
        }
        ArrayList picks = Ui.A(st, "picks");
        ArrayList offer = Ui.A(st, "offer");
        Panel c3 = Card("증강", 116);
        Lbl(c3, "고른 증강: " + (picks != null && picks.Count > 0 ? string.Join(", ", picks.ToArray()) : "아직 없음"), 16, 42, 370, 36, "Medium", 13, Ui.Text);
        Lbl(c3, "지금 선택지: " + (offer != null && offer.Count > 0 ? string.Join(" / ", offer.ToArray()) : "없음"), 16, 78, 370, 34, "Regular", 12, Ui.Sub);
        flow.Controls.Add(c3);
        Panel c4 = new Panel { Width = 392, Height = 44, BackColor = Ui.Bg };
        Btn(c4, "다시 세팅 (AI 다시 분석)", 0, 4, 392, true, delegate { Ui.Post("/resetup", null); Rebuild(); });
        flow.Controls.Add(c4);
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

// ---------- 트레이 (프로그램 모드) ----------
public class TrayApp : ApplicationContext
{
    readonly NotifyIcon icon = new NotifyIcon();
    readonly AramOverlay overlay;
    readonly SettingsForm settings;
    readonly Timer status = new Timer();
    readonly ToolStripMenuItem statusItem = new ToolStripMenuItem("상태 확인 중…") { Enabled = false };
    readonly ToolStripMenuItem overlayItem = new ToolStripMenuItem("오버레이 표시") { Checked = true };
    string lastSetup = "";

    public TrayApp(AramOverlay ov, string exePath, string version)
    {
        overlay = ov;
        settings = new SettingsForm(exePath, version);
        icon.Icon = Ui.MakeIcon();
        icon.Text = "아수라장 코치";
        ContextMenuStrip m = new ContextMenuStrip();
        m.Font = Ui.F("Medium", 13 * Ui.K);
        m.Items.Add(statusItem);
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("설정 열기", null, delegate { ShowSettings(); });
        overlayItem.Click += delegate { overlayItem.Checked = !overlayItem.Checked; overlay.UserHidden = !overlayItem.Checked; };
        m.Items.Add(overlayItem);
        m.Items.Add("다시 세팅 (AI 다시 분석)", null, delegate { Ui.Post("/resetup", null); });
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add("종료", null, delegate { Ui.Post("/quit", null); icon.Visible = false; Application.Exit(); });
        icon.ContextMenuStrip = m;
        icon.DoubleClick += delegate { ShowSettings(); };
        icon.Visible = true;
        icon.ShowBalloonTip(3000, "아수라장 코치", "실행 중이에요. 게임이 시작되면 자동으로 분석해요.", ToolTipIcon.Info);
        overlay.Show();
        status.Interval = 3000; status.Tick += delegate { UpdateStatus(); }; status.Start();
    }

    void ShowSettings() { settings.Show(); settings.WindowState = FormWindowState.Normal; settings.Activate(); }

    void UpdateStatus()
    {
        Dictionary<string, object> st = Ui.Get("/status");
        if (st == null) { statusItem.Text = "프로그램 서버 연결 안 됨"; return; }
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
