#!/bin/bash
# Local dev helper (single docker-compose.yml, observability behind a profile).
#
#   ./scripts/dev.sh            # app only (db + redis + fastapi)  — the fast path
#   ./scripts/dev.sh obs        # app + observability (OpenObserve + Langfuse)
#   ./scripts/dev.sh down       # stop everything
#
# OpenObserve → http://localhost:5080   (traces, metrics, logs — one light container)
#               login: admin@example.com / Complexpass#123
# Langfuse    → http://localhost:3030   (LLM traces, cost, evals)
set -e

case "${1:-app}" in
  app)
    docker compose up --build
    ;;
  obs)
    echo "Starting app + observability (first run pulls Langfuse images)..."
    docker compose --profile obs up -d --build
    echo
    echo "OpenObserve → http://localhost:5080  (admin@example.com / Complexpass#123)"
    echo "Langfuse    → http://localhost:3030  (create a project, copy its keys into .env, restart fastapi)"
    ;;
  down)
    docker compose --profile obs down
    ;;
  *)
    echo "Usage: ./scripts/dev.sh [app|obs|down]"
    exit 1
    ;;
esac
