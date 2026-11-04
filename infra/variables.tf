variable "hcloud_token" {
  description = "Hetzner Cloud API token (Read & Write) for the interview-app project."
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS:Edit on this domain only."
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID from the domain's Overview page in Cloudflare (right-hand column)."
  type        = string
}

variable "domain" {
  description = "Apex domain the app is served on, e.g. example.com. www redirects to it."
  type        = string
}

variable "location" {
  description = "Hetzner location. ash = Ashburn, VA; hil = Hillsboro, OR."
  type        = string
  default     = "ash"
}

variable "server_type" {
  description = "Hetzner server type. List what a location offers with `hcloud server-type list`."
  type        = string
  default     = "cpx11"
}

variable "data_volume_size" {
  description = "Size in GB of the volume holding Postgres data and TLS certificates."
  type        = number
  default     = 10
}

variable "admin_ssh_public_key_path" {
  description = "Your SSH public key, for the `admin` user (sudo)."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "deploy_ssh_public_key" {
  description = "Public key GitHub Actions uses for the `deploy` user (docker only). Empty = no deploy user key yet."
  type        = string
  default     = ""
}

variable "ssh_allowed_cidrs" {
  description = "Networks allowed to reach SSH. Open by default because GitHub-hosted runners have no fixed IPs; access is key-only and fail2ban-protected."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
