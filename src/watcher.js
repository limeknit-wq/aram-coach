// 화면 감시: watcher.ps1 이 읽어온 OCR 글자에서 증강 이름을 찾아 '현재 선택지'를 기억합니다.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { augments, events, norm } from "./data.js";
import { ensureResources, resPath } from "./paths.js";

import { readCardDescriptions, recordCards } from "./seendesc.js";
import { test } from "./testmode.js";

const SCRIPT = () => resPath("src/watcher.ps1");
const OUT = join(tmpdir(), "lol-aram-mcp");
const SLOT_TOL = 0.08; // 같은 카드 칸으로 볼 가로 위치 차이 (화면 너비 비율)

/** 선택지 변화 기록 (문제 확인용): tmp/lol-aram-mcp/offers.log, 200KB 넘으면 새로 씀 */
export function logOffer(msg) {
  const f = join(OUT, "offers.log");
  try { if (statSync(f).size > 200000) rmSync(f); } catch {}
  try { mkdirSync(OUT, { recursive: true }); appendFileSync(f, `${new Date().toTimeString().slice(0, 8)} ${msg}\n`); } catch {}
}

export const state = {
  enabled: false,
  status: "꺼짐",
  lastLeagueFrameAt: null,
  captureEpoch: 0,
  lastError: null,
  offer: null, // { names, apiNames, at, image }
  event: null, // 이번 판 귀빈 이벤트 { id, name, at, source }
  history: [],
};

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// 영문 OCR에서 자주 헷갈리는 글자를 같은 글자로 봅니다 (0↔o, 1·i·|↔l, 5↔s)
const ocrCanon = (s) => s.replace(/0/g, "o").replace(/[1i|]/g, "l").replace(/5/g, "s");

// 설명 비교용: 숫자·%·?·기호·공백을 빼고 글자만 (화면은 실제 수치, 데이터는 '?'일 수 있어서)
const descNorm = (s) => String(s || "").replace(/[\d%?.,·:()\[\]\s\-+'"!~]/g, "");
const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };

/** 카드 칸(cx) 아래 설명 줄들을 모아 증강 효과 설명과 2글자 조각이 가장 많이 겹치는 증강을 찾습니다. */
function matchByDescription(lines, cx, ty, found, named) {
  const col = (lines || []).filter((e) => typeof e !== "string" && e.y != null && e.y > ty + 0.012 && e.y < ty + 0.25 && Math.abs(e.x - cx) < 0.1);
  const text = descNorm(col.map((e) => e.s).join(""));
  if (text.length < 8) return null;
  const have = grams(text);
  const seen = new Set();
  let best = null, bestScore = 0, second = 0;
  for (const { a } of named) {
    if (seen.has(a.apiName) || found.some((f) => f.apiName === a.apiName)) continue;
    seen.add(a.apiName);
    const g = grams(descNorm(a.desc).slice(0, 60));
    if (g.size < 6) continue;
    let hit = 0;
    for (const x of g) if (have.has(x)) hit++;
    const score = hit / g.size;
    if (score > bestScore) { second = bestScore; bestScore = score; best = a; }
    else if (score > second) second = score;
  }
  return best && bestScore >= 0.5 && bestScore - second >= 0.15 ? best : null;
}

/**
 * 못 읽은 카드 보완: 카드는 화면 가운데(0.5)를 기준으로 좌우 대칭으로 놓이므로,
 * 읽힌 카드의 반대편·가운데 자리에 빈 칸이 있으면 같은 높이의 글자를 조금 더 너그럽게 맞춰 봅니다.
 * (예: 이름 일부가 효과 빛에 가려 2~3글자 틀린 경우, 이름이 두 줄로 나뉜 경우)
 */
function recoverMissing(lines, found, named) {
  if (!found.every((f) => f.x != null && f.y != null)) return;
  const ty = found.reduce((s, f) => s + f.y, 0) / found.length;
  const near = (x) => found.some((f) => Math.abs(f.x - x) < 0.08);
  const cands = [...found.map((f) => 1 - f.x), 0.5].filter((x, i, a) => !near(x) && a.findIndex((v) => Math.abs(v - x) < 0.05) === i);
  found.missing = [];
  for (const cx of cands) {
    // 두 줄 이름은 첫 줄이 조금 위에 있으므로 위쪽은 넉넉히(0.05) 봅니다
    const row = (lines || []).filter((e) => typeof e !== "string" && e.y != null && e.y - ty > -0.05 && e.y - ty < 0.03 && Math.abs(e.x - cx) < 0.1)
      .sort((a, b) => a.y - b.y);
    const texts = [...row.map((e) => e.s), row.map((e) => e.s).join("")];
    let best = null, bestScore = 0;
    for (const t of texts) {
      const l = ocrCanon(norm(t));
      if (l.length < 2 || l.length > 28) continue;
      for (const { a, n } of named) {
        if (found.some((f) => f.apiName === a.apiName)) continue;
        let score = 0;
        const r = lev(l, n) / Math.max(l.length, n.length);
        if (r <= 0.4 && !(n.length - l.length >= 2 && n.includes(l))) score = 1 - r;
        else if ((n.length >= 3 && l.includes(n)) || (l.length >= 4 && n.includes(l))) score = 0.62;
        if (score > bestScore) { bestScore = score; best = a; }
      }
    }
    if (best && bestScore >= 0.6) { found.push({ ...best, x: cx, y: ty, recovered: true }); continue; }
    // 이름이 완전히 깨져 읽히면(예: "축소 엔진" → "入 에지") 카드 아래 효과 설명 문장으로 맞춥니다
    const byDesc = matchByDescription(lines, cx, ty, found, named);
    if (byDesc) found.push({ ...byDesc, x: cx, y: ty, recovered: true });
    else found.missing.push(row.map((e) => e.s).join(" | ") || "(이름 줄 없음)");
  }
}

/**
 * 진짜 선택 화면은 카드 이름이 같은 높이에 가로로 떨어져 놓입니다. 높이가 다른 글자(채팅·킬 알림·플레이어 이름)에서
 * 우연히 맞은 이름은 버려 엉뚱한 '선택지'가 생기지 않게 합니다. 가장 많이 모인 한 줄만 남기고, 2개 미만이면 선택 화면이 아님.
 */
function sameRow(found) {
  if (found.length < 2 || !found.every((f) => f.y != null && f.x != null)) return found;
  let best = [];
  for (const f of found) {
    const row = found.filter((g) => Math.abs(g.y - f.y) < 0.045); // 마우스를 올린 카드는 커져서 이름 줄이 조금 내려감
    if (row.length > best.length) best = row;
  }
  const xs = [...best].sort((a, b) => a.x - b.x);
  const spaced = xs.filter((f, i) => i === 0 || f.x - xs[i - 1].x > 0.08);
  return spaced.length >= 2 ? found.filter((f) => spaced.includes(f)) : [];
}

/** OCR 줄 목록 → 화면에 보이는 증강 목록 (중복 제거, 화면 순서). OCR 오타 1~2글자는 허용. */
export async function matchAugments(lines) {
  const { augments: list } = await augments();
  const named = list
    .flatMap((a) => [{ a, n: ocrCanon(norm(a.name)) }, { a, n: ocrCanon(norm(a.nameEn)), en: true }])
    .filter((x) => x.n.length >= 2);
  let found = [];
  for (const entry of lines || []) {
    const line = typeof entry === "string" ? entry : entry.s;
    const x = typeof entry === "string" ? null : entry.x;
    const l = ocrCanon(norm(line));
    if (l.length < 2 || l.length > 28) continue; // 긴 줄은 설명문
    let best = null, bestScore = 0;
    for (const { a, n, en } of named) {
      let score = 0;
      if (l === n) score = 1;
      else if (Math.abs(l.length - n.length) <= 2) {
        const dist = lev(l, n);
        // 영문 이름은 플레이어 이름(예: "Big shaq" → Big Shot)과 헷갈려 1글자까지만, 그것도 8글자 이상일 때만
        const allowed = en ? (n.length >= 8 ? 1 : 0) : n.length >= 6 ? 2 : n.length >= 3 ? 1 : 0;
        // 두 줄로 나뉜 이름의 한 줄(예: "꽃피는 새벽의 검 / 업그레이드"의 "업그레이드")이 더 긴 다른 이름
        // ("존야 업그레이드")의 일부로 맞는 것은 오인식. 이런 카드는 recoverMissing이 두 줄을 합쳐 다시 맞춥니다.
        // (빛 효과로 첫 글자 하나만 빠지는 경우 "수능란" → 능수능란 은 허용: 2글자 이상 빠진 조각만 거름)
        const piece = n.length - l.length >= 2 && n.includes(l);
        if (dist <= allowed && !piece) score = 1 - dist / Math.max(l.length, n.length);
      }
      if (score > bestScore) { bestScore = score; best = a; }
    }
    if (best && bestScore >= 0.7 && !found.some((f) => f.apiName === best.apiName)) found.push({ ...best, x, y: entry?.y ?? null });
  }
  found = sameRow(found);
  if (found.length >= 2) recoverMissing(lines, found, named);
  // 화면 왼쪽→오른쪽 순서로 정렬하고 카드 위치(왼쪽/가운데/오른쪽)를 붙입니다
  if (found.every((f) => f.x != null)) {
    found.sort((a, b) => a.x - b.x);
    found.forEach((f, i) => {
      f.slot = found.length === 3 ? ["왼쪽", "가운데", "오른쪽"][i] : `${i + 1}번째`;
    });
  }
  return found;
}

/**
 * 귀빈 이벤트 안내 화면 인식. 이벤트 이름만으로는 오인식(예: 킬 알림의 '펜타킬')이 생기므로
 * 이름 줄 + 그 이벤트 소개 문구(앞 6글자 이상)가 같은 화면에 있을 때만 인정합니다.
 */
export async function matchEvent(lines) {
  const list = await events();
  const texts = (lines || []).map((e) => norm(typeof e === "string" ? e : e.s));
  const all = texts.join("");
  for (const ev of list) {
    const n = norm(ev.name);
    if (n.length < 2 || !texts.some((t) => t === n || (t.length <= n.length + 2 && lev(t, n) <= 1))) continue;
    const hint = norm(ev.short).slice(0, 8);
    if (hint.length >= 6 && all.includes(hint.slice(0, 6))) return ev;
  }
  return null;
}

// HEARTSTEEL 스티커: 카드에 "세트: 레벨당 체력 30" 처럼 멤버 이름 + 콜론 문구가 붙습니다.
const STICKER_MEMBERS = ["케인", "요네", "세트", "아펠리오스", "크산테", "이즈리얼", "Kayn", "Yone", "Sett", "Aphelios", "K'Sante", "Ezreal"];
export function matchStickers(lines, found) {
  const out = found.map(() => null);
  for (const e of lines || []) {
    const s = typeof e === "string" ? e : e.s;
    const m = String(s).match(/^\s*([^\s:]+)\s*[:：]\s*(.+)$/);
    if (!m || !STICKER_MEMBERS.some((n) => norm(n) === norm(m[1]))) continue;
    // 가로 위치가 가장 가까운 카드에 붙입니다
    let idx = 0;
    if (typeof e !== "string" && found.every((f) => f.x != null)) {
      idx = found.reduce((b, f, i) => (Math.abs(f.x - e.x) < Math.abs(found[b].x - e.x) ? i : b), 0);
    }
    out[idx] = `${m[1]}: ${m[2].trim()}`;
  }
  return out.some(Boolean) ? out : undefined;
}

// OCR 오타 대신 공식 스티커 문구(events.json)로 바꿉니다. 예: "세트: ..." → "세트: 이 증강을 선택하면 레벨당 체력을 30 얻습니다."
async function officialStickers(stickers) {
  if (!stickers) return stickers;
  const hs = (await events()).find((e) => e.id === "Heartsteel");
  return stickers.map((s) => {
    if (!s) return s;
    const member = norm(s.split(/[:：]/)[0]);
    return hs?.stickers?.find((t) => norm(t.split(/[:：]/)[0]) === member) || s;
  });
}

const pendingChanges = new WeakMap();
let nextOffer = null;

function panelRims(msg, xs) {
  if (msg.rims?.length !== 256 || !msg.w || !msg.h || !xs?.length || xs.some((x) => x == null)) return null;
  const ratio = msg.h / msg.w;
  const tol = 256 * .042 * ratio;
  let edges = 0, cards = 0;
  for (const x of xs) {
    const sides = [-.147, .147].filter((offset) => {
      const c = 256 * (x + offset * ratio);
      for (let i = Math.max(1, Math.ceil(c - tol)); i <= Math.min(254, Math.floor(c + tol)); i++) {
        if (msg.rims[i] >= 4) return true;
      }
      return false;
    }).length;
    edges += sides;
    if (sides === 2) cards++;
  }
  return { edges, cards };
}

function observePanel(offer, found, msg) {
  if (!offer || offer.closedAt) return;
  const rims = panelRims(msg, offer.xs);
  const knownTitle = found.some((card) => {
    const i = offer.names.indexOf(card.name);
    return i >= 0 && card.x != null && card.y >= .32 && card.y <= .50 &&
      Math.abs(offer.xs[i] - card.x) <= SLOT_TOL;
  });
  if (rims?.cards && found.length >= 2 && knownTitle) {
    offer.panelSeenAt = msg.t;
    offer.panelEpoch = state.captureEpoch;
  }
  if (!rims || rims.edges >= 2 || knownTitle || found.length >= 2 || offer.panelEpoch !== state.captureEpoch) {
    offer.absentSince = null;
    offer.absentFrames = 0;
    return;
  }
  offer.absentSince ??= msg.t;
  offer.absentFrames = (offer.absentFrames || 0) + 1;
}

function confirmedChanges(offer, changed, immediate) {
  const previous = pendingChanges.get(offer);
  const next = new Map(changed.map((card) => [card.i, card.name]));
  pendingChanges.set(offer, next);
  return changed.filter((card) => immediate || previous?.get(card.i) === card.name);
}

async function onLine(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.error || msg.idle || msg.ready) {
    state.captureEpoch++;
    nextOffer = null;
    if (state.offer) pendingChanges.delete(state.offer);
  }
  if (msg.error) { state.lastError = msg.error; if (msg.error === "no-ocr-language") state.status = "한국어 OCR 미설치"; return; }
  if (msg.ready) { state.status = "대기 중 (롤 게임 창이 앞에 있을 때 읽음)"; return; }
  if (msg.idle) { state.status = "대기 중 (롤 게임 창이 앞에 있지 않음)"; return; }
  if (!Array.isArray(msg.lines) || !Number.isFinite(msg.t) || msg.t <= state.lastLeagueFrameAt) return;
  state.lastLeagueFrameAt = msg.t;
  if (msg.w && msg.h) state.aspect = msg.w / msg.h; // 카드 너비 계산용 (화면 비율)
  state.status = `게임 화면 읽는 중 (캡처: ${msg.method || "파일"})`;
  const ev = await matchEvent(msg.lines);
  if (ev && state.event?.id !== ev.id) state.event = { id: ev.id, name: ev.name, at: msg.t, source: "화면 자동 인식" };
  const found = await matchAugments(msg.lines);
  const cur = state.offer;
  observePanel(cur, found, msg);
  if (found.length < 2) {
    if (cur) pendingChanges.delete(cur);
    nextOffer = null;
    return;
  }
  const descriptions = Object.fromEntries(readCardDescriptions(found, msg.lines));
  if (!test.active && msg.method && msg.source !== "file") {
    recordCards(found, msg.lines, (await augments()).builtAt)?.catch(() => {});
  }
  // 선택지가 떠 있는 동안 화면 감시를 빠르게(0.2초 간격) 돌리라는 신호
  writeFile(join(OUT, "fast.flag"), String(msg.t)).catch(() => {});
  const stickersNow = await officialStickers(matchStickers(msg.lines, found));
  const missLog = () => {
    const o = state.offer;
    if (!o || !found.missing?.length || (o.missLogged || 0) >= 3) return;
    o.missLogged = (o.missLogged || 0) + 1;
    logOffer(`못 읽은 칸 글자: ${found.missing.join(" / ")}`);
  };
  if (found.some((f) => f.recovered)) logOffer(`보완 인식: ${found.filter((f) => f.recovered).map((f) => f.name).join(", ")}`);
  // 같은 선택 화면이 이어지는 중이면 카드 칸(왼쪽·가운데·오른쪽)별로 합칩니다.
  //  - 새로고침 중 뒤집히는 카드는 글자가 잠깐 안 읽혀도 이전 카드를 유지 (2장으로 줄지 않음)
  //  - 한 칸만 다른 이름이 읽히면 그 칸만 새로고침된 것으로 바꿈
  if (cur?.closedAt) {
    const fresh = found.filter((card) => !cur.names.includes(card.name)).length;
    if (msg.t <= cur.closedAt || fresh === 0 || (fresh < 2 && msg.t - cur.closedAt < 8000)) {
      nextOffer = null;
      return;
    }
  }
  if (cur && !cur.closedAt && msg.t - cur.lastSeenAt < 8000 && cur.xs?.every((v) => v != null) && found.every((f) => f.x != null)) {
    const names = [...cur.names], xs = [...cur.xs], stickers = [...(cur.stickers || cur.names.map(() => null))];
    let same = 0;
    const changed = [], added = [];
    found.forEach((f, fi) => {
      const i = xs.reduce((b, v, j) => (Math.abs(v - f.x) < Math.abs(xs[b] - f.x) ? j : b), 0);
      const sticker = stickersNow?.[fi] || null;
      if (Math.abs(xs[i] - f.x) > SLOT_TOL) { added.push({ name: f.name, sticker, x: f.x }); return; } // 처음에 못 읽은 칸
      if (names[i] === f.name) { same++; return; }
      if (names.includes(f.name)) return;
      changed.push({ i, name: f.name, sticker, x: f.x });
    });
    if (same >= 1 || (changed.length === 1 && cur.names.length >= 3)) {
      if (same) cur.lastSeenAt = msg.t;
      Object.assign(cur.descriptions ||= {}, descriptions);
      const room = Math.max(0, 4 - names.length);
      const add = added.filter((a) => !names.includes(a.name)).slice(0, room);
      const stable = confirmedChanges(cur, changed, msg.source === "file");
      cur.unstable = changed.length > stable.length;
      nextOffer = null;
      if (!stable.length && !add.length) return missLog();
      cur.lastSeenAt = msg.t;
      for (const c of stable) { names[c.i] = c.name; xs[c.i] = c.x; stickers[c.i] = c.sticker; }
      // 늦게 읽힌 카드는 가로 위치 순서대로 끼워 넣음
      const cards = names.map((n, i) => ({ n, x: xs[i], st: stickers[i] })).concat(add.map((a) => ({ n: a.name, x: a.x, st: a.sticker }))).sort((a, b) => a.x - b.x);
      const slots = cards.map((_, i) => (cards.length === 3 ? ["왼쪽", "가운데", "오른쪽"][i] : `${i + 1}번째`));
      Object.assign(cur, { names: cards.map((c) => c.n), xs: cards.map((c) => c.x), slots, stickers: cards.some((c) => c.st) ? cards.map((c) => c.st) : undefined, key: cards.map((c) => c.n).join("|") });
      if (stable.length) cur.rerolledAt = msg.t;
      cur.changedAt = msg.t;
      logOffer(`${stable.length ? "새로고침" : "카드 추가"}: ${[...stable, ...add].map((c) => c.name).join(", ")} → ${cur.names.join(" / ")}`);
      return;
    }
  }
  const key = found.map((a) => a.name).join("|");
  if (cur && !cur.closedAt && cur.key === key) {
    nextOffer = null;
    pendingChanges.delete(cur);
    cur.unstable = false;
    cur.lastSeenAt = msg.t;
    Object.assign(cur.descriptions ||= {}, descriptions);
    return missLog();
  }
  if (msg.source !== "file") {
    const rims = panelRims(msg, found.map((card) => card.x));
    if (!rims?.cards || rims.edges < 3) {
      nextOffer = null;
      return;
    }
    if (nextOffer?.key !== key || nextOffer.previous !== cur) {
      nextOffer = { key, previous: cur };
      if (cur && !cur.closedAt) cur.unstable = true;
      return;
    }
  }
  nextOffer = null;
  const stickers = stickersNow;
  const image = join(OUT, `offer-${msg.t}.jpg`);
  if (msg.source !== "file") await copyFile(join(OUT, "latest.jpg"), image).catch(() => {});
  state.offer = { key, names: found.map((a) => a.name), slots: found.map((a) => a.slot || null), xs: found.map((a) => a.x ?? null),
    descriptions, stickers, at: msg.t, lastSeenAt: msg.t, image: msg.source === "file" ? null : image };
  observePanel(state.offer, found, msg);
  logOffer(`새 선택지: ${state.offer.names.join(" / ")}`);
  missLog();
  state.history.unshift(state.offer);
  state.history = state.history.slice(0, 8);
}

function run(args) {
  const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT(), "-OutDir", OUT, ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stdout.setEncoding("utf8");
  const rl = createInterface({ input: p.stdout });
  let pending = Promise.resolve();
  rl.on("line", (line) => {
    pending = pending.then(() => onLine(line)).catch((error) => { state.lastError = String(error).slice(0, 300); });
  });
  p.stderr.on("data", (d) => (state.lastError = String(d).slice(0, 300)));
  return { p, done: new Promise((r) => p.on("close", async () => { await pending; r(); })) };
}

export async function startWatcher() {
  if (process.platform !== "win32" || process.env.LOL_SCREEN_WATCH === "0") {
    state.status = process.platform !== "win32" ? "Windows에서만 지원" : "꺼짐 (LOL_SCREEN_WATCH=0)";
    return;
  }
  await ensureResources();
  await mkdir(OUT, { recursive: true });
  state.enabled = true;
  state.status = "시작 중";
  watcherStopped = false;
  const launch = () => {
    if (watcherStopped) return;
    const { p } = run(process.env.LOL_WATCH_PROCESS ? ["-ProcessName", process.env.LOL_WATCH_PROCESS] : []);
    watcherProc = p;
    p.on("close", (code) => {
      if (watcherStopped) return;
      state.status = `중지됨 (코드 ${code}), 10초 후 재시작`;
      setTimeout(launch, 10000).unref();
    });
  };
  launch();
}

let watcherProc = null, watcherStopped = false;
process.on("exit", () => watcherProc?.kill());
/** 화면 감시 중지 (다른 프로세스에 리더를 넘길 때) */
export function stopWatcher() {
  watcherStopped = true;
  watcherProc?.kill();
  watcherProc = null;
  state.enabled = false;
}

/** 테스트용: 이미지 한 장을 OCR 해서 선택지 감지 로직을 돌립니다. */
export async function scanImage(path) {
  await ensureResources();
  await mkdir(OUT, { recursive: true });
  await run(["-ImagePath", path]).done;
  return state.offer;
}

export async function offerImage(offer) {
  if (!offer?.image) return null;
  try { return (await readFile(offer.image)).toString("base64"); } catch { return null; }
}

export async function latestFrame() {
  try { return (await readFile(join(OUT, "latest.jpg"))).toString("base64"); } catch { return null; }
}
export const feedLine = onLine; // 테스트용
