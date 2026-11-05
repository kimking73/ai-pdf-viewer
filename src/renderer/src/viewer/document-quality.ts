export type DocumentQuality = 'normal' | 'scan' | 'broken';

// 쪽 수가 많아도 진단이 첫 쪽 표시나 읽기를 막지 않도록 일부 쪽만 본다(계약 4.4절).
const SAMPLE_PAGES = 8;
const MIN_PAGE_CHARS = 10;
const SCAN_RATIO = 0.5;
const BROKEN_RATIO = 0.05;
// 글자 정보가 없을 때 PDF에서 흔히 나오는 대체 문자, 사용자 정의 영역, 제어 문자, (cid:123) 표기.
// eslint-disable-next-line no-control-regex -- 깨진 글자 정보를 찾는 것이 목적이다.
const SUSPICIOUS = /[�-\u0000-\u0008\u000E-\u001F]|\(cid:\d+\)/g;

/** 처음, 끝, 그 사이를 고르게 고른다. */
export function samplePageNumbers(pageCount: number): number[] {
  if (pageCount <= SAMPLE_PAGES) return Array.from({ length: pageCount }, (_unused, index) => index + 1);
  const step = (pageCount - 1) / (SAMPLE_PAGES - 1);
  return Array.from({ length: SAMPLE_PAGES }, (_unused, index) => Math.round(1 + index * step));
}

// 글자가 그럴듯한 다른 글자로 잘못 대응된 문서는 그림과 비교해야 알 수 있어 여기서 잡지 못한다(US-7 단순형).
export function classifyDocumentText(pages: string[]): DocumentQuality {
  if (pages.length === 0) return 'normal';
  const compact = pages.map((text) => text.replace(/\s/g, ''));
  const empty = compact.filter((text) => text.length < MIN_PAGE_CHARS).length;
  if (empty / pages.length >= SCAN_RATIO) return 'scan';
  const all = compact.join('');
  const suspicious = all.match(SUSPICIOUS)?.length ?? 0;
  return suspicious / all.length >= BROKEN_RATIO ? 'broken' : 'normal';
}

export function qualityMessage(quality: DocumentQuality): string | null {
  if (quality === 'scan') return '스캔 문서로 보이며 정확도가 낮을 수 있습니다. 궁금한 부분을 끌어서 선택해 보세요.';
  if (quality === 'broken') return '이 문서의 글자 정보가 깨져 있어 정확도가 낮을 수 있습니다. 궁금한 부분을 끌어서 선택해 보세요.';
  return null;
}
