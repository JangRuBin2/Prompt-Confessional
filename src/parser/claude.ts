import * as fs from 'fs';
import { ParsedMessage } from '../types';
import { PLATFORM, CLAUDE_SENDER, ROLE } from '../constants';
import { ClaudeExportSchema } from '../schemas';

export function parseClaudeExport(filePath: string): ParsedMessage[] {
  console.log(`[Parser] Claude export 파일 읽는 중: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  let rawData: unknown;

  try {
    rawData = JSON.parse(rawContent);
  } catch (e) {
    throw new Error(`JSON 파싱 실패: ${filePath} - ${(e as Error).message}`);
  }

  const parseResult = ClaudeExportSchema.safeParse(rawData);
  if (!parseResult.success) {
    throw new Error(
      `Claude export 파일 형식이 올바르지 않습니다: ${parseResult.error.message}`
    );
  }

  const conversations = parseResult.data;
  const results: ParsedMessage[] = [];

  for (const raw of conversations) {
    if (!raw.uuid || !raw.chat_messages) {
      console.warn(`[Parser] 유효하지 않은 대화 항목 건너뜀 (uuid: ${raw.uuid ?? 'unknown'})`);
      continue;
    }

    const messages: ParsedMessage['messages'] = [];

    for (const msg of raw.chat_messages) {
      if (!msg.text || !msg.sender) continue;

      const role = msg.sender === CLAUDE_SENDER.HUMAN ? ROLE.USER : ROLE.ASSISTANT;
      const content = msg.text.trim();
      if (!content) continue;

      messages.push({
        date: msg.created_at,
        role,
        content,
        char_count: content.length,
      });
    }

    if (messages.length === 0) continue;

    results.push({
      conversation_id: raw.uuid,
      platform: PLATFORM.CLAUDE,
      title: raw.name || undefined,
      created_at: raw.created_at,
      messages,
      total_chars: messages.reduce((sum, m) => sum + m.char_count, 0),
    });
  }

  console.log(`[Parser] Claude: ${results.length}개 대화 파싱 완료`);
  return results;
}
