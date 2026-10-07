# Signal — personal AI newsletter reader

Signal 1.5 reads newsletters from your **AI Newsletters** Gmail label and generates a short daily AI news report. The hosted version works in a phone browser with your PC switched off.

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
5. Copy the resulting `https://signal-ai-newsletters.…workers.dev` origin. In **Google Auth Platform → Clients → your existing Web application client → Authorised JavaScript origins**, add that exact HTTPS origin and save. Keep `http://localhost:3000` too if you use local preview. No redirect URI is needed. Google changes may take a few minutes.
6. Open the resulting website on your phone, tap **Connect Gmail**, and use **Daily brief**. You don't need to enter the OAuth ID again on each device. You can bookmark it or use your browser's Add to Home Screen.

Only **michaelkrestas1@gmail.com** can generate or retrieve reports. The page shell and fictional demo are public; your Gmail and saved reports require your Google access token. Sign in through Safari/Chrome directly rather than an embedded browser inside another app. If Google sign-in is blocked, allow popups for this website.

## Daily briefs

Reports use **Europe/London** dates, including daylight saving, so travel doesn't change which emails belong to a day. Generation reads every page of emails in the selected day and the full body of each edition, including read or locally dismissed newsletters. Long editions are processed in sections. Candidates are consolidated into the same maximum character budget for each newsletter provider, before comparing all providers. The editor prioritises concrete new developments, material impact on AI users/builders, credible research evidence and useful capabilities; adverts, repetition and sender prominence do not increase priority. It merges shared stories into 4–6 brief highlights when enough meaningful news exists, aiming for no more than 180 words. A draft that cites at most one provider gets one editorial review against the other providers' candidates. A short digest prioritises the main news rather than preserving every detail. Sources remain available below it.

Finished reports are stored for **30 days** and appear on your other devices after connecting Gmail. Generate again to include emails received after the previous report; an unchanged set of bodies uses the cached report without another AI call. Reports are generated on demand, not by a scheduled background job. Opening a hosted Daily brief also checks all labelled emails for the selected day without fetching bodies or using AI. The coverage panel shows available providers and flags editions absent from a saved report. **Source editions** always lists every email processed, rather than only those cited in the highlights. If only one labelled edition is found, the app explains that the Gmail label and arrival date need checking. This is a newsletter digest, not an independent web-news search. Saving a brief doesn't mark Gmail messages read. Read/saved/dismissed edition progress is local to each browser.

Reports display numbered highlights instead of raw Markdown bullets. Green linked phrases open the original article in a new tab; when only an edition reference is available, they open that newsletter inside Signal. Links resolve against article URLs extracted from the emails, rather than URLs invented by the model. Existing saved reports also get the new styling; generate once again to add inline citations to a report made with an older version.

The reader uses one card per newsletter section, with green linked article titles and their following text together inside it. Publisher heading structure also helps identify new section names. The close button stays visible while the email scrolls, and clicking/tapping the shaded space outside the card closes it. There is also a Close edition button at the bottom and Escape works on a keyboard.

## Reading and filtering

Catch up groups editions by newsletter. Selected filters have stable provider colours: TLDR blue, TLDR AI violet, TLDR Dev teal, AlphaSignal amber and DAIR.AI rose. Other/new newsletters receive a stable colour automatically. Click TLDR AI, AlphaSignal or any other source chip to select it, then select more chips to combine newsletters. Click a selected chip to remove it; **All** resets the filter. Selections persist in that browser for the connected account. New sources appear automatically as their labelled messages are loaded; **Load more newsletters** fetches older editions. Counts and filtering apply to the editions currently loaded, with Catch up limited to the last seven days and unread, undismissed editions.

Saved and Archive keep their own lists. Daily briefs always include every newsletter for the selected day, regardless of the Catch up filter. On phones, the reading-view dropdown replaces the horizontal navigation; source chips scroll horizontally and reader controls remain visible while scrolling.

## Costs and limits

The app uses one **Cloudflare Worker with static assets**, **Workers AI** (`@cf/meta/llama-3.1-8b-instruct-fp8`) and **Workers KV**. No Supabase, OpenAI/Gemini paid API key, paid hosting, or local model is required. It is designed for personal use within Cloudflare's free quotas. Workers AI currently includes **10,000 neurons/day** on the Free plan; if a free quota is exhausted the service stops and shows an error. There is no paid fallback. Do not upgrade to a paid plan if you require a strict zero-cost setup. Free tiers and model availability can change.

To bound one request, generation accepts at most 300 editions, 512 KB of JSON and 28 initial text sections (roughly 126,000 characters), with at most 36 AI calls. Larger days stop explicitly rather than silently omit later articles. A normal newsletter day should be much smaller. Cloudflare KV uses eventual consistency, so a newly generated report may take around a minute to appear on another device.

Official references: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Privacy and authentication

Google's Gmail read-only permission covers the mailbox; Google cannot grant access to only one label. The browser requests the configured label. Access tokens remain in session memory, are sent to the backend to verify ownership with Gmail, and are never saved to browser storage or KV. The backend ignores client-supplied email identities and checks the Gmail profile against the configured owner. It refuses requests from other website origins and doesn't enable CORS.

Generating a report sends the selected newsletter text to **Cloudflare Workers AI**. The application stores only the finished digest, its source metadata (including article references), date and a fingerprint in private KV. It doesn't log newsletter bodies or tokens, and Workers observability is disabled. Cloudflare still processes requests under its own policies; [its AI data policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/) says input/output are not used to train models without explicit consent. No analytics, tracking pixels, remote email images or newsletter scripts are loaded by the reader.

Gmail sign-in is per browser session and needs reconnection when the short-lived token expires. With Google OAuth in External/Testing, Gmail grants generally expire after seven days; re-consent may be needed. This personal app doesn't implement long-lived refresh tokens or claim Google verification for public users. Keep your Gmail address on the Google project's test-user list.

## Later updates

After merging a pull request, run `git pull`, `npm install` and `npm run deploy` in your repository clone. The ignored `wrangler.json` holds your public client ID and KV namespace ID; keep it when updating. Do not replace it with the placeholder example for an existing deployment. No Google origin change is needed if the website URL stays the same. Assets use cache revalidation to avoid stale reader code.

## Local preview and verification

`npm start` serves the reader at [http://localhost:3000](http://localhost:3000), including demo and Gmail reading. Cloud AI generation needs the deployed site. `npm run dev:hosted` is an advanced Worker preview; Workers AI still needs a Cloudflare login and uses remote quota, so it is not an offline AI preview.

```sh
npm run check
npm run test:worker
npx wrangler deploy --dry-run
```

Browser regression tests under `tests/` use Playwright supplied separately (not shipped as an app dependency). They mock Google and AI to test full-day pagination, source coverage, safe output, touch/backdrop dismissal, mobile layout, cache loading and errors. Live cloud AI output and Google OAuth on your final origin need a final check after you deploy.
