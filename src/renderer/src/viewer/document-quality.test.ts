import { describe, expect, it } from 'vitest';
import { classifyDocumentText, qualityMessage, samplePageNumbers } from './document-quality';

const normal = '정규분포를 따르는 확률변수의 성질을 설명합니다.';

describe('classifyDocumentText', () => {
  it('글자가 있으면 정상이다', () => {
    expect(classifyDocumentText([normal, normal, 'Fixture page with English text'])).toBe('normal');
  });

  it('절반 이상의 쪽에 글자가 없으면 스캔이다', () => {
    expect(classifyDocumentText(['', ' ', normal, '짧음'])).toBe('scan');
    expect(classifyDocumentText(['', '', ''])).toBe('scan');
  });

  it('그림만 있는 쪽이 조금 섞여 있어도 정상이다', () => {
    expect(classifyDocumentText(['', normal, normal, normal])).toBe('normal');
  });

  it('대체 문자가 많으면 깨짐이다', () => {
    expect(classifyDocumentText(['������ abcdefghij'])).toBe('broken');
    expect(classifyDocumentText(['(cid:12)(cid:13)(cid:14) abcd'])).toBe('broken');
    expect(classifyDocumentText([''])).toBe('broken');
  });

  it('대체 문자가 드물면 정상이다', () => {
    expect(classifyDocumentText([normal.repeat(5) + '�'])).toBe('normal');
  });

  it('쪽이 없으면 경고하지 않는다', () => {
    expect(classifyDocumentText([])).toBe('normal');
  });
});

describe('samplePageNumbers', () => {
  it('적은 쪽은 전부 고른다', () => {
    expect(samplePageNumbers(3)).toEqual([1, 2, 3]);
  });

  it('많은 쪽은 처음과 끝을 포함해 8쪽만 고른다', () => {
    const pages = samplePageNumbers(300);
    expect(pages).toHaveLength(8);
    expect(pages[0]).toBe(1);
    expect(pages.at(-1)).toBe(300);
    expect(new Set(pages).size).toBe(8);
  });
});

it('정상 문서에는 안내 문구가 없다', () => {
  expect(qualityMessage('normal')).toBeNull();
  expect(qualityMessage('scan')).toContain('스캔');
  expect(qualityMessage('broken')).toContain('깨져');
});
