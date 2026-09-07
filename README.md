# CSI CLUB — CODE MARKET

**Round 3 competition platform — the finale.** A live coding *market*: teams hold capital, answer
technical questions, bid real money in live auctions for premium questions from their own laptops, and can lose it
all on a wrong answer. The top three teams are the winners; nobody qualifies onward. Built to run on
a **private LAN with the internet physically disconnected**.

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
2. [What each machine needs](#what-each-machine-needs)
3. [Architecture](#architecture)
4. [How the round works](#how-the-round-works)
5. [Development setup](#development-setup)
6. [Build & commands](#build--commands)
7. [Event-day setup](#event-day-setup)
8. [Running the event](#running-the-event)
9. [Auction operation](#auction-operation)
10. [Reclaim operation](#reclaim-operation)
11. [Configuration](#configuration)
12. [Simulation & rehearsal](#simulation--rehearsal)
13. [Results & export](#results--export)
14. [Emergency recovery](#emergency-recovery)
15. [Troubleshooting](#troubleshooting)
16. [Testing](#testing)
17. [Known limitations](#known-limitations)

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
   CSI CLUB  -  CODE MARKET   |   ROUND 3   |   OFFLINE LAN MODE
================================================================

   PARTICIPANTS   http://192.168.0.106:4400
   ORGANIZER      http://192.168.0.106:4400/organizer
   PROJECTOR      http://192.168.0.106:4400/projector

   OPERATOR PASSCODE   4821
```

---

## What each machine needs

**Only one machine runs anything.** There is nothing to install on participant laptops.

| Machine | Needs | Does not need |
|---|---|---|
| **Organizer laptop** (one) | Node.js 20.11+ (tested on 24), this repository | Internet, database server, Docker, Python |
| **Participant laptops** (any number) | A modern browser and the event Wi-Fi | Node, npm, this repository, any install, any account |
| **Projector machine** | A browser (can be the organizer laptop itself) | Anything else |

Participants open a URL. The organizer laptop serves the whole interface — HTML, JavaScript, CSS and
all four fonts — from its own disk. Nothing is fetched from the internet at any point; `npm run
offline:check` asserts this against the built output.

**Browsers.** The bundle targets ES2020, so anything from roughly 2020 onward works: Chrome/Edge 80+,
Firefox 75+, Safari 14+. Chrome, Edge and Firefox are all fine. There is no service worker, no
install prompt and no PWA — a refresh always re-reads the current state from the server.

**Python, C++ and Java are not required.** The optional code runner is off by default and no question
in the shipped pool needs it.

### Copying the project to the organizer laptop

If that laptop has internet once, before the event:

```bash
npm install && npm run build
```

If it will never have internet, prepare the folder on a machine that does, then copy across:

```
package.json
node_modules/            (~31 MB of runtime packages once dev dependencies are pruned)
packages/server/dist/
packages/client/dist/
```

and run `node packages/server/dist/index.js`. That is enough; no install step is needed on the target
machine.

> **Match the Node major version.** `better-sqlite3` is a native module compiled against one Node
> ABI. A `node_modules` prepared on Node 24 will not load on Node 20, and fails with
> `NODE_MODULE_VERSION`. Either use the same Node major version on both machines, or run
> `npm rebuild better-sqlite3` on the target (which needs a C++ toolchain, so matching versions is
> much easier). This is the only real portability trap in the project.

---

## Architecture

Three surfaces, **one bundle, one server, one database**. Participants use a browser — there is no
software to install on 40 student laptops.

```
packages/
├── shared/     Pure domain logic shared by server and clients
│   ├── economy.ts       capital, protected reserve, bid validation, settlement
│   ├── evaluation.ts    the generic answer engine (all question types)
│   ├── sequence.ts      the seeded random draw that builds the round
│   ├── reclaim.ts       the reclaim ladder and its state transitions
│   ├── leaderboard.ts   ranking, podium placement, blackout redaction
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
│   └── content/pool.ts       the question pool the round is drawn from
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

### The generated sequence

The round is built from **blocks**. Every block is **three normal questions, then one premium**:

```
BLOCK 1   Q1 → Q2 → Q3 → PREMIUM → strategy phase
BLOCK 2   Q1 → Q2 → Q3 → PREMIUM → strategy phase
BLOCK 3   Q1 → Q2 → Q3 → PREMIUM → strategy phase
BLOCK 4   Q1 → Q2 → Q3 → FINAL PREMIUM
```

**The three questions are drawn at random.** Each one is picked independently from the whole pool
across all four difficulties — Easy, Medium, Hard and Very Hard. There is deliberately **no fixed
difficulty progression**: a block can open Hard and end Easy. Any ordering you see is the draw, not a
rule.

The draw is made by the server from a **seed stored in the database**, so:

- the running order is identical for every surface and every team,
- a reconnect or a server restart never re-rolls it,
- the same seed reproduces the same round exactly, which is what makes a rehearsal meaningful.

A normal question is never repeated inside a round, and the draw avoids reusing anything inside a
configurable no-repeat window. Block count and questions per block are configurable; the defaults are
four blocks of three.

There are **no extra questions** for failed premiums, reclaims, ties, or waiting teams. A reclaim
re-uses the **same** premium question.

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

### Normal questions

```
Intro card (domain · difficulty · solve time) → question opens → team enters the
printed KEY → team decides JOIN or SIT OUT → question is revealed and that team's
clock starts → submit → server evaluates → capital changes → leaderboard updates
```

The risk decision is made **before** the question is revealed. Sitting out costs nothing. Results
settle automatically — **volunteers never report a normal answer**.

Each question carries its own solve time, taken from its difficulty:

| Difficulty | Solve time |
|------------|-----------|
| Easy | 60 s |
| Medium | 90 s |
| Hard | 120 s |
| Very Hard | 150 s |

These are configuration, not constants in the interface — change them in the Config tab and every
surface follows. **The clock belongs to the team, not to the round:** it starts when that team joins,
and the server sends the deadline it is enforcing, so a team that reconnects mid-question resumes
with the time it actually has left.

### Premium challenges

```
Auction (teams bid from their laptops) → SOLD → winner authorised over the LAN → attempt 1
   ├─ correct → +bid, premium ends
   └─ wrong/timeout → −bid → RECLAIM offered to the next highest ORIGINAL bidder
         ├─ accepts → attempt 2 at THEIR OWN original bid
         └─ declines → offer walks down the ladder (declining is free)
```

The winning bid **is** the risk amount. Correct → `capital + bid`. Wrong → `capital − bid`.

**Maximum two attempts, ever.** There is never a second auction and never a third attempt.

The **whole premium** — announcement, auction, first attempt, reclaim, second attempt — runs inside a
single **seven-minute window** held by the server. When the window lapses the premium closes wherever
it had got to, so one slow auction cannot eat the schedule.

### The strategy phase

Every premium is followed by a **40-second strategy phase** before the next block opens. It is a real
game state, not a pause: teams see their capital, their bidding power, their record so far and a
countdown, and the projector shows the same window to the hall. Nothing is at stake during it.

### The final stretch

For the **last four normal questions** the global leaderboard is **sealed**. The projector shows a
blackout card instead of the board, and each team can see only its own capital — not its rank, and
not anyone else's. The organizer console keeps the full live board throughout, because the operator
still has to run the event.

Standings return at the final reveal, which is a podium ceremony: a short countdown, then third,
second and first in turn. **The top three are the winners.** There is no qualification to anything.

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

### Matching two machines

Most of what you see is identical on every install, because it lives in the committed source:

| Thing | Same on every install? |
|---|---|
| Question keys | Yes |
| Team names, and their order | Yes |
| Operator passcode | No, generated once per install and then kept |
| Join codes | No, random per install |
| Which questions are drawn, and in what order | No, random per round |

The database is not in the repository, because it holds the live event: capital, bids, attempts and
the audit log. A clone therefore starts empty and invents its own passcode and codes. That is fine
for the event itself, where one machine is the server, but it means a second machine used for
rehearsal will not match the cards you printed.

To make two machines agree, fix both values on the command line:

```bash
node packages/server/dist/index.js --passcode 4821 --team-seed 2026 --seed 20 --replace
```

The same passcode and the same `--team-seed` produce the same teams and the same join codes on any
machine, so a rehearsal laptop matches the event server exactly.

> **Keep the seed out of the repository.** Join codes are what stop one team signing in as another.
> Passing the seed on the command line keeps it with the operator; committing it to a script in the
> repo would hand every team every code. Without `--team-seed`, codes stay cryptographically random,
> which is the right default.

---

## Running the event

The whole round is driven from the **Control** tab. One large button always names the next thing to
do — *Open B1 Q1*, *Open the question*, *Close the question*, *Start the auction*, *Start the strategy
phase*, *Reveal the podium* — so the operator never has to work out which control applies.

1. **Start round.** The server draws the sequence and shows it as a strip of slots.
2. Press the primary button, or click any slot in the strip to jump to it.
   - A **normal** question shows an intro card first; read its access key aloud (shown on the tile).
   - A **premium** shows its announcement, then you start the auction when the room is ready.
3. Normal questions settle themselves. Watch **Live events** for anything needing attention.
4. **Close the question** when the room is done — anyone still mid-attempt is recorded as a timeout.
5. After each premium, run the **40-second strategy phase**, then move to the next block.
6. Work through the strip, then **Complete round** and **Reveal the podium**.

The strip marks the last four normal questions **SEALED**: from there the projector and the teams
lose the global board while your console keeps it.

**Pause** freezes the round safely at any time (participants see a calm "paused" screen and nothing
is lost). **Resume** returns to the previous phase.

---

## Auction operation

Teams **bid from their own laptops**. When the auction opens, every team sees a **BID ₹X** button
for the next call; one tap raises to it. The server validates each bid against the team's ceiling
(`capital − reserve`) and the bidder list, the current bid and the leader update in real time on
every laptop and on the projector.

```
PREMIUM #04 · ALGORITHMS
CURRENT BID  ₹700     NEXT CALL  ₹800     LEADER  T17

on each team's laptop:   [ 🔨  BID ₹800 ]      (greyed out if beyond their ceiling,
                                                 or "YOU ARE WINNING" if they lead)
```

- A team that cannot legally reach the next call sees the button disabled with its own **max bid**.
- The current leader's button reads **YOU ARE WINNING** — a team cannot bid against itself.
- A team can bid again the moment it is outbid.
- Every bid — accepted **and rejected** — is written to the audit log with a timestamp.

The operator still runs the tempo from **Auction Control**: going once / going twice, and **SOLD**
to close. Auction Control also keeps a **record-a-bid** control per team as a fallback for a team
whose laptop has died, plus **Undo bid** for a mis-click. The operator never has to record bids in
the normal case — the teams do it themselves.

Close with **SOLD**. The projector shows the result, the winner is authorised over the LAN, and the
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
| Question reward | 200 × difficulty | fixed / by difficulty / % of capital |
| Question penalty | 100 × difficulty | can be disabled entirely |
| Premium opening bid | ₹300 | increment ₹100 |
| Final premium opening bid | ₹500 | increment ₹100 |
| Reclaim window | 5 s | auto-decline on expiry |
| Blocks | 4 | each is N questions then a premium |
| Questions per block | 3 | drawn at random |
| No-repeat window | 6 | questions before one may recur |
| Solve time by difficulty | 60 / 90 / 120 / 150 s | easy / medium / hard / very hard |
| Intro card | 8 s | the beat before a question opens |
| Premium window | 420 s | the whole premium, end to end |
| Premium solve time | 150 s | one attempt |
| Strategy phase | 40 s | after every premium |
| Blackout last N questions | 4 | leaderboard sealed for the finale |
| Podium places | 3 | the winners |

Invalid values are rejected by the server and the previous value is kept, so a typo mid-event cannot
break the economy.

> **Ties on the podium.** Ranking is competition-style: teams on equal capital share a rank. A tied
> group takes a place only if the whole group fits inside the podium — two teams level at the top are
> both first and third place still exists, but four teams level at the top cannot fill three places,
> so none of them is placed. At the start of the round every team is level, which is why nobody wears
> a medal until the field separates. Resolve a genuine tie with a tie-break of your choosing.

---

## Simulation & rehearsal

**Tools** tab. Every scenario drives the real engine through the real code paths and is tagged in
the audit log.

| Scenario | Use it to rehearse |
|---|---|
| Question round | Everyone answering the open normal question |
| Premium auction | A full auction with outbids, a winner and an attempt |
| Forced reclaim chain | Winner fails → decline → accept (the reclaim screens) |
| **Rank climb** | Drives last place to first in steps — *the leaderboard animation test* |
| Chaos mode | Rapid overlapping capital changes (layout-animation stress test) |
| Full round | End-to-end dry run of the whole generated sequence |

Run these on the projector before the event. **Reset round** before the teams arrive.

---

## Results & export

**Tools → Results & recovery.**

- **CSV** — exactly the specified columns: Rank, Team ID, Team, Starting Capital, Final Capital,
  Normal Attempted, Normal Correct, Premium Wins, Premium Attempts, Premium Correct, Premium Wrong,
  Total Profit/Loss, Podium Place.
- **JSON** — full archive: config, results, teams, the generated sequence and its seed, auctions,
  every bid, every attempt, every transaction, and the complete audit log.
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

State resumes exactly: phase, the generated sequence, the open question, the auction, an in-flight
reclaim offer, each team's own solve clock, and every capital balance. Participants reconnect automatically (they never need to re-enter their join code).

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
npm test            # 359 tests
npm run verify      # typecheck + lint + test + build
npm run offline:check
```

| Suite | Tests | Covers |
|---|---|---|
| `shared` | 141 | Capital, protected reserve, bid validation, every question type, reclaim ladder, ranking, podium placement and ties, **the random sequence draw and its reproducibility**, leaderboard redaction, config validation |
| `server` | 121 | Question flow, per-team solve clocks, auctions, premium settlement, the full reclaim walk, two-attempt limit, duplicate submission, timeouts, the strategy phase, the leaderboard blackout, persistence across restart, schema versioning, static asset serving, reconnect, auth isolation, simulation, export, **and a full end-to-end rehearsal over real WebSockets with 12 clients** |
| `client` | 97 | Store reducer against real protocol frames, socket reconnect and sequence-gap resync, screen derivation for every phase, countdown urgency, podium plinth sizing, leaderboard stable keys / no duplicate rows / podium marking / rank movement |

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
acceptable trade-off, but it is why it defaults to off and why the shipped question pool needs no
execution at all. Enable it only if you understand this.

**A tie can leave a podium place empty.** A tied group takes a place only if the whole group fits
inside the podium. See [Configuration](#configuration).

**Sound is synthesised, not sampled.** All cues are generated with the Web Audio API rather than
bundled audio files — zero assets, zero downloads, fully offline. They are deliberately restrained;
sound is never required to understand the UI, and the projector mutes itself by default.

**Bidding is on the teams' own laptops.** Each team taps a BID button; the server validates every
bid and the projector updates live. The operator keeps a record-a-bid fallback in Auction Control
for a team whose laptop has died, so the room is never blocked.

**The question pool bounds the round.** The generated sequence needs enough normal questions for
`blocks × questionsPerBlock` and one premium per block. Raising either in Config without adding
questions is refused with an explicit message rather than silently repeating a question.

---

Built for CSI Club. Runs on a table, on a router, with the internet unplugged.
