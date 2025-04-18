# Blue Wasp Runner - Command Reference

## Configuration File

Blue Wasp Runner uses `.bluewasp.yml` files to configure commands, stages, and sequences that can be executed from VS Code. The configuration file should be placed in your project root.

## Ignoring Files and Directories

Blue Wasp Runner supports a `.bluewaspignore` file that allows you to specify files and directories that should be excluded from command execution and Docker volume operations. The ignore file uses the same syntax as `.gitignore`.

### Ignore File Format

Create a `.bluewaspignore` file in your project root with patterns like:

```
# Ignore node_modules directory
node_modules/

# Ignore build outputs
/dist/
/build/
/out/

# Ignore temporary files
*.tmp
*.log

# Include a specific file that would otherwise be ignored
!/dist/important-file.txt

# Ignore specific file types in all directories
**/*.zip
**/*.tar.gz
```

### Ignore Behavior

When Blue Wasp Runner encounters paths that match patterns in the `.bluewaspignore` file:

- Commands with a working directory in an ignored path will not run (with a warning)
- Docker volumes with sources in ignored paths will be skipped (with a warning)
- Files in ignored paths will not be included in Docker container operations

This is useful for excluding large dependency directories, temporary build artifacts, and sensitive files from your command execution environment.

A sample `.bluewaspignore` file is available in the `examples/sample.bluewaspignore` file for reference.

## Basic Structure

```yaml
commands:
  - name: Command Name
    description: Command description
    command: actual command to run
    cwd: optional/path/to/working/directory
    env:
      KEY1: value1
      KEY2: value2
    allow_failure: false  # Optional: whether the command is allowed to fail

  # Docker command example
  - name: Docker Command
    description: Run a command in a Docker container
    image: node:16-alpine
    command: node -e "console.log('Hello from Docker')"
    remove_after_run: true

stages:
  - name: Stage Name
    description: Stage description
    allow_failure: false  # Optional: whether the stage is allowed to fail
    commands:
      - Command Name 1  # Reference to a command by name
      - Command Name 2
      - name: Inline Command  # Or define a command inline
        command: echo "Inline command"
        allow_failure: true  # This command can fail without stopping the stage
      - name: Inline Docker  # Or define a Docker command inline
        image: python:3.9-alpine
        command: python -c "print('Hello from Python')"
        remove_after_run: true

sequences:
  - name: Sequence Name
    description: Sequence description
    stages:
      - Stage Name 1  # Reference to a stage by name
      - Stage Name 2

# Standalone Docker container definitions
containers:
  - name: postgres-db
    description: PostgreSQL database container
    image: postgres
    tag: 13
    ports:
      - host: 5432
        container: 5432
    environment:
      POSTGRES_PASSWORD: example
      POSTGRES_USER: postgres
      POSTGRES_DB: testdb
    volumes:
      - source: ./data/postgres
        target: /var/lib/postgresql/data
    restart_policy: unless-stopped

## Command Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | The name of the command shown in the quick pick menu |
| `description` | No | A description of what the command does |
| `command` | Yes* | The actual command to execute (*required if not using Docker image) |
| `cwd` | No | Working directory (relative to workspace root) |
| `env` | No | Environment variables as key-value pairs |
| `shell` | No | Whether to run in shell (defaults to true) |
| `allow_failure` | No | Whether the command is allowed to fail without stopping execution (default: false) |

### Docker Properties in Commands

| Property | Required | Description |
|----------|----------|-------------|
| `image` | Yes* | Docker image to use (*required for Docker-based commands) |
| `image_tag` | No | Tag for the Docker image |
| `container_name` | No | Custom name for the container (auto-generated if not specified) |
| `ports` | No | Port mappings between host and container |
| `volumes` | No | Volume mappings between host and container |
| `workdir` | No | Working directory inside the container |
| `entrypoint` | No | Entrypoint command for the container |
| `network` | No | Docker network to connect the container to |
| `remove_after_run` | No | Whether to remove the container after command completion (default: false) |

## Stage Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | The name of the stage |
| `description` | No | A description of what the stage does |
| `commands` | Yes | Array of command names or inline command definitions |
| `allow_failure` | No | Whether the stage is allowed to fail without stopping execution (default: false) |

## Sequence Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | The name of the sequence |
| `description` | No | A description of what the sequence does |
| `stages` | Yes | Array of stage names to run in order |

## Docker Container Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | The name of the container |
| `description` | No | A description of what the container does |
| `image` | Yes | The Docker image to use |
| `tag` | No | The image tag (default: latest) |
| `ports` | No | Port mappings between host and container |
| `volumes` | No | Volume mappings between host and container |
| `environment` | No | Environment variables as key-value pairs |
| `command` | No | Command to run inside the container |
| `entrypoint` | No | Entrypoint command for the container |
| `workdir` | No | Working directory inside the container |
| `network` | No | Docker network to connect the container to |
| `restart_policy` | No | Container restart policy (no, always, on-failure, unless-stopped) |
| `healthcheck` | No | Health check configuration |
| `remove_when_stopped` | No | Whether to remove the container after it stops |

## Failure Handling

Blue Wasp Runner provides granular control over how failures are handled:

- By default, when a command fails (returns a non-zero exit code), execution stops
- Set `allow_failure: true` on a command to let it fail without stopping execution
- Set `allow_failure: true` on a stage to let the entire stage fail without stopping the sequence
- When a command with `allow_failure: true` fails, execution continues to the next command
- When a stage fails but has `allow_failure: true`, the sequence continues to the next stage
- Commands in a stage inherit the stage's `allow_failure` setting if they don't specify their own

## Examples

### Basic Commands

```yaml
commands:
  - name: Run Tests
    description: Run all project tests
    command: npm test
  
  - name: Start Dev Server
    description: Start the development server
    command: npm run dev
  
  - name: Build Project
    description: Build for production
    command: npm run build
```

### Working Directory Example

```yaml
commands:
  - name: Run Backend Tests
    description: Run tests for the backend
    command: npm test
    cwd: ./backend
```

### Environment Variables Example

```yaml
commands:
  - name: Run with Debug
    description: Run application with debug mode
    command: npm start
    env:
      NODE_ENV: development
      DEBUG: "app:*"
      PORT: 3001
```

### Failure Handling Example

```yaml
commands:
  - name: Clean Artifacts
    description: Clean build artifacts (allowed to fail)
    command: rm -rf ./dist
    allow_failure: true
  
  - name: Run Linter
    description: Run linter (must succeed)
    command: npm run lint
  
  - name: Run Tests
    description: Run tests (must succeed)
    command: npm test

stages:
  - name: Validation Stage
    description: Run validation checks
    commands:
      - Run Linter
      - Run Tests
  
  - name: Optional Stage
    description: Run optional tasks (entire stage can fail)
    allow_failure: true
    commands:
      - Clean Artifacts
      - name: Generate Docs
        command: npm run docs
        # Inherits allow_failure: true from the stage
```

### Docker Command Examples

```yaml
commands:
  # Run a one-off command in a container and remove it after
  - name: Run Node Script
    description: Run a Node.js script in a container
    image: node
    image_tag: 16-alpine
    volumes:
      - source: ./scripts
        target: /app
    workdir: /app
    command: node index.js
    remove_after_run: true
  
  # Run a database container that persists
  - name: Start Database
    description: Start a PostgreSQL database
    image: postgres
    image_tag: 13-alpine
    ports:
      - host: 5432
        container: 5432
    env:
      POSTGRES_PASSWORD: test
      POSTGRES_USER: test
      POSTGRES_DB: test
```

### Docker in Stages Example

```yaml
stages:
  - name: database-test
    description: Test with a database
    commands:
      # Start a PostgreSQL container
      - name: postgres-inline
        description: Start PostgreSQL database
        image: postgres
        image_tag: 13-alpine
        ports:
          - host: 5432
            container: 5432
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_USER: test
          POSTGRES_DB: test
      
      # Run tests that connect to the database
      - name: run-tests
        command: npm test
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: test
          DB_PASSWORD: test
          DB_NAME: test
        
      # Stop and remove the database container
      - name: cleanup-postgres
        command: docker stop postgres-inline && docker rm postgres-inline
        allow_failure: true
```

### Standalone Docker Container Example

```yaml
containers:
  - name: redis-cache
    description: Redis cache container
    image: redis
    tag: alpine
    ports:
      - host: 6379
        container: 6379
    volumes:
      - source: ./data/redis
        target: /data
    restart_policy: always
    command: redis-server --appendonly yes
    
  - name: nginx-web
    description: Nginx web server
    image: nginx
    tag: latest
    ports:
      - host: 8080
        container: 80
    volumes:
      - source: ./www
        target: /usr/share/nginx/html
        readonly: true
    healthcheck:
      command: curl --fail http://localhost:80/ || exit 1
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    restart_policy: on-failure
```

### Stages Example

Stages allow you to group multiple commands that run in sequence:

```yaml
commands:
  - name: Install
    command: npm install
  
  - name: Lint
    command: npm run lint
  
  - name: Test
    command: npm test

stages:
  - name: Validate
    description: Validate the project
    commands:
      - Lint
      - Test
  
  - name: Build
    description: Build the project
    commands:
      - Install
      - name: Run Build
        command: npm run build
        env:
          NODE_ENV: production
```

### Sequences Example

Sequences chain multiple stages together in order:

```yaml
stages:
  - name: Validate
    commands: [Lint, Test]
  
  - name: Build
    commands: [Install, Build]
  
  - name: Deploy
    commands: [Deploy to Staging]
    allow_failure: true  # Deployment can fail without stopping the pipeline

sequences:
  - name: Full CI/CD Pipeline
    description: Full CI/CD pipeline including tests, build and deployment
    stages:
      - Validate
      - Build
      - Deploy
```

### Complex Configuration Example

This example shows a complete workflow with commands, stages, and sequences:

```yaml
commands:
  - name: Install Dependencies
    command: npm install
  
  - name: Run Tests
    command: npm test
  
  - name: Build Project
    command: npm run build
    env:
      NODE_ENV: production
  
  - name: Deploy to Staging
    command: npm run deploy:staging
    env:
      DEPLOY_TARGET: staging
    allow_failure: true  # Deployment can fail without stopping the pipeline
    
  - name: Start Database
    image: postgres
    image_tag: 13-alpine
    ports:
      - host: 5432
        container: 5432
    env:
      POSTGRES_PASSWORD: test
      POSTGRES_USER: test
      POSTGRES_DB: test

stages:
  - name: Test Stage
    commands:
      - Install Dependencies
      - Start Database
      - Run Tests
  
  - name: Build Stage
    commands:
      - Install Dependencies
      - Build Project
  
  - name: Deploy Stage
    commands:
      - Install Dependencies
      - Build Project
      - Deploy to Staging

sequences:
  - name: CI Pipeline
    stages:
      - Test Stage
      - Build Stage
  
  - name: CD Pipeline
    stages:
      - Test Stage
      - Build Stage
      - Deploy Stage
```

## Usage

There are several ways to run your configured items:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac), then:
   - Type "Blue Wasp: Run Command" to run a single command
   - Type "Blue Wasp: Run Stage" to run a stage
   - Type "Blue Wasp: Run Sequence" to run a sequence
   - Type "Blue Wasp: Run (All Types)" to select from all commands, stages, and sequences
   - Type "Blue Wasp: Show Output Panel" to view the execution output
   - Type "Blue Wasp: Run Docker Container" to start a Docker container
   - Type "Blue Wasp: Stop Docker Container" to stop a Docker container
   - Type "Blue Wasp: View Docker Container Logs" to view Docker logs
   - Type "Blue Wasp: Remove Docker Container" to remove a Docker container
   - Type "Blue Wasp: Add Docker Container Configuration" to create a new container config

2. Select the command, stage, or sequence from the list that appears

## Docker Container Management

Blue Wasp Runner provides commands for managing Docker containers:

- **Blue Wasp: Run Docker Container**: Start a container defined in the `containers` section
- **Blue Wasp: Stop Docker Container**: Stop a running container
- **Blue Wasp: Remove Docker Container**: Remove a container (stopping it first if needed)
- **Blue Wasp: View Docker Container Logs**: View the logs from a container
- **Blue Wasp: Show Docker Output**: Show the Docker output panel
- **Blue Wasp: Add Docker Container Configuration**: Generate a Docker container configuration

## Output and Execution Details

The extension captures and displays:
- Command output and errors in the Output panel
- Docker container output in the Docker Output panel
- Execution times and exit codes
- Failure information and handling
- Progress through stages and sequences
- Container logs and status information

## Extension Settings

This extension provides the following settings:

- `bluewasp-runner.configFile`: The name of the configuration file (default: `.bluewasp.yml`)
- `bluewasp-runner.showOutputOnRun`: Whether to automatically show the output panel when running (default: true) 