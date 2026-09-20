// 플랫폼 식별자
export const PLATFORM = {
  CLAUDE: 'claude',
  CHATGPT: 'chatgpt',
} as const;
export type Platform = typeof PLATFORM[keyof typeof PLATFORM];

// 정규화된 메시지 역할
export const ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const;
export type Role = typeof ROLE[keyof typeof ROLE];

// Claude export 원본 sender 값
export const CLAUDE_SENDER = {
  HUMAN: 'human',
  ASSISTANT: 'assistant',
} as const;

// ChatGPT export 원본 role 값 (tool/system 포함)
export const CHATGPT_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool',
} as const;

// 기본 주제 태그 (분류 실패 시 폴백)
export const DEFAULT_TOPIC = '기타';

// Ollama 기본값
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
export const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
export const OLLAMA_TIMEOUT_MS = 120_000;
export const OLLAMA_MAX_RETRIES = 3;
export const OLLAMA_RETRY_BASE_DELAY_MS = 1_000;
export const OLLAMA_BATCH_CONCURRENCY = 2;

// LLM 프롬프트 길이·개수 제한
export const LLM_CLASSIFY_MAX_CHARS = 2000;
export const LLM_CLASSIFY_MAX_MESSAGES = 6;
export const LLM_CLASSIFY_MAX_TAGS = 3;
export const LLM_SUMMARIZE_MAX_CHARS_PER_CONV = 500;
export const LLM_SUMMARIZE_MAX_CONVS = 8;
export const LLM_VALIDATE_DEFAULT_SAMPLE_MIN = 10;
export const LLM_VALIDATE_DEFAULT_SAMPLE_MAX = 20;
export const LLM_VALIDATE_SAMPLE_RATIO = 0.2;
