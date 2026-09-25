#!/usr/bin/env bash
# T30 clean clone: install, typecheck, test, fixtures, evaluate, Appendix B check.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec npx tsx scripts/clean-clone-check.ts "$@"
