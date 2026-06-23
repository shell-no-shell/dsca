import { describe, it, expect } from 'vitest';
import { LLMClient } from '../llm/client.js';

describe('LLMClient', () => {
  describe('estimateTokens', () => {
    it('should estimate English text tokens', () => {
      const tokens = LLMClient.estimateTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it('should estimate CJK text with higher count', () => {
      const englishTokens = LLMClient.estimateTokens('Hello');
      const chineseTokens = LLMClient.estimateTokens('你好世界');
      expect(chineseTokens).toBeGreaterThan(englishTokens);
    });

    it('should handle empty string', () => {
      expect(LLMClient.estimateTokens('')).toBe(0);
    });

    it('should handle mixed content', () => {
      const tokens = LLMClient.estimateTokens('Hello 你好 World 世界');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('should estimate total tokens for messages', () => {
      const tokens = LLMClient.estimateMessagesTokens([
        { role: 'system', content: 'You are an assistant' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ]);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should include message overhead', () => {
      const singleMsg = LLMClient.estimateMessagesTokens([
        { role: 'user', content: 'test' }
      ]);
      const twoMsgs = LLMClient.estimateMessagesTokens([
        { role: 'user', content: 'test' },
        { role: 'user', content: 'test' }
      ]);
      // Two identical messages should be roughly double
      expect(twoMsgs).toBeGreaterThan(singleMsg);
    });
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      const client = new LLMClient({
        apiKey: 'test-key'
      });
      expect(client).toBeDefined();
      expect(client.getLastUsage()).toBeNull();
    });

    it('should create client with custom config', () => {
      const client = new LLMClient({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com/v1',
        defaultModel: 'custom-model',
        temperature: 0.5,
        maxTokens: 4096,
        retryCount: 5,
        retryDelay: 2000,
        timeout: 60
      });
      expect(client).toBeDefined();
    });
  });
});
