import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { UnifiedSession, SessionSource, SessionContext } from '../types/index.js';
import { extractContext, saveContext } from './index.js';
import { SOURCE_LABELS } from './markdown.js';
import { summariseWithGemini, formatAISummary } from './gemini-summarizer.js';

export interface ResumeOptions {
  mode?: 'inline' | 'reference';
  aiSummary?: boolean;
  geminiKey?: string;
}

export async function nativeResume(session: UnifiedSession): Promise<void> {
  const cwd = session.cwd;
  switch (session.source) {
    case 'codex':
      await runCommand('codex', ['-c', `experimental_resume=${session.originalPath}`], cwd);
      break;
    case 'claude':
      await runCommand('claude', ['--resume', session.id], cwd);
      break;
    case 'copilot':
      await runCommand('copilot', ['--resume', session.id], cwd);
      break;
    case 'gemini':
      await runCommand('gemini', ['--continue'], cwd);
      break;
    case 'opencode':
      await runCommand('opencode', ['--session', session.id], cwd);
      break;
    case 'droid':
      await runCommand('droid', ['-s', session.id], cwd);
      break;
    case 'cursor':
      await runCommand('cursor', [cwd], cwd);
      break;
    default:
      throw new Error(`Unknown session source: ${session.source}`);
  }
}

export async function crossToolResume(
  session: UnifiedSession,
  target: SessionSource,
  options: ResumeOptions = {},
): Promise<void> {
  const { mode = 'inline', aiSummary = false, geminiKey } = options;

  const context = await extractContext(session);
  const cwd = session.cwd;

  let handoffMarkdown = context.markdown;
  if (aiSummary) {
    try {
      const toolSummaries = (context as any).toolSummaries ?? [];
      const summary = await summariseWithGemini(session, toolSummaries, geminiKey);
      const aiBlock = formatAISummary(summary);
      handoffMarkdown = `${aiBlock}\n\n---\n\n${context.markdown}`;
    } catch (err) {
      process.stderr.write(`[continues] AI summary skipped: ${(err as Error).message}\n`);
    }
  }

  const localPath = path.join(cwd, '.continues-handoff.md');
  try { fs.writeFileSync(localPath, handoffMarkdown); } catch { /* non-critical */ }
  saveContext({ ...context, markdown: handoffMarkdown });

  const prompt =
    mode === 'inline'
      ? buildInlinePrompt({ ...context, markdown: handoffMarkdown }, session)
      : buildReferencePrompt(session, localPath);

  switch (target) {
    case 'codex':   await runCommand('codex', [prompt], cwd); break;
    case 'claude':  await runCommand('claude', [prompt], cwd); break;
    case 'copilot': await runCommand('copilot', ['-i', prompt], cwd); break;
    case 'gemini':  await runCommand('gemini', [prompt], cwd); break;
    case 'opencode':await runCommand('opencode', ['--prompt', prompt], cwd); break;
    case 'droid':   await runCommand('droid', ['exec', prompt], cwd); break;
    case 'cursor':  await runCommand('cursor', [cwd], cwd); break;
    default: throw new Error(`Unknown target: ${target}`);
  }
}

function buildInlinePrompt(context: SessionContext, session: UnifiedSession): string {
  const sourceLabel = SOURCE_LABELS[session.source] || session.source;
  return `I'm continuing a coding session from **${sourceLabel}**. Here's the full context:\n\n---\n\n` + context.markdown;
}

function buildReferencePrompt(session: UnifiedSession, filePath: string): string {
  const sourceLabel = SOURCE_LABELS[session.source] || session.source;
  return [
    `# Session Handoff`,
    ``,
    `Picking up a coding session from **${sourceLabel}**. The full context is in \`.continues-handoff.md\`.`,
    ``,
    `| Detail | Value |`,
    `|--------|-------|`,
    `| Previous tool | ${sourceLabel} |`,
    `| Working directory | \`${session.cwd}\` |`,
    `| Context file | \`.continues-handoff.md\` |`,
    session.summary ? `| Last task | ${session.summary.slice(0, 80)} |` : '',
    ``,
    `Read \`.continues-handoff.md\` first, then continue the work.`,
  ].filter(Boolean).join('\n');
}

export async function resume(
  session: UnifiedSession,
  target?: SessionSource,
  options: ResumeOptions | 'inline' | 'reference' = {},
): Promise<void> {
  const resolvedOptions: ResumeOptions =
    typeof options === 'string' ? { mode: options } : options;
  const actualTarget = target || session.source;
  if (actualTarget === session.source) {
    await nativeResume(session);
  } else {
    await crossToolResume(session, actualTarget, resolvedOptions);
  }
}

function runCommand(command: string, args: string[], cwd: string, stdinData?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: stdinData ? ['pipe', 'inherit', 'inherit'] : 'inherit',
      shell: false,
    });
    if (stdinData && child.stdin) { child.stdin.write(stdinData); child.stdin.end(); }
    child.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(`Command exited with code ${code}`)); });
    child.on('error', reject);
  });
}

export async function isToolAvailable(tool: SessionSource): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('which', [tool], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export async function getAvailableTools(): Promise<SessionSource[]> {
  const tools: SessionSource[] = [];
  const [hasCodex, hasClaude, hasCopilot, hasGemini, hasOpencode, hasDroid, hasCursor] =
    await Promise.all([
      isToolAvailable('codex'), isToolAvailable('claude'), isToolAvailable('copilot'),
      isToolAvailable('gemini'), isToolAvailable('opencode'), isToolAvailable('droid'),
      isToolAvailable('cursor'),
    ]);
  if (hasCodex) tools.push('codex');
  if (hasClaude) tools.push('claude');
  if (hasCopilot) tools.push('copilot');
  if (hasGemini) tools.push('gemini');
  if (hasOpencode) tools.push('opencode');
  if (hasDroid) tools.push('droid');
  if (hasCursor) tools.push('cursor');
  return tools;
}

export function getResumeCommand(session: UnifiedSession, target?: SessionSource): string {
  const actualTarget = target || session.source;
  if (actualTarget === session.source) {
    switch (session.source) {
      case 'codex':    return `codex -c experimental_resume="${session.originalPath}"`;
      case 'claude':   return `claude --resume ${session.id}`;
      case 'copilot':  return `copilot --resume ${session.id}`;
      case 'gemini':   return `gemini --continue`;
      case 'opencode': return `opencode --session ${session.id}`;
      case 'droid':    return `droid -s ${session.id}`;
      case 'cursor':   return `cursor ${session.cwd}`;
    }
  }
  return `continues resume ${session.id} --in ${actualTarget}`;
}
