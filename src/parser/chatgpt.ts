import * as fs from 'fs';
import { ParsedMessage } from '../types';
import { PLATFORM, CHATGPT_ROLE } from '../constants';
import { ChatGPTExportSchema, ChatGPTNodeSchema } from '../schemas';
import { z } from 'zod';

type ChatGPTNode = z.infer<typeof ChatGPTNodeSchema>;

export function parseChatGPTExport(filePath: string): ParsedMessage[] {
  console.log(`[Parser] ChatGPT export 파일 읽는 중: ${filePath}`);

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

  const parseResult = ChatGPTExportSchema.safeParse(rawData);
  if (!parseResult.success) {
    throw new Error(
      `ChatGPT export 파일 형식이 올바르지 않습니다: ${parseResult.error.message}`
    );
  }

  const conversations = parseResult.data;
  const results: ParsedMessage[] = [];

  for (const raw of conversations) {
    if (!raw.id || !raw.mapping) {
      console.warn(`[Parser] 유효하지 않은 대화 항목 건너뜀 (id: ${raw.id ?? 'unknown'})`);
      continue;
    }

    const orderedNodes = extractOrderedNodes(raw.mapping);
    const messages: ParsedMessage['messages'] = [];

    for (const node of orderedNodes) {
      if (!node.message) continue;

      const msg = node.message;
      const role = msg.author?.role;
      if (role !== CHATGPT_ROLE.USER && role !== CHATGPT_ROLE.ASSISTANT) continue;

      const parts = msg.content?.parts ?? [];
      const content = parts
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .join('\n')
        .trim();

      if (!content) continue;

      const timestamp = msg.create_time
        ? new Date(msg.create_time * 1000).toISOString()
        : new Date(raw.create_time * 1000).toISOString();

      messages.push({
        date: timestamp,
        role,
        content,
        char_count: content.length,
      });
    }

    if (messages.length === 0) continue;

    results.push({
      conversation_id: raw.id,
      platform: PLATFORM.CHATGPT,
      title: raw.title || undefined,
      created_at: new Date(raw.create_time * 1000).toISOString(),
      messages,
      total_chars: messages.reduce((sum, m) => sum + m.char_count, 0),
    });
  }

  console.log(`[Parser] ChatGPT: ${results.length}개 대화 파싱 완료`);
  return results;
}

function extractOrderedNodes(mapping: Record<string, ChatGPTNode>): ChatGPTNode[] {
  let rootId: string | null = null;

  for (const [id, node] of Object.entries(mapping)) {
    if (node.parent === null || !mapping[node.parent]) {
      rootId = id;
      break;
    }
  }

  if (!rootId) {
    return Object.values(mapping).sort((a, b) => {
      const timeA = a.message?.create_time ?? 0;
      const timeB = b.message?.create_time ?? 0;
      return timeA - timeB;
    });
  }

  const result: ChatGPTNode[] = [];
  const queue: string[] = [rootId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const node = mapping[currentId];
    if (!node) continue;

    result.push(node);
    for (const childId of node.children) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }

  return result;
}
