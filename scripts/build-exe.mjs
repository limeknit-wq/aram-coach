// 단일 실행 파일 만들기: npm run build:exe → dist/AramCoach.exe
// Node 내장 SEA(Single Executable Application) 사용. 결과물만 있으면 Node 설치 없이 실행됩니다.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION, ASSETS } from "../src/paths.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const require = createRequire(import.meta.url);
const step = (m) => console.log(`▶ ${m}`);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1) 아이콘: assets/icon.ico (scripts/make-icon.ps1 로 생성, 16~256px)
const icoPath = join(ROOT, "assets", "icon.ico");

// 2) 코드를 하나의 CJS 파일로 묶기 (SEA는 CommonJS 진입만 지원)
step("코드 묶기 (esbuild)");
await build({
  entryPoints: [join(ROOT, "src/main.js")],
  bundle: true, platform: "node", format: "cjs", target: "node24",
  outfile: join(DIST, "app.cjs"),
  define: { "import.meta.url": "__import_meta_url", __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  banner: { js: 'const __import_meta_url = require("url").pathToFileURL(__filename).href;' },
  logLevel: "warning",
});

// 3) SEA 설정: 화면 감시·오버레이 스크립트, 데이터, 글꼴을 exe 안에 넣기
step("내장 파일 준비");
const assets = {};
for (const rel of ASSETS) {
  assets[rel] = rel === "vendor/app-with-deps.js" ? require.resolve("@modelcontextprotocol/ext-apps/app-with-deps") : join(ROOT, rel);
}
const seaConfig = join(DIST, "sea-config.json");
writeFileSync(seaConfig, JSON.stringify({
  main: join(DIST, "app.cjs"), output: join(DIST, "sea-prep.blob"),
  disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets,
}, null, 1));
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

// 4) node.exe 복사 → 아이콘·이름 넣기 → 코드 주입
step("exe 만들기");
const exe = join(DIST, "AramCoach.exe");
copyFileSync(process.execPath, exe);
const rcedit = (await import("rcedit")).default ?? (await import("rcedit")).rcedit;
await rcedit(exe, {
  icon: icoPath,
  "file-version": APP_VERSION, "product-version": APP_VERSION,
  "version-string": { ProductName: "아수라장 코치", FileDescription: "아수라장 코치 - 증강·아이템 AI 도우미", CompanyName: "AramCoach", OriginalFilename: "AramCoach.exe", LegalCopyright: "Pretendard font: SIL OFL 1.1" },
});
execFileSync(process.execPath, [require.resolve("postject/dist/cli.js"), exe, "NODE_SEA_BLOB", join(DIST, "sea-prep.blob"),
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", "--overwrite"], { stdio: "inherit" });

for (const f of ["sea-prep.blob", "sea-config.json", "app.cjs"]) rmSync(join(DIST, f), { force: true });
const size = (readFileSync(exe).length / 1024 / 1024).toFixed(1);
console.log(`✔ 완료: ${exe} (${size}MB, v${APP_VERSION})`);
