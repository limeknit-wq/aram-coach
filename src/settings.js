// 프로그램 설정: %LOCALAPPDATA%\AramCoach\settings.json
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_DIR } from "./paths.js";

const FILE = join(APP_DIR, "settings.json");

export const DEFAULTS = {
  aiEngine: "auto",      // auto | claude | codex | off : 게임 시작 시 자동 세팅에 쓸 AI (각자 로그인된 CLI)
  aiModel: "",           // 비우면 각 CLI의 기본 모델
  overlay: true,         // 게임 위 오버레이 표시
  overlayScale: 1.0,     // 오버레이 크기 배율 (0.7 ~ 1.5)
  overlayOffsetY: 0,     // 세로 위치 보정 (화면 높이 % 단위, -5 ~ +5)
  autostart: false,      // 윈도우 시작 시 실행
  companionAuto: false,  // 게임 시작 시 실시간 보조 창 자동으로 열기 (두 번째 모니터용)
  companionTopmost: false, // 보조 창 항상 위
  companionBounds: "",   // 보조 창 위치·크기 "x,y,w,h" (옮기면 자동 저장)
};

let cache = null;
export async function getSettings() {
  if (!cache) {
    try { cache = { ...DEFAULTS, ...JSON.parse(await readFile(FILE, "utf8")) }; }
    catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}

export async function updateSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULTS && typeof v === typeof DEFAULTS[k]) next[k] = v;
  next.overlayScale = Math.min(1.5, Math.max(0.7, next.overlayScale));
  next.overlayOffsetY = Math.min(5, Math.max(-5, next.overlayOffsetY));
  if (!["auto", "claude", "codex", "off"].includes(next.aiEngine)) next.aiEngine = "auto";
  cache = next;
  await mkdir(APP_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 1));
  return next;
}
