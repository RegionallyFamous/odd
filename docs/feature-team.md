# Building ODD functionality with the Codex feature team

ODD includes a project-scoped [Codex custom-agent team](https://learn.chatgpt.com/docs/agent-configuration/subagents) for turning a feature request into a tested change without losing the product's catalog-first boundaries.

## The team

| Agent | Responsibility | Writes source? |
| --- | --- | --- |
| `odd_feature_architect` | Traces the current system and defines the smallest safe feature contract. | No |
| `odd_feature_builder` | Implements the agreed vertical slice and runs focused checks. | Yes; sole writer |
| `odd_quality_reviewer` | Reviews correctness, security, integration risks, and test coverage. | No |
| `odd_experience_tester` | Tests the packaged app in desktop/mobile browsers and captures evidence. | Test artifacts only |

The main Codex chat coordinates the handoffs. The project caps concurrent subagents at three, which leaves write ownership clear while allowing independent review lanes to run together.

## Activate the team

Codex discovers project-scoped custom agents when a task starts. After pulling or creating these files, start a new Codex task in this repository (or reopen the workspace) and trust the project if prompted. An already-running task does not dynamically add newly created agent types to its tool list.

## Starting a feature

A short request is enough:

> Use the ODD feature team to add bulk export to Pantry. Users should be able to select synced patterns and download one portable file. Do not publish it.

Codex should first return or internally establish the feature contract, then hand implementation to the builder. If a choice changes stored data, permissions, destructive behavior, or the public product surface, Codex should ask for that choice. Minor implementation details should not block progress.

## Feature brief

Use this structure for larger ideas or when handing a partially explored feature to the team:

```md
# Feature

## Problem
Who is stuck, and what are they trying to accomplish?

## Desired outcome
What can the user do when this is complete?

## In scope
- Required behavior

## Out of scope
- Explicit non-goals

## Constraints
- WordPress/OpenStation versions, permissions, data, or compatibility needs

## Acceptance examples
- Given / when / then examples for the important paths

## Release intent
Local only, commit, preview catalog, or production release
```

Unspecified release intent always means local-only: no commit, push, deploy, tag, or publication.

## Handoff contract

The architect gives the builder:

- the existing execution path and relevant files;
- a catalog-only versus runtime decision;
- the proposed data and API flow;
- security, permissions, cleanup, and compatibility boundaries;
- exact file ownership;
- acceptance criteria and validation commands;
- material unknowns, without turning optional ideas into scope.

The builder returns changed files, delivered behavior, actual command results, and residual risk. The two verification agents return independent evidence. Blocking findings go back to the same builder, avoiding overlapping edits.

## Verification

For one catalog app:

```sh
npm run verify:app -- pantry
```

Optional screenshot destination:

```sh
npm run verify:app -- pantry --screenshots-dir test-results/pantry-review
```

The command is intentionally local. It builds into an isolated temporary catalog, verifies that the repository's generated artifacts match, and smoke-tests that isolated package. It never overwrites generated work or commits, pushes, deploys, signs, or publishes anything. If generated artifacts are stale, run `python3 _tools/build-catalog.py`, review the diff, and rerun the gate.
