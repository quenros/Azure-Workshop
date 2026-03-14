Terraform Resource Reference Guide

We use Terraform (an Infrastructure-as-Code tool) to automatically provision all the cloud resources we need on Microsoft Azure.

Below is a breakdown of the key resources created by our main.tf script and what they do.
1. Resource Group

Resource Block: azurerm_resource_group

    What it is: A logical folder or container that holds related resources for an Azure solution. If you delete the resource group, everything inside it is deleted instantly (which is great for cleaning up after a workshop!).

    Key Parameters:

        name: The designated name for the group (e.g., rgworkshopwy).

        location: The physical data center region where your resources will live (e.g., East US or Southeast Asia).

2. Azure Container Registry (ACR)

Resource Block: azurerm_container_registry

    What it is: A private, secure storage locker for your Docker container images. This is where we push our combined Next.js and Flask monolithic image.

    Key Parameters:

        sku: The pricing tier. We use Basic for cost-effectiveness during the workshop.

        admin_enabled: Set to true so our Web App can easily authenticate and pull the Docker image using a username and password.

3. App Service Plan

Resource Block: azurerm_service_plan

    What it is: The underlying virtual hardware (CPU, RAM) that will run our web application. Think of this as renting the physical server space.

    Key Parameters:

        os_type: Set to Linux since our Docker container is built on a Linux base image.

        sku_name: Set to B1 (Basic). This provides dedicated compute power and allows for Virtual Network (VNet) integration, preventing our heavy AI container from timing out during startup.

4. Linux Web App

Resource Block: azurerm_linux_web_app

    What it is: The actual hosting environment that pulls our Docker container from the registry and runs it on the internet.

    Key Parameters:

        service_plan_id: Links this web app to the hardware we rented in the App Service Plan.

        site_config.application_stack: Tells Azure exactly which Docker image to pull and from which registry URL.

        app_settings: Environment variables injected securely into our container. Most notably, we set "WEBSITES_PORT" = "3000" to tell Azure to route public internet traffic to our Next.js frontend port instead of the default port 80.

5. Storage Account & Blob Containers

Resource Blocks: azurerm_storage_account & azurerm_storage_container

    What it is: Microsoft's massively scalable object storage. We use this to permanently save the raw .pdf documents and .mp4 videos uploaded by users. We split these into two separate containers: documents and videos.

    Key Parameters:

        account_tier: Standard (best for general-purpose storage).

        account_replication_type: LRS (Locally Redundant Storage) to keep costs low by only replicating data within a single data center.

        container_access_type: Set to private for videos (so only our backend Python code can access them) and blob for documents.

6. Azure AI Search

Resource Block: azurerm_search_service

    What it is: The search engine powering our RAG (Retrieval-Augmented Generation) Chatbot. It stores the extracted text and vectors from our documents and video transcripts.

    Key Parameters:

        sku: Basic or Standard, providing the necessary indexing power and vector search capabilities to find relevant context for the AI.