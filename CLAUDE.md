# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A QQ bot (OneBot 11 / NapCat over WebSocket) with a React admin panel. TypeScript pnpm project, flat layout (no `apps/` or `packages/`). All Chinese-facing product strings (commands, prompts, confirmation phrases) are intentional — preserve them exactly.

## Commands

```bash
pnpm install                # pinned pnpm@11.7.0; better-sqlite3 + esbuild are built (pnpm-workspace.yaml)
pnpm dev                    # Express + Vite dev middleware on ONE port (default 8001). Watches lib/server and .env.
PORT=18001 pnpm dev         # alternate port (PORT is read only in lib/server/index.ts)
pnpm start                  # run the server entry via tsx (no watch)

pnpm check                  # type-check BOTH projects (server tsconfig.json + app tsconfig.app.json)
pnpm check:server | pnpm check:app   # type-check one side
pnpm build                  # server type-check + Vite build of the panel into dist/
pnpm server:build           # tsc -p tsconfig.json (server side, --noEmit via noEmit flag)
pnpm panel:build            # tsc -p tsconfig.app.json --noEmit && vite build

pnpm test                   # node --import tsx --test tests/server/*.test.ts (Node test runner)
# Single test file / single test:
node --import tsx --test tests/server/bot-safety.test.ts
node --import tsx --test --test-name-pattern="pattern" tests/server/bot-safety.test.ts

pnpm exec eslint .          # lint (no `lint` script defined; invoke eslint directly)
pnpm preview:ai             # OFFLINE: prints the Gemini request body that *would* be sent for a synthetic group message (no provider call). Override via argv + PREVIEW_* env vars. Exercised by tests/server/ai-runtime-preview.test.ts.
pnpm migrate:sqlite         # one-shot JSON→SQLite replay; renames source *.json to *.bak

pnpm bot:restart | bot:stop | bot:status   # scripts/restart.sh manages the single server process (PID in qq-bot.pid, logs in logs/server.log)
```

Tests use Node's built-in runner + `tsx`. Put backend tests in `tests/server/*.test.ts`. Tests that touch SQLite must `resetDb()` and set `QQ_BOT_DB_PATH` to a temp/`:memory:` path **before** the first query (see `sqlite-store.test.ts`).

## Architecture

### One process, one port
`lib/server/index.ts` boots a single Node process that does three things at once:
1. Runs an OneBot 11 WebSocket **client** (`ws-client.ts`) that connects to NapCat (target = `cfg.napcat_ws`, default `ws://127.0.0.1:3001` — *not* an env var).
2. Runs an Express HTTP server hosting `/api/*`.
3. Serves the React panel — built `dist/` in prod, or **Vite dev middleware mounted inside Express** in dev (`NODE_ENV=development` or `QQ_BOT_VITE_DEV=1`).

Because Vite runs in middleware mode reusing the Express `http.Server`, there is **no `server.proxy` in `vite.config.mjs`** — `/api` is same-origin. Panel + API share the port. `api.ts` does **not** import `bot-core`; the WS client is the only bridge between HTTP and the bot pipeline.

### Layout and the facade/shim refactor
The server was recently split into `lib/server/{ai,bot,store}/` subdirectories. Two root files are now **thin backward-compat re-exports, not implementations** — read past them:
- `lib/server/bot-core.ts` → re-exports from `./bot/index.js` (barrel: `bot/index.ts`).
- `lib/server/ai.ts` → re-exports `chat` (via a mutable holder so tests can mock it), plus a few helpers. The real AI logic is in `lib/server/ai/`.

The bot imports AI as `import * as ai from '../../ai.js'`.

### Inbound message pipeline
```
NapCat WS → ws-client._handleData
  → (post_type==='message') botCore.handleEvent(data, client)        [lib/server/bot/handlers/event.ts]
       1. filter: scope (group whitelist), self-loop, persist gate
       2. persist: messageStore.addMessage + fire-and-forget image cache
       3. route: handleCommand  (admin commands: /ping /status /clearcontext /help)
                 OR  withConversationLock(lockKey, () => handleAiTurn(...))
```
- `handleEvent` is the **single chokepoint**: all scope/self/persist/admin-vs-AI decisions live there.
- The **conversation lock** (`bot/conversation-lock.ts`) is keyed per chat (`group:<id>` / `private:<id>`) and serializes **only** the AI turn (`handleAiTurn`). Persistence and command handling run *outside* the lock and are not serialized.
- **Private chat is effectively admin-only**: non-admin private messages are neither persisted nor able to trigger AI. Non-admin group members must `@bot` *and* `cfg.ai_allow_group_mention_from_non_admin===true`.
- `handleAiTurn`: `buildAiRuntimePreview` (assembles history + tools + group context + system prompt + request body) → `ai.chat(...)` with a tool-call callback → `parseAiReplyDirective` → `conversationStore.appendTurn` → send.

### AI subsystem (`lib/server/ai/`)
- `provider.ts` defines the `LLMProvider` interface (~16 methods). `getProvider(cfg)` in `chat.ts` is the factory seam — but it **ignores `cfg` today and always returns `GeminiProvider`**; the `ai_provider` config field is not yet wired up. Adding a provider = new `ai/<vendor>/` folder + one line in `getProvider`.
- `chat.ts` is the provider-agnostic multi-round tool loop: HTTP retry (408/429/5xx + Retry-After), per-round `sanitizeModelReply`, tool-call dedup by stable-stringified args, bounded rounds/calls. `chat()` returns `null` for several distinct cases (disabled / HTTP exhausted / thought-leak repair exhausted) and can return a `fallbackToolMessages(...)` string on tool-loop exhaustion — a non-null string is not always model prose.
- `sanitize.ts` is the **thought-leak defense**: detects leaked chain-of-thought and degenerate JSON fragments in visible text; `chat()` retries once with `THOUGHT_LEAK_REPAIR_PROMPT` when blocked (only when no function call that round).
- Gemini specifics live in `ai/gemini/` (`provider`, `request`, `response`, `image`). Default model `gemini-3.5-flash`; gemini-3 family uses `thinkingLevel`, others use `thinkingBudget`.

### AI tools (`lib/server/bot/tools/`)
- **One router for all tools**: `executeGroupManagementTool(name, args, ctx)` in `management.ts` — despite the name, it routes `qq_read_image` and the memory tools too (early-returns before the admin gates). Adding a tool means editing **both** `declarations.ts` (schema) and the switch in `management.ts`.
- Tools are **conditionally declared** via `ToolDeclarationOptions` (`imageReadEnabled`/`memoryEnabled`/`memberListEnabled`/`managementEnabled`), computed from config + context (admin, bot role, group) in `preview.ts`. If a flag is off the model cannot even request the tool.
- The 6 mutating management tools (whole-ban / mute-all / unmute-all / mute / unmute / kick) are **double-gated**: requester is admin **and** bot's own role is owner/admin in that group, **and** the admin's *current* message matches the confirmation regex `hasExplicitManagementConfirmation` (`确认执行|操作|禁言|解禁|解除禁言|踢出|移出|开启全员禁言|关闭全员禁言|全员禁言`). The prompt *and* this regex backstop both enforce it — paraphrases do not satisfy the gate. `qq_get_group_members` is admin-gated but not confirmation-gated.
- **Image side-channel**: tool results carry image bytes under `INTERNAL_INLINE_PARTS_FIELD = '__ai_inline_parts'` (defined in both `bot/types.ts` and `ai/types.ts` — keep in sync). `splitToolResponse` strips it from the functionResponse JSON and re-adds the bytes as sibling `inline_data` parts. Putting images anywhere else loses them.
- **On-demand vs automatic images** (deliberate): automatic inline images cover only the *current* message and (if `ai_group_context_include_quote`) its quoted/replied message. All other historical group images are referenced by `image_key` text only — the model must call `qq_read_image` to actually see them.

### Storage (`lib/server/store/`)
- Dual backend: **SQLite (default)** or legacy JSON. Both structurally implement `IMessageStore`/`IConversationStore`/`IMemoryStore` from `interfaces.ts` — there is **no `implements` clause**; conformance is by matching exported function names, so renaming an export silently breaks the contract.
- **Backend is chosen by `process.env.QQ_BOT_STORE_BACKEND`, not `config.json`** (the `store_backend` field in config is cosmetic). Default `sqlite`; only the literal string `'json'` selects JSON. `store/index.ts` reads env directly (not via `config.ts`) to avoid a circular import.
- `messageStore`/`conversationStore`/`memoryStore` are **Proxies that re-read the env on every property access** (so tests can flip backends post-import). **Never destructure** a store method (`const { addMessage } = messageStore` pins one backend) — always call `messageStore.addMessage(...)`.
- Only messages/conversations/memories are dual-backend. **Image cache (`data/images/` + `index.json`) and sessions (`data/sessions.json`) are always JSON** via `json-store.ts`, regardless of backend, and the migration script does not touch them.
- SQLite schema is `CREATE TABLE IF NOT EXISTS` inside `db.ts` `runMigrations` — **no version table, no ALTER path**. Additive column changes are picked up on next `getDb()`; non-additive changes need a manual DB delete or migration script. Connection is a process-wide singleton (WAL, `busy_timeout=5000`, `synchronous=NORMAL`).
- `getConversationKey` returns `group:<id>` / `private:<id>` — this string is the join key across `conversation_turns` and `memories`; changing the format orphanates all history. Memory `id` is unique only within a `conversation_key` (composite key).
- Image-cache key is `sha256("file:"+record.file)` by default, with a `sha256("url:"+url||raw)` fallback when `record.file` is missing (`cacheKeyForRecord` in `image-cache.ts`). The file-based key exists because QQ URLs carry an expiring rkey — the same image in two messages shares one cached file.
- Image fetch is SSRF-hardened: host-suffix allowlist (`QQ_BOT_IMAGE_ALLOWED_HOSTS`) + DNS private-IP check re-validated on every redirect hop. `QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH=1` only widens.

### Config & secrets
- Runtime config lives in **`config.json` (gitignored)** — never commit it, logs, or `data/`. `config.ts` exports `DEFAULT_CONFIG` (the full field catalog), `loadConfig()` (merges file over default, normalizes system prompt, **writes DEFAULT_CONFIG on first boot**), `saveConfig()` (drops legacy `auto_reply`/`reply_text`).
- Env precedence: `QQ_BOT_PANEL_USERNAME` / `_PASSWORD` / `_SESSION_SECRET` override `config.json`, which overrides defaults. `.env` is loaded by `env.ts` on import but only fills vars not already in `process.env`.
- The panel receives a **desensitized** config (`sanitizeConfigForClient`): `ai_api_key` is blanked and replaced with `ai_api_key_configured` / `_last4`; `panel_password`/`session_secret` are stripped. Don't assume the key round-trips through `PUT /api/config`. That endpoint also rejects an `ai_api_key` equal to the panel password (browser-autofill guard) and requires `ai_base_url` to be an absolute http(s) URL.
- CSRF is enforced by `verifyStateChangingOrigin` (Origin-header allow-list on state-changing methods) alongside the lax-sameSite session cookie.

### Panel (`app/`, `lib/api/`, `lib/shared/`)
- React 19 + React Router 7 + Tailwind 4 (`@tailwindcss/vite`). shadcn/ui (`components/ui/*`, `radix-nova` style) imported via the `@` alias = repo root (set in `vite.config.mjs`). `cn()` lives in `lib/utils.ts`. A second custom UI layer sits in `components/UI.tsx` (`Card`/`EmptyState`/`Loading`/`ErrorBox`/`PageHeader`/`PanelHeader`/`useToast`).
- Auth is **session-cookie based** (`qqbot.sid`, `FileSessionStore` over `data/sessions.json`, httpOnly, sameSite lax, 1-day). `App.tsx` boots with `api.getMe()`; `ProtectedRoute` gates every route except `/login`. The axios client uses `withCredentials` and its response interceptor **returns `response.data` directly** — typed helpers resolve to `Promise<T>`, not an `AxiosResponse`; code expecting `.data` on the result will break. 401 → redirect to `/login`.
- `lib/shared/types.ts` is the **single contract** imported by both `lib/api/client.ts` (return types) and `lib/server/api.ts` (response shapes). Changing a response shape means editing `types.ts` and both sides. `lib/shared/system-prompt.ts` holds `DEFAULT_AI_SYSTEM_PROMPT` + `normalizeSystemPrompt` (legacy-prompt migration via content heuristics — a customized prompt that starts with the default opener can be silently reset).

## Load-bearing invariants (do not break casually)
- `bot-core.ts` and `ai.ts` are re-export facades — don't move logic back into them; extend `bot/` and `ai/`.
- Store backend selection is **env, not config**; store singletons are Proxies — call methods on the object, never destructure.
- SQLite schema is additive-only (idempotent `CREATE TABLE IF NOT EXISTS`).
- Conversation-key format ties messages ↔ turns ↔ memories.
- The conversation lock serializes only `handleAiTurn`, per chat key — not globally, not persistence.
- Mutating management tools require the literal `确认…` phrase in the same message (regex backstop in `permissions.ts`).
- `executeGroupManagementTool` routes **all** tools; keep declarations + switch in sync.
- `INTERNAL_INLINE_PARTS_FIELD` must stay identical in `bot/types.ts` and `ai/types.ts`.
- The model's reply must never echo internal speaker labels — group history prefixes the *user* turn with `${name}(QQ:${id}) 说：` but the assistant side is never prefixed (documented inline in `ai-turn.ts`).

## Conventions
- 2-space indent, single quotes, semicolons (enforced by `eslint.config.mjs`).
- Server modules are ESM (`import`/`export`) under NodeNext resolution — **relative imports carry explicit `.js` extensions** even though the source is `.ts` (e.g. `'../../store/index.js'`). TypeScript project is split: `tsconfig.json` (server + scripts + tests) vs `tsconfig.app.json` (app + components + `lib/api` + `lib/shared`).
- Filenames: React components PascalCase; helpers/stores kebab-case.
- Logging: `installServerLogger()` monkey-patches `console.*` to add Beijing timestamps and mirror to `logs/server.log` (20 MB / 5-backup copytruncate rotation). Use the established prefixes — `[BotCore]` `[AI]` `[ToolAudit]` `[WS]` `[ImageCache]` — with `duration_ms`, conversation key, `message_id`, and compact JSON summaries.
- Adding a panel page: create `app/pages/<Page>.tsx` **and** add it to both the nested `<Routes>` in `app/App.tsx` and `navItems` in `app/layouts/MainLayout.tsx`.
- Commits: short imperative subjects (e.g. `Sanitize public repo configuration`).
