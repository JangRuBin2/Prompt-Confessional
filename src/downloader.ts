import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';
import { ExportManifestSchema } from './schemas';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDownload(downloadsDir: string, before: Set<string>, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entries = fs.readdirSync(downloadsDir);
    const newZips = entries.filter(
      (f) => !before.has(f) && f.endsWith('.zip') && !f.endsWith('.crdownload')
    );

    if (newZips.length > 0) {
      const zipPath = path.join(downloadsDir, newZips[0]);

      // 다운로드 완료 확인: 2초간 파일 크기 변화 없으면 완료
      let prevSize = -1;
      let stableSince = 0;
      while (true) {
        try {
          const size = fs.statSync(zipPath).size;
          if (size === prevSize) {
            if (stableSince === 0) stableSince = Date.now();
            if (Date.now() - stableSince > 2000) return zipPath;
          } else {
            prevSize = size;
            stableSince = 0;
          }
        } catch { /* 아직 생성 중 */ }
        await sleep(500);
      }
    }

    await sleep(1000);
  }

  throw new Error('다운로드 타임아웃 (2분). 브라우저에서 직접 다운로드 후 data/conversations.zip 으로 저장해 주세요.');
}

/**
 * conversations.zip 파일을 받아 JSON 배열을 반환
 */
export function extractConversationsZip(zipPath: string): string {
  console.log(`[Extract] zip 압축 해제 중: ${zipPath}`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myllm-'));
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(tempDir, true);

  const jsonFiles = findJsonFiles(tempDir);
  if (jsonFiles.length === 0) {
    throw new Error(`zip 내에서 JSON 파일을 찾을 수 없습니다: ${zipPath}`);
  }

  const allConversations: unknown[] = [];
  for (const jsonFile of jsonFiles) {
    const content = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    if (Array.isArray(content)) allConversations.push(...content);
  }

  const mergedPath = path.join(tempDir, 'conversations.json');
  fs.writeFileSync(mergedPath, JSON.stringify(allConversations, null, 2));
  console.log(`[Extract] 완료: ${allConversations.length}개 대화`);
  return mergedPath;
}

/**
 * Claude 내보내기 매니페스트 JSON을 읽어서
 * conversations 카테고리 zip을 다운로드 → 추출 → JSON 경로 반환
 *
 * 여러 파트(part: 0, part: 1, ...)가 있으면 모두 다운로드 후 병합
 */
export async function downloadFromManifest(manifestPath: string): Promise<string> {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`매니페스트 파일을 찾을 수 없습니다: ${manifestPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const parsed = ExportManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`매니페스트 형식이 올바르지 않습니다: ${parsed.error.message}`);
  }

  const manifest = parsed.data;
  const convFiles = manifest.data_files
    .filter((f) => f.category === 'conversations')
    .sort((a, b) => a.part - b.part);

  if (convFiles.length === 0) {
    throw new Error('매니페스트에 conversations 카테고리가 없습니다.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myllm-'));
  const allConversations: unknown[] = [];

  for (const file of convFiles) {
    console.log(`[Download] ${file.filename} 다운로드 중... (part ${file.part})`);

    let zipBuffer: Buffer;

    // 1차: 직접 fetch 시도
    const response = await fetch(file.export_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/octet-stream, */*',
      },
    });

    const contentType = response.headers.get('content-type') ?? '';
    const isZip = response.ok && (
      contentType.includes('zip') ||
      contentType.includes('octet-stream') ||
      contentType.includes('binary')
    );

    if (isZip) {
      zipBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      // 2차: 브라우저로 자동 오픈 후 Downloads 폴더 감시
      console.log(`\n  [Download] 브라우저 인증이 필요합니다. 브라우저로 다운로드를 시작합니다...`);

      const downloadsDir = path.join(os.homedir(), 'Downloads');
      const before = new Set(fs.readdirSync(downloadsDir));

      const openCmd =
        process.platform === 'darwin' ? `open "${file.export_url}"` :
        process.platform === 'win32' ? `start "" "${file.export_url}"` :
        `xdg-open "${file.export_url}"`;
      execSync(openCmd);

      console.log(`  브라우저에서 다운로드 중... (최대 2분 대기)`);
      const zipPath = await waitForDownload(downloadsDir, before);
      console.log(`  다운로드 완료: ${path.basename(zipPath)}`);

      zipBuffer = fs.readFileSync(zipPath);
    }

    const zip = new AdmZip(zipBuffer);
    const partDir = path.join(tempDir, `part_${file.part}`);
    zip.extractAllTo(partDir, true);

    // zip 내 JSON 파일 탐색 (중첩 디렉토리 포함)
    const jsonFiles = findJsonFiles(partDir);
    if (jsonFiles.length === 0) {
      throw new Error(`${file.filename} 내에서 JSON 파일을 찾을 수 없습니다.`);
    }

    for (const jsonFile of jsonFiles) {
      const content = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      if (Array.isArray(content)) {
        allConversations.push(...content);
      }
    }

    console.log(`[Download] part ${file.part} 완료 (누적 대화 수: ${allConversations.length}개)`);
  }

  // 병합된 conversations.json 저장
  const mergedPath = path.join(tempDir, 'conversations.json');
  fs.writeFileSync(mergedPath, JSON.stringify(allConversations, null, 2));
  console.log(`[Download] 전체 다운로드 완료: ${allConversations.length}개 대화`);

  return mergedPath;
}

function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}
