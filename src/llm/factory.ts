import { ILLMClient } from './interface';
import { OllamaClient } from './ollama';

export type LLMProvider = 'ollama'; // 2단계에서 'claude' | 'openai' 추가 예정

export function createLLMClient(): ILLMClient {
  const provider = (process.env.LLM_PROVIDER ?? 'ollama') as LLMProvider;

  switch (provider) {
    case 'ollama':
      return new OllamaClient();
    default:
      throw new Error(
        `지원하지 않는 LLM_PROVIDER: "${provider}". 현재 지원 값: ollama`
      );
  }
}
