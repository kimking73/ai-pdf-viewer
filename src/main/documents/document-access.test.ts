import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DocumentGrant, inspectPdfFile } from './document-access';

const dir = mkdtempSync(join(tmpdir(), 'document-access-'));
const write = (name: string, content: string): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('inspectPdfFile', () => {
  it('PDF 머리글이 있는 일반 파일을 받는다', async () => {
    const path = write('ok.pdf', '%PDF-1.7\n');
    const result = await inspectPdfFile(path);
    expect(result).toMatchObject({ ok: true, name: 'ok.pdf' });
  });

  it('앞에 바이트가 조금 붙은 PDF도 받는다', async () => {
    await expect(inspectPdfFile(write('prefixed.pdf', '\n\n%PDF-1.4\n'))).resolves.toMatchObject({ ok: true });
  });

  it('심볼릭 링크는 실제 파일로 해석한다', async () => {
    const target = write('target.pdf', '%PDF-1.7\n');
    const link = join(dir, 'link.pdf');
    symlinkSync(target, link);
    const result = await inspectPdfFile(link);
    expect(result.ok && result.realPath.endsWith('target.pdf')).toBe(true);
  });

  it.each([
    ['상대 경로', '../../etc/passwd', 'unreadable'],
    ['널 문자', '/tmp/a\0.pdf', 'unreadable'],
    ['없는 파일', '/nonexistent/file.pdf', 'unreadable'],
  ])('%s은 거부한다', async (_name, path, reason) => {
    await expect(inspectPdfFile(path)).resolves.toEqual({ ok: false, reason });
  });

  it('폴더는 PDF가 아니다', async () => {
    await expect(inspectPdfFile(dir)).resolves.toEqual({ ok: false, reason: 'not-pdf' });
  });

  it('확장자가 PDF인데 머리글이 없으면 손상, 다른 확장자면 PDF 아님으로 구분한다', async () => {
    await expect(inspectPdfFile(write('garbage.pdf', 'hello'))).resolves.toEqual({ ok: false, reason: 'corrupt' });
    await expect(inspectPdfFile(write('empty.pdf', ''))).resolves.toEqual({ ok: false, reason: 'corrupt' });
    await expect(inspectPdfFile(write('notes.txt', 'hello'))).resolves.toEqual({ ok: false, reason: 'not-pdf' });
  });

  it('크기 제한을 넘으면 거부한다', async () => {
    const path = write('big.pdf', '%PDF-1.7\n0123456789');
    await expect(inspectPdfFile(path, 5)).resolves.toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('DocumentGrant', () => {
  const pdf = write('grant.pdf', '%PDF-1.7\nbody');

  it('발급한 ID로만 읽는다', async () => {
    const grant = new DocumentGrant();
    const id = grant.grant(pdf);
    const read = await grant.read(id);
    expect(read?.status === 'ok' && Buffer.from(read.bytes).toString()).toBe('%PDF-1.7\nbody');
    await expect(grant.read('00000000-0000-4000-8000-000000000000')).resolves.toBeNull();
  });

  it('새 문서를 고르거나 권한을 지우면 이전 ID는 무효다', async () => {
    const grant = new DocumentGrant();
    const first = grant.grant(pdf);
    const second = grant.grant(pdf);
    await expect(grant.read(first)).resolves.toBeNull();
    grant.revoke();
    await expect(grant.read(second)).resolves.toBeNull();
  });

  it('발급 기록은 읽기 권한과 별개이고 창을 닫으면 지운다', async () => {
    const grant = new DocumentGrant();
    const first = grant.grant(pdf);
    grant.grant(pdf);
    expect(grant.wasIssued(first)).toBe(true);
    await expect(grant.read(first)).resolves.toBeNull();
    expect(grant.wasIssued('00000000-0000-4000-8000-000000000000')).toBe(false);
    grant.revoke();
    expect(grant.wasIssued(first)).toBe(false);
  });

  it('고른 뒤 파일이 사라지거나 커지면 읽지 않는다', async () => {
    const gone = new DocumentGrant();
    const missing = write('gone.pdf', '%PDF-1.7\n');
    const id = gone.grant(missing);
    rmSync(missing);
    await expect(gone.read(id)).resolves.toEqual({ status: 'rejected', reason: 'unreadable' });

    const small = new DocumentGrant(3);
    await expect(small.read(small.grant(pdf))).resolves.toEqual({ status: 'rejected', reason: 'too-large' });
  });
});
