// 구매 계산: 가진 하위 아이템을 빼고 남은 골드, 지금 골드로 살 수 있는 다음 부품
import { itemById } from "./data.js";

/** 보유 아이템 → { id: 개수 } */
export function inventory(items) {
  const inv = new Map();
  for (const i of items || []) if (i.id != null) inv.set(String(i.id), (inv.get(String(i.id)) || 0) + (i.count || 1));
  return inv;
}

/**
 * 아이템을 완성하는 데 남은 골드. 가진 하위 아이템은 쓰인 것으로 보고 inv 에서 뺍니다.
 * @returns {{ cost: number, used: string[] }} used = 재료로 쓰인 보유 아이템 이름
 */
export async function remainingCost(id, inv, top = true) {
  const it = await itemById(id);
  if (!it) return { cost: 0, used: [] };
  const key = String(it.id);
  if (!top && (inv.get(key) || 0) > 0) { inv.set(key, inv.get(key) - 1); return { cost: 0, used: [it.name] }; }
  let cost = it.gold?.base ?? it.gold?.total ?? 0;
  const used = [];
  for (const c of it.from || []) {
    const r = await remainingCost(c, inv, false);
    cost += r.cost; used.push(...r.used);
  }
  return { cost, used };
}

/**
 * 지금 살 것: 1순위 아이템을 완성할 수 있으면 그 아이템, 아니면 지금 골드로 살 수 있는 가장 비싼 재료.
 * 살 수 있는 게 없으면 가장 싼 재료와 모자란 골드.
 */
export async function buyNow(id, items, gold) {
  const cands = [];
  const walk = async (cid, inv, depth) => {
    const it = await itemById(cid);
    if (!it) return;
    const key = String(it.id);
    if (depth > 0 && (inv.get(key) || 0) > 0) { inv.set(key, inv.get(key) - 1); return; } // 이미 가진 재료
    const r = await remainingCost(cid, new Map(inv), true);
    cands.push({ id: key, name: it.name, cost: r.cost, depth });
    for (const c of it.from || []) await walk(c, inv, depth + 1);
  };
  await walk(id, inventory(items), 0);
  if (!cands.length) return null;
  const top = cands[0];
  if (gold >= top.cost) return { ...top, complete: true, affordable: true };
  const ok = cands.filter((c) => c.depth > 0 && c.cost <= gold).sort((a, b) => b.cost - a.cost);
  if (ok.length) return { ...ok[0], complete: false, affordable: true };
  const cheap = cands.filter((c) => c.depth > 0).sort((a, b) => a.cost - b.cost)[0] || top;
  return { ...cheap, complete: cheap === top, affordable: false, need: cheap.cost - gold };
}

// ---------- 하나만 가질 수 있는 아이템 계열 ----------
// 게임에서 같은 계열은 한 개만 살 수 있습니다 (예: 방어구 관통 '최후의 속삭임' 계열은 도미닉·필멸자·세릴다 중 하나).
// 하위 재료로 묶이는 계열은 재료 id로, 재료가 다른 계열은 아이템 id로 정합니다.
const LIMIT_BY_COMPONENT = {
  "3035": "방어구 관통(최후의 속삭임)",
  "4630": "마법 관통(역병의 보석)",
  "3077": "히드라(티아맷)",
  "3070": "마나 흐름(여신의 눈물)",
};
const LIMIT_BY_ID = { "3053": "생명선", "3156": "생명선", "6673": "생명선" };

/** 아이템이 속한 '하나만' 계열 이름. 없으면 null */
export function limitGroup(it) {
  if (!it) return null;
  if (it.tags?.includes("Boots")) return "신발";
  if (LIMIT_BY_ID[String(it.id)]) return LIMIT_BY_ID[String(it.id)];
  for (const c of it.from || []) if (LIMIT_BY_COMPONENT[c]) return LIMIT_BY_COMPONENT[c];
  return null;
}

/** AI 프롬프트에 넣을 규칙 문장 (계열별 실제 아이템 이름) */
export async function limitRuleText(aramList) {
  const groups = new Map();
  for (const it of aramList) {
    if ((it.into || []).length) continue;
    const g = limitGroup(it);
    if (!g || g === "신발") continue;
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g).add(it.name);
  }
  return "같은 계열은 하나만 살 수 있으니 빌드에 하나만 넣어: 신발 1개, " +
    [...groups].map(([g, s]) => `${g}=${[...s].join("/")}`).join(", ") + ".";
}

/**
 * 아이템 이름 목록에서 같은 계열 두 번째부터 뺍니다. owned(이미 가진 완성 아이템 객체들)의 계열은 처음부터 막힌 것으로 봅니다.
 * @param {string[]} names @param {(n:string)=>Promise<object|null>} find @param {object[]} owned
 */
export async function dropLimitDupes(names, find, owned = []) {
  const ownedIds = new Set(owned.map((o) => String(o.id)));
  const used = new Map(); // 계열 → 남길 아이템 id
  for (const o of owned) { const g = limitGroup(await itemById(o.id)); if (g && !used.has(g)) used.set(g, String(o.id)); }
  const out = [];
  for (const n of names) {
    const it = await find(n);
    const g = limitGroup(it);
    if (g) {
      if (used.has(g) && used.get(g) !== String(it.id)) continue;
      if (!ownedIds.has(String(it?.id))) used.set(g, String(it.id));
    }
    out.push(n);
  }
  return out;
}
