# Update your existing hosted Signal app through Git

Signal 1.7 is maintained in the GitHub repository. Future changes can be reviewed and merged as pull requests, then pulled into your local clone.

## Release 1.7

Daily briefs now contain complete, ranked stories with a direct article URL on every new highlight. Whole highlight cards open the article, and internal citation keys are hidden. The editor prioritises material releases, research and policy/tool changes; supporting statistics stay with their story rather than becoming filler bullets. The server validates structured output and allows one repair before refusing an incomplete report. News without an extractable article link is flagged instead of receiving an invented or unrelated URL.

After merging, use the normal Git pull/install/deploy below. Existing Google setup, Worker secrets and sessions are preserved; no authentication setup rerun is needed. Verify **Signal 1.7** in the footer. Existing saved briefs display a regeneration notice: generate them again to replace the old selection and rebuild article links. The changed summary fingerprint prevents a regeneration from returning the previous cached draft. Merely opening an older report does not use AI quota.

The unused sidebar slogan is removed. New briefs show their linked headline, explanation and publisher/destination, then scroll into view after manual generation, with reduced motion respected. The phone view selector stays visible while scrolling so switching sections does not require returning to the top.

## Release 1.6

The entire edition card now opens the reader; action buttons remain separate. A live stage bar shows Collecting, Evaluating, Reporting and Complete. Provider colours and all browser imports are release-versioned, and the phone/desktop footer identifies Signal 1.6.

After the normal Git pull/install/deploy below, persistent sign-in needs this one-time activation:

1. Add `https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/api/auth/callback` as an **Authorised redirect URI** in your existing Google Web application client. Keep its existing JavaScript origins.
2. Run `npm run setup:session`. Paste that client's secret into Wrangler's prompt when asked. The script stores it securely and creates the session encryption key without replacing an existing key.
3. Run `npm run deploy` and connect Gmail once. Future refreshes/browser restarts restore the saved account; Disconnect removes that browser's session.
4. For long-lived Gmail grants, change Google Auth Platform → Audience → Publishing status to **In production**, then reconnect. Testing mode normally expires offline grants after seven days. Google revocation and cleared browser cookies can still require a new login.

Your active configuration and cache stay in place. No new paid service is added. If persistent sign-in has not been activated, temporary popup connections continue to work and will still require reconnection after refresh; the implementation cannot obtain a refresh token using the old popup-token flow. See [session setup](public/session-setup.html).

## One-time move from downloaded files

After the initial app pull request is merged, open a terminal in your Development folder and run:

```sh
git clone https://github.com/mikekrestas/AI-newsletter-UI.git Signal
cd Signal
```

Copy **only your existing wrangler.json** from the old AI-newsletter-UI folder into this new Signal folder. That file holds the existing Google public client ID, Cloudflare report-cache namespace and Worker name. It is ignored by Git, so future pulls preserve it. The repository's wrangler.example.json contains placeholders and must not replace your active configuration.

Then run:

```sh
npm install
npm run deploy
```

Use Node.js 22 or later. If your Cloudflare login has expired, run `npx wrangler login`, sign in to the same account and deploy again. Existing hosted URL, Gmail origin and saved reports remain the same. No setup rerun or new namespace is needed.

## Later updates

After merging a pull request:

```sh
git pull
npm install
npm run deploy
```

Refresh https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/ on your phone after deployment. GitHub changes reach the live site only after deployment; automatic Git-based Cloudflare deployment has not been configured.

## Daily brief coverage

Opening Daily brief checks all labelled emails received on the selected London-calendar date. A provider panel shows which newsletters are available. If a saved report includes only TLDR but later AlphaSignal or other editions are now available, it shows how many are missing. Generate again to include them. The coverage check fetches metadata only and uses no AI quota.

Every full edition is read during generation, including read/dismissed emails and sources hidden by Catch up filters. All provider candidates receive an equal maximum budget before final comparison. Selection prioritises concrete new developments, practical impact and research evidence, merges duplicate stories and excludes adverts. A one-provider or empty multi-provider draft gets an extra review of the other providers. Source editions lists all processed emails; each new highlight links directly to its matching article.

If the panel itself finds only one labelled edition, check the other newsletters' AI Newsletters label and their arrival date. Weekly newsletters and emails from earlier dates are not included in today's digest.
