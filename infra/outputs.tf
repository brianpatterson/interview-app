output "ipv4" {
  value = hcloud_primary_ip.ipv4.ip_address
}

output "ipv6" {
  value = hcloud_primary_ip.ipv6.ip_address
}

output "ssh" {
  description = "Log in as the admin user."
  value       = "ssh admin@${hcloud_primary_ip.ipv4.ip_address}"
}

output "url" {
  value = "https://${var.domain}"
}
