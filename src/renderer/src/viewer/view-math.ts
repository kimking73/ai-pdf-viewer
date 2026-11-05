// 뷰어의 순수 계산. DOM과 pdf.js에 의존하지 않아 단위 테스트로 확인한다.

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;

const ZOOM_STOPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
// pdf.js의 CSS 변환 단위: PDF 1pt = 96/72 CSS px.
const CSS_PER_POINT = 96 / 72;
// PDFViewer의 폭 맞춤이 스크롤 막대 몫으로 비워 두는 값.
const FIT_WIDTH_PADDING = 40;

export type FitMode = 'fit-width' | 'fit-page' | 'manual';

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function nextZoomStop(scale: number): number {
  return ZOOM_STOPS.find((stop) => stop > scale + 0.001) ?? MAX_SCALE;
}

export function previousZoomStop(scale: number): number {
  return ZOOM_STOPS.findLast((stop) => stop < scale - 0.001) ?? MIN_SCALE;
}

// 기본은 폭 맞춤. 슬라이드처럼 가로로 긴 쪽이 폭 맞춤에서 세로로 넘치면 쪽 맞춤으로 시작한다(계약 2.5절).
export function initialFitMode(
  page: { width: number; height: number },
  viewport: { width: number; height: number },
): Exclude<FitMode, 'manual'> {
  if (page.width <= page.height) return 'fit-width';
  const scale = (viewport.width - FIT_WIDTH_PADDING) / (page.width * CSS_PER_POINT);
  return page.height * CSS_PER_POINT * scale > viewport.height ? 'fit-page' : 'fit-width';
}

// 현재 쪽은 세로 중앙선에 걸린 쪽이다. 중앙선이 쪽 사이 틈에 있으면 위쪽 쪽으로 본다(계약 3.1절).
// 쪽 수가 많아도 레이아웃을 몇 번만 읽도록 이진 탐색한다. box의 위치는 쪽 번호 순서로 증가해야 한다.
export function pageAtLine(pageCount: number, boxOf: (page: number) => { top: number }, line: number): number {
  let low = 1;
  let high = pageCount;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (boxOf(middle).top <= line) low = middle;
    else high = middle - 1;
  }
  return low;
}

// 쪽 번호 입력값을 해석한다. 숫자가 아니면 null, 범위를 넘으면 가까운 끝 쪽으로 맞춘다.
export function parsePageInput(text: string, pageCount: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Math.min(pageCount, Math.max(1, Number(trimmed)));
}
