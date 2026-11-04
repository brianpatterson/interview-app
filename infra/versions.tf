terraform {
  required_version = ">= 1.8"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.70"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }

  # State is local (infra/terraform.tfstate, git-ignored) for now. It holds secrets, so treat it
  # like one. Moving it to an S3-compatible backend (Hetzner Object Storage) is on the roadmap.
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
