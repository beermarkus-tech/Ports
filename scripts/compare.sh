#!/usr/bin/env bash
# Run the balance report for both bot policies and print the headline numbers.
# Usage: scripts/compare.sh [legs] [seeds]
set -euo pipefail
legs="${1:-10}"
seeds="${2:-300}"
for policy in greedy casual; do
  out="$(npx tsx scripts/balance.ts "$legs" "$seeds" "$policy")"
  echo "$policy: $(echo "$out" | sed -n 2p | sed 's/Final cash *//') | $(echo "$out" | sed -n 4p | sed 's/ *Close.*//')"
done
