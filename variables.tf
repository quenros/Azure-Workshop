variable "base_name" {
  description = "Base name for all resources (lowercase, NO hyphens, NO spaces, max 15 chars)"
  type        = string
}

variable "location" {
  description = "The Azure region where resources will be deployed."
  type        = string
  default     = "southeastasia"
}

variable "tags" {
  description = "Tags to organize the resources."
  type        = map(string)
  default = {
    environment = "workshop"
    project     = "workshop"
  }
}