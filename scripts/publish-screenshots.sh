#!/usr/bin/env bash
set -euo pipefail

# Required env vars (provided by workflow):
#   PR_NUMBER     — pull request number
#   GITHUB_SHA    — the head commit SHA
#   GITHUB_TOKEN  — GitHub token with contents:write
#   GITHUB_REPOSITORY — "owner/repo"

REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
BRANCH="pr-screenshots"
SHORT_SHA="${GITHUB_SHA:0:7}"
DEST_PATH="pr/${PR_NUMBER}/${GITHUB_SHA}"
WORKSPACE_DIR="$(pwd)"
SCREENSHOTS_SRC="${WORKSPACE_DIR}/screenshots"
COMMENT_BODY="${SCREENSHOTS_SRC}/.comment-body.md"

git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config --global user.name "github-actions[bot]"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cd "$WORK_DIR"

# Clone or init the orphan branch
if git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1; then
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" repo
else
  git clone --depth 1 "$REPO_URL" repo
  cd repo
  git checkout --orphan "$BRANCH"
  git rm -rf . >/dev/null 2>&1 || true
  touch .gitkeep
  git add .gitkeep
  git commit -m "Initialize pr-screenshots branch"
  cd "$WORK_DIR"
fi

cd "$WORK_DIR/repo"

# Remove stale screenshots for this PR (keep other PRs untouched)
rm -rf "pr/${PR_NUMBER}"

# Copy new screenshots into place
mkdir -p "$DEST_PATH"
cp "${SCREENSHOTS_SRC}"/*.png "$DEST_PATH/"

git add -A
git commit -m "screenshots: PR #${PR_NUMBER} @ ${SHORT_SHA}"
git push "$REPO_URL" "$BRANCH"

# Build the comment body with inline image links
OWNER_REPO="${GITHUB_REPOSITORY}"
RAW_BASE="https://raw.githubusercontent.com/${OWNER_REPO}/${BRANCH}/${DEST_PATH}"

cat > "$COMMENT_BODY" <<EOF
<!-- pr-screenshots:auto -->
## Rendered screenshots

_Generated for [\`${SHORT_SHA}\`](https://github.com/${OWNER_REPO}/commit/${GITHUB_SHA})._

| Empty desktop | Two-track desktop | Two-track mobile |
|---|---|---|
| <img src="${RAW_BASE}/01-empty-desktop.png" width="320"> | <img src="${RAW_BASE}/02-two-tracks-desktop.png" width="320"> | <img src="${RAW_BASE}/03-two-tracks-mobile.png" width="240"> |

_Click an image to open full-size._
EOF

echo "Comment body written to $COMMENT_BODY"
