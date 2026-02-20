/**
 * gemini-summarizer.ts
 *
 * Uses the Gemini API to produce a structured AI summary of a session's
 * extracted context before cross-tool handoff.
 *
 * Usage:
 *   continues resume <id> --in gemini --ai-summary
 *   CONTINUES_GEMINI_KEY=<key> continues resume <id> --in claude --ai-summary
 */

import type { UnifiedSession, ToolUsageSummary } from '../types/index.js';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface AISummary {
  what: string;        // What was being built / the goal
  done: string;        // What was completed this session
  decisions: string;   // Key architectural/technical decisions made
  next: string;        // What to do next (pending tasks)
  warnings: string;    // Gotchas, failed commands, dead-ends
  context: string;     // Full prose handoff block for the target tool
}

/**
 * Build the prompt sent to Gemini from a UnifiedSession.
 */
function buildPrompt(session: UnifiedSession, toolSummaries: ToolUsageSummary[]): string {
  const toolLines = toolSummaries
    .map(t => {
      const samples = t.samples.slice(0, 3).map(s => `    • ${s.summary}`).join('\n');
      return `  ${t.name} (×${t.count}):\n${samples}`;
    })
    .join('\n');

  const filesChanged = (session as any).filesModified?.join(', ') || 'unknown';
  const messages = (session as any).messages || [];
  const recentMessages = messages
    .slice(-30)
    .map((m: any) => `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 400) : JSON.stringify(m.content).slice(0, 400)}`)
    .join('\n');

  return `You are helping an AI coding assistant pick up a session that hit a rate limit.
Analyze the session context below and produce a structured handoff summary.

--- SESSION METADATA ---
Tool: ${session.source}
Project: ${session.repo || session.cwd}
Directory: ${session.cwd}
Duration: ${session.updatedAt.toISOString()}
Summary: ${session.summary || '(none)'}

--- FILES MODIFIED ---
${filesChanged}

--- TOOL ACTIVITY ---
${toolLines || '(no tool activity recorded)'}

--- RECENT CONVERSATION (last 30 messages) ---
${recentMessages || '(no messages)'}

--- INSTRUCTIONS ---
Respond with a JSON object (no markdown, raw JSON only) with these exact keys:
{
  "what": "One sentence: what is being built and the current goal",
  "done": "Bullet list of what was completed this session (max 6 bullets)",
  "decisions": "Bullet list of key technical decisions made (max 4 bullets)",
  "next": "Bullet list of immediate next steps (max 4 bullets)",
  "warnings": "Bullet list of failures, dead-ends, or things to avoid (max 3 bullets, empty string if none)",
  "context": "Full prose handoff paragraph (3-5 sentences) written directly to the next AI assistant, telling it exactly where things stand and what to do first"
}`;
}

// ---------------------------------------------------------------------------
// Pro key validation
// ---------------------------------------------------------------------------

const PRO_VALIDATION_URL = 'https://continues-pro.vercel.app/api/validate-key';

export class ProKeyError extends Error {
  constructor() {
    super(
      '\n' +
      '  --ai-summary requires a Continues Pro key.\n' +
      '\n' +
      '  Get one at: https://continues-pro.vercel.app\n' +
      '  Plans start at $9/mo. Set CONTINUES_PRO_KEY after signup.\n' +
      '\n' +
      '  Free alternative: omit --ai-summary (full context still handed off).\n',
    );
    this.name = 'ProKeyError';
  }
}

/**
 * Validate a CONTINUES_PRO_KEY against the licensing endpoint.
 * Returns true if valid, throws ProKeyError if invalid/missing.
 */
async function validateProKey(proKey: string): Promise<void> {
  try {
    const res = await fetch(PRO_VALIDATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: proKey }),
    });
    if (!res.ok) throw new ProKeyError();
    const data = await res.json() as any;
    if (!data?.valid) throw new ProKeyError();
  } catch (err) {
    if (err instanceof ProKeyError) throw err;
    // Network failure — fail open so offline users aren't blocked
    console.warn('[continues] Pro key validation skipped (network unavailable).');
  }
}

/**
 * Call the Gemini API and return an AISummary.
 * Requires a valid CONTINUES_PRO_KEY (checked first).
 * Throws ProKeyError if key is missing/invalid.
 */
export async function summariseWithGemini(
  session: UnifiedSession,
  toolSummaries: ToolUsageSummary[],
  apiKey?: string,
): Promise<AISummary> {
  // --- Pro key gate ---
  const proKey = process.env.CONTINUES_PRO_KEY;
  if (!proKey) throw new ProKeyError();
  await validateProKey(proKey);

  // --- Gemini API key ---
  const key = apiKey || process.env.CONTINUES_GEMINI_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Gemini API key not found. Set CONTINUES_GEMINI_KEY or pass --gemini-key <key>.',
    );
  }

  const prompt = buildPrompt(session, toolSummaries);

  const response = await fetch(`${GEMINI_API_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned an empty response.');

  try {
    return JSON.parse(raw) as AISummary;
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${raw.slice(0, 200)}`);
  }
}

/**
 * Format an AISummary into a markdown handoff block suitable for
 * injection into any target tool's prompt.
 */
export function formatAISummary(summary: AISummary): string {
  const lines: string[] = [
    '## AI-Generated Session Handoff',
    '',
    `**Goal:** ${summary.what}`,
    '',
    '**Completed this session:**',
    summary.done,
    '',
    '**Key decisions made:**',
    summary.decisions,
    '',
    '**Next steps:**',
    summary.next,
  ];

  if (summary.warnings) {
    lines.push('', '**Warnings / dead-ends:**', summary.warnings);
  }

  lines.push(
    '',
    '---',
    '',
    '**Handoff note to you:**',
    summary.context,
    '',
    '---',
    '_Summary generated by Gemini 2.0 Flash via `continues --ai-summary`_',
  );

  return lines.join('\n');
}
