import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("패치 갱신, 하루 간격, 실패 복구, OCR 설명 보존", async () => {
  const root = await mkdtemp(join(tmpdir(), "aram-patch-"));
  process.env.LOCALAPPDATA = root;
  try {
    const { refreshData, savedData, dataDir } = await import("../src/gamecache.js");
    const { seenFor, recordCards } = await import("../src/seendesc.js");
    const card = { apiName: "sample", name: "표본", desc: "?%", tags: [], x: 0.5, y: 0.4 };
    const dataset = { builtAt: "p1", augments: [card], events: [{ id: "guest", name: "귀빈" }] };
    let version = "p1", requests = 0;
    const load = async () => { requests++; return { version }; };
    const update = build => refreshData({ load, build });
    await update(async () => dataset);
    assert.equal((await savedData()).version, version);
    await update(assert.fail);
    assert.equal(requests, 2);
    await writeFile(join(dataDir, "checked.json"), "{}");
    version = "p2";
    await assert.rejects(update(async () => { throw Error("연결 끊김"); }));
    await assert.rejects(update(async () => ({ ...dataset, events: [] })));
    assert.equal((await savedData()).version, "p1");
    await update(async () => ({ ...dataset, builtAt: version }));
    assert.equal((await savedData()).version, "p2");
    const lines = [{ x: 0.5, y: 0.4, s: "표본" }, { x: 0.5, y: 0.45, s: "적에게 30% 추가 피해를 줍니다." }];
    await recordCards([card], lines, version);
    assert.deepEqual(await seenFor(version), {});
    await recordCards([card], lines, version);
    assert.equal((await seenFor(version)).sample, lines[1].s);
    assert.deepEqual(await seenFor("다른 패치"), {});
    await writeFile(join(dataDir, "game-data.json"), "[");
    assert.equal(await savedData(), null);
    const { augments, events } = await import("../src/data.js");
    assert.ok((await augments()).augments.length > 0);
    assert.ok((await events()).length > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
