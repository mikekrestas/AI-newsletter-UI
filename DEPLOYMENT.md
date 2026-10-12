# Deploy Signal automatically from your phone

After this workflow is merged and the two secrets below are set, every push to main (including a merged PR) runs the checks and deploys the existing signal-ai-newsletters Worker. Reviewing/approving a PR alone does not deploy it. No PC, new hosting service or paid API is required; standard GitHub-hosted runners are free for this public repository.

## One-time setup

1. Open [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens). Choose **Create Token → Edit Cloudflare Workers**. Under **Account Resources**, select **Include → Specific account** and choose the account containing Signal. Create the token and copy it. Use an API token, not the Global API Key.
2. Find that account's **Account ID** in Cloudflare's account/Workers & Pages overview. It is 32 hexadecimal characters; it also appears immediately after dash.cloudflare.com/ in that account's dashboard URL. Copy the account ID, not a zone ID or Worker ID.
3. Open [this repository's Actions secrets](https://github.com/mikekrestas/AI-newsletter-UI/settings/secrets/actions). Choose **New repository secret** for each entry in the table below. Paste the values directly into GitHub, not chat or a committed file.
4. Review and merge PR #8. In [GitHub Actions](https://github.com/mikekrestas/AI-newsletter-UI/actions), open **Deploy Signal** and wait for its green check. Then refresh the hosted app and verify **Signal 1.8** in its footer.

| GitHub repository secret | Value |
| --- | --- |
| CLOUDFLARE_API_TOKEN | The token created in step 1 |
| CLOUDFLARE_ACCOUNT_ID | The account ID copied in step 2 |

Your Google client secret and session encryption key stay on Cloudflare. No Google credentials, KV namespace ID or local wrangler.json need copying into GitHub. Creating these two GitHub secrets is an owner step; the connected GitHub tools cannot set repository secrets for you.

## What the workflow does

The workflow only deploys main in mikekrestas/AI-newsletter-UI. It installs the pinned dependencies with npm ci, runs syntax/backend/deployment checks and invokes npm run deploy:ci. PR checks never receive the Cloudflare credentials or deploy production. Production runs are serialised so overlapping releases do not interrupt each other.

The helper reads the existing Worker's settings through Cloudflare's API. It verifies Signal's owner/client configuration, REPORTS/AI/ASSETS bindings and existing persistent-login secret names before creating an ignored temporary deployment configuration. It reuses the live REPORTS namespace, keeps server variables and relies on pinned Wrangler's secret inheritance. It never creates a namespace, changes the encryption key, copies secret values or overwrites your local wrangler.json. Unexpected bindings stop the release so they cannot be silently removed. The temporary configuration is deleted after success or failure.

## Retry or inspect a deployment

If you add the secrets after merging, or a token has expired, correct them and use **Actions → Deploy Signal → Run workflow → main**. A non-main dispatch is skipped. The successful run is your release confirmation; a GitHub PR check by itself does not prove the site was deployed.

Missing credentials, wrong account/token permissions, missing live bindings or failed tests stop deployment. Settings/API errors do not echo provider response bodies. Check the run log's safe error message and correct the named setup item. Do not rerun initial hosting/session setup or replace the existing cache to resolve a release error.

The normal manual release remains available with git pull, npm install and npm run deploy from your configured clone. Coordinate it with GitHub releases rather than deploying two different commits at once. Initial hosting or intentional Cloudflare/Google configuration changes still use the existing setup instructions; the CI helper is for updating the already-hosted app.

## Validation limits

Deployment tests use simulated Cloudflare settings/credentials and validate the main-only guard, configuration preservation, safe errors and cleanup. A Worker dry run checks the generated configuration/bundle. A real automatic release requires the owner's two GitHub secrets and a main merge/manual run; this workspace has not authenticated to the owner's Cloudflare account.
