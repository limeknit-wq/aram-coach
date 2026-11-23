import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const profile = await mkdtemp(join(tmpdir(), "aram-live-augments-"));
process.env.LOCALAPPDATA = process.env.TEMP = process.env.TMP = profile;
const { clickableOffer, coord, refreshOfferAdvice, settlePick } = await import("../src/coord.js");
const { feedLine, state: watch } = await import("../src/watcher.js");
const { addPick, DATA_DIR, loadPicks, scoreOffer } = await import("../src/plan.js");
const { readCardDescriptions } = await import("../src/seendesc.js");
const { publicPatch, refreshMayhemStats } = await import("../src/mayhemstats.js");

const names = ["거인", "선혈포식", "보석 건틀릿"];
const positions = [.308, .5, .692];
const cardRims = Array(256).fill(0);
for (const x of positions) {
  for (const side of [-1, 1]) cardRims[Math.round(256 * (x + side * .147 * 900 / 1600))] = 5;
}
const clearRims = Array(256).fill(0);

function replay(t, gameKey) {
  t.mock.method(Date, "now", () => at);
  let at = 50000;
  Object.assign(watch, { lastLeagueFrameAt: null, offer: null, history: [], captureEpoch: 0 });
  Object.assign(coord, { gameKey, pendingPick: null, lastPick: null });
  return {
    async frame(labels, rims = cardRims, gap = 450) {
      at += gap;
      const lines = labels.flatMap((s, i) => s ? [{ s, x: positions[i], y: .41 }] : []);
      await feedLine(JSON.stringify({ t: at, lines, rims, w: 1600, h: 900 }));
      return watch.offer;
    },
    click(name) {
      assert.equal(clickableOffer(watch.offer), true);
      coord.pendingPick = { name, at: ++at, offer: watch.offer, epoch: watch.captureEpoch, gameKey };
    },
  };
}

test("선택지는 두 프레임으로 확인하고, 카드가 남거나 캡처가 불확실하면 클릭을 확정하지 않는다", async (t) => {
  const { frame, click } = replay(t, "pick-fixture");
  assert.equal(await frame(names, clearRims), null);
  assert.equal(await frame(names, clearRims), null);
  assert.equal(await frame(names), null);
  const offer = await frame(names);
  click(names[0]);
  for (let i = 0; i < 5; i++) {
    await frame(i % 2 ? [names[0]] : [], cardRims, 800);
    await settlePick();
  }
  assert.equal(offer.closedAt, undefined);
  for (let i = 0; i < 3; i++) await frame([], null);
  await settlePick();
  assert.deepEqual(await loadPicks(coord.gameKey), []);
  for (let i = 0; i < 3; i++) await frame([], clearRims);
  await settlePick();
  assert.ok(offer.closedAt);
  assert.equal(await scoreOffer(offer), null);
  await addPick(names[1], coord.gameKey, "중복 클릭 테스트", { offerId: offer.at });
  assert.deepEqual((await loadPicks(coord.gameKey)).map((pick) => pick.name), [names[0]]);
});

test("닫힌 선택지가 뒤늦게 읽혀도 다시 열리지 않고, 다음 라운드의 새 카드는 인식한다", async (t) => {
  const { frame, click } = replay(t, "reopen-fixture");
  await frame(names);
  const offer = await frame(names);
  click(names[0]);
  for (let i = 0; i < 3; i++) await frame([], clearRims);
  await settlePick();
  await frame(names, cardRims, 10000);
  await frame([names[0], names[1]]);
  assert.equal(await frame(names), offer);
  assert.equal(clickableOffer(offer), false);
  const next = ["유리 대포", "마법 미사일", "보석 건틀릿"];
  assert.equal(await frame(next), offer);
  const reopened = await frame(next);
  assert.notEqual(reopened, offer);
  assert.deepEqual(reopened.names, next);
  assert.equal(clickableOffer(reopened), true);
});

test("한 프레임 오독은 무시하고 같은 칸이 다시 읽힐 때 리롤을 반영한다", async (t) => {
  const { frame, click } = replay(t, "reroll-fixture");
  await frame(names);
  const offer = await frame(names);
  click(names[1]);
  const rerolled = [names[0], "유리 대포", names[2]];
  await frame(rerolled);
  assert.deepEqual(offer.names, names);
  assert.equal(clickableOffer(offer), false);
  await frame(names);
  assert.equal(offer.changedAt, undefined);
  await frame(rerolled);
  assert.equal(offer.rerolledAt, undefined);
  await frame(rerolled);
  assert.deepEqual(offer.names, rerolled);
  assert.ok(offer.rerolledAt);
  await settlePick();
  assert.equal(coord.pendingPick, null);
  assert.deepEqual(await loadPicks(coord.gameKey), []);
});

test("게임 창 전환 중 화면이 사라져도 증강을 저장하지 않는다", async (t) => {
  const { frame, click } = replay(t, "focus-fixture");
  await frame(names);
  await frame(names);
  click(names[1]);
  await feedLine('{"idle":true}');
  for (let i = 0; i < 3; i++) await frame([], clearRims);
  await settlePick();
  assert.equal(coord.pendingPick, null);
  assert.deepEqual(await loadPicks(coord.gameKey), []);
});

test("읽은 설명과 준비된 점수를 즉시 표시하고 리롤 전의 점수를 새 카드에 붙이지 않는다", async () => {
  const gameKey = "rating-fixture";
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, "plan.json"), JSON.stringify({
    gameKey, scores: { ARAM_Goliath: { score: 72 } }, synergies: [],
  }));
  const descriptions = readCardDescriptions([{ apiName: "ARAM_Goliath", name: "거인", x: 0.3, y: 0.4 }], [
    { s: "거인", x: 0.3, y: 0.4 },
    { s: "보유한 최대 체력이 증가합니다.", x: 0.3, y: 0.46 },
  ]);
  const offer = { at: 100, names: ["거인", "선혈포식", "보석 건틀릿"], descriptions: Object.fromEntries(descriptions) };
  const initial = await scoreOffer(offer, { gameKey });
  assert.equal(initial.cards[0].description, "보유한 최대 체력이 증가합니다.");
  assert.equal(initial.cards[1].score, null);
  assert.equal(initial.cards[0].isProvisionalPick, true);
  offer.analysis = { scope: initial.analysisScope, pending: false, scores: {
    [initial.cards[0].evaluationKey]: { score: 88, reason: "진입 후 버티기" },
    [initial.cards[1].evaluationKey]: { score: 92, reason: "길게 싸울 때 회복" },
    [initial.cards[2].evaluationKey]: { score: 75, reason: "치명타 효과" },
  } };
  const live = await scoreOffer(offer, { gameKey });
  assert.equal(live.cards[1].reason, "길게 싸울 때 회복");
  assert.equal(live.cards[1].isPick, true);
  offer.changedAt = 200;
  offer.names[1] = "유리 대포";
  const rerolled = await scoreOffer(offer, { gameKey });
  assert.deepEqual(rerolled.cards.map((c) => c.score), [88, null, 75]);
  assert.equal(rerolled.cards[0].isProvisionalPick, true);
});

test("새 선택지 보강이나 리롤은 진행 중인 공통 평가를 유지하고 새 카드만 요청한다", async (t) => {
  const gameKey = "fast-offer";
  const started = Date.now();
  t.mock.method(Date, "now", () => started);
  const offer = { at: started, lastSeenAt: started, names: names.slice(0, 2) };
  const previous = { ...coord };
  t.after(() => Object.assign(coord, previous));
  Object.assign(coord, { isApp: true, inGame: true, gameKey });
  watch.offer = offer;
  const requested = [];
  let finishFirst, notifyFirst, requestSignal;
  const firstStarted = new Promise((resolve) => { notifyFirst = resolve; });
  const rate = async ({ cards }, signal) => {
    requested.push(cards.map((card) => card.name));
    if (requested.length !== 1) return cards.map(() => ({ score: 80, reason: "새 카드" }));
    requestSignal = signal;
    notifyFirst();
    return new Promise((resolve) => { finishFirst = resolve; });
  };
  const first = refreshOfferAdvice(rate);
  await firstStarted;
  offer.changedAt = started + 300;
  offer.names = [names[0], "유리 대포", names[2]];
  await refreshOfferAdvice(rate);
  assert.equal(requestSignal.aborted, false);
  finishFirst([{ score: 91, reason: "유지" }, { score: 93, reason: "교체된 카드" }]);
  await first;
  assert.deepEqual((await scoreOffer(offer, { gameKey })).cards.map((c) => c.score), [91, null, null]);
  await refreshOfferAdvice(rate);
  await refreshOfferAdvice(rate);
  assert.deepEqual(requested, [names.slice(0, 2), ["유리 대포", names[2]]]);
  assert.deepEqual((await scoreOffer(offer, { gameKey })).cards.map((c) => c.score), [91, 80, 80]);
});

test("현재 패치 통계만 쓰고, 같은 패치 재집계와 실패 복구를 처리한다", async () => {
  const gameKey = "stats-fixture";
  let patch = "26.23", releaseId = "release-1", pickRate = 24, broken = false;
  const calls = [];
  const load = async (url) => {
    calls.push(url.split("/").pop());
    const meta = { patch, releaseId, statsDate: "2026-11-21" };
    if (url.endsWith("/index.json")) return { schemaVersion: 1, latestPatch: patch, releaseId };
    if (url.endsWith("/augments.json")) return { schemaVersion: 1, meta, rows: [
      { augmentId: "goliath", name: { en: "Goliath", "ko-KR": "거인" }, pickRate },
      { augmentId: "goredrinker", name: { en: "Goredrinker", "ko-KR": "선혈포식" }, pickRate: 40 },
    ] };
    return { schemaVersion: 1, meta: { ...meta, releaseId: broken ? "stale" : releaseId }, rows: [
      { augmentIds: ["goliath", "goredrinker"], championId: "Brand", types: ["strong"] },
      { augmentIds: ["goliath"], championId: "Darius", types: ["trap"] },
    ] };
  };
  const offer = { at: 300, names: ["거인"], descriptions: { ARAM_Goliath: "실제 화면의 체력 효과" } };
  const context = { gameKey, gameVersion: "16.23.840.6595", championId: "Brand" };
  assert.equal(publicPatch("16.23.8406595+branch"), "26.23");
  assert.equal((await scoreOffer(offer, context)).statistics, null);
  await refreshMayhemStats({ load });
  assert.deepEqual(calls, ["index.json", "augments.json", "combos.json"]);
  calls.length = 0;
  await refreshMayhemStats({ load });
  assert.deepEqual(calls, ["index.json"]);
  let scored = await scoreOffer(offer, context);
  assert.deepEqual(scored.statistics, { patch, statsDate: "2026-11-21" });
  assert.equal(scored.cards[0].description, "실제 화면의 체력 효과");
  assert.equal(scored.cards[0].score, null);
  assert.deepEqual(scored.cards[0].statistics, { pickRate: 24, combos: [] });
  await addPick("선혈포식", gameKey);
  scored = await scoreOffer(offer, context);
  assert.deepEqual(scored.cards[0].statistics.combos, [{ with: ["선혈포식"], types: ["strong"] }]);
  assert.equal((await scoreOffer(offer, { ...context, gameVersion: "16.24.1" })).statistics, null);
  releaseId = "release-2"; pickRate = 31; broken = true;
  await assert.rejects(refreshMayhemStats({ load }), /일치/);
  assert.equal((await scoreOffer(offer, context)).cards[0].statistics.pickRate, 24);
  broken = false;
  await refreshMayhemStats({ load });
  assert.equal((await scoreOffer(offer, context)).cards[0].statistics.pickRate, 31);
  patch = "26.24"; releaseId = "release-3"; pickRate = 45;
  await refreshMayhemStats({ load });
  assert.equal((await scoreOffer(offer, context)).cards[0].statistics.pickRate, 31);
  assert.equal((await scoreOffer(offer, { ...context, gameVersion: "16.24.1" })).cards[0].statistics.pickRate, 45);
});
