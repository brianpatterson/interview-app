# DNS-only (grey cloud) for now: Caddy gets certificates directly from Let's Encrypt, and the
# server sees real client IPs. Proxying through Cloudflare is a later, deliberate change.
resource "cloudflare_dns_record" "apex_a" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "A"
  content = digitalocean_reserved_ip.app.ip_address
  ttl     = 300
  proxied = false
}

# The droplet's own IPv6 (DigitalOcean's reserved IPv6 isn't available in every region). It
# changes if the droplet is replaced; the next `tofu apply` updates the record.
resource "cloudflare_dns_record" "apex_aaaa" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "AAAA"
  content = digitalocean_droplet.app.ipv6_address
  ttl     = 300
  proxied = false
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = "www.${var.domain}"
  type    = "CNAME"
  content = var.domain
  ttl     = 300
  proxied = false
}

# Only Let's Encrypt may issue certificates for this domain.
resource "cloudflare_dns_record" "caa" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}
