import {
  OllamaGenerateRequest,
  OllamaChatMessage,
  OllamaChatRequest,
} from '../types';
import type { ILLMClient, GenerateOptions } from './interface';
import {
  OLLAMA_BASE_URL,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_TIMEOUT_MS,
  OLLAMA_MAX_RETRIES,
  OLLAMA_RETRY_BASE_DELAY_MS,
  OLLAMA_BATCH_CONCURRENCY,
} from '../constants';
import {
  OllamaGenerateResponseSchema,
  OllamaChatResponseSchema,
  OllamaTagsResponseSchema,
} from '../schemas';

/**
 * 지정된 밀리초만큼 대기하는 유틸리티
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 여부를 결정: 네트워크 오류 또는 HTTP 5xx만 재시도
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // HTTP 4xx는 재시도하지 않음 (클라이언트 오류)
  const httpMatch = error.message.match(/HTTP (\d{3})/);
  if (httpMatch) {
    const statusCode = parseInt(httpMatch[1], 10);
    return statusCode >= 500; // 5xx만 재시도
  }

  // 네트워크 오류 (연결 거부, fetch 실패, 타임아웃 등)
  const errCode = (error as NodeJS.ErrnoException).code;
  return (
    errCode === 'ECONNREFUSED' ||
    errCode === 'ECONNRESET' ||
    errCode === 'ETIMEDOUT' ||
    error.message.includes('fetch failed') ||
    error.name === 'AbortError'
  );
}

/**
 * 간단한 세마포어 — 동시 실행 수를 제한
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /** 허가를 획득할 때까지 대기 */
  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /** 허가를 반환하고 대기 중인 작업 깨우기 */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

/**
 * Ollama REST API 래퍼
 */
export class OllamaClient implements ILLMClient {
  private baseUrl: string;
  private model: string;
  private batchSemaphore: Semaphore;

  constructor(baseUrl: string = OLLAMA_BASE_URL, model: string = OLLAMA_DEFAULT_MODEL) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.batchSemaphore = new Semaphore(OLLAMA_BATCH_CONCURRENCY);
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Ollama /api/generate 엔드포인트 호출 (지수 백오프 재시도 포함)
   * 네트워크 오류 또는 HTTP 5xx에 한해 최대 3회 재시도
   */
  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= OLLAMA_MAX_RETRIES; attempt++) {
      // 첫 번째 시도가 아닐 경우 지수 백오프 대기
      if (attempt > 0) {
        const delayMs = OLLAMA_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        await sleep(delayMs);
      }

      try {
        return await this._generateOnce(prompt, options);
      } catch (error) {
        lastError = error;

        // 재시도 불가 오류는 즉시 던짐
        if (!isRetryable(error)) {
          throw error;
        }

        // 마지막 시도였다면 루프 종료
        if (attempt === OLLAMA_MAX_RETRIES) {
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * 실제 /api/generate HTTP 요청 (재시도 로직 없음)
   */
  private async _generateOnce(
    prompt: string,
    options?: OllamaGenerateRequest['options']
  ): Promise<string> {
    const url = `${this.baseUrl}/api/generate`;

    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.3,
        ...options,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama API 오류 (HTTP ${response.status}): ${errorText || response.statusText}`
        );
      }

      const raw = await response.json();
      const data = OllamaGenerateResponseSchema.parse(raw);
      return data.response;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(
          `Ollama 요청 타임아웃 (${OLLAMA_TIMEOUT_MS / 1000}초). 서버가 응답하지 않습니다.`
        );
      }

      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new Error(
          `Ollama 서버에 연결할 수 없습니다 (${this.baseUrl}).\n` +
            '해결 방법:\n' +
            '  1. Ollama가 설치되어 있는지 확인: https://ollama.ai\n' +
            '  2. Ollama 서버 시작: ollama serve\n' +
            `  3. 모델 다운로드: ollama pull ${this.model}`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * JSON 응답을 강제로 파싱하는 헬퍼
   * LLM이 JSON 외의 텍스트를 포함할 수 있으므로 JSON 부분만 추출
   */
  async generateJSON<T>(prompt: string, options?: GenerateOptions): Promise<T> {
    const response = await this.generate(prompt, options);

    // JSON 블록 추출 시도 (```json ... ``` 또는 { ... } 형식)
    const jsonMatch =
      response.match(/```json\s*([\s\S]*?)\s*```/) ||
      response.match(/```\s*([\s\S]*?)\s*```/) ||
      response.match(/(\{[\s\S]*\})/);

    const jsonStr = jsonMatch ? jsonMatch[1] : response.trim();

    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      // 마지막 시도: 응답 전체를 파싱
      try {
        return JSON.parse(response.trim()) as T;
      } catch {
        throw new Error(
          `JSON 파싱 실패. LLM 응답:\n${response.substring(0, 500)}${response.length > 500 ? '...' : ''}`
        );
      }
    }
  }

  /**
   * 여러 프롬프트를 최대 OLLAMA_BATCH_CONCURRENCY개 동시에 실행
   * 순서를 보장하여 입력 순서와 동일한 순서로 결과 반환
   */
  async generateBatch(
    prompts: string[],
    options?: OllamaGenerateRequest['options']
  ): Promise<string[]> {
    const results: string[] = new Array(prompts.length);

    const tasks = prompts.map((prompt, index) =>
      (async () => {
        // 세마포어로 동시 실행 수 제한
        await this.batchSemaphore.acquire();
        try {
          results[index] = await this.generate(prompt, options);
        } finally {
          this.batchSemaphore.release();
        }
      })()
    );

    await Promise.all(tasks);
    return results;
  }

  /**
   * Ollama /api/chat 엔드포인트 호출 (멀티턴 대화용)
   * 지수 백오프 재시도 포함
   */
  async chat(
    messages: OllamaChatMessage[],
    options?: OllamaChatRequest['options']
  ): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= OLLAMA_MAX_RETRIES; attempt++) {
      // 첫 번째 시도가 아닐 경우 지수 백오프 대기
      if (attempt > 0) {
        const delayMs = OLLAMA_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }

      try {
        return await this._chatOnce(messages, options);
      } catch (error) {
        lastError = error;

        if (!isRetryable(error)) {
          throw error;
        }

        if (attempt === OLLAMA_MAX_RETRIES) {
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * 실제 /api/chat HTTP 요청 (재시도 로직 없음)
   */
  private async _chatOnce(
    messages: OllamaChatMessage[],
    options?: OllamaChatRequest['options']
  ): Promise<string> {
    const url = `${this.baseUrl}/api/chat`;

    const body: OllamaChatRequest = {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: 0.3,
        ...options,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama Chat API 오류 (HTTP ${response.status}): ${errorText || response.statusText}`
        );
      }

      const raw = await response.json();
      const data = OllamaChatResponseSchema.parse(raw);
      return data.message.content;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(
          `Ollama chat 요청 타임아웃 (${OLLAMA_TIMEOUT_MS / 1000}초). 서버가 응답하지 않습니다.`
        );
      }

      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new Error(
          `Ollama 서버에 연결할 수 없습니다 (${this.baseUrl}).\n` +
            '해결 방법:\n' +
            '  1. Ollama가 설치되어 있는지 확인: https://ollama.ai\n' +
            '  2. Ollama 서버 시작: ollama serve\n' +
            `  3. 모델 다운로드: ollama pull ${this.model}`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Ollama 서버 연결 상태 확인
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 서버에 설치된 모델 목록 조회
   * /api/tags 응답의 models[].name 배열 반환
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama 모델 목록 조회 실패 (HTTP ${response.status}): ${errorText || response.statusText}`
        );
      }

      const raw = await response.json();
      const data = OllamaTagsResponseSchema.parse(raw);
      return data.models.map((m) => m.name);
    } catch (error) {
      if ((error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError') {
        throw new Error('Ollama 모델 목록 조회 타임아웃. 서버가 응답하지 않습니다.');
      }

      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        throw new Error(
          `Ollama 서버에 연결할 수 없습니다 (${this.baseUrl}). ollama serve 를 실행해 주세요.`
        );
      }

      throw error;
    }
  }
}

// 기본 싱글톤 인스턴스
export const ollamaClient = new OllamaClient();

/**
 * localhost:11434 Ollama REST API를 호출하는 범용 함수
 */
export async function callOllama(prompt: string): Promise<string> {
  return ollamaClient.generate(prompt);
}
