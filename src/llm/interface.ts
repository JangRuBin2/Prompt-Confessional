// 2단계(클라우드 API) 교체를 위한 LLM 클라이언트 추상 인터페이스

export interface GenerateOptions {
  temperature?: number;
  top_p?: number;
  num_predict?: number;
}

export interface ILLMClient {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  generateJSON<T>(prompt: string, options?: GenerateOptions): Promise<T>;
  checkHealth(): Promise<boolean>;
  getModel(): string;
}
