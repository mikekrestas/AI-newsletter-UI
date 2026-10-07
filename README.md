# Signal — personal AI newsletter reader

Signal 1.8 reads newsletters from your **AI Newsletters** Gmail label and generates a short daily AI news report. The hosted version works in a phone browser with your PC switched off.

Already deployed? Follow [UPGRADE.md](UPGRADE.md) to move to Git updates while preserving your existing `wrangler.json`, Google client ID and report cache. The repository tracks `wrangler.example.json`; your active deployment configuration stays local and ignored by Git.

## Publish to your free Cloudflare account

1. Clone this repository and open a terminal in its folder, which contains `package.json`. First-time hosted setup creates `wrangler.json` from `wrangler.example.json`; for an existing deployment, copy your existing `wrangler.json` into the clone and follow UPGRADE.md.
2. Open a terminal in that folder. Use Node.js 22 or later, then run:

   ```sh
   npm install
   npm run setup:hosted
   ```

3. Paste the **public Google OAuth client ID** already in Signal's Settings. Do not paste a client secret or password.
4. Sign in to your existing Cloudflare account in the browser that opens. The script creates one private KV namespace and publishes the website, Worker and AI binding together. If Cloudflare asks you to choose a workers.dev subdomain, choose one. Keep the account on the **Workers Free plan**; no custom domain is required.
5. Copy the resulting `https://signal-ai-newsletters.…workers.dev` origin. In **Google Auth Platform → Clients → your existing Web application client → Authorised JavaScript origins**, add that exact HTTPS origin and save. Keep `http://localhost:3000` too if you use local preview. This temporary popup flow needs no redirect URI. Persistent sign-in adds the redirect URI documented below. Google changes may take a few minutes.
6. Open the resulting website on your phone, tap **Connect Gmail**, and use **Daily brief**. You don't need to enter the OAuth ID again on each device. You can bookmark it or use your browser's Add to Home Screen.

Only **michaelkrestas1@gmail.com** can generate or retrieve reports. The page shell and fictional demo are public; your Gmail and saved reports require an authenticated owner session or the temporary Google access token. Sign in through Safari/Chrome directly rather than an embedded browser inside another app. If Google sign-in is blocked, allow popups for this website.

## Persistent sign-in

Signal 1.6 can restore your Gmail account after refreshing, closing a tab or restarting the browser. Gmail access is refreshed on the server, with access/refresh tokens encrypted using AES-GCM in the existing private KV. The browser gets a Secure, HttpOnly, SameSite=Lax session cookie; JavaScript and local storage never receive those credentials. Disconnect deletes that browser's server session and cookie while leaving other devices connected.

One-time activation on your existing deployment:

1. In Google Auth Platform → Clients → your existing Web application, add **Authorised redirect URI** `https://signal-ai-newsletters.ai-newsletter-ui.workers.dev/api/auth/callback`.
2. Run `npm run setup:session` in your repository. Wrangler asks for that client's **client secret** and stores it as `GOOGLE_CLIENT_SECRET`; the script creates `SESSION_ENCRYPTION_KEY` if absent. Existing encryption keys are preserved. Secrets never go in app Settings, chat or Git.
3. Run `npm run deploy`, refresh the website and connect once. Existing `wrangler.json` and the report cache are preserved.
4. Google External / Testing normally expires Gmail offline grants after seven days. Switch Google Auth Platform → Audience → Publishing status to **In production**, then reconnect to obtain a new grant if you need long-lived access. Personal unverified applications may still show Google's warning screen; the Worker continues to restrict access to its owner.

Google can still revoke/expire grants, and clearing cookies signs out that browser. The cookie lasts up to a year and is renewed when the app restores a session; server sessions renew during access-token refresh, so regular use remains connected. Until activation, the existing temporary sign-in remains available and Settings links to the setup guide.

If Google rejects sign-in, check the named error on the callback page. For `invalid_client`, compare the public `clientId` at your hosted `/api/config` endpoint with the Google Web application that supplied your client secret. The deployed ID comes from `wrangler.json`, not browser Settings. If it differs, update `vars.GOOGLE_CLIENT_ID` in that local file and deploy. Update the matching secret with `npx wrangler secret put GOOGLE_CLIENT_SECRET` from the same repository folder; Wrangler updates that Worker's live secret. Do not share secrets or paste the full OAuth callback URL, which contains a one-time login code. Start a new Connect Gmail attempt after each change. `redirect_uri_mismatch` identifies the callback registration; `invalid_grant` during initial login requires a fresh login rather than reloading the callback.

## Daily briefs

Reports use **Europe/London** dates, including daylight saving, so travel doesn't change which emails belong to a day. Generation reads every page of emails in the selected day and the full body of each edition, including read or locally dismissed newsletters. Long editions are processed in sections. Each provider gets the same maximum candidate budget before comparing the whole day. The editor ranks consequential releases/availability/pricing changes, credible research, material policy/safety decisions and substantial new capabilities above routine tutorials, minor tool lists, promotions, opinion and isolated experiment details. It merges shared stories, keeps supporting facts and caveats with their parent story, and produces zero to six highlights within 180 words. Quiet days get fewer highlights, without a provider quota or filler.

Final output is structured as headline, complete explanation and article reference. The server checks sentence endings, duplicate article/story entries, word limits and reference validity. A malformed or one-provider draft gets one editorial review against all candidates. A failed repair is not saved. These checks enforce format and sourcing; model-generated importance judgements and facts still need normal reader judgement.

Finished reports are stored for **30 days** and appear on your other devices after connecting Gmail. Generate again to include emails received after the previous report; an unchanged set of bodies uses the cached report without another AI call. Reports are generated on demand, not by a scheduled background job. Opening a hosted Daily brief also checks all labelled emails for the selected day without fetching bodies or using AI. The coverage panel shows available providers and flags editions absent from a saved report. **Source editions** always lists every email processed, rather than only those cited in the highlights. If only one labelled edition is found, the app explains that the Gmail label and arrival date need checking. This is a newsletter digest, not an independent web-news search. Saving a brief doesn't mark Gmail messages read. Read/saved/dismissed edition progress is local to each browser.

Generation shows **Collecting → Evaluating → Reporting → Complete**. Collection reflects actual email reads; the server streams section evaluation, provider consolidation, report writing/review and saving. The bar represents stage progress rather than a time estimate and reaches completion only after the saved report arrives. Cancellation and quota errors stop the bar without claiming completion. Unchanged days can complete immediately from cache.

Each numbered highlight has a green headline, short explanation and publisher/destination label. The entire card opens its specific article URL in a new tab and supports touch/keyboard navigation. URLs come from sanitised newsletter headings, prose links or plain-text editions; the model cannot invent one. Internal source keys never appear as visible citation codes. An edition lacking any extractable article link is flagged and remains readable in Source editions; its unlinked stories cannot be included as direct-article highlights.

Older saved reports remain readable with citation codes hidden and visibly clipped fragments omitted. They are marked for **Regenerate daily brief** so selection and complete direct links are rebuilt with the new pipeline; reading them does not consume AI quota. A new generation scrolls its finished stories into view and respects reduced-motion preferences. The unused sidebar slogan has been removed.

The reader uses one card per newsletter section, with green linked article titles and their following text together inside it. Publisher heading structure also helps identify new section names. The close button stays visible while the email scrolls, and clicking/tapping the shaded space outside the card closes it. There is also a Close edition button at the bottom and Escape works on a keyboard.

## Reading and filtering

Connect and Refresh load every page from the last seven **London calendar days**, alongside the first page of older mail and saved editions. Refresh preserves older editions already loaded, bypasses browser response caches, and shows loading/completion or an error; a failed collection keeps the previous list. A safety limit stops periods exceeding 1,000 emails rather than displaying a partial recent collection. Daily briefs retain their separate 300-edition limit.

Catch up shows today's received total separately from the unread list, explaining editions hidden by local read/dismissed state or source filters. **View all editions in Archive** opens the full loaded list. These hidden editions still enter a daily brief for their arrival date. Refresh also rechecks the selected daily brief's saved report and coverage, without fetching bodies or invoking AI; generate again to incorporate missing editions.

DAIR.AI LinkedIn editions are identified from sender, subject and preview metadata, including the **Top AI Papers of the Week** / **Top ML Papers of the Week** newsletter titles. This metadata parsing is shared by the reading list and daily collection. Other LinkedIn newsletters remain separate. Every edition must still carry the configured Gmail label; Signal does not import unlabelled mail or fetch the full text of a LinkedIn article from the web. If a LinkedIn email contains only a teaser, that email text is the material available to the summariser.

Every edition card can be clicked/tapped to open the reader, with its native title button providing keyboard access. Save, Dismiss and other action controls remain independent.

Catch up groups editions by newsletter. Selected filters have stable provider colours: TLDR blue, TLDR AI violet, TLDR Dev teal, AlphaSignal amber and DAIR.AI rose. Other/new newsletters receive a stable colour automatically. Click TLDR AI, AlphaSignal or any other source chip to select it, then select more chips to combine newsletters. Click a selected chip to remove it; **All** resets the filter. Selections persist in that browser for the connected account. New sources appear automatically as their labelled messages are loaded; **Load more newsletters** fetches older editions. Counts and filtering apply to the editions currently loaded, with Catch up limited to the last seven days and unread, undismissed editions.

Saved and Archive keep their own lists. Daily briefs read every newsletter for the selected day, regardless of the Catch up filter. On phones, the reading-view dropdown replaces the horizontal navigation and stays visible while scrolling; source chips scroll horizontally and reader controls remain visible while scrolling.

## Costs and limits

The app uses one **Cloudflare Worker with static assets**, **Workers AI** (`@cf/meta/llama-3.1-8b-instruct-fp8`) and **Workers KV**. No Supabase, OpenAI/Gemini paid API key, paid hosting, or local model is required. It is designed for personal use within Cloudflare's free quotas. Workers AI currently includes **10,000 neurons/day** on the Free plan; if a free quota is exhausted the service stops and shows an error. There is no paid fallback. Do not upgrade to a paid plan if you require a strict zero-cost setup. Free tiers and model availability can change.

To bound one request, generation accepts at most 300 editions, 512 KB of JSON and 28 initial text sections (roughly 126,000 characters), with at most 36 AI calls. Larger days stop explicitly rather than silently omit later articles. A normal newsletter day should be much smaller. Cloudflare KV uses eventual consistency, so a newly generated report may take around a minute to appear on another device.

Official references: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Privacy and authentication

Google's Gmail read-only permission covers the mailbox; Google cannot grant access to only one label. The app requests the configured label. Persistent OAuth uses a server-side code exchange with state validation and PKCE, verifies the Gmail owner, and stores only encrypted credentials in KV. The browser holds an opaque HttpOnly cookie. Temporary connections keep their token in session memory; no credentials are written to browser storage. The backend ignores client-supplied email identities and checks the Gmail profile against the configured owner. It refuses requests from other website origins and doesn't enable CORS.

Generating a report sends the selected newsletter text to **Cloudflare Workers AI**. Report records contain only the finished digest, its source metadata (including article references), date and a fingerprint in private KV. Persistent sign-in uses separate encrypted session records and short-lived OAuth state records in that same private namespace. It doesn't log newsletter bodies or tokens, and Workers observability is disabled. Cloudflare still processes requests under its own policies; [its AI data policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/) says input/output are not used to train models without explicit consent. No analytics, tracking pixels, remote email images or newsletter scripts are loaded by the reader.

Persistent sign-in automatically refreshes expired access tokens. Temporary popup connections require reconnection after token expiry. OAuth Testing grants expire under Google's rules; use Production status for lasting offline access. This personal app does not claim Google verification or support public accounts.

## Later updates

After merging a pull request, run `git pull`, `npm install` and `npm run deploy` in your repository clone. The ignored `wrangler.json` holds your public client ID and KV namespace ID; keep it when updating. Do not replace it with the placeholder example for an existing deployment. No Google origin change is needed if the website URL stays the same. All browser module imports and CSS use the release version as well as cache revalidation. The loaded release appears in the footer on desktop and phone; verify **Signal 1.8** after deploying.

## Local preview and verification

`npm start` serves the reader at [http://localhost:3000](http://localhost:3000), including demo and Gmail reading. Cloud AI generation needs the deployed site. `npm run dev:hosted` is an advanced Worker preview; Workers AI still needs a Cloudflare login and uses remote quota, so it is not an offline AI preview.

```sh
npm run check
npm run test:worker
npx wrangler deploy --dry-run
```

Browser regression tests under `tests/` use Playwright supplied separately (not shipped as an app dependency). They mock Google and AI to test full-day pagination, source coverage, safe output, touch/backdrop dismissal, mobile layout, cache loading and errors. Live cloud AI output and Google OAuth on your final origin need a final check after you deploy.
