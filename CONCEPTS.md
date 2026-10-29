# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Catalogue and identity

### Category
One department in Apple's store, discovered from the store front each day. Known shop
aliases share a stable category id so a renamed department keeps its history and URLs;
an unfamiliar shop slug introduces a category automatically.

### Family
One product line Apple sells through a single buy-flow — iPad Pro, MacBook Air, Apple Watch Ultra. A family is the unit of collection and the unit a reader chooses on the site. Families are discovered from each category listing each day and named from Apple's select-page titles. Categories, families and options all follow Apple's current store; compile-time tables are fallbacks for failed discovery or older snapshots.

Apple presents a family's options in one of two shapes, and the distinction decides how it is priced. A **catalogue family** offers a fixed set of stocked SKUs whose prices are already on the select page. A **build-to-order family** offers a configurator: prices come from a pricing request per chip or model variant, and each option is quoted as an amount added to that variant.

### Dimension
One selectable hardware option of a family — storage, connectivity, memory, finish — carried as a field, a value, and the human label the market's own page gives it.

Only dimensions someone actually pays for take part in a configuration's identity. A choice whose every option costs the same is not a specification, and carrying it would multiply the catalogue while telling a reader nothing; a choice that moves the price anywhere is carried everywhere, because a dimension kept in one market and dropped in another would make the same machine unrecognisable between them. A dimension a given product does not offer at all is absent, which is not the same as an option costing nothing.

### Configuration
One exact combination of a family's dimensions — the machine a reader is comparing. Identified across markets by its config key.

### Config key
The stable, market-independent identity of a configuration: its dimensions sorted and joined. This is the join column of the whole site — a comparison row is one config key priced in every market, price history is keyed on it, and the API answers by it.

Its shape is decided once for the whole catalogue and never re-derived from an individual market's page. A market that computes a key no other market computes has no cell in any row, and that absence renders as an ordinary product fact rather than as an error, so the failure is silent.

### Offer
One configuration priced in one market, at one store: the local amount and currency, the part number when the build is stocked, and the page the price was read from. An offer is what collection produces and what the comparison ranks.

## Where prices come from

### Market
One of Apple's regional online stores that the tracker prices, each with its own currency and its own path on Apple's site. Markets are compared against each other; that comparison is the product.

### Store
Which of Apple's two storefronts in a market quoted a price: the retail store, or the education store that market runs in parallel. A store is a distinct price identity for the same configuration, never a discount applied to a retail row — the two prices appear side by side, or the education one does not appear at all.

### Collection
One pass over every family, in every market, at both stores, producing a snapshot. Collection runs outside the serving path, on a schedule, and reports a family it could not read as an error rather than abandoning the pass.

### Snapshot
Everything one collection produced: the offers, the families that failed, and when it ran. A snapshot is published whole and replaces its predecessor whole. The publish guard requires families with collection errors to retain at least 90% of their combined published offers; clean families can change shape or retire. Without error reporting, the 90% rule covers the whole catalogue. Every collection must retain at least 50% overall and all published markets, so a silent parser failure cannot empty the site. Published counts first collapse unpaid dimensions, so comparisons count machines rather than duplicate finishes. Clean family counts moving by more than 10% appear in the publish log.

### Price point
One recorded observation that a configuration cost a given amount, in one market at one store, on one day. Price points are what the charts read and the only history the project keeps.

Only first sightings and actual changes are recorded: a day on which nothing moved writes nothing, because recording every configuration every day would say "unchanged" tens of thousands of times over. A configuration that disappears from the catalogue is left alone rather than recorded as zero — absence is not a price. Because a price point is identified by its configuration, a configuration that re-keys starts a fresh history and its earlier points become unreachable.

## Absence

### Not sold, no answer
The two reasons a market can show no price for a configuration, which must never render alike. **Not sold** is a fact about Apple's catalogue: the market does not list this configuration. **No answer** is a fact about us: the page for that family did not answer when prices were collected, so whether it is sold there is unknown.

Rendering the second as the first is how a broken collection reads as a product fact, and it is why unknown, empty and failed are kept as three separate states throughout.
