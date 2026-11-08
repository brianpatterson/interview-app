# External monitoring with Better Stack (ADR-0019), free plan: checks from outside our own
# infrastructure, so they still fire when the droplet, Docker or GitHub is the thing that broke.
# Alerts go by email to the Better Stack account owner.

# Uptime: every 3 minutes (the free plan's fastest), from several regions. Alerts only after
# the check fails from more than one location, so a single blip doesn't page anyone.
resource "betteruptime_monitor" "app" {
  pronounceable_name = "Interview App"
  url                = "https://${var.domain}/api/health"
  # "Up" means the API answered and could reach Postgres, not just that Caddy is serving pages.
  monitor_type     = "keyword"
  required_keyword = "\"db\":\"up\""
  check_frequency  = 180
  request_timeout  = 15
  # Also warns 14 days before the TLS certificate expires, i.e. if Caddy's renewals are failing.
  ssl_expiration = 14
  email          = true
}

# Dead man's switch for backups: the nightly backup workflow pings this URL after a backup is
# uploaded and restore-tested. No ping for a day plus 12 hours of grace (GitHub has started
# scheduled runs 8 hours late) means the backup didn't happen, failed, or GitHub disabled it.
resource "betteruptime_heartbeat" "backup" {
  name   = "Nightly backup"
  period = 86400
  grace  = 43200
  email  = true
}
