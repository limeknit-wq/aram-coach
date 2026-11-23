const source = "https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data";

export async function wikiDescriptions() {
  const r = await fetch(source + "?action=raw", { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("위키 설명을 가져올 수 없습니다.");
  const raw = await r.text();
  const rows = new Map();
  for (const match of raw.matchAll(/\["([^"\n]+)"\]\s*=\s*\{\s*\["description"\]\s*=\s*"((?:\\.|[^"\\])*)"/g)) {
    let desc = match[2].replace(/\\"/g, '"').replace(/'{2,}/g, "");
    for (let i = 0; i < 5 && desc.includes("{{"); i++) {
      desc = desc.replace(/\{\{([^{}]+)\}\}/g, (_, body) => {
        const [type, a, b] = body.split("|");
        return (type === "tip" ? b || a : a) || type;
      });
    }
    rows.set(match[1].toLowerCase(), desc.replace(/<[^>]*>/g, " ").trim());
  }
  return rows;
}

export const wikiCredit = { source, author: "League of Legends Wiki contributors", license: "CC BY-SA (원문 하단 라이선스 참조)", changes: "위키 마크업을 텍스트로 변환" };
