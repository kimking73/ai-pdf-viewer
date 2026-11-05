import { describe, expect, it } from 'vitest';
import {
  clampScale,
  initialFitMode,
  MAX_SCALE,
  MIN_SCALE,
  nextZoomStop,
  pageAtLine,
  parsePageInput,
  previousZoomStop,
} from './view-math';

describe('배율', () => {
  it('50~400%로 제한한다', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(1.3)).toBe(1.3);
  });

  it('다음과 이전 단계로 이동하고 끝을 넘지 않는다', () => {
    expect(nextZoomStop(1)).toBe(1.1);
    expect(nextZoomStop(1.03)).toBe(1.1);
    expect(previousZoomStop(1.03)).toBe(1);
    expect(nextZoomStop(4)).toBe(MAX_SCALE);
    expect(previousZoomStop(0.5)).toBe(MIN_SCALE);
  });
});

describe('initialFitMode', () => {
  const viewport = { width: 1000, height: 700 };

  it('세로 쪽은 폭 맞춤이다', () => {
    expect(initialFitMode({ width: 612, height: 792 }, viewport)).toBe('fit-width');
  });

  it('가로로 긴 쪽이 세로로 넘치면 쪽 맞춤이다', () => {
    expect(initialFitMode({ width: 720, height: 540 }, viewport)).toBe('fit-page');
  });

  it('가로로 긴 쪽이 세로로 넘치지 않으면 폭 맞춤이다', () => {
    expect(initialFitMode({ width: 960, height: 300 }, viewport)).toBe('fit-width');
  });
});

describe('pageAtLine', () => {
  // 높이 100, 틈 10인 쪽 5개: 1쪽 0~100, 2쪽 110~210, ...
  const boxOf = (page: number) => ({ top: (page - 1) * 110 });

  it('중앙선이 걸린 쪽을 찾는다', () => {
    expect(pageAtLine(5, boxOf, 50)).toBe(1);
    expect(pageAtLine(5, boxOf, 150)).toBe(2);
    expect(pageAtLine(5, boxOf, 9999)).toBe(5);
  });

  it('쪽 사이 틈은 위쪽 쪽으로 본다', () => {
    expect(pageAtLine(5, boxOf, 105)).toBe(1);
  });

  it('300쪽에서도 레이아웃을 몇 번만 읽는다', () => {
    let reads = 0;
    const counted = (page: number) => {
      reads += 1;
      return boxOf(page);
    };
    expect(pageAtLine(300, counted, 150 * 110 + 5)).toBe(151);
    expect(reads).toBeLessThanOrEqual(9);
  });
});

describe('parsePageInput', () => {
  it('범위 안의 숫자를 받고 범위 밖은 끝 쪽으로 맞춘다', () => {
    expect(parsePageInput(' 12 ', 80)).toBe(12);
    expect(parsePageInput('0', 80)).toBe(1);
    expect(parsePageInput('999', 80)).toBe(80);
  });

  it.each(['', 'abc', '1.5', '-3', '12쪽'])('%s은 쪽 번호가 아니다', (text) => {
    expect(parsePageInput(text, 80)).toBeNull();
  });
});
