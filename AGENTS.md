# Repository Guidelines

## Project Structure & Module Organization

This repository is a single pnpm project for a QQ Bot backend and React admin panel. Keep the root-level functional layout:

- `app/`: React entry, routes, layouts, and pages.
- `components/`: shared UI, including shadcn-style components in `components/ui/`.
- `lib/api/`: browser API client code.
- `lib/server/`: Express API, OneBot WebSocket client, AI logic, stores, config, and runtime paths.
- `styles/`: global Tailwind/CSS entry.
- `scripts/`: operational and debugging scripts.
- `tests/server/`: Node test-runner suites for backend behavior.
- `data/`, `logs/`, `config.json`: local runtime output/config; do not commit secrets or generated data.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies with the pinned pnpm version.
- `pnpm dev`: start Express plus Vite middleware on one port; watches `lib/server` and `.env`.
- `PORT=18001 pnpm dev`: run the same dev server on another port.
- `pnpm server:build`: type-check the TypeScript backend, scripts, and backend tests.
- `pnpm build` or `pnpm panel:build`: run backend type-checking and build the React panel into `dist/`.
- `pnpm start`: run the TypeScript server entry through `tsx`.
- `pnpm test`: run backend tests with `node --import tsx --test tests/server/*.test.ts`.
- `pnpm exec eslint .`: lint JavaScript/TypeScript files using `eslint.config.mjs`.

## Coding Style & Naming Conventions

Use 2-space indentation, single quotes, semicolons, and ES2022 syntax. Backend files are TypeScript while currently preserving CommonJS `require` / `module.exports` compatibility. Prefer clear module names such as `message-store.ts`, `ws-client.ts`, and `api-config.test.ts`. React components use PascalCase; helpers and stores use kebab-case filenames.

## Testing Guidelines

Tests use Node’s built-in test runner with `tsx`. Place backend tests under `tests/server/` and name them `*.test.ts`. Add focused regression tests for API validation, bot safety behavior, AI tool loops, caches, and config loading. Use `/private/tmp` or a configurable temp path for generated test data.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, for example `Sanitize public repo configuration` and `Support multi-round AI tool calls`. Keep commits focused and describe the behavior changed. Pull requests should include a concise summary, test results, linked issue/context when relevant, and screenshots for visible panel UI changes.

## Security & Configuration Tips

Keep credentials in `.env` or ignored `config.json`; never commit real panel passwords, API keys, session secrets, logs, or cache data. When adding new config, document the variable name and safe default in README or `.env.example`.
