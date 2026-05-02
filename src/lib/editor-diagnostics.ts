import type { FileLang } from '../core/types';

export interface LightweightDiagnostic {
  line: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: 'aicc-local';
}

const CPP_SIMPLE_TYPES = new Set([
  'int',
  'long',
  'short',
  'double',
  'float',
  'char',
  'bool',
  'string',
  'auto',
  'size_t',
]);

export function collectLightweightDiagnostics(code: string, language: FileLang): LightweightDiagnostic[] {
  if (language === 'python') return collectPythonDiagnostics(code);
  if (language === 'cpp' || language === 'c') return collectCppDiagnostics(code, language);
  return [];
}

function collectCppDiagnostics(code: string, language: FileLang): LightweightDiagnostic[] {
  const diagnostics: LightweightDiagnostic[] = [];
  diagnostics.push(...collectBracketDiagnostics(code, 'cpp'));

  const lines = code.split(/\r?\n/);
  const hasBits = /^\s*#\s*include\s*<bits\/stdc\+\+\.h>/m.test(code);
  const includes = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
    if (m) includes.add(m[1]);
  }
  const stripped = stripCppNoise(code);
  if (!hasBits) {
    if (/\b(?:cin|cout|cerr)\b/.test(stripped) && !includes.has('iostream')) {
      diagnostics.push(makeDiag(1, 'warning', '使用了 cin/cout/cerr，但没有包含 <iostream>。'));
    }
    if (/\bvector\s*</.test(stripped) && !includes.has('vector')) {
      diagnostics.push(makeDiag(1, 'warning', '使用了 vector，但没有包含 <vector>。'));
    }
    if (/\b(?:sort|lower_bound|upper_bound|binary_search|reverse)\s*\(/.test(stripped) && !includes.has('algorithm')) {
      diagnostics.push(makeDiag(1, 'warning', '使用了 algorithm 函数，但没有包含 <algorithm>。'));
    }
    if (/\bunordered_map\s*</.test(stripped) && !includes.has('unordered_map')) {
      diagnostics.push(makeDiag(1, 'warning', '使用了 unordered_map，但没有包含 <unordered_map>。'));
    }
    if (/\bunordered_set\s*</.test(stripped) && !includes.has('unordered_set')) {
      diagnostics.push(makeDiag(1, 'warning', '使用了 unordered_set，但没有包含 <unordered_set>。'));
    }
    if (/\bpriority_queue\s*</.test(stripped) && !includes.has('queue')) {
      diagnostics.push(makeDiag(1, 'warning', '使用了 priority_queue，但没有包含 <queue>。'));
    }
  }

  if (language === 'cpp' && /\b(?:cin|cout|cerr|vector|string|sort|lower_bound|upper_bound)\b/.test(stripped)) {
    const hasUsingNamespace = /\busing\s+namespace\s+std\s*;/.test(stripped);
    const hasStdQualifier = /\bstd::/.test(stripped);
    if (!hasUsingNamespace && !hasStdQualifier) {
      diagnostics.push(makeDiag(1, 'warning', '使用了标准库符号，但没有看到 using namespace std; 或 std:: 前缀。'));
    }
  }

  if (!/\bint\s+main\s*\(/.test(stripped) && !/\bmain\s*\(/.test(stripped)) {
    diagnostics.push(makeDiag(1, 'info', '竞赛代码通常需要 main 函数入口。'));
  }

  const cleanedLines = stripCppNoiseByLine(lines);
  for (let i = 0; i < cleanedLines.length; i++) {
    const original = lines[i];
    const line = cleanedLines[i].trim();
    if (!line || line.startsWith('#')) continue;
    if (isCppLineExempt(line, cleanedLines[i + 1]?.trim() ?? '')) continue;
    if (looksLikeCppStatement(line)) {
      diagnostics.push({
        line: i + 1,
        startColumn: Math.max(1, original.length),
        endColumn: Math.max(2, original.length + 1),
        severity: 'error',
        message: '这一行看起来像语句，但末尾缺少分号。',
        source: 'aicc-local',
      });
    }
  }

  return dedupeDiagnostics(diagnostics);
}

function collectPythonDiagnostics(code: string): LightweightDiagnostic[] {
  const diagnostics: LightweightDiagnostic[] = [];
  diagnostics.push(...collectBracketDiagnostics(code, 'python'));

  const lines = code.split(/\r?\n/);
  let previousSignificant: { line: number; indent: number; text: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = stripPythonLineComment(raw).trim();
    if (!text) continue;
    const indentText = raw.match(/^\s*/)?.[0] ?? '';
    const indent = indentText.replace(/\t/g, '    ').length;
    if (/\t/.test(indentText) && / /.test(indentText)) {
      diagnostics.push(makeDiag(i + 1, 'warning', '缩进同时混用了 Tab 和空格，Python 中容易出错。'));
    } else if (indent % 4 !== 0) {
      diagnostics.push(makeDiag(i + 1, 'warning', '缩进不是 4 的倍数，建议统一为 4 个空格。'));
    }
    if (previousSignificant?.text.endsWith(':') && indent <= previousSignificant.indent) {
      diagnostics.push(makeDiag(i + 1, 'error', `上一行以冒号结束，这一行需要比第 ${previousSignificant.line} 行多缩进。`));
    }
    if (looksLikePythonBlockHeader(text) && !text.endsWith(':')) {
      diagnostics.push(makeDiag(i + 1, 'error', '这一行看起来是 Python 代码块开头，末尾应加冒号。'));
    }
    previousSignificant = { line: i + 1, indent, text };
  }

  return dedupeDiagnostics(diagnostics);
}

function collectBracketDiagnostics(code: string, mode: 'cpp' | 'python'): LightweightDiagnostic[] {
  const diagnostics: LightweightDiagnostic[] = [];
  const stack: Array<{ char: string; line: number; column: number }> = [];
  let line = 1;
  let column = 1;
  let state: 'code' | 'string' | 'line-comment' | 'block-comment' = 'code';
  let quote = '';
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] ?? '';
    if (ch === '\n') {
      line++;
      column = 1;
      if (state === 'line-comment') state = 'code';
      if (state === 'string' && mode === 'python' && quote.length === 1) state = 'code';
      escaped = false;
      continue;
    }

    if (state === 'line-comment') {
      column++;
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        i++;
        column += 2;
        state = 'code';
      } else {
        column++;
      }
      continue;
    }
    if (state === 'string') {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (quote.length === 3 && code.slice(i, i + 3) === quote) {
        i += 2;
        column += 2;
        state = 'code';
      } else if (quote.length === 1 && ch === quote) {
        state = 'code';
      }
      column++;
      continue;
    }

    if (mode === 'cpp' && ch === '/' && next === '/') {
      state = 'line-comment';
      i++;
      column += 2;
      continue;
    }
    if (mode === 'cpp' && ch === '/' && next === '*') {
      state = 'block-comment';
      i++;
      column += 2;
      continue;
    }
    if (mode === 'python' && ch === '#') {
      state = 'line-comment';
      column++;
      continue;
    }
    if ((ch === '"' || ch === "'") && mode === 'python' && code.slice(i, i + 3) === ch.repeat(3)) {
      state = 'string';
      quote = ch.repeat(3);
      i += 2;
      column += 3;
      continue;
    }
    if (ch === '"' || ch === "'") {
      state = 'string';
      quote = ch;
      column++;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ char: ch, line, column });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (!top || matchingBracket(top.char) !== ch) {
        diagnostics.push({
          line,
          startColumn: column,
          endColumn: column + 1,
          severity: 'error',
          message: `括号 ${ch} 没有匹配的左括号。`,
          source: 'aicc-local',
        });
        if (top) stack.push(top);
      }
    }
    column++;
  }

  for (const item of stack.slice(-8)) {
    diagnostics.push({
      line: item.line,
      startColumn: item.column,
      endColumn: item.column + 1,
      severity: 'error',
      message: `括号 ${item.char} 没有闭合。`,
      source: 'aicc-local',
    });
  }
  return diagnostics;
}

function makeDiag(line: number, severity: LightweightDiagnostic['severity'], message: string): LightweightDiagnostic {
  return { line, severity, message, source: 'aicc-local' };
}

function matchingBracket(ch: string): string {
  if (ch === '(') return ')';
  if (ch === '[') return ']';
  return '}';
}

function stripCppNoise(code: string): string {
  return stripCppNoiseByLine(code.split(/\r?\n/)).join('\n');
}

function stripCppNoiseByLine(lines: string[]): string[] {
  let inBlock = false;
  return lines.map((line) => {
    let out = '';
    let state: 'code' | 'single' | 'double' = 'code';
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1] ?? '';
      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false;
          i++;
          out += '  ';
        } else {
          out += ' ';
        }
        continue;
      }
      if (state === 'single' || state === 'double') {
        out += ' ';
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) state = 'code';
        continue;
      }
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        inBlock = true;
        i++;
        out += '  ';
        continue;
      }
      if (ch === "'") {
        state = 'single';
        out += ' ';
        continue;
      }
      if (ch === '"') {
        state = 'double';
        out += ' ';
        continue;
      }
      out += ch;
    }
    return out;
  });
}

function stripPythonLineComment(line: string): string {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function isCppLineExempt(line: string, nextLine: string): boolean {
  if (!line) return true;
  if (/[;{}:,]$/.test(line)) return true;
  if (/\\$/.test(line)) return true;
  if (/^(if|for|while|switch|catch|else|do)\b/.test(line)) return true;
  if (/^(class|struct|enum|namespace|template|public|private|protected)\b/.test(line)) return true;
  if (/^#/.test(line)) return true;
  if (/\)\s*(const\s*)?(noexcept\s*)?(override\s*)?$/.test(line) && nextLine.startsWith('{')) return true;
  if (/^(using\s+namespace|typedef|using\s+\w+\s*=)/.test(line)) return false;
  return false;
}

function looksLikeCppStatement(line: string): boolean {
  if (/^(return|break|continue|throw)\b/.test(line)) return true;
  if (/\b(?:cin|cout|cerr)\b/.test(line)) return true;
  if (/^[\w:<>]+\s+[A-Za-z_]\w*(\s*=|\s*\(|\s*\[|$)/.test(line)) {
    const first = line.split(/\s+/)[0].replace(/<.*$/, '');
    if (CPP_SIMPLE_TYPES.has(first) || /^[A-Z_]\w*/.test(first) || first.includes('::')) return true;
  }
  if (/^[A-Za-z_]\w*(\[[^\]]+\])?\s*(=|\+=|-=|\*=|\/=|%=|\+\+|--)/.test(line)) return true;
  return false;
}

function looksLikePythonBlockHeader(text: string): boolean {
  return /^(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/.test(text);
}

function dedupeDiagnostics(items: LightweightDiagnostic[]): LightweightDiagnostic[] {
  const seen = new Set<string>();
  const out: LightweightDiagnostic[] = [];
  for (const item of items) {
    const key = `${item.line}:${item.startColumn ?? 1}:${item.severity}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 80);
}
