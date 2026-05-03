import { describe, expect, it } from 'vitest';
import { selectRecentHistoryByBudget } from './contextBudget';

describe('selectRecentHistoryByBudget', () => {
  it('does not include an oversized latest message when token budget is too small', () => {
    const history = [
      { role: 'user' as const, content: 'short question' },
      { role: 'assistant' as const, content: 'x'.repeat(1000) },
    ];

    const selected = selectRecentHistoryByBudget(history, 10, 10);

    expect(selected).toEqual([]);
  });

  it('keeps recent messages within both message and token limits', () => {
    const history = [
      { role: 'user' as const, content: 'old' },
      { role: 'assistant' as const, content: 'old answer' },
      { role: 'user' as const, content: 'new' },
      { role: 'assistant' as const, content: 'new answer' },
    ];

    const selected = selectRecentHistoryByBudget(history, 2, 100);

    expect(selected).toEqual(history.slice(-2));
  });
});
