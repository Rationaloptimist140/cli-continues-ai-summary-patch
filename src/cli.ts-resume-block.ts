// Replace the existing program.command('resume <session-id>') block with this:

program
  .command('resume <session-id>')
  .alias('r')
  .description('Resume a session by ID or short ID')
  .option('-i, --in <cli-tool>', 'Target CLI tool (claude, copilot, gemini, codex, opencode, droid, cursor)')
  .option('--reference', 'Use file reference instead of inline context (for very large sessions)')
  .option('--ai-summary', 'Enrich handoff with an AI-generated summary via Gemini (recommended for long sessions)')
  .option('--gemini-key <key>', 'Gemini API key (overrides CONTINUES_GEMINI_KEY / GEMINI_API_KEY env vars)')
  .option('--no-tui', 'Disable interactive prompts')
  .action(async (sessionId, options) => {
    try {
      const spinner = isTTY && !options.noTui ? ora('Finding session...').start() : null;
      const session = await findSession(sessionId);
      if (spinner) spinner.stop();

      if (!session) {
        const allSessions = await getAllSessions();
        const similar = allSessions
          .filter(s =>
            s.id.toLowerCase().includes(sessionId.toLowerCase()) ||
            s.summary?.toLowerCase().includes(sessionId.toLowerCase()),
          )
          .slice(0, 3);
        console.error(chalk.red(`Session not found: ${sessionId}`));
        if (similar.length > 0) {
          console.log(chalk.yellow('\nDid you mean one of these?'));
          for (const s of similar) console.log('  ' + formatSessionColored(s));
        }
        process.exitCode = 1;
        return;
      }

      const target = options.in as SessionSource | undefined;
      const resumeOptions = {
        mode: (options.reference ? 'reference' : 'inline') as 'inline' | 'reference',
        aiSummary: Boolean(options.aiSummary),
        geminiKey: options.geminiKey as string | undefined,
      };

      if (!isTTY || options.noTui) {
        console.log(chalk.gray('Session: ') + formatSession(session));
        console.log(chalk.gray('Command: ') + chalk.cyan(getResumeCommand(session, target)));
        if (resumeOptions.aiSummary) console.log(chalk.gray('AI summary: ') + chalk.magenta('enabled (Gemini 2.0 Flash)'));
        console.log();
        process.chdir(session.cwd);
        await resume(session, target, resumeOptions);
        return;
      }

      if (isTTY && !target) {
        clack.intro(chalk.bold('Resume session'));
        console.log(formatSessionColored(session));
        console.log();

        const availableTools = await getAvailableTools();
        const targetOptions = availableTools
          .filter(t => t !== session.source)
          .map(t => ({ value: t, label: `${sourceColors[t](t.charAt(0).toUpperCase() + t.slice(1))}` }));

        if (targetOptions.length === 0) {
          const allTools: SessionSource[] = ['claude', 'codex', 'copilot', 'gemini', 'opencode', 'droid'];
          const missing = allTools.filter(t => !availableTools.includes(t)).map(t => t.charAt(0).toUpperCase() + t.slice(1));
          clack.log.warn(`Only ${sourceColors[session.source](session.source)} is installed. Install at least one more (${missing.join(', ')}) to enable cross-tool handoff.`);
          return;
        }

        const selectedTarget = await clack.select({
          message: `Continue ${sourceColors[session.source](session.source)} session in:`,
          options: targetOptions,
        }) as SessionSource;

        if (clack.isCancel(selectedTarget)) { clack.cancel('Cancelled'); return; }

        console.log();
        clack.log.info(`Working directory: ${chalk.cyan(session.cwd)}`);
        const messageCount = (session as any).messageCount || '?';
        const fileCount = (session as any).filesModified?.length || '?';
        clack.log.info(`Context: ${messageCount} messages, ${fileCount} files modified`);
        clack.log.info(`Command: ${chalk.cyan(getResumeCommand(session, selectedTarget))}`);
        if (resumeOptions.aiSummary) clack.log.info(`AI summary: ${chalk.magenta('enabled — Gemini will enrich handoff context')}`);
        console.log();

        clack.log.step(`Handing off to ${selectedTarget}...`);
        clack.outro(`Launching ${selectedTarget}`);
        process.chdir(session.cwd);
        await resume(session, selectedTarget, resumeOptions);

      } else {
        console.log(chalk.gray('Session: ') + formatSession(session));
        console.log(chalk.gray('Command: ') + chalk.cyan(getResumeCommand(session, target)));
        if (resumeOptions.aiSummary) console.log(chalk.gray('AI summary: ') + chalk.magenta('enabled (Gemini 2.0 Flash)'));
        console.log();
        process.chdir(session.cwd);
        await resume(session, target, resumeOptions);
      }

    } catch (error) {
      if (clack.isCancel(error)) { clack.cancel('Cancelled'); return; }
      console.error(chalk.red('Error:'), (error as Error).message);
      process.exitCode = 1;
    }
  });
