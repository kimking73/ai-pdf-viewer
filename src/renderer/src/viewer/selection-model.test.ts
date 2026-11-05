import { describe, expect, it } from 'vitest';
import { decideDragKind, isLargeEnough, nudgeRect, rectFromPoints } from './selection-model';

describe('decideDragKind', () => {
  it.each([
    [{ altKey: true, areaMode: false, textNearby: true }, 'area'],
    [{ altKey: false, areaMode: true, textNearby: true }, 'area'],
    [{ altKey: false, areaMode: false, textNearby: true }, 'text'],
    [{ altKey: false, areaMode: false, textNearby: false }, 'area'],
  ])('%o -> %s', (input, expected) => {
    expect(decideDragKind(input)).toBe(expected);
  });
});

describe('영역 계산', () => {
  const page = { width: 1000, height: 1000 };

  it('끄는 방향과 관계없이 사각형을 만들고 쪽 밖으로 나가지 않는다', () => {
    expect(rectFromPoints({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.4 });
    expect(rectFromPoints({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.2 })).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it('24×24px보다 작으면 버린다', () => {
    expect(isLargeEnough({ x: 0, y: 0, width: 0.024, height: 0.024 }, page)).toBe(true);
    expect(isLargeEnough({ x: 0, y: 0, width: 0.023, height: 0.5 }, page)).toBe(false);
  });

  it('키보드 이동과 크기 조절은 쪽 안에 머문다', () => {
    const rect = { x: 0, y: 0, width: 0.1, height: 0.1 };
    expect(nudgeRect(rect, page, 'ArrowRight', false).x).toBeCloseTo(0.008);
    expect(nudgeRect(rect, page, 'ArrowLeft', false).x).toBe(0);
    expect(nudgeRect(rect, page, 'ArrowDown', true).height).toBeCloseTo(0.108);
    expect(nudgeRect({ ...rect, width: 0.024 }, page, 'ArrowLeft', true).width).toBeCloseTo(0.024);
    expect(nudgeRect({ x: 0.9, y: 0, width: 0.1, height: 0.1 }, page, 'ArrowRight', true).width).toBeCloseTo(0.1);
  });
});
