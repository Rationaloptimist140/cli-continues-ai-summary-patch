# AI Summary (Pro)

The `--ai-summary` flag uses Gemini 2.0 Flash to distill your raw session
context into a structured briefing before handing off to Claude, ChatGPT,
or any other tool.

Instead of dumping 200 lines of tool logs at the receiving AI, it gets a
clean 10-line brief: what you were building, what decisions were made,
what's blocked, and what to do next.

## Pricing

| Plan | Price | AI Summary |
|------|-------|-----------|
| Free | $0/mo | No |
| Pro  | $9/mo | Yes |

**Get a Pro key:** https://continues-pro.vercel.app

## Setup

1. Subscribe at https://continues-pro.vercel.app  
2. Your Pro key is emailed immediately after payment  
3. Add both keys to your shell profile:

```bash
# ~/.zshrc or ~/.bashrc
export CONTINUES_PRO_KEY=cpr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export CONTINUES_GEMINI_KEY=AIzaSy...   # from aistudio.google.com/apikey
```

4. Reload your shell:

```bash
source ~/.zshrc
```

## Usage

```bash
# Basic — AI summary before handing off to Claude
continues resume <session-id> --in claude --ai-summary

# With ChatGPT
continues resume <session-id> --in chatgpt --ai-summary

# Inline mode (full context pasted, not file reference)
continues resume <session-id> --in claude --ai-summary --mode inline

# Override Gemini key for a one-off
continues resume <session-id> --in claude --ai-summary --gemini-key AIzaSy...
```

## What the summary includes

```
## AI-Generated Session Handoff

**Goal:** Building a REST API for user authentication with JWT tokens

**Completed this session:**
- Set up Express server with TypeScript
- Implemented /auth/login and /auth/register endpoints
- Added bcrypt password hashing

**Key decisions made:**
- Using RS256 JWT (not HS256) for asymmetric key support
- Storing refresh tokens in Redis, not the DB

**Next steps:**
- Implement /auth/refresh endpoint
- Add rate limiting middleware
- Write integration tests for auth routes

**Warnings / dead-ends:**
- bcrypt v5 has breaking API change — stay on v4 for now

---

**Handoff note to you:** We're building a JWT auth system in Express/TS.
Login and register are working. Your first task is to implement the
/auth/refresh endpoint — the refresh token Redis schema is already
defined in src/redis/schema.ts. Do not upgrade bcrypt past v4.
```

## Error: Pro key required

If you run `--ai-summary` without a valid Pro key, you'll see:

```
  --ai-summary requires a Continues Pro key.

  Get one at: https://continues-pro.vercel.app
  Plans start at $9/mo. Set CONTINUES_PRO_KEY after signup.

  Free alternative: omit --ai-summary (full context still handed off).
```

## FAQ

**Do I need my own Gemini API key?**  
Yes — set `CONTINUES_GEMINI_KEY` from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Gemini has a generous free tier; most sessions cost fractions of a cent.

**What if validation fails due to network issues?**  
Key validation fails open. If our endpoint is unreachable, the AI summary
still runs. We never block your workflow over connectivity issues.

**Can I cancel anytime?**  
Yes. Cancel via the Stripe customer portal. Your key stays active until
the end of the billing period.
