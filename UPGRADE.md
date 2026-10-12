# Update your existing hosted Signal app through Git

Signal is maintained in the GitHub repository. Future changes can be reviewed and merged as pull requests, then pulled into your local clone.

For automatic releases after merging to main, follow [DEPLOYMENT.md](DEPLOYMENT.md). It requires only CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub Actions secrets and reuses the live Worker's configuration. Once configured, you can merge/release from your phone without the PC commands below.

## Release 1.8

Daily Brief no longer rejects an entire draft because one item is badly formatted. It recovers complete JSON stories, normalises harmless wrappers/punctuation and removes invalid links/fragments individually. One editorial review retains usable stories if the replacement is malformed. Review prompts stay bounded instead of appending the whole invalid draft.

If the model still cannot write usable explanations, Signal shows a clearly labelled digest of selected original newsletter headlines with their real article links. **Retry AI writing** can explicitly replace that saved headline digest; reading it makes no AI call. Unavailable article references, actual quota errors, collection failures and cancellation still stop safely.

New reports open with **Today, at a glance**: preferably two sentences, maximum three and 80 words, about the day's themes drawn only from the displayed highlights. An invalid/unavailable optional overview uses a grounded headline overview rather than discarding the report. No paid model or service was added; the existing 36-call ceiling includes review/overview work.

After merge, run the normal pull/install/deploy commands below and verify **Signal 1.8** in the phone footer. Existing Google configuration, secrets and sessions need no changes. Regenerate old briefs to get the overview and updated writing pipeline. Production AI output still needs review against your real newsletters after deployment.

The release also supplies a Signal Home Screen icon and the name **Signal AI** for iOS and other mobile browsers. After deploying, remove the existing Home Screen shortcut and add the hosted app again through your browser's **Share → Add to Home Screen** so iOS refreshes its cached icon and name.

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

Refresh https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/ on your phone after deployment. If automatic deployment is configured, wait for the **Deploy Signal** GitHub Actions run instead of running the commands above. Without its two secrets, automatic releases fail with setup guidance and manual deployment remains available.

## Daily brief coverage

Opening Daily brief checks all labelled emails received on the selected London-calendar date. A provider panel shows which newsletters are available. If a saved report includes only TLDR but later AlphaSignal or other editions are now available, it shows how many are missing. Generate again to include them. The coverage check fetches metadata only and uses no AI quota.

Every full edition is read during generation, including read/dismissed emails and sources hidden by Catch up filters. All provider candidates receive an equal maximum budget before final comparison. Selection prioritises concrete new developments, practical impact and research evidence, merges duplicate stories and excludes adverts. A one-provider or empty multi-provider draft gets an extra review of the other providers. Source editions lists all processed emails; each new highlight links directly to its matching article.

If the panel itself finds only one labelled edition, check the other newsletters' AI Newsletters label and their arrival date. Weekly newsletters and emails from earlier dates are not included in today's digest.
