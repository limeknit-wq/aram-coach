// 자동 AI 세팅 (빠른 버전)
// - 이 프로그램은 AI API를 직접 부르지 않습니다. 사용자 PC에 로그인된 Claude Code(claude) / Codex(codex) CLI를 실행합니다.
// - 속도: 도구 호출 없이 필요한 정보를 프롬프트에 한 번에 넣고, AI는 증강 '번호'로 된 짧은 JSON만 답합니다.
// - 시점: 픽창에서 내 챔피언 기준 '기본 점수표'를 미리 만들고(챔피언별 저장), 로딩 화면에서 적 조합 '보정'만 합니다.
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { augments, championDetail, damageProfile, findChampion, searchItems } from "./data.js";
import { APP_DIR } from "./paths.js";
import { savePlan } from "./plan.js";
import { getSettings } from "./settings.js";

const run = promisify(execFile);
const PLANS_DIR = join(APP_DIR, "plans");
const PROMPT_V = 2; // 프롬프트를 바꾸면 올려서 예전 기본 점수표를 다시 만들게 함
const TIMEOUT_MS = 3 * 60 * 1000;

export const setup = { state: "대기", step: "", engine: null, startedAt: null, finishedAt: null, message: "", gameKey: null, timings: {} };
const running = new Map(); // 작업 키 → Promise
const children = new Set();

// ---------- AI CLI ----------
async function which(name) {
  try {
    const { stdout } = await run("where.exe", [name], { windowsHide: true });
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
  } catch { return null; }
}
let enginesCache = null;
export async function detectEngines() {
  if (!enginesCache || Date.now() - enginesCache.at > 60000) {
    const [claude, codex] = await Promise.all([which("claude"), which("codex")]);
    enginesCache = { at: Date.now(), v: { claude, codex } };
  }
  return enginesCache.v;
}
async function pickEngine() {
  const s = await getSettings();
  if (s.aiEngine === "off") return null;
  const f = await detectEngines();
  if ((s.aiEngine === "auto" || s.aiEngine === "claude") && f.claude) return { name: "Claude Code", kind: "claude", path: f.claude, model: s.aiModel || "" };
  if ((s.aiEngine === "auto" || s.aiEngine === "codex") && f.codex) return { name: "Codex", kind: "codex", path: f.codex, model: s.aiModel || "" };
  return null;
}

/** 프롬프트를 표준 입력으로 넘겨 CLI 한 번 실행 → 응답 텍스트 */
async function askAI(engine, prompt) {
  await mkdir(APP_DIR, { recursive: true });
  let args, outFile = null;
  if (engine.kind === "claude") {
    // --strict-mcp-config: 사용자의 다른 MCP 서버를 불러오지 않아 시작이 빠릅니다
    args = ["-p", "--output-format", "json", "--strict-mcp-config", ...(engine.model ? ["--model", engine.model] : []),
      "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite"];
  } else {
    outFile = join(APP_DIR, `codex-out-${Date.now()}.txt`);
    args = ["exec", "--skip-git-repo-check", "-s", "read-only", "-c", 'approval_policy="never"', "-o", outFile, ...(engine.model ? ["-m", engine.model] : []), "-"];
  }
  const text = await new Promise((resolve, reject) => {
    const p = spawn(engine.path, args, { cwd: APP_DIR, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: /\.(cmd|bat)$/i.test(engine.path) });
    children.add(p);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
    p.on("error", reject);
    p.on("close", async (code) => {
      clearTimeout(timer); children.delete(p);
      if (code !== 0) return reject(new Error(`${engine.name} 종료 코드 ${code}: ${(err || out).replace(/\s+/g, " ").slice(-200)}`));
      try {
        if (engine.kind === "claude") resolve(JSON.parse(out).result || "");
        else { resolve(await readFile(outFile, "utf8")); rm(outFile, { force: true }).catch(() => {}); }
      } catch (e) { reject(e); }
    });
    p.stdin.end(prompt, "utf8");
  });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답에서 JSON을 찾지 못함");
  return JSON.parse(m[0]);
}

// ---------- 프롬프트 재료 ----------
let catalogCache = null;
async function catalog() {
  if (catalogCache) return catalogCache;
  const data = await augments();
  const list = data.augments.filter((a) => a.desc && !/^[?\s]+$/.test(a.name));
  const short = { 실버: "실", 골드: "골", 프리즘: "프" };
  const lines = list.map((a, i) => `${i + 1}|${a.name}|${short[a.rarity] || "?"}|${a.tags.join(",")}|${a.desc.replace(/\s+/g, " ").replace(/\?/g, "").slice(0, 70)}`);
  catalogCache = { version: data.builtAt, list, text: lines.join("\n") };
  return catalogCache;
}

async function champLine(c) {
  const ch = c?.championId ? await findChampion(c.championId) : null;
  if (!ch) return c?.champion || "?";
  return `${ch.name}(${ch.tags.join("/")},${damageProfile(ch).type}${ch.stats?.attackrange >= 300 ? ",원거리" : ",근접"})`;
}

async function myChampText(me) {
  const d = me?.championId ? await championDetail(me.championId) : null;
  if (!d) return me?.champion || "?";
  const sp = d.spells.map((s) => `${s.key}:${s.name}-${s.desc.replace(/\s+/g, " ").slice(0, 60)}`).join(" / ");
  return `${d.name} [${d.tags.join("/")}, ${d.damage.type}, 사거리 ${d.attackRange}] 패시브:${d.passive.name}-${d.passive.desc.slice(0, 50)} / ${sp}`;
}

// ---------- 칼바람 상점 (완성 아이템, 분류별) ----------
let shopCache = null;
export async function shop() {
  if (shopCache) return shopCache;
  // 완성 아이템 + 2단계 신발 (칼바람에는 3단계 신발이 없어 2단계가 최종)
  const boots = (await searchItems({ completedOnly: false, tags: ["Boots"], limit: 50 })).filter((i) => i.gold >= 900);
  const list = [...await searchItems({ completedOnly: true, limit: 400 }), ...boots];
  const st = (i, k) => Number(i.stats?.[k] || 0) > 0;
  const groups = { "신발": [], "AD·공속·치명타": [], "AP": [], "방어·탱커": [], "기타": [] };
  for (const i of list) {
    const ad = st(i, "FlatPhysicalDamageMod") || st(i, "PercentAttackSpeedMod") || st(i, "FlatCritChanceMod");
    const ap = st(i, "FlatMagicDamageMod");
    const def = st(i, "FlatHPPoolMod") || st(i, "FlatArmorMod") || st(i, "FlatSpellBlockMod");
    if (i.tags?.includes("Boots")) groups["신발"].push(i.name);
    else if (ad) groups["AD·공속·치명타"].push(i.name);
    else if (ap) groups["AP"].push(i.name);
    else if (def) groups["방어·탱커"].push(i.name);
    else groups["기타"].push(i.name);
  }
  const norm = (x) => String(x || "").replace(/[\s·:'"]/g, "").toLowerCase();
  const byNorm = new Map(list.map((i) => [norm(i.name), i.name]));
  shopCache = {
    text: Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => "[" + k + "] " + v.join(", ")).join("\n"),
    /** 상점에 있는 정확한 이름으로 바꿈. 없는 아이템이면 null */
    fix: (n) => byNorm.get(norm(n)) || null,
  };
  return shopCache;
}
const ITEM_RULE = "아이템 규칙: 아래 칼바람 상점 목록에 있는 이름만 정확히 써. 내 챔피언의 피해 유형(AD/AP)과 역할에 맞는 딜 아이템이 중심이고, 딜러에게 [방어·탱커] 아이템은 적 조합상 꼭 필요할 때 상황 아이템으로 1개까지만.";

const FORMAT = `출력 형식 (JSON 하나만, 다른 글 금지):
{"s":"전략 2~3문장","t":{"S+":[번호],"S":[번호],"A":[번호],"B":[번호],"C":[번호],"D":[번호]},"r":{"번호":"18자 이내 이유"},"y":[[이미고른번호,점수바뀌는번호,변화량]],"b":{"core":["아이템"],"sit":[["상황","아이템"]]},"d":기본점수}
규칙: t에 이 챔피언에게 의미 있는 증강을 최대한 많이 (S+~A와 D는 빠짐없이). r은 S+~A와 판단이 갈리는 것만. y는 핵심 조합 10~25개. d는 목록에 없는 증강 점수(보통 40~50). 이유에 다른 증강 이름 금지.`;

async function basePrompt(me, allies, enemies) {
  const cat = await catalog();
  const enemyText = enemies?.length ? (await Promise.all(enemies.map(champLine))).join(", ") : "아직 모름 (일반적인 상황 기준)";
  return `너는 리그 오브 레전드 '무작위 총력전: 아수라장(ARAM: Mayhem)' 증강 전문가야. 도구를 쓰지 말고 JSON만 출력해.
내 챔피언: ${await myChampText(me)}
아군: ${(await Promise.all((allies || []).map(champLine))).join(", ") || "모름"}
적: ${enemyText}
증강 목록 (번호|이름|등급|분류|효과):
${cat.text}

${ITEM_RULE}
칼바람 상점 (완성 아이템):
${(await shop()).text}

${FORMAT}`;
}

async function adjustPrompt(me, allies, enemies, base) {
  const cat = await catalog();
  const ranked = Object.entries(base.scoreById).sort((a, b) => b[1] - a[1]);
  const show = [...ranked.slice(0, 50), ...ranked.slice(-15)].map(([id, s]) => `${id}:${cat.list[id - 1]?.name}=${s}`).join(", ");
  return `너는 리그 오브 레전드 '무작위 총력전: 아수라장' 증강 전문가야. 도구를 쓰지 말고 JSON만 출력해.
내 챔피언: ${await myChampText(me)}
아군: ${(await Promise.all((allies || []).map(champLine))).join(", ")}
적(확정): ${(await Promise.all((enemies || []).map(champLine))).join(", ")}
적을 모를 때 만든 점수표 (번호:이름=점수, 상위 50 + 하위 15): ${show}
적 조합 때문에 점수가 바뀌어야 하는 증강만 고쳐줘 (최대 30개, 목록의 다른 증강도 가능: 번호는 아래 목록 기준).
증강 목록 (번호|이름|등급|분류|효과):
${cat.text}

${ITEM_RULE}
칼바람 상점 (완성 아이템):
${(await shop()).text}

출력 형식 (JSON 하나만): {"s":"적 조합을 반영한 전략 2~3문장","u":{"번호":새점수0~100},"r":{"번호":"18자 이내 새 이유"},"b":{"core":["아이템"],"sit":[["상황","아이템"]]}}`;
}

// ---------- 응답 → 점수표 ----------
const GRADE = { "S+": 95, S: 88, A: 76, B: 62, C: 45, D: 25 };
function toScores(compact) {
  const scoreById = {};
  for (const [g, ids] of Object.entries(compact.t || {})) for (const id of ids || []) scoreById[id] = GRADE[g] ?? 50;
  return scoreById;
}

async function toPlanInput(me, compact, scoreById, reasons) {
  const cat = await catalog();
  const name = (id) => cat.list[Number(id) - 1]?.name;
  const details = Object.entries(scoreById).filter(([id]) => name(id)).map(([id, score]) => ({ name: name(id), score, reason: reasons[id] || "" }));
  const synergies = (compact.y || []).filter((y) => name(y[0]) && name(y[1])).map(([a, b, n]) => ({ ifPicked: name(a), boost: name(b), bonus: Number(n) || 8 }));
  // 상점에 없는 아이템 이름은 버림 (AI가 지어낸 이름·다른 모드 아이템 방지)
  const sh = await shop();
  const build = compact.b ? {
    core: (compact.b.core || []).map(sh.fix).filter(Boolean),
    situational: (compact.b.sit || []).map(([when, item]) => ({ when, item: sh.fix(item) })).filter((x) => x.item),
  } : undefined;
  return { champion: me?.champion || "?", strategy: compact.s || "", tiers: {}, details, synergies, build, defaultScore: compact.d ?? 45 };
}

// ---------- 챔피언별 기본 점수표 (저장/재사용) ----------
async function loadBase(championId) {
  try {
    const j = JSON.parse(await readFile(join(PLANS_DIR, `${championId}.json`), "utf8"));
    const cat = await catalog();
    const engine = await pickEngine();
    if (j.dataVersion !== cat.version || j.pv !== PROMPT_V || j.model !== (engine?.model || "기본") || Date.now() - j.savedAt > 14 * 86400000) return null;
    return j;
  } catch { return null; }
}

/** 픽창: 내 챔피언 기본 점수표 준비 (이미 있거나 만드는 중이면 그대로) */
export function prepareChampion(sel) {
  const id = sel?.me?.championId;
  if (!id) return null;
  const key = `base:${id}`;
  if (running.has(key)) return running.get(key);
  const p = (async () => {
    const cached = await loadBase(id);
    if (cached) return cached;
    const engine = await pickEngine();
    if (!engine) throw new Error("AI 없음");
    const t0 = Date.now();
    Object.assign(setup, { state: "진행 중", step: `기본 점수표 준비 중 (픽창 · ${sel.me.champion})`, engine: engine.name, startedAt: t0, message: "" });
    const compact = await askAI(engine, await basePrompt(sel.me, sel.allies, null));
    const base = { championId: id, champion: sel.me.champion, dataVersion: (await catalog()).version, savedAt: Date.now(), engine: engine.name, model: engine.model || "기본", pv: PROMPT_V, compact, scoreById: toScores(compact), seconds: Math.round((Date.now() - t0) / 1000) };
    await mkdir(PLANS_DIR, { recursive: true });
    await writeFile(join(PLANS_DIR, `${id}.json`), JSON.stringify(base));
    setup.timings.base = base.seconds;
    if (setup.step.startsWith("기본 점수표")) Object.assign(setup, { state: "준비됨", step: `기본 점수표 준비 완료 (${sel.me.champion}, ${base.seconds}초)` });
    return base;
  })();
  running.set(key, p);
  p.catch(() => {}).finally(() => running.delete(key));
  return p;
}

/** 로딩 화면/게임 시작: 기본 점수표 즉시 적용 → 적 조합 보정. 기본이 없으면 한 번에 전체 세팅. */
export async function onGameStart(gameKey, live, { force = false } = {}) {
  const key = `game:${gameKey}`;
  if (running.has(key)) return running.get(key);
  if (!force && setup.gameKey === gameKey && setup.state === "완료") return setup;
  const p = (async () => {
    const engine = await pickEngine();
    Object.assign(setup, { gameKey, engine: engine?.name || null, startedAt: Date.now(), finishedAt: null, timings: { ...setup.timings } });
    if (!engine) { Object.assign(setup, { state: "꺼짐", step: "", message: "AI가 꺼져 있거나 Claude Code·Codex가 없어요. 채팅에서 '세팅'을 해주세요." }); return setup; }
    const me = live?.me, allies = live?.allies || [], enemies = live?.enemies || [];
    try {
      let base = force ? null : await loadBase(me?.championId);
      if (!base && !force && running.has(`base:${me?.championId}`)) {
        Object.assign(setup, { state: "진행 중", step: "기본 점수표 마무리 기다리는 중" });
        base = await running.get(`base:${me.championId}`).catch(() => null);
      }
      const t0 = Date.now();
      if (base) {
        // 1) 기본 점수표 즉시 적용 → 첫 증강부터 점수 표시
        await savePlan(await toPlanInput(me, base.compact, base.scoreById, base.compact.r || {}), gameKey, { source: `AI(${base.engine}·적 반영 전)` });
        Object.assign(setup, { state: "진행 중", step: "적 조합 보정 중 (기본 점수표 적용됨)" });
        // 2) 적 조합 보정
        const adj = await askAI(engine, await adjustPrompt(me, allies, enemies, base));
        const scoreById = { ...base.scoreById };
        for (const [id, s] of Object.entries(adj.u || {})) if (Number.isFinite(Number(s))) scoreById[id] = Math.max(0, Math.min(100, Number(s)));
        const compact = { ...base.compact, s: adj.s || base.compact.s, b: adj.b || base.compact.b };
        await savePlan(await toPlanInput(me, compact, scoreById, { ...(base.compact.r || {}), ...(adj.r || {}) }), gameKey, { source: `AI(${engine.name})` });
        setup.timings.adjust = Math.round((Date.now() - t0) / 1000);
        Object.assign(setup, { state: "완료", step: "", finishedAt: Date.now(), message: `${engine.name} 세팅 완료 · 적 보정 ${setup.timings.adjust}초 (기본 점수표는 픽창에서 준비됨)` });
      } else {
        Object.assign(setup, { state: "진행 중", step: "전체 세팅 중 (픽창 준비분 없음)" });
        const compact = await askAI(engine, await basePrompt(me, allies, enemies));
        await savePlan(await toPlanInput(me, compact, toScores(compact), compact.r || {}), gameKey, { source: `AI(${engine.name})` });
        setup.timings.full = Math.round((Date.now() - t0) / 1000);
        Object.assign(setup, { state: "완료", step: "", finishedAt: Date.now(), message: `${engine.name} 세팅 완료 · ${setup.timings.full}초` });
      }
    } catch (e) {
      Object.assign(setup, { state: "실패", step: "", finishedAt: Date.now(), message: `세팅 실패: ${String(e.message || e).slice(0, 200)}` });
    }
    return setup;
  })();
  running.set(key, p);
  p.finally(() => running.delete(key));
  return p;
}

// ---------- 템 추천 (게임 중, 죽을 때마다 다시) ----------
export const items = { next: [], now: "", why: "", at: 0, engine: null, state: "대기", busy: false };

/** 지금 상황(내 아이템·골드, 적 아이템·KDA, 고른 증강, 이번 판 빌드)으로 다음 아이템을 AI에게 물어봅니다. */
export async function adviseItems(live, { plan, picks = [] } = {}) {
  if (items.busy || !live?.inGame) return items;
  const engine = await pickEngine();
  if (!engine) return items;
  items.busy = true; items.state = "진행 중";
  try {
    const me = live.me;
    const enemyText = live.enemies.map((e) => `${e.champion}(${e.kda}, 템:${e.items.map((i) => i.name).filter((n) => n !== "포로 간식").join("/") || "없음"})`).join(", ");
    const prompt = `리그 오브 레전드 '무작위 총력전: 아수라장' 아이템 코치야. 도구 쓰지 말고 JSON만 출력해.
내 챔피언: ${await myChampText(me)} | 레벨 ${me.level}, KDA ${me.kda}, 보유 골드 ${me.currentGold}
내 아이템: ${me.items.map((i) => i.name).filter((n) => n !== "포로 간식").join(", ") || "없음"}
고른 증강: ${picks.join(", ") || "없음"}
이번 판 계획 빌드: ${plan?.build ? [...(plan.build.core || []), ...(plan.build.situational || []).map((s) => `${s.when}→${s.item}`)].join(", ") : "없음"}
아군: ${live.allies.map((a) => `${a.champion}(${a.kda})`).join(", ")}
적: ${enemyText}
적 피해 성향: ${live.enemyAnalysis?.leaningDamage}, 성장한 적: ${(live.enemyAnalysis?.fed || []).join(", ") || "없음"}
지금 상황에 맞는 다음 완성 아이템 3개(순서대로, 칼바람 상점에 있는 정확한 한글 이름)와 지금 골드로 바로 살 것(부품 포함)을 알려줘.
{"next":["아이템1","아이템2","아이템3"],"now":"지금 살 것","why":"30자 이내 이유"}`;
    const sh = await shop();
    const r = await askAI(engine, prompt + "\n" + ITEM_RULE + " 이미 가진 아이템은 다시 추천하지 마.\n칼바람 상점 (완성 아이템):\n" + sh.text);
    const owned = new Set(me.items.map((i) => i.name));
    const next = [...new Set((r.next || []).map(sh.fix).filter((n) => n && !owned.has(n)))].slice(0, 3);
    Object.assign(items, { next, now: r.now || "", why: r.why || "", at: Date.now(), engine: engine.name, state: "완료" });
  } catch (e) {
    items.state = "실패";
  } finally { items.busy = false; }
  return items;
}

export function cancelAutoSetup() {
  for (const c of children) c.kill();
  children.clear();
  if (setup.state === "진행 중") Object.assign(setup, { state: "취소", step: "", message: "게임이 끝나 세팅을 멈췄어요" });
}
