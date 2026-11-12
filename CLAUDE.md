# Working notes

Read `README.md` first. It describes the game, the layout of the code, the
commands, and the rules for simulation code. This file holds what the README
does not: how we work, where the project stands, and what has been decided
about moving to a game engine.

## Who does what

- The owner directs the design and tests by playing. They are not a
  programmer: explain things in plain language, and say what a change does for
  the player before how it is built.
- Claude is lead designer and developer: writes the code, tests it, and says
  plainly what was checked and what was not.

## How we work

- One step at a time. Each step is built on its own branch (`step-8-ages`,
  then `step-9-csharp-port`, and so on), pushed, and merged into `main` only
  when the owner says to. No pull requests unless asked for.
- Commit and push before ending a turn. Nothing should exist only on one machine.
- This is an original game in a familiar genre. Do not copy another game's
  names, art, maps or look.
- The repository is public. Keep the owner's personal details out of it, and
  out of requests to outside services.

## Where the project stands

The core build is finished in TypeScript, in eight steps:

1. Tick loop, fixed-point maths, command queue, determinism
2. Map, camera, selection, movement, pathfinding
3. Villagers, resources, drop-off buildings
4. Buildings, training, population
5. Combat and the counter triangle
6. Fog of war
7. Skirmish AI (and farms)
8. Ages and technology

All eight steps are on `main`.

Step 9, the C# port, is finished and on `main` as well: the owner said merge
on 12 November 2026. What it added:

- `recordings/`: ten matches played by the TypeScript game and written down
  in full (settings, every command, the checksum after every tick), with the
  recorder in `test/recordings.ts` and `scripts/record-matches.mjs`.
- `csharp/Rts.Core`: all of `src/sim`, `src/ai` and
  `src/session/localSession.ts` in C#, file for file, with no engine code.
- `csharp/Rts.Core.Tests`: every recorded match replays to the same checksum
  on every tick; the C# AI, playing the three AI matches itself, gives the
  orders the TypeScript AI gave; saved games load and carry on identically.

`csharp/README.md` says how the port is laid out, the rules its code keeps
to, and what has not been checked. Read it before changing anything there.

The C# library's own rule-by-rule tests are on `main` as well: they were
built on the branch `step-9-csharp-rule-tests`, and the owner said merge on
12 November 2026. What they added, all in `csharp/Rts.Core.Tests` (nothing in
`src/` or `csharp/Rts.Core` was touched):

- `Helpers.cs`: the checks of `test/helpers.ts` (resources conserved, map
  regions right, buildings and fields match the map, groups counted right, no
  arrow overdue, vision counted right), run after every tick of every
  recorded match by `InvariantTests`.
- `Rules/`: 235 of the TypeScript unit tests translated one for one, a file
  for each file in `test/`. All passed as translated: no rule was found on
  which the C# differs from the TypeScript. `csharp/README.md` lists what
  could not be translated and why.

New rules are to be written in C# with tests in `Rules/` in the same style,
and what must always be true of them added to `Helpers.BrokenInvariant`.

Step 10, the first picture in Unity, is under way on the branch
`step-10-first-picture` (begun 12 November 2026, not finished, not merged).
So far it has only the groundwork:

- `unity/`: the Unity project, made from Unity's own "3D URP" template (the
  Universal Render Pipeline, chosen over the High Definition one because far
  more of the art on sale is made for it and it copes better with hundreds of
  units), without the template's tutorial files, on packages that come with
  the editor so that nothing has to be downloaded to open it. It holds no
  game code yet.
- `csharp/Rts.Core` is also a Unity package (`package.json` and
  `Rts.Core.asmdef` beside the `.csproj`), which `unity/Packages/manifest.json`
  points at. Unity compiles the same source files the .NET tests run; the
  `.asmdef` forbids engine code in them.
- For that to work the .NET SDK's output had to leave the source folders:
  `csharp/Directory.Build.props` sends it to `csharp/.build/`. Unity would
  otherwise try to import `bin` and `obj`. All 289 tests pass from there.

Checked: the library compiles with Unity's own compiler and reference files
(run by hand, since the editor could not be started; see the licence note
under "The owner's computer"). Not checked: anything inside the running
editor.

Checks that must stay green: `npm test` (257 tests), `npm run typecheck`,
`npm run check:browser`, `npm run check:recordings`, and
`dotnet test csharp/Rts.slnx` (289 tests, about half a minute with
`-c Release`). The reference match must hash to
`8faaf6a6` (`test/determinism.test.ts`, `scripts/browser-check.mjs`,
`test/recordings.test.ts` and `csharp/Rts.Core.Tests/ReplayTests.cs`); change
that number only when a change in how matches play out is intended, and then
record again (`npm run record`) and make the same change in the C#.

Checked on the owner's computer in November 2026: `npm test` and
`npm run typecheck` pass under Node.js 26, and the reference match gave
`8faaf6a6` in Node.js and, by hand, in Chromium 156. The opening scene of the
playtest held 144 frames a second on a dedicated graphics card.

Checked there on 12 November 2026: all of the checks above except
`check:browser`, and the C# tests again with overflow checking switched on.
Checked again the same day with the rule-by-rule tests added: the same
checks, the 289 C# tests with overflow checking on, and that the new tests
fail when a rule in a copy of the library is changed.

Never checked: frame rate in a large late-game battle; determinism in Firefox
or Safari; and the C# library inside a game engine, on a Mac, or on any
processor other than this computer's.

## The owner's computer

The work has moved here from the cloud workspace.

- Windows 11 with a strong NVIDIA graphics card, Git, Node.js 26 and the .NET
  SDK 10 (both installed with `winget`; the owner said yes to the SDK on 11
  November 2026). Work runs there in local sessions of the Claude desktop
  app, so the engine can be run and looked at.
- Unity is installed (the owner said yes on 12 November 2026): Unity Hub
  3.22.6 with `winget`, and through it the editor for Unity 6.3 LTS, version
  6000.3.28f1, in `C:\Program Files\Unity\Hub\Editor\6000.3.28f1`. Unity 6.3
  is the long-term-support line, supported until December 2027. The Hub is a
  Windows app package with no fixed folder: its program is
  `app\Unity Hub.exe` under the folder that
  `(Get-AppxPackage -Name UnityTechnologies.UnityHub).InstallLocation` gives,
  and it takes commands after `-- --headless` (`help` lists them).
- Unity will not open a project until the owner has signed in to Unity Hub
  with their own Unity account and taken the free Personal licence. Claude
  must not create accounts, type passwords or accept licence terms: ask the
  owner to do it.
- The owner did sign in and take the Personal licence on 12 November 2026,
  but the editor started from a command line still stops with "No valid Unity
  Editor license found" (exit code 198). The Hub here is a Windows app
  package, and Windows keeps what it writes in a private folder: the licence
  is in `%LOCALAPPDATA%\Packages\UnityTechnologies.UnityHub_*\LocalCache\Local\Unity\licenses`,
  while the editor looks in `%LOCALAPPDATA%\Unity\licenses`, which is empty.
  To see what the editor can see, run
  `Unity.Licensing.Client.exe --showEntitlements` from
  `Editor\Data\Resources\Licensing\Client` in the editor's folder. Not yet
  tried: whether opening a project from the Hub puts a licence where the
  editor looks. If it does not, the remedy is the ordinary Unity Hub
  installer from unity.com in place of the app package. Do not copy the
  licence file across without the owner saying so.
- A session's PATH can be out of date. If `dotnet` or `node` is not found,
  they are in `C:\Program Files\dotnet` and `C:\Program Files\nodejs`.
  Python is not installed.
- The project lives in `C:\dev\rts_1`. Keep it, and any engine project,
  outside folders that OneDrive syncs. The project's packages are many small
  files, and Unity copes with a synced folder worse still.
- To put the game in front of the owner, start the `game` entry in
  `.claude/launch.json` (the same as `npm run dev`) and open
  `http://localhost:5173/playtest`.
- Git has no author name or email set there. Commits so far are made as
  `Claude <noreply@anthropic.com>`, like the rest of the history. If the owner
  wants their own name on commits, use GitHub's private "noreply" address as
  the author email, because the repository is public.
- `npm run check:browser` needs Playwright, which is not among the project's
  packages (the cloud workspace had it preinstalled), so the script stops with
  "Cannot find module 'playwright'". Install it, or make the same check by
  hand: bundle the reference match as the script does, load it in a browser,
  and read `__referenceChecksum`.

## Decided: moving to a game engine

**The look we are after** is realistic in the manner of the big historical
strategy games: detailed, textured, animated soldiers and buildings, proper
lighting and terrain, still readable from above. The models in `art-pipeline/`
are generated by code and are prototype art. They will be replaced by bought
or commissioned art; Claude cannot produce art of that standard.

**Engine.** Unity 6, decided. Claude recommended it on the condition that the
work moves onto the owner's computer, where the engine can be run and its
picture looked at; the owner agreed to that move and, on 12 November 2026, to
installing it. Use the 6.3 LTS editor that is installed, and move to a newer
long-term-support version only on purpose. Confirm with the owner before
installing anything else.

- Unity 6: largest catalogue of ready-made medieval art, which arrives ready
  to use. Free below 200,000 US dollars a year of revenue.
- Godot 4 (.NET edition): the fallback. Free, text project files, but bought
  art has to be converted pack by pack.
- Unreal 5: ruled out. Its ceiling is not needed for this look, and it is the
  heaviest to work with.

**The simulation stays our own.** The engine draws the picture and takes
input. It never decides what happens in a match: no engine physics, pathfinding
or timers in game rules.

**Order of work** (the first of these is step 9 of the build)

1. Port `src/sim` and `src/ai` to a C# class library with no engine code in
   it, so the same library serves Unity or Godot. Proof of the port: matches
   recorded from the TypeScript game (settings, command log, checksum on every
   tick) must replay to the same checksums in C#. The TypeScript version stays
   frozen as the reference while this is done. **Done, and merged into
   `main` on 12 November 2026.**
2. First picture in the engine: map, camera, the existing models, watching the
   AI play itself.
3. Playable parity: selection, orders, HUD, minimap, fog, build and research
   panels. Done when a full skirmish plays as it does in the browser.
4. The graphics pass: lighting, terrain, water, effects, animation, sound, and
   the new art.
5. Menus, saved games, builds for Windows and Mac, then two-player.

New features wait until step 1 is done so they are written once: walls, gates
and siege; garrisoning; civilizations; victory conditions in the simulation.

**Cautions for the C# port** (all four were followed; `csharp/README.md` has
the fuller list of rules that came out of the work)

- Whole numbers only (`int`, `long`), inside `unchecked`. `Math.imul` is
  32-bit wrapping multiplication; `>>>` is an unsigned shift.
- JavaScript's sort is stable and C#'s `Array.Sort` is not. Use a stable sort,
  or comparers that never call two different items equal.
- The typed arrays wrap on overflow (`Uint16Array`, `Int8Array` and the rest).
  Match their widths exactly.
- Nothing may depend on the order of a `Dictionary` or `HashSet`, on
  `GetHashCode`, on floating point, on the clock, or on threads.

## Waiting on the owner

- To open `C:\dev\rts_1\unity` once from Unity Hub ("Add", then "Add project
  from disk"), wait for the editor to finish loading, and close it. That
  shows whether the editor works when the Hub starts it, and may put the
  licence where a command line can use it.
- Where the art comes from: bought packs or a commissioned artist, and roughly
  what budget. Not needed until the graphics pass, but worth looking early.
  Claude's suggestion of 12 November 2026, not yet agreed: free scanned
  ground, rock and plants (Megascans on Fab, Poly Haven, ambientCG), bought
  packs for buildings and soldiers after trying one of each from the game's
  camera, and an artist only for what packs cannot supply (cavalry, player
  colours, a common look).
- What to do about this repository being public. Bought art may be shipped in
  the game but not published as files (see the licence traps in
  `docs/art-sources.md`), so either the repository becomes private or bought
  art is kept outside it.
