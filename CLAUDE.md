# Blueprint — Engineering Memory

## Project overview
Blueprint is an interactive system-design interview simulator. The product is intended to combine scenario-based interviews, a structured architecture canvas, adaptive questioning, production incidents, and detailed evaluation.

## Architecture
- Next.js 16 App Router with TypeScript.
- Public pages are server components by default, with metadata, sitemap, robots, legal pages, and a custom 404.
- `/interview` is a client component for the interactive canvas prototype.
- Architecture state uses a structured object with nodes (`id`, `type`, `label`, `x`, `y`, `reasoning`, `note`) and edges (`id`, `source`, `target`, `label`).

## Technology decisions
- PostgreSQL is planned as the permanent source of truth.
- Redis is planned for ephemeral interview state and rate limiting, never permanent history.
- LLM providers must be abstracted behind a server-side provider interface; browser code must never receive API keys.
- Deterministic architecture validation must remain separate from subjective LLM evaluation.
- Initial UI uses custom Tailwind-compatible CSS tokens while the project foundation is established; Watermelon UI and Motion Primitives integration remains planned.

## Current implementation
- Greenfield Next.js foundation with strict TypeScript.
- Landing page with a technical architecture preview and primary CTA.
- Scenario selection page with eight initial scenario cards.
- Interactive interview workspace prototype with palette, node selection, structured reasoning, and an interviewer question transition.
- Interactive canvas editing with pointer drag, connect mode, edge labels, duplicate/delete, rename, notes, and local browser draft persistence.
- Deterministic validator and typed `POST /api/architecture/validate` endpoint for broken connections, missing layers, unreachable nodes, single points of failure, and missing justifications.
- Typed interview state machine with phase progression, structured turn validation, adaptive difficulty metadata, and `POST /api/interview/next`.
- Server-only configurable LLM provider boundary with a deterministic mock provider and OpenAI-compatible endpoint support.
- Ollama is supported through its local OpenAI-compatible `/v1` endpoint; browser-native speech synthesis can read interviewer questions aloud without exposing model credentials.
- API routes reject unapproved cross-origin requests, return stable error codes for quota/provider failures, and expose a `/monitoring` page with `/api/monitoring` health data.
- Scenario setup now has a top selector, improved custom problem statement form, and direct custom/predefined interview entry points.
- Canvas nodes now expose an in-place remove control; edge rendering uses an SVG coordinate layer anchored to node centers.
- Interview answers support continuous browser speech recognition after explicit microphone activation, with typed fallback and optional read-aloud.
- Optional server-only Upstash Redis adapter for API rate limiting; local development falls back explicitly unless `REQUIRE_REDIS=true`.
- Typed scenario catalog with custom scenario form flowing into the interview route.
- Basic metadata and environment template.
- Neon project linked to the `production` branch with private `uploads` object storage policy.
- Public route shell for resources, FAQ, contact, privacy, terms, and custom 404.
- Baseline security response headers in `next.config.ts`.

## Completed tasks
- [x] Audit repository (confirmed empty greenfield directory).
- [x] Create Next.js App Router foundation.
- [x] Create initial design language and responsive landing page.
- [x] Create scenario selection route.
- [x] Create first interactive architecture canvas slice.
- [x] Add public route shell, sitemap, robots, and baseline headers.
- [x] Add custom scenarios persistence with user ownership (DB + API + UI).
- [x] Add Qwen provider adapter and LLM provider configuration tests.
- [x] Add richer phase-specific prompts covering all 14 interview phases.
- [x] Add JSON-LD structured data and per-route SEO metadata.
- [x] Add pinch-to-zoom canvas gestures for mobile devices.
- [x] Add ARIA roles and labels for canvas accessibility.

## In-progress tasks
- [x] Add actual pointer drag, edges, rename, duplicate, delete, labels, and notes.
- [x] Persist the current architecture draft to localStorage while server persistence is pending.
- [x] Add deterministic architecture validation separate from LLM evaluation.
- [x] Add validator regression tests.
- [x] Add interview state machine and structured LLM provider contract.
- [x] Add typed predefined scenario catalog and custom scenario entry flow.
- [x] Add optional Upstash Redis rate limiting for architecture and interview APIs.
- [x] Link the Neon project and deploy the private `uploads` storage policy.
- [x] Add Ollama provider configuration and optional interviewer read-aloud controls.
- [x] Add origin-restricted API access, explicit quota/provider errors, monitoring counters, and optional alert webhook delivery.
- [x] Improve scenario setup, in-place node removal, edge geometry, and voice-first conversation controls.
- [x] Add persistent domain model and authenticated user flow.

## Remaining tasks
- [x] Persist custom scenarios and scenario ownership.
- [x] Add first-class Qwen and Ollama provider adapters/configuration tests.
- [x] Persist interview state and answer history server-side.
- [x] Add richer phase-specific prompts and evaluation behavior.
- [x] Production incident prompt and deterministic final evaluation report.
- [x] PostgreSQL persistence, analytics, cookie consent, and server-side authorization.
- [x] Authenticated history/review UI and durable rate-limit monitoring.
- [x] Protect monitoring access with an authenticated admin email allowlist and optional bearer token.
- [x] SEO routes: resources, FAQ, contact, sitemap, robots, JSON-LD, 404.
- [ ] Accessibility, mobile canvas gestures, performance audit, tests, and deployment.

## Important decisions
- Do not claim AI, persistence, security, or legal functionality until it is implemented and tested.
- Public content stays server-rendered; the architecture editor is client-side only where interaction requires it.

## Known issues
- `npm run typecheck` passes after Neon package installation.
- `npm run lint` passes with the Next.js flat ESLint config.
- `npm run build` passes with all current routes statically generated and Neon environment loading enabled.
- `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.
- Authenticated interview turns are persisted server-side; unauthenticated drafts remain local-only.
- Local draft storage is browser-specific and is not a durable account/history solution.
- Incident response is represented as a deterministic evaluation prompt/report; a richer live incident simulator remains optional follow-up work.
- Ollama text generation and browser speech playback are separate layers; microphone transcription and server-side text-to-speech are not implemented yet.
- Monitoring keeps immediate process counters and stores rate-limit/LLM failure events in PostgreSQL for a rolling 24-hour durable view. `ALERT_WEBHOOK_URL` can connect to Gmail through a trusted automation/webhook provider, while direct SMTP delivery remains optional.
- Speech quality depends on installed browser voices. The app selects a natural/neural English voice when available, but browser-native speech cannot guarantee studio-quality audio; a paid neural TTS provider is needed for that.
- The local Ollama API key is empty by design because the configured endpoint is a local Ollama server; Ollama Cloud requires setting `LLM_API_KEY` and a hosted `LLM_BASE_URL` in deployment secrets.
- Neon infrastructure and application tables are provisioned; deployment secrets must be configured in the cloud secret manager.
- UI audit remaining advisory: the detector identifies the intentional architecture-canvas grid background; it remains scoped to the canvas and is not used as a generic page background.

## Testing status
- Last validated: `npm run lint`, `npm run build`, `npm run typecheck`, unit tests, Playwright smoke tests, protected evaluation smoke test, and production dependency audit pass after history/evaluation/monitoring changes.
- Production API smoke test confirmed `POST /api/architecture/validate` returns typed findings and a score.
- `npm run test` passes with validator regression coverage.
- `npm run test:e2e` passes with Playwright Chromium coverage for landing navigation, predefined scenarios, custom scenario creation, canvas node edits, connections, deterministic validation, interview submission, public routes, and custom 404.
- Interview API smoke test confirmed the mock provider returns a validated structured turn.
- Scenario catalog and custom scenario flow are covered by the successful build and typecheck.
- Production `npm audit --omit=dev --audit-level=high` previously reported zero vulnerabilities.
- Playwright is installed as a development dependency; browser binaries are installed locally for the smoke suite.
- Impeccable audit (2026-10-08): desktop/mobile rendered routes had no horizontal overflow, one H1 on public pages, and no unnamed buttons. The mechanical detector reported one advisory for grid-line backgrounds, appropriate to the architecture canvas but worth keeping scoped.
- UI/UX Pro Max guidance applied: interview workspace now has a document H1, skip link, visible keyboard focus rings, semantic connect-mode state, keyboard arrow movement for nodes, 44px toolbar/icon targets, reduced-motion handling, and semantic color tokens.
- Canvas storage UX now supports downloading and importing version-independent architecture JSON backups. This is a transfer/backup path, not server persistence.
- Post-fix browser checks passed at 1440x1000, 375x812, and 812x375 with reduced motion enabled: no overflow, H1 present, focus outline visible, and no button below 44px.
- Architecture backup controls are covered by Playwright: JSON download action produces a user-visible success status.
- Neon setup validation (2026-10-08): authentication, project linking, `neon config init`, private bucket configuration, and `neon deploy` completed successfully.
- Post-Neon checks (2026-10-08): typecheck, lint, unit tests, production build, Playwright smoke tests, and `npm audit --omit=dev --audit-level=high` all pass.
- Ollama/voice checks (2026-10-08): typecheck, lint, and production build pass after adding the local Ollama provider mode and browser speech controls.
- Production runtime smoke check (2026-10-08): `next start -p 3000` serves the app, `/api/monitoring` reports Ollama and Redis configuration, `/monitoring` returns 200, and an unapproved Origin receives 403.
- UX regression checks (2026-10-08): typecheck, lint, build, unit tests, and Playwright smoke tests pass after the scenario, canvas, edge, and voice-first changes.
- Monitoring UI refinement (2026-10-08): replaced the unstyled vertical monitoring stack with a constrained responsive operations dashboard, provider/Redis health chips, metric cards, live status treatment, and durable rolling-counter messaging. Lint, typecheck, and build pass.
- Monitoring readiness view (2026-10-08): `/api/monitoring` reports non-secret readiness checks and rolling 24-hour PostgreSQL-backed failure/rate-limit counts; the UI presents them inside one centered operations console.

## Performance findings
- No Lighthouse/Core Web Vitals audit has been run.

## Security findings
- No secrets are committed. `.env` files are ignored and `.env.example` contains placeholders only. The local `.env` documents all current and planned configuration keys with blank secret values.
- Neon CLI generated local database and object-storage credentials in the ignored `.env`; use deployment secret storage rather than copying them into source control.
- A cryptographically random local `AUTH_SECRET` is present in the ignored `.env`; `.env.example` contains placeholders.
- Authenticated mutation routes still need a dedicated CSRF strategy; API rate limiting and origin checks are implemented.
- Monitoring access is controlled by `MONITORING_ADMIN_EMAILS` for signed-in users; `MONITORING_TOKEN` is available for server-to-server checks.

## SEO status
- Root metadata and canonical configuration exist.
- Sitemap, robots, and core public content/legal routes exist; social image, structured data, breadcrumbs, and canonical metadata per route remain.

## Deployment notes
- Requires Node.js and a deployment platform supporting Next.js.
- Configure `NEXT_PUBLIC_SITE_URL` and server-side LLM variables through the deployment environment.
- For free Redis usage, create an Upstash Redis database and configure `REDIS_REST_URL`, `REDIS_REST_TOKEN`, and optionally `REQUIRE_REDIS=true` in the cloud environment. Never expose these as `NEXT_PUBLIC_*`.
- Neon project `gentle-butterfly-96832144` is linked to `production`; `neon.ts` defines private `uploads` storage and `neon deploy` completed with no pending policy changes.

## Next recommended tasks
1. Configure hosted LLM, SMTP, monitoring token, and cloud secret-manager values before deployment.
2. Consider a richer live incident simulator and expand analytics coverage beyond architecture changes and interview turns.
3. Add a dedicated CSRF token flow if cross-site cookie use is ever enabled; current mutating endpoints enforce configured-origin checks and SameSite cookies.
4. Run Lighthouse performance audit and address Core Web Vitals findings.
5. Add end-to-end tests for custom scenario creation and deletion flow.

## UI decision (2026-10-08)
- The architecture canvas remains the primary work surface, with the stateful AI interviewer, transcript, microphone, captions, and answer controls in a persistent right-side panel.
- The panel stacks below the canvas on narrow screens.
- Component-specific reasoning questions appear contextually beside the selected architecture node.
- Users can answer through voice, compact text input, or the contextual component popup.
- The interview opens with a Blueprint introduction and requirements prompt before progressing through the phases.
- Microphone access requires the browser's one-time permission; continuous recognition restarts while the user-controlled listening session is active and stops on pause, end, or unmount.
- Current UI states include idle, speaking, listening, thinking, processing, component selected, component question active, and user answering.

## Interview Philosophy (2026-10-09)
Blueprint is a conversational system-design interview simulator, not a question-answering form. The interviewer introduces itself, establishes expectations, acknowledges answers, challenges assumptions, remembers prior decisions, adjusts difficulty, transitions topics naturally, introduces incidents conversationally, and closes with feedback before evaluation. The �Next question� button is not the primary interview mechanism.

The interview engine tracks a conversation mode and action-based turns (`acknowledge`, `follow_up`, `transition_phase`, `component_challenge`, `incident`, and `evaluation`) rather than relying on a question index. The UI keeps phase metadata secondary and gives the candidate subtle Skip, Transcript, and End interview controls.
