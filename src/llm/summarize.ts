import { ParsedMessage, ClassificationResult, SummaryResult } from '../types';
import type { ILLMClient } from './interface';
import {
  DEFAULT_TOPIC,
  LLM_SUMMARIZE_MAX_CHARS_PER_CONV,
  LLM_SUMMARIZE_MAX_CONVS,
  ROLE,
} from '../constants';

function groupByTopic(
  conversations: ParsedMessage[],
  classifications: ClassificationResult[]
): Map<string, Array<{ conv: ParsedMessage; result: ClassificationResult }>> {
  const convMap = new Map<string, ParsedMessage>(
    conversations.map((c) => [c.conversation_id, c])
  );
  const groups = new Map<string, Array<{ conv: ParsedMessage; result: ClassificationResult }>>();

  for (const result of classifications) {
    const conv = convMap.get(result.conversation_id);
    if (!conv) continue;

    const primaryTopic = result.topic_tags[0] ?? DEFAULT_TOPIC;
    if (!groups.has(primaryTopic)) groups.set(primaryTopic, []);
    groups.get(primaryTopic)!.push({ conv, result });
  }

  return groups;
}

async function summarizeTopic(
  topic: string,
  items: Array<{ conv: ParsedMessage; result: ClassificationResult }>,
  client: ILLMClient
): Promise<string> {
  const convSummaries = items
    .slice(0, LLM_SUMMARIZE_MAX_CONVS)
    .map(({ conv }) => {
      const userMessages = conv.messages
        .filter((m) => m.role === ROLE.USER)
        .slice(0, 2)
        .map((m) => m.content.substring(0, 200))
        .join(' ');
      return `- ${conv.title ?? '(제목 없음)'}: ${userMessages}`;
    })
    .join('\n');

  const truncated =
    convSummaries.length > LLM_SUMMARIZE_MAX_CHARS_PER_CONV * 4
      ? convSummaries.substring(0, LLM_SUMMARIZE_MAX_CHARS_PER_CONV * 4) + '...'
      : convSummaries;

  const prompt = `다음은 "${topic}" 주제로 분류된 ${items.length}개의 AI 대화 목록입니다:

${truncated}

위 대화들을 바탕으로, "${topic}" 주제에서 어떤 내용을 주로 다뤘는지 2~3문장으로 간결하게 한국어로 요약해주세요.
요약문만 출력하고 다른 설명은 하지 마세요.

요약:`;

  return (await client.generate(prompt, { temperature: 0.4 })).trim();
}

export async function summarizeByTopics(
  conversations: ParsedMessage[],
  classifications: ClassificationResult[],
  client: ILLMClient
): Promise<SummaryResult[]> {
  const groups = groupByTopic(conversations, classifications);
  const results: SummaryResult[] = [];

  const topics = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  console.log(`[Summarize] ${topics.length}개 주제 요약 시작`);

  for (const [topic, items] of topics) {
    console.log(`[Summarize] "${topic}" 요약 중 (${items.length}개 대화)...`);

    try {
      const summary = await summarizeTopic(topic, items, client);
      const totalTokens = items.reduce((sum, { result }) => sum + result.estimated_tokens, 0);

      results.push({ topic, conversation_count: items.length, summary, total_tokens: totalTokens });
      console.log(`  → 완료: "${summary.substring(0, 60)}..."`);
    } catch (error) {
      console.error(`  → 요약 실패 (${topic}): ${(error as Error).message}`);
      const totalTokens = items.reduce((sum, { result }) => sum + result.estimated_tokens, 0);
      results.push({
        topic,
        conversation_count: items.length,
        summary: `${topic} 관련 ${items.length}개의 대화를 나눴습니다.`,
        total_tokens: totalTokens,
      });
    }
  }

  return results;
}
