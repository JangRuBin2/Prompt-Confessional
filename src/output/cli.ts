import chalk from 'chalk';
import Table from 'cli-table3';
import { MonthlyReport, ClassificationResult, ValidationResult } from '../types';
import { DEFAULT_TOPIC } from '../constants';

/**
 * 구분선 출력
 */
function printDivider(char = '─', width = 60): void {
  console.log(chalk.gray(char.repeat(width)));
}

/**
 * 섹션 헤더 출력
 */
function printHeader(title: string): void {
  console.log('');
  printDivider('═');
  console.log(chalk.bold.cyan(`  ${title}`));
  printDivider('═');
}

/**
 * 전월 대비 변화량 포맷 헬퍼
 */
function formatDelta(delta: number | null, unit = '', decimals = 0): string {
  if (delta === null) return chalk.gray('(전월 없음)');
  const sign = delta >= 0 ? '+' : '';
  const val = decimals > 0 ? delta.toFixed(decimals) : String(Math.round(delta));
  const color = delta > 0 ? chalk.green : delta < 0 ? chalk.red : chalk.gray;
  return color(`${sign}${val}${unit}`);
}

/**
 * 월간 리포트 CLI 출력
 */
export function printMonthlyReport(report: MonthlyReport): void {
  printHeader(`📊 ${report.month} 월간 AI 사용 리포트`);

  // 기본 통계
  console.log('');
  console.log(chalk.bold('  기본 통계'));
  printDivider();
  console.log(`  총 대화 수     : ${chalk.yellow(report.total_conversations.toLocaleString())} 건`);
  console.log(`  총 예상 토큰   : ${chalk.yellow(report.total_tokens.toLocaleString())} 토큰`);
  console.log(`  리포트 생성    : ${chalk.gray(new Date(report.generated_at).toLocaleString('ko-KR'))}`);

  // 행동 지표
  console.log('');
  console.log(chalk.bold('  행동 지표'));
  printDivider();
  if (report.prev_month) {
    console.log(`  비교 기준: ${chalk.gray(report.prev_month)}`);
  }
  const bs = report.behavior_stats;
  const bd = report.behavior_delta;
  console.log(`  꼬리질문 비율   : ${chalk.cyan(`${bs.follow_up_rate}%`)}  ${formatDelta(bd?.follow_up_rate ?? null, '%p')}`);
  console.log(`  대화당 평균 교환 : ${chalk.cyan(`${bs.avg_messages_per_conv}회`)}  ${formatDelta(bd?.avg_messages_per_conv ?? null, '', 1)}`);
  console.log(`  평균 질문 길이   : ${chalk.cyan(`${bs.avg_user_chars_per_conv.toLocaleString()}자`)}  ${formatDelta(bd?.avg_user_chars_per_conv ?? null, '자')}`);
  console.log(`  탐색 주제 다양성 : ${chalk.cyan(`${bs.exploration_breadth}개`)}  ${formatDelta(bd?.exploration_breadth ?? null, '개')}`);

  // Top 5 주제
  console.log('');
  console.log(chalk.bold('  Top 5 주제'));
  printDivider();

  const topicTable = new Table({
    head: [
      chalk.bold.white('#'),
      chalk.bold.white('주제'),
      chalk.bold.white('대화 수'),
      chalk.bold.white('비율'),
      chalk.bold.white('막대 그래프'),
    ],
    colWidths: [4, 20, 10, 8, 25],
    style: { border: ['gray'], head: [] },
  });

  report.top_topics.forEach((topic, index) => {
    const barLength = Math.round(topic.percentage / 5); // 최대 20칸
    const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
    const rankColors = [chalk.yellow, chalk.white, chalk.gray, chalk.gray, chalk.gray];
    const rankColor = rankColors[index] ?? chalk.gray;

    topicTable.push([
      rankColor(String(index + 1)),
      rankColor(topic.topic),
      chalk.cyan(String(topic.count)),
      chalk.green(`${topic.percentage}%`),
      chalk.blue(bar),
    ]);
  });

  console.log(topicTable.toString());

  // 잘한 점
  console.log('');
  console.log(chalk.bold.green('  ✅ 잘한 점'));
  printDivider();
  report.well_done.forEach((item, i) => {
    console.log(`  ${chalk.green(`${i + 1}.`)} ${item}`);
  });

  // 개선할 점
  console.log('');
  console.log(chalk.bold.yellow('  💡 개선할 점'));
  printDivider();
  report.improvements.forEach((item, i) => {
    console.log(`  ${chalk.yellow(`${i + 1}.`)} ${item}`);
  });

  console.log('');
  printDivider('─');
  console.log('');
}

/**
 * 분류 결과 요약 CLI 출력
 */
export function printClassificationSummary(results: ClassificationResult[]): void {
  printHeader('🏷️  분류 결과 요약');

  if (results.length === 0) {
    console.log(chalk.red('  분류된 대화가 없습니다.'));
    return;
  }

  const topicCount = new Map<string, number>();
  for (const r of results) {
    const primaryTopic = r.topic_tags[0] ?? DEFAULT_TOPIC;
    topicCount.set(primaryTopic, (topicCount.get(primaryTopic) ?? 0) + 1);
  }

  const sortedTopics = Array.from(topicCount.entries()).sort((a, b) => b[1] - a[1]);

  const table = new Table({
    head: [chalk.bold.white('주제'), chalk.bold.white('대화 수'), chalk.bold.white('비율')],
    colWidths: [25, 10, 10],
    style: { border: ['gray'], head: [] },
  });

  for (const [topic, count] of sortedTopics) {
    const percentage = Math.round((count / results.length) * 100);
    table.push([topic, chalk.cyan(String(count)), chalk.green(`${percentage}%`)]);
  }

  console.log('');
  console.log(`  총 ${chalk.yellow(results.length)}개 대화 분류 완료`);
  console.log('');
  console.log(table.toString());
  console.log('');
}

/**
 * 검증 결과 CLI 출력
 */
export function printValidationResult(result: ValidationResult): void {
  printHeader('🔍 분류 정확도 검증 결과');

  console.log('');

  // 정확도 표시
  const accuracyColor =
    result.accuracy_percentage >= 80
      ? chalk.green
      : result.accuracy_percentage >= 60
        ? chalk.yellow
        : chalk.red;

  console.log(`  샘플 수      : ${chalk.cyan(String(result.sample_count))}개`);
  console.log(`  정확한 분류  : ${chalk.cyan(String(result.correct_count))}개`);
  console.log(`  정확도       : ${accuracyColor(chalk.bold(`${result.accuracy_percentage}%`))}`);

  // 정확도 등급
  const grade =
    result.accuracy_percentage >= 90
      ? '🏆 우수'
      : result.accuracy_percentage >= 80
        ? '✅ 양호'
        : result.accuracy_percentage >= 60
          ? '⚠️  보통'
          : '❌ 미흡 (프롬프트 개선 필요)';

  console.log(`  등급         : ${grade}`);

  // 세부 결과
  console.log('');
  console.log(chalk.bold('  세부 검증 결과'));
  printDivider();

  const detailTable = new Table({
    head: [
      chalk.bold.white('대화 ID'),
      chalk.bold.white('태그'),
      chalk.bold.white('결과'),
      chalk.bold.white('피드백'),
    ],
    colWidths: [15, 20, 8, 30],
    style: { border: ['gray'], head: [] },
    wordWrap: true,
  });

  for (const detail of result.details) {
    const shortId = detail.conversation_id.substring(0, 12) + '...';
    detailTable.push([
      chalk.gray(shortId),
      detail.original_tags.join(', '),
      detail.validated ? chalk.green('✓ 정확') : chalk.red('✗ 부정확'),
      chalk.gray(detail.judge_feedback.substring(0, 80)),
    ]);
  }

  console.log(detailTable.toString());
  console.log('');
}

/**
 * 에러 메시지 출력
 */
export function printError(message: string): void {
  console.error('');
  console.error(chalk.red('  ❌ 오류'));
  printDivider();
  console.error(chalk.red(`  ${message}`));
  console.error('');
}

/**
 * 성공 메시지 출력
 */
export function printSuccess(message: string): void {
  console.log('');
  console.log(chalk.green(`  ✅ ${message}`));
  console.log('');
}
