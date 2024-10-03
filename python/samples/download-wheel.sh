#!/bin/bash

OWNER="Azure-Samples"
REPO="aoai-realtime-audio-sdk"
FILTER="-py3-none-any.whl"
RELEASE="py/v0.4.3"
OUTPUT_DIR="."

API_URL="https://api.github.com/repos/$OWNER/$REPO/releases/tags/$RELEASE"
RELEASE_INFO=$(curl -s -H "Accept: application/vnd.github.v3+json" "$API_URL")

ASSETS=$(echo "$RELEASE_INFO" | jq -r '.assets[] | select(.name | contains("'"$FILTER"'")) | "\(.name) \(.browser_download_url)"')

while read -r NAME URL; do
    echo "Downloading $NAME..."
    curl -L -o "$OUTPUT_DIR/$NAME" "$URL"
    echo "Downloaded $NAME to $OUTPUT_DIR"
done <<< "$ASSETS"

echo "All artifacts downloaded successfully."