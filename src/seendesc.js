import { join } from "node:path";
import { dataDir, readJson, saveJson } from "./gamecache.js";

let pending = Promise.resolve();
let observations;
const empty = Object.freeze({});
let recent = new Map();
export async function seenFor(version) {
  observations ??= (await readJson(join(dataDir, "seen-desc.json"))) || {};
  return observations.version === version ? observations.rows || empty : empty;
}

export function readCardDescriptions(cards, lines) {
  const frame = new Map();
  for (const card of cards) {
    if (card.recovered || card.x == null || card.y == null) continue;
    const exact = lines.some(l => l.x === card.x && l.y === card.y && [card.name, card.nameEn].includes(l.s?.trim()));
    if (!exact) continue;
    const words = lines.filter(l => Math.abs(l.x - card.x) < 0.09 && l.y > card.y + 0.012 && l.y < card.y + 0.24)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const text = words.map(l => l.s?.trim()).filter(Boolean).join(" ");
    if (text.length >= 12 && text.length <= 600 && /[가-힣a-z]{2}/i.test(text)) frame.set(card.apiName, text);
  }
  return frame;
}

export function recordCards(cards, lines, version) {
  const frame = readCardDescriptions(cards.filter((card) => !card.desc || card.desc.includes("?")), lines);
  const stable = [...frame].filter(([k,v]) => recent.get(k) === v);
  recent = frame;
  if (!stable.length) return;
  pending = pending.catch(() => {}).then(async () => {
    const rows = await seenFor(version);
    if (stable.every(([k,v]) => rows[k] === v)) return;
    const next = { version, rows: { ...rows, ...Object.fromEntries(stable) } };
    await saveJson(dataDir, "seen-desc.json", next);
    observations = next;
  });
  return pending;
}
