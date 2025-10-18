.PHONY: all setup submodules env force-env build-bot-image build up down ps logs test test-api test-setup migrate makemigrations init-db stamp-db migrate-or-init

# Default target: Sets up everything and starts the services
all: setup-env build-bot-image build up migrate-or-init test

# Target to set up only the environment without Docker
# Ensure .env is created before other setup steps
setup-env: env submodules
	@echo "Environment setup complete."
	@echo "The 'env' target (now called by setup-env) handles .env creation/preservation:"
	@echo "  - If .env exists, it is preserved."
	@echo "  - If .env does not exist, it is created from env-example (or generated with defaults)."
	@echo "  - Update GOOGLE_APPLICATION_CREDENTIALS_JSON_B64 in .env with your base64-encoded Google service account JSON."
	@echo "To force an overwrite of an existing .env file, use 'make force-env'."

# Target to perform all initial setup steps
setup: setup-env build-bot-image
	@echo "Setup complete."

# Initialize and update Git submodules
submodules:
	@echo "---> Initializing and updating Git submodules..."
	@git submodule update --init --recursive

# Default bot image tag if not specified in .env
BOT_IMAGE_NAME ?= vexa-bot:dev

# Check if Docker daemon is running
check_docker:
	@echo "---> Checking if Docker is running..."
	@if ! docker info > /dev/null 2>&1; then \
	    echo "ERROR: Docker is not running. Please start Docker Desktop or Docker daemon first."; \
	    exit 1; \
	fi
	@echo "---> Docker is running."

# Include .env file if it exists for environment variables 
-include .env

# Create .env file from example
env:
	@echo "---> Checking for existing .env file..."
	@if [ -f .env ]; then \
	    echo "*** .env file already exists. Keeping existing file. ***"; \
	    echo "*** To force recreation, delete .env first or use 'make force-env'. ***"; \
	else \
	    if [ ! -f env-example ]; then \
	        echo "env-example not found. Creating default one."; \
	        echo "ADMIN_API_TOKEN=token" > env-example; \
	        echo "BOT_IMAGE_NAME=vexa-bot:dev" >> env-example; \
	        echo "DEVICE_TYPE=cpu" >> env-example; \
	        echo "GOOGLE_APPLICATION_CREDENTIALS_JSON_B64=" >> env-example; \
	        echo "GOOGLE_CLOUD_PROJECT=" >> env-example; \
	        echo "# Exposed Host Ports" >> env-example; \
	        echo "API_GATEWAY_HOST_PORT=8056" >> env-example; \
	        echo "ADMIN_API_HOST_PORT=8057" >> env-example; \
	        echo "TRANSCRIPTION_COLLECTOR_HOST_PORT=8123" >> env-example; \
	        echo "POSTGRES_HOST_PORT=5438" >> env-example; \
	    fi; \
	    cp env-example .env; \
	    echo "*** .env file created from env-example. Please review it. ***"; \
	fi

# Force create .env file from example (overwrite existing)
force-env:
	@echo "---> Forcing creation of .env from env-example..."
	@if [ ! -f env-example ]; then \
	    $(MAKE) env-example-create; \
	fi
	@cp env-example .env
	@echo "*** .env recreated from env-example. Please review it. ***"

# Helper target to create env-example with sane defaults
env-example-create:
	@echo "Creating env-example with default values..."
	@echo "ADMIN_API_TOKEN=token" > env-example
	@echo "BOT_IMAGE_NAME=vexa-bot:dev" >> env-example
	@echo "DEVICE_TYPE=cpu" >> env-example
	@echo "LOG_LEVEL=INFO" >> env-example
	@echo "GOOGLE_APPLICATION_CREDENTIALS_JSON_B64=" >> env-example
	@echo "GOOGLE_CLOUD_PROJECT=" >> env-example
	@echo "# Exposed Host Ports" >> env-example
	@echo "API_GATEWAY_HOST_PORT=18056" >> env-example
	@echo "ADMIN_API_HOST_PORT=18057" >> env-example
	@echo "TRANSCRIPTION_COLLECTOR_HOST_PORT=18123" >> env-example
	@echo "POSTGRES_HOST_PORT=15438" >> env-example

# Build the standalone vexa-bot image
# Uses BOT_IMAGE_NAME from .env if available, otherwise falls back to default
build-bot-image: check_docker
	@if [ -f .env ]; then \
	    ENV_BOT_IMAGE_NAME=$$(grep BOT_IMAGE_NAME .env | cut -d= -f2); \
	    if [ -n "$$ENV_BOT_IMAGE_NAME" ]; then \
	        echo "---> Building $$ENV_BOT_IMAGE_NAME image (from .env)..."; \
	        docker build -t $$ENV_BOT_IMAGE_NAME -f services/vexa-bot/core/Dockerfile ./services/vexa-bot/core; \
	    else \
	        echo "---> Building $(BOT_IMAGE_NAME) image (BOT_IMAGE_NAME not found in .env)..."; \
	        docker build -t $(BOT_IMAGE_NAME) -f services/vexa-bot/core/Dockerfile ./services/vexa-bot/core; \
	    fi; \
	else \
	    echo "---> Building $(BOT_IMAGE_NAME) image (.env file not found)..."; \
	    docker build -t $(BOT_IMAGE_NAME) -f services/vexa-bot/core/Dockerfile ./services/vexa-bot/core; \
	fi

# Build Docker Compose service images
build: check_docker
	@echo "---> Building Docker images..."
	@docker compose build

# Start services in detached mode
up: check_docker
	@echo "---> Starting Docker Compose services..."
	@docker compose up -d

# Stop services
down: check_docker
	@echo "---> Stopping Docker Compose services..."
	@docker compose down

# Show container status
ps: check_docker
	@docker compose ps

# Tail logs for all services
logs:
	@docker compose logs -f

# Run the interaction test script
test: check_docker
	@echo "---> Running test script..."
	@echo "---> API Documentation URLs:"
	@if [ -f .env ]; then \
	    API_PORT=$$(grep -E '^[[:space:]]*API_GATEWAY_HOST_PORT=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//'); \
	    ADMIN_PORT=$$(grep -E '^[[:space:]]*ADMIN_API_HOST_PORT=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//'); \
	    [ -z "$$API_PORT" ] && API_PORT=8056; \
	    [ -z "$$ADMIN_PORT" ] && ADMIN_PORT=8057; \
	    echo "    Main API:  http://localhost:$$API_PORT/docs"; \
	    echo "    Admin API: http://localhost:$$ADMIN_PORT/docs"; \
	else \
	    echo "    Main API:  http://localhost:8056/docs"; \
	    echo "    Admin API: http://localhost:8057/docs"; \
	fi
	@chmod +x testing/run_vexa_interaction.sh
	@echo "---> Running test script..."

	@if [ -n "$(MEETING_ID)" ]; then \
	    echo "---> Using provided meeting ID: $(MEETING_ID)"; \
	    ./testing/run_vexa_interaction.sh "$(MEETING_ID)"; \
	else \
	    echo "---> No meeting ID provided. Use 'make test MEETING_ID=abc-defg-hij' to test with a specific meeting."; \
	    echo "---> Running in interactive mode..."; \
	    ./testing/run_vexa_interaction.sh; \
	fi

# Quick API connectivity test (no user interaction required)
test-api: check_docker
	@echo "---> Running API connectivity test..."
	@API_PORT=18056; \
	ADMIN_PORT=18057; \
	if [ -f .env ]; then \
	    API_PORT=$$(grep -E '^[[:space:]]*API_GATEWAY_HOST_PORT=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//' || echo "18056"); \
	    ADMIN_PORT=$$(grep -E '^[[:space:]]*ADMIN_API_HOST_PORT=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//' || echo "18057"); \
	fi; \
	echo "---> Testing API Gateway connectivity at http://localhost:$$API_PORT/docs..."; \
	if curl -s -f "http://localhost:$$API_PORT/docs" > /dev/null; then \
	    echo "✅ API Gateway is responding"; \
	else \
	    echo "❌ API Gateway is not responding"; \
	    exit 1; \
	fi; \
	echo "---> Testing Admin API connectivity at http://localhost:$$ADMIN_PORT/docs..."; \
	if curl -s -f "http://localhost:$$ADMIN_PORT/docs" > /dev/null; then \
	    echo "✅ Admin API is responding"; \
	else \
	    echo "❌ Admin API is not responding"; \
	    exit 1; \
	fi; \
	echo "---> API connectivity test passed! ✅"

# Test system setup without requiring meeting ID
test-setup: check_docker
	@echo "---> Testing Vexa system setup..."
	@echo "---> API Documentation URLs:"
	@if [ -f .env ]; then \
	    API_PORT=$$(grep -E '^[[:space:]]*API_GATEWAY_HOST_PORT=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//'); \
	    ADMIN_PORT=$$(grep -E '^[[:space:]]*ADMIN_API_HOST_PORT=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//'); \
	    [ -z "$$API_PORT" ] && API_PORT=8056; \
	    [ -z "$$ADMIN_PORT" ] && ADMIN_PORT=8057; \
	    echo "    Main API:  http://localhost:$$API_PORT/docs"; \
	    echo "    Admin API: http://localhost:$$ADMIN_PORT/docs"; \
	else \
	    echo "    Main API:  http://localhost:8056/docs"; \
	    echo "    Admin API: http://localhost:8057/docs"; \
	fi
	@echo "---> Testing API connectivity..."
	@make test-api
	@echo "---> System setup test completed! ✅"
	@echo "---> Ready for live testing. Use 'make test MEETING_ID=your-meeting-id' when ready."

# --- Database Migration Commands ---

# Smart migration: detects if database is fresh, legacy, or already Alembic-managed.
# This is the primary target for ensuring the database schema is up to date.
migrate-or-init: check_docker
	@echo "---> Starting smart database migration/initialization..."; \
	set -e; \
	if ! docker compose ps -q postgres | grep -q .; then \
	    echo "ERROR: PostgreSQL container is not running. Please run 'make up' first."; \
	    exit 1; \
	fi; \
	echo "---> Waiting for database to be ready..."; \
	count=0; \
	while ! docker compose exec -T postgres pg_isready -U postgres -d vexa -q; do \
	    if [ $$count -ge 12 ]; then \
	        echo "ERROR: Database did not become ready in 60 seconds."; \
	        exit 1; \
	    fi; \
	    echo "Database not ready, waiting 5 seconds..."; \
	    sleep 5; \
	    count=$$((count+1)); \
	done; \
	echo "---> Database is ready. Checking its state..."; \
	if docker compose exec -T postgres psql -U postgres -d vexa -t -c "SELECT 1 FROM information_schema.tables WHERE table_name = 'alembic_version';" | grep -q 1; then \
	    echo "STATE: Alembic-managed database detected."; \
	    echo "ACTION: Running standard migrations to catch up to 'head'..."; \
	    $(MAKE) migrate; \
	elif docker compose exec -T postgres psql -U postgres -d vexa -t -c "SELECT 1 FROM information_schema.tables WHERE table_name = 'meetings';" | grep -q 1; then \
	    echo "STATE: Legacy (non-Alembic) database detected."; \
	    echo "ACTION: Stamping at 'base' and migrating to 'head' to bring it under Alembic control..."; \
	    docker compose exec -T transcription-collector alembic -c /app/alembic.ini stamp base; \
	    $(MAKE) migrate; \
	else \
	    echo "STATE: Fresh, empty database detected."; \
	    echo "ACTION: Creating schema directly from models and stamping at revision dc59a1c03d1f..."; \
	    docker compose exec -T transcription-collector python -c "import asyncio; from shared_models.database import init_db; asyncio.run(init_db())"; \
	    docker compose exec -T transcription-collector alembic -c /app/alembic.ini stamp dc59a1c03d1f; \
	fi; \
	echo "---> Smart database migration/initialization complete!"

# Apply all pending migrations to bring database to latest version
migrate: check_docker
	@echo "---> Applying database migrations..."
	@if ! docker compose ps postgres | grep -q "Up"; then \
	    echo "ERROR: PostgreSQL container is not running. Please run 'make up' first."; \
	    exit 1; \
	fi
	@# Preflight: if currently at dc59a1c03d1f and users.data already exists, stamp next revision
	@current_version=$$(docker compose exec -T transcription-collector alembic -c /app/alembic.ini current 2>/dev/null | grep -E '^[a-f0-9]{12}' | head -1 || echo ""); \
	if [ "$$current_version" = "dc59a1c03d1f" ]; then \
	    if docker compose exec -T postgres psql -U postgres -d vexa -t -c "SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'data';" | grep -q 1; then \
	        echo "---> Preflight: detected existing column users.data. Stamping 5befe308fa8b..."; \
	        docker compose exec -T transcription-collector alembic -c /app/alembic.ini stamp 5befe308fa8b; \
	    fi; \
	fi
	@echo "---> Running alembic upgrade head..."
	@docker compose exec -T transcription-collector alembic -c /app/alembic.ini upgrade head

# Create a new migration file based on model changes
makemigrations: check_docker
	@if [ -z "$(M)" ]; then \
	    echo "Usage: make makemigrations M=\"your migration message\""; \
	    echo "Example: make makemigrations M=\"Add user profile table\""; \
	    exit 1; \
	fi
	@echo "---> Creating new migration: $(M)"
	@if ! docker compose ps postgres | grep -q "Up"; then \
	    echo "ERROR: PostgreSQL container is not running. Please run 'make up' first."; \
	    exit 1; \
	fi
	@docker compose exec -T transcription-collector alembic -c /app/alembic.ini revision --autogenerate -m "$(M)"

# Initialize the database (first time setup) - creates tables and stamps with latest revision
init-db: check_docker
	@echo "---> Initializing database and stamping with Alembic..."
	docker compose run --rm transcription-collector python -c "import asyncio; from shared_models.database import init_db; asyncio.run(init_db())"
	docker compose run --rm transcription-collector alembic -c /app/alembic.ini stamp head
	@echo "---> Database initialized and stamped."

# Stamp existing database with current version (for existing installations)
stamp-db: check_docker
	@echo "---> Stamping existing database with current migration version..."
	@if ! docker compose ps postgres | grep -q "Up"; then \
	    echo "ERROR: PostgreSQL container is not running. Please run 'make up' first."; \
	    exit 1; \
	fi
	@docker compose exec -T transcription-collector alembic -c /app/alembic.ini stamp head
	@echo "---> Database stamped successfully!"

# Show current migration status
migration-status: check_docker
	@echo "---> Checking migration status..."
	@if ! docker compose ps postgres | grep -q "Up"; then \
	    echo "ERROR: PostgreSQL container is not running. Please run 'make up' first."; \
	    exit 1; \
	fi
	@echo "---> Current database version:"
	@docker compose exec -T transcription-collector alembic -c /app/alembic.ini current
	@echo "---> Migration history:"
	@docker compose exec -T transcription-collector alembic -c /app/alembic.ini history --verbose

# --- End Database Migration Commands ---
