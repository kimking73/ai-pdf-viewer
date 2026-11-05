import { describe, expect, it } from 'vitest';
import { panelDefaultWidth, panelMaxWidth, panelWidth } from './panel-size';

describe('패널 폭', () => {
  it('기본 폭은 창의 33%이고 360~440으로 제한한다', () => {
    expect(panelDefaultWidth(800)).toBe(360);
    expect(panelDefaultWidth(1200)).toBeCloseTo(396);
    expect(panelDefaultWidth(2000)).toBe(440);
  });

  it('최대 폭은 뷰어 최소 폭을 남긴다', () => {
    expect(panelMaxWidth(800)).toBe(360);
    expect(panelMaxWidth(900)).toBe(460);
    expect(panelMaxWidth(1600)).toBe(560);
  });

  it('창을 줄이면 제한되고 늘리면 사용자가 정한 폭을 회복한다', () => {
    expect(panelWidth(560, 800)).toBe(360);
    expect(panelWidth(560, 1600)).toBe(560);
    expect(panelWidth(100, 1600)).toBe(360);
    expect(panelWidth(null, 1200)).toBe(396);
  });
});
