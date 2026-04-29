import type { AnalysisResult } from '../types';
import type { CoachContextInput } from './types';

export function buildCoachContext(input: CoachContextInput): string {
  const behavior = renderBehavior(input);
  let body: string;
  switch (input.route.contextTemplate) {
    case 'problem_only':
      body = renderProblem(input, true);
      break;
    case 'runtime_debug':
      body = [renderProblem(input, false), renderCode(input, 6000), renderRuntime(input)].filter(Boolean).join('\n\n');
      break;
    case 'selection':
      body = [renderProblem(input, false), renderSelection(input)].filter(Boolean).join('\n\n');
      break;
    case 'full_code_review':
      body = [renderProblem(input, false), renderCode(input, 6000), renderRuntime(input)].filter(Boolean).join('\n\n');
      break;
    case 'problem_with_code_summary':
      body = [renderProblem(input, false), renderCode(input, 1800)].filter(Boolean).join('\n\n');
      break;
    default:
      body = input.problem ? renderProblem(input, false) : '当前没有激活题目。';
  }
  return [body, behavior].filter(Boolean).join('\n\n');
}

export function formatAnalysisAsCoachMessage(result: AnalysisResult): string {
  const lines: string[] = [];
  if (result.overallComment) lines.push(result.overallComment);
  if (result.issues.length === 0) {
    lines.push('我没有发现特别明显的代码问题。你可以继续补充具体卡点，或者先用样例和边界数据验证。');
  } else {
    lines.push(`我在代码里标了 ${result.issues.length} 处重点，先看最关键的：`);
    for (const issue of result.issues.slice(0, 3)) {
      lines.push(`- 第 ${issue.line} 行：${issue.message}${issue.suggestion ? `。建议：${issue.suggestion}` : ''}`);
    }
    lines.push('详细位置已经同步到编辑器行内批注。');
  }
  if (result.complexitySummary) lines.push(`复杂度：${result.complexitySummary}`);
  return lines.join('\n\n');
}

function renderProblem(input: CoachContextInput, full: boolean): string {
  const p = input.problem;
  if (!p) return '';
  const lines = [`# 题目：${p.title}`];
  if (p.statement) lines.push(full ? p.statement.slice(0, 3000) : p.statement.slice(0, 1200));
  if (p.inputFormat) lines.push(`## 输入格式\n${p.inputFormat.slice(0, 600)}`);
  if (p.outputFormat) lines.push(`## 输出格式\n${p.outputFormat.slice(0, 600)}`);
  if (p.constraints) lines.push(`## 约束\n${p.constraints.slice(0, 600)}`);
  if (p.examples?.length) {
    lines.push('## 样例');
    for (const ex of p.examples.slice(0, 2)) {
      lines.push(`输入：\n${ex.input}\n输出：\n${ex.output}${ex.explanation ? `\n说明：${ex.explanation}` : ''}`);
    }
  }
  return lines.join('\n\n');
}

function renderCode(input: CoachContextInput, max: number): string {
  if (!input.code?.trim()) return '';
  const code = input.code.length > max ? input.code.slice(0, max) + '\n...[截断]' : input.code;
  return `# 当前代码：${input.fileName ?? ''}\n\`\`\`${input.language ?? ''}\n${code}\n\`\`\``;
}

function renderSelection(input: CoachContextInput): string {
  const s = input.selection;
  if (!s?.text.trim()) return '';
  const pos = s.startLine ? `第 ${s.startLine}${s.endLine && s.endLine !== s.startLine ? `-${s.endLine}` : ''} 行` : '选中代码';
  return `# ${pos}\n\`\`\`${s.language ?? input.language ?? ''}\n${s.text}\n\`\`\``;
}

function renderRuntime(input: CoachContextInput): string {
  const r = input.lastRun;
  if (!r) return '';
  return `# 最近一次运行\nexitCode: ${r.exitCode}\ndurationMs: ${r.durationMs ?? ''}\n\nstdin:\n\`\`\`\n${r.stdin || '(空)'}\n\`\`\`\n\nstdout:\n\`\`\`\n${r.stdout || '(空)'}\n\`\`\`\n\nstderr:\n\`\`\`\n${r.stderr || '(空)'}\n\`\`\``;
}

function renderBehavior(input: CoachContextInput): string {
  const b = input.behavior;
  if (!b) return '';
  const idleLabel = b.idleSeconds < 30 ? '正在编辑' : b.idleSeconds < 90 ? `停手 ${b.idleSeconds}s` : `已停手 ${Math.round(b.idleSeconds / 60)} 分钟`;
  const lines = [
    `# 学生状态`,
    `- 当前 idle：${idleLabel}`,
    `- 这题 AC 次数：${b.acCount}`,
    `- 这题 WA/错误次数：${b.wrongCount}`,
    `- 是否在错题本：${b.inMistakeBook ? '是' : '否'}`,
    `- 上次分析未修复批注数：${b.unresolvedIssueCount}`,
  ];
  return lines.join('\n');
}
