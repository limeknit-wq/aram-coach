// DXGI Desktop Duplication 으로 모니터 화면을 캡처합니다 (OBS '디스플레이 캡처'와 같은 방식).
// GDI(CopyFromScreen)는 전체 화면 게임에서 검은 화면이 나올 수 있어 이 방식을 먼저 씁니다.
// 복제 세션은 계속 유지하고, 새 화면 프레임이 올 때마다 마지막 화면을 갱신해 둡니다.
// C# 5 문법만 사용 (Windows PowerShell 5.1 Add-Type 호환).
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class DesktopDup
{
    [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);
    [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags,
        IntPtr featureLevels, uint numLevels, uint sdkVersion, out IntPtr device, out int level, out IntPtr context);

    static Guid IID_Factory1 = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    static Guid IID_Output1 = new Guid("00cddea8-939b-4b83-a340-a685226666cc");
    static Guid IID_Tex2D = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QIFn(IntPtr self, ref Guid iid, out IntPtr obj);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint ReleaseFn(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumFn(IntPtr self, uint i, out IntPtr obj);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDescFn(IntPtr self, IntPtr desc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DuplicateFn(IntPtr self, IntPtr device, out IntPtr dup);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AcquireFn(IntPtr self, uint timeout, IntPtr info, out IntPtr resource);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ReleaseFrameFn(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void TexDescFn(IntPtr self, IntPtr desc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateTexFn(IntPtr self, IntPtr desc, IntPtr init, out IntPtr tex);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void CopyFn(IntPtr self, IntPtr dst, IntPtr src);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int MapFn(IntPtr self, IntPtr res, uint sub, uint type, uint flags, IntPtr mapped);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void UnmapFn(IntPtr self, IntPtr res, uint sub);

    static T Fn<T>(IntPtr obj, int index) where T : class
    {
        IntPtr vtbl = Marshal.ReadIntPtr(obj);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vtbl, index * IntPtr.Size), typeof(T)) as T;
    }
    static void Rel(ref IntPtr p) { if (p != IntPtr.Zero) { Fn<ReleaseFn>(p, 2)(p); p = IntPtr.Zero; } }
    static void Check(int hr, string what) { if (hr < 0) throw new Exception(what + " 실패 0x" + hr.ToString("X8")); }

    // 유지되는 상태
    static IntPtr device, context, dup, staging;
    static Rectangle monitor = Rectangle.Empty;
    static Bitmap last;            // 마지막으로 받은 실제 화면
    public static string LastFormat = "";

    public static void Reset()
    {
        Rel(ref staging); Rel(ref dup); Rel(ref context); Rel(ref device);
        monitor = Rectangle.Empty;
        if (last != null) { last.Dispose(); last = null; }
    }

    static void Open(int x, int y)
    {
        Reset();
        IntPtr factory = IntPtr.Zero, adapter = IntPtr.Zero, output = IntPtr.Zero, output1 = IntPtr.Zero;
        IntPtr buf = Marshal.AllocHGlobal(128);
        try
        {
            Check(CreateDXGIFactory1(ref IID_Factory1, out factory), "DXGI 팩토리");
            bool found = false;
            for (uint a = 0; !found; a++)
            {
                if (Fn<EnumFn>(factory, 7)(factory, a, out adapter) < 0) break;
                for (uint o = 0; ; o++)
                {
                    if (Fn<EnumFn>(adapter, 7)(adapter, o, out output) < 0) { output = IntPtr.Zero; break; }
                    Check(Fn<GetDescFn>(output, 7)(output, buf), "출력 정보");
                    // DXGI_OUTPUT_DESC: WCHAR[32] DeviceName(64바이트) 다음 RECT DesktopCoordinates
                    int l = Marshal.ReadInt32(buf, 64), t = Marshal.ReadInt32(buf, 68), r = Marshal.ReadInt32(buf, 72), b = Marshal.ReadInt32(buf, 76);
                    if (x >= l && x < r && y >= t && y < b) { monitor = Rectangle.FromLTRB(l, t, r, b); found = true; break; }
                    Rel(ref output);
                }
                if (!found) Rel(ref adapter);
            }
            if (!found) throw new Exception("해당 위치의 모니터를 찾지 못함");
            int level;
            Check(D3D11CreateDevice(adapter, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, 7, out device, out level, out context), "D3D11 장치");
            Check(Fn<QIFn>(output, 0)(output, ref IID_Output1, out output1), "IDXGIOutput1");
            Check(Fn<DuplicateFn>(output1, 22)(output1, device, out dup), "DuplicateOutput");
        }
        catch { Reset(); throw; }
        finally
        {
            Rel(ref output1); Rel(ref output); Rel(ref adapter); Rel(ref factory);
            Marshal.FreeHGlobal(buf);
        }
    }

    // 새 프레임을 받아 last 를 갱신. 새 화면이 왔으면 true.
    static bool Pump(uint timeoutMs)
    {
        IntPtr info = Marshal.AllocHGlobal(64), resource = IntPtr.Zero, tex = IntPtr.Zero;
        bool acquired = false;
        try
        {
            int hr = Fn<AcquireFn>(dup, 8)(dup, timeoutMs, info, out resource);
            if (hr == unchecked((int)0x887A0027)) return false; // WAIT_TIMEOUT: 화면 변화 없음
            Check(hr, "AcquireNextFrame");
            acquired = true;
            long lastPresent = Marshal.ReadInt64(info, 0);
            if (lastPresent == 0) return false; // 마우스만 움직임, 화면 이미지 없음
            Check(Fn<QIFn>(resource, 0)(resource, ref IID_Tex2D, out tex), "프레임 텍스처");
            IntPtr desc = Marshal.AllocHGlobal(64);
            try
            {
                Fn<TexDescFn>(tex, 10)(tex, desc);
                int w = Marshal.ReadInt32(desc, 0), h = Marshal.ReadInt32(desc, 4), fmt = Marshal.ReadInt32(desc, 16);
                LastFormat = fmt.ToString();
                if (fmt != 87 && fmt != 91) throw new Exception("지원하지 않는 화면 형식 " + fmt + " (HDR 켜짐?)");
                if (staging == IntPtr.Zero)
                {
                    Marshal.WriteInt32(desc, 8, 1); Marshal.WriteInt32(desc, 12, 1);       // Mip, Array
                    Marshal.WriteInt32(desc, 20, 1); Marshal.WriteInt32(desc, 24, 0);      // Sample
                    Marshal.WriteInt32(desc, 28, 3);                                         // STAGING
                    Marshal.WriteInt32(desc, 32, 0); Marshal.WriteInt32(desc, 36, 0x20000); // Bind, CPU READ
                    Marshal.WriteInt32(desc, 40, 0);
                    Check(Fn<CreateTexFn>(device, 5)(device, desc, IntPtr.Zero, out staging), "스테이징 텍스처");
                }
                Fn<CopyFn>(context, 47)(context, staging, tex);
                IntPtr mapped = Marshal.AllocHGlobal(32);
                try
                {
                    Check(Fn<MapFn>(context, 14)(context, staging, 0, 1, 0, mapped), "Map");
                    try
                    {
                        IntPtr data = Marshal.ReadIntPtr(mapped, 0);
                        int pitch = Marshal.ReadInt32(mapped, IntPtr.Size);
                        if (last == null || last.Width != w || last.Height != h)
                        {
                            if (last != null) last.Dispose();
                            last = new Bitmap(w, h, PixelFormat.Format32bppRgb);
                        }
                        BitmapData bd = last.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
                        byte[] row = new byte[w * 4];
                        for (int yy = 0; yy < h; yy++)
                        {
                            Marshal.Copy(new IntPtr(data.ToInt64() + (long)yy * pitch), row, 0, row.Length);
                            Marshal.Copy(row, 0, new IntPtr(bd.Scan0.ToInt64() + (long)yy * bd.Stride), row.Length);
                        }
                        last.UnlockBits(bd);
                    }
                    finally { Fn<UnmapFn>(context, 15)(context, staging, 0); }
                }
                finally { Marshal.FreeHGlobal(mapped); }
            }
            finally { Marshal.FreeHGlobal(desc); }
            return true;
        }
        finally
        {
            Rel(ref tex); Rel(ref resource);
            if (acquired) Fn<ReleaseFrameFn>(dup, 14)(dup);
            Marshal.FreeHGlobal(info);
        }
    }

    /// <summary>창 영역을 캡처: Desktop Duplication 우선, 실패하면 GDI. method 에 사용한 방식을 돌려줍니다.</summary>
    public static Bitmap CaptureRect(Rectangle rect, out string method)
    {
        try
        {
            int cx = rect.Left + rect.Width / 2, cy = rect.Top + rect.Height / 2;
            if (dup == IntPtr.Zero || !monitor.Contains(cx, cy)) Open(cx, cy);
            try
            {
                // 쌓인 프레임을 비우며 최신 화면으로. 처음엔 실제 화면이 올 때까지 최대 약 1.5초 대기.
                int waited = 0;
                while (Pump(last == null ? 100u : 0u) || (last == null && (waited += 100) < 1500)) { }
            }
            catch (Exception)
            {
                // 전체 화면 전환 등으로 세션이 끊김(ACCESS_LOST) → 다시 열고 한 번 더
                Open(cx, cy);
                int waited = 0;
                while (Pump(100u) == false && (waited += 100) < 1500) { }
            }
            if (last == null) throw new Exception("화면 프레임을 받지 못함");
            Rectangle crop = Rectangle.Intersect(new Rectangle(rect.Left - monitor.Left, rect.Top - monitor.Top, rect.Width, rect.Height),
                                                 new Rectangle(0, 0, last.Width, last.Height));
            method = "dxgi";
            return last.Clone(crop, PixelFormat.Format32bppRgb);
        }
        catch (Exception e)
        {
            method = "gdi (" + e.Message + ")";
            Bitmap bmp = new Bitmap(rect.Width, rect.Height);
            using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(rect.Left, rect.Top, 0, 0, rect.Size);
            return bmp;
        }
    }
}
