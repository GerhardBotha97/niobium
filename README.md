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

## Usage

1. Create a `.bluewasp.yml` file in your project root
2. Define your commands and Docker containers in the YAML file
3. Run the commands or containers using the Command Palette

## Configuration File Format

The configuration file should be named `.bluewasp.yml` and placed in your project root:

```yaml
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
```

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