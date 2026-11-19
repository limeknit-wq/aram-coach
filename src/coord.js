// 여러 프로세스(단독 프로그램, 데스크톱 채팅·Claude Code의 MCP 서버)가 동시에 켜져도
// 화면 감시·오버레이·자동 세팅은 하나만 돌게 합니다.
// 127.0.0.1:47321 을 잡은 쪽이 '리더'. 단독 프로그램(app)은 MCP 리더에게서 리더를 넘겨받습니다(/handoff).
import http from "node:http";
import { spawn } from "node:child_process";
import { addPick, loadPicks, loadPlan, resetPicks, scoreOffer } from "./plan.js";
import { currentGameKey, liveGame } from "./live.js";
import { champSelect, gameWindowMode, loadingGame } from "./lcu.js";
import { startWatcher, stopWatcher, state as watch } from "./watcher.js";
import { APP_VERSION, IS_EXE, ensureResources, resPath } from "./paths.js";
import { getSettings, updateSettings } from "./settings.js";
import { adviseItems, cancelAutoSetup, detectEngines, items as itemAdvice, onGameStart, prepareChampion, setup } from "./autosetup.js";
import { findItem, version } from "./data.js";
import { uninstall } from "./install.js";
import { update } from "./update.js";

const PORT = Number(process.env.LOL_COORD_PORT || 47321);
export const coord = { role: "시작 전", isApp: false, gameKey: null, inGame: false, pendingPick: null, lastPick: null, champion: null };

const leader = { srv: null, timers: [], overlay: null, overlayStopped: false };

const sendJson = (res, obj, code = 200) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

async function overlayState() {
  const s = await getSettings();
  const o = watch.offer;
  const onScreen = o && Date.now() - o.lastSeenAt < 3500;
  const lastPick = coord.lastPick && Date.now() - coord.lastPick.at < 6000 ? coord.lastPick : null;
  const common = { enabled: s.overlay, scale: s.overlayScale, offsetY: s.overlayOffsetY, lastPick, setupState: setup.state, setupEngine: setup.engine,
    fullscreen: coord.windowMode === 0, items: coord.itemsView && coord.inGame ? { ...coord.itemsView, show: coord.itemsView.dead || Date.now() < coord.affordUntil } : null };
  if (!onScreen) return { show: false, ...common };
  const scored = await scoreOffer(o, { event: watch.event, gameKey: coord.gameKey });
  return { show: true, ...scored, event: watch.event?.name || null, ...common };
}

/** 설정창에 보여줄 상태 묶음 */
async function statusState() {
  const plan = await loadPlan();
  const picks = await loadPicks(coord.gameKey);
  const top = plan ? Object.values(plan.scores).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => `${x.name} (${x.score})`) : [];
  return {
    version: APP_VERSION, role: coord.role, inGame: coord.inGame, champion: coord.champion, gameKey: coord.gameKey,
    watch: watch.status, event: watch.event?.name || null,
    setup: { ...setup },
    plan: plan && (!coord.gameKey || plan.gameKey === coord.gameKey)
      ? { source: plan.source, champion: plan.champion, strategy: plan.strategy, build: plan.build, top }
      : null,
    picks: picks.map((p) => p.name),
    items: coord.inGame ? coord.itemsView || null : null,
    offer: watch.offer && Date.now() - watch.offer.lastSeenAt < 3500 ? (await scoreOffer(watch.offer, { event: watch.event, gameKey: coord.gameKey }))?.cards.map((c) => `${c.name} ${c.grade}${c.score ?? ""}${c.isPick ? " ★" : ""}`) : [],
    engines: await detectEnginesCached(),
    settings: await getSettings(),
    update,
    exePath: process.execPath,
  };
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
  if (p === "/state") return sendJson(res, { offer: watch.offer, event: watch.event, status: watch.status, lastLeagueFrameAt: watch.lastLeagueFrameAt, history: watch.history, gameKey: coord.gameKey });
  if (p === "/overlay") return overlayState().then((s) => sendJson(res, s), () => sendJson(res, { show: false }));
  if (p === "/status") return statusState().then((s) => sendJson(res, s), (e) => sendJson(res, { error: String(e) }, 500));
  if (p === "/settings" && req.method === "POST") return readBody(req).then(async (b) => { const s = await updateSettings(b); await applyAutostart(s); sendJson(res, s); });
  if (p === "/settings") return getSettings().then((s) => sendJson(res, s));
  if (p === "/resetup" && req.method === "POST") {
    if (!coord.gameKey) return sendJson(res, { ok: false, message: "진행 중인 게임이 없어요" });
    liveGame(EMPTY_MEMORY).then((live) => onGameStart(coord.gameKey, live, { force: true }));
    return sendJson(res, { ok: true });
  }
  if (p === "/click" && req.method === "POST") {
    // 오버레이가 감지한 카드 영역 클릭 → 선택 화면이 사라지면 그 카드를 고른 증강으로 확정
    const x = Number(u.searchParams.get("x"));
    const o = watch.offer;
    if (o?.names?.length && o.xs?.every((v) => v != null) && Number.isFinite(x)) {
      const i = o.xs.reduce((b, v, j) => (Math.abs(v - x) < Math.abs(o.xs[b] - x) ? j : b), 0);
      coord.pendingPick = { name: o.names[i], at: Date.now(), offerKey: o.key };
    }
    return sendJson(res, { ok: true, pending: coord.pendingPick?.name || null });
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
async function settlePick() {
  const p = coord.pendingPick;
  if (!p) return;
  const o = watch.offer;
  const age = Date.now() - p.at;
  if (!o || o.key !== p.offerKey || age > 12000) { coord.pendingPick = null; return; } // 새로고침 등으로 선택지가 바뀜 → 취소
  const goneFor = (watch.lastLeagueFrameAt || 0) - o.lastSeenAt;
  if (goneFor > 1800 && Date.now() - o.lastSeenAt > 1800) {
    coord.pendingPick = null;
    await addPick(p.name, coord.gameKey, "오버레이 클릭 자동 기록");
    coord.lastPick = { name: p.name, at: Date.now() };
  }
}

/** 새 게임 시작: (프로그램 모드면) AI 자동 세팅. 점수는 AI만 정합니다 (AI 세팅 전엔 오버레이에 "AI 분석 중") */
async function onNewGame(key) {
  watch.event = null; watch.offer = null; watch.history = [];
  coord.lastPick = null; coord.itemsView = null; coord.affordUntil = 0;
  Object.assign(itemAdvice, { next: [], now: "", why: "", at: 0, state: "대기" });
  await resetPicks(key);
  const live = await liveGame(EMPTY_MEMORY).catch(() => null);
  coord.champion = live?.me?.champion || null;
  const plan = await loadPlan();
  if (coord.isApp && !(plan && plan.gameKey === key && String(plan.source).startsWith("AI"))) onGameStart(key, live);
}

const EMPTY_MEMORY = { myChampion: null, allies: [], enemies: [], myAugments: [], notes: [] };

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
let wasDead = false, lastAdviceAt = 0, lastAffordName = null, itemTicking = false;
async function itemTick() {
  if (itemTicking || !coord.inGame) return;
  itemTicking = true;
  try {
    coord.windowMode = await gameWindowMode();
    const live = await liveGame(EMPTY_MEMORY).catch(() => null);
    if (!live?.inGame) return;
    const plan = await loadPlan();
    const picks = (await loadPicks(coord.gameKey)).map((p) => p.name);
    const dead = Boolean(live.me.dead);
    const needAdvice = coord.isApp && Date.now() - lastAdviceAt > 45000 &&
      ((dead && !wasDead) || (!itemAdvice.at && setup.state === "완료"));
    wasDead = dead;
    if (needAdvice) { lastAdviceAt = Date.now(); adviseItems(live, { plan: plan && plan.gameKey === coord.gameKey ? plan : null, picks }); }
    // 보여줄 목록: AI 추천(최근 것) → 없으면 이번 판 계획 빌드
    const owned = new Set(live.me.items.map((i) => String(i.id)));
    const useAI = itemAdvice.at && Date.now() - itemAdvice.at < 10 * 60000;
    const names = useAI ? itemAdvice.next : (plan?.gameKey === coord.gameKey ? plan.build?.core || [] : []);
    const v = await version();
    const next = [];
    for (const n of names) {
      const it = await findItem(n);
      if (it && owned.has(String(it.id))) continue;
      next.push({ name: it?.name || n, id: it?.id || null, gold: it?.gold?.total ?? null, icon: it ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/item/${it.id}.png` : null });
      if (next.length >= 3) break;
    }
    const gold = live.me.currentGold;
    const first = next[0];
    if (first && first.gold && gold >= first.gold && lastAffordName !== first.name) { lastAffordName = first.name; coord.affordUntil = Date.now() + 8000; }
    coord.itemsView = {
      next, gold, dead, respawnIn: live.me.respawnIn || null,
      now: useAI ? itemAdvice.now : "", why: useAI ? itemAdvice.why : (plan?.strategy ? "이번 판 계획 빌드" : ""),
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
      leader.timers = [setInterval(settlePick, 300), setInterval(pollGame, 1500), setInterval(itemTick, 3000)];
      leader.timers.forEach((t) => t.unref());
      pollGame();
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
    return true;
  } catch { return false; }
}

function followLoop() {
  coord.role = "팔로워 (다른 프로세스의 화면 감시 공유)";
  const tick = async () => {
    const canLead = !coord.yieldUntil || Date.now() > coord.yieldUntil;
    if (!(await syncFromLeader()) && canLead && (await becomeLeader())) return; // 리더가 꺼졌으면 이어받음
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
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await becomeLeader()) return {};
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
