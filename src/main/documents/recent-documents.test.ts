import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecentDocuments } from './recent-documents';

describe('RecentDocuments', () => {
  let directory: string;
  let store: string;
  let clock: number;
  let recent: RecentDocuments;
  const pdf = (name: string): string => {
    const path = join(directory, name);
    writeFileSync(path, '%PDF-');
    return path;
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'recent-documents-'));
    store = join(directory, 'recent.json');
    clock = 1000;
    recent = new RecentDocuments(store, () => (clock += 1));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('최근에 연 문서가 먼저 오고, 다시 열면 맨 앞으로 간다', async () => {
    const a = pdf('a.pdf');
    recent.add(a, 'a.pdf');
    recent.add(pdf('b.pdf'), 'b.pdf');
    recent.add(a, 'a.pdf');
    expect((await recent.list()).map(({ name }) => name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('8개까지만 남긴다', async () => {
    for (let index = 0; index < 10; index += 1) recent.add(pdf(`${String(index)}.pdf`), `${String(index)}.pdf`);
    const list = await recent.list();
    expect(list).toHaveLength(8);
    expect(list[0]?.name).toBe('9.pdf');
  });

  it('목록에는 경로가 없고, ID로만 경로를 찾는다', async () => {
    const a = pdf('a.pdf');
    recent.add(a, 'a.pdf');
    const [entry] = await recent.list();
    expect(JSON.stringify(entry)).not.toContain(directory);
    expect(entry?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(recent.pathFor(entry?.id ?? '')).toBe(a);
    expect(recent.pathFor('0'.repeat(64))).toBeNull();
  });

  it('없어진 파일은 목록에서 빠진다', async () => {
    const a = pdf('a.pdf');
    recent.add(a, 'a.pdf');
    recent.add(pdf('b.pdf'), 'b.pdf');
    rmSync(a);
    expect((await recent.list()).map(({ name }) => name)).toEqual(['b.pdf']);
    expect(recent.pathFor('0'.repeat(64))).toBeNull();
  });

  it('지운 항목은 다시 나오지 않는다', async () => {
    recent.add(pdf('a.pdf'), 'a.pdf');
    const [entry] = await recent.list();
    recent.remove(entry?.id ?? '');
    expect(await recent.list()).toEqual([]);
  });

  it('소유자만 읽을 수 있고, 손상된 파일은 빈 목록이다', async () => {
    recent.add(pdf('a.pdf'), 'a.pdf');
    expect(statSync(store).mode & 0o777).toBe(0o600);
    writeFileSync(store, '{');
    expect(await recent.list()).toEqual([]);
  });
});
