# Niobium Runner

A VS Code extension that provides a configurable command runner using `.niobium.yml` configuration files.

## Features

- **Command Running**: Run shell commands, docker containers, or any other cli commands with advanced options
- **Stage Grouping**: Group commands into stages for better organization
- **Sequence Execution**: Create sequences of stages for complex workflows
- **Docker Integration**: Built-in Docker support for running containerized applications  
- **Variable Support**: Define and use variables throughout your configuration
- **Conditional Execution**: Skip commands or continue on failure based on conditions
- **Parallel Execution**: Run commands in parallel for faster execution
- **Visual Feedback**: See real-time command execution status in the VS Code UI
- **Command Templates**: Define command templates for reuse

## Usage

1. Create a `.niobium.yml` file in your project root
2. Define your commands, stages, and sequences
3. Run the commands from the VS Code command palette or the Niobium Runner view

## Configuration

The configuration file should be named `.niobium.yml` and placed in your project root:

```yaml
variables:
  APP_PORT: 3000
  DB_PORT: 5432

docker:
  containers:
    postgres:
      image: postgres:13
      environment:
        - POSTGRES_PASSWORD=postgres
        - POSTGRES_USER=postgres
      ports:
        - "${DB_PORT}:5432"
      volumes:
        - "./data:/var/lib/postgresql/data"

commands:
  start-db:
    description: Start PostgreSQL database
    docker: postgres
    allow_failure: false

  install:
    description: Install dependencies
    command: npm install
    cwd: ./app

  build:
    description: Build the application
    command: npm run build
    cwd: ./app
    env:
      NODE_ENV: production

  start-app:
    description: Start the application
    command: npm start
    cwd: ./app
    env:
      PORT: ${APP_PORT}
      DB_HOST: localhost
      DB_PORT: ${DB_PORT}
    background: true
    wait_for:
      port: ${APP_PORT}
      timeout: 30

stages:
  setup:
    description: Setup the environment
    commands:
      - start-db
      - install

  deploy:
    description: Deploy the application
    commands:
      - build
      - start-app

sequences:
  full-deploy:
    description: Full deployment process
    stages:
      - setup
      - deploy
```

## Advanced Features

### Docker Support

Niobium Runner has built-in Docker support. You can define Docker containers in your configuration and run commands inside them:

```yaml
docker:
  containers:
    node:
      image: node:16
      volumes:
        - .:/app
      working_dir: /app

commands:
  build:
    description: Build inside Docker
    docker: node
    command: npm run build
```

### Ignore Files

You can create a `.niobiumignore` file in your project root to specify files and directories that should be ignored by Niobium Runner. This is useful for excluding unnecessary files from Docker volumes or skipping commands in certain directories.

The `.niobiumignore` file uses the same syntax as `.gitignore`:

```
node_modules/
dist/
*.log
.git/
```

### Variables

You can define variables in your configuration file and use them throughout your commands:

```yaml
variables:
  PORT: 3000
  NODE_ENV: development

commands:
  start:
    command: node server.js
    env:
      PORT: ${PORT}
      NODE_ENV: ${NODE_ENV}
```

A sample `.niobiumignore` file is available in the examples directory.

### Parallel Execution

You can run commands in parallel by setting the `parallel` flag on a stage:

```yaml
stages:
  test:
    parallel: true
    commands:
      - test-unit
      - test-integration
      - test-e2e
```

### Templates

Define command templates for reuse:

```yaml
templates:
  npm-command:
    cwd: ./app
    env:
      NODE_ENV: development

commands:
  install:
    template: npm-command
    command: npm install

  start:
    template: npm-command
    command: npm start
```

## Extension Settings

This extension contributes the following settings:

- `niobium-runner.configFile`: The name of the configuration file (default: `.niobium.yml`)
- `niobium-runner.shell`: The shell to use for executing commands (default: system default)
- `niobium-runner.timeout`: Default timeout for commands in seconds (default: 30)
- `niobium-runner.showNotifications`: Show notifications for command status (default: true)
- `niobium-runner.dockerPath`: Path to the Docker executable (default: "docker")

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 