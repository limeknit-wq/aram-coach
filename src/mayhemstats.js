import { join } from "node:path";
import { getJson } from "./augdata.js";
import { norm } from "./data.js";
import { dataDir, readJson, saveJson } from "./gamecache.js";

const BASE = "https://arammayhem.com/data/v1";
const FILE = "mayhem-stats.json";
const comboTypes = new Set(["god", "strong", "blackTech", "entertainment", "trap", "bug"]);
const patchPattern = /^\d{2}\.\d{1,2}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
let currentCache;
let cacheLoadedAt = 0;

function keepCache(value) {
  currentCache = Promise.resolve(value);
  cacheLoadedAt = Date.now();
}

export function publicPatch(version) {
  const m = /^(\d{2})\.(\d{1,2})(?:\.|$)/.exec(String(version || "").trim());
  if (!m) return null;
  const major = Number(m[1]);
  // 2025년부터 공개 패치의 연도 표기는 파일의 시즌 버전보다 10 큽니다.
  return `${major >= 15 && major < 25 ? major + 10 : major}.${Number(m[2])}`;
}

export async function refreshMayhemStats({ dir = dataDir, load = getJson } = {}) {
  const path = join(dir, FILE);
  const previous = await readJson(path);
  const index = await load(`${BASE}/index.json`);
  const patch = index?.latestPatch;
  const releaseId = index?.releaseId;
  if (index?.schemaVersion !== 1 || !patchPattern.test(patch) || typeof releaseId !== "string" || !releaseId)
    throw new Error("ARAM Mayhem 데이터 목록 형식이 바뀌었어요");
  if (previous?.[patch]?.releaseId === releaseId && previous[patch].augments?.length && previous[patch].combos?.length) {
    if (dir === dataDir) keepCache(previous);
    return previous[patch];
  }

  const [augments, combos] = await Promise.all([load(`${BASE}/latest/augments.json`), load(`${BASE}/latest/combos.json`)]);
  if ([augments, combos].some((file) => file?.schemaVersion !== 1 || file.meta?.releaseId !== releaseId || !Array.isArray(file.rows) || !file.rows.length) ||
    augments.meta.patch !== patch || !datePattern.test(augments.meta.statsDate))
    throw new Error("ARAM Mayhem 파일의 패치 또는 배포본이 일치하지 않아요");

  const augmentRows = augments.rows.filter((row) => typeof row?.augmentId === "string" && Number.isFinite(row.pickRate) && row.pickRate >= 0 && row.pickRate <= 100);
  const comboRows = combos.rows.filter((row) => Array.isArray(row?.augmentIds) && row.augmentIds.length &&
    row.augmentIds.every((id) => typeof id === "string") && Array.isArray(row.types));
  if (augmentRows.length !== augments.rows.length || comboRows.length !== combos.rows.length)
    throw new Error("ARAM Mayhem 통계 항목 형식이 바뀌었어요");

  const entry = {
    releaseId, patch, statsDate: augments.meta.statsDate,
    augments: augmentRows.map((row) => ({ id: row.augmentId, names: [row.name?.en, row.name?.["ko-KR"]], pickRate: row.pickRate })),
    combos: comboRows.map((row) => ({ ids: row.augmentIds, champion: typeof row.championId === "string" ? row.championId : null,
      names: Array.isArray(row.augmentNames) ? row.augmentNames.map((name) => [name?.en, name?.["ko-KR"]]) : null,
      types: row.types.filter((type) => comboTypes.has(type)) })),
  };
  const cache = Object.fromEntries([[patch, entry], ...Object.entries(previous || {}).filter(([key]) => key !== patch)].slice(0, 3));
  await saveJson(dir, FILE, cache);
  if (dir === dataDir) keepCache(cache);
  return entry;
}

function uniqueIndex(entries) {
  const map = new Map();
  for (const [value, id] of entries) {
    const key = norm(value);
    if (key) map.set(key, !map.has(key) || map.get(key) === id ? id : null);
  }
  return map;
}

let mapping;
function mapAugments(entry) {
  if (mapping?.entry === entry) return mapping;
  const byId = uniqueIndex(entry.augments.map((row) => [row.id, row.id]));
  const byName = uniqueIndex([
    ...entry.augments.flatMap((row) => row.names.map((name) => [name, row.id])),
    ...entry.combos.flatMap((row) => row.ids.flatMap((id, i) => (row.names?.[i] || []).map((name) => [name, id]))),
  ]);
  const stats = new Map(entry.augments.map((row) => [row.id, row]));
  const resolve = (a) => byName.get(norm(a?.nameEn)) || byName.get(norm(a?.name)) || byId.get(norm(a?.apiName?.replace(/^ARAM_/i, "")));
  mapping = { entry, resolve, stats };
  return mapping;
}

export async function offerStatistics(gameVersion, champion, list, names, picks) {
  const patch = publicPatch(gameVersion);
  if (!patch) return null;
  if (!currentCache || Date.now() - cacheLoadedAt >= 60000) keepCache(readJson(join(dataDir, FILE)));
  const entry = (await currentCache)?.[patch];
  if (!entry?.augments?.length || !entry?.combos?.length) return null;
  const { resolve, stats } = mapAugments(entry);
  const pickedIds = new Map();
  for (const pick of picks) {
    const id = resolve(list.find((a) => a.apiName === pick.apiName || a.name === pick.name));
    if (id) pickedIds.set(id, pick.name);
  }
  const cards = names.map((name) => {
    const id = resolve(list.find((a) => a.name === name));
    if (!id) return null;
    const combos = entry.combos.filter((row) => row.ids.includes(id) &&
      (row.champion ? Boolean(champion && norm(champion) === norm(row.champion)) : row.ids.length > 1) &&
      row.ids.every((part) => part === id || pickedIds.has(part)))
      .slice(0, 4).map((row) => ({ with: row.ids.filter((part) => part !== id).map((part) => pickedIds.get(part)), types: row.types }));
    const pickRate = stats.get(id)?.pickRate;
    return pickRate != null || combos.length ? { pickRate, combos } : null;
  });
  return cards.some(Boolean) ? { patch, statsDate: entry.statsDate, cards } : null;
}
