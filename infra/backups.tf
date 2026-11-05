# Off-site storage on Cloudflare R2: a different company and region than the droplet, so losing
# the droplet, its volume or the DigitalOcean account doesn't lose the data. ADR-0015.

locals {
  r2_endpoint = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
  bucket_slug = replace(var.domain, ".", "-")
}

# Nightly encrypted database dumps, written by .github/workflows/backup.yml.
resource "cloudflare_r2_bucket" "backups" {
  account_id = var.cloudflare_account_id
  name       = "${local.bucket_slug}-backups"
  location   = "enam" # location hint: eastern North America, near the droplet in nyc3

  lifecycle {
    prevent_destroy = true
  }
}

# Retention: keep 30 days of dailies, then R2 deletes them. Also clean up abandoned uploads.
resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.backups.name
  rules = [{
    id         = "expire-after-30-days"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 30 * 24 * 3600 }
    }
    abort_multipart_uploads_transition = {
      condition = { type = "Age", max_age = 24 * 3600 }
    }
  }]
}

# Write-once for 7 days: nobody, including whoever holds the upload token, can delete or overwrite
# a backup during its first week. Protects against a leaked token or a buggy script wiping them.
resource "cloudflare_r2_bucket_lock" "backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.backups.name
  rules = [{
    id        = "write-once-7-days"
    enabled   = true
    prefix    = ""
    condition = { type = "Age", max_age_seconds = 7 * 24 * 3600 }
  }]
}

# OpenTofu's own state, moved here from the laptop in a follow-up (the bucket has to exist first).
resource "cloudflare_r2_bucket" "tofu_state" {
  account_id = var.cloudflare_account_id
  name       = "${local.bucket_slug}-tofu-state"
  location   = "enam"

  lifecycle {
    prevent_destroy = true
  }
}
