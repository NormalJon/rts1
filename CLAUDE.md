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

Step 10, the first picture in Unity, is on `main` as well: it was built on
the branch `step-10-first-picture`, and the owner watched it and said merge
on 12 November 2026. It shows a match between two skirmish AIs with
nobody at the controls: the map, the river and its fords, trees and deposits,
buildings going up, units walking, working and fighting, arrows, health bars,
and a few lines of text. There are no orders, no selection and no fog yet;
those are the next step, playable parity.

- `unity/`: the Unity project, made from Unity's own "3D URP" template (the
  Universal Render Pipeline, chosen over the High Definition one because far
  more of the art on sale is made for it and it copes better with hundreds of
  units), without the template's tutorial files. Everything it needs comes
  with the editor except glTFast, Unity's own importer for the `.glb` models,
  which Unity downloads the first time.
- `unity/Assets/Game/Runtime`: the display side. `MatchRunner` turns time into
  ticks and has the rest draw; `TerrainView`, `PropField`, `BuildingViews`,
  `UnitViews` and `Overlays` draw the ground, the trees and deposits, the
  buildings, the units, and the arrows and bars; `RtsCamera` is the view;
  `Ground` says where a tile position is in the scene. All of it only reads
  the world. It follows `src/client/game/view.ts` closely, the same colours
  and the same sums, so the two versions can be compared by eye.
- `unity/Assets/Game/Editor`: `ProjectSetup` makes everything that is made and
  not written (materials, the list of which model draws what, render
  settings, the scene `Assets/Scenes/Match.unity`) and can be run again at any
  time; it also copies changed models in from `art-pipeline/models`. `Watch`
  opens the scene and presses Play. Both are on the editor's RTS menu.
- `unity/Assets/Game/Tests`: the checks that run inside Unity (below).
- `csharp/Rts.Core` is also a Unity package (`package.json` and
  `Rts.Core.asmdef` beside the `.csproj`), which `unity/Packages/manifest.json`
  points at. Unity compiles the same source files the .NET tests run; the
  `.asmdef` forbids engine code in them. The `.meta` files Unity writes there
  are kept.
- For that to work the .NET SDK's output had to leave the source folders:
  `csharp/Directory.Build.props` sends it to `csharp/.build/`. Unity would
  otherwise try to import `bin` and `obj`.
- `scripts/unity-batch.ps1` runs the editor without its window: to import and
  compile, to run a method (`-Method Rts.Game.EditorTools.ProjectSetup.Run`),
  or to run the tests (`-Tests EditMode`, `-Tests PlayMode`, with
  `-Filter OrdersTests` for one group of them). The editor must not have the
  project open at the time. `-Tests PlayMode` also leaves pictures of the
  match in `unity/Logs/Snapshots`: look at them after any change to what is
  drawn. It stops Unity after `-TimeoutSeconds` (900 unless told otherwise)
  and says so, because a test that waits for something that never comes would
  otherwise run for ever: with no window, "wait for the end of the frame"
  never returns. After changing `ProjectSetup`, run it again with `-Method`
  before the tests, since the scene and the materials are its work.

Step 11, playable parity, is finished on the branch
`step-11-playable-parity` and is **not merged**: it waits for the owner to
play a skirmish in Unity and say merge. With it the owner leads blue against
the skirmish AI on red, with the browser playtest's mouse and keys: selecting,
every order, building and placing, training and research, the fog of war, and
a proper display with a minimap. Watching two AIs is still there (the "Watch a
match" button in the game, the RTS menu in the editor, or `mode` on
`MatchRunner`). Nothing in `csharp/Rts.Core` was changed.

What step 11 added, all in `unity/Assets/Game`:

- `Runtime/PlayerControls.cs`: `src/client/game/controls.ts` in C#, kept in
  the same order so the two can be read side by side. It decides what a click,
  a drag or a key means, keeps the selection and the control groups, and gives
  orders **only** as commands through `LocalSession.Issue`. It reads no device
  and draws no panel.
- `Runtime/PlayerInput.cs`: reads the mouse and keyboard through the Input
  System package and tells `PlayerControls` what happened. Letters follow the
  keyboard's layout (Q is the key marked Q).
- `Runtime/Hud.cs`, `Runtime/Minimap.cs`, `UI/Hud.uss`, `UI/Theme.tss`,
  `UI/Panel.asset`: the display. It is laid out as `page.html` is. It only
  reads the world and the controls; a button calls the same method on
  `PlayerControls` that its key does.
- `Runtime/Sight.cs`: what blue's side can see, read from the simulation's own
  counts (`world.seen`, `world.explored`, `Vision.CanSee`), and the fog as a
  picture with a dot to a tile. `Runtime/FogPass.cs` and `Shaders/Fog.shader`
  draw it over the whole picture once the ground and everything standing on it
  is drawn, and before the selection rings, order markers and the plot under
  the pointer, which stay bright.
- `Runtime/ScreenMap.cs`: what is under the pointer, answered from what the
  player believes is there.
- `BuildingViews` is now also the player's memory of buildings, `UnitViews`
  hides whoever is out of sight, `TerrainView` repaints only tiles in sight,
  and `Overlays` draws the rings, marks and plots. `MatchHud` is gone.
- `MatchRunner` has a `mode` (`Play` or `Watch`) and an `opponent` level. The
  level the player last picked in the game is kept by Unity's `PlayerPrefs`
  and used next time. `MatchRunner.Next` asks for a particular match; the
  checks use it.

**The display is UI Toolkit, not uGUI.** Why: it is the system Unity now
builds game interfaces on; the whole display is written as text (one C# file
and one style sheet, much as the browser page is HTML and CSS), so nothing has
to be wired by hand in the editor and `ProjectSetup` can make the scene from
nothing; and its style sheet takes the browser page's sizes and colours almost
line for line. What it cost: it shows no hints of its own in a running game,
so `Hud` shows them itself when the pointer rests on a button; it has no
dashed borders; and it ignores the mouse when the game's window is not in
front, which the checks have to get round (see `PlayRig.WakeTheDisplay`).
Health bars, selection rings and markers are not in the display: they are
drawn in the scene, as in step 10.

Two things about the fog that are easy to break. See-through things that lie
on the ground (the water, the bare plot under a building) must be drawn with
the ground and not after it, or they shine through the fog: `ProjectSetup`
gives their materials a queue offset of -500 for this and complains if Unity
has put them back. And anything meant to stay bright over the fog must use the
`Overlay` material, which is drawn after it.

In the scene, a tile at (x, y) is drawn at (x * 2, height, -y * 2) metres:
south is toward the camera, so the map is the way round it is in the browser.
The models come in facing +Z with left and right swapped back (the importer
does that), and are turned half a turn to face south.

Checks that must stay green: `npm test` (257 tests), `npm run typecheck`,
`npm run check:browser`, `npm run check:recordings`,
`dotnet test csharp/Rts.slnx` (289 tests, about half a minute with
`-c Release`), and in Unity `scripts\unity-batch.ps1 -Tests EditMode` (15
tests, under a minute: every recorded match replays to the same checksum on
every tick, and the AI playing the three AI matches itself reaches the same
checksums) and `-Tests PlayMode` (7 tests, about three quarters of a minute;
see below). The reference match must hash to
`8faaf6a6` (`test/determinism.test.ts`, `scripts/browser-check.mjs`,
`test/recordings.test.ts`, `csharp/Rts.Core.Tests/ReplayTests.cs` and
`unity/Assets/Game/Tests/Editor/RecordedMatchTests.cs`); change
that number only when a change in how matches play out is intended, and then
record again (`npm run record`) and make the same change in the C#.

The seven PlayMode tests (`unity/Assets/Game/Tests/Play`), which also leave
pictures in `unity/Logs/Snapshots`, display included:

- `MatchSceneTests`: two AIs play 26 minutes with nobody at the controls,
  everything alive is drawn, and the match ends in the same state as the same
  match played with no picture.
- `SelectionTests`, `OrdersTests`, `FogTests`, `DisplayTests`: the playable
  game. They play it with a pretend mouse and keyboard (`PlayRig`), which the
  game reads through the Input System exactly as it reads real ones; none of
  them gives an order by calling the controls or the session. Between them:
  every way of selecting; fifteen kinds of order, each seen to take effect in
  the match, after which the recorded commands replayed with no picture reach
  the same checksum; mending, in a match where the hard AI comes and damages
  the town centre; the picture, the fog and the minimap holding only what
  blue's side can see through five minutes against the hard AI, with a scout
  sent to the red town; the display's words, buttons, hints, minimap and
  banner; and starting a new match from the display.

The pictures are drawn for a screen 1920 by 1080, but the checks themselves
run on a screen 640 by 480, which is all Unity gives a test with no window.
So a check must turn the view to a thing before clicking it (`Face` in
`OrdersTests`), or the click lands under a panel; `PlayRig.ScreenOfTile` says
so when it would.

Checked on the owner's computer in November 2026: `npm test` and
`npm run typecheck` pass under Node.js 26, and the reference match gave
`8faaf6a6` in Node.js and, by hand, in Chromium 156. The opening scene of the
playtest held 144 frames a second on a dedicated graphics card.

Checked there on 12 November 2026: all of the checks above except
`check:browser`, and the C# tests again with overflow checking switched on.
Checked again the same day with the rule-by-rule tests added: the same
checks, the 289 C# tests with overflow checking on, and that the new tests
fail when a rule in a copy of the library is changed.

Checked there on 12 November 2026 for step 10: the 289 C# tests from their
new place, the 15 and the 1 Unity tests, and thirteen pictures of the match
looked at by Claude from the opening to 26 minutes in (both towns, villagers
at work, a fight, the whole map). The TypeScript checks were not run again:
nothing they cover was touched. In Unity the simulation took about 0.18
milliseconds a tick late in a 36-minute match between two hard AIs.

Checked there on 12 November 2026 for step 11: the 289 C# tests before
anything was changed, and at the end the 15 EditMode and the 7 PlayMode
tests, with some thirty pictures looked at by Claude (selection, placing,
training, the rally flag, the scout at the red town, the fog over the whole
map, the controls list, a hint, the banner, watching). The Unity checks could
not be run before the work began, because the editor was open; the first
thing run was the step 10 test against the new code, which passed. Looking at
the pictures found one fault no test had: the river shone through the fog. It
is fixed and `FogTests` now looks for it. The TypeScript checks were not run:
nothing they cover was touched. The new checks have been seen to fail when
they should. With a right-click on a tree no longer an order to gather,
clicking twice no longer selecting all of a kind, units out of sight drawn
all the same, and the stores shown one too many, the four checks concerned
each failed and named the fault, and the other three passed. With the
controls made to add to the stores directly as well as giving the order, the
orders still took effect but the replay with no picture gave another
checksum, and `OrdersTests` said so.

Never checked for step 11: **a real mouse and keyboard in a real window**.
The checks drive the game through Unity's input system, but with no window
there is no real pointer, no window focus, and no editor in the way. Only the
owner playing can confirm that clicks land where they are aimed, that dragging
a box feels right, that the wheel and the keys do what the list of controls
says, and that the display is the right size on their screen. Also not
checked: the display on a screen that is not 16 by 9; a keyboard that is not
laid out as an English one; ctrl with a digit inside the editor, where Unity
uses it to change window (shift with a digit saves a group too, and is what
the controls list tells the owner to use); and the frame rate with the
display on (off-screen, a frame with a tick in it took about 2.3
milliseconds late in a match, against about 2 before).

Never checked: the Unity picture on a screen at the owner's frame rate (the
tests draw off-screen; one frame with 106 units, 95 buildings and 3,000 trees
took under a millisecond there, which says little about a real window); a
built game, which Unity compiles a different way (IL2CPP) from the editor;
frame rate in a large late-game battle; determinism in Firefox or Safari; and
the C# library on a Mac, or on any processor other than this computer's.

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
  `Editor\Data\Resources\Licensing\Client` in the editor's folder. What put
  it right: the owner opened the project once from the Hub, which left a
  licence where the editor looks, and the command line has worked since. That
  licence says it needs renewing by 12 December 2026; if the command line
  stops working again, ask the owner to open the project from the Hub once
  more. Failing that, the remedy is the ordinary Unity Hub installer from
  unity.com in place of the app package. Do not copy the licence file across
  without the owner saying so.
- To put the Unity version in front of the owner, start the editor with
  `-projectPath C:\dev\rts_1\unity -executeMethod Rts.Game.EditorTools.Watch.Play`
  (it opens the match and presses Play, with the owner leading blue), or tell
  them: open the project from Unity Hub and press Play. `Watch.Run` in place
  of `Watch.Play` starts a match between two AIs to watch; both are on the
  editor's RTS menu, and the game has a button to go from one to the other.
  The keys when playing are the browser version's, and the Controls button in
  the game lists them; `[` and `]` run time slower and faster and F10 pauses,
  for testing. The keys when watching are as before: arrows or W A S D to
  move, the wheel to zoom, + and - for speed, space to pause, 1 and 2 to jump
  to a town. Close the editor again before running `scripts\unity-batch.ps1`.
- Blender 5.3 and uv 0.13.7 are installed (with `winget`, 12 November 2026;
  the owner said yes) for a trial of art made by AI model generators. Blender
  is `C:\Program Files\Blender Foundation\Blender 5.3\blender.exe`. Claude can
  drive it with no window and no add-on: `blender.exe --background --python
  script.py` runs a script of Claude's own, and Blender reads `.glb` and
  writes `.fbx`. Seen to start and to have both.
- The add-on the owner asked about, "MCP for Blender", is **not** installed.
  It lets an AI assistant work Blender live and fetch models from generators
  (Hyper3D Rodin, Hunyuan3D and others). It is genuine: `mcp-for-blender` on
  PyPI, until lately `blender-mcp`, from github.com/ahujasid/blender-mcp, the
  same author on both. But the desktop app's safety check refuses to let
  Claude run its installer (`uvx mcp-for-blender install-addon`), because that
  is running code fetched from the internet. That refusal is deliberate: do
  not get round it. If the add-on is wanted, the owner runs the command
  themselves, turns the add-on on in Blender, and adds it to Claude as a
  connection; its README has the steps. The add-on runs whatever script it is
  sent with no password, so it stays on this machine only.
- A session's PATH can be out of date. If `dotnet` or `node` is not found,
  they are in `C:\Program Files\dotnet` and `C:\Program Files\nodejs`; `uv`
  and `uvx` are under `%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_*`.
  Python is not installed, though uv can fetch its own.
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
   AI play itself. **Done as step 10, and merged into `main` on 12 November
   2026.**
3. Playable parity: selection, orders, HUD, minimap, fog, build and research
   panels. Done when a full skirmish plays as it does in the browser. **Built
   as step 11 on the branch `step-11-playable-parity`; waits for the owner to
   play it and say merge.**
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

- To play a skirmish in Unity (step 11) and say what is wrong with it, and
  then whether to merge `step-11-playable-parity` into `main`. The mouse and
  keyboard in a real window have not been tried by anyone: see "Never checked
  for step 11" above for what to look at.
- To say what the frame rate is in Unity when a big fight is on screen (the
  panel at the top left shows it). It has only been measured off-screen.
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
  art is kept outside it. The same goes for generated art until the terms of
  whichever service made it have been read.
- How to run the art trial the owner agreed to on 12 November 2026: one prop,
  one building and one soldier made by a generator, put in the Unity game
  beside a sample from a bought pack, and judged from the game's camera.
  Either the owner installs the Blender add-on themselves (see "The owner's
  computer"), or, simpler for a trial, the owner makes the three models on a
  generator's own website and puts the files in a folder, and Claude prepares
  them with Blender and puts them in the game. Nothing has been generated yet.
