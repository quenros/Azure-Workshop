# ============================================
# TERRAFORM CONFIGURATION
# ============================================

terraform {
  required_version = ">= 1.0"
  
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

# ============================================
# LOCALS (Auto-generates names without hyphens)
# ============================================
locals {
  rg_name       = "rg${var.base_name}"
  acr_name      = "cr${var.base_name}"
  app_plan_name = "asp${var.base_name}"
  web_app_name  = "app${var.base_name}"
  storage_name  = "st${var.base_name}"
  search_name   = "srch${var.base_name}"
}


# ============================================
# 1. RESOURCE GROUP
# ============================================

resource "azurerm_resource_group" "main" {
  name     = local.rg_name
  location = var.location
  tags     = var.tags
}

# ============================================
# 2. APP SERVICE PLAN (B1 Tier)
# ============================================

resource "azurerm_service_plan" "main" {
  name                = local.app_plan_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "B1" 
  tags                = var.tags
}

# ============================================
# 3. WEB APP (Linux + Docker)
# ============================================

resource "azurerm_linux_web_app" "main" {
  name                = local.web_app_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  service_plan_id     = azurerm_service_plan.main.id
  tags                = var.tags

  site_config {
    always_on = false

    application_stack {
      docker_image_name   = "unified:latest"
      docker_registry_url = "https://${azurerm_container_registry.main.login_server}"

      docker_registry_username = azurerm_container_registry.main.admin_username
      docker_registry_password = azurerm_container_registry.main.admin_password
    }
  }

  app_settings = {
    "AZURE_STORAGE_CONNECTION_STRING" = azurerm_storage_account.main.primary_connection_string
    "AZURE_STORAGE_ACCOUNT_NAME"      = azurerm_storage_account.main.name
    "AZURE_STORAGE_ACCOUNT_KEY"       = azurerm_storage_account.main.primary_access_key
    "BLOB_CONTAINER_NAME"             = "documents"
    
    "ACR_LOGIN_SERVER"   = azurerm_container_registry.main.login_server
    "ACR_USERNAME"       = azurerm_container_registry.main.admin_username
    "ACR_PASSWORD"       = azurerm_container_registry.main.admin_password
    
    "AI_SEARCH_ENDPOINT" = "https://${azurerm_search_service.main.name}.search.windows.net"
    "AI_SEARCH_KEY"      = azurerm_search_service.main.primary_key
    
    "WORKSHOP_MODE"      = "true"
    "WEBSITES_PORT"      = "3000" # Routes traffic to Next.js
  }

  identity {
    type = "SystemAssigned"
  }

  https_only = true
}

# ============================================
# 4. STORAGE ACCOUNT
# ============================================
resource "azurerm_storage_account" "main" {
  name                     = local.storage_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = var.tags

  allow_nested_items_to_be_public = true
  
  blob_properties {
    cors_rule {
      allowed_origins    = ["*"]
      allowed_methods    = ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"]
      allowed_headers    = ["*"]
      exposed_headers    = ["*"]
      max_age_in_seconds = 3600
    }
  }
}

resource "azurerm_storage_container" "uploads" {
  name                  = "documents"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "blob" 
}

resource "azurerm_storage_container" "videos" {
  name                  = "videos"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private" 
}

# ============================================
# 5. CONTAINER REGISTRY (Basic Tier)
# ============================================
resource "azurerm_container_registry" "main" {
  name                = local.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true
  tags                = var.tags
}

# ============================================
# 6. AI SEARCH (Basic Tier)
# ============================================
resource "azurerm_search_service" "main" {
  name                = local.search_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "basic"
  tags                = var.tags

  replica_count   = 1
  partition_count = 1
}

# ============================================
# ROLE ASSIGNMENTS
# ============================================

resource "azurerm_role_assignment" "webapp_storage" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}

resource "azurerm_role_assignment" "webapp_acr" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}

# ============================================
# 7. AUTO-GENERATE .ENV FILE
# ============================================

resource "local_file" "env_file" {
  # This creates the .env file in the same folder as your Terraform scripts
  filename = "${path.module}/backend/.env"
  
  content  = <<-EOT
# ==========================================
# AZURE STORAGE SETTINGS
# ==========================================
AZURE_STORAGE_CONNECTION_STRING="${azurerm_storage_account.main.primary_connection_string}"
BLOB_CONTAINER_NAME="${azurerm_storage_container.uploads.name}"

# ==========================================
# AZURE AI SEARCH SETTINGS
# ==========================================
AI_SEARCH_ENDPOINT="https://${azurerm_search_service.main.name}.search.windows.net"
AI_SEARCH_KEY="${azurerm_search_service.main.primary_key}"
AI_SEARCH_INDEX_NAME="documents-index"
  EOT
}