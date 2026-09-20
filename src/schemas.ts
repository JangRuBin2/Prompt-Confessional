import { z } from 'zod';
import { PLATFORM, ROLE, CLAUDE_SENDER, CHATGPT_ROLE } from './constants';

// =====================
// Ollama API 응답 스키마
// =====================

export const OllamaGenerateResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  response: z.string(),
  done: z.boolean(),
  total_duration: z.number().optional(),
  eval_count: z.number().optional(),
});

export const OllamaChatResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean(),
  total_duration: z.number().optional(),
  eval_count: z.number().optional(),
});

export const OllamaTagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      modified_at: z.string(),
      size: z.number(),
    })
  ),
});

// =====================
// Claude export 스키마
// =====================

export const ClaudeExportMessageSchema = z.object({
  uuid: z.string(),
  text: z.string(),
  sender: z.enum([CLAUDE_SENDER.HUMAN, CLAUDE_SENDER.ASSISTANT]),
  created_at: z.string(),
});

export const ClaudeExportConversationSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  chat_messages: z.array(ClaudeExportMessageSchema),
});

export const ClaudeExportSchema = z.array(ClaudeExportConversationSchema);

// =====================
// ChatGPT export 스키마
// =====================

export const ChatGPTNodeSchema = z.object({
  id: z.string(),
  message: z
    .object({
      id: z.string(),
      author: z.object({
        role: z.enum([
          CHATGPT_ROLE.USER,
          CHATGPT_ROLE.ASSISTANT,
          CHATGPT_ROLE.SYSTEM,
          CHATGPT_ROLE.TOOL,
        ]),
      }),
      content: z.object({
        content_type: z.string(),
        parts: z.array(z.union([z.string(), z.null()])),
      }),
      create_time: z.number().nullable(),
    })
    .nullable(),
  parent: z.string().nullable(),
  children: z.array(z.string()),
});

export const ChatGPTExportConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  create_time: z.number(),
  update_time: z.number(),
  mapping: z.record(z.string(), ChatGPTNodeSchema),
});

export const ChatGPTExportSchema = z.array(ChatGPTExportConversationSchema);

// =====================
// LLM JSON 출력 검증 스키마
// =====================

export const ClassifyResultSchema = z.object({
  topic_tags: z.array(z.string()).min(1),
  estimated_tokens: z.number().int().positive(),
});

export const JudgeResultSchema = z.object({
  is_correct: z.boolean(),
  feedback: z.string(),
});

export const ReportLLMResultSchema = z.object({
  top_topics: z.array(
    z.object({
      topic: z.string(),
      count: z.number(),
      percentage: z.number(),
    })
  ),
  well_done: z.array(z.string()),
  improvements: z.array(z.string()),
});

// =====================
// Claude 내보내기 매니페스트 스키마
// =====================

export const ExportManifestFileSchema = z.object({
  batch_index: z.number(),
  export_url: z.string().url(),
  category: z.string(),
  part: z.number(),
  filename: z.string(),
});

export const ExportManifestSchema = z.object({
  instructions: z.string().optional(),
  created_at: z.string(),
  total_files: z.number(),
  data_files: z.array(ExportManifestFileSchema),
  version: z.string().optional(),
});

export type ExportManifestType = z.infer<typeof ExportManifestSchema>;

// =====================
// 파생 타입
// =====================

export type ClaudeExportConversationType = z.infer<typeof ClaudeExportConversationSchema>;
export type ChatGPTExportConversationType = z.infer<typeof ChatGPTExportConversationSchema>;
export type OllamaGenerateResponseType = z.infer<typeof OllamaGenerateResponseSchema>;
export type OllamaChatResponseType = z.infer<typeof OllamaChatResponseSchema>;
export type OllamaTagsResponseType = z.infer<typeof OllamaTagsResponseSchema>;
export type ClassifyResultType = z.infer<typeof ClassifyResultSchema>;
export type JudgeResultType = z.infer<typeof JudgeResultSchema>;
export type ReportLLMResultType = z.infer<typeof ReportLLMResultSchema>;

// 사용하지 않는 import 경고 방지용 재-export (ROLE 상수는 schemas.ts 내부에서 직접 사용하지 않지만
// constants.ts 로부터 올바르게 가져왔음을 명시)
export { PLATFORM, ROLE };
