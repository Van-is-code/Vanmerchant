#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-admin@103.157.204.155}"
REPO_DIR="${REPO_DIR:-/var/www/vanmerchant}"
BRANCH="${BRANCH:-master}"

echo "==> Push local branch to origin/${BRANCH}"
git push origin "${BRANCH}"

echo "==> Trigger remote deployment"
ssh "${REMOTE_HOST}" "cd '${REPO_DIR}' && REPO_URL='https://github.com/Van-is-code/Vanmerchant.git' BRANCH='${BRANCH}' bash scripts/vps_bootstrap_deploy.sh"

echo "==> Release complete"
