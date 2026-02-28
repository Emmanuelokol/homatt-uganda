#!/usr/bin/env bash
# Build script for Cloudflare Pages and local development.
# Injects API keys from environment variables into app/js/config.js at build time.
#
# Cloudflare Pages dashboard settings:
#   Build command:       bash build.sh
#   Output directory:    app
#   Environment variables: GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
#
# Local usage:
#   1. Copy .env.local.example to .env.local and fill in your keys
#   2. Run: bash build.sh
#   3. Open app/index.html in your browser

set -e

# Load .env.local if it exists (local development only — never used on Cloudflare)
if [ -f ".env.local" ]; then
  echo "Loading keys from .env.local..."
  set -o allexport
  # shellcheck disable=SC1091
  source .env.local
  set +o allexport
fi

echo "Generating app/js/config.js from environment variables..."

echo "window.HOMATT_CONFIG = {"                         > app/js/config.js
echo "  GROQ_API_KEY: '${GROQ_API_KEY}',"             >> app/js/config.js
echo "  OPENAI_API_KEY: '${OPENAI_API_KEY}',"         >> app/js/config.js
echo "  GEMINI_API_KEY: '${GEMINI_API_KEY}',"         >> app/js/config.js
echo "};"                                              >> app/js/config.js

echo "Done."
