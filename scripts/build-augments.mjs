import { mkdir, writeFile } from "node:fs/promises";
import { buildGameData } from "../src/augdata.js";

const dir = new URL("../data/", import.meta.url);
const { events, ...catalog } = await buildGameData(process.env.LOL_LANG || "ko_kr");
if (!catalog.augments.length || !events.length) throw new Error("증강 또는 이벤트 데이터가 비어 있습니다.");
await mkdir(dir, { recursive: true });
await writeFile(new URL("augments.json", dir), JSON.stringify(catalog, null, 1));
await writeFile(new URL("events.json", dir), JSON.stringify({ builtAt: catalog.builtAt, events }, null, 1));
console.log(`증강 ${catalog.augments.length}개, 귀빈 이벤트 ${events.length}개 저장 완료`);
