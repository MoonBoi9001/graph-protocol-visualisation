<img width="3456" height="1916" alt="image" src="https://github.com/user-attachments/assets/e8f0871f-3a04-4457-9954-bb9195b17524" />


# Graph Protocol Contract Map

An interactive, single-page visualisation of every smart contract in The Graph
Protocol's Horizon upgrade, built to help newcomers ramp up on how the contracts
fit together. It renders each contract as a node in a force-directed map, draws
the value and logic flow between them, and lets you click into any contract to
read what its functions actually do.

The data reflects the protocol as deployed on the GIP-0088 testnet branch
(Arbitrum Sepolia, chain 421614).

## What you can do

Open a contract and you get its full external surface, split into **read**,
**write**, and **event** tabs. Click any function to expand it in place: you see
the contract's own description of it (pulled from the Solidity NatSpec), every
parameter and return value with its own explanation, and who is allowed to call
it. Contracts that use on-chain roles also get a **Roles** tab that lists each
role, who administers it, and exactly which functions it gates — with the two
cross-linked, so you can jump from a function to the role guarding it and back.

Two touches aimed at people new to Solidity:

- **Type explainer.** Hover any type — `bytes16`, `uint8`, `address` — and a
  popover explains what it is, how many values it can hold, and its range. So
  `bytes8` reads as "a fixed 8-byte value, 2^64 ≈ 1.8 × 10^19 possible values,
  `0x00…00` to `0xff…ff`".

- **Transaction simulation.** Click a write function and the map animates what
  that call does: particles flow only to the contracts the function actually
  calls, and the live event stream shows the events it can actually emit. Both
  are parsed from the contract source, so the animation reflects the specific
  function rather than a generic "this contract is busy" effect.

The panel and the event stream are resizable, the stream can be cleared, and
there is a search across contracts, functions, events, and their descriptions.

## Running it

The visualisation is entirely client-side — no build step, no server, no
dependencies.

- **Simplest:** open `graph-protocol-map.html` directly in a browser. The
  contract data is inlined, so it works from a plain double-click.
- **Development:** open `index.html`, which loads the data from `data.js`
  alongside it. Some browsers block `file://` access to sibling scripts, so
  serve the folder over HTTP if the data doesn't load (for example
  `python3 -m http.server` and visit the printed URL).

## How the data is produced

`build-data.js` is the generator. It runs inside The Graph's contracts monorepo
and writes both `data.js` and the self-contained `graph-protocol-map.html`. It
is deliberately grounded in the source rather than hand-authored:

- Function and event signatures come verbatim from the compiled ABIs.
- Per-function and per-event descriptions, parameters, and returns are the
  contracts' own NatSpec (`@notice` / `@dev` / `@param` / `@return`), harvested
  from compiled metadata.
- Roles, access control, the events each function can emit, and the contracts it
  calls are parsed from the Solidity sources — resolved through internal helper
  calls so a function that works via private helpers still reports what they do.
- Contract descriptions and the dependency edges are curated from the same
  NatSpec and the on-chain wiring.

Because it reads the monorepo's compiled artifacts and sources, `build-data.js`
is not runnable on its own; `data.js` and `graph-protocol-map.html` are the
portable outputs it produces.

## A note on accuracy

The simulation shows the events a function *can* emit across all its code paths,
not which fire for a specific input — some only occur on certain branches.
Tracing exactly which events a given call produces would require executing the
contract, which is beyond what this visual model does.

The addresses shown are public Arbitrum Sepolia testnet deployments.

## Licence

Released under GPL-3.0-or-later. The descriptions, ABIs, and behaviour embedded
in the data are derived from The Graph Protocol's contracts, which are
themselves GPL-3.0-or-later.
