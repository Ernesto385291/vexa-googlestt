# Self-Hosted Vexa Management Guide

Essential user and token management for self-hosted Vexa deployments.

## Prerequisites

- **Base URL**: `http://localhost:18056` (default port from `.env`)
- **Admin Token**: `ADMIN_API_TOKEN=token` (default, check your `.env` file)

**For Python examples**, install the client:
```bash
pip install vexa-client
```

**Before starting**, ensure Vexa services are running - see the [Deployment Guide](deployment.md) for setup instructions.

Admin endpoints use `/admin/` prefix with `X-Admin-API-Key` header.

## 1. Create User

Create a new user or return existing user if email already exists.

### Using curl

```bash
curl -X POST http://localhost:18056/admin/users \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: token" \
  -d '{
    "email": "user@example.com",
    "name": "John Doe",
    "max_concurrent_bots": 2
  }'
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "John Doe",
  "max_concurrent_bots": 2,
  "created_at": "2025-10-10T12:00:00Z"
}
```

### Using Python

```python
from vexa_client import VexaClient

admin_client = VexaClient(
    base_url="http://localhost:18056",
    admin_key="token"
)

user = admin_client.create_user(
    email="user@example.com",
    name="John Doe",
    max_concurrent_bots=2
)

print(f"Created user: {user['email']} (ID: {user['id']})")
```

**Parameters:**
- `email` (required): User's email address
- `name` (optional): User's display name
- `max_concurrent_bots` (optional): Maximum concurrent bots (default: 0)

## 2. Create API Token

Generate an API token for a user to access the API.

### Using curl

```bash
# Replace USER_ID with the user's ID from step 1
curl -X POST http://localhost:18056/admin/users/1/tokens \
  -H "X-Admin-API-Key: token"
```

**Response:**
```json
{
  "id": 1,
  "token": "AbCdEf1234567890AbCdEf1234567890AbCdEf12",
  "user_id": 1,
  "created_at": "2025-10-10T12:00:00Z"
}
```

### Using Python

```python
token_info = admin_client.create_token(user_id=user['id'])

print(f"API token: {token_info['token']}")
# Save this token - it cannot be retrieved later!
```

**⚠️ Important:** Save the token immediately - it cannot be retrieved later.

## Complete Workflow Example

### Using curl

```bash
# Step 1: Create user
USER_RESPONSE=$(curl -s -X POST http://localhost:18056/admin/users \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: token" \
  -d '{
    "email": "newuser@example.com",
    "name": "New User",
    "max_concurrent_bots": 2
  }')

USER_ID=$(echo $USER_RESPONSE | jq -r '.id')
echo "Created user with ID: $USER_ID"

# Step 2: Generate API token
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:18056/admin/users/${USER_ID}/tokens \
  -H "X-Admin-API-Key: token")

API_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.token')
echo "Generated token: $API_TOKEN"

# Step 3: Test user API access
curl -X GET "http://localhost:18056/meetings" \
  -H "X-API-Key: $API_TOKEN"
```

### Using Python

```python
from vexa_client import VexaClient

# Step 1: Create user
admin_client = VexaClient(base_url="http://localhost:18056", admin_key="token")

user = admin_client.create_user(
    email="newuser@example.com",
    name="New User",
    max_concurrent_bots=2
)
print(f"✓ Created user: {user['email']}")

# Step 2: Generate token
token_info = admin_client.create_token(user_id=user['id'])
api_token = token_info['token']
print(f"✓ Generated token: {api_token}")

# Step 3: Test user access
user_client = VexaClient(base_url="http://localhost:18056", api_key=api_token)
meetings = user_client.get_meetings()
print(f"✓ User API access working!")
```

## Other User Management Operations

### Get User by Email

**curl:**
```bash
curl -X GET "http://localhost:18056/admin/users/email/user@example.com" \
  -H "X-Admin-API-Key: token"
```

**Python:**
```python
user = admin_client.get_user_by_email("user@example.com")
print(f"User ID: {user['id']}, Bots: {user['max_concurrent_bots']}")
```

### Get User by ID

**curl:**
```bash
curl -X GET "http://localhost:18056/admin/users/1" \
  -H "X-Admin-API-Key: token"
```

Returns detailed user information including API tokens.

### List All Users

**curl:**
```bash
curl -X GET "http://localhost:18056/admin/users?skip=0&limit=100" \
  -H "X-Admin-API-Key: token"
```

**Python:**
```python
users = admin_client.list_users(skip=0, limit=100)
for user in users:
    print(f"{user['email']}: {user['max_concurrent_bots']} bots")
```

### Update User

Update user settings such as concurrent bot limits.

**curl:**
```bash
curl -X PATCH http://localhost:18056/admin/users/1 \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: token" \
  -d '{
    "max_concurrent_bots": 5
  }'
```

**Python:**
```python
user = admin_client.get_user_by_email("user@example.com")

updated_user = admin_client.update_user(
    user_id=user['id'],
    max_concurrent_bots=5
)

print(f"Updated bot limit to {updated_user['max_concurrent_bots']}")
```

**Updatable Fields:**
- `name`: User's display name
- `max_concurrent_bots`: Maximum concurrent bots
- `image_url`: User's profile image URL
- `data`: Custom JSONB data (advanced)

### Revoke Token

**curl:**
```bash
# Delete token by ID
curl -X DELETE http://localhost:18056/admin/tokens/1 \
  -H "X-Admin-API-Key: token"
```

**Note:** Token deletion is immediate and cannot be undone.

## Token Security Best Practices

1. **Secure Distribution**: Share tokens via secure channels
2. **Rotate Regularly**: For production deployments, rotate tokens periodically
3. **Revoke Compromised Tokens**: Immediately delete tokens if compromised
4. **Monitor Usage**: Track token usage through meeting logs

## Troubleshooting

### Common Issues

**"Invalid or missing admin token"**
- Check your `.env` file for `ADMIN_API_TOKEN`
- Ensure you're using `X-Admin-API-Key` header (not `X-API-Key`)

**"User not found"**
- Verify user was created successfully
- Check user ID/email spelling
- Use `GET /admin/users` to list all users

**"Connection refused"**
- Ensure services are running: `make ps`
- Check API Gateway is healthy: `curl http://localhost:18056/`

**Token not working for user API**
- Verify token was copied correctly
- Ensure using `X-API-Key` header (not `X-Admin-API-Key`)
- Check token wasn't deleted

## Reference Links

- **API Gateway Docs**: http://localhost:18056/docs
- **Deployment Guide**: [deployment.md](deployment.md)
- **Notebooks**: `nbs/manage_users.ipynb`, `nbs/0_basic_test.ipynb`

## Getting Help

- **Discord**: https://discord.gg/Ga9duGkVz9
- **GitHub Issues**: https://github.com/Vexa-ai/vexa/issues

---

**Note**: For complete API documentation including bot management and transcription endpoints, see http://localhost:18056/docs
