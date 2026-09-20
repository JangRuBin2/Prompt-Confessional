// DB 백엔드 교체(SQLite → Postgres 등)를 위한 스토리지 추상 인터페이스

import { ParsedMessage, ClassificationResult, MonthlyReport, ValidationResult } from '../types';

export interface IStorage {
  saveConversation(conv: ParsedMessage): void;
  saveConversations(conversations: ParsedMessage[]): number;
  getConversationsByMonth(month: string): ParsedMessage[];
  saveClassificationResult(result: ClassificationResult): void;
  saveClassificationResults(results: ClassificationResult[]): number;
  getClassifiedConversationIds(month: string): Set<string>;
  getClassificationResultsByMonth(month: string): ClassificationResult[];
  saveReport(report: MonthlyReport): void;
  getLatestReport(month: string): MonthlyReport | null;
  saveValidationResult(month: string, result: ValidationResult): void;
  getLatestValidationResult(month: string): ValidationResult | null;
  getAvailableMonths(): string[];
  close(): void;
}
