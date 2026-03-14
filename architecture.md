# Azure Workshop - Infrastructure Architecture

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Azure Subscription                            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │           Resource Group: workshop-rg-{suffix}                  │ │
│  │                                                                 │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │  Web App (Python) - workshop-webapp-{suffix}              │ │ │
│  │  │  ┌────────────────────────────────────────────────────┐   │ │ │
│  │  │  │  App Service Plan: F1 (Free Tier)                  │   │ │ │
│  │  │  │  - OS: Linux                                        │   │ │ │
│  │  │  │  - Runtime: Python 3.11                             │   │ │ │
│  │  │  │  - Managed Identity: Enabled                        │   │ │ │
│  │  │  └────────────────────────────────────────────────────┘   │ │ │
│  │  └────────────────┬──────────┬──────────┬────────────────────┘ │ │
│  │                   │          │          │                       │ │
│  │                   │          │          │                       │ │
│  │  ┌────────────────▼──┐  ┌───▼─────┐  ┌─▼──────────────────┐   │ │
│  │  │ Storage Account   │  │   ACR   │  │   AI Search        │   │ │
│  │  │ {prefix}storage   │  │ {prefix}│  │ {prefix}-aisearch  │   │ │
│  │  │                   │  │   acr   │  │                    │   │ │
│  │  │ - Blob Container  │  │         │  │ - Free Tier        │   │ │
│  │  │   "uploads"       │  │ - Basic │  │ - 3 Indexes Max    │   │ │
│  │  │ - Standard LRS    │  │ - Admin │  │ - 50 MB Storage    │   │ │
│  │  │ - CORS Enabled    │  │ Enabled │  │                    │   │ │
│  │  └───────────────────┘  └─────────┘  └────────────────────┘   │ │
│  │                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. File Upload Flow
```
User Browser
    │
    ▼
Web App (Python)
    │
    ├─► Storage Account
    │   └─► Blob Container: "uploads"
    │
    └─► AI Search
        └─► Index uploaded content
```

### 2. Chat/Query Flow
```
User Browser
    │
    ▼
Web App (Python)
    │
    ├─► AI Search
    │   └─► Query indexed documents
    │
    └─► Azure OpenAI (optional)
        └─► Generate AI responses
```

### 3. Container Image Flow
```
Developer Machine
    │
    ▼
Container Registry (ACR)
    │
    ▼
Web App
    └─► Pull and deploy container
```

## Security Architecture (Optional)

### Managed Identity
```
Web App (System-Assigned Identity)
    │
    ├─► Storage Account
    │   └─► Role: Storage Blob Data Contributor
    │
    └─► Container Registry
        └─► Role: AcrPull
```

### Network Security
- **HTTPS Only**: All traffic encrypted
- **CORS**: Configured for web access
- **Access Keys**: Stored as app settings in Azure (not in code)

## 📦 Resource Dependencies

```
Resource Group
    │
    ├─► App Service Plan
    │   └─► Web App
    │
    ├─► Storage Account
    │   └─► Blob Container
    │
    ├─► Container Registry
    │
    └─► AI Search
```

## Resource Tiers & Limits

### App Service Plan (F1)
| Feature | Limit |
|---------|-------|
| RAM | 1 GB |
| CPU | 60 min/day |
| Storage | 1 GB |

### Storage Account (Standard LRS)
| Feature | Limit |
|---------|-------|
| Redundancy | Locally Redundant |
| IOPS | 20,000 |
| Bandwidth | 60 GB/s |
| Max Blob Size | 190.7 TB |

### Container Registry (Basic)
| Feature | Limit |
|---------|-------|
| Storage | 10 GB |
| Webhooks | 2 |
| Replications | 0 |

### AI Search (Free)
| Feature | Limit |
|---------|-------|
| Storage | 50 MB |
| Indexes | 3 |
| Indexers | 3 |
| Documents | 10,000 |

## Network Architecture

**Current Configuration**: Public endpoints for workshop simplicity

## Scalability Options

### Current (Free Tier)
- **Vertical**: Upgrade to B1/S1/P1V2 plans
- **Horizontal**: Add more instances (requires paid tier)

### Upgrade Path
```
F1 (Free)
    ▼
B1 (Basic) - $13/month
    ▼
S1 (Standard) - $70/month
    ▼
P1V2 (Premium) - $120/month
```

## Deployment Flow

```
1. terraform init
   └─► Download providers
   └─► Initialize backend

2. terraform plan
   └─► Preview changes
   └─► Validate configuration

3. terraform apply
   └─► Create Resource Group
   └─► Create App Service Plan
   └─► Create Web App
   └─► Create Storage Account
   └─► Create Container Registry
   └─► Create AI Search
   └─► Configure Role Assignments
   └─► Set App Settings

4. Post-deployment
   └─► Deploy application code
   └─► Upload sample data
   └─► Test endpoints
```

## Cost Optimization Tips

1. **Use Free Tiers**: F1 App Service, Free AI Search
2. **LRS Storage**: Cheapest replication option
3. **Basic ACR**: Sufficient for development
5. **Delete when idle**: Use `terraform destroy` after workshop

## Learning Resources

- **App Service**: [Quickstart Guide](https://docs.microsoft.com/azure/app-service/)
- **Storage**: [Blob Storage Guide](https://docs.microsoft.com/azure/storage/blobs/)
- **ACR**: [Container Registry Docs](https://docs.microsoft.com/azure/container-registry/)
- **AI Search**: [Cognitive Search Docs](https://docs.microsoft.com/azure/search/)
