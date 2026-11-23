// 여러 프로세스(단독 프로그램, 데스크톱 채팅·Claude Code의 MCP 서버)가 동시에 켜져도
// 화면 감시·오버레이·자동 세팅은 하나만 돌게 합니다.
// 127.0.0.1:47321 을 잡은 쪽이 '리더'. 단독 프로그램(app)은 MCP 리더에게서 리더를 넘겨받습니다(/handoff).
import http from "node:http";
import { spawn } from "node:child_process";
import { addPick, loadPicks, loadPlan, resetPicks, scoreOffer } from "./plan.js";
import { currentGameKey, liveGame } from "./live.js";
import { champSelect, gameClientVersion, gameWindowMode, loadingGame } from "./lcu.js";
import { buyNow, dropLimitDupes, inventory, remainingCost } from "./itembuild.js";
import { logOffer, startWatcher, stopWatcher, state as watch } from "./watcher.js";
import { APP_VERSION, IS_EXE, ensureResources, resPath } from "./paths.js";
import { getSettings, updateSettings } from "./settings.js";
import { adviseItems, cancelAutoSetup, detectEngines, items as itemAdvice, onGameStart, prepareChampion, rateCurrentAugments, setup, setupRunning, shop } from "./autosetup.js";
import { aramItems, findItem, norm, version } from "./data.js";
import { uninstall } from "./install.js";
import { cardDetails, test, testAction, testState } from "./testmode.js";
import { update } from "./update.js";
import { publicPatch } from "./mayhemstats.js";

// 증강 카드 반 너비 (화면 너비 비율). 카드 크기는 화면 높이를 따라가므로 16:9 에서 약 0.083 → 비율에 맞춰 환산, 약간 여유
// 카드 반 너비(화면 너비 비율). 화면 비율을 잘못 읽어도 카드 밖 클릭을 받지 않도록 상한을 둠
const cardHalfW = () => Math.min(0.11, 0.09 * (16 / 9) / (watch.aspect || 16 / 9));
const PORT = Number(process.env.LOL_COORD_PORT || 47321);
export const coord = { role: "시작 전", isApp: false, gameKey: null, inGame: false, pendingPick: null, lastPick: null, champion: null };
export const offerContext = () => ({ event: watch.event, gameKey: coord.gameKey, gameVersion: coord.gameVersion, championId: coord.championId });

const leader = { srv: null, timers: [], overlay: null, overlayStopped: false };

const sendJson = (res, obj, code = 200) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

function openOffer(offer, maxAge = 3500) {
  return Boolean(offer && !offer.closedAt && !offer.collapsedAt && Date.now() - offer.lastSeenAt < maxAge);
}

/**
 * 지금 선택 화면이 보이는 중이라 카드 클릭을 받을 수 있는지.
 * 예전엔 새로고침 직후처럼 인식이 잠깐 흔들릴 때(unstable)도 막아서, 그때 고른 증강이 기록되지 않았음.
 * 흔들리는 중에 누른 클릭도 받아 두고, 확정은 선택 화면이 실제로 사라질 때 합니다(settlePick).
 */
export function clickableOffer(offer) {
  return openOffer(offer, 2200) && !offer.absentSince &&
    offer.panelEpoch === watch.captureEpoch && watch.lastLeagueFrameAt - offer.lastSeenAt < 1500;
}

async function overlayState() {
  const s = await getSettings();
  const o = watch.offer;
  const onScreen = openOffer(o);
  const lastPick = coord.lastPick && Date.now() - coord.lastPick.at < 6000 ? coord.lastPick : null;
  const common = { enabled: s.overlay, scale: s.overlayScale, offsetY: s.overlayOffsetY, lastPick, setupState: setup.state, setupEngine: setup.engine,
    fullscreen: coord.windowMode === 0 && !test.active, items: coord.itemsView && coord.inGame ? { ...coord.itemsView, show: coord.itemsView.dead || Date.now() < coord.affordUntil } : null };
  common.clickable = clickableOffer(o);
  if (!onScreen) return { show: false, ...common };
  const scored = await scoreOffer(o, offerContext());
  return { show: true, ...scored, event: watch.event?.name || null, offerId: o.at, offerRevision: o.changedAt || o.at, ...common };
}

/** 설정창에 보여줄 상태 묶음 */
async function statusState() {
  const plan = await loadPlan();
  const matchPlan = plan && (!coord.gameKey || plan.gameKey === coord.gameKey) ? plan : null;
  const picks = await loadPicks(coord.gameKey || matchPlan?.gameKey);
  const matchState = coord.inGame ? "live" : (coord.gameKey || matchPlan?.gameKey || picks.length) ? "previous" :
    matchPlan ? "preview" : "idle";
  const ranked = matchPlan ? Object.values(matchPlan.scores).sort((a, b) => b.score - a.score) : [];
  const pickedNames = new Set(picks.map((pick) => norm(pick.name)));
  const recommendations = ranked.filter((entry) => !pickedNames.has(norm(entry.name))).slice(0, 5);
  return {
    version: APP_VERSION, role: coord.role, inGame: coord.inGame, matchState, champion: coord.champion, gameKey: coord.gameKey,
    watch: watch.status, event: watch.event?.name || null,
    setup: { ...setup },
    plan: matchPlan
      ? { source: plan.source, champion: plan.champion, role: plan.role, strategy: plan.strategy, build: plan.build,
        top: ranked.slice(0, 5).map((x) => `${x.name} (${x.score})`), recommendations, anvils: plan.anvils,
        matchupCombos: plan.matchupCombos, plannedItems: plannedItems(plan.build) }
      : null,
    matchup: coord.inGame ? coord.matchup || null : null,
    picks: picks.map((p) => p.name),
    pickInfo: picks.map((p) => ({ name: p.name, rarity: p.rarity || null, icon: p.icon || null })),
    items: coord.inGame ? coord.itemsView || null : null,
    offer: openOffer(watch.offer) ? (await scoreOffer(watch.offer, offerContext()))?.cards.map((c) => `${c.name} ${c.grade}${c.score ?? ""}${c.isPick ? " ★" : ""}`) : [],
    engines: await detectEnginesCached(),
    settings: await getSettings(),
    update,
    exePath: process.execPath,
  };
}

function itemIcon(patch, id) {
  return id ? `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${id}.png` : null;
}

const itemPreviews = new WeakMap();
function plannedItems(build) {
  if (!build?.core?.length) return [];
  let entry = itemPreviews.get(build);
  if (!entry) {
    entry = { rows: build.core.map((name) => ({ name })), retryAt: 0 };
    itemPreviews.set(build, entry);
  }
  if (Date.now() >= entry.retryAt) {
    entry.retryAt = Infinity;
    Promise.all([aramItems(), version()]).then(([list, patch]) => {
      entry.rows = build.core.map((name) => {
        const item = list.find((candidate) => norm(candidate.name) === norm(name));
        return { name, id: item?.id, gold: item?.gold?.total, icon: itemIcon(patch, item?.id) };
      });
    }).catch(() => {
      entry.retryAt = Date.now() + 30000;
    });
  }
  return entry.rows;
}

let enginesCache = null;
async function detectEnginesCached() {
  if (!enginesCache || Date.now() - enginesCache.at > 60000) enginesCache = { at: Date.now(), v: await detectEngines() };
  return { claude: Boolean(enginesCache.v.claude), codex: Boolean(enginesCache.v.codex) };
}

function handle(req, res) {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  if (p === "/info") return sendJson(res, { app: coord.isApp, version: APP_VERSION, pid: process.pid });
  if (p === "/state") return sendJson(res, { offer: watch.offer, status: watch.status, lastLeagueFrameAt: watch.lastLeagueFrameAt, history: watch.history, ...offerContext() });
  if (p === "/overlay") return overlayState().then((s) => sendJson(res, s), () => sendJson(res, { show: false }));
  if (p === "/status") return statusState().then((s) => sendJson(res, s), (e) => sendJson(res, { error: String(e) }, 500));
  if (p === "/settings" && req.method === "POST") return readBody(req).then(async (b) => { const s = await updateSettings(b); await applyAutostart(s); sendJson(res, s); });
  if (p === "/settings") return getSettings().then((s) => sendJson(res, s));
  if (p === "/resetup" && req.method === "POST") {
    // 본문 { note: "사용자 요청" } 이 있으면 AI 프롬프트에 가장 우선해서 넣습니다 (예: "방관템은 하나만, 탱템 위주로")
    return readBody(req).then((body) => {
      if (!coord.gameKey || !coord.inGame) return sendJson(res, { ok: false, message: "진행 중인 게임이 없어요" });
      if (setupRunning(coord.gameKey)) return sendJson(res, { ok: false, message: "AI가 아직 분석 중이에요. 끝난 뒤 다시 보내 주세요" });
      const note = typeof body?.note === "string" ? body.note.trim() : "";
      Object.assign(itemAdvice, { at: 0 }); // 세팅이 끝나면 템 추천도 새 요청으로 다시 받음
      liveGame(EMPTY_MEMORY).then((live) => onGameStart(coord.gameKey, live, { force: true, note }));
      sendJson(res, { ok: true });
    });
  }
  if (p === "/click" && req.method === "POST") {
    // 오버레이가 감지한 카드 영역 클릭 → 선택 화면이 사라지면 그 카드를 고른 증강으로 확정
    const x = Number(u.searchParams.get("x"));
    const o = watch.offer;
    // 같은 선택지면 받음. 새로고침 직후 오버레이가 아직 옛 번호(revision)를 갖고 있어도 지금 그 자리의 카드로 기록
    // (예전엔 번호가 다르면 말없이 버려서, 새로고침 직후 고른 증강이 빠졌음)
    const why = !o ? "선택지 없음" : !clickableOffer(o) ? (o.absentSince ? "선택 화면 닫히는 중" : "선택 화면이 안 보임")
      : Number(u.searchParams.get("offer")) !== o.at ? "다른 선택지" : null;
    if (why) {
      logOffer(`클릭 무시 (${why}, x=${x})`);
      return sendJson(res, { ok: true, pending: coord.pendingPick?.name || null });
    }
    // 첫 클릭만 인정: 카드를 고르면 선택 화면이 사라지는 1~2초 동안 게임 화면을 클릭해도 덮어쓰지 않음.
    // 단, 앞 클릭 뒤에도 선택 화면이 1.5초 넘게 그대로 보였으면 앞 클릭은 고른 게 아니었으므로 새 클릭으로 바꿈
    const stillShown = coord.pendingPick && o && o.lastSeenAt - coord.pendingPick.at > 1500;
    if (coord.pendingPick?.offer === o && coord.pendingPick.epoch === watch.captureEpoch && !(o.rerolledAt > coord.pendingPick.at) && !stillShown) {
      logOffer(`추가 클릭 무시 (이미 고름: ${coord.pendingPick.name}, x=${x})`);
      return sendJson(res, { ok: true, pending: coord.pendingPick.name });
    }
    if (o?.names?.length && o.xs?.every((v) => v != null) && Number.isFinite(x)) {
      const i = o.xs.reduce((b, v, j) => (Math.abs(v - x) < Math.abs(o.xs[b] - x) ? j : b), 0);
      // 카드 바깥(카드 사이 빈 곳, 화면 가장자리)을 누른 건 고른 게 아님. 예전엔 이런 클릭이 가장 가까운 카드로 잡혀서
      // 진짜로 카드를 눌렀을 때 '이미 고름'으로 무시되는 일이 있었음 (첫 증강이 기록 안 되던 원인)
      if (Math.abs(o.xs[i] - x) > cardHalfW()) {
        logOffer(`카드 밖 클릭 무시 (x=${x})`);
        return sendJson(res, { ok: true, pending: coord.pendingPick?.name || null });
      }
      const again = coord.pendingPick && coord.pendingPick.offer === o;
      coord.pendingPick = { name: o.names[i], at: Date.now(), offer: o, epoch: watch.captureEpoch, gameKey: coord.gameKey };
      logOffer(`${again ? "다시 클릭(앞 클릭 뒤에도 선택 화면 그대로)" : "카드 클릭"}: ${o.names[i]} (x=${x})`);
    }
    return sendJson(res, { ok: true, pending: coord.pendingPick?.name || null });
  }
  // ----- 게임 없이 테스트 (설정 > 테스트) -----
  if (p === "/test/state") return cardDetails().then((cards) => sendJson(res, { ...testState(), cardInfo: cards }));
  if (p === "/test/action" && req.method === "POST") {
    const what = u.searchParams.get("do"), arg = u.searchParams.get("arg");
    if (what === "start" && coord.inGame && !test.active) return sendJson(res, { ok: false, message: "실제 게임이 진행 중이라 테스트를 시작할 수 없어요" });
    // 테스트를 새로 시작할 때마다 새 판처럼: 이전 테스트의 고른 증강을 지우고 게임 시작 처리를 다시 하게 함
    const prep = what === "start" ? resetPicks(null, { force: true }).then(() => { coord.gameKey = null; coord.inGame = false; }) : Promise.resolve();
    return prep.then(() => testAction(what, arg)).then((s) => { if (what !== "start" && what !== "end") logOffer(`[테스트] ${what}${arg != null ? " " + arg : ""}`); else logOffer(`[테스트] ${what === "start" ? "시작" : "끝"}`); sendJson(res, { ok: true, ...s }); });
  }
  if (p === "/event" && req.method === "POST") return readBody(req).then((b) => { watch.event = b && b.id ? b : null; sendJson(res, { ok: true }); });
  if (p === "/handoff" && req.method === "POST") {
    // 단독 프로그램이 켜지면 MCP 리더는 리더를 넘기고 팔로워가 됩니다
    if (coord.isApp) return sendJson(res, { ok: false, app: true });
    sendJson(res, { ok: true });
    setTimeout(() => relinquish(), 50);
    return;
  }
  if (p === "/uninstall" && req.method === "POST") {
    if (!coord.isApp) return sendJson(res, { ok: false });
    sendJson(res, { ok: true });
    uninstall().finally(() => setTimeout(() => process.exit(0), 200));
    return;
  }
  if (p === "/quit" && req.method === "POST") {
    sendJson(res, { ok: true });
    if (coord.isApp) setTimeout(() => process.exit(0), 100);
    return;
  }
  res.writeHead(404).end();
}

// 클릭 후 선택 화면이 사라지면(새 프레임에 선택지가 안 보이면) 고른 증강으로 확정
export async function settlePick() {
  const p = coord.pendingPick;
  if (!p) {
    // 카드를 누르지 않았는데 선택 화면이 1.2초 넘게 사라짐 → 사용자가 증강 창을 접은 것.
    // 다시 펼치면 화면 감시가 처음부터 다시 읽음 (OCR이 잘못 읽은 카드를 바로잡는 방법)
    const o = watch.offer;
    if (o && !o.closedAt && !o.collapsedAt && o.absentSince && o.absentFrames >= 3 &&
      watch.lastLeagueFrameAt - o.absentSince >= 1200) {
      o.collapsedAt = watch.lastLeagueFrameAt;
      logOffer(`증강 창 접힘 (카드 클릭 없음): ${o.names.join(" / ")} → 다시 펼치면 새로 읽음`);
    }
    return;
  }
  const o = watch.offer;
  const age = Date.now() - p.at;
  // 선택지가 통째로 바뀌었거나, 클릭한 뒤 새로고침이 있었으면 취소 (늦게 읽힌 카드가 추가된 것은 괜찮음)
  const rerolled = o && o.rerolledAt > p.at;
  // 선택 화면을 오래 들여다봐도 취소하지 않음 (예전엔 12초 뒤 취소돼 고른 증강이 빠졌음). 1분이 지나면 정리
  const interrupted = p.epoch !== watch.captureEpoch || p.gameKey !== coord.gameKey;
  if (!o || o.closedAt || o !== p.offer || rerolled || interrupted || age > 60000) {
    coord.pendingPick = null;
    logOffer(`클릭 취소 (${!o || o.closedAt ? "선택지 닫힘" : o !== p.offer ? "선택지 바뀜" : rerolled ? "새로고침" : interrupted ? "캡처 또는 경기 전환" : "시간 초과"}): ${p.name}`);
    return;
  }
  // 정상 캡처에서 카드 테두리가 연속으로 사라지면 확정합니다.
  // 마지막 OCR 변경이 아직 확인 중(unstable)이면 조금 더(1.5초) 기다림. 예전엔 이 표시가 선택 화면이 닫힌 뒤에도
  // 풀리지 않아 클릭한 증강이 1분 뒤 '시간 초과'로 버려졌음.
  const absentFor = watch.lastLeagueFrameAt - o.absentSince;
  if (o.panelEpoch === p.epoch && o.absentSince > p.at && o.absentFrames >= 3 &&
    absentFor >= (o.unstable ? 1500 : 750)) {
    o.closedAt = watch.lastLeagueFrameAt;
    coord.pendingPick = null;
    logOffer(`선택 확정: ${p.name}`);
    await addPick(p.name, p.gameKey, "오버레이 클릭 자동 기록", { offerId: o.at });
    if (coord.gameKey === p.gameKey) coord.lastPick = { name: p.name, at: Date.now() };
  }
}

let offerJob = null;
let readingOffer = false;
export async function refreshOfferAdvice(rate = rateCurrentAugments) {
  const offer = watch.offer;
  const gameKey = coord.gameKey;
  if (offerJob && (offerJob.offer !== offer || !coord.inGame || offer.closedAt))
    offerJob.controller.abort();
  if (!coord.isApp || !coord.inGame || !openOffer(offer) || readingOffer) return;
  const isCurrent = () => coord.inGame && coord.gameKey === gameKey && watch.offer === offer && !offer.closedAt;
  let scored, plan;
  readingOffer = true;
  try {
    [scored, plan] = await Promise.all([scoreOffer(offer, offerContext()), loadPlan()]);
  } catch { return; }
  finally { readingOffer = false; }
  if (!isCurrent() || !scored) return;

  if (offer.analysis?.scope !== scored.analysisScope)
    offer.analysis = { scope: scored.analysisScope, pending: false, scores: {} };
  const analysis = offer.analysis;
  if (offerJob) {
    // 리롤되지 않은 카드가 남아 있으면 진행 중인 평가를 받아 다음 요청에서 재사용합니다.
    if (offerJob.analysis !== analysis || !scored.cards.some((card) => offerJob.keys.has(card.evaluationKey)))
      offerJob.controller.abort();
    return;
  }
  const cards = scored.cards.filter((card) => !Object.hasOwn(analysis.scores, card.evaluationKey));
  if (!cards.length) return;
  const controller = new AbortController();
  const job = { offer, analysis, keys: new Set(cards.map((card) => card.evaluationKey)), controller };
  offerJob = job;
  analysis.pending = true;
  const started = Date.now();
  let scores;
  try {
    scores = await rate({
      champion: coord.champion, matchup: coord.matchup, picks: scored.picks, event: watch.event?.name,
      strategy: plan?.gameKey === gameKey ? plan.strategy : null, cards, statistics: scored.statistics,
    }, controller.signal);
  } catch {}
  finally {
    if (isCurrent() && !controller.signal.aborted && offer.analysis === analysis) {
      cards.forEach((card, i) => { analysis.scores[card.evaluationKey] = scores?.[i] ?? null; });
      logOffer(`증강 세부 분석: ${scores?.filter(Boolean).length || 0}/${cards.length}개 · ${Date.now() - started}ms`);
    }
    analysis.pending = false;
    if (offerJob === job) offerJob = null;
  }
}

/** 새 게임 시작: (프로그램 모드면) AI 자동 세팅. 점수는 AI만 정합니다 (AI 세팅 전엔 오버레이에 "AI 분석 중") */
let patchCheckedAt = 0;
function updateGamePatch(live, key) {
  if (publicPatch(live?.gameVersion)) { coord.gameVersion = live.gameVersion; return; }
  if (coord.gameVersion || test.active || Date.now() - patchCheckedAt < 30000) return;
  patchCheckedAt = Date.now();
  gameClientVersion().then((version) => {
    if (coord.gameKey === key && !coord.gameVersion && publicPatch(version)) coord.gameVersion = version;
  }).catch(() => {});
}

async function onNewGame(key) {
  watch.event = null; watch.offer = null; watch.history = [];
  coord.pendingPick = null; coord.lastPick = null; coord.itemsView = null; coord.matchup = null; coord.affordUntil = 0;
  coord.gameVersion = null; coord.championId = null; patchCheckedAt = 0;
  Object.assign(itemAdvice, { next: [], now: "", why: "", at: 0, state: "대기", anvilAdvice: null, midAnvilAdvice: null });
  await resetPicks(key);
  const live = await liveGame(EMPTY_MEMORY).catch(() => null);
  coord.champion = live?.me?.champion || null;
  coord.championId = live?.me?.championId || null;
  updateGamePatch(live, key);
  if (coord.champion) coord.matchup = matchTeams(live);
  const plan = await loadPlan();
  // 이번 판 AI 점수표가 이미 있으면 그대로 (프로그램을 게임 중에 다시 켠 경우). 적 반영 전 상태로 끊겼으면 이어서 세팅
  const done = plan && plan.gameKey === key && String(plan.source).startsWith("AI") && !String(plan.source).includes("적 반영 전");
  if (coord.isApp && !done) onGameStart(key, live);
}

const EMPTY_MEMORY = { myChampion: null, allies: [], enemies: [], myAugments: [], notes: [] };

function matchTeams(live) {
  const names = (players) => players.map((player) => player?.champion).filter(Boolean);
  return { allies: names([live.me, ...(live.allies || [])]), enemies: names(live.enemies || []) };
}

// 픽창: 내 챔피언이 3초 동안 그대로면 그 챔피언 기본 점수표를 미리 만듭니다 (다시 굴리기·벤치 교체 대비)
const pick = { id: null, since: 0 };
async function watchChampSelect() {
  const sel = await champSelect();
  const id = sel?.me?.championId || null;
  if (id !== pick.id) { pick.id = id; pick.since = Date.now(); return; }
  if (id && Date.now() - pick.since >= 3000) prepareChampion(sel)?.catch(() => {});
}

let polling = false;
async function pollGame() {
  if (polling) return;
  polling = true;
  try { await pollGameOnce(); } finally { polling = false; }
}
async function pollGameOnce() {
  // 게임 중이면 Live API, 아직 로딩 화면이면 롤 클라이언트(LCU)로 같은 키를 얻습니다 → 로딩 중에 AI 세팅 시작
  let key = await currentGameKey();
  if (!key) key = (await loadingGame())?.key || null;
  if (!key && coord.isApp) await watchChampSelect();
  if (key && key !== coord.gameKey) { coord.gameKey = key; coord.inGame = true; await onNewGame(key); }
  if (!key && coord.inGame) { coord.inGame = false; cancelAutoSetup(); }
}

// ---------- 템 추천: 3초마다 내 상태 확인 → 죽으면 AI에게 다시 묻고, 다음 템 골드가 모이면 잠깐 알림 ----------
coord.affordUntil = 0;
let wasDead = false, lastAdviceAt = 0, lastPickKey = "", lastAffordName = null, lastAnvilKey = null, itemTicking = false;
// 아군·적이 완성한 아이템 기록 (새 완성템이 생기면 빌드를 다시 물어봄)
let teamItems = { gameKey: null, seen: new Map(), changes: [] };
const TEAM_ADVICE_GAP = 60000; // 팀 아이템 변화로 다시 묻는 최소 간격

/** 다른 9명의 완성 아이템을 이전과 비교해 새로 완성한 것만 changes 에 쌓습니다. 첫 확인은 기준만 잡음. */
function trackTeamItems(live, gameKey) {
  if (teamItems.gameKey !== gameKey) teamItems = { gameKey, seen: new Map(), changes: [], ready: false };
  const players = [...live.allies.map((p) => ["아군", p]), ...live.enemies.map((p) => ["적", p])];
  for (const [side, p] of players) {
    const key = `${side}:${p.champion}`;
    const now = new Set(p.items.filter((i) => i.completed).map((i) => i.name));
    const before = teamItems.seen.get(key);
    if (teamItems.ready && before) for (const n of now) if (!before.has(n)) teamItems.changes.push(`${side} ${p.champion}: ${n}`);
    teamItems.seen.set(key, now);
  }
  teamItems.ready = true;
}
async function itemTick() {
  if (itemTicking || !coord.inGame) return;
  itemTicking = true;
  try {
    coord.windowMode = await gameWindowMode();
    const live = await liveGame(EMPTY_MEMORY).catch(() => null);
    if (!live?.inGame) return;
    coord.championId = live.me.championId || coord.championId;
    updateGamePatch(live, coord.gameKey);
    if (!coord.matchup?.enemies.length) coord.matchup = matchTeams(live);
    const plan = await loadPlan();
    const picks = (await loadPicks(coord.gameKey)).map((p) => p.name);
    const dead = Boolean(live.me.dead);
    // 아이템 칸(장신구 제외 6칸)이 완성 아이템으로 다 찼으면 더 추천하지 않음
    const slotItems = live.me.items.filter((i) => i.slot == null || i.slot < 6);
    const doneItems = slotItems.filter((i) => i.completed);
    const full = doneItems.length >= 6;
    const matchPlan = plan?.gameKey === coord.gameKey ? plan : null;
    const anvilKey = full ? JSON.stringify([coord.gameKey, doneItems.map((i) => i.id).sort(), picks]) : null;
    if (coord.isApp && anvilKey && anvilKey !== lastAnvilKey && !itemAdvice.busy) {
      lastAnvilKey = anvilKey;
      adviseItems(live, { plan: matchPlan, picks, anvilKey });
    }
    const finalAnvils = itemAdvice.anvilAdvice?.key === anvilKey ? itemAdvice.anvilAdvice.ranked : null;
    const midAnvils = itemAdvice.midAnvilAdvice?.gameKey === coord.gameKey ? itemAdvice.midAnvilAdvice.ranked : null;
    // 다시 물어볼 때: 죽었을 때(45초 간격), 처음 세팅이 끝났을 때, 새 증강을 골랐을 때(15초 간격, 퀘스트 증강 대응),
    // 아군·적이 새 아이템을 완성했을 때(60초 간격, 그 사이 변화는 모아서 한 번에)
    trackTeamItems(live, coord.gameKey);
    const pickKey = `${coord.gameKey}:${picks.length}`;
    const newPick = picks.length > 0 && pickKey !== lastPickKey;
    const teamChanged = teamItems.changes.length > 0 && Date.now() - lastAdviceAt > TEAM_ADVICE_GAP;
    const needAdvice = coord.isApp && !full && !itemAdvice.busy && (
      (Date.now() - lastAdviceAt > 45000 && ((dead && !wasDead) || (!itemAdvice.at && setup.state === "완료"))) ||
      (newPick && Date.now() - lastAdviceAt > 15000) || teamChanged);
    if (needAdvice) lastPickKey = pickKey;
    const wasDeadBefore = wasDead;
    wasDead = dead;
    if (needAdvice) {
      const because = dead && !wasDeadBefore ? "죽음" : newPick ? "증강 선택" : teamChanged ? "팀 아이템 변화" : "세팅 완료";
      logOffer(`[아이템] 추천 요청 (${because})`);
      lastAdviceAt = Date.now();
      const changes = teamItems.changes.splice(0);
      adviseItems(live, { plan: matchPlan, picks, gameKey: coord.gameKey, changes });
    }
    // 보여줄 목록: AI 추천(최근 것) → 없으면 이번 판 계획 빌드
    const useAI = itemAdvice.at && Date.now() - itemAdvice.at < 10 * 60000;
    const planned = useAI ? (itemAdvice.build || itemAdvice.next) : (matchPlan?.build?.core || []);
    // 하나만 살 수 있는 계열(방관템·신발 등)은 이미 가진 것/앞 순서 것만 남김 (예: 도미닉을 샀으면 필멸자·세릴다 제외)
    const names = await dropLimitDupes(planned || [], findItem, doneItems);
    const v = await version();
    const icon = (id) => itemIcon(v, id);
    const gold = Math.floor(live.me.currentGold || 0);
    // 가진 하위 아이템은 빼고 남은 골드를 계산 (앞 순서 아이템이 쓴 재료는 뒤 아이템에서 다시 쓰지 않음)
    // 6칸 완성 빌드: 이미 산 완성 아이템(✓) + 앞으로 살 아이템(사는 순서, 남은 칸 수만큼)
    const haveIds = new Set(doneItems.map((i) => String(i.id)));
    const have = [], next = [];
    for (const n of names) {
      const it = await findItem(n);
      if (!it) continue;
      if (haveIds.has(String(it.id))) { have.push({ name: it.name, id: it.id, icon: icon(it.id), have: true }); haveIds.delete(String(it.id)); }
      else next.push(it);
    }
    for (const i of doneItems) if (haveIds.has(String(i.id))) { have.push({ name: i.name, id: String(i.id), icon: icon(i.id), have: true, offPlan: true }); haveIds.delete(String(i.id)); }
    const room = Math.max(0, 6 - doneItems.length);
    const inv = inventory(live.me.items);
    const todo = [];
    for (const it of next.slice(0, room)) {
      const r = await remainingCost(it.id, inv);
      todo.push({ name: it.name, id: it.id, gold: it.gold?.total ?? null, remain: r.cost, owned: r.used, icon: icon(it.id) });
    }
    // 지금 살 것: 1순위를 완성할 수 있으면 완성, 아니면 1순위의 재료 중 지금 살 수 있는 가장 비싼 것
    const b = !full && todo[0]?.id ? await buyNow(todo[0].id, live.me.items, gold) : null;
    const buy = b ? { name: b.name, cost: b.cost, icon: icon(b.id), complete: b.complete, affordable: b.affordable, need: b.need || 0, forItem: todo[0].name } : null;
    if (buy?.affordable && lastAffordName !== buy.name) { lastAffordName = buy.name; coord.affordUntil = Date.now() + 8000; }
    coord.itemsView = {
      build: [...have, ...todo], next: full ? [] : todo, full, haveCount: doneItems.length, buy, gold, dead, respawnIn: live.me.respawnIn || null,
      anvils: finalAnvils?.length ? finalAnvils : midAnvils || matchPlan?.anvils || [],
      why: full ? "6칸 완성 빌드를 다 샀어요" : useAI ? itemAdvice.why : (plan?.strategy ? "이번 판 계획 빌드" : ""),
      source: useAI ? `AI · ${Math.round((Date.now() - itemAdvice.at) / 1000)}초 전` : "이번 판 계획", busy: itemAdvice.busy,
    };
  } finally { itemTicking = false; }
}

function startOverlay() {
  if (process.env.LOL_OVERLAY === "0") return;
  leader.overlayStopped = false;
  const launch = () => {
    if (leader.overlayStopped) return;
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", resPath("src/overlay.ps1"),
      "-Port", String(PORT), "-FontDir", resPath("assets/fonts"), "-IconPath", resPath("assets/icon.ico"), "-AppVersion", APP_VERSION];
    if (process.env.LOL_WATCH_PROCESS) args.push("-ProcessName", process.env.LOL_WATCH_PROCESS);
    if (coord.isApp) args.push("-Tray", "-ExePath", process.execPath);
    const p = spawn("powershell.exe", args, { windowsHide: true, stdio: "ignore" });
    leader.overlay = p;
    p.on("close", () => { if (!leader.overlayStopped) setTimeout(launch, 5000).unref(); });
  };
  launch();
}
process.on("exit", () => leader.overlay?.kill());

function becomeLeader() {
  return new Promise((resolve) => {
    const srv = http.createServer(handle);
    srv.once("error", () => resolve(false));
    srv.listen(PORT, "127.0.0.1", async () => {
      leader.srv = srv;
      coord.role = coord.isApp ? "프로그램 (화면 감시·오버레이·자동 세팅)" : "MCP 리더 (화면 감시·오버레이)";
      await ensureResources();
      startWatcher();
      startOverlay();
      leader.timers = [setInterval(settlePick, 300), setInterval(refreshOfferAdvice, 300),
        setInterval(pollGame, 1500), setInterval(itemTick, 3000)];
      leader.timers.forEach((t) => t.unref());
      pollGame();
      // 이번 패치 아이템 데이터(효과 설명 포함)를 미리 받아 둠 → 첫 AI 세팅이 기다리지 않음
      if (coord.isApp) shop().catch(() => {});
      resolve(true);
    });
  });
}

/** 리더 자리를 내려놓고 팔로워가 됩니다 (단독 프로그램에 넘길 때) */
function relinquish() {
  leader.timers.forEach(clearInterval);
  leader.timers = [];
  stopWatcher();
  leader.overlayStopped = true;
  leader.overlay?.kill();
  leader.srv?.close();
  leader.srv = null;
  coord.yieldUntil = Date.now() + 15000; // 넘겨준 직후 다시 리더를 잡지 않도록 (프로그램이 먼저 잡게)
  followLoop();
}

async function syncFromLeader() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/state`, { signal: AbortSignal.timeout(1500) });
    const s = await r.json();
    Object.assign(watch, { offer: s.offer, event: s.event, status: `${s.status} (공유)`, lastLeagueFrameAt: s.lastLeagueFrameAt, history: s.history || [] });
    coord.gameKey = s.gameKey;
    coord.gameVersion = s.gameVersion;
    coord.championId = s.championId;
    return true;
  } catch { return false; }
}

function followLoop() {
  coord.role = "팔로워 (다른 프로세스의 화면 감시 공유)";
  let fails = 0;
  const tick = async () => {
    const canLead = !coord.yieldUntil || Date.now() > coord.yieldUntil;
    fails = (await syncFromLeader()) ? 0 : fails + 1;
    // 리더가 2초 넘게 응답이 없을 때만 이어받음 (리더를 넘기는 순간 프로그램보다 먼저 잡지 않도록)
    if (fails >= 2 && canLead && (await becomeLeader())) return;
    setTimeout(tick, 1000).unref();
  };
  tick();
}

/**
 * @param {{app?: boolean}} opts app=true 면 단독 프로그램: 리더를 넘겨받고 트레이·자동 세팅을 켭니다.
 * @returns {{alreadyRunning?: boolean}}
 */
export async function startCoordinator({ app = false } = {}) {
  coord.isApp = app;
  if (process.platform !== "win32" || process.env.LOL_SCREEN_WATCH === "0") {
    coord.role = "꺼짐";
    watch.status = process.platform !== "win32" ? "Windows에서만 지원" : "꺼짐 (LOL_SCREEN_WATCH=0)";
    return {};
  }
  if (await becomeLeader()) return {};
  if (app) {
    const info = await fetch(`http://127.0.0.1:${PORT}/info`).then((r) => r.json()).catch(() => null);
    if (info?.app && info.version === APP_VERSION) return { alreadyRunning: true };
    // 다른 버전의 프로그램이 켜져 있으면 종료시키고, MCP 서버가 리더면 넘겨받습니다
    if (info?.app) await fetch(`http://127.0.0.1:${PORT}/quit`, { method: "POST" }).catch(() => {});
    else await fetch(`http://127.0.0.1:${PORT}/handoff`, { method: "POST" }).catch(() => {});
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await becomeLeader()) return {};
      // 다른 MCP 서버가 리더를 이어받았으면 그쪽에도 다시 넘겨 달라고 요청
      if (i % 4 === 3) {
        const cur = await fetch(`http://127.0.0.1:${PORT}/info`).then((r) => r.json()).catch(() => null);
        if (cur && !cur.app) await fetch(`http://127.0.0.1:${PORT}/handoff`, { method: "POST" }).catch(() => {});
        else if (cur?.app && cur.version === APP_VERSION) return { alreadyRunning: true };
      }
    }
    return { alreadyRunning: true };
  }
  followLoop();
  return {};
}

/** 이벤트를 리더에 전달 (팔로워에서 사용자가 이벤트를 알려준 경우) */
export async function shareEvent(ev) {
  watch.event = ev;
  if (coord.role.startsWith("팔로워")) {
    await fetch(`http://127.0.0.1:${PORT}/event`, { method: "POST", body: JSON.stringify(ev || {}) }).catch(() => {});
  }
}

/** 윈도우 시작 시 실행 (HKCU Run). 단독 프로그램(exe)일 때만. */
async function applyAutostart(s) {
  if (!coord.isApp || !IS_EXE) return;
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const args = s.autostart
    ? ["add", key, "/v", "AramCoach", "/t", "REG_SZ", "/d", `"${process.execPath}"`, "/f"]
    : ["delete", key, "/v", "AramCoach", "/f"];
  await new Promise((r) => spawn("reg.exe", args, { windowsHide: true, stdio: "ignore" }).on("close", r));
}
