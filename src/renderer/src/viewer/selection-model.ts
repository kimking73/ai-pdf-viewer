// 선택의 순수 계산과 타입. 수치는 docs/design-contract.md 5.1절을 따른다.

export const TEXT_NEAR_PX = 8;
export const CLICK_MAX_MOVE_PX = 4;
export const AREA_MIN_SIZE_PX = 24;

/** 쪽 크기에 대한 비율(0~1). 배율이 바뀌어도 그대로 쓸 수 있다. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ActiveSelection =
  | { kind: 'text'; page: number; text: string; rects: PageRect[] }
  | { kind: 'area'; page: number; rect: PageRect; thumbnail: string };

export type DragKind = 'text' | 'area';

// 위에서부터 먼저 맞는 행을 적용한다.
export function decideDragKind(input: { altKey: boolean; areaMode: boolean; textNearby: boolean }): DragKind {
  if (input.altKey || input.areaMode) return 'area';
  return input.textNearby ? 'text' : 'area';
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): PageRect {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  return { x, y, width: clamp01(Math.max(a.x, b.x)) - x, height: clamp01(Math.max(a.y, b.y)) - y };
}

export function isLargeEnough(rect: PageRect, page: { width: number; height: number }): boolean {
  return rect.width * page.width >= AREA_MIN_SIZE_PX && rect.height * page.height >= AREA_MIN_SIZE_PX;
}

// 키보드 영역 선택. 쪽 안에 머물도록 이동과 크기 조절을 제한한다(계약 5.8절).
export function nudgeRect(
  rect: PageRect,
  page: { width: number; height: number },
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  resize: boolean,
  stepPx = 8,
): PageRect {
  const dx = ((key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0) * stepPx) / page.width;
  const dy = ((key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0) * stepPx) / page.height;
  if (resize) {
    const width = Math.min(1 - rect.x, Math.max(AREA_MIN_SIZE_PX / page.width, rect.width + dx));
    const height = Math.min(1 - rect.y, Math.max(AREA_MIN_SIZE_PX / page.height, rect.height + dy));
    return { ...rect, width, height };
  }
  return {
    ...rect,
    x: Math.min(1 - rect.width, Math.max(0, rect.x + dx)),
    y: Math.min(1 - rect.height, Math.max(0, rect.y + dy)),
  };
}
