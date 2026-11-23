import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { APP_DIR } from "./paths.js";
import { CD, buildGameData, getJson } from "./augdata.js";

export const dataDir = join(APP_DIR, "data");
export async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
export async function saveJson(dir, name, data) {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, randomUUID() + ".tmp");
  try {
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, join(dir, name));
  } finally { await rm(tmp, { force: true }); }
}

function usable(data) {
  return typeof data?.builtAt === "string" && data.augments?.length > 0 && data.events?.length > 0 &&
    Array.isArray(data.augments) && data.augments.every(a => a?.apiName && typeof a.name === "string" && typeof a.desc === "string" && Array.isArray(a.tags)) &&
    Array.isArray(data.events) && data.events.every(e => e?.id && typeof e.name === "string");
}
export async function savedData(dir = dataDir) {
  const data = await readJson(join(dir, "game-data.json"));
  return usable(data) ? data : null;
}

export async function refreshData({ dir = dataDir, load = getJson, build = buildGameData } = {}) {
  const last = await readJson(join(dir, "checked.json"));
  const prev = await savedData(dir);
  if (prev && last?.version === prev.version && Date.now() - last.time >= 0 && Date.now() - last.time < 86400000) return;
  const metadata = () => load(CD + "/content-metadata.json");
  const { version } = await metadata();
  if (typeof version !== "string" || !version.trim()) throw new Error("패치 버전 누락");
  if (version !== prev?.version) {
    const data = await build("ko_kr", load);
    if (!usable(data) || (await metadata()).version !== version) throw new Error("패치 데이터 검증 실패");
    // 증강과 이벤트가 항상 같은 패치에 속하도록 한 파일로 교체합니다.
    await saveJson(dir, "game-data.json", { ...data, version });
  }
  await saveJson(dir, "checked.json", { time: Date.now(), version });
}
