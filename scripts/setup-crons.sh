#!/bin/bash
# Copyright (c) 2026 Asir Khan. All rights reserved.
# Licensed under the Business Source License 1.1. See LICENSE file for details.

# Cron Job Installation for Festie
# Sets up automated health monitoring, error tracking, and deployment tasks
# Usage: bash scripts/setup-crons.sh

set -e

echo "📋 Festie Cron Job Setup"
echo "══════════════════════════════════════════════════════════════════"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Verify cron scripts exist
if [ ! -f "$script_dir/scripts/health-monitor.js" ]; then
  echo "❌ Error: scripts/health-monitor.js not found"
  echo "   Please create this script to monitor server health"
  exit 1
fi

if [ ! -f "$script_dir/scripts/error-rate-alert.cjs" ]; then
  echo "❌ Error: scripts/error-rate-alert.cjs not found"
  echo "   Please create this script to track error rates"
  exit 1
fi

if [ ! -f "$script_dir/scripts/auto-deploy.sh" ]; then
  echo "❌ Error: scripts/auto-deploy.sh not found"
  echo "   Please create this script for deployment automation"
  exit 1
fi

echo ""
echo "Recommended Crontab Entries:"
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "# Health check every 5 minutes (check uptime, memory, DB connection)"
echo "*/5 * * * * cd $script_dir && node scripts/health-monitor.js >> logs/cron-health.log 2>&1"
echo ""
echo "# Error rate alert every 5 minutes (check for sudden error spikes)"
echo "*/5 * * * * cd $script_dir && node scripts/error-rate-alert.cjs >> logs/cron-errors.log 2>&1"
echo ""
echo "# Auto-deploy check every 2 minutes (check for pending updates)"
echo "*/2 * * * * cd $script_dir && bash scripts/auto-deploy.sh >> logs/cron-deploy.log 2>&1"
echo ""
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "Installation Steps:"
echo ""
echo "1. Open your crontab editor:"
echo "   crontab -e"
echo ""
echo "2. Add the cron entries above to your crontab"
echo ""
echo "3. Create logs directory if it doesn't exist:"
echo "   mkdir -p $script_dir/logs"
echo ""
echo "4. Verify installation:"
echo "   crontab -l  # should show your new entries"
echo ""
echo "5. Monitor cron logs:"
echo "   tail -f $script_dir/logs/cron-health.log"
echo "   tail -f $script_dir/logs/cron-errors.log"
echo "   tail -f $script_dir/logs/cron-deploy.log"
echo ""
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "🔍 Health Monitor (scripts/health-monitor.js)"
echo "   Checks:"
echo "   • Server uptime and responsiveness"
echo "   • Memory usage (alert if > 80%)"
echo "   • Database connection pool stats"
echo "   • Redis connectivity"
echo ""
echo "⚠️  Error Rate Alert (scripts/error-rate-alert.js)"
echo "   Checks:"
echo "   • Error request rate (5xx, 4xx errors)"
echo "   • Error spike detection (>3x average)"
echo "   • Slow query detection"
echo "   • Triggers alerts to ops channel"
echo ""
echo "🚀 Auto-Deploy (scripts/auto-deploy.sh)"
echo "   Checks:"
echo "   • Git for new commits on main"
echo "   • Runs tests (npm test)"
echo "   • Updates and restarts via PM2"
echo ""
echo "Notes:"
echo "  • All scripts use env variables: DATABASE_URL, REDIS_URL, SLACK_WEBHOOK"
echo "  • Create .env file with these variables for cron to work properly"
echo "  • Ensure cron user has permission to: restart PM2, read .env, write logs"
echo "  • Logs in logs/ directory rotate weekly (implement logrotate separately)"
echo ""
