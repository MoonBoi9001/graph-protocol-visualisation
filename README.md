<img width="3456" height="1916" alt="image" src="https://github.com/user-attachments/assets/e8f0871f-3a04-4457-9954-bb9195b17524" />


# Graph Protocol Contract Map

**The entire Graph Protocol as one interactive map you can click into.** Staking,
payments, the subgraph service, issuance, the recurring agreement manager —
instead of reading across dozens of Solidity files to see how they connect, you
get every contract on one screen and can drill into any of them to read what its
functions do, who can call them, and what they emit.

No build, no server, no dependencies: grab
[`graph-protocol-map.html`](graph-protocol-map.html) and double-click it.

> Built to help people ramp up on the protocol. The data reflects the GIP-0088
> testnet branch (Arbitrum Sepolia, chain 421614).

## What you can do

- **Open any contract** — its read / write / event functions, each expandable to
  show the contract's own NatSpec description, every parameter and return, and
  who's allowed to call it.
- **See the roles** — contracts with on-chain roles get a tab listing each role,
  who administers it, and the exact functions it gates, cross-linked both ways.
- **Hover a type** — `bytes16`, `uint8`, `address` explain themselves: what they
  are, how many values they hold, and their range. (`bytes8` → "2^64 ≈ 1.8 ×
  10^19 values, `0x00…00` to `0xff…ff`".)
- **Simulate a transaction** — click a write function and particles flow only to
  the contracts it actually calls, while the event stream shows the events it can
  emit. Both are parsed from source, so the animation reflects *that* function.
- **Find anything** — search contracts, functions, events, and descriptions;
  resize the panel and stream; clear the stream between runs.

## Running it

It's entirely client-side.

- **Just open it:** double-click `graph-protocol-map.html` — the data is inlined,
  so it runs straight from disk.
- **Dev version:** `index.html` loads `data.js` next to it. If your browser
  blocks `file://` script access, serve the folder over HTTP (for example
  `python3 -m http.server`).

## Where the data comes from

`build-data.js` generates everything from the source of truth, not by hand:

- **Signatures** — verbatim from the compiled ABIs.
- **Descriptions, params, returns** — the contracts' own NatSpec (`@notice` /
  `@dev` / `@param` / `@return`).
- **Roles, access, and each function's emits and calls** — parsed from the
  Solidity, following internal helper calls so a function that works through
  private helpers still reports what they do.

It runs inside The Graph's contracts monorepo, which it needs for the compiled
artifacts and sources; `data.js` and `graph-protocol-map.html` are the portable
outputs it writes.

## Notes

- The simulation shows the events a function *can* emit across all code paths,
  not which fire for a given input — some only happen on certain branches.
- The addresses shown are public Arbitrum Sepolia testnet deployments.
- Licensed **GPL-3.0-or-later**, matching the Graph contracts the data derives
  from.
