#!/bin/bash
# Vercel Ignore Command: 
# Exit code 1 (or any non-zero) CONTINUE with the build
# Exit code 0 SKIP the build

echo "Running tests before allowing deployment..."

if npm run test; then
  echo "Tests passed! Allowing deployment."
  exit 1
else
  echo "Tests failed! Canceling deployment."
  exit 0
fi
