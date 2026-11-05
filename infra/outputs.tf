output "ipv4" {
  description = "Reserved IP (stable across droplet replacement)."
  value       = digitalocean_reserved_ip.app.ip_address
}

output "ipv6" {
  value = digitalocean_droplet.app.ipv6_address
}

output "ssh" {
  description = "Log in as the ops user (sudo)."
  value       = "ssh ops@${digitalocean_reserved_ip.app.ip_address}"
}

output "url" {
  value = "https://${var.domain}"
}

output "known_hosts" {
  description = "known_hosts line for the server (GitHub secret DEPLOY_KNOWN_HOSTS)."
  value       = "${digitalocean_reserved_ip.app.ip_address} ${trimspace(tls_private_key.host.public_key_openssh)}"
}

output "deploy_private_key" {
  description = "Private key for the deploy user (GitHub secret DEPLOY_SSH_KEY). Read with `tofu output -raw deploy_private_key`."
  value       = tls_private_key.deploy.private_key_openssh
  sensitive   = true
}

output "r2_endpoint" {
  description = "S3 API endpoint for R2 (GitHub variable R2_ENDPOINT)."
  value       = local.r2_endpoint
}

output "backup_bucket" {
  description = "Bucket for database backups (GitHub variable R2_BUCKET)."
  value       = cloudflare_r2_bucket.backups.name
}
