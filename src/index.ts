#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { parseExportFile } from './parser';
import type { ILLMClient } from './llm/interface';
import { createLLMClient } from './llm/factory';
import { classifyConversations } from './llm/classify';
import { summarizeByTopics } from './llm/summarize';
import { generateMonthlyReport } from './llm/report';
import { validateClassifications } from './validation';
import { getStorage, closeStorage } from './storage';
import type { IStorage } from './storage';
import {
  printMonthlyReport,
  printClassificationSummary,
  printValidationResult,
  printError,
  printSuccess,
} from './output/cli';
import { generateHTMLReport } from './output/html';
import { downloadFromManifest, extractConversationsZip } from './downloader';
import { PLATFORM } from './constants';

const DEFAULT_MANIFEST_PATH = 'data/manifest.json';
const DEFAULT_CONVERSATIONS_ZIP = 'data/conversations.zip';
const DEFAULT_CONVERSATIONS_JSON = 'data/conversations.json';
const DEFAULT_CHATGPT_PATH = 'data/chatgpt_export.json';

const program = new Command();

program
  .name('myllm-report')
  .description('LLM 대화 export JSON을 분석해 월간 리포트를 생성하는 로컬 CLI 도구')
  .version('1.0.0');

// =====================
// run: 파일 하나로 전체 파이프라인 자동 실행 (재시작 복구 포함)
// =====================
program
  .command('run')
  .description('export 파일 → 분류 → 리포트 → HTML 전체 파이프라인 자동 실행')
  .option('--file <path>', 'export JSON 파일 경로')
  .option('--platform <claude|chatgpt>', '플랫폼 (claude 또는 chatgpt)')
  .option('--manifest <path>', 'Claude 내보내기 매니페스트 JSON 경로 (자동 다운로드)')
  .option('--validate', '분류 완료 후 LLM-as-judge 정확도 검증 실행 및 DB 저장')
  .option('--open', '완료 후 HTML 리포트를 브라우저에서 자동으로 열기')
  .action(async (options: { file?: string; platform?: string; manifest?: string; validate?: boolean; open?: boolean }) => {
    // 옵션 없으면 우선순위대로 자동 탐색
    if (!options.manifest && !options.file) {
      if (fs.existsSync(DEFAULT_CONVERSATIONS_ZIP)) {
        options.file = DEFAULT_CONVERSATIONS_ZIP;
        options.platform = PLATFORM.CLAUDE;
        console.log(chalk.gray(`  자동 감지: ${DEFAULT_CONVERSATIONS_ZIP}\n`));
      } else if (fs.existsSync(DEFAULT_CONVERSATIONS_JSON)) {
        options.file = DEFAULT_CONVERSATIONS_JSON;
        options.platform = PLATFORM.CLAUDE;
        console.log(chalk.gray(`  자동 감지: ${DEFAULT_CONVERSATIONS_JSON}\n`));
      } else if (fs.existsSync(DEFAULT_MANIFEST_PATH)) {
        options.manifest = DEFAULT_MANIFEST_PATH;
        console.log(chalk.gray(`  자동 감지: ${DEFAULT_MANIFEST_PATH}\n`));
      } else {
        printError(
          '분석할 파일을 찾을 수 없습니다.\n\n' +
          '  [Claude 사용자 — 권장]\n' +
          '    1. claude.ai → 설정 → 개인정보보호 → 데이터 내보내기\n' +
          '    2. 이메일에서 conversations-000.zip 링크를 브라우저로 열어 다운로드\n' +
          '    3. 파일을 data/conversations.zip 으로 저장\n' +
          '    4. npm run analyze\n\n' +
          '  [ChatGPT 사용자]\n' +
          '    1. ChatGPT export ZIP 압축 해제 후 conversations.json\n' +
          '    2. data/chatgpt_export.json 으로 저장\n' +
          '    3. npm run analyze:chatgpt'
        );
        process.exit(1);
      }
    }

    console.log(chalk.cyan('\n[MyLLM Report] 전체 파이프라인 시작\n'));

    const client = createLLMClient();
    let storage: IStorage | null = null;

    try {
      // 1. 파싱 (매니페스트 또는 직접 파일)
      console.log(chalk.bold('─── 1단계: 파싱 ───'));

      let filePath = options.file!;
      let platform = options.platform!;

      if (options.manifest) {
        console.log(`  매니페스트에서 자동 다운로드 중...\n`);
        filePath = await downloadFromManifest(options.manifest);
        platform = PLATFORM.CLAUDE;
      } else if (filePath.endsWith('.zip')) {
        filePath = extractConversationsZip(filePath);
        platform = platform ?? PLATFORM.CLAUDE;
      } else if (platform !== PLATFORM.CLAUDE && platform !== PLATFORM.CHATGPT) {
        printError(`지원하지 않는 플랫폼: ${platform}`);
        process.exit(1);
      }

      const conversations = parseExportFile(filePath, platform as 'claude' | 'chatgpt');
      if (conversations.length === 0) {
        printError('파싱된 대화가 없습니다. 파일 형식을 확인해주세요.');
        process.exit(1);
      }

      storage = getStorage();
      storage.saveConversations(conversations);

      const months = Array.from(
        new Set(conversations.map((c) => c.created_at.substring(0, 7)))
      ).sort();

      console.log(`  감지된 월: ${chalk.yellow(months.join(', '))}\n`);

      await checkOllamaHealth(client);

      for (const month of months) {
        console.log(chalk.bold(`\n═══ ${month} 처리 시작 ═══`));

        // 2. 분류 (재시작 복구)
        console.log(chalk.bold('\n─── 2단계: 분류 ───'));
        const monthConvs = storage.getConversationsByMonth(month);
        const alreadyDone = storage.getClassifiedConversationIds(month);
        const remaining = monthConvs.filter((c) => !alreadyDone.has(c.conversation_id));

        if (alreadyDone.size > 0) {
          console.log(`  이미 분류됨: ${chalk.green(String(alreadyDone.size))}개 (건너뜀)`);
        }

        if (remaining.length > 0) {
          console.log(`  분류 예정: ${chalk.yellow(String(remaining.length))}개\n`);
          const newResults = await classifyConversations(remaining, client);
          storage.saveClassificationResults(newResults);
        } else {
          console.log(`  ${chalk.green('✓')} 모든 대화가 이미 분류되어 있습니다.\n`);
        }

        // 3. 검증 (--validate 플래그 시)
        if (options.validate) {
          console.log(chalk.bold('─── 3단계: 분류 정확도 검증 ───'));
          const allConvsForValidate = storage.getConversationsByMonth(month);
          const allClassificationsForValidate = storage.getClassificationResultsByMonth(month);
          try {
            const validationResult = await validateClassifications(allConvsForValidate, allClassificationsForValidate, client);
            storage.saveValidationResult(month, validationResult);
            printValidationResult(validationResult);
          } catch (e) {
            console.log(chalk.yellow(`  검증 단계 오류 (건너뜀): ${(e as Error).message}\n`));
          }
        }

        // 4. 리포트 생성
        console.log(chalk.bold('─── 4단계: 리포트 생성 ───'));
        const allConvs = storage.getConversationsByMonth(month);
        const allClassifications = storage.getClassificationResultsByMonth(month);

        if (allClassifications.length === 0) {
          console.log(chalk.yellow(`  ${month}에 분류된 대화가 없어 리포트를 건너뜁니다.\n`));
          continue;
        }

        const summaries = await summarizeByTopics(allConvs, allClassifications, client);

        // 이전 달 리포트 로드 (비교용)
        const prevMonth = getPrevMonth(month);
        const prevReport = storage.getLatestReport(prevMonth);

        const report = await generateMonthlyReport(month, allConvs, allClassifications, summaries, client, prevReport);
        storage.saveReport(report);

        printMonthlyReport(report);

        // 5. HTML 생성
        console.log(chalk.bold('─── 5단계: HTML 생성 ───'));
        const outputPath = generateHTMLReport(report);
        printSuccess(`HTML 리포트: ${outputPath}`);

        if (options.open) {
          openFile(outputPath);
        }
      }

      console.log(chalk.bold.green('\n✓ 전체 파이프라인 완료\n'));
    } catch (error) {
      printError((error as Error).message);
      process.exit(1);
    } finally {
      closeStorage();
    }
  });

// =====================
// parse: export JSON → DB 저장
// =====================
program
  .command('parse')
  .description('Claude 또는 ChatGPT export JSON 파일을 파싱하여 DB에 저장')
  .requiredOption('--file <path>', 'export JSON 파일 경로')
  .requiredOption('--platform <claude|chatgpt>', '플랫폼 선택')
  .action(async (options: { file: string; platform: string }) => {
    console.log(chalk.cyan('\n[MyLLM Report] export 파일 파싱 시작\n'));

    if (options.platform !== PLATFORM.CLAUDE && options.platform !== PLATFORM.CHATGPT) {
      printError(`지원하지 않는 플랫폼: ${options.platform}. 'claude' 또는 'chatgpt'를 사용하세요.`);
      process.exit(1);
    }

    let storage: IStorage | null = null;
    try {
      const conversations = parseExportFile(options.file, options.platform);

      if (conversations.length === 0) {
        throw new Error('파싱된 대화가 없습니다. 파일 형식을 확인해주세요.');
      }

      storage = getStorage();
      const savedCount = storage.saveConversations(conversations);

      printSuccess(`${savedCount}개 대화를 파싱하고 DB에 저장했습니다.`);

      const monthCount = new Map<string, number>();
      for (const conv of conversations) {
        const month = conv.created_at.substring(0, 7);
        monthCount.set(month, (monthCount.get(month) ?? 0) + 1);
      }

      console.log(chalk.bold('  저장된 대화 월별 분포:'));
      for (const [month, count] of Array.from(monthCount.entries()).sort()) {
        console.log(`    ${month}: ${chalk.yellow(String(count))}개`);
      }
      console.log('');
    } catch (error) {
      printError((error as Error).message);
      process.exit(1);
    } finally {
      closeStorage();
    }
  });

// =====================
// classify: 재시작 복구 포함 분류
// =====================
program
  .command('classify')
  .description('지정된 월의 대화를 Ollama LLM으로 분류 (이미 처리된 대화는 건너뜀)')
  .requiredOption('--month <YYYY-MM>', '분류할 월 (예: 2024-01)')
  .option('--force', '이미 분류된 대화도 재분류')
  .action(async (options: { month: string; force?: boolean }) => {
    if (!isValidMonth(options.month)) {
      printError('월 형식이 올바르지 않습니다. YYYY-MM 형식을 사용하세요. (예: 2024-01)');
      process.exit(1);
    }

    console.log(chalk.cyan(`\n[MyLLM Report] ${options.month} 대화 분류 시작\n`));
    const client = createLLMClient();
    let storage: IStorage | null = null;

    try {
      await checkOllamaHealth(client);

      storage = getStorage();
      const conversations = storage.getConversationsByMonth(options.month);

      if (conversations.length === 0) {
        throw new Error(`${options.month}에 저장된 대화가 없습니다. 먼저 parse 명령어로 데이터를 불러오세요.`);
      }

      // 재시작 복구: 이미 분류된 대화 건너뜀 (--force 옵션 시 전체 재처리)
      const alreadyDone = options.force ? new Set<string>() : storage.getClassifiedConversationIds(options.month);
      const remaining = conversations.filter((c) => !alreadyDone.has(c.conversation_id));

      if (alreadyDone.size > 0 && !options.force) {
        console.log(`  이미 분류됨: ${chalk.green(String(alreadyDone.size))}개 (건너뜀)`);
        console.log(`  남은 대화 : ${chalk.yellow(String(remaining.length))}개\n`);
      }

      if (remaining.length === 0) {
        printSuccess('모든 대화가 이미 분류되어 있습니다. 재분류하려면 --force 옵션을 사용하세요.');
        return;
      }

      console.log(`  총 ${chalk.yellow(String(remaining.length))}개 대화를 분류합니다...\n`);

      const results = await classifyConversations(remaining, client);
      storage.saveClassificationResults(results);

      printClassificationSummary(results);
      printSuccess(`${results.length}개 대화 분류 완료. (누적 완료: ${alreadyDone.size + results.length}/${conversations.length}개)`);
    } catch (error) {
      printError((error as Error).message);
      process.exit(1);
    } finally {
      closeStorage();
    }
  });

// =====================
// report: 월간 리포트 생성
// =====================
program
  .command('report')
  .description('지정된 월의 분류 결과를 바탕으로 월간 리포트 생성')
  .requiredOption('--month <YYYY-MM>', '리포트 생성할 월 (예: 2024-01)')
  .action(async (options: { month: string }) => {
    if (!isValidMonth(options.month)) {
      printError('월 형식이 올바르지 않습니다. YYYY-MM 형식을 사용하세요. (예: 2024-01)');
      process.exit(1);
    }

    console.log(chalk.cyan(`\n[MyLLM Report] ${options.month} 월간 리포트 생성 시작\n`));
    const client = createLLMClient();
    let storage: IStorage | null = null;

    try {
      await checkOllamaHealth(client);

      storage = getStorage();
      const conversations = storage.getConversationsByMonth(options.month);
      const classifications = storage.getClassificationResultsByMonth(options.month);

      if (classifications.length === 0) {
        throw new Error(
          `${options.month}에 분류된 대화가 없습니다.\n  먼저 classify 명령어로 분류를 완료하세요.\n  npx ts-node src/index.ts classify --month ${options.month}`
        );
      }

      const unclassified = conversations.length - classifications.length;
      if (unclassified > 0) {
        console.log(chalk.yellow(`  경고: ${unclassified}개 대화가 아직 분류되지 않았습니다. classify --month ${options.month} 를 먼저 실행하세요.\n`));
      }

      console.log(`  총 ${chalk.yellow(String(classifications.length))}개 분류된 대화로 리포트를 생성합니다...\n`);

      const summaries = await summarizeByTopics(conversations, classifications, client);

      // 이전 달 리포트 로드 (비교용)
      const prevMonth = getPrevMonth(options.month);
      const prevReport = storage.getLatestReport(prevMonth);

      const report = await generateMonthlyReport(options.month, conversations, classifications, summaries, client, prevReport);

      storage.saveReport(report);

      printMonthlyReport(report);
      printSuccess(`리포트가 저장되었습니다. HTML 리포트: npx ts-node src/index.ts html --month ${options.month}`);
    } catch (error) {
      printError((error as Error).message);
      process.exit(1);
    } finally {
      closeStorage();
    }
  });

// =====================
// validate: 분류 정확도 검증
// =====================
program
  .command('validate')
  .description('무작위 샘플을 선택하여 분류 정확도를 LLM-as-judge로 검증')
  .requiredOption('--month <YYYY-MM>', '검증할 월 (예: 2024-01)')
  .option('--sample-size <number>', '검증 샘플 수 (기본값: 자동, 5~10개)', parseInt)
  .action(async (options: { month: string; sampleSize?: number }) => {
    if (!isValidMonth(options.month)) {
      printError('월 형식이 올바르지 않습니다. YYYY-MM 형식을 사용하세요. (예: 2024-01)');
      process.exit(1);
    }

    console.log(chalk.cyan(`\n[MyLLM Report] ${options.month} 분류 정확도 검증 시작\n`));
    const client = createLLMClient();

    try {
      await checkOllamaHealth(client);

      const storage = getStorage();
      const conversations = storage.getConversationsByMonth(options.month);
      const classifications = storage.getClassificationResultsByMonth(options.month);

      if (classifications.length === 0) {
        closeStorage();
        printError(`${options.month}에 분류된 대화가 없습니다. 먼저 classify 명령어를 실행하세요.`);
        process.exit(1);
      }

      const result = await validateClassifications(conversations, classifications, client, options.sampleSize);
      storage.saveValidationResult(options.month, result);
      closeStorage();
      printValidationResult(result);
    } catch (error) {
      printError((error as Error).message);
      process.exit(1);
    } finally {
      closeStorage();
    }
  });

// =====================
// html: HTML 리포트 생성
// =====================
program
  .command('html')
  .description('저장된 월간 리포트를 HTML 파일로 출력')
  .requiredOption('--month <YYYY-MM>', 'HTML로 출력할 월 (예: 2024-01)')
  .option('--open', '생성 후 브라우저에서 자동으로 열기')
  .action(async (options: { month: string; open?: boolean }) => {
    if (!isValidMonth(options.month)) {
      printError('월 형식이 올바르지 않습니다. YYYY-MM 형식을 사용하세요. (예: 2024-01)');
      process.exit(1);
    }

    console.log(chalk.cyan(`\n[MyLLM Report] ${options.month} HTML 리포트 생성 중...\n`));

    try {
      const storage = getStorage();
      const report = storage.getLatestReport(options.month);
      closeStorage();

      if (!report) {
        printError(
          `${options.month}에 생성된 리포트가 없습니다.\n  먼저 report 명령어로 리포트를 생성하세요.\n  npx ts-node src/index.ts report --month ${options.month}`
        );
        process.exit(1);
      }

      const outputPath = generateHTMLReport(report);
      printSuccess(`HTML 리포트가 생성되었습니다: ${outputPath}`);

      if (options.open) {
        openFile(outputPath);
      } else {
        console.log(chalk.bold('  브라우저에서 열기:'));
        console.log(chalk.cyan(`  open "${outputPath}"`));
        console.log('');
      }
    } catch (error) {
      printError((error as Error).message);
      process.exit(1);
    }
  });

// =====================
// 유틸리티
// =====================

function isValidMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month);
}

function getPrevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // month is 1-based, Date month is 0-based
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function checkOllamaHealth(client: ILLMClient): Promise<void> {
  console.log(`  Ollama 서버 연결 확인 중... (모델: ${client.getModel()})`);
  const isHealthy = await client.checkHealth();

  if (!isHealthy) {
    throw new Error(
      `Ollama 서버에 연결할 수 없습니다.\n` +
        '  해결 방법:\n' +
        '    1. Ollama 설치: https://ollama.ai\n' +
        '    2. 서버 시작: ollama serve\n' +
        `    3. 모델 다운로드: ollama pull ${client.getModel()}\n` +
        '  환경변수로 모델 변경: OLLAMA_MODEL=mistral npx ts-node src/index.ts ...'
    );
  }

  console.log(chalk.green('  ✓ Ollama 서버 연결 성공\n'));
}

function openFile(filePath: string): void {
  try {
    const cmd =
      process.platform === 'darwin' ? `open "${filePath}"` :
      process.platform === 'win32' ? `start "" "${filePath}"` :
      `xdg-open "${filePath}"`;
    execSync(cmd);
  } catch {
    console.log(chalk.gray(`  파일을 직접 열어주세요: ${filePath}`));
  }
}

program.parse(process.argv);
