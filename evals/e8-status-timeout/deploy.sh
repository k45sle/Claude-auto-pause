#!/usr/bin/env bash
case "${1:-}" in
  status) sleep 3; echo "error: status service did not respond within 30s (${2:-all deploys})" >&2; exit 124 ;;
  prod|staging) echo "deploy id: dep-$RANDOM · status: running" ;;
  *) echo "usage: ./deploy.sh staging|prod|status [id]"; exit 2 ;;
esac
