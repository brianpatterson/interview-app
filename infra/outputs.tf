output "ipv4" {
  description = "Reserved IP (stable across droplet replacement)."
  value       = digitalocean_reserved_ip.app.ip_address
}

output "ipv6" {
  value = digitalocean_droplet.app.ipv6_address
}

output "ssh" {
  description = "Log in as the admin user."
  value       = "ssh admin@${digitalocean_reserved_ip.app.ip_address}"
}

output "url" {
  value = "https://${var.domain}"
}
