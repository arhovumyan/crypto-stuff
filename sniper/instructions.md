“very strict” means your bot will touch very few launches, but the ones it does touch will be the ones with the best survivability signals.

Below is a strict rule set + the full decision pipeline you can hand to an engineer.

Strict sniper profile (0.2 SOL, launch detection, Jupiter route, private send)
Goals

Minimize rugs / sell-block / fake liquidity traps

Accept missing many winners

Only trade launches that look like they have “real” liquidity + early organic flow

1) Strict entry gates (must-pass)
Gate A — Liquidity must be meaningful

Pass only if SOL liquidity ≥ 75 SOL at time of detection

If < 75 SOL: skip
Rationale: tiny pools are where most rugs and “fake momentum” happen.

Also require stability:

Observe liquidity not being removed for at least 20 seconds

If liquidity changes downward materially during this window: skip

Gate B — Mint authority revoked

mintAuthority == null or “revoked”
If not revoked: skip

Gate C — Freeze authority revoked

freezeAuthority == null
If freeze exists: skip

Gate D — Route sanity (Jupiter)

Only enter if Jupiter returns a route that satisfies all:

Route is SOL → Token (no weird starting asset)

Route uses at most 2 hops

Quote price impact ≤ 6%

Estimated slippage requirement ≤ 3% (otherwise skip)

If Jupiter can route but needs huge slippage: skip.

Gate E — Round-trip simulation (hardest gate, most important)

You must simulate:

Buy: 0.2 SOL → token

Sell: received token → SOL

Requirements:

Sell simulation must succeed

Round-trip loss (beyond normal fees) must be small

Strict threshold:

Implied “tax/penalty + hidden restrictions” ≤ 8%

If sell returns significantly less than expected (or fails): skip

This is your main defense against:

blacklist tokens

transfer delays

“can buy but can’t sell” traps

Gate F — Early flow must look organic

Within the first 30 seconds after first swap, require:

≥ 10 swaps total

≥ 7 unique wallets

No single wallet accounts for > 35% of buy volume in that window

If it’s just 1–2 wallets farming volume: skip.

Gate G — Holder concentration (strict)

Compute top holders (exclude pool vaults and known program accounts).

Pass only if:

Top 1 holder ≤ 20%

Top 5 holders ≤ 45%

Top 10 holders ≤ 60%

If too concentrated: skip.

(Yes, this will skip many early winners — that’s intended.)

Gate H — Launch-source hygiene (strict optional)

If you can identify the launch source:

Prefer reputable patterns (real SOL pools, known programs)

Skip unknown pairing patterns and “fake pairs”

If you can’t identify source reliably: do not block solely on this, but keep strictness elsewhere.

2) Execution rules (strict)
Entry size

Always exactly 0.2 SOL

Never average down on launches

Slippage

Default: 2%

Allow up to 3% only if liquidity is very strong (≥ 150 SOL)

If required slippage > 3%: skip.

3) Private send + fees (strict but realistic)
Priority fees policy (simple)

Entry: “high”

Exit: “medium”

If a tx fails due to congestion:

bump fee once and retry

if fails again: abort trade (don’t chase)

Private sending (bundle path)

Send through a private/bundle route where possible to reduce exposure to public propagation and sandwiching.

Even with private send:

you can still get outbid

you can still get bad fills in chaos

So you also enforce the price impact and slippage gates above.

4) Exit strategy (strict, safer)

Because you’re strict, you’re optimizing for “don’t get rugged,” not max upside.

Default exit plan

Take profit quickly:

Sell 40% at +40% (1.4×)

Sell 30% at +80% (1.8×)

Sell 30% with a trailing rule OR time stop

Stop / kill rules

Hard stop: exit if price drops -20% from entry (or if quotes deteriorate)

Time stop: if not up at least +15% within 3 minutes, exit

Emergency exit immediately if:

liquidity removal detected

sell simulation starts failing

Jupiter route becomes unavailable or requires > 5–6% slippage

Strict bots survive by exiting early.

5) Decision pipeline (engineer-ready)

Event: pool init / liquidity add detected

Wait 20s stability window

Fetch pool SOL liquidity

if < 75 SOL → reject

Fetch token mint info

mintAuthority null? else reject

freezeAuthority null? else reject

Observe early swaps window (30s from first swap)

swaps ≥ 10 and unique wallets ≥ 7

no dominant wallet

Holder concentration check

top1/top5/top10 thresholds

Jupiter quote

hops ≤ 2, price impact ≤ 6%, slippage ≤ 3%

Simulate buy and sell

sell must succeed

implied penalty ≤ 8%

Build swap tx

attach compute + priority fee

Send privately/bundle

Confirm fill → start exit state machine

Log every rejection reason.

6) Strict “touch rate” expectation

With these settings, you’ll likely trade:

only a tiny fraction of launches

but your average trade quality is much higher

That’s what “very strict” means.