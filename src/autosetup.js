// 자동 AI 세팅 (빠른 버전)
// - 이 프로그램은 AI API를 직접 부르지 않습니다. 사용자 PC에 로그인된 Claude Code(claude) / Codex(codex) CLI를 실행합니다.
// - 속도: 도구 호출 없이 필요한 정보를 프롬프트에 한 번에 넣고, AI는 증강 '번호'로 된 짧은 JSON만 답합니다.
// - 시점: 픽창에서 내 챔피언 기준 '기본 점수표'를 미리 만들고(챔피언별 저장), 로딩 화면에서 적 조합 '보정'만 합니다.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { aramItems, augments, championDetail, damageProfile, findChampion, findItem, searchItems, stripHtml } from "./data.js";
import { dropLimitDupes, limitRuleText } from "./itembuild.js";
import { APP_DIR } from "./paths.js";
import { MAX_MATCHUP_COMBOS, normalizeAnvils, savePlan } from "./plan.js";
import { getSettings } from "./settings.js";

const run = promisify(execFile);
const PLANS_DIR = join(APP_DIR, "plans");
const PROMPT_V = 8;
const promptVersion = (championId) => championId === "Cassiopeia" ? 9 : PROMPT_V;
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
/**
 * 프롬프트를 표준 입력으로 넘겨 CLI 한 번 실행 → 응답 텍스트.
 * 모든 요청이 'JSON만 답하기'라 도구는 아예 끕니다(시작이 가볍고 도구 설명을 읽지 않음).
 * effort: 생각하는 양. 사용자가 기다리는 요청은 "low", 픽창 백그라운드 점수표는 "medium".
 */
async function askAI(engine, prompt, { signal, timeoutMs = TIMEOUT_MS, effort = "low" } = {}) {
  signal?.throwIfAborted();
  await mkdir(APP_DIR, { recursive: true });
  let args, outFile = null;
  if (engine.kind === "claude") {
    // --strict-mcp-config: 사용자의 다른 MCP 서버를 불러오지 않아 시작이 빠릅니다
    args = ["-p", "--output-format", "json", "--strict-mcp-config", ...(engine.model ? ["--model", engine.model] : []),
      "--tools", "", ...(effort ? ["--effort", effort] : [])];
  } else {
    outFile = join(APP_DIR, `codex-out-${randomUUID()}.txt`);
    args = ["exec", "--skip-git-repo-check", "-s", "read-only", "-c", 'approval_policy="never"', "-o", outFile,
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []), ...(engine.model ? ["-m", engine.model] : []), "-"];
  }
  const text = await new Promise((resolve, reject) => {
    const p = spawn(engine.path, args, { cwd: APP_DIR, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      shell: /\.(cmd|bat)$/i.test(engine.path), signal });
    children.add(p);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", reject);
    p.stdin.on("error", reject);
    p.on("close", async (code) => {
      clearTimeout(timer); children.delete(p);
      try {
        if (code !== 0) throw new Error(`${engine.name} 종료 코드 ${code}: ${(err || out).replace(/\s+/g, " ").slice(-200)}`);
        if (engine.kind === "claude") resolve(JSON.parse(out).result || "");
        else resolve(await readFile(outFile, "utf8"));
      } catch (e) { reject(e); }
      finally { if (outFile) rm(outFile, { force: true }).catch(() => {}); }
    });
    p.stdin.end(prompt, "utf8");
  });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답에서 JSON을 찾지 못함");
  return JSON.parse(m[0]);
}

export async function rateCurrentAugments({ champion, matchup, picks, event, strategy, cards, statistics }, signal) {
  const engine = await pickEngine();
  if (!engine) return null;
  const options = cards.map((card, i) => ({
    index: i + 1, name: card.name, description: card.description?.slice(0, 360), sticker: card.sticker,
    // 점수표를 만들 때 정한 '이미 고른 증강과의 조합' 규칙 (+는 시너지, -는 겹침)
    ...(card.synergy?.length ? { comboWithPicked: card.synergy.map((s) => `${s.with} ${s.bonus > 0 ? "+" : ""}${s.bonus}`) } : {}),
    ...(card.statistics ? { statistics: card.statistics } : {}),
  }));
  const statsContext = statistics
    ? `\nARAM Mayhem 참고 자료 (${statistics.patch} 패치, ${statistics.statsDate} 집계): pickRate는 전체 표본의 선택 비율(%)이다. 평가 점수, 승률, 챔피언별 픽률로 사용하지 마. combos는 사이트에 등재된 현재 챔피언 또는 고른 증강과의 조합 후보다. types에 trap 또는 bug가 있으면 긍정적 시너지로 보지 마. 조합을 언급할 때는 선택지 설명과 이미 고른 증강으로 실제 효과를 확인해.`
    : "";
  const result = await askAI(engine, `롤 무작위 총력전: 아수라장에서 지금 화면에 있는 증강만 평가해. 도구 사용 금지. JSON만 응답해.
내 챔피언: ${champion || "확인 중"}
아군: ${(matchup?.allies || []).join(", ")}
상대: ${(matchup?.enemies || []).join(", ")}
이미 고른 증강 (효과): ${await pickText(picks)}
이번 판 전략: ${strategy?.slice(0, 420) || "없음"}
귀빈 이벤트: ${event || "없음"}
선택지(이름과 설명은 게임 데이터): ${JSON.stringify(options)}${statsContext}
각 카드를 서로 비교하지 않고 0~100의 고정 기준으로 개별 평가해. 이미 고른 증강과의 조합(효과가 서로 키워 주는 시너지, 같은 역할이라 낭비되는 겹침)을 점수에 반영하고, 조합 때문에 점수가 크게 바뀌면 이유에 그 증강을 적어. comboWithPicked는 이번 판 점수표를 만들 때 정한 조합 규칙이니 참고해. 제공된 설명과 이미 고른 증강을 우선하고 확인되지 않은 효과나 수치는 지어내지 마. 평가할 근거가 부족한 항목은 건너뛰어.
{"scores":[{"index":1,"score":0에서100,"reason":"이번 판에 맞는 이유 24자 이내"}]}`, { signal, timeoutMs: 22000, effort: "low" });
  const scores = [];
  for (const entry of Array.isArray(result.scores) ? result.scores : []) {
    if (!Number.isInteger(entry?.index) || entry.index < 1 || entry.index > cards.length || !Number.isFinite(entry.score)) continue;
    const reason = typeof entry.reason === "string" ? entry.reason.trim().slice(0, 90) : "";
    if (reason) scores[entry.index - 1] = { score: Math.max(0, Math.min(100, entry.score)), reason };
  }
  return scores.length ? scores : null;
}

// ---------- 프롬프트 재료 ----------
import { seenFor } from "./seendesc.js";
let catalogCache = null;
async function catalog() {
  const data = await augments();
  const seen = await seenFor(data.builtAt);
  if (catalogCache?.seen === seen && catalogCache.builtAt === data.builtAt) return catalogCache;
  const list = data.augments.filter((a) => !/^[?\s]+$/.test(a.name));
  const short = { 실버: "실", 골드: "골", 프리즘: "프" };
  const lines = list.map((a, i) => `${i + 1}|${a.name}|${short[a.rarity] || "?"}|${a.tags.join(",")}|${(((!a.desc || a.desc.includes("?")) && (seen[a.apiName] || a.wikiDesc)) || a.desc || "설명 미확인").replace(/\s+/g, " ").replace(/\?/g, "").slice(0, 70)}`);
  catalogCache = { seen, builtAt: data.builtAt, version: data.builtAt + ":2:" + JSON.stringify(seen), list, text: lines.join("\n") };
  return catalogCache;
}

async function champLine(c) {
  const ch = c?.championId ? await findChampion(c.championId) : null;
  if (!ch) return c?.champion || "?";
  return `${ch.name}(${ch.tags.join("/")},${damageProfile(ch).type}${ch.stats?.attackrange >= 300 ? ",원거리" : ",근접"})`;
}

async function myChampText(me) {
  const d = me?.championId ? await championDetail(me.championId) : null;
  const name = d?.name || me?.champion || "?";
  // 라이엇 26.1 패치에서 독사의 품격의 장화 구매 제한이 제거됐습니다.
  const shopRule = me?.championId === "Cassiopeia" || name === "카시오페아"
    ? " [현재 상점 규칙: 카시오페아도 칼바람·아수라장에서 장화를 구매할 수 있음. 신발을 빌드 후보에 포함.]"
    : "";
  if (!d) return name + shopRule;
  const sp = d.spells.map((s) => `${s.key}:${s.name}-${s.desc.replace(/\s+/g, " ").slice(0, 60)}`).join(" / ");
  const passive = d.passive.desc.replace(/\s+/g, " ").trim();
  return `${name} [${d.tags.join("/")}, ${d.damage.type}, 사거리 ${d.attackRange}]${shopRule} 패시브:${d.passive.name}-${passive} / ${sp}`;
}

// ---------- 칼바람 상점 (완성 아이템, 분류별) ----------
let shopCache = null;
export async function shop() {
  if (shopCache) return shopCache;
  // 완성 아이템 + 2단계 신발 (칼바람에는 3단계 신발이 없어 2단계가 최종)
  const boots = (await searchItems({ completedOnly: false, tags: ["Boots"], limit: 50 })).filter((i) => i.gold >= 900);
  const list = [...await searchItems({ completedOnly: true, limit: 400 }), ...boots];
  const st = (i, k) => Number(i.stats?.[k] || 0) > 0;
  // 이번 패치 공식 데이터(Data Dragon, 한국어)의 능력치·고유 효과를 한 줄로. AI가 예전 패치 기억으로 판단하지 않게 함
  const raw = new Map((await aramItems()).map((i) => [String(i.id), i]));
  const line = (i) => {
    const d = raw.get(String(i.id));
    const text = d ? stripHtml(d.description).split("\n").map((s) => s.trim()).filter(Boolean) : [];
    // 첫 줄들은 능력치("공격력 40"), 그 뒤는 "효과 이름" 다음 줄에 설명이 오는 구조
    const stats = [], effects = [];
    let k = 0;
    while (k < text.length && /\d/.test(text[k]) && text[k].length <= 24) stats.push(text[k++]);
    for (; k < text.length; k++) {
      if (text[k].length <= 14 && k + 1 < text.length) { effects.push(`${text[k]}: ${text[k + 1]}`); k++; }
      else effects.push(text[k]);
    }
    const body = [stats.join(", "), ...effects].filter(Boolean).join(" | ");
    const cut = body.length > 260 ? body.slice(0, 257) + "…" : body;
    return `- ${i.name} (${i.gold ?? d?.gold?.total ?? "?"}G)${cut ? ": " + cut : ""}`;
  };
  const groups = { "신발": [], "AD·공속·치명타": [], "AP": [], "방어·탱커": [], "기타": [] };
  for (const i of list) {
    const ad = st(i, "FlatPhysicalDamageMod") || st(i, "PercentAttackSpeedMod") || st(i, "FlatCritChanceMod");
    const ap = st(i, "FlatMagicDamageMod");
    const def = st(i, "FlatHPPoolMod") || st(i, "FlatArmorMod") || st(i, "FlatSpellBlockMod");
    if (i.tags?.includes("Boots")) groups["신발"].push(i);
    else if (ad) groups["AD·공속·치명타"].push(i);
    else if (ap) groups["AP"].push(i);
    else if (def) groups["방어·탱커"].push(i);
    else groups["기타"].push(i);
  }
  const norm = (x) => String(x || "").replace(/[\s·:'"]/g, "").toLowerCase();
  const byNorm = new Map(list.map((i) => [norm(i.name), i.name]));
  const filled = Object.entries(groups).filter(([, v]) => v.length);
  const rules = await limitRuleText(await aramItems());
  shopCache = {
    // 세팅(점수표)용: 이름만 → 프롬프트가 짧아 빠름. 빌드는 세팅 직후 아이템 추천(detail 사용)이 다시 맞춤
    text: filled.map(([k, v]) => "[" + k + "] " + v.map((i) => i.name).join(", ")).join("\n") + "\n" + rules,
    // 아이템 추천용: 이번 패치 효과까지
    detail: "(아이템 효과는 이번 패치 공식 데이터야. 네 기억과 다르면 이 설명을 따라.)\n" +
      filled.map(([k, v]) => "[" + k + "]\n" + v.map(line).join("\n")).join("\n") + "\n" + rules,
    /** 상점에 있는 정확한 이름으로 바꿈. 없는 아이템이면 null */
    fix: (n) => byNorm.get(norm(n)) || null,
  };
  return shopCache;
}
const ITEM_RULE = "아이템 규칙: 아래 칼바람 상점 목록에 있는 이름만 정확히 써. 내 챔피언의 피해 유형(AD/AP)과 역할에 맞는 딜 아이템이 중심이고, 딜러에게 [방어·탱커] 아이템은 적 조합상 꼭 필요할 때 상황 아이템으로 1개까지만.";

const ANVIL_RULE = "능력치 모루는 아이템 완성 전에도 획득하거나 살 수 있어. 모루가 제시됐을 때 고를 서로 다른 능력치 3개를 우선순위대로 적어. 챔피언 스킬, 현재 빌드, 증강과 적 위협을 고려하고 수치나 확률은 적지 마.";
const MATCH_RULE = `s에는 "내 역할:", "교전 순서:", "주의할 스킬:"을 각각 줄 첫머리에 두고 개행으로 구분해. 아군과 연계할 타이밍과 상대 스킬에 대응할 방법을 구체적으로 써. 확인할 수 없는 부분은 생략해. c에는 상대 조합에 특히 효과적인 내 증강 2개 조합을 최대 ${MAX_MATCHUP_COMBOS}개 적고 상대 챔피언이나 위협을 이유에 구체적으로 써. 조합의 효과가 겹치면 하나만 남겨. 적 조합을 모르거나 유의미한 조합이 없으면 c는 빈 배열로 둬.`;
const FORMAT = `출력 형식 (JSON 하나만, 다른 글 금지):
{"s":"내 역할과 이번 판 전략","t":{"S+":[번호],"S":[번호],"A":[번호],"B":[번호],"C":[번호],"D":[번호]},"r":{"번호":"18자 이내 이유"},"y":[[이미고른번호,점수바뀌는번호,변화량]],"c":[{"ids":[번호1,번호2],"reason":"상대 조합 대응 이유"}],"b":{"core":["완성 아이템 6개"],"sit":[["상황","아이템"]]},"anvils":[{"stat":"능력치","reason":"짧은 이유"}],"d":기본점수}
규칙: t에 이 챔피언에게 의미 있는 증강을 최대한 많이 (S+~A와 D는 빠짐없이). r에는 상위 5개와 판단이 갈리는 증강의 이유를 반드시 적어. y는 핵심 조합 10~25개. d는 목록에 없는 증강 점수(보통 40~50). b.core는 신발 포함 최종 6칸 완성 빌드를 사는 순서대로 정확히 6개. ${MATCH_RULE} ${ANVIL_RULE}`;

/** 사용자가 다시 세팅할 때 적은 요청 → 프롬프트 문단 */
function noteText(note) {
  return note ? `
★ 사용자 요청 (가장 우선해서 반영해): ${String(note).slice(0, 500)}
` : "";
}

async function basePrompt(me, allies, enemies, note) {
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
${noteText(note)}
${FORMAT}`;
}

async function adjustPrompt(me, allies, enemies, base, note) {
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
${noteText(note)}
최종 점수 기준 상위 5개의 이유는 점수가 그대로여도 적어. ${MATCH_RULE} ${ANVIL_RULE}
출력 형식 (JSON 하나만): {"s":"내 역할과 이번 판 전략","u":{"번호":새점수0~100},"r":{"번호":"18자 이내 새 이유"},"c":[{"ids":[번호1,번호2],"reason":"상대 조합 대응 이유"}],"b":{"core":["신발 포함 최종 6칸 완성 빌드, 사는 순서대로 6개"],"sit":[["상황","아이템"]]},"anvils":[{"stat":"능력치","reason":"짧은 이유"}]}`;
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
  // 하나만 살 수 있는 계열(방관템·신발 등)은 앞 순서 하나만 남김
  const core = compact.b ? await dropLimitDupes([...new Set((compact.b.core || []).map(sh.fix).filter(Boolean))], findItem) : [];
  const build = compact.b ? {
    core,
    situational: (compact.b.sit || []).map(([when, item]) => ({ when, item: sh.fix(item) })).filter((x) => x.item),
  } : undefined;
  const matchupCombos = Array.isArray(compact.c) ? compact.c
    .filter((entry) => Array.isArray(entry?.ids) && entry.ids.length === 2)
    .map(({ ids, reason }) => ({ augments: ids.map(name), reason })) : [];
  return { champion: me?.champion || "?", role: compact.role, strategy: compact.s || "", tiers: {}, details, synergies, build,
    matchupCombos, anvils: compact.anvils, defaultScore: compact.d ?? 45 };
}

// ---------- 챔피언별 기본 점수표 (저장/재사용) ----------
async function loadBase(championId) {
  try {
    const j = JSON.parse(await readFile(join(PLANS_DIR, `${championId}.json`), "utf8"));
    const cat = await catalog();
    const engine = await pickEngine();
    if (j.dataVersion !== cat.version || j.pv !== promptVersion(championId) || j.model !== (engine?.model || "기본") || Date.now() - j.savedAt > 14 * 86400000) return null;
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
    const compact = await askAI(engine, await basePrompt(sel.me, sel.allies, null), { effort: "medium" }); // 픽창 백그라운드라 조금 더 생각
    const base = { championId: id, champion: sel.me.champion, dataVersion: (await catalog()).version, savedAt: Date.now(), engine: engine.name, model: engine.model || "기본", pv: promptVersion(id), compact, scoreById: toScores(compact), seconds: Math.round((Date.now() - t0) / 1000) };
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

/** 이 판 세팅이 지금 진행 중인지 */
export function setupRunning(gameKey) { return running.has(`game:${gameKey}`); }

/** 로딩 화면/게임 시작: 기본 점수표 즉시 적용 → 적 조합 보정. 기본이 없으면 한 번에 전체 세팅. */
export async function onGameStart(gameKey, live, { force = false, note } = {}) {
  const key = `game:${gameKey}`;
  if (running.has(key)) return running.get(key);
  if (!force && setup.gameKey === gameKey && setup.state === "완료") return setup;
  const p = (async () => {
    const engine = await pickEngine();
    if (setup.gameKey !== gameKey) setup.note = "";
    if (note) setup.note = String(note).slice(0, 500);
    Object.assign(setup, { gameKey, engine: engine?.name || null, startedAt: Date.now(), finishedAt: null, timings: { ...setup.timings } });
    if (!engine) { Object.assign(setup, { state: "꺼짐", step: "", message: "AI가 꺼져 있거나 Claude Code·Codex가 없어요. 채팅에서 '세팅'을 해주세요." }); return setup; }
    const me = live?.me, allies = live?.allies || [], enemies = live?.enemies || [];
    try {
      let base = force && !note ? null : await loadBase(me?.championId);
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
        const adj = await askAI(engine, await adjustPrompt(me, allies, enemies, base, setup.note));
        const scoreById = { ...base.scoreById };
        for (const [id, s] of Object.entries(adj.u || {})) if (Number.isFinite(Number(s))) scoreById[id] = Math.max(0, Math.min(100, Number(s)));
        const compact = { ...base.compact, role: adj.role || base.compact.role, s: adj.s || base.compact.s, c: adj.c,
          b: adj.b || base.compact.b, anvils: normalizeAnvils(adj.anvils).length ? adj.anvils : base.compact.anvils };
        await savePlan(await toPlanInput(me, compact, scoreById, { ...(base.compact.r || {}), ...(adj.r || {}) }), gameKey, { source: `AI(${engine.name})` });
        setup.timings.adjust = Math.round((Date.now() - t0) / 1000);
        Object.assign(setup, { state: "완료", step: "", finishedAt: Date.now(), message: `${engine.name} 세팅 완료 · 적 보정 ${setup.timings.adjust}초 (기본 점수표는 픽창에서 준비됨)` });
      } else {
        Object.assign(setup, { state: "진행 중", step: "전체 세팅 중 (픽창 준비분 없음)" });
        const compact = await askAI(engine, await basePrompt(me, allies, enemies, setup.note));
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
/** 고른 증강 이름 → "이름(효과 요약)" : 퀘스트형 증강(예: 궁극의 히드라)의 조건 아이템을 AI가 알 수 있게 */
async function pickText(picks) {
  if (!picks?.length) return "없음";
  const { augments: list } = await augments();
  return picks.map((n) => {
    const a = list.find((x) => x.name === n);
    const d = (a?.desc || "").replace(/\s+/g, " ").trim().slice(0, 140);
    return d ? `${n}(${d})` : n;
  }).join(" / ");
}

export async function adviseItems(live, { plan, picks = [], gameKey, anvilKey, changes = [] } = {}) {
  if (items.busy || !live?.inGame) return items;
  const engine = await pickEngine();
  if (!engine) return items;
  items.busy = true; items.state = "진행 중";
  try {
    const me = live.me;
    const teamText = (list) => list.map((e) => `${e.champion}(${e.kda}, 템:${e.items.map((i) => i.name).filter((n) => n !== "포로 간식").join("/") || "없음"})`).join(", ");
    const enemyText = teamText(live.enemies);
    const totals = (a) => a?.itemTotals ? `방어력 ${a.itemTotals.armor}, 마법 저항력 ${a.itemTotals.mr}, 추가 체력 ${a.itemTotals.hp}, 공격력 ${a.itemTotals.ad}, 주문력 ${a.itemTotals.ap}` : "모름";
    const context = `리그 오브 레전드 '무작위 총력전: 아수라장' 아이템 코치야. 도구 쓰지 말고 JSON만 출력해.
내 챔피언: ${await myChampText(me)} | 레벨 ${me.level}, KDA ${me.kda}, 보유 골드 ${me.currentGold}
내 아이템: ${me.items.filter((i) => i.slot == null || i.slot < 6).map((i) => i.name + (i.completed ? "(완성)" : "")).filter((n) => !n.startsWith("포로 간식")).join(", ") || "없음"}
고른 증강 (효과): ${await pickText(picks)}
이번 판 계획 빌드: ${plan?.build ? [...(plan.build.core || []), ...(plan.build.situational || []).map((s) => `${s.when}→${s.item}`)].join(", ") : "없음"}
아군: ${teamText(live.allies)}
적: ${enemyText}
적 아이템 합계: ${totals(live.enemyAnalysis)} | 적 탱커: ${(live.enemyAnalysis?.tanks || []).join(", ") || "없음"}
우리 팀 아이템 합계: ${totals(live.allyAnalysis)} | 우리 탱커: ${(live.allyAnalysis?.tanks || []).join(", ") || "없음"}
${changes.length ? `방금 새로 완성한 아이템: ${changes.join(", ")}
` : ""}
${setup.note ? `사용자 요청 (우선 반영): ${setup.note}
` : ""}적 피해 성향: ${live.enemyAnalysis?.leaningDamage}, 성장한 적: ${(live.enemyAnalysis?.fed || []).join(", ") || "없음"}`;
    if (anvilKey) {
      const r = await askAI(engine, `${context}
이미 아이템 6칸을 완성했어. 예정 빌드보다 현재 보유 아이템을 기준으로 판단해. ${ANVIL_RULE}
{"anvils":[{"stat":"능력치","reason":"짧은 이유"}]}`);
      items.anvilAdvice = { key: anvilKey, ranked: normalizeAnvils(r.anvils) };
      items.state = "완료";
      return items;
    }
    const prompt = `${context}
지금 상황에 맞는 최종 6칸 완성 빌드(신발 포함)를 알려줘.
적과 우리 팀이 실제로 산 아이템을 보고 정해: 적이 방어력·마법 저항력을 쌓으면 관통, 체력을 쌓으면 최대 체력 비례 피해, 회복이 크면 치유 감소(우리 팀에 이미 치유 감소가 충분하면 중복하지 말 것), 적 주 딜러의 피해 유형과 핵심 아이템에 맞춰 방어템, 우리 팀에 앞라인이 없으면 생존 비중을 높여.
why 에는 바꾼 이유를 적 또는 아군 아이템을 들어 써 (예: "말파이트 가시 갑옷 → 관통 먼저"). 이미 가진 완성 아이템 중 계속 쓸 것은 앞에 그대로 넣고, 남은 칸은 사야 할 순서대로 채워 정확히 6개 (칼바람 상점의 정확한 한글 이름).
${ANVIL_RULE}
{"build":["아이템1","아이템2","아이템3","아이템4","아이템5","아이템6"],"why":"40자 이내 이유","anvils":[{"stat":"능력치","reason":"짧은 이유"}]}`;
    const sh = await shop();
    const r = await askAI(engine, prompt + "\n" + ITEM_RULE + " 같은 아이템을 두 번 넣지 마. 고른 증강에 퀘스트(조건: 특정 아이템 보유)가 있으면 그 조건 아이템을 최우선으로 추천하고, 증강 보상으로만 받는 아이템은 상점에 없으니 추천하지 마.\n칼바람 상점 (완성 아이템):\n" + sh.detail);
    const owned = me.items.filter((i) => i.completed);
    const build = (await dropLimitDupes([...new Set((r.build || r.next || []).map(sh.fix).filter(Boolean))], findItem, owned)).slice(0, 6);
    const ranked = normalizeAnvils(r.anvils);
    if (ranked.length) items.midAnvilAdvice = { gameKey, ranked };
    Object.assign(items, { build, next: build, why: r.why || "", at: Date.now(), engine: engine.name, state: "완료" });
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
