#!/usr/bin/env bash
# Cloudflare Pages build script
# Injects API keys from Cloudflare environment variables into config.js
# In Cloudflare Pages dashboard: Build command = "bash build.sh", Output directory = "app"

set -e

echo "Generating app/js/config.js from environment variables..."

echo "window.HOMATT_CONFIG = {"                         > app/js/config.js
echo "  GROQ_API_KEY: '${GROQ_API_KEY}',"             >> app/js/config.js
echo "  OPENAI_API_KEY: '${OPENAI_API_KEY}',"         >> app/js/config.js
echo "  GEMINI_API_KEY: '${GEMINI_API_KEY}',"         >> app/js/config.js
echo "};"                                              >> app/js/config.js

echo "Done. config.js contents:"
cat app/js/config.js
