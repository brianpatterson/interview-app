terraform {
  required_version = ">= 1.8"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # State lives in R2, encrypted on this machine before upload, so neither Cloudflare nor anyone
  # with the bucket token can read the secrets in it. Locked with a lock file while a command
  # runs. ADR-0016; setup in README.md.
  backend "s3" {
    bucket    = "${replace(var.domain, ".", "-")}-tofu-state"
    key       = "production/terraform.tfstate"
    region    = "auto"
    endpoints = { s3 = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com" }
    # R2 credentials come from this profile in ~/.aws/credentials. The backend block can't take
    # sensitive variables, and keeping them out of terraform.tfvars keeps them out of this repo.
    profile      = "roundtable-tofu-state"
    use_lockfile = true
    # R2 speaks the S3 API but isn't AWS: skip the AWS-only checks and checksums.
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    # Enforced: OpenTofu refuses to write the state unencrypted.
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    # Saved plans (tfplan) hold the same secrets.
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
