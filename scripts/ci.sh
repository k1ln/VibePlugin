#!/usr/bin/env bash
# =====================================================================
#  scripts/ci.sh — trigger & track the cross-platform release builds
#  (.github/workflows/release.yml) that run on GitHub-hosted macOS, Linux
#  and Windows runners. You never need a Linux or Windows machine.
#
#  Quick start
#    scripts/ci.sh build              # build all 3 OSes now (artifacts only)   [needs gh]
#    scripts/ci.sh build --watch      # ...and stream progress until it finishes [needs gh]
#    scripts/ci.sh tag v1.0.0         # cut a release: push a tag -> builds +    [git only]
#                                     #   attaches the zips to that GitHub Release
#    scripts/ci.sh watch              # watch the most recent run               [needs gh]
#    scripts/ci.sh status             # list recent runs                        [needs gh]
#    scripts/ci.sh logs               # dump the failing steps of the last run  [needs gh]
#    scripts/ci.sh open               # open the Actions page in a browser
#
#  The `build` form uses workflow_dispatch (no tag, no Release — just downloadable
#  artifacts, ideal for test builds). The `tag` form is a real versioned release.
#  Only the gh-backed subcommands need the GitHub CLI; `tag`/`open` work with git.
# =====================================================================
set -euo pipefail

WORKFLOW="release.yml"

# Resolve owner/repo from the `origin` remote (this repo has a second `archive`
# remote, so don't rely on gh's auto-detection picking the right one).
origin_url="$(git config --get remote.origin.url || true)"
REPO="$(printf '%s' "$origin_url" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
[ -n "$REPO" ] || { echo "✗ could not determine GitHub repo from 'origin' remote"; exit 1; }

have_gh() { command -v gh >/dev/null 2>&1; }
require_gh() {
  if ! have_gh; then
    cat >&2 <<EOF
✗ GitHub CLI (gh) is not installed — this subcommand needs it.
  Install:  brew install gh   (then: gh auth login)
  Or use the no-gh path:  scripts/ci.sh tag vX.Y.Z   (triggers via a tag push)
EOF
    exit 127
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "✗ gh is installed but not authenticated. Run: gh auth login" >&2
    exit 1
  fi
}

# Newest run id for our workflow (empty if none yet).
latest_run_id() {
  gh run list --repo "$REPO" --workflow "$WORKFLOW" -L 1 \
    --json databaseId --jq '.[0].databaseId' 2>/dev/null || true
}

cmd="${1:-help}"; shift || true

case "$cmd" in
  build)
    require_gh
    watch=0; tag=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --watch) watch=1 ;;
        --tag)   tag="${2:?--tag needs a value like v1.0.0}"; shift ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
      esac; shift
    done
    echo "▶ dispatching '$WORKFLOW' on $REPO${tag:+  (release tag: $tag)}…"
    if [ -n "$tag" ]; then gh workflow run "$WORKFLOW" --repo "$REPO" -f "tag=$tag";
    else                   gh workflow run "$WORKFLOW" --repo "$REPO"; fi
    # The run takes a moment to register; poll briefly for its id.
    id=""; for _ in 1 2 3 4 5 6 7 8; do sleep 2; id="$(latest_run_id)"; [ -n "$id" ] && break; done
    if [ -z "$id" ]; then echo "  dispatched. See: scripts/ci.sh status"; exit 0; fi
    echo "  run #$id started — https://github.com/$REPO/actions/runs/$id"
    if [ "$watch" = 1 ]; then exec gh run watch "$id" --repo "$REPO" --exit-status; fi
    ;;

  tag)
    ver="${1:?usage: scripts/ci.sh tag vX.Y.Z}"
    case "$ver" in v[0-9]*) ;; *) echo "✗ tag must look like v1.2.3"; exit 2 ;; esac
    echo "▶ tagging $ver and pushing to origin (triggers a versioned Release build)…"
    # Make sure the commit the tag points at is actually on the remote.
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "  ⚠ working tree has uncommitted changes — commit them first so the build matches." >&2
    fi
    branch="$(git rev-parse --abbrev-ref HEAD)"
    git push origin "$branch"
    git tag -a "$ver" -m "VibePlugin $ver"
    git push origin "$ver"
    echo "  pushed $ver. Track it with: scripts/ci.sh watch"
    ;;

  watch)
    require_gh
    id="${1:-$(latest_run_id)}"
    [ -n "$id" ] || { echo "no runs found yet — start one with: scripts/ci.sh build"; exit 1; }
    exec gh run watch "$id" --repo "$REPO" --exit-status
    ;;

  status)
    require_gh
    gh run list --repo "$REPO" --workflow "$WORKFLOW" -L "${1:-10}"
    ;;

  logs)
    require_gh
    id="${1:-$(latest_run_id)}"
    [ -n "$id" ] || { echo "no runs found"; exit 1; }
    echo "▶ failing steps of run #$id (see 'gh run view $id --log' for the full log):"
    gh run view "$id" --repo "$REPO" --log-failed
    ;;

  download)
    require_gh
    id="${1:-$(latest_run_id)}"
    dest="${2:-dist}"
    mkdir -p "$dest"
    echo "▶ downloading artifacts from run #$id into $dest/…"
    gh run download "$id" --repo "$REPO" --dir "$dest"
    ls -la "$dest"
    ;;

  open)
    url="https://github.com/$REPO/actions/workflows/$WORKFLOW"
    if command -v open >/dev/null 2>&1; then open "$url"; else echo "$url"; fi
    ;;

  help|-h|--help|*)
    sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
