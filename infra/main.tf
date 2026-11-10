locals {
  name = "roundtable"
  tags = ["roundtable", "opentofu"]
  # The data volume keeps the app's original name: DigitalOcean can't rename a volume, so a new
  # name means a new (empty) volume, and its device path is baked into cloud-init, so changing
  # it would also replace the droplet. See docs/adr/0020-rename-to-roundtable.md.
  volume_name = "interview-app-data"
  # DigitalOcean exposes a volume by name at this stable path.
  volume_device = "/dev/disk/by-id/scsi-0DO_Volume_${local.volume_name}"
}

# Groups everything in the DigitalOcean console.
resource "digitalocean_project" "app" {
  name        = local.name
  description = "Roundtable production"
  purpose     = "Web Application"
  environment = "Production"
  resources = [
    digitalocean_droplet.app.urn,
    digitalocean_volume.data.urn,
    digitalocean_reserved_ip.app.urn,
  ]
}

resource "digitalocean_ssh_key" "admin" {
  name       = "${local.name}-admin"
  public_key = file(pathexpand(var.admin_ssh_public_key_path))
}

# Postgres data and certificates live here, not on the droplet's disk, so the droplet is
# disposable: replace it and the data reattaches. DigitalOcean volumes have no delete protection,
# so prevent_destroy makes OpenTofu refuse to delete it.
resource "digitalocean_volume" "data" {
  name                    = local.volume_name
  region                  = var.region
  size                    = var.data_volume_size
  initial_filesystem_type = "ext4"
  description             = "Postgres data and Caddy certificates"
  tags                    = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_droplet" "app" {
  name       = local.name
  region     = var.region
  size       = var.droplet_size
  image      = "ubuntu-24-04-x64"
  ssh_keys   = [digitalocean_ssh_key.admin.fingerprint]
  ipv6       = true
  monitoring = true # free CPU/memory/disk metrics and alerting in the DO console
  tags       = local.tags

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    admin_ssh_public_key  = trimspace(file(pathexpand(var.admin_ssh_public_key_path)))
    deploy_ssh_public_key = trimspace(tls_private_key.deploy.public_key_openssh)
    host_private_key      = tls_private_key.host.private_key_openssh
    host_public_key       = trimspace(tls_private_key.host.public_key_openssh)
    volume_device         = local.volume_device
  })
}

resource "digitalocean_volume_attachment" "data" {
  droplet_id = digitalocean_droplet.app.id
  volume_id  = digitalocean_volume.data.id
}

# A reserved IP is a separate resource so the address (and the DNS record pointing at it)
# survives replacing the droplet. Free while assigned.
resource "digitalocean_reserved_ip" "app" {
  region = var.region
}

resource "digitalocean_reserved_ip_assignment" "app" {
  ip_address = digitalocean_reserved_ip.app.ip_address
  droplet_id = digitalocean_droplet.app.id
}

resource "digitalocean_firewall" "app" {
  name        = local.name
  droplet_ids = [digitalocean_droplet.app.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_cidrs
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "udp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # DigitalOcean firewalls block all outbound traffic unless it's allowed explicitly. The server
  # needs it for apt, image pulls, Let's Encrypt and OAuth calls.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
