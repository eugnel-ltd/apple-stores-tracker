# Parity

Compare the price of one **exact** Apple configuration across 15 official Apple Store
markets, converted to pounds, with tourist tax-refund estimates and price history.

Live at [apple-price-tracker.eugnel.com](https://apple-price-tracker.eugnel.com).

Independent, and not affiliated with Apple.

## How it gets prices

Categories, families and configuration options are discovered from Apple's store each
day: the store front supplies categories, each category listing supplies families, and
each select page supplies options and Apple's own product name. New departments and
products need no code change. Compile-time tables only provide fallbacks when discovery
fails or an older snapshot has no stored catalogue.

Apple ships two kinds of product selector, and the scraper handles both:

**Build-to-order** (every Mac). The select page carries the option matrix but no prices
for upgrades. Prices come from Apple's own configurator endpoint:

```
GET https://www.apple.com{market}/shop/api/cto/update-config
      ?collection=MAC_MINI_2026_COLLECTION&fae=true&sv.<dimension>=<value>…
```

It needs no session and returns the selected build's price plus every option's delta from
it. Those deltas are additive — with 16GB selected, 24GB reads `+200`; select 24GB and the
base rises by exactly 200 while the storage deltas stay put — so

```
price(configuration) = base + Σ delta
```

and **one request yields a chip variant's entire matrix**. A Mac mini's 84 configurations
cost three requests, not eighty-four.

**Catalogue** (iPhone, iPad, Watch, Vision, AirPods, displays, TV & Home). A fixed set of
SKUs whose prices are already embedded in the select page, so pricing a market is one
request per family. Dimensions that never change the price — colour, almost always — are
collapsed, so 21 iPhone SKUs become 7 configurations. The verdict is one verdict for the
whole catalogue: a finish Apple charges for in any market is carried in every market,
since the market that charges would otherwise key its machines unlike the rest and drop
out of the comparison entirely.

`apple.com/robots.txt` disallows only `/*shop/browse/overlay/*`; these paths are permitted.
The scraper identifies itself, runs three requests at a time, and shares one cool-off
across all workers when Apple answers a burst with HTTP 541.

## How it runs

One Cloudflare Worker serves the site, the API and the MCP endpoint. It reads; it does not
collect. A GitHub Action walks Apple's stores once a day and publishes the result.

```
GitHub Action (daily) ─► collect 15 markets x 2 stores  (~1,245 requests)
                         collect refurbished stock      (6 requests)
                         publish ─► KV  snapshot, rates, refurbished listings
                                    D1  the prices that changed

Worker (per request)  ─► KV + D1, edge-cached
```

Collection used to run on the Worker's own cron, in tiers, a batch at a time. It never
once completed a pass. Parsing a store page costs about **1.8ms of cold CPU** — measured
end to end through the real parsers on live pages, not fixtures — so a full sweep of
~2,750 page reads needs roughly **five CPU-seconds**. A free plan's scheduled worker gets
10ms per invocation, which across 480 invocations a day is **4.8 CPU-seconds**, and only
if every one is packed exactly to the ceiling. Packed that tightly they are killed
mid-step, and a killed invocation never reaches the line that advances the cursor, so the
sweep retries the same step forever.

The gap is in total daily budget, not in any one inefficiency, so no amount of tuning
closes it. A runner has no such ceiling: the same scraper, unchanged, walks everything in
one pass of a few minutes. `scripts/collect.ts` and `scripts/publish.ts` are what the
Action runs, and what you run by hand.

The cold cost is worth understanding, because it is not uniform. Native V8 primitives
barely notice a cold isolate — `indexOf` goes 0.09ms cold to 0.07ms warm, `JSON.parse`
0.37 to 0.07. A hand-written character loop goes **5.03ms cold to 0.09ms warm**, because it
starts in the interpreter and only tiers up after thousands of iterations. A short-lived
isolate that parses six pages and exits pays interpreter prices for its whole life. This is
also why the *read* path is fine on the same plan: serving the snapshot is KV's native JSON
decode and `JSON.stringify`, with almost no interpreted JavaScript between them.

**Rates** are not collected on a timer either. The feed publishes when its next quote is
due, so the Worker re-reads it on the request path the first time someone asks after that
moment, serving the quote it already holds and replacing it behind the response.

**KV** holds the snapshot — one blob, read on every request, cached at the edge. At 16,592
offers it is 8.6MB packed, and 0.16MB over the wire: the data is repetitive enough that
compression does the work a smaller payload would.
**D1** holds history, and only rows that *changed*: Apple prices barely move, so writing
every configuration every day would be ~90k rows to record that nothing happened.

`GET /api/status` reports what is published and when it was collected.

## Second-hand

The **Second-hand** tab prices the same configuration used, from Apple's own refurbished
store — returned and repaired machines Apple has restored, sold with the full warranty.
Nothing else free was usable: CeX's API is behind a bot challenge, Back Market's
robots.txt disallows the paths its own site calls, and eBay wants a registered key. The
refurbished grid needs none of that, comes from an origin already handled politely here,
and ships the whole category in one page — six requests for the entire catalogue, against
~1,245 for a price sweep.

Only the UK is collected. A refurbished unit is one physical machine in one warehouse, so
unlike a list price it does not generalise across markets.

It is also the only second-hand source here. CeX, Back Market, musicMagpie, Amazon Renewed
and CamelCamelCamel were each probed and each either blocks automated clients or disallows
the paths its own site calls; eBay publishes an API for it and wants a registered key.
`docs/second-hand-sources.md` records what was found, so the question does not have to be
re-derived.

The comparison is the delicate part, because the grid's facets and our configuration
dimensions overlap without either containing the other. A match pins every facet both
sides name, then checks the processor against the listing's own title — the facets do not
carry the chip, so an M5 and an M5 Pro of the same size and storage look identical there.
What is left unpinned is reported rather than glossed: Apple's Mac select pages carry no
storage or memory, so a 13-inch MacBook Air configuration matches refurbished units of
every capacity, one of which costs a thousand pounds more than the new machine it sits
next to. The page shows the gap either way and says plainly when the two prices are not
the same machine.

The tab answers two questions, not one with a fallback: what this machine costs used, and
what the one before it costs. The second is usually the only one with an answer. Apple
discontinues a model the day it announces its replacement and a returned unit takes months
to come back, so a machine on sale now has barely been resold — today Apple has no
refurbished iPhone 17 and eighteen iPhone 15s.

A unit is only offered as the earlier generation if it can prove it is behind the
configuration by Apple's own numbering, either the grid token (`iphone15` against family
`iphone-17`) or the chip (M4 against M6), so the label is never a guess and the search can
never reach forward. Only the nearest generation is shown: Apple stocks 15s alongside 16s,
and listing both under one heading would put two machines behind one price range. That
generation is chosen before the build is matched, not after — picking it afterwards names
the nearest generation that happened to stock your build, and offered a 256GB iPhone 15 as
the model before an iPhone 17 while the 16 sat beside it.

That proof needs a generation on both sides, and half the catalogue has neither: Apple's
buy page sells no chip dimension for a Watch, an iMac or an iPad Air, and the grid's token
carries a screen size rather than a generation, so `ipadair_11` reads as generation 11. So
`REFURB_MODELS` declares both — which generation Apple sells now, and whether a listing
writes its own in the token (`watchseries11`) or in the chip named by its title. **When
Apple ships a new Watch series or iPad chip, update `generation.now` for that family.** It
is read as a floor rather than a fact, so a missed update degrades quietly: Apple never
refurbishes a machine newer than the one it sells, so a newer unit on the shelf is proof
the declaration has been overtaken and the shelf wins.

Before this, those families could never show an earlier generation at all, and every unit
Apple had was shown as the current one — a Series 11 was priced from Series 9 stock, and
an M3 iPad Air was quoted as the M4 on sale beside it.

Storage and memory are the one concession. Apple's refurbished shelf holds whatever came
back, so demanding an exact build made the earlier-generation comparison a lottery: one
Mac Studio was in stock and only the two configurations wanting its 96GB/1TB build could
see it — 33 of 306 configurations across the catalogue, against 127 now. The same build is
still preferred and the shelf is only widened when Apple has none of it; when that
happens the page names the difference and draws no gap bar, because £2,500 more for a
bigger machine is not a verdict on second-hand value. Screen size, connectivity and case
size stay strict: a 13-inch iPad Air is not an earlier 11-inch one.

An empty panel says which silence it is. Apple had no refurbished Mac mini of any
generation the day this shipped, which is a different thing from having units that none of
your configuration's specifications can be shown to match.

Education prices come from Apple's parallel `/<market>-edu` store. Only one market's
education price can apply to any one buyer, since you can only be a student in one
country, so the site adds a second row for the market you claim rather than quietly
substituting the number. iPhone is skipped there: it has no education price, and Apple
answers `541` for it — the same status it uses for throttling — so asking costs six
retries per family per market and yields nothing.

Exchange rates come from `open.er-api.com` (keyless, daily, and it says when the next
quote lands). Of the free keyless feeds, only it, FloatRates and a jsDelivr-hosted mirror
cover every currency here — the ECB feeds, and anything built on them, have no TWD.

Genuinely intraday rates are available free (Coinbase quotes every currency here and moves
within a minute), and are not used. The three dedicated feeds disagree with each other by
about 0.5% on the thinner pairs — more than a day of intraday movement — so a tick-by-tick
number would buy precision the underlying data does not have, on a page comparing list
prices that move a few times a year. The quote time is shown in the footer instead.

## Development

```bash
npm install
npm run ci                             # governance contract, all tests, production build
npx jiti scripts/collect.ts uk us jp   # authorised live collection into data/snapshot.json
npm run dev                            # Vite serves that file as /api/snapshot
```

`scripts/collect.ts` is the collector the daily Action runs, driven from a terminal. Omit
the market arguments to sweep all 15 (about half an hour, deliberately paced), then
`scripts/publish.ts` pushes the result to KV and D1. Live collection is not
part of normal tests or CI.

The publish guard accepts Apple's line-up changes and retirements for families collected
without errors, logging count changes over 10%. Families with errors must retain at least
90% of their combined published offers; without error reporting, that rule covers the
whole catalogue. Every collection must retain at least 50% overall and all published
markets. Published offers are counted after collapsing unpaid dimensions, so duplicate
finishes do not look like missing machines. A refused run leaves the previous snapshot
in place.

Development follows the repository-owned AI-native SDLC in [`AGENTS.md`](AGENTS.md), with
the full operating model in [`docs/agents/ai-sdlc.md`](docs/agents/ai-sdlc.md). The default
is one owner, one branch, one PR, proportionate evidence, exact-head review where model
judgement matters, and autonomous merge/cleanup when the task and repository permissions
authorise it. Governance/documentation-only Markdown changes skip dependency installation;
every other change runs the complete fixture-backed tests and production build.

## Deploying

```bash
npx wrangler kv namespace create PRICES
npx wrangler d1 create price-history
# put both ids in wrangler.jsonc
npm run db:migrate
npm run release -- --apply
```

Releases go through `npm run release`: the default is a dry run of preflight and
release evidence; `npm run release -- --apply` also deploys, checks health and rolls
back a failed release when its deployment identity is proved. Set `AI_SDLC_DIR` to
an unmodified checkout of `eugnel-ltd/ai-sdlc` at tag `v3`. The command requires a clean
checkout of current `origin/main`, release level 3 or higher and green enforcement,
and checks every first-parent commit since enforcement turned green, including the
transition commit. Apply also requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The custom domain is declared in `wrangler.jsonc`; Wrangler creates the DNS record in the
`eugnel.com` zone on first deploy.

This runs on the **Workers free plan**, and now stays inside it: the Worker only reads.
Publishing needs a Cloudflare API token with *Workers KV Storage: Edit* and *D1: Edit*,
held as the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. The
scraper's own `RequestBudget` still paces collection — a runner has no subrequest cap, so
it exists there to be polite to Apple rather than to fit a platform limit.

## For agents

`POST /mcp` is a stateless Streamable HTTP MCP server with three read-only tools:
`list_catalog`, `list_product_configurations`, `compare_prices`. Setup notes live at
`/agents`, and a plain-text summary at `/llms.txt`.

## A caution about the numbers

Prices are official list prices, and everything else is an estimate. US prices exclude
sales tax. Refund figures assume you qualify for a scheme, meet its minimum spend and
deadlines, and accept the operator's fee. Warranty terms, keyboard layouts, plug types and
stock differ by market, and bringing hardware home may attract import duty. A £300 gap on
this page is not £300 in your pocket.
