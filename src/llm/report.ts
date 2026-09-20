import { ParsedMessage, ClassificationResult, SummaryResult, MonthlyReport, BehaviorStats } from '../types';
import type { ILLMClient } from './interface';
import { DEFAULT_TOPIC, ROLE } from '../constants';
import { ReportLLMResultSchema, ReportLLMResultType } from '../schemas';

// 사용자의 AI 활용 행동 패턴을 정량 지표로 계산
function computeBehaviorStats(
  convs: ParsedMessage[],
  classifications: ClassificationResult[]
): BehaviorStats {
  const classMap = new Map(classifications.map((c) => [c.conversation_id, c]));

  const convStats = convs
    .filter((c) => classMap.has(c.conversation_id))
    .map((c) => {
      const cls = classMap.get(c.conversation_id)!;
      const userMsgs = c.messages.filter((m) => m.role === ROLE.USER);
      return {
        msgCount: c.messages.length,
        userMsgCount: userMsgs.length,
        userChars: userMsgs.reduce((sum, m) => sum + m.char_count, 0),
        topic: cls.topic_tags[0] ?? DEFAULT_TOPIC,
      };
    });

  const total = convStats.length;
  if (total === 0) {
    return {
      avg_messages_per_conv: 0,
      follow_up_rate: 0,
      avg_user_chars_per_conv: 0,
      exploration_breadth: 0,
      topic_depth: [],
    };
  }

  const avgMessages = convStats.reduce((s, c) => s + c.msgCount, 0) / total;
  const followUpCount = convStats.filter((c) => c.userMsgCount >= 2).length;
  const followUpRate = Math.round((followUpCount / total) * 100);
  const avgUserChars = Math.round(convStats.reduce((s, c) => s + c.userChars, 0) / total);

  // 주제별 평균 메시지 수 계산 (탐구 깊이 지표)
  const topicGroups = new Map<string, number[]>();
  for (const c of convStats) {
    if (!topicGroups.has(c.topic)) topicGroups.set(c.topic, []);
    topicGroups.get(c.topic)!.push(c.msgCount);
  }

  const topicDepth = Array.from(topicGroups.entries())
    .map(([topic, msgs]) => ({
      topic,
      avg_messages: Math.round(msgs.reduce((s, n) => s + n, 0) / msgs.length),
    }))
    .sort((a, b) => b.avg_messages - a.avg_messages)
    .slice(0, 5);

  return {
    avg_messages_per_conv: Math.round(avgMessages * 10) / 10,
    follow_up_rate: followUpRate,
    avg_user_chars_per_conv: avgUserChars,
    exploration_breadth: topicGroups.size,
    topic_depth: topicDepth,
  };
}

export async function generateMonthlyReport(
  month: string,
  convs: ParsedMessage[],            // 행동 지표 계산용 원본 대화 목록
  classifications: ClassificationResult[],
  summaries: SummaryResult[],
  client: ILLMClient
): Promise<MonthlyReport> {
  console.log(`[Report] ${month} 월간 리포트 생성 중...`);

  const totalConversations = classifications.length;
  const totalTokens = classifications.reduce((sum, c) => sum + c.estimated_tokens, 0);

  const sortedSummaries = [...summaries]
    .sort((a, b) => b.conversation_count - a.conversation_count)
    .slice(0, 5);

  // 행동 지표는 try 블록 밖에서 계산해 fallback에서도 사용
  const stats = computeBehaviorStats(convs, classifications);

  const topicDepthText = stats.topic_depth
    .map((t) => `  - ${t.topic}: 평균 ${t.avg_messages}회 교환`)
    .join('\n');

  const topicSummaryText = sortedSummaries
    .map((t) => `  - ${t.topic} (${t.conversation_count}건): ${t.summary}`)
    .join('\n');

  const prompt = `당신은 사용자의 AI 활용 행동 패턴을 분석하는 애널리스트입니다.
아래는 ${month}에 사용자가 AI와 나눈 대화의 정량 지표와 주제 요약입니다.

[행동 지표]
- 총 대화 수: ${totalConversations}건
- 대화당 평균 메시지 교환: ${stats.avg_messages_per_conv}회 (높을수록 깊이 탐구)
- 꼬리질문 비율: ${stats.follow_up_rate}% (한 주제를 여러 번 주고받은 대화 비율)
- 사용자 평균 질문 길이: ${stats.avg_user_chars_per_conv}자 (길수록 구체적 질문 경향)
- 탐색 주제 다양성: ${stats.exploration_breadth}개 주제

[주제별 탐구 깊이 — 평균 메시지 교환 수 기준]
${topicDepthText}

[주제별 내용 요약]
${topicSummaryText}

위 데이터를 분석해 다음 JSON 형식으로만 응답하세요:

{
  "top_topics": [{"topic": "주제명", "count": 숫자, "percentage": 숫자}],
  "well_done": ["분석 문장 1", "분석 문장 2", "분석 문장 3"],
  "improvements": ["개선 제안 1", "개선 제안 2", "개선 제안 3"]
}

중요 규칙:
- well_done과 improvements는 반드시 "사용자의 질문/탐구 행동 패턴"을 분석한 문장이어야 합니다.
- AI가 무엇을 설명했는지 절대 서술하지 마세요. ("~가 설명되어있다", "~가 제공되었다" 금지)
- 좋은 예시: "Python과 Zustand 주제에서 꼬리질문 비율이 높아, 단순 질문에서 끝내지 않고 실제 적용까지 탐구하는 패턴이 두드러진다"
- 나쁜 예시: "Python 비동기 프로그래밍에 대한 내용이 구체적으로 설명되어있다" (← AI 응답 묘사, 절대 금지)
- improvements는 맹목적 칭찬 없이, 행동 데이터를 근거로 구체적 개선 방향을 제시하세요.
- top_topics: Top 5, count는 대화 수, percentage는 정수 퍼센트
- 모든 내용 한국어
`;

  try {
    const raw = await client.generateJSON<unknown>(prompt, {
      temperature: 0.5,
      num_predict: 1000,
    });

    const parseResult = ReportLLMResultSchema.safeParse(raw);
    const llmResult: ReportLLMResultType = parseResult.success
      ? parseResult.data
      : { top_topics: [], well_done: [], improvements: [] };

    const topTopics = validateTopTopics(llmResult.top_topics, sortedSummaries, totalConversations);
    const wellDone =
      Array.isArray(llmResult.well_done) && llmResult.well_done.length > 0
        ? llmResult.well_done.slice(0, 3)
        : defaultWellDone(sortedSummaries);
    const improvements =
      Array.isArray(llmResult.improvements) && llmResult.improvements.length > 0
        ? llmResult.improvements.slice(0, 3)
        : defaultImprovements();

    console.log('[Report] 월간 리포트 생성 완료');
    return {
      month,
      top_topics: topTopics,
      total_conversations: totalConversations,
      total_tokens: totalTokens,
      well_done: wellDone,
      improvements,
      behavior_stats: stats,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Report] LLM 실패, 기본 리포트 사용: ${(error as Error).message}`);
    return {
      month,
      top_topics: sortedSummaries.slice(0, 5).map((t) => ({
        topic: t.topic,
        count: t.conversation_count,
        percentage: Math.round((t.conversation_count / totalConversations) * 100),
      })),
      total_conversations: totalConversations,
      total_tokens: totalTokens,
      well_done: defaultWellDone(sortedSummaries),
      improvements: defaultImprovements(),
      behavior_stats: stats,
      generated_at: new Date().toISOString(),
    };
  }
}

function validateTopTopics(
  llmTopics: ReportLLMResultType['top_topics'],
  sortedSummaries: SummaryResult[],
  total: number
): MonthlyReport['top_topics'] {
  if (!Array.isArray(llmTopics) || llmTopics.length === 0) {
    return sortedSummaries.slice(0, 5).map((t) => ({
      topic: t.topic,
      count: t.conversation_count,
      percentage: Math.round((t.conversation_count / total) * 100),
    }));
  }
  return llmTopics.slice(0, 5).map((t) => ({
    topic: String(t.topic ?? DEFAULT_TOPIC),
    count: typeof t.count === 'number' ? t.count : 0,
    percentage: typeof t.percentage === 'number' ? Math.round(t.percentage) : 0,
  }));
}

function defaultWellDone(summaries: SummaryResult[]): string[] {
  const topTopic = summaries[0]?.topic ?? 'AI';
  return [
    `${topTopic} 관련 주제를 집중적으로 탐구하며 꼬리질문을 통해 단계적으로 깊이를 쌓는 패턴이 보입니다.`,
    '여러 주제에 걸쳐 구체적인 질문을 이어가며 개념에서 실습까지 폭넓게 탐색하는 모습이 인상적입니다.',
    '단발성 질문에 그치지 않고 같은 주제를 반복해서 다루는 탐구형 사용 패턴이 확인됩니다.',
  ];
}

function defaultImprovements(): string[] {
  return [
    '질문 길이 지표를 확인해 짧은 단문 질문 비중을 줄이고 컨텍스트를 더 담은 질문 습관을 길러보세요.',
    '꼬리질문 비율이 낮은 주제는 첫 답변 이후 추가 탐구 없이 종료된 경우가 많습니다. 한 주제당 최소 2~3회 교환을 목표로 해보세요.',
    '탐색한 주제 다양성 대비 깊이 지표가 낮은 주제를 골라, 다음 달에는 해당 주제에 꼬리질문을 집중해보세요.',
  ];
}
