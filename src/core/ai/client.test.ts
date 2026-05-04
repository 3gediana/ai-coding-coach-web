import { describe, expect, it, vi } from 'vitest';
import { AIClient } from './client';
import { setForcedOffline } from '../../lib/offlineMode';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('AIClient streaming lifecycle', () => {
  it('finishes OpenAI-compatible streams when [DONE] is received', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    setForcedOffline(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamFromChunks([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: [DONE]\n\n',
    ]), { status: 200 })));

    const client = new AIClient({
      provider: 'deepseek',
      baseUrl: 'https://example.test/v1/chat/completions',
      apiKey: 'test-key',
      model: 'test-model',
      maxTokens: 1000,
      timeoutMs: 1000,
    });

    let text = '';
    for await (const chunk of client.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
      text += chunk;
    }

    expect(text).toBe('hello');
    vi.unstubAllGlobals();
  });

  it('finishes Ollama-native streams when done is received', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamFromChunks([
      '{"message":{"content":"hello"},"done":false}\n',
      '{"done":true}\n',
    ]), { status: 200 })));

    const client = new AIClient({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
      apiKey: 'test-key',
      model: 'test-model',
      maxTokens: 1000,
      timeoutMs: 1000,
    });

    let text = '';
    for await (const chunk of client.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
      text += chunk;
    }

    expect(text).toBe('hello');
    vi.unstubAllGlobals();
  });

  it('aborts while waiting for the next stream chunk', async () => {
    const ctrl = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({}), { status: 200 })));

    const client = new AIClient({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
      apiKey: 'test-key',
      model: 'test-model',
      maxTokens: 1000,
      timeoutMs: 10_000,
    });

    const consume = (async () => {
      for await (const _ of client.chatStream({
        messages: [{ role: 'user', content: 'hi' }],
        signal: ctrl.signal,
      })) {
      }
    })();

    ctrl.abort();
    await expect(consume).rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });
});
