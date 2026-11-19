// 설치 / 제거 (관리자 권한 없이 사용자 폴더에 설치)
// 설치 위치: %LOCALAPPDATA%\Programs\AramCoach\AramCoach.exe, 시작 메뉴 바로가기 "아수라장 코치"
import { spawn, execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { APP_DIR, IS_EXE } from "./paths.js";

const run = promisify(execFile);
export const INSTALL_DIR = process.env.ARAM_INSTALL_DIR || join(process.env.LOCALAPPDATA || ".", "Programs", "AramCoach");
const START_MENU = process.env.ARAM_STARTMENU_DIR || join(process.env.APPDATA || ".", "Microsoft", "Windows", "Start Menu", "Programs");
const SHORTCUT = join(START_MENU, "아수라장 코치.lnk");

const ps = (script) => run("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function messageBox(text, { yesNo = false } = {}) {
  const { stdout } = await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(${q(text)}, '아수라장 코치', '${yesNo ? "YesNo" : "OK"}', 'Information')`);
  return stdout.trim(); // "Yes" | "No" | "OK"
}

export function isInstalled() {
  return dirname(process.execPath).toLowerCase() === INSTALL_DIR.toLowerCase();
}

/** 설치 안 된 위치에서 exe를 실행하면 설치를 물어봅니다. 설치했으면 true (현재 프로세스는 종료해야 함). */
export async function maybeInstall(args) {
  if (!IS_EXE || isInstalled() || args.includes("--portable")) return false;
  const answer = process.env.ARAM_INSTALL_YES === "1" ? "Yes" : await messageBox(`아수라장 코치를 설치할까요?\n\n설치 위치: ${INSTALL_DIR}\n시작 메뉴에 바로가기를 만듭니다.\n(관리자 권한 필요 없음)\n\n'아니요'를 누르면 설치 없이 지금 위치에서 실행해요.`, { yesNo: true });
  if (answer !== "Yes") return false;
  const target = join(INSTALL_DIR, "AramCoach.exe");
  await mkdir(INSTALL_DIR, { recursive: true });
  // 이미 설치된 프로그램이 실행 중이면 먼저 종료 (실행 중인 exe는 덮어쓸 수 없음)
  const port = Number(process.env.LOL_COORD_PORT || 47321);
  const info = await fetch(`http://127.0.0.1:${port}/info`).then((r) => r.json()).catch(() => null);
  if (info?.app) {
    await fetch(`http://127.0.0.1:${port}/quit`, { method: "POST" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }
  for (let i = 0; ; i++) {
    try { await copyFile(process.execPath, target); break; }
    catch (e) { if (i >= 10) throw e; await new Promise((r) => setTimeout(r, 500)); }
  }
  await mkdir(START_MENU, { recursive: true });
  await ps(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(SHORTCUT)}); $s.TargetPath=${q(target)}; $s.WorkingDirectory=${q(INSTALL_DIR)}; $s.Description='아수라장 증강·아이템 도우미'; $s.Save()`);
  spawn(target, [], { detached: true, stdio: "ignore" }).unref();
  return true;
}

/** 제거: 자동 실행 등록, 바로가기, 설치 폴더, 데이터 폴더 삭제. 호출 후 프로세스는 종료됩니다. */
export async function uninstall() {
  await run("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "AramCoach", "/f"], { windowsHide: true }).catch(() => {});
  await rm(SHORTCUT, { force: true }).catch(() => {});
  await rm(APP_DIR, { recursive: true, force: true }).catch(() => {});
  // 실행 중인 exe는 바로 지울 수 없어서, 프로세스가 끝난 뒤 지우도록 예약
  if (isInstalled()) {
    spawn("cmd.exe", ["/c", `timeout /t 3 /nobreak >nul & rmdir /s /q "${INSTALL_DIR}"`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}
