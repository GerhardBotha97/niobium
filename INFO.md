# Niobium - Command Reference

## Configuration File

Niobium uses `.niobium.yml` files to configure commands, stages, and sequences that can be executed from VS Code. The configuration file should be placed in your project root.

### Including Other Config Files

To keep your main configuration file clean and organized, you can split it into multiple files and include them:

```yaml
# Main .niobium.yml file
include:
  - security.niobium.yml  # Include from same directory
  - ./build/npm.niobium.yml  # Include from subdirectory
  - /path/to/absolute/location.niobium.yml  # Include using absolute path

# Rest of your configuration...
```

#### Remote File Inclusion

Niobium also supports including configuration files from remote locations, such as GitHub repositories, GitLab projects, or custom servers:

```yaml
# Include a remote configuration file from GitHub
include:
  url: https://github.com/user/repo/blob/main/.niobium.yml
  auth:
    type: token
    token: ${GITHUB_TOKEN}  # Environment variable reference
  refresh:
    interval: 60  # Refresh every 60 minutes

# Rest of your configuration...
```

You can include multiple remote files in a single configuration:

```yaml
include:
  # GitHub configuration with token authentication
  - url: https://github.com/user/repo/blob/main/commands.yml
    auth:
      type: token
      token: ${GITHUB_TOKEN}
    refresh:
      force: true  # Always refresh this file

  # GitLab configuration with token authentication
  - url: https://gitlab.com/user/repo/blob/main/stages.yml
    auth:
      type: token
      token: ${GITLAB_TOKEN}
    refresh:
      interval: 1440  # Refresh daily (24 hours = 1440 minutes)

  # Custom server with basic authentication
  - url: https://private-server.com/api/config.yml
    auth:
      type: basic
      username: user
      password: ${API_PASSWORD}
    # No refresh options means it will only be downloaded once

  # Local files can still be included in the same list
  - ./local-file.yml
```

#### Remote Include Options

Remote includes support the following options:

| Option | Description |
|--------|-------------|
| `url` | Required. The URL of the remote configuration file |
| `auth` | Optional. Authentication settings for the remote server |
| `auth.type` | Authentication type: `token`, `basic`, `oauth`, or `none` |
| `auth.token` | Token for token-based or OAuth authentication |
| `auth.username` | Username for basic authentication |
| `auth.password` | Password for basic authentication |
| `refresh` | Optional. Settings for refreshing the remote file |
| `refresh.interval` | Time in minutes after which the file should be refreshed |
| `refresh.force` | If true, always refresh the file on each load |

#### Authentication Types

Niobium supports several authentication methods for remote files:

- **Token Authentication**: For GitHub, GitLab, and other services that use token-based auth
  ```yaml
  auth:
    type: token
    token: ${GITHUB_TOKEN}
  ```

- **Basic Authentication**: For servers that require username/password
  ```yaml
  auth:
    type: basic
    username: user
    password: ${API_PASSWORD}
  ```

- **OAuth Authentication**: For services that use OAuth tokens
  ```yaml
  auth:
    type: oauth
    token: ${OAUTH_TOKEN}
  ```

- **No Authentication**: For public URLs
  ```yaml
  auth:
    type: none
  ```

#### File Refresh Policies

You can control when remote files are refreshed:

- **Interval-based refresh**: Download the file again after a specified time period
  ```yaml
  refresh:
    interval: 60  # Refresh every 60 minutes
  ```

- **Force refresh**: Always download the file on each configuration load
  ```yaml
  refresh:
    force: true
  ```

- **No refresh policy**: Download the file only if it doesn't exist locally
  ```yaml
  # No refresh section means the file is downloaded only once
  ```

#### Environment Variable Substitution

You can use environment variables in remote include configurations, including in URLs and authentication credentials:

```yaml
include:
  url: https://${GITHUB_USER}.github.com/${REPO_NAME}/blob/main/config.yml
  auth:
    type: token
    token: ${AUTH_TOKEN}
```

#### Manually Refreshing Remote Configurations

You can manually refresh all remote configurations using the VS Code command palette:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Niobium: Refresh Remote Configurations"
3. Press Enter to execute the command

This will force-refresh all remote configuration files regardless of their refresh settings.

#### Complete Remote Inclusion Example

Below is a complete example of using remote configuration files for security scanning, demonstrating how to structure your project for remote includes:

**Main Configuration** (`.niobium.yml`):

```yaml
# Main .niobium.yml file
variables:
  PROJECT_NAME: security-scanner
  GITHUB_TOKEN: ${GITHUB_TOKEN}  # Environment variable reference

# Include the remote security scanning configuration
include:
  url: http://localhost:8000/security-scans.yml
  refresh:
    force: true  # Always pull the latest version

# Define local commands
commands:
  - name: setup-environment
    description: Prepare local environment for security scanning
    command: mkdir -p ./.niobium_results ./niobium_report

# Define local stages that reference remote commands
stages:
  - name: Setup
    description: Prepare the environment
    commands:
      - setup-environment
  
  - name: Report
    description: Generate a report from scan results
    commands:
      - name: generate-report
        description: Create summary report
        command: |
          echo "# Security Scan Results for ${PROJECT_NAME}" > ./niobium_report/summary.md
          echo "Generated on $(date)" >> ./niobium_report/summary.md
          echo "See JSON files for detailed results." >> ./niobium_report/summary.md

# Define sequences that combine local and remote stages
sequences:
  - name: Full Security Assessment
    description: Run a complete security scan with all tools
    stages:
      - Setup
      - Parallel IaC Security Scans  # This references a stage from the remote config
      - Cleanup                      # This references a stage from the remote config
      - Report
```

**Remote Configuration** (`security-scans.yml` - served from http://localhost:8000):

```yaml
# Remote security scanning configuration
commands:
  - name: checkov
    description: Run Checkov to scan for security issues in IaC
    image: bridgecrew/checkov
    image_tag: latest
    command: --directory /src --output json --output-file-path /output
    output_file: checkov-results.json
    volumes:
      - source: .
        target: /src
      - source: ./.niobium_results
        target: /output
        readonly: false
  
  - name: trivy
    description: Run container vulnerability scanning
    image: aquasec/trivy
    image_tag: latest
    command: config --format json -o /output/trivy-results.json /src
    output_file: trivy-results.json
    volumes:
      - source: .
        target: /src
      - source: ./.niobium_results
        target: /output
        readonly: false

stages:
  - name: Parallel IaC Security Scans
    description: Run all security scans in parallel
    parallel: true
    commands:
      - checkov
      - trivy
  
  - name: Cleanup
    description: Process scan results
    commands:
      - name: organize-results
        command: |
          mkdir -p ./niobium_report
          cp ./.niobium_results/*.json ./niobium_report/ || echo "No results found"
```

**GitHub Remote Configuration Example**:

To use a GitHub repository instead of a local server:

```yaml
# Include from GitHub
include:
  url: https://github.com/organization/security-scans/blob/main/security-scans.yml
  auth:
    type: token
    token: ${GITHUB_TOKEN}
  refresh:
    interval: 1440  # Refresh daily
```

**Multiple Remote Includes Example**:

```yaml
# Include multiple remote configurations
include:
  - url: https://github.com/org/security-tools/blob/main/checkov.yml
    auth:
      type: token
      token: ${GITHUB_TOKEN}
  
  - url: https://gitlab.com/org/security-tools/blob/main/trivy.yml
    auth:
      type: token
      token: ${GITLAB_TOKEN}
  
  - url: https://internal-server.com/semgrep-config.yml
    auth:
      type: basic
      username: ${API_USER}
      password: ${API_PASSWORD}
```

The include feature supports:
- Single file inclusion: `include: path/to/file.yml`
- Multiple file inclusion: `include: [file1.yml, file2.yml]` or using the array syntax shown above
- Relative and absolute paths
- Nested includes (included files can also include other files)
- Remote file inclusion from various sources
- Authentication for private repositories and servers
- Configurable refresh policies
- Environment variable substitution

Variables defined in the main configuration file are available in all included files. Commands, stages, and sequences defined in included files can be referenced from the main file or other included files.

#### Best Practices for Using Includes

1. **Split by Purpose**: Separate configs by their purpose (security, build, deploy)
2. **Split by Technology**: Create separate files for different technologies (npm, docker, etc.)
3. **Common Base**: Share common configurations across multiple projects
4. **Environment-Specific**: Create separate files for different environments

#### Example Project Structure with Includes

```
your-project/
├── .niobium.yml           # Main config file
├── security.niobium.yml   # Security scanning config
└── build/
    └── npm.niobium.yml    # NPM build commands config
```

#### Troubleshooting Includes

If you encounter issues with included files:
1. Check that the paths are correct relative to the including file
2. Verify that included files have the correct YAML structure
3. Check the VS Code log for any warnings or errors
4. Try simplifying your configuration to isolate the problem

See the "Examples" section for more details on using includes.

## Ignoring Files and Directories

Niobium supports a `.niobiumignore` file that allows you to specify files and directories that should be excluded from command execution and Docker volume operations. The ignore file uses the same syntax as `.gitignore`.

### Ignore File Format

Create a `.niobiumignore` file in your project root with patterns like:

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

When Niobium encounters paths that match patterns in the `.niobiumignore` file:

- Commands with a working directory in an ignored path will not run (with a warning)
- Docker volumes with sources in ignored paths will be skipped (with a warning)
- Files in ignored paths will not be included in Docker container operations

This is useful for excluding large dependency directories, temporary build artifacts, and sensitive files from your command execution environment.

A sample `.niobiumignore` file is available in the `examples/sample.niobiumignore` file for reference.

## Basic Structure

```yaml
# Global variables - accessible across all commands, stages, and sequences
variables:
  PROJECT_NAME: myproject
  VERSION: 1.0.0
  BUILD_DIR: ./build

# Include other configuration files
include:
  - security.niobium.yml
  - ./build/npm.niobium.yml

commands:
  - name: Command Name
    description: Command description
    command: actual command to run
    cwd: optional/path/to/working/directory
    env:
      KEY1: value1
      KEY2: value2
    allow_failure: false  # Optional: whether the command is allowed to fail
    # Variable passing options
    outputs:
      OUTPUT_VAR: # Variable to capture from the command output
    depends_on: other-command # Depends on another command to run first

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
```

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
| `outputs` | No | Variables to capture from command output |
| `depends_on` | No | Command(s) that must run before this command |

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

Niobium provides granular control over how failures are handled:

- By default, when a command fails (returns a non-zero exit code), execution stops
- Set `allow_failure: true` on a command to let it fail without stopping execution
- Set `allow_failure: true` on a stage to let the entire stage fail without stopping the sequence
- When a command with `allow_failure: true` fails, execution continues to the next command
- When a stage fails but has `allow_failure: true`, the sequence continues to the next stage
- Commands in a stage inherit the stage's `allow_failure` setting if they don't specify their own

## Variables and Variable Passing

Niobium supports two types of variables:

1. **Global Variables**: Defined at the top level of the configuration and available to all commands
2. **Output Variables**: Generated by commands and passed to dependent commands

### Global Variables

Define global variables at the top level of your configuration file:

```yaml
variables:
  PROJECT_NAME: myproject
  VERSION: 1.0.0
  BUILD_DIR: ./build
  DEBUG: true
```

These variables can be used in any command with either `$VARIABLE_NAME` or `${VARIABLE_NAME}` syntax:

```yaml
commands:
  - name: echo-variables
    description: Echo the global variables
    command: echo "Project: $PROJECT_NAME, Version: ${VERSION}, Build Dir: $BUILD_DIR"
```

You can also use global variables in environment variables:

```yaml
commands:
  - name: use-in-env
    description: Use global variables in environment variables
    command: env | grep MY_
    env:
      MY_PROJECT: ${PROJECT_NAME}
      MY_VERSION: ${VERSION}
```

### Output Variables

Commands can define output variables that capture specific patterns from their output:

```yaml
commands:
  - name: generate-build-id
    description: Generate a unique build ID
    command: echo "::set-output name=BUILD_ID::$(date +%Y%m%d%H%M%S)"
    outputs:
      BUILD_ID: # This will capture the output matching the pattern
```

The command must output text in the format `::set-output name=VARIABLE_NAME::VALUE` to set a variable.

### Variable Dependencies

To use variables from one command in another, specify dependencies:

```yaml
commands:
  - name: generate-build-id
    description: Generate a unique build ID
    command: echo "::set-output name=BUILD_ID::$(date +%Y%m%d%H%M%S)"
    outputs:
      BUILD_ID:
  
  - name: use-build-id
    description: Use the build ID from the previous command
    command: echo "Build ID is ${BUILD_ID}"
    depends_on: generate-build-id
```

When using `depends_on`, Niobium will:

1. Ensure the dependency command runs first
2. Make its output variables available to the dependent command
3. Skip the dependent command if the dependency fails (unless `allow_failure: true` is set)

### Multiple Outputs and Dependencies

Commands can generate multiple output variables in a single run:

```yaml
commands:
  - name: generate-artifact-info
    description: Generate artifact name and timestamp
    command: |
      echo "::set-output name=TIMESTAMP::$(date)"
      echo "::set-output name=ARTIFACT_NAME::${PROJECT_NAME}-${VERSION}.zip"
    outputs:
      TIMESTAMP:
      ARTIFACT_NAME:
```

Commands can also depend on multiple other commands:

```yaml
commands:
  - name: deploy-artifact
    description: Deploy the artifact
    command: echo "Deploying ${ARTIFACT_NAME} with build ID ${BUILD_ID}"
    depends_on:
      - generate-build-id
      - generate-artifact-info
```

### Variables in Stages and Sequences

Variables are persisted throughout the execution of stages and sequences, allowing commands to share data even across different stages:

```yaml
stages:
  - name: build-stage
    commands:
      - generate-build-id  # Sets BUILD_ID
  
  - name: deploy-stage
    commands:
      - name: deploy-with-id
        command: echo "Deploying with build ID ${BUILD_ID}"
        depends_on: generate-build-id
```

### Complete Variable Example

Here's a complete example demonstrating global variables and variable passing between commands:

```yaml
# Global variables - accessible in all commands
variables:
  PROJECT_NAME: niobium
  VERSION: 1.0.0
  BUILD_DIR: ./dist
  ARTIFACT_PREFIX: release

# Individual commands
commands:
  # Command that uses global variables
  - name: echo-global-vars
    description: Display the global variables
    command: echo "Building $PROJECT_NAME version ${VERSION} to directory $BUILD_DIR"
  
  # Command that sets an output variable
  - name: generate-build-id
    description: Generate a unique build ID
    command: echo "::set-output name=BUILD_ID::$(date +%Y%m%d%H%M%S)"
    outputs:
      BUILD_ID:
  
  # Command that depends on the previous command and uses its output
  - name: echo-build-id
    description: Echo the build ID from the previous command
    command: echo "Build ID is ${BUILD_ID}"
    depends_on: generate-build-id
  
  # Command that generates multiple outputs
  - name: generate-artifact-info
    description: Generate artifact name and timestamp
    command: |
      echo "::set-output name=TIMESTAMP::$(date)"
      echo "::set-output name=ARTIFACT_NAME::${ARTIFACT_PREFIX}-${PROJECT_NAME}-${VERSION}.zip"
    outputs:
      TIMESTAMP:
      ARTIFACT_NAME:
  
  # Command that depends on multiple outputs from the previous command
  - name: display-artifact-info
    description: Display the artifact information
    command: echo "Artifact ${ARTIFACT_NAME} created at ${TIMESTAMP}"
    depends_on: generate-artifact-info

# Stages with variable-dependent commands
stages:
  - name: info-stage
    description: Display project information
    commands:
      - echo-global-vars
      - generate-build-id
      - echo-build-id
  
  - name: artifact-stage
    description: Generate artifact information
    commands:
      - generate-artifact-info
      - display-artifact-info
  
  # Stage that uses variables from previous stages
  - name: deployment-stage
    description: Deploy using variables from previous stages
    commands:
      - name: deploy-artifact
        description: Deploy the artifact
        command: echo "Deploying ${ARTIFACT_NAME} with build ID ${BUILD_ID}"
        depends_on:
          - generate-build-id
          - generate-artifact-info

# Sequence that chains all stages together
sequences:
  - name: build-and-deploy
    description: Complete build and deploy workflow with variable passing
    stages:
      - info-stage
      - artifact-stage
      - deployment-stage
```

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
  - name: Success Command
    description: A command that succeeds
    command: echo "This command works"
  
  - name: Failing Command
    description: A command that fails
    command: command-not-found
  
  - name: Allowed Failure Command
    description: A command allowed to fail
    command: command-not-found
    allow_failure: true
  
stages:
  # This stage will fail on the second command
  - name: Normal Stage
    description: This stage will stop on failure
    commands:
      - Success Command
      - Failing Command  # This will fail and stop the stage
      - Echo Environment # This won't run
  
  # This stage allows individual command failures
  - name: Mixed Failures Stage
    description: This stage handles individual command failures
    commands:
      - Success Command
      - Allowed Failure Command  # This will fail but continue
      - Echo Environment # This will still run
  
  # This entire stage is allowed to fail
  - name: Allow Failure Stage
    description: This entire stage is allowed to fail
    allow_failure: true
    commands:
      - Success Command
      - Failing Command  # This will fail but the stage will report success
      - Echo Environment # This won't run, but the stage will still be considered successful
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

### Config Include Example

Using includes allows you to organize your configuration into logical sections:

```yaml
# Main .niobium.yml
include:
  - security.niobium.yml
  - ./build/npm.niobium.yml

variables:
  PROJECT_NAME: myproject
  VERSION: 1.0.0

commands:
  - name: run-dev
    description: "Start the development server"
    command: npm run dev

stages:
  - name: validate
    description: "Validate the project"
    commands:
      - security-scan  # From security.niobium.yml
      - lint-code      # From security.niobium.yml
      - npm-test       # From npm.niobium.yml
```

```yaml
# security.niobium.yml
commands:
  - name: security-scan
    description: "Run security scanning"
    command: echo "Running security scans"
  
  - name: lint-code
    description: "Lint the code"
    command: echo "Linting code"

stages:
  - name: security
    description: "Run all security checks"
    commands:
      - security-scan
      - lint-code
```

```yaml
# build/npm.niobium.yml
commands:
  - name: npm-install
    description: "Install npm dependencies"
    command: npm install
  
  - name: npm-test
    description: "Run tests"
    command: npm test
    depends_on: npm-install

stages:
  - name: build
    description: "Build the npm project"
    commands:
      - npm-install
      - npm-test
```

This approach allows you to:
- Keep configuration files smaller and more focused
- Share common configurations across projects
- Organize commands by their purpose or technology
- Build a library of reusable configuration components

## Usage

There are several ways to run your configured items:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac), then:
   - Type "Niobium: Run Command" to run a single command
   - Type "Niobium: Run Stage" to run a stage
   - Type "Niobium: Run Sequence" to run a sequence
   - Type "Niobium: Run (All Types)" to select from all commands, stages, and sequences
   - Type "Niobium: Show Output Panel" to view the execution output
   - Type "Niobium: Run Docker Container" to start a Docker container
   - Type "Niobium: Stop Docker Container" to stop a Docker container
   - Type "Niobium: View Docker Container Logs" to view Docker logs
   - Type "Niobium: Remove Docker Container" to remove a Docker container
   - Type "Niobium: Add Docker Container Configuration" to create a new container config

2. Select the command, stage, or sequence from the list that appears

## Docker Container Management

Niobium provides commands for managing Docker containers:

- **Niobium: Run Docker Container**: Start a container defined in the `containers` section
- **Niobium: Stop Docker Container**: Stop a running container
- **Niobium: Remove Docker Container**: Remove a container (stopping it first if needed)
- **Niobium: View Docker Container Logs**: View the logs from a container
- **Niobium: Show Docker Output**: Show the Docker output panel
- **Niobium: Add Docker Container Configuration**: Generate a Docker container configuration

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

- `niobium.configFile`: The name of the configuration file (default: `.niobium.yml`)
- `niobium.showOutputOnRun`: Whether to automatically show the output panel when running (default: true)

### Parallel Execution Example

```yaml
stages:
  # Default sequential execution
  - name: Sequential Stage
    description: Run commands one after another
    commands:
      - First Command
      - Second Command
      - Third Command
  
  # Parallel execution
  - name: Parallel Stage
    description: Run all tasks simultaneously
    parallel: true
    commands:
      - First Command
      - Second Command
      - Third Command
  
  # Parallel with dependencies
  - name: Mixed Stage
    description: Run in parallel with dependencies respected
    parallel: true
    commands:
      - First Command
      - Second Command
      - name: Dependent Command
        command: echo "Running after dependencies"
        depends_on:
          - First Command
          - Second Command
```

## Integrated Tools

Niobium integrates with several popular development tools and technologies out of the box:

### Build and Package Managers
- **npm/Node.js**: Run scripts defined in package.json
- **Python**: Execute Python scripts and use pip for package management
- **Maven/Gradle**: Build Java applications

### Container Technologies
- **Docker**: Run containers, manage volumes, and execute commands in containers
- **Docker Compose**: Run multi-container Docker applications

### Version Control
- **Git**: Run git commands and integrate with version control workflows

### Testing Frameworks
- **Jest**: Run JavaScript tests
- **Pytest**: Run Python tests
- **JUnit**: Run Java tests

### CI/CD Integration
- **GitHub Actions**: Integration with GitHub Actions workflows
- **GitLab CI**: Integration with GitLab CI pipelines

### Database Management
- **PostgreSQL**: Run PostgreSQL in Docker with preconfigured settings
- **MySQL/MariaDB**: Database container management
- **MongoDB**: Database container management
- **Redis**: Cache container management

### Web Servers
- **Nginx**: Web server container management
- **Apache**: Web server container management

To use these integrations, reference them in your commands or define containers using the appropriate images and configuration settings as shown in the examples.

## File Watchers

File watchers allow you to automatically run stages when specific files change. This is useful for tasks like:

- Running tests when test files change
- Linting code when source files change
- Rebuilding documentation when documentation files change

To configure a file watcher, add a `watch` property to a stage:

```yaml
stages:
  - name: Test
    description: Run tests when test files change
    commands:
      - Run Tests
    watch:
      patterns:
        - "src/**/*.test.js"
        - "src/**/*.test.ts"
      debounce: 500  # Optional: delay in milliseconds before running the stage
```

The `patterns` property is an array of glob patterns to match against file paths. You can use negated patterns (prefixed with `!`) to exclude files.

## Pre-Commit Hooks

Niobium supports Git pre-commit hooks to ensure code quality when committing changes. This allows you to:

- Run linters before committing code
- Run tests to ensure they pass
- Enforce code style and formatting standards
- Prevent commits with issues from entering your repository

### Configuring Pre-Commit Hooks

To configure a pre-commit hook, add a `pre_commit: true` property to a stage's `watch` configuration:

```yaml
stages:
  - name: Code Quality Check
    description: Check code quality before commits
    commands:
      - Lint JavaScript
    watch:
      patterns:
        - "src/**/*.js"
      pre_commit: true  # This makes the watcher run during pre-commit
```

When you make a commit, the pre-commit hook will:

1. Identify staged files that match the watcher patterns
2. Run the stage if there are matching files
3. Abort the commit if the stage fails (unless `allow_failure: true` is set)

Pre-commit hooks are automatically installed when you open a workspace with pre-commit watchers configured. You can also manage them through the `Niobium: Manage Git Hooks` command.

### How Pre-Commit Hooks Work

The pre-commit functionality works by:

1. Installing a Git pre-commit hook script in your repository's `.git/hooks` directory
2. When you run `git commit`, the hook executes before the commit is created
3. The hook identifies which files are staged for commit
4. Niobium runs any stages marked with `pre_commit: true` that have patterns matching the staged files
5. If any stage fails, the commit is aborted with an error message
6. If all stages pass, the commit proceeds normally

### Pre-Commit Settings

Configure Git hook behavior through VS Code settings:

- `niobium-runner.gitHooks.enabled`: Enable or disable Git hooks integration (default: true)
- `niobium-runner.gitHooks.installPreCommit`: Install the pre-commit hook automatically (default: true)

### Pre-Commit Hook Examples

#### Basic Linting Example

```yaml
commands:
  - name: ESLint Check
    description: Run ESLint on JavaScript files
    command: eslint src/ --ext .js,.jsx

stages:
  - name: Lint
    description: Check code quality before commits
    commands:
      - ESLint Check
    watch:
      patterns:
        - "src/**/*.js"
        - "src/**/*.jsx"
      pre_commit: true
```

#### Comprehensive Pre-Commit Validation

Here's a complete example combining multiple validation stages:

```yaml
commands:
  - name: Lint JavaScript
    description: Run ESLint on JavaScript files
    command: eslint --fix src/

  - name: Lint TypeScript
    description: Run TypeScript compiler for checking errors
    command: tsc --noEmit
    
  - name: Format Code
    description: Run Prettier on code files
    command: prettier --write src/
    
  - name: Run Tests
    description: Run unit tests
    command: jest

stages:
  - name: Code Quality Check
    description: Check code quality before commits
    commands:
      - Lint JavaScript
      - Lint TypeScript
    # This stage will run when files matching the patterns change
    # AND when a git commit is being made (pre-commit check)
    watch:
      patterns:
        - "src/**/*.js"
        - "src/**/*.ts"
        - "!src/**/*.test.js"  # Ignore test files
        - "!src/**/*.test.ts"  # Ignore test files
      debounce: 300
      pre_commit: true  # This makes the watcher run during pre-commit

  - name: Format
    description: Format code on save
    commands:
      - Format Code
    # This stage will run when files matching the patterns change
    # But NOT during pre-commit
    watch:
      patterns:
        - "src/**/*.js"
        - "src/**/*.ts"
        - "src/**/*.json"
      debounce: 200

  - name: Test
    description: Run tests when test files change
    commands:
      - Run Tests
    watch:
      patterns:
        - "src/**/*.test.js"
        - "src/**/*.test.ts"
      debounce: 500
      pre_commit: true  # Also run tests during pre-commit
```

#### Security Scanning Pre-Commit Example

```yaml
commands:
  - name: Secret Scan
    description: Check for secrets and credentials
    command: gitleaks detect -v --source . --report-path report.json
    allow_failure: false

  - name: Security Audit
    description: Run npm security audit
    command: npm audit
    allow_failure: true  # Allow audit warnings but still show them

stages:
  - name: Security Check
    description: Run security checks before commit
    commands:
      - Secret Scan
      - Security Audit
    watch:
      patterns:
        - "**/*.js"
        - "**/*.ts"
        - "**/*.json"
        - "**/*.yml"
        - "**/*.yaml"
      pre_commit: true
```

### Managing Pre-Commit Hooks

You can manage Git hooks through VS Code commands:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Niobium: Manage Git Hooks"
3. Select from options:
   - Install Pre-Commit Hook
   - Uninstall Pre-Commit Hook
   - Enable Git Hooks
   - Disable Git Hooks

### Pre-Commit Best Practices

- **Keep Hooks Fast**: Pre-commit hooks should run quickly to avoid slowing down your workflow
- **Focus on Critical Checks**: Include only the most important checks in pre-commit hooks
- **Use `allow_failure` Selectively**: For non-critical checks, use `allow_failure: true` to show warnings without blocking commits
- **Exclude Test and Build Files**: Use negative patterns (`!pattern`) to exclude files that don't need pre-commit validation
- **Combine with File Watchers**: Use the same stage for both pre-commit checks and file watching to maintain consistency

### Bypassing Pre-Commit Hooks

In emergency situations, you can bypass the pre-commit hook using Git's `--no-verify` flag:

```bash
git commit -m "Emergency fix" --no-verify
```

However, it's generally recommended to fix issues flagged by pre-commit hooks rather than bypassing them.

### Troubleshooting Pre-Commit Hooks

If you're having issues with pre-commit hooks not running, follow these steps to verify and fix your setup:

#### Verifying Hook Installation

To check if the pre-commit hook is properly installed:

1. Navigate to your repository's `.git/hooks` directory:
   ```bash
   cd .git/hooks
   ```

2. Check if the pre-commit file exists and is executable:
   ```bash
   ls -la pre-commit
   ```
   
   You should see output like:
   ```
   -rwxr-xr-x 1 user group 1234 Jan 1 12:00 pre-commit
   ```
   
   The `x` flags indicate the file is executable.

#### Fixing Missing Hooks Directory or Executable

If the `.git/hooks` directory doesn't exist:

1. Make sure you're in a valid Git repository:
   ```bash
   git status
   ```
   If this returns an error, you need to initialize Git first: `git init`

2. Manually create the hooks directory:
   ```bash
   mkdir -p .git/hooks
   ```

If the pre-commit executable is missing or not running:

1. Manually install using the Niobium command:
   - Open Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
   - Type "Niobium: Manage Git Hooks"
   - Select "Install Pre-Commit Hook"

2. Make the hook executable if it exists but isn't running:
   ```bash
   chmod +x .git/hooks/pre-commit
   ```

3. If the hook still isn't created automatically:
   - Check that you have at least one stage with `pre_commit: true` in your config
   - Verify your `.niobium.yml` file is valid
   - Check that Git hooks are enabled in VS Code settings
   - Try closing and reopening VS Code

#### Testing Your Hook

To test if your pre-commit hook is working correctly:

1. Make a small change to a file that matches your watch patterns
2. Stage the change: `git add <filename>`
3. Try to commit: `git commit -m "Testing pre-commit hook"`
4. You should see Niobium running the configured stages

If the hook doesn't run, check the VS Code output panel for any error messages from Niobium.
