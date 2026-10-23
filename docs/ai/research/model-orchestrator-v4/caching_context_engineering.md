# Context engineering and prompt caching for consecutive edits in agentic builders (as of 23 Oct 2026)

Scope: techniques that make repeated edits cheaper in Makeborne, which runs on the Anthropic API. Today every edit re-sends a ~7.6K-token system prompt, ~1K tokens of tool schemas and the ~18K-token site, and writes all of it to the cache. The research covers keeping prefixes stable, cutting input and output tokens, and what each choice costs.

Worked numbers below use the Opus 5.5 prices the brief gave; Anthropic's caching page confirms them. Base input is $4/M, a 5-min write $5/M, a 1-h write $8/M, a read $0.20/M and output $20/M. The prefix is P = 7.6K + 1K + 18K = 26.6K tokens.

Labels: "(vendor claim)" means a company's own unverified number. "(via search snippet)" means I could not fetch the page, so the figure comes from a search-engine summary. Both need checking before anyone quotes them.

---

## 1. Prompt caching: how it works, best practice, TTL and keep-alive, diagnostics, and the cost of switching model or effort

### Takeaway
Caching matches the prefix byte for byte, the cache is per model, and it is layered as tools, then system, then messages. A change at any layer invalidates that layer and everything after it. On Opus 5.5 a 5-minute write ($5/M) costs more than sending the tokens uncached ($4/M), so a cache entry that is never read back is pure loss. A read costs only 1/20 of base input. The design goal is therefore to make sure every write is read back: keep the system prompt and tools byte-stable, keep the history append-only, never switch model or effort mid-session, and cover pauses with 1-h TTLs or capped keep-alive pings. The new `diagnostics` parameter reports where a prefix diverged.

### Cited Findings

**Mechanics (Anthropic)**
- Two modes. Automatic caching is a top-level `cache_control: {type: "ephemeral"}`, and its breakpoint moves forward as the conversation grows. Explicit caching puts `cache_control` on individual blocks. A request allows at most 4 breakpoints, and automatic caching takes one of them. Breakpoints themselves cost nothing. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- The order is `tools` → `system` → `messages`. A change at one level invalidates that level and all later ones. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Price multipliers:
  - 5-min write: 1.25x base.
  - 1-h write: 2x base.
  - Read: 0.1x base, except 0.05x on Opus 5.5 and Sonnet 5.5 (and 0.025x on Fable 5.1 and Mythos 5.1).
  - Opus 5.5 ($4 base): $5 write (5 min), $8 write (1 h), $0.20 read.
  - Opus 5 and 4.x ($5 base): $6.25, $10 and $0.50.
  - Sonnet 5 ($2 base): $2.50, $4 and $0.20.
  - Sonnet 4.5/4.6 ($3 base): $3.75, $6 and $0.30.

  — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- The minimum cacheable prefix is 512 tokens on Opus 5.5, Opus 5, Sonnet 5.5, Haiku 5.5 and Fable/Mythos 5.x. It is 1,024 on Sonnet 5, Sonnet 4.5/4.6 and Opus 4.8, 2,048 on Opus 4.7, and 4,096 on Opus 4.5/4.6 and Haiku 4.5. A shorter prompt is silently not cached. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Lookback: a write happens only at a breakpoint, and each breakpoint stores a cumulative hash of the prefix. On a miss, the system walks back one block at a time, checking at most 20 positions (the breakpoint counts as the first). A run of consecutive `tool_use` blocks, or of `tool_result` blocks, counts as one position. Per the FAQ, you need several breakpoints only when a growing conversation pushes the breakpoint 20 or more blocks past the last write, when sections update at different frequencies, or when you want explicit cost control. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- "Put the breakpoint on the last block that is identical across requests." A breakpoint on changing content, such as a timestamp, never hits. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Invalidation table:
  - Changing tool definitions invalidates everything.
  - Toggling web search or citations, or switching speed (`fast` vs standard), invalidates system and messages.
  - Changing `tool_choice`, or adding or removing images, invalidates messages.
  - Thinking parameters and `output_config.effort` invalidate messages, and may also invalidate tools and system depending on the model, "because the thinking configuration is rendered into the prompt."
  - Setting effort explicitly to the model's default is the same as omitting it.

  — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- On supported models, a `role: "system"` message inside `messages` adds an instruction without invalidating the system or message caches. This is not available on Sonnet 5. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- TTL: the default is 5 minutes, and each use refreshes it at no cost. The lifetime counts from the start of the request that wrote or read the entry, so streaming time eats into it. When responses are long and the next request may start after the lifetime ends, use the 1-hour TTL. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Mixing TTLs: 1-h entries must come before 5-min entries. Billing works from three positions: A is the highest cache hit, B the highest 1-h breakpoint after A, and C the last breakpoint. You pay reads up to A, 1-h writes for B−A and 5-min writes for C−B. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Pre-warming: `max_tokens: 0` writes the cache and returns empty `content` with `stop_reason: "max_tokens"`. Put the breakpoint on the shared prefix, not on the placeholder message, and match the thinking and effort settings of your real requests. A pre-warm is rejected when `stream: true`, extended thinking is on, structured outputs are set, `tool_choice` is `tool`/`any`, or it is inside a Batches request. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Concurrency: an entry becomes readable only after the first response starts. For parallel requests to hit, wait until the first one starts. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Isolation: caches are isolated per organization and, on the Claude API, Claude Platform on AWS and Foundry, also per workspace. Bedrock and Google Cloud isolate per organization only. A hit needs a 100% identical prompt up to the breakpoint. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Usage fields:
  - `cache_creation_input_tokens`, split by TTL into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`.
  - `cache_read_input_tokens`.
  - `input_tokens`, which counts only the tokens after the last breakpoint.
  - Total input = read + creation + input.

  — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- With Batches, hits are best-effort. Anthropic suggests writing a shared prefix with the 1-h TTL first, because batches often take 5–60 minutes. — [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Cache diagnostics (GA, Claude API only)**
- Include `diagnostics: {previous_message_id: <prior response id>}`, or `null` on the first turn to opt in. The beta header `cache-diagnosis-2026-04-07` is no longer required. The response gets `diagnostics.cache_miss_reason.type`, which is one of:
  - `model_changed` ("The cache is per-model")
  - `system_changed`
  - `tools_changed`
  - `messages_changed`
  - `previous_message_not_found`
  - `unavailable` (for example when `tool_choice`, `thinking`, `context_management`, `output_config`, `output_format` or the set of active beta headers differs)

  The `*_changed` types also give `cache_missed_input_tokens`. Only the earliest divergence is reported. Fingerprints hold only hashes and expire after a short period. The previous request must be in the same workspace. In streaming, the field arrives on `message_start`. — [Anthropic cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)
- Reading it with usage: `diagnostics: null` plus a low read count means the requests matched but the entry expired. The doc's advice is to shorten gaps or use the 1-h TTL. — [Anthropic cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)

**How Claude Code does it (Thariq Shihipar, Claude Code team, 30 Apr 2026)**
- Layout order:
  1. Static system prompt and tools (cached globally)
  2. CLAUDE.md (cached per project)
  3. Session context (cached per session)
  4. Messages

  Past mistakes that broke the cache: a detailed timestamp in the static prompt, non-deterministic tool ordering, and changing tool parameters. — [Lessons from building Claude Code: Prompt caching is everything](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- State changes such as the time or a changed file go in a `<system-reminder>` in the next user message or tool result, never in a system-prompt edit. — [same](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- "Don't switch models mid-session." Their example: 100K tokens into an Opus conversation, switching to Haiku for an easy question costs more than letting Opus answer, because Haiku must rebuild its cache. A model switch goes through a subagent instead: Opus writes a hand-off message, and the Explore subagents use Haiku this way. — [same](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- Tools never change mid-session. Plan mode is implemented as the tools EnterPlanMode/ExitPlanMode rather than a swapped-in read-only tool set. MCP tools are sent as stable-ordered `defer_loading` stubs. — [same](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- The team alerts on cache hit rate and declares SEVs when it falls too low: "Monitor cache hit rate like uptime." — [same](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/). A specific "<90% = SEV" threshold appears only in secondary coverage and is unconfirmed — [implicator.ai](https://www.implicator.ai/anthropic-says-cache-misses-are-production-incidents-reveals-caching-shaped-claude-code/)

**Other practitioners and research**
- Manus calls KV-cache hit rate "the single most important metric for a production-stage AI agent." Its average input:output ratio is about 100:1, and on Claude Sonnet cached input is $0.30/MTok against $3 uncached. Its rules: keep the prefix stable (no second-precision timestamps), make context append-only, serialize JSON deterministically, place breakpoints explicitly, and mask tools with logit masking rather than removing them. — [Manus, Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Lumer et al., "Don't Break the Cache" (arXiv 2601.06007, Jan 2026): DeepResearch Bench, 500+ sessions, 10K-token system prompts. Caching cut API cost by 41–80% and TTFT by 13–31%; the TTFT figures are inconsistent inside the paper itself. Claude Sonnet 4.5 results:

  | Strategy | Cost reduction | TTFT improvement |
  |---|---|---|
  | Full context | 77.8% | 21.8% |
  | System prompt only | 78.5% | 22.9% |
  | Excluding tool results | 78.1% | 20.9% |

  For GPT-4o, full-context caching cost 8.8% more TTFT, while the other strategies improved TTFT by 28–31%; the authors' likely explanation is the overhead of writing dynamic tool results. System-prompt-only caching was "the most consistent." There were 40 sessions per condition, and the paper is a preprint. — [arXiv 2601.06007v2](https://arxiv.org/html/2601.06007v2)
- Aider's prompt order is system prompt → read-only files → repo map → editable files. `--cache-keepalive-pings N` pings every 5 minutes up to N times, extending the window to N×5 minutes after the last message. — [Aider prompt caching](https://aider.chat/docs/usage/caching.html)

**OpenAI and Google, for comparison**
- OpenAI on GPT-5.6+:
  - Minimum 1,024 visible input tokens.
  - Reads cost 0.1x input (0.05x on GPT-6.1 Sol). Writes cost 1.25x for a 30-min TTL and 2.5x for 12 h, set with `prompt_cache_options.ttl` in the Responses API.
  - Earlier models had no write charge and used `in_memory` (5–10 min, up to 1 h) or `24h` retention.
  - Routing hashes the initial prefix (including tools) plus `prompt_cache_key`, and traffic above ~15 RPM per prefix or key can overflow to other machines.
  - The docs say changing `model` can change the cached prefix.
  - Advice: static content first, append rather than rewrite, keep tools stable.

  — [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- Gemini: implicit caching is on by default for 2.5+. The minimum is 4,096 tokens on Gemini 4 Argon and 3.x Flash, and 2,048 on 2.5. In Gemini 4 multi-turn loops the full previous request is cached only if the new request adds at least 2,050 tokens. Explicit caching is not supported on Gemini 4 Argon or later, nor in the Interactions API. — [Gemini caching](https://ai.google.dev/gemini-api/docs/caching)

### Inferences
- **Opus 5.5 cost per 26.6K-token prefix:**

  | How the prefix is sent | Cost |
  |---|---|
  | Uncached | $0.106 |
  | 5-min write | $0.133 |
  | 1-h write | $0.213 |
  | Read | $0.0053 (25x cheaper than a 5-min write) |

  A 5-min write is worth it whenever the chance of reuse within the TTL is above about 26%: the write premium is $1/M and each read saves $3.80/M. The brief's measured edit, which is "mostly cache writes", shows the entries written in one edit are not being read by the next.
- **Split the prefix into scopes, as Claude Code does:**
  - BP1 at the end of tools + system (~8.6K). This prefix is identical for every project of a given artifact type, so at production volume in one workspace it stays warm all the time. A 1-h TTL here is cheap insurance: 8.6K × $8/M = $0.069 per write.
  - BP2 at the end of the site snapshot (~18K, per project).
  - The automatic breakpoint at the tail.

  The 1-h breakpoints must come before the 5-min ones. Dynamic per-edit data (the selected element, the user's message, the time) goes after BP2, or in a `role: "system"` message in `messages` on models that support it.
- **Keep-alive pings against the 1-h TTL on Opus 5.5.** A ping that reads the prefix should cost 0.05x base, so about $0.0053 for 26.6K. That billing is my assumption: the docs describe the pre-warm write, not how a ping that hits is billed. The 1-h premium over a 5-min write is 0.75x base, or $0.08 for 26.6K. So 15 pings, about 67 minutes of idle at 4.5-min intervals, cost the same as the 1-h premium, whatever the prefix size.
  - Pings are cheaper for short pauses, and they cost nothing if you stop them once the tab closes or the user goes idle. A cap of 3–4 pings (15–20 min) is a reasonable default.
  - A 1-h TTL is better when gaps of 5–60 minutes are common, or when presence cannot be detected.
  - On models with a 0.1x read rate (for example Sonnet 4.6), break-even falls to about 7.5 pings (~34 min).
- **Compare 5-min and 1-h TTLs per gap between edits:**

  | Gap | 5-min TTL | 1-h TTL |
  |---|---|---|
  | Under 5 min | read | read |
  | 5 to 60 min | rewrite ($5/M) | read ($0.20/M) |
  | Over 60 min | rewrite ($5/M) | rewrite ($8/M) |

  So the 1-h TTL pays when 4.8 × (share of gaps of 5–60 min) > 3 × (share of gaps over 60 min + 1 / edits per session). Makeborne should log the distribution of inter-edit gaps per session to pick the TTL.
- **Model routing (relevant to the orchestrator v4 work).** Every mid-session model change costs a cold write of the whole prefix on the new model; for Sonnet 5 that is 26.6K × $2.50/M = $0.067, against a warm Opus read of $0.0053. Effort and thinking changes are a similar but smaller hazard: they always invalidate the messages cache and, on some models, tools and system too. So model and effort should be "sticky" per edit session, chosen at session start or on a cold cache. A cheaper model should run as a subagent with a short hand-off, not by switching the main conversation.
- Pass `diagnostics.previous_message_id` on every edit turn in production and alert on `*_changed` reasons. `model_changed` and `system_changed` would catch router or prompt-templating regressions straight away.

### Gaps
- The docs do not say how a `max_tokens: 0` pre-warm that hits an existing entry is billed: as a read with a TTL refresh, as assumed above, or otherwise. A 2-request test with usage logging would settle it.
- Pre-warm is "rejected if extended thinking is enabled", yet the docs also say to match thinking settings. Whether a pre-warm works with Makeborne's actual thinking and effort settings on Opus 5.5 needs testing.
- I did not get Sonnet 5.5 base prices; only its 0.05x read multiplier is confirmed.
- I found no published distribution of inter-edit gaps for website builders to set the TTL from. Makeborne has to measure its own.

---

## 2. Stable file ordering, diff-based context, append-only edit sessions, re-snapshot cadence, and how other tools manage edit context

### Takeaway
No source documents a "snapshot plus appended diffs" design for site builders specifically. The principles behind it are well established across Anthropic, OpenAI, Manus, Claude Code and Lumer et al.: keep history append-only, send state changes as new messages, order content from most to least stable, and serialize deterministically. Code tools split into two camps. Aider and Lovable curate context up front, using a repo map or a pre-selection pass. Claude Code, Cursor and Lovable's Agent Mode let the agent pull files with tools ("dynamic context discovery").

### Cited Findings
- "Treat the history as append-only; echo assistant `content` and tool results back verbatim." `messages_changed` fires when earlier messages are altered, reordered, truncated or re-serialized. — [Anthropic cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)
- `tools_changed` covers tools that were reordered or serialized non-deterministically. The fix is a fixed order and sorted keys. — [Anthropic cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics)
- Manus: make context append-only, don't modify earlier observations, and use deterministic JSON key ordering. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Claude Code: changed-file notices go in a `<system-reminder>` in the next message rather than a rewrite of the earlier prompt. — [Claude Code caching lessons](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- Aider's order is system → read-only files → repo map → editable files, from most to least stable. — [Aider caching](https://aider.chat/docs/usage/caching.html)
- Aider repo map:
  - It lists each file's key symbols with signatures and defining lines, ranked with a graph-ranking algorithm in which files are nodes and dependencies are edges.
  - `--map-tokens` defaults to 1K.
  - The map expands significantly when no files are in the chat.
  - The LLM can ask for specific files to be added.

  — [Aider repo map](https://aider.chat/docs/repomap.html)
- Cursor's "Dynamic context discovery" (Jediah Katz, Jan 2026) argues for less context up front: long tool outputs and terminal sessions become files, MCP tools load on demand, and summarization can look back into chat history. — [Cursor blog](https://cursor.com/blog/dynamic-context-discovery). An internal A/B test showed a 46.9% token reduction on runs that use MCP tools; the figure comes from secondary coverage and is unverified — [TestingCatalog](https://www.testingcatalog.com/cursor-rolls-out-dynamic-context-discovery-for-coding-agents.md)
- Lovable Agent Mode (beta, 30 Jun 2025) reads files as needed, searches the codebase and inspects logs. Lovable says it "reduces build error rates by 90%" and cuts unwanted changes (vendor claim). — [Lovable blog](https://lovable.dev/blog/agent-mode-beta)
- A third-party reverse-engineering account says Lovable runs a fast, cheap model first to pre-select relevant files before the main model, a "hydration" pattern (unverified). — [sarthakai Substack](https://sarthakai.substack.com/p/lets-build-the-lovable-ai-agent-tutorialcode)
- Cline reportedly collapses duplicate file reads in history before truncating, and falls back to dropping old turns with explicit notices. This is third-party and I could not confirm it in Cline's docs or source. — [fast.io](https://fast.io/resources/cline-context-window/)
- Anthropic: Claude Code loads CLAUDE.md up front and uses glob and grep "just in time"; "do the simplest thing that works." — [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### Inferences
- **A proposed design for Makeborne, synthesized from the principles above:**
  1. At the start of an edit session, or on any cold cache, serialize the site once as a canonical snapshot: files in a fixed order, most stable first (global CSS and theme, then layout and shared components, then page sections, with whatever was edited most recently last), with deterministic formatting. Put a breakpoint (BP2) after it.
  2. Never re-render the snapshot inside a session. Each edit appends to the history: the user request, then the model's `str_replace` calls and tool results, which are themselves the diff. Changes made outside the model, such as visual-editor tweaks or manual code edits, go in as an appended "changes since snapshot" message (a unified diff or the replaced spans), in the `<system-reminder>` style.
  3. Per-edit cost on a warm cache, with ~2K new tail tokens per edit and 1.5K output tokens, at edit 10:

     | Item | Cost |
     |---|---|
     | Read (26.6K + 18K) | ≈ $0.009 |
     | Write 2K | $0.01 |
     | Output 1.5K | $0.03 |
     | **Total** | **≈ $0.05** |

     The current pattern costs about $0.12–0.16 for the same edit: an 18–26.6K write plus the same output.
- **When to re-snapshot.** While the cache is warm, carrying D tokens of accumulated diffs costs only D × $0.20/M per edit, so 10K tokens of diffs costs $0.002 per edit. A re-snapshot costs at least 18K × $5/M = $0.09. On cost alone, re-snapshotting a warm session almost never pays. The cheapest rule is to re-snapshot whenever the cache is already cold (TTL expired, model change, new session): a full write is due anyway, and a collapsed snapshot is no longer than snapshot plus diffs. Re-snapshot while warm only for quality reasons: the same file patched many times, diffs above roughly 30–50% of snapshot size, or the model referencing stale code. That threshold is a heuristic to tune with evals; I found no published value.
- Automatic caching moves the tail breakpoint forward on every request, so the 20-block lookback only matters if Makeborne places explicit breakpoints and some edit adds more than 20 blocks between writes. Consecutive tool_use or tool_result runs count as one position, which reduces that risk.
- Several Makeborne users can edit the same project, and Anthropic caches are scoped to the workspace. Two people editing in parallel share the snapshot prefix (BP2) but not each other's tails.

### Gaps
- I found no official engineering write-up on edit-context management from Lovable, Bolt, Continue or Roo Code. Lovable evidence is a vendor blog plus a third-party teardown; Bolt, Continue (beyond its Relace apply integration) and Roo were not covered.
- I found no measured study of append-diff sessions against re-sent snapshots for web builders.

---

## 3. Progressive disclosure: a file index plus read_file against a full snapshot, tool search, and programmatic tool calling

### Takeaway
Anthropic's guidance favors a hybrid: a small amount of key context up front, plus just-in-time retrieval through tools. Retrieval saves tokens but costs extra inference turns, and Anthropic itself notes runtime exploration is slower. Makeborne's site is only 18K tokens, which costs $0.0036 to read warm, so keeping the full snapshot cached is likely cheaper and faster than progressive disclosure. Tool search and programmatic tool calling pay off at much larger tool or data volumes than Makeborne has today.

### Cited Findings
- Anthropic's goal is "the smallest possible set of high-signal tokens," citing context rot: recall falls as tokens grow. "Progressive disclosure" lets agents discover context step by step, but "runtime exploration is slower." Claude Code's hybrid loads CLAUDE.md up front and uses glob and grep just in time. Sub-agents return condensed summaries of 1,000–2,000 tokens. — [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Tool Search Tool (24 Nov 2025): context use before work starts fell from ~77K to ~8.7K tokens, an 85% reduction. MCP-eval accuracy rose from 49% to 74% on Opus 4 and from 79.5% to 88.1% on Opus 4.5. `defer_loading: true` keeps tools out of the initial context, and tool search "doesn't break prompt caching." — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Programmatic tool calling: average tokens on complex research tasks fell from 43,588 to 27,297 (−37%). Internal knowledge retrieval rose from 25.6% to 28.5%, and GIA from 46.5% to 51.2%. Orchestrating 20+ tool calls in one code block removes 19+ inference passes. Tool Use Examples raised complex-parameter accuracy from 72% to 90%. — [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Claude Code sends MCP tools as stable-ordered `defer_loading` stubs, so the cached prefix never changes. — [Claude Code caching lessons](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- Anthropic's text editor tool (`text_editor_20250728`, `str_replace_based_edit_tool`) adds 974 input tokens per request on Claude 4.7 and later, and 745 on 4.6 and earlier. `view` accepts `max_characters`. — [Anthropic text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)
- Aider sends a 1K-token repo map with every request and adds full files only on demand. — [Aider repo map](https://aider.chat/docs/repomap.html)
- Lovable Agent Mode reads files as needed and claims 90% fewer build errors. This is a vendor number and also reflects other changes in the same release, such as log and network inspection. — [Lovable blog](https://lovable.dev/blog/agent-mode-beta)

### Inferences
- **Size threshold.** Reading the 18K-token site warm costs $0.0036 per call. One extra discovery turn costs more than that: it re-reads the 8.6K+ static prefix ($0.0017 or more), emits ~50–150 output tokens ($0.001–0.003), and adds a full inference pass of latency. So for sites up to a few tens of thousands of tokens, keep the full snapshot cached. Switch to an index-first design only when a project's code grows to roughly 50–100K+ tokens or more, where context rot and write costs start to dominate. Even then, keep a compact index or repo map plus the most recently edited files in the cached snapshot. This threshold is my estimate and needs an A/B eval on edit quality.
- **Where a hybrid still helps at today's size:** large non-code payloads (long copy, ebook chapters, deck speaker notes, image metadata) can live behind a `read_section` tool rather than in the snapshot.
- Tool search is irrelevant at Makeborne's ~1K tokens of tools; it is worth adopting only if the tool catalog grows into the tens of thousands of tokens. Use the stub pattern if it does.
- Programmatic tool calling suits multi-file batch edits, such as "rename the brand across all pages." The 37% saving was measured on research tasks, not code edits, and it adds code-execution infrastructure.

### Gaps
- I found no rigorous measurement of discovery turns against full-snapshot quality for small (<50K) web codebases.
- I did not research what code-execution sessions for programmatic tool calling cost.

---

## 4. Cutting output tokens: edit formats and their accuracy, apply models, and speculative "instant apply"

### Takeaway
Output costs $20/M on Opus 5.5: five times base input and 100 times a cache read. After caching, the edit format is the biggest cost lever. On frontier Claude models, search/replace (Aider "diff", or Anthropic's `str_replace`) is reliable: 93–99.6% well-formed edits on Aider's polyglot benchmark, and the best format for large models in Diff-XYZ. A whole-file rewrite multiplies output cost by the file-to-hunk size ratio. Apply models (Cursor fast-apply, Morph, Relace) trade a cheap second model for fewer frontier output tokens and fewer failed matches. Their accuracy numbers are vendor-reported.

### Cited Findings
- Aider's formats:
  - "whole" returns full files and is "slow and costly."
  - "diff" uses search/replace blocks and is efficient.
  - "diff-fenced" exists for Gemini.
  - "udiff" was designed against GPT-4 Turbo laziness.
  - Architect mode lets a planner model hand off to an editor model using "editor-diff" or "editor-whole."

  — [Aider edit formats](https://aider.chat/docs/more/edit-formats.html)
- Aider laziness benchmark (89 tasks): GPT-4 Turbo scored 20% with SEARCH/REPLACE, with lazy comments on 12 tasks, and 61% with unified diffs, with lazy comments on 4 (via search snippet). — [Aider unified diffs](https://aider.chat/docs/unified-diffs.html)
- On the Aider polyglot leaderboard (page updated 20 Nov 2025), every Claude entry used "diff":

  | Model | Correct | Well-formed edits |
  |---|---|---|
  | Opus 4 (32k thinking) | 72.0% | 97.3% |
  | Sonnet 4 (no thinking) | 56.4% | 98.2% |
  | 3.5 Sonnet | 51.6% | 99.6% |
  | 3.7 Sonnet (no thinking) | 60.4% | 93.3% |

  The page has no same-model whole-versus-diff comparison. — [Aider leaderboards](https://aider.chat/docs/leaderboards/)
- Diff-XYZ (JetBrains, arXiv 2510.12487, Oct/Nov 2025): "search-replace format performs best for larger models across most tasks." Structured udiff variants are "similar but slightly weaker," and "smaller open models benefit little from any formatting choice." — [arXiv 2510.12487](https://arxiv.org/abs/2510.12487)
- Anthropic `str_replace`: `old_str` must match exactly, including whitespace. The recommended errors to return are "Found N matches… provide more context" and "No match found". — [Anthropic text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)
- Cursor fast apply (14 May 2024):
  - A fine-tuned Llama-3-70B rewrites the whole file at ~1,000 tok/s (~3,500 chars/s) using "speculative edits": deterministic speculation from the original file, with no draft model.
  - That is ~13x faster than vanilla Llama-3-70B and ~9x faster than their earlier GPT-4 speculative-edits deployment.
  - Their argument against diffs: fewer tokens to "think" with, diffs are rare in training data, and models are "notoriously bad at counting line numbers."
  - Eval: ~450 full-file edits of files under 400 lines, graded by Claude-3 Opus.

  — [Cursor, Editing Files at 1000 Tokens per Second](https://cursor.com/blog/instant-apply)
- Morph:
  - Speed: v3-fast runs at ~10,500 tok/s per request on a single B200, up from 4,500 (vendor claim). — [Morph blog](https://www.morphllm.com/blog/morph-breaks-10k-barrier.md)
  - Benchmark across 50 repos: Morph scored 100% and search-and-replace 96% on claude-sonnet-4.5, and 95% on Sonnet 4, with search-and-replace needing more tool calls (vendor benchmark; via search snippet, page returned HTTP 429). — [Morph fast-apply benchmarks](https://www.morphllm.com/benchmarks/fast-apply)
  - Morph's own pages disagree with each other: one says Claude search-replace has 86% first-pass accuracy, another that 89% of attempts hit ambiguous-match errors. Treat these as marketing. — [Morph comparisons](https://www.morphllm.com/comparisons)
- Relace Instant Apply: 4,300 tok/s and ~900 ms average end-to-end latency at launch. — [Continue blog](https://blog.continue.dev/instant-apply-with-relace). Relace Apply 3 claims 10K+ tok/s and is priced at about $0.85/M input and $1.25/M output (via search snippet) — [OpenRouter: Relace](https://openrouter.ai/provider/relace). Relace says structured diff formats "fail 10-15% of the time even for the best models" (vendor claim, via search snippet) — [Relace docs](https://docs.relace.ai/docs/instant-apply/overview)
- OpenAI Predicted Outputs pass the original file as `prediction` so matching tokens can be skipped. Rejected prediction tokens are billed as completion tokens, and latency can get worse when most of the prediction is rejected. Supported only on the GPT-4o and GPT-4.1 families (via search snippet). — [OpenAI predicted outputs](https://developers.openai.com/api/docs/guides/predicted-outputs)

### Inferences
- **Output cost at $20/M:**

  | Edit | Cost |
  |---|---|
  | Rewrite a 4K-token component | $0.08 |
  | ~300-token search/replace hunk | $0.006 |
  | Regenerate the whole 18K site | $0.36 |

  So "never emit unchanged code" is worth roughly 10–50x on output. Makeborne should make search/replace (`str_replace` or its own equivalent) the default, allow whole-file writes only for new files or rewrites above about 50% of a file, and enforce unique-match errors.
- **Apply-model option.** Opus emits a "lazy" snippet with `// ... existing code ...` markers. Relace or Morph merges it: on a 4K-token file that is about $0.004 input + $0.005 output at Relace Apply 3 prices. This saves frontier output only when hunks would otherwise need lots of exact-match context. It adds a vendor dependency and a second latency hop (~0.9 s at Relace's launch figure). For Claude-class models that already produce 93–99% well-formed search/replace, the main gain is fewer failed-match retries; each retry costs a full extra turn.
- **Architect/editor split (Aider's pattern).** Opus plans and a cheaper model edits. This fits the orchestrator, but because caches are per model the editor needs its own warm prefix. So it pays only when the editor's prefix stays warm across edits, or the editor receives a small hand-off rather than the whole site.
- The Anthropic API documents no Predicted Outputs equivalent that I found. The speculative "instant apply" speed-up is available to Makeborne only through third-party apply models.

### Gaps
- I found no independent (non-vendor) benchmark of Morph or Relace merge accuracy, and no Morph pricing.
- The Aider leaderboard has no same-model whole-versus-diff accuracy comparison for Claude, and I found no edit-format results specific to React/CSS or web builders.

---

## 5. Compaction and context editing: costs against benefits

### Takeaway
Server-side context editing (clearing old tool results or thinking) and compaction (summarizing) keep long agent loops inside the window and can cut tokens a lot. Anthropic reports −84% tokens on a 100-turn web-search eval. Both rewrite the prefix, though, so each use triggers a new cache write. For short edit sessions of 18–30K tokens they are rarely needed. The cache-aware "compaction" for a builder is the opportunistic re-snapshot in section 2. If summarization is used, it must reuse the parent's exact prefix ("cache-safe forking").

### Cited Findings
- Anthropic context management (2025 announcement; figures via search snippet): context editing cut token use by 84% in a 100-turn web-search eval and let workflows finish that would otherwise fail. Memory tool plus context editing improved performance by 39% over baseline; context editing alone by 29%. These are internal tests. — [Anthropic, Managing context on the Claude Developer Platform](https://www.anthropic.com/news/context-management)
- Context editing (`context-management-2025-06-27`):
  - `clear_tool_uses_20250919` parameters: `trigger` (default 100K input tokens), `keep` (default 3 tool uses), `clear_at_least`, `exclude_tools`, `clear_tool_inputs`.
  - `clear_thinking_20251015` clears thinking blocks.
  - "Clearing invalidates the cached prompt prefix", so use `clear_at_least` to make each invalidation worthwhile.
  - On Opus 5.5 and other 5.5-series models, server-side context management never invalidates thinking blocks.

  — [Anthropic context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- Compaction API: compaction on demand (beta `compact-2026-09-04`, a top-level `compaction` parameter) and compaction at a token threshold. Options include keeping recent turns word for word, compacting in the background, and a custom summary prompt. — [Anthropic compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)
- Claude Code compaction:
  - A naive summarization call with a different system prompt and no tools misses the cache from the first token and bills the whole conversation uncached.
  - Their fix reuses the parent's exact system prompt, context and tools, and appends the compaction prompt as the last user message. That makes the call about 1/10 of the uncached price, and the summary is about 20K tokens.
  - A "compaction buffer" must be reserved in the window.
  - "Side computations (compaction, summarization, skills) must share the parent's exact prefix."

  — [Claude Code caching lessons](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)
- Anthropic recommends tool-result clearing as "the lightest form of compaction". Claude Code continues after compaction with the summary plus the five most recently accessed files. — [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Manus: compression should be restorable. Drop a page's content but keep its URL, or a document's content but keep its path; use the file system as external memory. — [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- Lumer et al.: summarizing or pruning old tool calls "breaks cached representations", and writing tool calls to the cache pays off only if reads follow. — [arXiv 2601.06007v2](https://arxiv.org/html/2601.06007v2)

### Inferences
- **What compaction is worth to Makeborne.** A long session of 30 edits at ~2K tail each grows to about 87K tokens (26.6K + 60K), which costs about $0.017 to read warm per edit. That is still cheap and well inside the window. Compaction becomes worthwhile for quality (context rot, stale code) or once the window gets close to full, not for cost.
- **Cheapest compaction for a builder.** Drop the edit history and re-snapshot the current site on the next cold start, keeping a short "decisions and user preferences" note: brand voice, rejected options, constraints. This follows Claude Code's pattern of a summary plus recent files.
- If server-side `clear_tool_uses` is used, for example for verbose build logs or screenshot results, set `clear_at_least` to several thousand tokens and keep edit tool results in `exclude_tools` when the diffs are what the model needs.

### Gaps
- I found no measured quality impact of compaction or context editing on code-edit tasks specifically; the 84%, 29% and 39% figures come from web-search evals.
- I did not find detailed billing for compaction iterations (usage fields for the summary call) on the compaction pages I read.
