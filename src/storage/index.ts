import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { ParsedMessage, ClassificationResult, MonthlyReport, ValidationResult } from '../types';
import { Platform } from '../constants';
import type { IStorage } from './interface';

export type { IStorage };

const DB_PATH = path.join(process.cwd(), 'data', 'myLLM.db');

export class Storage implements IStorage {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    console.log(`[Storage] DB 초기화 완료: ${dbPath}`);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL CHECK(platform IN ('claude', 'chatgpt')),
        created_at TEXT NOT NULL,
        title TEXT,
        messages_json TEXT NOT NULL,
        total_chars INTEGER NOT NULL,
        month TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_month ON conversations(month);

      CREATE TABLE IF NOT EXISTS classification_results (
        conversation_id TEXT PRIMARY KEY,
        topic_tags_json TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        classified_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL,
        report_json TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reports_month ON reports(month);

      CREATE TABLE IF NOT EXISTS validation_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        correct_count INTEGER NOT NULL,
        accuracy_percentage INTEGER NOT NULL,
        details_json TEXT NOT NULL,
        validated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_validation_month ON validation_results(month);
    `);
  }

  // --- ParsedMessage ---

  saveConversation(conv: ParsedMessage): void {
    const month = conv.created_at.substring(0, 7);
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations
        (conversation_id, platform, created_at, title, messages_json, total_chars, month)
      VALUES
        (@conversation_id, @platform, @created_at, @title, @messages_json, @total_chars, @month)
    `).run({
      conversation_id: conv.conversation_id,
      platform: conv.platform,
      created_at: conv.created_at,
      title: conv.title ?? null,
      messages_json: JSON.stringify(conv.messages),
      total_chars: conv.total_chars,
      month,
    });
  }

  saveConversations(conversations: ParsedMessage[]): number {
    const tx = this.db.transaction((convs: ParsedMessage[]) => {
      for (const c of convs) this.saveConversation(c);
      return convs.length;
    });
    const count = tx(conversations);
    console.log(`[Storage] ${count}개 대화 저장 완료`);
    return count;
  }

  getConversationsByMonth(month: string): ParsedMessage[] {
    type Row = { conversation_id: string; platform: Platform; created_at: string; title: string | null; messages_json: string; total_chars: number };
    const rows = this.db.prepare(
      `SELECT * FROM conversations WHERE month = ? ORDER BY created_at`
    ).all(month) as Row[];

    return rows.map((r) => ({
      conversation_id: r.conversation_id,
      platform: r.platform,
      created_at: r.created_at,
      title: r.title ?? undefined,
      messages: JSON.parse(r.messages_json),
      total_chars: r.total_chars,
    }));
  }

  // --- ClassificationResult ---

  saveClassificationResult(result: ClassificationResult): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO classification_results
        (conversation_id, topic_tags_json, estimated_tokens)
      VALUES
        (@conversation_id, @topic_tags_json, @estimated_tokens)
    `).run({
      conversation_id: result.conversation_id,
      topic_tags_json: JSON.stringify(result.topic_tags),
      estimated_tokens: result.estimated_tokens,
    });
  }

  saveClassificationResults(results: ClassificationResult[]): number {
    const tx = this.db.transaction((items: ClassificationResult[]) => {
      for (const r of items) this.saveClassificationResult(r);
      return items.length;
    });
    const count = tx(results);
    console.log(`[Storage] ${count}개 분류 결과 저장 완료`);
    return count;
  }

  // 이미 분류된 conversation_id 집합 반환 — 재시작 복구에 사용
  getClassifiedConversationIds(month: string): Set<string> {
    const rows = this.db.prepare(`
      SELECT cr.conversation_id
      FROM classification_results cr
      JOIN conversations c ON c.conversation_id = cr.conversation_id
      WHERE c.month = ?
    `).all(month) as Array<{ conversation_id: string }>;
    return new Set(rows.map((r) => r.conversation_id));
  }

  getClassificationResultsByMonth(month: string): ClassificationResult[] {
    type Row = { conversation_id: string; topic_tags_json: string; estimated_tokens: number };
    const rows = this.db.prepare(`
      SELECT cr.conversation_id, cr.topic_tags_json, cr.estimated_tokens
      FROM classification_results cr
      JOIN conversations c ON c.conversation_id = cr.conversation_id
      WHERE c.month = ?
      ORDER BY c.created_at
    `).all(month) as Row[];

    return rows.map((r) => ({
      conversation_id: r.conversation_id,
      topic_tags: JSON.parse(r.topic_tags_json),
      estimated_tokens: r.estimated_tokens,
    }));
  }

  // --- MonthlyReport ---

  saveReport(report: MonthlyReport): void {
    this.db.prepare(`
      INSERT INTO reports (month, report_json, generated_at)
      VALUES (@month, @report_json, @generated_at)
    `).run({
      month: report.month,
      report_json: JSON.stringify(report),
      generated_at: report.generated_at,
    });
    console.log(`[Storage] ${report.month} 리포트 저장 완료`);
  }

  getLatestReport(month: string): MonthlyReport | null {
    const row = this.db.prepare(`
      SELECT report_json FROM reports
      WHERE month = ?
      ORDER BY generated_at DESC
      LIMIT 1
    `).get(month) as { report_json: string } | undefined;

    return row ? (JSON.parse(row.report_json) as MonthlyReport) : null;
  }

  // --- ValidationResult ---

  saveValidationResult(month: string, result: ValidationResult): void {
    this.db.prepare(`
      INSERT INTO validation_results
        (month, sample_count, correct_count, accuracy_percentage, details_json)
      VALUES
        (@month, @sample_count, @correct_count, @accuracy_percentage, @details_json)
    `).run({
      month,
      sample_count: result.sample_count,
      correct_count: result.correct_count,
      accuracy_percentage: result.accuracy_percentage,
      details_json: JSON.stringify(result.details),
    });
    console.log(`[Storage] ${month} 검증 결과 저장 완료 (정확도: ${result.accuracy_percentage}%)`);
  }

  getLatestValidationResult(month: string): ValidationResult | null {
    const row = this.db.prepare(`
      SELECT sample_count, correct_count, accuracy_percentage, details_json
      FROM validation_results
      WHERE month = ?
      ORDER BY validated_at DESC
      LIMIT 1
    `).get(month) as { sample_count: number; correct_count: number; accuracy_percentage: number; details_json: string } | undefined;

    if (!row) return null;
    return {
      sample_count: row.sample_count,
      correct_count: row.correct_count,
      accuracy_percentage: row.accuracy_percentage,
      details: JSON.parse(row.details_json),
    };
  }

  getAvailableMonths(): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT month FROM conversations ORDER BY month`
    ).all() as Array<{ month: string }>;
    return rows.map((r) => r.month);
  }

  close(): void {
    this.db.close();
  }
}

// --- 싱글톤 팩토리 ---
// 서버 모드에서 다중 연결 방지 및 구현체 교체를 위한 단일 진입점

let _instance: IStorage | null = null;

export function getStorage(dbPath?: string): IStorage {
  if (!_instance) _instance = new Storage(dbPath);
  return _instance;
}

export function closeStorage(): void {
  _instance?.close();
  _instance = null;
}
