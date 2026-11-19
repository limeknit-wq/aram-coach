// 게임 계획(점수표) 저장과 즉시 점수 계산.
// 게임 시작 때 AI가 한 번 만든 점수표를 파일에 저장해 두고, 선택지가 뜨면 AI 없이 바로 계산합니다.
// 이미 고른 증강과의 시너지, 이벤트(커맨드 라인/HEARTSTEEL)도 여기서 반영합니다.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { augments, norm } from "./data.js";

export const DATA_DIR = join(tmpdir(), "lol-aram-mcp");
const PLAN_FILE = join(DATA_DIR, "plan.json");
const PICKS_FILE = join(DATA_DIR, "picks.json");

export const GRADE_SCORE = { "S+": 95, S: 88, A: 76, B: 62, C: 45, D: 25 };
export const gradeOf = (s) => (s >= 92 ? "S+" : s >= 84 ? "S" : s >= 70 ? "A" : s >= 55 ? "B" : s >= 35 ? "C" : "D");

let planCache = { mtime: 0, plan: null };
export async function loadPlan() {
  try {
    const s = await stat(PLAN_FILE);
    if (s.mtimeMs !== planCache.mtime) planCache = { mtime: s.mtimeMs, plan: JSON.parse(await readFile(PLAN_FILE, "utf8")) };
  } catch { planCache = { mtime: 0, plan: null }; }
  return planCache.plan;
}

/** AI가 만든 계획을 정규화해서 저장. 이름은 데이터의 정식 이름으로 맞춥니다. */
export async function savePlan(input, gameKey, { source = "AI" } = {}) {
  const { augments: list } = await augments();
  const byNorm = new Map();
  for (const a of list) { byNorm.set(norm(a.name), a); if (a.nameEn) byNorm.set(norm(a.nameEn), a); }
  const resolve = (n) => byNorm.get(norm(n)) || list.find((a) => norm(a.name).includes(norm(n)) && norm(n).length >= 2);

  const scores = {}; // apiName -> { score, reason, style }
  const unknown = [];
  for (const [grade, names] of Object.entries(input.tiers || {})) {
    for (const n of names || []) {
      const a = resolve(n);
      if (!a) { unknown.push(n); continue; }
      scores[a.apiName] = { name: a.name, score: GRADE_SCORE[grade] ?? 50 };
    }
  }
  for (const d of input.details || []) {
    const a = resolve(d.name);
    if (!a) { unknown.push(d.name); continue; }
    scores[a.apiName] = { ...(scores[a.apiName] || { name: a.name, score: 50 }), ...(d.score != null ? { score: d.score } : {}), reason: d.reason, style: d.style };
  }
  const synergies = [];
  for (const s of input.synergies || []) {
    const a = resolve(s.ifPicked), b = resolve(s.boost);
    if (a && b) synergies.push({ ifPicked: a.apiName, boost: b.apiName, bonus: s.bonus ?? 10, why: s.why });
  }
  const plan = {
    savedAt: Date.now(),
    gameKey: gameKey || null,
    source, // "기본" | "AI" | "AI(Claude Code)" 등
    champion: input.champion,
    strategy: input.strategy,
    build: input.build,
    defaultScore: input.defaultScore ?? 45,
    scores,
    synergies,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PLAN_FILE, JSON.stringify(plan, null, 1));
  return { plan, covered: Object.keys(scores).length, total: list.length, unknown };
}

// ---------- 고른 증강 (모든 서버가 공유하는 파일) ----------
export async function loadPicks(gameKey) {
  try {
    const p = JSON.parse(await readFile(PICKS_FILE, "utf8"));
    if (gameKey && p.gameKey && p.gameKey !== gameKey) return [];
    return p.picks || [];
  } catch { return []; }
}

export async function addPick(name, gameKey, source = "직접 입력") {
  const { augments: list } = await augments();
  const a = list.find((x) => norm(x.name) === norm(name) || norm(x.nameEn) === norm(name)) || list.find((x) => norm(x.name).includes(norm(name)));
  const picks = await loadPicks(gameKey);
  const entry = { apiName: a?.apiName, name: a?.name || name, rarity: a?.rarity, icon: a?.icon, at: Date.now(), source };
  if (!picks.some((p) => p.apiName && p.apiName === entry.apiName && Date.now() - p.at < 5000)) picks.push(entry);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PICKS_FILE, JSON.stringify({ gameKey, picks }, null, 1));
  return picks;
}

export async function resetPicks(gameKey) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PICKS_FILE, JSON.stringify({ gameKey, picks: [] }));
}

/**
 * 화면의 선택지 → 카드별 점수. 계획이 없으면 null 점수.
 * 반영: 기본 점수 + 이미 고른 증강과의 시너지 + HEARTSTEEL 스티커 + 커맨드 라인(가장 약한 카드 새로고침 권장).
 */
export async function scoreOffer(offer, { event, gameKey } = {}) {
  if (!offer?.names?.length) return null;
  const loaded = await loadPlan();
  // 다른 게임의 점수표는 쓰지 않습니다 (AI가 이번 판을 분석할 때까지 점수 없음)
  const plan = loaded && !(gameKey && loaded.gameKey && loaded.gameKey !== gameKey) ? loaded : null;
  const { augments: list } = await augments();
  const picks = await loadPicks(gameKey);
  const pickedIds = new Set(picks.map((p) => p.apiName));
  const stale = Boolean(loaded && !plan);

  const cards = offer.names.map((name, i) => {
    const a = list.find((x) => x.name === name);
    const base = plan?.scores?.[a?.apiName];
    let score = plan ? (base?.score ?? plan.defaultScore) : null;
    const notes = [];
    if (plan) {
      for (const s of plan.synergies || []) {
        if (s.boost === a?.apiName && pickedIds.has(s.ifPicked)) {
          score += s.bonus;
          notes.push(`'${list.find((x) => x.apiName === s.ifPicked)?.name || "고른 증강"}' ${s.bonus > 0 ? "시너지 +" : "겹침 "}${s.bonus}`);
        }
      }
      const sticker = offer.stickers?.[i];
      if (sticker) { score += 8; notes.push("HEARTSTEEL 스티커 +8"); }
      score = Math.max(0, Math.min(100, Math.round(score)));
    }
    return {
      name, apiName: a?.apiName, rarity: a?.rarity, x: offer.xs?.[i] ?? null, slot: offer.slots?.[i] ?? null,
      score, grade: score == null ? "?" : gradeOf(score), reason: base?.reason || (plan && !base ? "점수표에 없음 (기본 점수)" : null),
      style: base?.style, notes, sticker: offer.stickers?.[i] || null, unrated: plan ? !base : true,
    };
  });
  if (plan) {
    const best = cards.reduce((b, c) => (c.score > b.score ? c : b), cards[0]);
    best.isPick = true;
    if (event?.id === "CommandLine") {
      const worst = cards.reduce((w, c) => (c.score < w.score ? c : w), cards[0]);
      if (worst !== best) worst.rerollHint = "▶ 이 카드 먼저 새로고침 (등급 상승)";
    }
  }
  return { hasPlan: Boolean(plan), stalePlan: Boolean(stale), planSource: plan?.source || null, picks: picks.map((p) => p.name), cards };
}
