// 새 버전 확인 (GitHub 릴리스). 알림만 하고 자동 설치는 하지 않습니다.
import { APP_VERSION } from "./paths.js";

// GitHub 저장소를 만든 뒤 "owner/repo" 로 채웁니다. 비어 있으면 확인하지 않습니다.
export const REPO = process.env.ARAM_REPO || "limeknit-wq/aram-coach-public";
export const update = { checked: false, latest: null, url: null, newer: false };

const parse = (v) => String(v).replace(/^v/, "").split(".").map((n) => Number(n) || 0);
const isNewer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

export async function checkUpdate() {
  if (!REPO) return update;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { "User-Agent": "AramCoach" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return update;
  const j = await r.json();
  Object.assign(update, { checked: true, latest: j.tag_name, url: j.html_url, newer: isNewer(j.tag_name, APP_VERSION) });
  return update;
}
