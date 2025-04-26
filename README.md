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

### File Watchers

You can set up file watchers to automatically run stages when files change:

```yaml
stages:
  build:
    description: Build the application
    commands:
      - transpile
      - bundle
    watch:
      patterns:
        - "src/**/*.ts"
        - "src/**/*.tsx"
        - "!src/**/*.test.ts"  # Exclude test files with ! prefix
      debounce: 500  # Milliseconds to wait before triggering
```

File watchers support:
- Multiple glob patterns to match files
- Exclusion patterns (prefix with !)
- Configurable debounce time
- Enable/disable from the VS Code UI

The file watcher status is displayed in the status bar, and you can manage watchers from the File Watchers view in the Niobium sidebar.

## Extension Settings

This extension contributes the following settings:

- `niobium-runner.configFile`: The name of the configuration file (default: `.niobium.yml`)
- `niobium-runner.shell`: The shell to use for executing commands (default: system default)
- `niobium-runner.timeout`: Default timeout for commands in seconds (default: 30)
- `niobium-runner.showNotifications`: Show notifications for command status (default: true)
- `niobium-runner.dockerPath`: Path to the Docker executable (default: "docker")
- `niobium-runner.fileWatchers.enabled`: Enable file watchers to automatically run stages when files change (default: true)
- `niobium-runner.fileWatchers.defaultDebounce`: Default debounce time in milliseconds for file watchers (default: 500)
- `niobium-runner.fileWatchers.showNotifications`: Show notifications when a file watcher triggers a stage run (default: true)

## Keyboard Shortcuts

Niobium Runner provides the following keyboard shortcuts for quick access to common features:

| Feature | Windows/Linux | macOS |
|---------|--------------|-------|
| Run Command | `Ctrl+Shift+R` | `Cmd+Shift+R` |
| Run Stage | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Run Sequence | `Ctrl+Shift+Q` | `Cmd+Shift+Q` |
| Show Output | `Ctrl+Shift+O` | `Cmd+Shift+O` |
| Show Dashboard | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| Run Docker Container | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| Refresh Views | `Ctrl+Shift+F5` | `Cmd+Shift+F5` (when focused on Niobium views) |
| Show Keyboard Shortcuts | `Ctrl+Shift+K` | `Cmd+Shift+K` |

These shortcuts are available when the editor has focus, allowing you to quickly run tasks without navigating menus.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 