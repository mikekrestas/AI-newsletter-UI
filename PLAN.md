# Signal 1.7 decisions

Audience: Michael's personal Gmail account (michaelkrestas1@gmail.com). Operating cost: stay within Cloudflare's Free plan; no paid AI API or local PC dependency.

## Architecture

One Cloudflare Worker serves the static phone-friendly reader and a private daily-brief endpoint. Gmail remains the source of newsletter content. Persistent hosted sign-in exchanges an OAuth authorisation code on the Worker using state, PKCE and the client secret. It verifies the Gmail owner, stores credentials encrypted with AES-GCM in KV and gives the browser an opaque Secure/HttpOnly/SameSite session cookie. Gmail requests are proxied through the same Worker and expired access tokens refresh automatically. The temporary Google Identity token flow remains available until persistent sign-in is configured. The backend verifies the owner with Gmail's profile endpoint before any AI or private cache access. Cloudflare Workers AI generates the report; KV stores completed summaries and source metadata for 30 days. No Supabase or relational database.

Raw newsletter bodies are not persisted. Persistent credentials live only in separate encrypted session records; no access/refresh token is exposed to browser JavaScript or local storage. Read, saved, dismissed and source-filter progress stays in each browser. Hosted public OAuth configuration means a new phone browser does not need manual client-ID entry. The app works with the PC off.

## Daily flow

Connect Gmail → Daily brief → pick a London-calendar date → read all full newsletter bodies for that day → process every section → rank and combine the main developments into zero to six complete linked highlights → validate and save the finished report privately. A cached report appears on other connected devices. Generate again to include later arrivals; unchanged bodies and summariser version avoid a new AI call. Reports do not change Gmail or local read state.

All provider candidates get the same maximum budget before cross-provider selection, to avoid weighting long emails or frequent senders more heavily. Selection uses concrete novelty, practical impact and credible evidence; repeated stories are merged. A first draft citing at most one provider gets one additional editorial review. The 36-call ceiling and free-quota stop remain in place.

Actual article URLs are extracted from sanitised headings, prose and plain-text editions. The model returns structured headlines, explanations and article keys; URLs are resolved only from supplied references. Each new highlight must have a valid article URL, complete explanation and unique article/headline, within 180 words overall. Supporting facts and preliminary/unreleased caveats stay with their parent story. Invalid output gets one repair; a failed repair is never cached. Missing article links are flagged rather than invented. Legacy reports remain readable with evaluator codes hidden and clipped fragments omitted, and a regeneration notice requests the new editorial version. Whole highlight cards open the article; the sidebar slogan is removed and manual generation scrolls to finished stories with reduced motion respected.

Collecting is driven by actual email reads. A streamed response reports evaluation/comparison, writing/editorial review and final saving; the frontend bar shows four named stages and only completes when the saved report arrives. No job queue or extra polling service is introduced. Cancelled streams do not persist a partial report.

## Reader and navigation

Flatten nested email layout tables safely. Group each newsletter section into a card, containing green linked article titles followed closely by their text. Infer additional section names using publisher heading hierarchy. Article headings have no individual surrounding box. Scroll the email inside a fixed shell: the close button stays visible, the surrounding backdrop closes on touch/click, and a close button is also available at the end.

Whole edition cards open the reader using a stretched native title-button target. Save/Dismiss/Restore remain independent; empty action-row space still opens the edition. CSS and all browser imports carry a release version, and the loaded release is visible on both phone and desktop.

Desktop navigation remains in the sidebar. Phone navigation uses a native view selector with counts. Catch up groups editions by newsletter and offers combinable source chips, discovered dynamically from loaded messages. Filters persist per account/browser and affect Catch up only. Selected sources use stable provider colours. Older editions can be loaded without resetting the selection. Source filtering does not restrict daily report generation.

Opening Daily brief checks every labelled edition for the selected date using metadata only. Available provider counts are shown separately from the saved report's processed editions. Later arrivals omitted from a saved report are flagged without an AI call, and a one-edition day points users to Gmail labels and arrival dates.

## Deferred

Multiple users, scheduled generation, full reading-progress sync, topic filters, reading LinkedIn articles beyond the notification email, and a custom domain. No cron, paid database, payment integration or paid fallback. Session storage reuses the existing private KV and requires two Worker secrets, rather than adding a new service.

## Owner update

The app is deployed at https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/. The owner holds the existing authenticated Cloudflare setup and Google client ID. The repository ignores wrangler.json and tracks a placeholder wrangler.example.json instead. The owner copies the existing configuration once into a Git clone, then uses git pull, npm install and npm run deploy. See UPGRADE.md. The existing Google origin remains valid; persistent sign-in additionally requires the /api/auth/callback redirect URI and the one-time setup:session script. Google Testing offline grants normally expire after seven days, so lasting access requires Production OAuth status and a new connection. The Google client secret and encryption key stay out of Git.

## Verification

Syntax checks, nineteen backend tests and Chromium desktop/phone browser regressions cover OAuth state/PKCE, encrypted credentials, owner enforcement, refresh/revoked grants, logout/CSRF, real report streams/cancellation, browser-restart persistence, whole-card controls, source validation, private cache, legacy reports, safe citations, bounded reference catalogues, balanced provider selection, structured-output repair, duplicate/fragment/link rejection, quiet days, stale report notices, full-day pagination, provider colours, dynamic filters, fixed reader controls and touch dismissal. The maths-manuscript regression tests complete stories, citation cleanup and exact article navigation by mouse, touch and keyboard. A real TLDR layout check covers section hierarchy. Wrangler deployment dry run checks the Worker bundle and asset bindings. Physical Safari and live Cloudflare AI output require a check on the owner's deployed site; tests mock Google/AI and do not consume AI quota.
