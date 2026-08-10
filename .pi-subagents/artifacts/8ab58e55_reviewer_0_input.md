# Task for reviewer

[Read from: /Users/ms/dev/pi/pi-finances/plan.md, /Users/ms/dev/pi/pi-finances/progress.md]

You are grilling (비판적 검토) a monorepo design for pi finance packages. Read the design brief at /Users/ms/dev/pi/pi-finances/DESIGN-DRAFT.md and the existing codebase at /Users/ms/dev/pi/pi-kis (package.json, index.ts, src/agent/extension.ts, src/agent/tools.ts, src/core/auth.ts, src/core/secret.ts, src/roles/toss.ts, src/roles/broker.ts, src/roles/indicators.ts, skills/, .github/workflows/bump-and-release.yml). Also check pi package docs at /Users/ms/.local/share/mise/installs/node/24.10.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md for the module-root/bundling constraints.
Grill the plan HARD: (1) Is splitting kis/toss into separate npm packages the right call given pi loads packages with separate module roots — specifically is the broker_* fallback facade viable under option (a) optionalDependency+dynamic import, or is that a trap (version skew, double install, circular)? (2) Is pi-finance-core worth extracting now, or premature — what exactly must move (check actual import graphs)? (3) Skills ownership split — any breakage for existing npm:pi-kis users at 0.3.0? (4) Release pipeline: extending the custom bump-and-release vs changesets for a 2-3 package monorepo — recommend one concretely. (5) Anything the draft missed (npm naming, publishConfig, workspace:* + published tarball mismatch, pnpm vs npm in pi install, CI, watch.ts CLI, README/install docs, keyring migration).
Output: a numbered list of findings, each with severity (BLOCKER/MAJOR/MINOR/NIT), a concrete recommendation, and a final verdict: which split/architecture you would actually ship. Be specific and reference actual files/lines. Do NOT write code, just the review.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```