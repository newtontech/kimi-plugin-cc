#!/usr/bin/env node
// Session lifecycle hook for kimi-plugin-cc
// Logs session start/end events (lightweight, no-op by default)
const event = process.argv[2] || "unknown";
// Silent on success - only log on error
process.exit(0);
