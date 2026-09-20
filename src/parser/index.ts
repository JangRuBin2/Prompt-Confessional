import { ParsedMessage } from '../types';
import { Platform, PLATFORM } from '../constants';
import { parseClaudeExport } from './claude';
import { parseChatGPTExport } from './chatgpt';

export type { Platform };

export function parseExportFile(filePath: string, platform: Platform): ParsedMessage[] {
  switch (platform) {
    case PLATFORM.CLAUDE:
      return parseClaudeExport(filePath);
    case PLATFORM.CHATGPT:
      return parseChatGPTExport(filePath);
    default:
      throw new Error(`지원하지 않는 플랫폼: ${platform}. 'claude' 또는 'chatgpt'를 사용하세요.`);
  }
}

export { parseClaudeExport, parseChatGPTExport };
