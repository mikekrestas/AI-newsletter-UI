# Working on Signal

These instructions apply throughout this repository. Keep lasting project rules here; record history, current release status and outstanding checks in HANDOFF.md.

## Start here

- Read README.md, UPGRADE.md and HANDOFF.md before substantial work. PLAN.md explains the original architecture.
- Check the current branch, working tree and relevant PRs. The handoff is a dated snapshot, not proof of the current deployment.
- Track every item in the user's request. Give useful progress updates, and finish by stating what changed, what was verified and anything left incomplete with its reason.
- Continue routine authorised implementation without repeated permission questions. Raise material ambiguity or blockers promptly.

## Product constraints

- Signal is a personal AI newsletter reader and concise daily digest, used primarily through a phone browser while travelling.
- Preserve the zero-cost design: free Cloudflare Worker/static assets, Workers AI and existing KV. No paid API, paid hosting, paid fallback or dependence on a local PC/model.
- Keep the implementation simple: vanilla browser modules, HTML/CSS and the existing Worker. Do not add a framework, Supabase, database or service without a concrete need and agreement on scope.
- Gmail is the source of truth for newsletters. Read the configured AI Newsletters label with Gmail read-only access; never modify mailbox messages or labels.
- Keep hosted Gmail/report access restricted to the configured owner. Public page/demo content must remain fictional.
- Use Europe/London calendar dates, including DST, consistently across devices. Travel must not change which emails belong to a report.
- Reading, saved/dismissed editions and source filters are browser-local. Reports and encrypted sessions are hosted. Do not claim all state syncs across devices.

## Important code

- public/app.js and public/index.html: UI state, navigation, edition cards and report generation.
- public/style.css and public/reader-updates.css: baseline and responsive reader/report styling.
- public/gmail.js: Gmail clients, session restoration and streamed report events.
- public/reader.js: sanitised email rendering, section grouping and article extraction.
- public/brief.js and public/dates.js: complete daily collection and London dates.
- public/report.js, public/progress.js and public/sources.js: report cards, real stage progress and provider identity/colours.
- summary.mjs: candidate extraction, editorial ranking and structured output validation.
- worker.mjs and auth.mjs: authenticated APIs, cache, OAuth and encrypted sessions.
- scripts/: initial hosting/session setup. tests/: backend and browser regressions.

## Daily brief requirements

- Collect every page and full edition for the selected day, including read/dismissed emails and providers hidden by Catch up filters. Never silently truncate coverage.
- Compare all providers fairly; equal candidate budgets do not imply a quota of highlights from each provider.
- Prioritise consequential releases, availability/pricing changes, credible research, material policy/safety changes and substantial capabilities. Exclude adverts, routine filler and detached experimental statistics.
- Keep supporting details with their parent story. Preserve caveats such as internal, unreleased or preliminary; write complete, concise explanations.
- Each new highlight must resolve to its specific article URL from supplied references. Never invent a link or substitute an unrelated article.
- Do not display internal A/E reference keys. Keep the entire highlight card accessible and clickable, with a green article headline and readable explanation.
- Treat model output as untrusted. Validate structure, references, length, duplicates and obvious fragments before caching; failed repairs must not become saved reports.
- Flag editions without extractable article URLs and keep them readable in Source editions. Allow quiet days with fewer or no significant highlights.
- Preserve explicit quota/request limits, cache fingerprints and legacy regeneration notices. Opening a saved report must not automatically spend AI quota.
- Structural validation does not independently fact-check news or guarantee importance judgements. Describe verification honestly.

## UI regressions to preserve

- Verify phone and desktop layouts, touch targets, keyboard navigation, focus, reduced motion and horizontal overflow.
- Group email content by newsletter section, keeping linked article headings with their following text; do not box every heading separately.
- Reader close controls stay visible; backdrop click/tap, Escape and the bottom Close edition control work even with long emails.
- Entire edition cards open the reader; Save/Dismiss/Restore controls remain independent.
- Keep mobile navigation usable while scrolling, and provider filters dynamically composable with stable distinct selected colours.
- Progress reflects real collection/server stages, not an invented countdown. Cancellation/errors stop progress; completion means the saved report arrived.
- When changing browser release assets, update imports/styles consistently and the visible release marker so stale modules do not conceal fixes.

## Configuration and security

- Preserve the ignored active wrangler.json, existing Worker name/KV binding and deployed secrets. wrangler.example.json contains placeholders and must not replace an existing deployment's configuration.
- Never commit or print client secrets, encryption keys, access/refresh tokens, session cookies, private newsletter bodies or full OAuth callback URLs. Callback URLs can contain a one-time code.
- Google client IDs are public, but credentials must match the same Google Web application and the correct deployed Worker.
- Preserve the existing SESSION_ENCRYPTION_KEY during ordinary upgrades. Rotating it invalidates encrypted sessions.
- Retain state/PKCE validation, encrypted KV credentials, opaque Secure/HttpOnly cookies, owner verification, same-origin protection and the allowlisted read-only Gmail proxy.
- Do not promise permanent login: Google grants can expire/revoke and cookies can be cleared. Google Testing grants normally expire after seven days.

## Git and release workflow

- Work in repository branches and create reviewable PRs; do not deliver replacement ZIPs.
- The user reviews and merges PRs. Do not merge or deploy production unless requested. Merging GitHub code alone does not update Cloudflare.
- Finish the implementation and checks before opening the PR. Describe the final behaviour and material verification limits.
- Normal owner release: git pull, npm install, npm run deploy from the correct clone with its existing wrangler.json, using Node.js 22 or later.
- setup:hosted and setup:session are initial activation steps, not routine release steps. Never recreate namespaces or auth secrets just to update UI code.

## Verification

- For code changes run npm run check and relevant backend checks (npm run test:worker), plus browser suites appropriate to changed behaviour.
- Browser suites import Playwright separately; PLAYWRIGHT_MODULE, CHROMIUM_PATH and READER_URL can configure the environment. Do not add Playwright to production dependencies just to run these tests.
- Reproduce requested UI behaviour in the browser, including a narrow phone viewport. Add meaningful regression coverage for substantive bugs rather than tests that merely mirror implementation.
- For documentation-only changes, check accuracy, links, formatting and git diff; application tests need not be repeated solely for prose edits.
- Distinguish mocked Google/AI tests, viewport simulation, dry-run builds and real production validation. Do not claim live OAuth, actual inbox quality or physical-device testing without evidence.
- Do not run npm audit fix --force blindly; inspect advisories and assess changes separately.
