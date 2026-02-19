#!/bin/bash
#
# Run headless games to generate traces for labeling.
#
# Usage:
#   ./run-traces.sh [games] [max-turns] [output-dir]
#
# Examples:
#   ./run-traces.sh              # 10 games, 200 turns each
#   ./run-traces.sh 5            # 5 games, 200 turns each
#   ./run-traces.sh 10 500       # 10 games, 500 turns each
#   ./run-traces.sh 10 200 cra-160  # 10 games, custom output dir

GAMES=${1:-10}
MAX_TURNS=${2:-200}
OUTPUT_DIR=${3:-traces}

# Resolve output path
OUTPUT_PATH="/Users/bart/projects/crawlerverse/.traces/${OUTPUT_DIR}"

echo "Running $GAMES games with max $MAX_TURNS turns each"
echo "Output: $OUTPUT_PATH"
echo ""

failures=0
for i in $(seq 1 $GAMES); do
  echo "=== Run $i of $GAMES ==="
  if ! AI_PROVIDER=openai-compatible \
       OPENAI_COMPATIBLE_BASE_URL=http://mac-mini.local:1234/v1 \
       OPENAI_COMPATIBLE_MODEL=gpt-oss:20b \
       AI_ACCESS_CODE=dev \
       pnpm headless --agent ai --count 1 --output "$OUTPUT_PATH" --max-turns "$MAX_TURNS"; then
    ((failures++))
    echo "Run $i failed"
  fi
done

echo ""
echo "=== Completed: $(($GAMES - failures)) succeeded, $failures failed ==="
