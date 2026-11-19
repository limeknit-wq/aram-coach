// 정적 게임 데이터: 챔피언·아이템(Data Dragon), 증강(data/augments.json)
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LANG = process.env.LOL_DDRAGON_LANG || "ko_KR";
const DD = "https://ddragon.leagueoflegends.com";
import { ensureResources, resPath } from "./paths.js";
const HOWLING_ABYSS = "12";

const cache = new Map();
async function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`데이터 요청 실패 ${r.status}: ${url}`);
  return r.json();
}

export const norm = (s) => String(s || "").toLowerCase().replace(/[\s'’.\-_:!?·]/g, "");

export function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(li|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export const version = () => cached("ver", async () => (await getJson(`${DD}/api/versions.json`))[0]);

// ---------- 챔피언 ----------
export const champions = () =>
  cached("champs", async () => {
    const v = await version();
    const { data } = await getJson(`${DD}/cdn/${v}/data/${LANG}/champion.json`);
    return Object.values(data);
  });

export async function findChampion(query) {
  const list = await champions();
  const q = norm(query);
  return (
    list.find((c) => norm(c.id) === q || norm(c.name) === q) ||
    list.find((c) => norm(c.name).startsWith(q) || norm(c.id).startsWith(q)) ||
    list.find((c) => norm(c.name).includes(q) || norm(c.id).includes(q))
  );
}

/** 공격 성향 추정: Data Dragon info(attack/magic)와 태그 기반. 정확한 판단은 LLM 지식으로 보완. */
export function damageProfile(c) {
  const { attack = 0, magic = 0 } = c.info || {};
  const total = attack + magic || 1;
  const ap = Math.round((magic / total) * 100);
  let type = ap >= 60 ? "AP" : ap <= 40 ? "AD" : "혼합";
  // 애매한 경우 첫 번째 역할 태그로 결정 (예: 이즈리얼 Marksman → AD)
  if (type === "혼합") {
    const t = c.tags?.[0];
    if (t === "Marksman" || t === "Assassin" || t === "Fighter") type = "AD";
    else if (t === "Mage") type = "AP";
  }
  return { type, apPercent: ap, adPercent: 100 - ap, estimated: true };
}

export function championSummary(c) {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    tags: c.tags,
    resource: c.partype,
    damage: damageProfile(c),
    ratings: c.info, // attack/defense/magic/difficulty (0~10)
    attackRange: c.stats?.attackrange,
  };
}

export async function championDetail(query) {
  const base = await findChampion(query);
  if (!base) return null;
  const v = await version();
  const full = await cached(`champ:${base.id}`, async () =>
    (await getJson(`${DD}/cdn/${v}/data/${LANG}/champion/${base.id}.json`)).data[base.id]
  );
  return {
    ...championSummary(full),
    stats: full.stats,
    passive: { name: full.passive.name, desc: stripHtml(full.passive.description) },
    spells: full.spells.map((s, i) => ({
      key: "QWER"[i],
      name: s.name,
      desc: stripHtml(s.description),
      cooldown: s.cooldownBurn,
      cost: s.costBurn,
      range: s.rangeBurn,
    })),
    allyTips: full.allytips,
    enemyTips: full.enemytips,
  };
}

// ---------- 아이템 ----------
export const items = () =>
  cached("items", async () => {
    const v = await version();
    const { data } = await getJson(`${DD}/cdn/${v}/data/${LANG}/item.json`);
    return Object.entries(data).map(([id, it]) => ({ id, ...it }));
  });

export async function aramItems() {
  return (await items()).filter(
    // id가 5자리 이상인 것은 다른 모드용 변형(아레나 22xxxx, 옛 모드 77xxxx, 증강 보상 12xxxx 등)이라 칼바람 상점에 없음
    (it) => it.id.length <= 4 && it.maps?.[HOWLING_ABYSS] && it.gold?.purchasable && it.inStore !== false && !it.requiredChampion && !it.hideFromAll
  );
}

export async function itemById(id) {
  return (await items()).find((it) => it.id === String(id));
}

export function itemSummary(it, { full = false } = {}) {
  const s = {
    id: it.id,
    name: it.name,
    gold: it.gold?.total,
    tags: it.tags,
    stats: it.stats,
    completed: !it.into || it.into.length === 0,
    plaintext: it.plaintext || undefined,
  };
  if (full) {
    s.desc = stripHtml(it.description);
    s.buildsFrom = it.from;
    s.buildsInto = it.into;
  }
  return s;
}

export async function searchItems({ query, tags, completedOnly = true, maxGold, limit = 25 }) {
  let list = await aramItems();
  if (completedOnly) list = list.filter((it) => (!it.into || it.into.length === 0) && (it.gold?.total ?? 0) >= 900);
  if (maxGold) list = list.filter((it) => (it.gold?.total ?? 0) <= maxGold);
  if (tags?.length) list = list.filter((it) => tags.every((t) => it.tags?.some((x) => norm(x) === norm(t))));
  if (query) {
    const q = norm(query);
    list = list.filter((it) => norm(it.name).includes(q) || norm(stripHtml(it.description)).includes(q) || it.id === query);
  }
  // 같은 이름이 여러 개(모드별 변형)면 하나만
  const seen = new Set();
  list = list.filter((it) => (seen.has(it.name) ? false : seen.add(it.name)));
  return list.slice(0, limit).map((it) => itemSummary(it, { full: Boolean(query) }));
}

export async function findItem(query) {
  const list = await aramItems();
  const q = norm(query);
  return (
    list.find((it) => it.id === String(query) || norm(it.name) === q) ||
    list.find((it) => norm(it.name).includes(q))
  );
}

// ---------- 증강 ----------
export const augments = () =>
  cached("augs", async () => (await ensureResources(), JSON.parse(await readFile(resPath("data/augments.json"), "utf8"))));

export async function findAugments(names) {
  const { augments: list } = await augments();
  return names.map((n) => {
    const q = norm(n);
    const named = list.filter((a) => norm(a.name).length > 0);
    const hit = !q ? null :
      named.find((a) => norm(a.name) === q || norm(a.apiName) === q || norm(a.nameEn) === q) ||
      named.find((a) => norm(a.name).includes(q)) ||
      named.find((a) => norm(a.name).length >= 2 && q.includes(norm(a.name)));
    return hit ? { query: n, ...hit, desc: stripHtml(hit.desc) || "(설명 데이터 없음 — 알고 있는 지식으로 판단)" } : { query: n, notFound: true };
  });
}

// ---------- 귀빈(Guest of Honor) 이벤트 ----------
export const events = () =>
  cached("events", async () => {
    try { await ensureResources(); return JSON.parse(await readFile(resPath("data/events.json"), "utf8")).events; } catch { return []; }
  });

export async function findEvent(query) {
  const q = norm(query);
  if (!q) return null;
  const list = await events();
  return list.find((e) => norm(e.name) === q || norm(e.id) === q) || list.find((e) => norm(e.name).includes(q) || q.includes(norm(e.name)));
}

export async function searchAugments({ query, rarity, tag, limit = 40 }) {
  const { augments: list } = await augments();
  let r = list;
  if (rarity) r = r.filter((a) => a.rarity === rarity);
  if (tag) r = r.filter((a) => a.tags.some((t) => norm(t) === norm(tag)));
  if (query) {
    const q = norm(query);
    r = r.filter((a) => norm(a.name).includes(q) || norm(a.desc).includes(q) || norm(a.apiName).includes(q));
  }
  return r.slice(0, limit).map((a) => ({ ...a, desc: stripHtml(a.desc) }));
}
