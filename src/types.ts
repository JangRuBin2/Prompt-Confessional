// SPEC.md 6번 데이터 흐름 — 공통 스키마

import { Platform, Role } from './constants';

// 파서 출력: Claude/ChatGPT export → 정규화된 대화 단위 (6번 2단계)
export interface ParsedMessage {
  conversation_id: string;
  platform: Platform;
  title?: string;
  created_at: string; // ISO 8601
  messages: Array<{
    date: string;        // ISO 8601
    role: Role;
    content: string;
    char_count: number;
  }>;
  total_chars: number;
}

// 분류 출력: 주제 태그 + 예상 토큰 수 (6번 3단계)
export interface ClassificationResult {
  conversation_id: string;
  topic_tags: string[];     // 최대 3개, 한국어
  estimated_tokens: number;
}

// 요약 출력: 주제별 대화 요약 (6번 4단계)
export interface SummaryResult {
  topic: string;
  conversation_count: number;
  summary: string;          // 2~3문장
  total_tokens: number;
}

// --- 내부 구현용 타입 ---

// 사용자의 AI 활용 행동 패턴 정량 지표
export interface BehaviorStats {
  avg_messages_per_conv: number;      // 대화당 평균 메시지 교환 수
  follow_up_rate: number;             // 꼬리질문 비율 % (사용자 메시지 2회 이상 대화)
  avg_user_chars_per_conv: number;    // 사용자 평균 글자 수/대화 (질문 구체성 지표)
  exploration_breadth: number;        // 탐색한 고유 주제 수
  topic_depth: Array<{               // 주제별 평균 메시지 수 (깊이 지표), 내림차순
    topic: string;
    avg_messages: number;
  }>;
}

export interface BehaviorDelta {
  avg_messages_per_conv: number | null;    // null = 전월 데이터 없음
  follow_up_rate: number | null;
  avg_user_chars_per_conv: number | null;
  exploration_breadth: number | null;
}

export interface MonthlyReport {
  month: string;
  top_topics: Array<{ topic: string; count: number; percentage: number }>;
  total_conversations: number;
  total_tokens: number;
  well_done: string[];
  improvements: string[];
  behavior_stats: BehaviorStats;
  generated_at: string;
  prev_month: string | null;         // e.g. "2026-08", null if no prev data
  behavior_delta: BehaviorDelta | null;
}

export interface ValidationResult {
  sample_count: number;
  correct_count: number;
  accuracy_percentage: number;
  details: Array<{
    conversation_id: string;
    original_tags: string[];
    validated: boolean;
    judge_feedback: string;
  }>;
}

// 저장소용 기본 대화 타입
export interface Conversation {
  id: string;
  platform: Platform;
  created_at: string;
  title?: string;
  messages: ParsedMessage['messages'];
  total_chars: number;
}

// 분류된 대화 타입 (Conversation + 분류 결과)
export interface ClassifiedConversation extends Conversation {
  topic_tags: string[];
  estimated_tokens: number;
}

// Claude export 원본 타입
export interface ClaudeExportMessage {
  uuid: string;
  text: string;
  sender: 'human' | 'assistant';
  created_at: string;
}

export interface ClaudeExportConversation {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeExportMessage[];
}

// ChatGPT export 원본 타입
export interface ChatGPTNode {
  id: string;
  message: {
    id: string;
    author: { role: 'user' | 'assistant' | 'system' | 'tool' };
    content: { content_type: string; parts: (string | null)[] };
    create_time: number | null;
  } | null;
  parent: string | null;
  children: string[];
}

export interface ChatGPTExportConversation {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, ChatGPTNode>;
}

// Ollama API 타입
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  options?: { temperature?: number; top_p?: number; num_predict?: number };
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: { temperature?: number; top_p?: number; num_predict?: number };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}
