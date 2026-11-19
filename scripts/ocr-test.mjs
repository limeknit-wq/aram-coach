// 이미지 한 장으로 증강 선택지 자동 감지를 시험합니다: node scripts/ocr-test.mjs <스크린샷.png>
import { matchAugments, scanImage } from "../src/watcher.js";
const path = process.argv[2];
if (path) {
  const offer = await scanImage(path);
  console.log(offer ? `감지됨: ${offer.names.join(" / ")}` : "선택지를 찾지 못했습니다");
} else {
  // OCR 오타 허용 확인
  const r = await matchAugments(["유리 대표", "너만을위해", "최첨단 발병가", "아이템 가속이 100 증가합니다.", "12:34", "증강을 선택하세요"]);
  console.log(r.map((a) => a.name));
}
