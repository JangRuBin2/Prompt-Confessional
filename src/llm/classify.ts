import { ParsedMessage, ClassificationResult } from '../types';
import type { ILLMClient } from './interface';
import {
  DEFAULT_TOPIC,
  LLM_CLASSIFY_MAX_CHARS,
  LLM_CLASSIFY_MAX_MESSAGES,
  LLM_CLASSIFY_MAX_TAGS,
} from '../constants';
import { ClassifyResultSchema } from '../schemas';

async function classifyOne(
  conv: ParsedMessage,
  client: ILLMClient
): Promise<{ topic_tags: string[]; estimated_tokens: number }> {
  const conversationText = conv.messages
    .slice(0, LLM_CLASSIFY_MAX_MESSAGES)
    .map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content.substring(0, 300)}`)
    .join('\n');

  const truncatedText =
    conversationText.length > LLM_CLASSIFY_MAX_CHARS
      ? conversationText.substring(0, LLM_CLASSIFY_MAX_CHARS) + '...'
      : conversationText;

  // 짧은 대화(사용자 메시지 3개 이하)는 핵심 주제만 1~2개로 제한
  const userMsgCount = conv.messages.filter((m) => m.role === 'user').length;
  const tagGuidance = userMsgCount <= 3
    ? '- topic_tags: 1~2개 (짧은 대화이므로 핵심 주제만)'
    : `- topic_tags: 최대 ${LLM_CLASSIFY_MAX_TAGS}개, 핵심 주제 위주`;

  const prompt = `다음 AI 대화의 주제를 분류해주세요.

대화 제목: ${conv.title ?? '(제목 없음)'}
대화 내용:
${truncatedText}

위 대화를 분석하여 다음 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
{"topic_tags": ["주제1", "주제2"], "estimated_tokens": 숫자}

규칙:
${tagGuidance}, 반드시 한국어로 (예: "Python 개발", "글쓰기", "데이터 분석")
- estimated_tokens: 전체 대화 예상 토큰 수 (한글 1자 ≈ 2토큰, 영문 1단어 ≈ 1토큰)
- 반드시 유효한 JSON만 출력

JSON 응답:`;

  const raw = await client.generateJSON<unknown>(prompt);

  const parsed = ClassifyResultSchema.safeParse(raw);
  if (!parsed.success) {
    // 폴백: 기본값으로 보정
    const fallback = raw as Record<string, unknown>;
    const tags = Array.isArray(fallback?.topic_tags) && (fallback.topic_tags as string[]).length > 0
      ? (fallback.topic_tags as string[]).slice(0, LLM_CLASSIFY_MAX_TAGS)
      : [DEFAULT_TOPIC];
    const tokens = typeof fallback?.estimated_tokens === 'number' && !isNaN(fallback.estimated_tokens as number)
      ? (fallback.estimated_tokens as number)
      : Math.ceil(conv.total_chars * 1.5);
    return { topic_tags: tags, estimated_tokens: tokens };
  }

  return {
    topic_tags: parsed.data.topic_tags.slice(0, LLM_CLASSIFY_MAX_TAGS),
    estimated_tokens: parsed.data.estimated_tokens,
  };
}

export async function classifyConversations(
  conversations: ParsedMessage[],
  client: ILLMClient
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  const total = conversations.length;

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    console.log(`[Classify] 분류 중 (${i + 1}/${total}): ${conv.title ?? conv.conversation_id}`);

    try {
      const result = await classifyOne(conv, client);
      results.push({
        conversation_id: conv.conversation_id,
        topic_tags: result.topic_tags,
        estimated_tokens: result.estimated_tokens,
      });
      console.log(`  → 태그: ${result.topic_tags.join(', ')} | 토큰: ~${result.estimated_tokens}`);
    } catch (error) {
      console.error(`  → 분류 실패: ${(error as Error).message}`);
      results.push({
        conversation_id: conv.conversation_id,
        topic_tags: [DEFAULT_TOPIC],
        estimated_tokens: Math.ceil(conv.total_chars * 1.5),
      });
    }
  }

  return results;
}
