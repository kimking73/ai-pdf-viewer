import { randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import type { PdfRejectionReason } from '../../shared/ipc/contract';

// 문서 전체를 IPC로 한 번에 넘기므로 메모리를 기준으로 상한을 둔다.
export const MAX_PDF_BYTES = 1024 * 1024 * 1024;

// PDF 표준의 머리글은 파일 처음에 있지만, 앞에 쓰레기 바이트가 붙은 파일도 흔해 1KB까지 찾는다.
const SIGNATURE = Buffer.from('%PDF-');
const SIGNATURE_SEARCH_BYTES = 1024;

export type InspectionResult =
  | { ok: true; realPath: string; name: string }
  | { ok: false; reason: PdfRejectionReason };

// 경로를 믿지 않고 실제 파일을 확인한다: 절대 경로, 심볼릭 링크 해석, 일반 파일, 크기, PDF 머리글.
export async function inspectPdfFile(path: string, maxBytes = MAX_PDF_BYTES): Promise<InspectionResult> {
  if (!isAbsolute(path) || path.includes('\0')) return { ok: false, reason: 'unreadable' };

  try {
    const realPath = await realpath(path);
    const file = await open(realPath, 'r');
    try {
      const stats = await file.stat();
      if (!stats.isFile()) return { ok: false, reason: 'not-pdf' };
      if (stats.size > maxBytes) return { ok: false, reason: 'too-large' };

      const head = Buffer.alloc(Math.min(SIGNATURE_SEARCH_BYTES, stats.size));
      const { bytesRead } = await file.read(head, 0, head.length, 0);
      if (head.subarray(0, bytesRead).includes(SIGNATURE)) {
        return { ok: true, realPath, name: basename(path) };
      }
      // 확장자가 PDF인데 내용이 다르면 망가진 PDF로, 그 밖에는 PDF가 아닌 파일로 안내한다.
      const claimsPdf = extname(path).toLowerCase() === '.pdf';
      return { ok: false, reason: claimsPdf ? 'corrupt' : 'not-pdf' };
    } finally {
      await file.close();
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export type GrantedRead = { status: 'ok'; bytes: Uint8Array<ArrayBuffer> } | { status: 'rejected'; reason: PdfRejectionReason };

// 사용자가 고른 파일 하나에만 읽기 권한을 준다. 렌더러는 ID만 알고, 새 문서를 고르면 이전 ID는 무효가 된다.
export class DocumentGrant {
  private current: { id: string; realPath: string } | null = null;
  // 튜터 세션이 발급한 ID인지 확인하는 용도. 읽기 권한과는 별개다. 손상 파일을 고르면 읽기 권한은
  // 넘어가지만 화면에는 이전 문서가 남아 있으므로, 그 문서의 ID도 인정해야 한다.
  private readonly issued = new Set<string>();

  constructor(private readonly maxBytes = MAX_PDF_BYTES) {}

  grant(realPath: string): string {
    const id = randomUUID();
    this.current = { id, realPath };
    this.issued.add(id);
    return id;
  }

  revoke(): void {
    this.current = null;
    this.issued.clear();
  }

  wasIssued(id: string): boolean {
    return this.issued.has(id);
  }

  async read(id: string): Promise<GrantedRead | null> {
    if (this.current?.id !== id) return null;
    try {
      const file = await open(this.current.realPath, 'r');
      try {
        // 고른 뒤 파일이 바뀌었을 수 있어 열린 파일 기준으로 다시 확인한다.
        const stats = await file.stat();
        if (!stats.isFile()) return { status: 'rejected', reason: 'unreadable' };
        if (stats.size > this.maxBytes) return { status: 'rejected', reason: 'too-large' };
        const data = await file.readFile();
        return { status: 'ok', bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
      } finally {
        await file.close();
      }
    } catch {
      return { status: 'rejected', reason: 'unreadable' };
    }
  }
}
