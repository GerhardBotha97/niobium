# Blue Wasp Runner

A VS Code extension that provides a configurable command runner using `.bluewasp.yml` configuration files.

## Features

- Run pre-configured commands from within VS Code
- Configure commands via YAML files
- Set environment variables and working directories for commands
- Access commands via Command Palette or Status Bar
- Run Docker containers defined in the YAML file
- Manage container lifecycle with start, stop, and remove operations
- Use Docker containers within commands and stages
- **NEW:** Define and use global variables across your commands and stages
- **NEW:** Pass variables between commands and stages for complex workflows

## Usage

1. Create a `.bluewasp.yml` file in your project root
2. Define your commands and Docker containers in the YAML file
3. Run the commands or containers using the Command Palette

## Configuration File Format

The configuration file should be named `.bluewasp.yml` and placed in your project root:

```yaml
# Global variables - accessible across all commands, stages, and sequences
variables:
  PROJECT_NAME: myproject
  VERSION: 1.0.0
  BUILD_DIR: ./build

commands:
  - name: Run Tests
    description: Run all project tests
    command: npm test
    
  - name: Start Development Server
    description: Start the development server
    command: npm run dev
    
  - name: Custom Command
    description: Example with environment variables and custom working directory
    command: npm run custom-script
    cwd: ./scripts
    env:
      NODE_ENV: development
      DEBUG: true
      
  # Command with output variables
  - name: set-build-time
    description: Set build time as an output variable
    command: echo "::set-output name=BUILD_TIME::$(date)"
    outputs:
      BUILD_TIME: # This will capture the output with pattern ::set-output name=BUILD_TIME::VALUE
  
  # Command that depends on another command and uses its output
  - name: use-build-time
    description: Use the build time from previous command
    command: echo "Build completed at ${BUILD_TIME}"
    depends_on: set-build-time
      
  # Docker command example
  - name: Run Python Script
    description: Run a Python script in a container
    image: python
    image_tag: 3.9-alpine
    volumes:
      - source: ./scripts
        target: /app
    workdir: /app
    command: python process.py
    remove_after_run: true

# Define stages that combine regular and Docker commands
stages:
  - name: setup-and-process
    description: Set up and process data
    commands:
      - Start Development Server
      - Run Python Script

# Docker container definitions
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

## Ignoring Files and Directories

You can create a `.bluewaspignore` file in your project root to specify files and directories that should be ignored by Blue Wasp Runner. This is useful for excluding unnecessary files from Docker volumes or skipping commands in specific directories.

The `.bluewaspignore` file uses the same syntax as `.gitignore`:

```
# Ignore node_modules directory
node_modules/

# Ignore build outputs
/dist/
/build/

# Ignore specific file types
**/*.log
**/*.tmp

# Include a specific file that would otherwise be ignored
!/dist/important-file.txt
```

When Blue Wasp Runner encounters an ignored path:

- Commands with a working directory in an ignored path will not run
- Docker volumes with sources in ignored paths will be skipped with a warning
- Files in ignored paths will not be included in Docker container operations

A sample `.bluewaspignore` file is available in the examples directory.

## Command Properties

Each command can have the following properties:

- `name` (required): The name of the command
- `description`: A description of what the command does
- `command`: The actual command to execute (required if not using Docker image)
- `cwd`: The working directory relative to the project root
- `env`: Environment variables to set before running the command
- `shell`: Whether to run the command in a shell (default: true)

### Docker Integration in Commands

Commands can also execute Docker containers by specifying:

- `image`: Docker image to use (required for Docker-based commands)
- `image_tag`: Tag for the Docker image (default: latest)
- `container_name`: Name to give the container (auto-generated if not specified)
- `ports`: Port mappings between host and container
- `volumes`: Volume mappings between host and container
- `workdir`: The working directory inside the container
- `command`: The command to run inside the container
- `entrypoint`: The entrypoint command for the container
- `network`: Docker network to connect the container to
- `remove_after_run`: Whether to remove the container after the command completes

## Docker Container Properties

Each container defined in the `containers` section can have the following properties:

- `name` (required): The name of the container
- `description`: A description of what the container does
- `image` (required): The Docker image to use
- `tag`: The image tag (default: latest)
- `ports`: Port mappings between host and container
- `volumes`: Volume mappings between host and container
- `environment`: Environment variables to set in the container
- `command`: The command to run inside the container
- `entrypoint`: The entrypoint command for the container
- `workdir`: The working directory inside the container
- `network`: The Docker network to connect the container to
- `restart_policy`: Container restart policy (no, always, on-failure, unless-stopped)
- `healthcheck`: Container health check configuration
- `remove_when_stopped`: Whether to remove the container after it's stopped

## Extension Settings

This extension contributes the following settings:

- `bluewasp-runner.configFile`: The name of the configuration file (default: `.bluewasp.yml`)

## Development

- Clone the repository
- Run `npm install`
- Open the project in VS Code
- Press F5 to launch the extension in a new window

## License

[MIT](LICENSE)

## Working With Variables

Blue Wasp Runner supports two types of variables:

### Global Variables

Define global variables at the top level of your configuration file:

```yaml
variables:
  PROJECT_NAME: myproject
  VERSION: 1.0.0
  BUILD_DIR: ./build
```

These variables can be used in any command with either `$VARIABLE_NAME` or `${VARIABLE_NAME}` syntax:

```yaml
commands:
  - name: echo-variables
    description: Echo the global variables
    command: echo "Project: $PROJECT_NAME, Version: ${VERSION}"
```

### Output Variables

Commands can define output variables that capture specific patterns from their output:

```yaml
commands:
  - name: set-output-variable
    description: Set an output variable
    command: echo "::set-output name=BUILD_TIME::$(date)"
    outputs:
      BUILD_TIME: # This will capture the output that matches the pattern
```

The command must output text in the format `::set-output name=VARIABLE_NAME::VALUE` to set a variable.

### Using Variables Between Commands

To use variables from one command in another, specify dependencies:

```yaml
commands:
  - name: first-command
    description: Generate a variable
    command: echo "::set-output name=ARTIFACT_NAME::myapp-1.0.0.zip"
    outputs:
      ARTIFACT_NAME:
  
  - name: second-command
    description: Use the variable from first command
    command: echo "Created artifact: ${ARTIFACT_NAME}"
    depends_on: first-command  # This ensures the variable is available
```

When using `depends_on`, Blue Wasp Runner will:
1. Ensure the dependency command runs first
2. Make its output variables available to the dependent command
3. Skip the dependent command if the dependency fails (unless `allow_failure: true` is set) 