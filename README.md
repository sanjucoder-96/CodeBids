# CSI CLUB — CODE MARKET

**Round 2 competition platform.** A live coding *market*: teams hold capital, answer technical
challenges, bid real money in live physical auctions for premium questions, and can lose it all on a
wrong answer. Built to run on a **private LAN with the internet physically disconnected**.

```
                        PRIVATE LOCAL LAN
                                |
                       ORGANIZER LAPTOP
                       ----------------
                       Local game server  (Node + Fastify + WebSocket)
                       SQLite database    (single file, WAL)
                       Organizer console  /organizer
                       Projector display  /projector
                                |
                  ------------------------------
                  |            |               |
              Team 01      Team 02   ...    Team N
              (browser)    (browser)        (browser)
```

The server is **authoritative**. Clients never decide capital, bid validity, or ranking. Every
meaningful action follows one path:

```
CLIENT ACTION → SERVER VALIDATION → DATABASE WRITE → REAL-TIME BROADCAST → UI UPDATE
```

---

## Contents

1. [Quick start](#quick-start)
2. [Architecture](#architecture)
3. [How the round works](#how-the-round-works)
4. [Development setup](#development-setup)
5. [Build & commands](#build--commands)
6. [Event-day setup](#event-day-setup)
7. [Running the event](#running-the-event)
8. [Auction operation](#auction-operation)
9. [Reclaim operation](#reclaim-operation)
10. [Configuration](#configuration)
11. [Simulation & rehearsal](#simulation--rehearsal)
12. [Results & export](#results--export)
13. [Emergency recovery](#emergency-recovery)
14. [Troubleshooting](#troubleshooting)
15. [Testing](#testing)
16. [Known limitations](#known-limitations)

---

## Quick start

```bash
npm install
npm run build
node packages/server/dist/index.js --seed 20   # create 20 demo teams, print join codes
npm start                                       # start the server
```

The console prints everything you need:

```
================================================================
   CSI CLUB  -  CODE MARKET   |   ROUND 2   |   OFFLINE LAN MODE
================================================================

   PARTICIPANTS   http://192.168.0.106:4400
   ORGANIZER      http://192.168.0.106:4400/organizer
   PROJECTOR      http://192.168.0.106:4400/projector

   OPERATOR PASSCODE   4821
```

---

## Architecture

Three surfaces, **one bundle, one server, one database**. Participants use a browser — there is no
software to install on 40 student laptops.

```
packages/
├── shared/     Pure domain logic shared by server and clients
│   ├── economy.ts       capital, protected reserve, bid validation, settlement
│   ├── evaluation.ts    the generic challenge engine (all question types)
│   ├── reclaim.ts       the reclaim ladder and its state transitions
│   ├── leaderboard.ts   ranking + Round 3 qualification
│   ├── config.ts        every tunable number in the game
│   └── protocol.ts      the WebSocket contract
│
├── server/     The authority
│   ├── core/engine.ts       the game state machine (all rules live here)
│   ├── core/auction*        auction + premium lifecycle
│   ├── core/simulation.ts   rehearsal / demo driver
│   ├── core/codeRunner.ts   optional local code execution
│   ├── net/hub.ts           WebSocket hub, audience routing, sequencing
│   ├── net/routes.ts        auth, export, backup, health
│   ├── repo/                every SQL statement in the application
│   ├── db/schema.sql        the event database
│   └── content/challenges.ts the fixed 12-question pool
│
└── client/     One React app, three surfaces
    ├── participant/   team client
    ├── organizer/     operator console
    ├── projector/     hall display
    ├── ui/            leaderboard, animated numbers, countdown, overlays
    └── lib/           socket, store, sound, motion, formatting
```

**Why a browser and not Electron.** Electron would mean installing and updating a desktop app on
every participant laptop, on the day, without internet. A URL works on every machine, needs no
install, and recovers from a crash with F5. The trade-off is deliberate.

### Real-time protocol

Small JSON envelopes: `{ t, d, seq, ts }`.

- Every broadcast carries a monotonic `seq`. A client that sees a gap requests a full resync rather
  than silently drifting.
- Broadcasts are **audience-routed**: a participant socket receives public events plus its own
  private view — never another team's private state, and never an answer key.
- Leaderboard updates are coalesced (80 ms) so a burst of capital changes produces one clean
  animation frame instead of a flood on 40 laptops.

---

## How the round works

### The fixed sequence (never changes)

| # | Type | # | Type | # | Type |
|---|------|---|------|---|------|
| 01 | Market | 05 | Market | 09 | Market |
| 02 | Market | 06 | Market | 10 | **Premium** |
| 03 | Market | 07 | **Premium** | 11 | Market |
| 04 | **Premium** | 08 | Market | 12 | **FINAL PREMIUM** |

8 Market · 3 Premium · 1 Final Premium. There are **no extra questions** for failed premiums,
reclaims, ties, or waiting teams. A reclaim re-uses the **same** premium question.

### Capital and the protected reserve

Every team starts on **₹1000**. Capital is both the score and the risk budget.

```
MAXIMUM LEGAL BID  =  CURRENT CAPITAL − PROTECTED RESERVE      (reserve default ₹500)
```

This is *not* a flat ₹500 bid cap:

| Team | Capital | Reserve | Max bid |
|------|---------|---------|---------|
| A | ₹2500 | ₹500 | **₹2000** |
| B | ₹1400 | ₹500 | **₹900** |
| C | ₹900 | ₹500 | **₹400** |

A rich team can bid higher — and has more at risk. All bid validation happens on the server.

### Market challenges

```
Challenge opens → team enters the printed KEY → team sees category, difficulty,
reward and penalty → team decides JOIN or SIT OUT → question is revealed and the
clock starts → submit → server evaluates → capital changes → leaderboard updates
```

The risk decision is made **before** the question is revealed. Sitting out costs nothing. Market
results settle automatically — **volunteers never report a normal answer**.

### Premium challenges

```
Auction (physical paddles) → SOLD → winner authorised over the LAN → attempt 1
   ├─ correct → +bid, premium ends
   └─ wrong/timeout → −bid → RECLAIM offered to the next highest ORIGINAL bidder
         ├─ accepts → attempt 2 at THEIR OWN original bid
         └─ declines → offer walks down the ladder (declining is free)
```

The winning bid **is** the risk amount. Correct → `capital + bid`. Wrong → `capital − bid`.

**Maximum two attempts, ever.** There is never a second auction and never a third attempt.

---

## Development setup

Requirements: **Node 20.11+** (developed and tested on Node 24). No other services.

```bash
npm install          # installs all three workspaces
npm run dev          # server on :4400 + Vite dev server on :5173 (proxied)
```

In dev, open:

- `http://localhost:5173/` — participant
- `http://localhost:5173/organizer`
- `http://localhost:5173/projector`

In production the server serves the built client itself on a single port.

---

## Build & commands

| Command | What it does |
|---|---|
| `npm run build` | Build shared → client → server (production) |
| `npm start` | Start the built server |
| `npm test` | Full test suite (314 tests) |
| `npm run typecheck` | TypeScript, all packages |
| `npm run lint` | ESLint, all packages |
| `npm run verify` | typecheck + lint + test + build |
| `npm run offline:check` | Static audit for any external network dependency |
| `npm run seed` | `node packages/server/dist/index.js --seed 20` |
| `npm run reset` | Clear game data, keep teams and join codes |

Server flags:

```
--port <n>       HTTP + WebSocket port (default 4400)
--db <path>      SQLite file (default ./data/code-market.db)
--passcode <s>   Operator passcode (otherwise a random one is generated and printed)
--seed <n>       Create n demo teams, print join codes, exit
--reset          Clear game data (keeps teams), exit
```

---

## Event-day setup

### 1. Router

1. Plug the **organizer laptop into the router by Ethernet** (more reliable than Wi-Fi for the
   authority machine).
2. The router creates a private Wi-Fi network. **No internet uplink is needed.**
3. Participants join that Wi-Fi.
4. Disable client isolation / AP isolation on the router — participants must be able to reach the
   organizer laptop.

### 2. Firewall

On the organizer laptop, allow inbound TCP on the game port (default 4400). On Windows the first
run usually prompts; choose **Private networks**. If students cannot connect, this is the most
likely cause — see [Troubleshooting](#troubleshooting).

### 3. Start the server

```bash
npm start
```

Read the printed URLs. The server ranks addresses so the **real** LAN adapter is listed first;
virtual adapters (WSL, Hyper-V, Docker, VPN) are explicitly marked:

```
- http://192.168.0.106:4400  (Wi-Fi; private LAN)
- http://172.24.80.1:4400    (vEthernet (WSL); private LAN, VIRTUAL - clients cannot reach this)
```

Announce the **first** one.

### 4. Projector

Open `http://<organizer-ip>:4400/projector` on the projector machine and put it full-screen (F11).
It needs no passcode and shows no controls. It mutes itself by default.

### 5. Organizer console

Open `http://<organizer-ip>:4400/organizer`, enter the operator passcode from the server console.

### 6. Team registration

Two options:

- **Console:** *Teams* tab → paste one team per line (`NAME, seat, volunteer`) → **Create teams**.
- **CLI:** `node packages/server/dist/index.js --seed 20` before starting the server.

Each team gets a stable id (`T01`…) and a 6-character **join code**. Print the codes on the table
cards — *Teams → Print join codes* produces a clean printable list.

A team enters its join code once; the session persists across refreshes and server restarts. Team
01 cannot impersonate Team 02 without Team 02's code.

---

## Running the event

The whole round is driven from the **Control** tab.

1. **Start round.**
2. Click a challenge in the round sequence strip to open it.
   - For a **market** challenge, read its access key aloud (shown on the tile).
   - For a **premium** challenge, opening it also starts the auction.
3. Market challenges settle themselves. Watch **Live events** for anything needing attention.
4. **Close challenge** when the room is done — anyone still mid-attempt is recorded as a timeout.
5. Repeat through challenge 12, then **Complete round**.

**Pause** freezes the round safely at any time (participants see a calm "paused" screen and nothing
is lost). **Resume** returns to the previous phase.

---

## Auction operation

Bidding is **physical**: one reusable paddle per team, no electronics. The operator only records
what the auctioneer calls.

```
PREMIUM #04 · ALGORITHMS

CURRENT BID   ₹700          NEXT CALL   ₹800          LEADER   T17

[T01] [T02] [T03] [T04] [T05] [T06] ...
```

- **One click on a team tile = one bid at the next call.** No typing.
- Teams that cannot legally reach the next call are **greyed out before you click** (their ceiling
  is `capital − reserve`, broadcast live).
- The current leader is disabled — a team cannot bid against itself.
- **Undo bid** removes the last accepted bid and restores the previous leader (mis-click safety).
- Optional keyboard shortcuts: `1` going once · `2` going twice · `⌫` undo · `⇧↵` close.
- A custom amount can be typed once and applied to the next team clicked (for a jump bid).

Every bid — accepted **and rejected** — is written to the audit log with a timestamp.

Close with **SOLD**. The projector shows the hammer, the winner is authorised over the LAN, and the
winning team's laptop shows **YOU WON** with its risk amount.

Then press **Start attempt 1 of 2** in Premium Control when the room is ready.

---

## Reclaim operation

If the auction winner fails, the system opens the reclaim automatically — **no second auction**.

```
AUCTION HISTORY          →   T18 fails
🥇 T18 — ₹600                T12 is offered the SAME question at ₹600's runner-up bid: ₹500
🥈 T12 — ₹500                5-second decision window
🥉 T07 — ₹400                accept → attempt 2  |  decline → offer walks to T07
   T03 — ₹300
```

- The candidate risks **their own original bid**, not a new one.
- Declining (or letting the window lapse) costs nothing and passes the offer down the ladder.
- The first team to **accept** consumes attempt 2. After that the premium closes permanently,
  whatever the result.
- Premium Control shows the full ladder with each team's state, and lets the operator record an
  accept/decline manually if a laptop is unresponsive.

---

## Configuration

Everything tunable lives in the **Config** tab (and in `packages/shared/src/config.ts` as defaults).
Nothing in the UI hard-codes an economy value.

| Setting | Default | Notes |
|---|---|---|
| Starting capital | ₹1000 | |
| Protected reserve | ₹500 | Max bid = capital − reserve |
| Capital floor | ₹0 | Capital can never go below this |
| Market reward | 200 × difficulty | fixed / by difficulty / % of capital |
| Market penalty | 100 × difficulty | can be disabled entirely |
| Premium opening bid | ₹300 | increment ₹100 |
| Final premium opening bid | ₹500 | increment ₹100 |
| Reclaim window | 5 s | auto-decline on expiry |
| Qualifiers | 10 | Round 3 cut-off |

Invalid values are rejected by the server and the previous value is kept, so a typo mid-event cannot
break the economy.

> **Ties on the qualification line.** Ranking is competition-style: teams on equal capital share a
> rank. If several teams tie *on* the line, all of them qualify, so the qualified count can exceed
> the configured number. This is intentional and fair; resolve it with a tie-break of your choosing
> if Round 3 has a hard capacity.

---

## Simulation & rehearsal

**Tools** tab. Every scenario drives the real engine through the real code paths and is tagged in
the audit log.

| Scenario | Use it to rehearse |
|---|---|
| Market round | Everyone answering a market challenge |
| Premium auction | A full auction with outbids, a winner and an attempt |
| Forced reclaim chain | Winner fails → decline → accept (the reclaim screens) |
| **Rank climb** | Drives last place to first in steps — *the leaderboard animation test* |
| Chaos mode | Rapid overlapping capital changes (layout-animation stress test) |
| Full round | End-to-end dry run of all 12 challenges |

Run these on the projector before the event. **Reset round** before the teams arrive.

---

## Results & export

**Tools → Results & recovery.**

- **CSV** — exactly the specified columns: Rank, Team ID, Team, Starting Capital, Final Capital,
  Normal Attempted, Normal Correct, Premium Wins, Premium Attempts, Premium Correct, Premium Wrong,
  Total Profit/Loss, Qualification Status.
- **JSON** — full archive: config, results, teams, challenges, auctions, every bid, every attempt,
  every transaction, and the complete audit log.
- **Audit TXT** — human-readable dispute-resolution trail:

```
10:32:14  T17  AUCTION_BID       {"amount":600}
10:32:18  T17  AUCTION_WON  C04  {"amount":700}
10:34:10  T17  PREMIUM_RESULT    {"result":"wrong","risk":700}
10:34:10  T12  RECLAIM_OFFERED   {"risk":500}
10:35:30  T12  PREMIUM_RESULT    {"result":"correct"}
10:35:30  T12  CAPITAL_CHANGED   {"from":1800,"to":2300}
```

---

## Emergency recovery

The database is the source of truth. **Everything survives a restart.**

### Server crashed or was closed

```bash
npm start
```

State resumes exactly: phase, open challenge, auction, an in-flight reclaim offer, every capital
balance. Participants reconnect automatically (they never need to re-enter their join code).

### A participant laptop froze / was closed

Reopen the URL. The session is remembered; if the browser was cleared, re-enter the join code. The
team lands on the correct screen for the current phase.

### Organizer console refreshed

Refresh is safe — it re-reads authoritative state from SQLite.

### Database backup

**Tools → Back up the database now** writes a timestamped copy to `data/backups/`. Do this after
every premium. To restore:

```bash
cp data/backups/code-market-<stamp>.db data/code-market.db
npm start
```

### Manual overrides

- **Premium Control** → record CORRECT / WRONG / TIMEOUT for an unresponsive laptop.
- **Premium Control** → record an accept/decline on behalf of a team.
- **Teams** → *Adjust* a team's capital with a reason (written to the audit log).
- **Control** → *Reset round* clears all game data but keeps teams and their join codes.

---

## Troubleshooting

**Students cannot reach the server.**
1. Confirm they are on the event Wi-Fi, not a phone hotspot.
2. Confirm you announced the address marked `private LAN` and **not** one marked `VIRTUAL`.
3. Windows Firewall: allow Node.js inbound on private networks.
4. Test from one laptop: `http://<ip>:4400/api/health` should return `{"ok":true,...}`.
5. Check the router does not have AP/client isolation enabled.

**A team says the leaderboard is frozen.**
Their socket dropped. The banner at the top of their screen says so and it reconnects on its own; a
refresh forces it immediately. Nothing is lost — the server holds the truth.

**A team's screen is stuck on an old screen.**
Refresh (F5). The client always rebuilds from a server snapshot.

**A bid was recorded for the wrong team.**
**Undo bid** in Auction Control, then click the right team. Both the mistake and the undo are in the
audit log.

**The wrong team was authorised for a premium.**
Cancel the auction (Auction Control) and re-run it, or use *Adjust* to correct capital afterwards.
Both are audited.

**A team lost capital to a question they say they never saw.**
Open the **Event log** and filter to that team. Every unlock, join, submission, timeout and capital
change is timestamped.

**Port 4400 is already in use.**
`npm start -- --port 4500`, or stop the other process.

---

## Testing

```bash
npm test            # 314 tests
npm run verify      # typecheck + lint + test + build
npm run offline:check
```

| Suite | Tests | Covers |
|---|---|---|
| `shared` | 99 | Capital, protected reserve, bid validation, every question type, reclaim ladder, ranking, qualification, config validation |
| `server` | 130 | Market flow, auctions, premium settlement, the full reclaim walk, two-attempt limit, duplicate submission, timeouts, persistence across restart, reconnect, auth isolation, simulation, export, **and a full 12-challenge rehearsal over real WebSockets with 12 clients** |
| `client` | 85 | Store reducer against real protocol frames, socket reconnect and sequence-gap resync, screen derivation for every phase, leaderboard stable keys / no duplicate rows / qualification divider / rank movement |

Notable invariants under test: the ledger reconciles (every team's capital equals the sum of its
transactions, and every running balance is consistent), no team ever drops below the capital floor,
no premium ever exceeds two attempts, and no answer key or foreign private view ever reaches a
participant socket.

---

## Known limitations

**Code execution is off by default.** The optional runner (`codeExecutionEnabled`) executes
submitted Python/C++/Java using the toolchain on the organizer machine. It enforces a hard timeout,
an output cap, a source-size cap, and a per-run temp directory — but it provides **no OS-level
sandbox** (no container, no seccomp). For a supervised in-person round on a private LAN that is an
acceptable trade-off, but it is why it defaults to off and why the shipped 12-question pool needs no
execution at all. Enable it only if you understand this.

**Ties can produce more than N qualifiers.** See [Configuration](#configuration).

**Sound is synthesised, not sampled.** All cues are generated with the Web Audio API rather than
bundled audio files — zero assets, zero downloads, fully offline. They are deliberately restrained;
sound is never required to understand the UI, and the projector mutes itself by default.

**Physical paddles are the bidding mechanism.** By design (spec §11): no ESP32, no buttons, no
batteries. The software records and displays; the room does the bidding.

---

Built for CSI Club. Runs on a table, on a router, with the internet unplugged.
