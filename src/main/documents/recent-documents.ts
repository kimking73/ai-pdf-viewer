import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const MAX_ENTRIES = 8;

const StoredEntries = z.array(z.object({ path: z.string().min(1), name: z.string().min(1), openedAt: z.number() }));
type StoredEntry = z.infer<typeof StoredEntries>[number];

export interface RecentDocument {
  id: string;
  name: string;
  openedAt: number;
}

function idOf(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

// 최근에 연 문서. 경로는 메인에만 두고 렌더러에는 파일명과 불투명한 ID만 준다.
// 렌더러는 이 목록에 있는 파일만 다시 열 수 있고, 임의의 경로를 지정할 수 없다.
export class RecentDocuments {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  private read(): StoredEntry[] {
    try {
      const parsed = StoredEntries.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  // 목록을 저장하지 못해도 문서는 열려야 하므로 기록만 남긴다.
  private write(entries: StoredEntry[]): void {
    const temporary = `${this.filePath}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
      renameSync(temporary, this.filePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      console.error(`[recent] 저장 실패: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  add(path: string, name: string): void {
    const others = this.read().filter((entry) => entry.path !== path);
    this.write([{ path, name, openedAt: this.now() }, ...others].slice(0, MAX_ENTRIES));
  }

  remove(id: string): void {
    this.write(this.read().filter(({ path }) => idOf(path) !== id));
  }

  /** 목록에 있는 ID만 경로로 바꾼다. */
  pathFor(id: string): string | null {
    return this.read().find(({ path }) => idOf(path) === id)?.path ?? null;
  }

  /** 지우거나 옮겨 없어진 파일은 목록에서 뺀다. */
  async list(): Promise<RecentDocument[]> {
    const entries = this.read();
    const exists = await Promise.all(
      entries.map(async ({ path }) => {
        try {
          return (await stat(path)).isFile();
        } catch {
          return false;
        }
      }),
    );
    const kept = entries.filter((_entry, index) => exists[index]);
    if (kept.length !== entries.length) this.write(kept);
    return kept.map(({ path, name, openedAt }) => ({ id: idOf(path), name, openedAt }));
  }
}
