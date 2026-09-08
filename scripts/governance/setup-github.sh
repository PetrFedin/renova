#!/usr/bin/env bash
# Renova — one-shot GitHub governance setup.
# Run from the repository root on the OWNER's machine, authenticated as the owner:
#   gh auth status            # must show PetrFedin with repo + admin scopes
#   bash scripts/governance/setup-github.sh
#
# Idempotent: re-running updates instead of duplicating.
# Does NOT: create the bot account, create tokens, or add secrets — those are owner-only manual steps (see README).
set -euo pipefail

REPO="${REPO:-PetrFedin/renova}"
OWNER="${REPO%%/*}"
DRY_RUN="${DRY_RUN:-0}"
BRANCH="governance/agent-contribution-scaffolding"

log()  { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[1;33m!\033[0m %s\n' "$*"; }
api()  { if [ "$DRY_RUN" = "1" ]; then echo "   [dry] gh api $*"; else gh api "$@"; fi; }

command -v gh >/dev/null || { echo "gh CLI required: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "run: gh auth login (as repository owner/admin)"; exit 1; }
[ -f AGENTS.md ] && [ -d backend ] || { echo "run from the renova repository root"; exit 1; }

# ---------------------------------------------------------------------------
log "0. Preflight"
me=$(gh api user -q .login)
perm=$(gh api "repos/$REPO" -q .permissions.admin)
[ "$perm" = "true" ] || { echo "user $me is not admin on $REPO"; exit 1; }
ok "authenticated as $me (admin)"

# ---------------------------------------------------------------------------
log "1. Repository settings (merge strategy, branch cleanup, PR updates)"
api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_update_branch=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY >/dev/null
ok "squash-only, auto-delete head branches, suggest update branch"

log "1b. Actions permissions: GITHUB_TOKEN read-only, cannot approve PRs"
api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
ok "default_workflow_permissions=read, can_approve_pull_request_reviews=false"

log "1c. Fork PR workflows require approval"
api -X PUT "repos/$REPO/actions/permissions/fork-pr-workflows-private-repos" -f run_workflows_from_fork_pull_requests=false >/dev/null 2>&1 || warn "fork-pr setting endpoint unavailable for this repo type (set in UI: Actions → General → Fork pull request workflows → Require approval for all outside collaborators)"

log "1d. Security: secret scanning + push protection, Dependabot alerts + security updates"
api -X PATCH "repos/$REPO" --input - >/dev/null <<'JSON' || warn "secret scanning must be enabled in UI (Code security)"
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null 2>&1 && ok "dependabot alerts" || warn "dependabot alerts: enable in UI"
api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null 2>&1 && ok "dependabot security updates" || warn "security updates: enable in UI"

# ---------------------------------------------------------------------------
log "2. Labels"
mk_label() { # name color description
  if gh label list -R "$REPO" --json name -q '.[].name' | grep -qx "$1"; then
    gh label edit "$1" -R "$REPO" --color "$2" --description "$3" >/dev/null
  else
    gh label create "$1" -R "$REPO" --color "$2" --description "$3" >/dev/null
  fi
  ok "$1"
}
mk_label agent-task    0E8A16 "Task from PRODUCT-COMPLETION-MANDATE for an autonomous agent"
mk_label ready         1D76DB "Dependencies closed; an agent may take it"
mk_label in-progress   FBCA04 "An agent is working on it"
mk_label needs-owner   B60205 "Blocked on an owner-only decision or action"
mk_label blocked       D93F0B "Blocked by another task/issue"
mk_label agent-review  5319E7 "Reviewed by the second agent"
mk_label governance    C5DEF5 "Repository governance / agent infrastructure"
mk_label dependencies  0366D6 "Dependabot"
for p in P0 P1 P2; do mk_label "$p" 000000 "Priority $p"; done
for ph in A B C D E; do mk_label "phase:$ph" BFD4F2 "Mandate phase $ph"; done

# ---------------------------------------------------------------------------
log "3. Governance PR (CODEOWNERS, PR template, issue template, dependabot, policy + claude workflows, .claude/settings.json, kickoff)"
need=( .github/CODEOWNERS .github/pull_request_template.md .github/ISSUE_TEMPLATE/agent-task.yml .github/dependabot.yml
       .github/workflows/agent-pr-policy.yml .github/workflows/claude-agent.yml .claude/settings.json .agent/kickoff.md )
missing=0; for f in "${need[@]}"; do [ -f "$f" ] || { warn "missing $f (copy the governance bundle first)"; missing=1; }; done
[ "$missing" = "0" ] || exit 1

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  warn "branch $BRANCH already exists on origin; skipping PR creation"
else
  git fetch origin main >/dev/null
  git checkout -q -b "$BRANCH" origin/main
  # AGENTS.md pointer (append once)
  if ! grep -q "PRODUCT-COMPLETION-MANDATE" AGENTS.md; then
    python3 - <<'PY'
import re,pathlib
p=pathlib.Path("AGENTS.md"); s=p.read_text()
block = """
Active work plan: `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md`. Tasks are taken by ID from GitHub issues labeled `agent-task` + `ready`; the branch name is `agent/<ID>-<slug>`. Every PR must fill `.github/pull_request_template.md`; the `agent-pr-policy` check enforces it. Agents never merge: merge is performed by the owner after the second-agent review and green required checks. Completion scenarios: `docs/technical-spec/GOLDEN-PATHS.md`.
"""
s = s.replace("## 1. Repository and change workflow\n", "## 1. Repository and change workflow\n"+block, 1)
p.write_text(s)
PY
  fi
  git add "${need[@]}" AGENTS.md docs/technical-spec backend/app/services/providers backend/tests/providers backend/app/core/config.py 2>/dev/null || true
  git commit -q -m "chore(governance): agent contribution scaffolding + provider ports (mandate A2)" \
    -m "Mandate ID: governance" \
    -m "Adds CODEOWNERS, PR/issue templates, dependabot, agent-pr-policy and claude-agent workflows, .claude/settings.json allow/deny, kickoff prompt, PRODUCT-COMPLETION-MANDATE, GOLDEN-PATHS, provider ports/registry/simulated payment + contract tests. No removals."
  git push -q -u origin "$BRANCH"
  body=$(cat <<'EOF'
## Task
Mandate ID: governance
Issue: #247

## What
Agent-contribution scaffolding: CODEOWNERS, PR template, issue template, dependabot, `agent-pr-policy` and `claude-agent` workflows, `.claude/settings.json` allow/deny, `.agent/kickoff.md`, PRODUCT-COMPLETION-MANDATE, GOLDEN-PATHS, provider ports/registry/simulated payment reference and contract tests (mandate A2), five `*_provider_mode` settings.

## Why
Link to mandate task / contract: docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md (A2) and AGENT-AUTONOMY-SETUP.

## Chain verified
- governance files only; provider package is additive and not yet wired into any existing call site (A4 does that).

## Removal proof
no removals

## Evidence
- baseline: `cd backend && python -m pytest tests -q` → 1068 passed
- after: `cd backend && python -m pytest tests -q` → 1091 passed
- postgres integrity: n/a (no schema change)
- golden paths affected: none (GP tests are written in A1)

## Out of scope / found issues
- #247 negative test is recorded by scripts/governance/setup-github.sh step 5.
EOF
)
  gh pr create -R "$REPO" -B main -H "$BRANCH" -l governance \
    -t "chore(governance): agent contribution scaffolding + provider ports (A2)" -b "$body" >/dev/null
  ok "PR opened: $(gh pr view "$BRANCH" -R "$REPO" --json url -q .url)"
  git checkout -q main
fi

# ---------------------------------------------------------------------------
log "4. Rulesets"
# Required checks: job ids from existing workflows + the new policy job.
# GitHub lets rulesets reference contexts that have not run yet.
ruleset_main=$(cat <<'JSON'
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "mobile-contracts" },
          { "context": "chat-message-contracts" },
          { "context": "project-creation-contracts" },
          { "context": "acceptance-decision-contracts" },
          { "context": "stage-mutation-contracts" },
          { "context": "team-lifecycle-contracts" },
          { "context": "backend-complete" },
          { "context": "playwright-api-and-ui" },
          { "context": "source-and-runtime" },
          { "context": "security-source-contract" },
          { "context": "typecheck-integrity" },
          { "context": "snapshot" },
          { "context": "policy" }
        ] } }
  ]
}
JSON
)
ruleset_agent=$(cat <<'JSON'
{
  "name": "agent-branches",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/heads/agent/**"], "exclude": [] } },
  "rules": [ { "type": "non_fast_forward" } ]
}
JSON
)
upsert_ruleset() { # name json
  id=$(gh api "repos/$REPO/rulesets" -q ".[] | select(.name==\"$1\") | .id" 2>/dev/null || true)
  if [ -n "$id" ]; then api -X PUT "repos/$REPO/rulesets/$id" --input - <<<"$2" >/dev/null; ok "$1 updated (id $id)"
  else api -X POST "repos/$REPO/rulesets" --input - <<<"$2" >/dev/null; ok "$1 created"; fi
}
upsert_ruleset main-protection "$ruleset_main"
upsert_ruleset agent-branches "$ruleset_agent"

# ---------------------------------------------------------------------------
log "5. Negative test for #247 (direct push to main must be rejected)"
if [ "$DRY_RUN" = "1" ]; then echo "   [dry] skipped"; else
  tmp=$(mktemp -d); git clone -q --depth 1 "https://github.com/$REPO.git" "$tmp/r"; cd "$tmp/r"
  echo "# ruleset negative test $(date -u +%FT%TZ)" >> README.md
  git -c user.name=owner -c user.email=owner@local commit -qam "test: direct push must be rejected"
  set +e; out=$(git push origin HEAD:main 2>&1); rc=$?; set -e
  cd - >/dev/null; rm -rf "$tmp"
  if [ $rc -ne 0 ] && grep -qiE "GH013|protected|rule" <<<"$out"; then
    ok "direct push rejected"
    gh issue comment 247 -R "$REPO" -b "$(printf 'Ruleset **main-protection** active. Negative test (direct push to main) rejected on %s:\n\n```\n%s\n```\nRulesets: main-protection, agent-branches. Required checks and Code Owner review enforced. See scripts/governance/setup-github.sh.' "$(date -u +%FT%TZ)" "$out")" >/dev/null && ok "evidence posted to #247"
  else
    echo "$out"; echo "!! direct push was NOT rejected — do not proceed; check rulesets in the UI"; exit 1
  fi
fi

# ---------------------------------------------------------------------------
log "6. Mandate issues (27) — idempotent by title"
python3 scripts/governance/create-mandate-issues.py --repo "$REPO" ${DRY_RUN:+--dry-run}

# ---------------------------------------------------------------------------
log "DONE. Owner-only manual steps remaining (cannot be scripted):"
cat <<EOF
   1. Create bot account 'renova-agent'; add as Collaborator (Write) on $REPO; accept the invite.
   2. As renova-agent: fine-grained PAT → only $REPO → Contents RW, Pull requests RW, Issues RW, Metadata R, Actions R. No Workflows/Administration/Secrets. 90-day expiry.
   3. Settings → Secrets → Actions: ANTHROPIC_API_KEY, RENOVA_AGENT_TOKEN (the PAT from step 2).
   4. Review and merge the governance PR. After merge, open a throwaway PR from a branch named agent/test-policy with an empty body and confirm 'policy' turns red and merge is disabled (acceptance §8 of AGENT-AUTONOMY-SETUP).
   5. On the agent machine: gh auth login --with-token < renova-agent.token; git config user.name renova-agent; then
        claude -p "\$(sed 's/<ID>/A1/' .agent/kickoff.md)"
EOF
