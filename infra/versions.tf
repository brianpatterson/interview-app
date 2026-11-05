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

  # State is local (infra/terraform.tfstate, git-ignored) for now. It holds secrets, so treat it
  # like one. Moving it to Cloudflare R2 (S3-compatible) comes with the backups work.
}

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
