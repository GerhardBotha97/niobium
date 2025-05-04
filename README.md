<p align="center">
  <img src="static/niobium_logo.png" alt="Niobium Runner Logo" width="200"/>
</p>

<h1 align="center">Niobium Runner</h1>

<p align="center">
  A powerful, flexible VS Code extension for configurable command running with advanced workflows
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#advanced-features">Advanced Features</a> •
  <a href="#examples">Examples</a> •
  <a href="#keyboard-shortcuts">Keyboard Shortcuts</a> •
  <a href="#extension-settings">Settings</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

## Features

Niobium Runner brings powerful workflow automation capabilities to your VS Code environment:

- **Command Running**: Execute shell commands, Docker containers, or any CLI commands with advanced options
- **Stage Grouping**: Organize commands into logical stages for better workflow organization
- **Sequence Execution**: Create complex sequences by chaining stages together
- **Docker Integration**: Built-in Docker support for containerized applications and development environments
- **Variable Support**: Define global variables and capture command outputs as variables for seamless data passing
- **Conditional Execution**: Skip commands or continue on failure based on configurable conditions
- **Parallel Execution**: Run commands in parallel for faster execution of independent tasks
- **File Watchers**: Automatically run commands when files change to streamline your development workflow
- **Pre-Commit Hooks**: Run validation stages before commits to ensure code quality
- **Visual Feedback**: See real-time command execution status in the VS Code UI
- **Command Templates**: Define reusable command templates to reduce configuration duplication
- **Configuration Sharing**: Include and reuse configurations from local or remote sources

## Installation

You can install Niobium Runner from the VS Code Marketplace:

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Niobium Runner"
4. Click Install

Alternatively, you can install it using the VS Code Quick Open (Ctrl+P / Cmd+P):

```
ext install niobium-runner
```

## Getting Started

### 1. Create Configuration File

Create a `.niobium.yml` file in your project root:

```yaml
variables:
  PROJECT_NAME: myproject
  VERSION: 1.0.0

commands:
  hello:
    description: Say hello
    command: echo "Hello from Niobium!"
  
  build:
    description: Build the project
    command: echo "Building ${PROJECT_NAME} v${VERSION}"

stages:
  setup:
    description: Setup stage
    commands:
      - hello
      - build
```

### 2. Run Commands

Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and type:
- "Niobium: Run Command" to run a single command
- "Niobium: Run Stage" to run a stage
- "Niobium: Run Sequence" to run a sequence

### 3. View Output

Niobium Runner will show the command output in the Output panel. You can also access it through:
- Command Palette: "Niobium: Show Output Panel"
- Keyboard Shortcut: Ctrl+Shift+O / Cmd+Shift+O

## Configuration

The configuration file (`.niobium.yml`) can contain the following sections:

### Variables

Define global variables that can be used throughout your commands:

```yaml
variables:
  APP_PORT: 3000
  DB_PORT: 5432
  NODE_ENV: development
```

### Commands

Define individual commands to run:

```yaml
commands:
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
```

### Docker Integration

Define Docker containers to use in your commands:

```yaml
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
```

### Stages

Group commands into logical stages:

```yaml
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
```

### Sequences

Chain stages together for complete workflows:

```yaml
sequences:
  full-deploy:
    description: Full deployment process
    stages:
      - setup
      - deploy
```

## Advanced Features

### Including Other Config Files

Split your configuration across multiple files:

```yaml
include:
  - security.niobium.yml
  - ./build/npm.niobium.yml
  - /path/to/absolute/location.niobium.yml
```

### Remote Configuration Inclusion

Include configurations from remote sources:

```yaml
include:
  url: https://github.com/user/repo/blob/main/.niobium.yml
  auth:
    type: token
    token: ${GITHUB_TOKEN}
  refresh:
    interval: 60
```

### Ignore Files

Create a `.niobiumignore` file to exclude files and directories:

```
node_modules/
dist/
*.log
.git/
```

### Variable Passing

Capture command outputs as variables:

```yaml
commands:
  generate-id:
    description: Generate a unique ID
    command: echo "::set-output name=BUILD_ID::$(date +%Y%m%d%H%M%S)"
    outputs:
      BUILD_ID:
  
  use-id:
    description: Use the generated ID
    command: echo "Build ID is ${BUILD_ID}"
    depends_on: generate-id
```

### Parallel Execution

Run commands in parallel:

```yaml
stages:
  test:
    parallel: true
    commands:
      - test-unit
      - test-integration
      - test-e2e
```

### Command Templates

Create reusable command templates:

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
```

### File Watchers

Run commands when files change:

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
        - "!src/**/*.test.ts"
      debounce: 500
```

### Pre-Commit Hooks

Run validations before committing code:

```yaml
stages:
  lint:
    description: Check code quality
    commands:
      - run-eslint
      - run-tests
    watch:
      patterns:
        - "src/**/*.js"
        - "src/**/*.ts"
      pre_commit: true
```

## Examples

### Basic Configuration

```yaml
variables:
  APP_PORT: 3000
  DB_PORT: 5432

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

### Security Scanning Example

```yaml
commands:
  secret-scan:
    description: Check for secrets and credentials
    command: gitleaks detect -v --source . --report-path report.json
    allow_failure: false

  security-audit:
    description: Run npm security audit
    command: npm audit
    allow_failure: true

stages:
  security:
    description: Run security checks
    commands:
      - secret-scan
      - security-audit
    watch:
      patterns:
        - "**/*.js"
        - "**/*.ts"
        - "**/*.json"
      pre_commit: true
```

## Keyboard Shortcuts

| Feature | Windows/Linux | macOS |
|---------|--------------|-------|
| Run Command | `Ctrl+Shift+R` | `Cmd+Shift+R` |
| Run Stage | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Run Sequence | `Ctrl+Shift+Q` | `Cmd+Shift+Q` |
| Show Output | `Ctrl+Shift+O` | `Cmd+Shift+O` |
| Show Dashboard | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| Run Docker Container | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| Refresh Views | `Ctrl+Shift+F5` | `Cmd+Shift+F5` |
| Show Keyboard Shortcuts | `Ctrl+Shift+K` | `Cmd+Shift+K` |

## Extension Settings

- `niobium-runner.configFile`: Configuration file name (default: `.niobium.yml`)
- `niobium-runner.shell`: Shell to use for executing commands
- `niobium-runner.timeout`: Default timeout for commands in seconds (default: 30)
- `niobium-runner.showNotifications`: Show notifications for command status
- `niobium-runner.dockerPath`: Path to the Docker executable
- `niobium-runner.fileWatchers.enabled`: Enable file watchers
- `niobium-runner.fileWatchers.defaultDebounce`: Default debounce time for file watchers
- `niobium-runner.fileWatchers.showNotifications`: Show notifications for file watcher triggers
- `niobium-runner.gitHooks.enabled`: Enable Git hooks integration
- `niobium-runner.gitHooks.installPreCommit`: Install pre-commit hook automatically

## Documentation

For detailed documentation, visit the [Niobium Runner Documentation](https://niobium-runner.docs.com).

Check out the [Command Reference](https://niobium-runner.docs.com/reference) for a complete list of all available options and configurations.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 