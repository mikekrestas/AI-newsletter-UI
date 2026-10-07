# Update your existing hosted Signal app through Git

Signal 1.5 is maintained in the GitHub repository. Future changes can be reviewed and merged as pull requests, then pulled into your local clone.

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

Every full edition is read during generation, including read/dismissed emails and sources hidden by Catch up filters. All provider candidates receive an equal maximum budget before final comparison. Selection prioritises concrete new developments, practical impact and research evidence, merges duplicate stories and excludes adverts. A one-provider draft gets an extra review of the other providers. Source editions lists all processed emails; inline links identify sources for selected highlights.

If the panel itself finds only one labelled edition, check the other newsletters' AI Newsletters label and their arrival date. Weekly newsletters and emails from earlier dates are not included in today's digest.
