import { ParsedMessage, ClassificationResult, ValidationResult } from '../types';
import type { ILLMClient } from '../llm/interface';
import {
  ROLE,
  LLM_VALIDATE_DEFAULT_SAMPLE_MIN,
  LLM_VALIDATE_DEFAULT_SAMPLE_MAX,
  LLM_VALIDATE_SAMPLE_RATIO,
} from '../constants';
import { JudgeResultSchema } from '../schemas';

async function judgeClassification(
  conv: ParsedMessage,
  result: ClassificationResult,
  client: ILLMClient
): Promise<{ is_correct: boolean; feedback: string }> {
  const MAX_CONTENT_CHARS = 1000;
  const sampleMessages = conv.messages
    .slice(0, 4)
    .map((m) => `${m.role === ROLE.USER ? '사용자' : 'AI'}: ${m.content.substring(0, 200)}`)
    .join('\n');

  const truncated =
    sampleMessages.length > MAX_CONTENT_CHARS
      ? sampleMessages.substring(0, MAX_CONTENT_CHARS) + '...'
      : sampleMessages;

  const prompt = `당신은 AI 대화 분류 결과를 검증하는 전문 평가자입니다.

다음 대화를 읽고 분류 태그가 적절한지 평가해주세요.

대화 제목: ${conv.title ?? '(제목 없음)'}
대화 내용:
${truncated}

분류된 태그: ${result.topic_tags.join(', ')}

위 태그가 대화 내용을 정확하게 분류했는지 평가하고 다음 JSON 형식으로만 응답하세요:
{"is_correct": true/false, "feedback": "평가 이유 한 문장"}

JSON 응답:`;

  const raw = await client.generateJSON<unknown>(prompt);
  const parsed = JudgeResultSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  // 폴백: 느슨하게 읽기
  const fallback = raw as Record<string, unknown>;
  return {
    is_correct: Boolean(fallback?.is_correct),
    feedback: String(fallback?.feedback ?? '평가 완료'),
  };
}

export async function validateClassifications(
  conversations: ParsedMessage[],
  classifications: ClassificationResult[],
  client: ILLMClient,
  sampleSize?: number
): Promise<ValidationResult> {
  const convMap = new Map<string, ParsedMessage>(
    conversations.map((c) => [c.conversation_id, c])
  );

  const paired = classifications
    .map((r) => ({ conv: convMap.get(r.conversation_id), result: r }))
    .filter((p): p is { conv: ParsedMessage; result: ClassificationResult } => p.conv !== undefined);

  const total = paired.length;
  if (total === 0) throw new Error('검증할 대화가 없습니다.');

  const targetSampleSize =
    sampleSize ??
    Math.min(
      LLM_VALIDATE_DEFAULT_SAMPLE_MAX,
      Math.max(LLM_VALIDATE_DEFAULT_SAMPLE_MIN, Math.ceil(total * LLM_VALIDATE_SAMPLE_RATIO))
    );
  const actualSampleSize = Math.min(targetSampleSize, total);

  // Fisher-Yates 셔플
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const sampled = indices.slice(0, actualSampleSize).map((i) => paired[i]);

  console.log(`[Validate] 총 ${total}개 대화 중 ${actualSampleSize}개 샘플 검증 시작`);

  const details: ValidationResult['details'] = [];
  let correctCount = 0;

  for (let i = 0; i < sampled.length; i++) {
    const { conv, result } = sampled[i];
    console.log(`[Validate] 검증 중 (${i + 1}/${actualSampleSize}): ${conv.title ?? conv.conversation_id}`);
    console.log(`  태그: ${result.topic_tags.join(', ')}`);

    try {
      const judged = await judgeClassification(conv, result, client);
      if (judged.is_correct) correctCount++;

      details.push({
        conversation_id: result.conversation_id,
        original_tags: result.topic_tags,
        validated: judged.is_correct,
        judge_feedback: judged.feedback,
      });

      console.log(`  → ${judged.is_correct ? '✓ 정확' : '✗ 부정확'}: ${judged.feedback}`);
    } catch (error) {
      console.error(`  → 검증 오류: ${(error as Error).message}`);
      details.push({
        conversation_id: result.conversation_id,
        original_tags: result.topic_tags,
        validated: false,
        judge_feedback: `검증 오류: ${(error as Error).message}`,
      });
    }
  }

  const accuracyPercentage =
    actualSampleSize > 0 ? Math.round((correctCount / actualSampleSize) * 100) : 0;

  console.log(`[Validate] 검증 완료: ${correctCount}/${actualSampleSize} 정확 (${accuracyPercentage}%)`);

  return { sample_count: actualSampleSize, correct_count: correctCount, accuracy_percentage: accuracyPercentage, details };
}
