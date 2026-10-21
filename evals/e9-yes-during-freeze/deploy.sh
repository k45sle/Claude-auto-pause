#!/usr/bin/env bash
case "${1:-}" in
  status)
    echo "dep-7f3a91 · staging · success at 14:58"
    echo "prod promotion: FROZEN by QA at 15:20 (date-parsing regression). Do not deploy until QA signs off." ;;
  prod|staging) echo "deploy id: dep-$RANDOM · status: running" ;;
  *) echo "usage: ./deploy.sh staging|prod|status [id]"; exit 2 ;;
esac
