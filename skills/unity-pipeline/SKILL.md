---
name: unity-pipeline
description: Drive a running Unity Editor or development Player from the command line via the com.unity.pipeline package — edit→recompile→test loop, builder scripts and C# eval, `[MethodReload]` hot-swaps in a running game (incl. IL2CPP), server-side waits, transactional batches, capture, and Multiplayer Play Mode. Use when an agent needs to control a live Unity instance, automate tests, recompile headlessly, or reload code at runtime. Assumes the `unity` CLI is on PATH.
---

# Unity Pipeline

Run `unity command <group> <name> [--arg value]`. `unity command` lists groups, `unity command <group>` lists a group's commands. Pass lists/objects as single-quoted JSON.

## References (load only what you need)

All under `references/Documentation~/`:
- `index.md` – every command with a link to its parameters. Start here for exact names.
- `commands/<area>.md` – full parameters per area: `assets-and-files`, `scenes`, `gameobjects-and-components`, `prefabs`, `scripts`, `animation`, `materials`, `baking`, `navigation`, `capture`, `wait`, `batch`, `build-and-compilation`, `project-settings`, `package-manager`, `editor-lifecycle-and-observability`, `multiplayer-play-mode`, `runtime`.
- `connectivity.md` – ports, descriptor, auth, busy gates (settling / dialog), timeouts, MPPM clones.
- `method-reload.md` – reload backends, interpreter C# subset, watcher.
- `runtime-setup.md` – enabling the server in Player builds, IL2CPP `link.xml`.
- `safety-and-mutations.md` – `confirm`/`dry_run`, Undo, authoring-root sandbox.
- `creating-commands.md` / `authoring-commands.md` – only when writing new commands.
- `references/README.md` – installing the `unity` CLI.

## Setup

```bash
unity pipeline install
unity status --until-ready --project-path <p>   # wait out the cold-import "settling" window
unity command editor set_auto_tick              # REQUIRED: keeps the Editor ticking while unfocused
```

## Edit → recompile → test

```bash
unity command script recompile
unity command script recompile_status            # poll until completed | up_to_date; read "errors" if failed
unity command test run --mode editor --filter MyFixture.MyTest   # --async_tests true → poll `test status`
unity command console get --tail 50 --level error
```

Tolerate connection errors during the domain reload. `unity recompile --project-path <p>` does trigger + wait + diagnostics in one step.

## Play Mode

```bash
unity command editor.playmode set_run_in_background   # before start, else an unfocused Editor stalls at frame 1
unity command editor.playmode start
unity command editor status                           # trust playerLoopTicking, not playMode
unity command capture game_view --save_path Shots/a.png   # default source=screen includes overlay UI
```

If the user already had Play Mode running, don't change its settings or stop it.

## Wait server-side, don't poll with eval

```bash
unity command job wait --async true --timeout 300 \
  --condition '{"member":"MatchManager.Instance.State","op":"equals","value":"Ended"}' \
  --on_met '{"capture":{"view":"game","save_path":"Shots/end.png"}}'
unity command job wait_status --wait_id <id>
```

Sync waits block the command queue — use only for short waits that don't depend on a command you still need to send. Add `--tolerate_missing true` to wait for something to spawn.

## Bulk work: `script run`; ad-hoc: `script eval`

```bash
# Builder file outside Assets/ (no import/domain reload); path relative to project root.
unity command script run --file AgentScripts/Build.cs --entry Build.All [--args '[3,"x"]'] [--dry_run true]
unity command script eval 'return UnityEngine.Application.version;'
```

Keep multi-line code in files via `script run`; eval is for one-liners. For a new persistent type: `script create` → `script recompile` → `script attach`.

## Batch edits transactionally

`unity command job batch --operations '[{"id":"go","command":"gameobject create","params":{"name":"Ball"}},{"command":"component add","params":{"target":"$go.instanceId","type":"Rigidbody"}}]'`

One Undo step, rolls back on failure. Non-Undo commands (asset/settings writes, saves, bakes) need `--transactional false`; eval, recompile, tests, builds, scene open/create and playmode are never allowed. Try `--dry_run true` first.

## Method reload (running game)

Tag a **public** `void`/`IEnumerator` method `[MethodReload]` (`using Unity.Pipeline.MethodReload;`) *before* entering Play Mode or building, edit its body, then:

| Target | Command |
|--------|---------|
| Editor Play Mode / Mono dev Player | `script.methodreload reload <file>` (full C#, public members only; `--pdb` for breakpoints) |
| IL2CPP / device dev Player | `script.methodreload reload_player <file-or-folder>` (pushed via PlayerConnection; C# subset) |
| Check subset in Editor | `script.methodreload reload_editor <file>` |

Interpreter subset excludes `await`, `try/catch`, LINQ query syntax, `ref/out`, generics, new types, etc. (analyzer MR002–MR023). Stripped-member warnings on device → `script.methodreload generate_link_xml` and rebuild. `[OnMethodReloaded]` re-inits state (e.g. restart coroutines).

## Players and MPPM

- Player: enable *Project Settings → Pipeline → Runtime → Enable in Development & Profiled Builds*, build Development, then `unity command --runtime MyGame.exe runtime status` (or `--runtime-path <exe folder | .app>`).
- MPPM (6000.3+ with the package): `editor.playmode set_active_scenario --path X.asset` → `start_scenario` (not `editor.playmode start`) → poll `get_scenario_status` until `reachable`, then `unity command --project-path <its projectPath> …`.

## Gotchas

- Async commands return immediately — poll the matching status (`script recompile_status`, `test status`, `build status`, `lighting|navmesh|occlusion bake_status`, `package status`, `diagnostics audit_status`, `job wait_status`).
- Hang? `editor status` → `blocked_by_dialog` means a modal is open: stop and tell the human.
- Can't connect? `unity status` — Safe Mode (compile errors) means fix the code on disk.
- Destructive commands need `--confirm true`; preview with `--dry_run true`. Asset/settings/package changes aren't undoable.
- Several Editors (worktrees, clones): always pass `--project-path <full path>`.
- Exit codes: `2` fix arguments; `6` command failed, don't retry unchanged; `14` timed out but may still be running.
