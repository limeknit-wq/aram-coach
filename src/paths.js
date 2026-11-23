// 리소스 파일 위치.
// - 개발(node src/...): 프로젝트 폴더의 파일을 그대로 씁니다.
// - 단독 프로그램(AramCoach.exe, Node SEA): exe 안에 넣어 둔 파일을 %LOCALAPPDATA%\AramCoach\res\<버전> 에 풀어서 씁니다.
//   PowerShell 스크립트(화면 감시·오버레이)는 디스크에 있어야 실행되기 때문입니다.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_VERSION = "0.4.14";

// exe 안에 넣는 파일 목록 (빌드 스크립트도 이 목록을 씁니다)
export const ASSETS = [
  "src/watcher.ps1", "src/capture.cs", "src/overlay.ps1", "src/overlay.cs",
  "src/ui/coach.html", "data/augments.json", "data/events.json", "vendor/app-with-deps.js",
  "assets/fonts/Pretendard-Regular.ttf", "assets/fonts/Pretendard-Medium.ttf", "assets/fonts/Pretendard-SemiBold.ttf",
  "assets/fonts/Pretendard-Bold.ttf", "assets/fonts/Pretendard-ExtraBold.ttf", "assets/fonts/OFL.txt",
  "assets/icon.ico",
];

const req = createRequire(import.meta.url);
let sea = null;
try { const s = req("node:sea"); if (s.isSea()) sea = s; } catch {}
export const IS_EXE = Boolean(sea);

const DEV_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APP_DIR = join(process.env.LOCALAPPDATA || process.env.APPDATA || ".", "AramCoach");
// 빌드마다 고유 번호 (esbuild define). 같은 버전이라도 다시 빌드하면 새 폴더에 풀어 바뀐 파일이 반영됩니다.
/* global __BUILD_ID__ */
export const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
const RES_NAME = `${APP_VERSION}-${BUILD_ID}`;
const RES_ROOT = IS_EXE ? join(APP_DIR, "res", RES_NAME) : DEV_ROOT;

/** 리소스 파일의 실제 경로 */
export function resPath(rel) {
  if (!IS_EXE && rel === "vendor/app-with-deps.js") return req.resolve("@modelcontextprotocol/ext-apps/app-with-deps");
  return join(RES_ROOT, ...rel.split("/"));
}

/** 이 프로그램을 MCP 서버로 실행하는 명령 (AI CLI에 연결할 때 사용) */
export function selfMcpCommand() {
  if (IS_EXE) return { command: process.execPath, args: ["--mcp"] };
  return { command: process.execPath, args: [join(DEV_ROOT, "src", "main.js"), "--mcp"] };
}

let ready = null;
/** exe 실행이면 내장 파일을 디스크에 풀어 둡니다 (버전별 폴더라 업데이트 시 새로 풀림). */
export function ensureResources() {
  if (!IS_EXE) return Promise.resolve();
  ready ||= (async () => {
    for (const rel of ASSETS) {
      const out = resPath(rel);
      if (existsSync(out)) continue;
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(sea.getAsset(rel)));
    }
    // 예전 빌드가 풀어 둔 폴더 정리 (실행 중인 다른 버전이 쓰고 있으면 지워지지 않아도 무시)
    for (const d of await readdir(join(APP_DIR, "res")).catch(() => [])) {
      if (d !== RES_NAME) await rm(join(APP_DIR, "res", d), { recursive: true, force: true }).catch(() => {});
    }
  })();
  return ready;
}
