# Signal 1.5 decisions

Audience: Michael's personal Gmail account (michaelkrestas1@gmail.com). Operating cost: stay within Cloudflare's Free plan; no paid AI API or local PC dependency.

## Architecture

One Cloudflare Worker serves the static phone-friendly reader and a private daily-brief endpoint. Gmail remains the source of newsletter content. Google Identity Services supplies a short-lived Gmail read-only token to each browser. The backend verifies the owner with Gmail's profile endpoint before any AI or private cache access. Cloudflare Workers AI generates the report; KV stores completed summaries and source metadata for 30 days. No Supabase or relational database.

Gmail tokens and raw bodies are not persisted. Read, saved, dismissed and source-filter progress stays in each browser. Hosted public OAuth configuration means a new phone browser does not need manual client-ID entry. The app works with the PC off.

## Daily flow

Connect Gmail → Daily brief → pick a London-calendar date → read all full newsletter bodies for that day → process every section → combine the main developments into 4–6 short highlights → save the finished report privately. A cached report appears on other connected devices. Generate again to include later arrivals; unchanged bodies avoid a new AI call. Reports do not change Gmail or local read state.

All provider candidates get the same maximum budget before cross-provider selection, to avoid weighting long emails or frequent senders more heavily. Selection uses concrete novelty, practical impact and credible evidence; repeated stories are merged. A first draft citing at most one provider gets one additional editorial review. The 36-call ceiling and free-quota stop remain in place.

Actual article URLs are extracted from the sanitised newsletters. The server gives the model short reference keys alongside article titles and stores the corresponding source metadata. The renderer resolves citations only against those references. An edition reference opens its newsletter inside Signal when an article URL is unavailable. Previously saved plaintext reports remain readable and acquire the new highlight styling; generating again adds citations.

## Reader and navigation

Flatten nested email layout tables safely. Group each newsletter section into a card, containing green linked article titles followed closely by their text. Infer additional section names using publisher heading hierarchy. Article headings have no individual surrounding box. Scroll the email inside a fixed shell: the close button stays visible, the surrounding backdrop closes on touch/click, and a close button is also available at the end.

Desktop navigation remains in the sidebar. Phone navigation uses a native view selector with counts. Catch up groups editions by newsletter and offers combinable source chips, discovered dynamically from loaded messages. Filters persist per account/browser and affect Catch up only. Selected sources use stable provider colours. Older editions can be loaded without resetting the selection. Source filtering does not restrict daily report generation.

Opening Daily brief checks every labelled edition for the selected date using metadata only. Available provider counts are shown separately from the saved report's processed editions. Later arrivals omitted from a saved report are flagged without an AI call, and a one-edition day points users to Gmail labels and arrival dates.

## Deferred

Multiple users, scheduled generation, full reading-progress sync, topic filters, reading LinkedIn articles beyond the notification email, and a custom domain. No cron, refresh-token store, payment integration or paid fallback.

## Owner update

The app is deployed at https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/. The owner holds the existing authenticated Cloudflare setup and Google client ID. The repository ignores wrangler.json and tracks a placeholder wrangler.example.json instead. The owner copies the existing configuration once into a Git clone, then uses git pull, npm install and npm run deploy. See UPGRADE.md. No Google origin change is required.

## Verification

Syntax checks, ten backend tests and Chromium desktop/phone browser regressions cover source validation, private cache, legacy-report compatibility, safe inline citations, bounded reference catalogues, balanced provider selection, stale single-source reports, metadata-only freshness checks, full-day pagination, provider colours, dynamic source filters, fixed reader controls and touch dismissal. A real TLDR layout check covers section hierarchy. Wrangler deployment dry run checks the Worker bundle and asset bindings. Physical Safari and live Cloudflare AI output require a check on the owner's deployed site; test runs use mocked Google/AI and do not consume AI quota.
