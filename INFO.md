# Blue Wasp Runner - Command Reference

## Configuration File

Blue Wasp Runner uses `.bluewasp.yml` files to configure commands, stages, and sequences that can be executed from VS Code. The configuration file should be placed in your project root.

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

sequences:
  - name: Sequence Name
    description: Sequence description
    stages:
      - Stage Name 1  # Reference to a stage by name
      - Stage Name 2
```

## Command Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | The name of the command shown in the quick pick menu |
| `description` | No | A description of what the command does |
| `command` | Yes | The actual command to execute |
| `cwd` | No | Working directory (relative to workspace root) |
| `env` | No | Environment variables as key-value pairs |
| `shell` | No | Whether to run in shell (defaults to true) |
| `allow_failure` | No | Whether the command is allowed to fail without stopping execution (default: false) |

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

stages:
  - name: Test Stage
    commands:
      - Install Dependencies
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

2. Select the command, stage, or sequence from the list that appears

## Output and Execution Details

The extension captures and displays:
- Command output and errors in the Output panel
- Execution times and exit codes
- Failure information and handling
- Progress through stages and sequences

## Extension Settings

This extension provides the following settings:

- `bluewasp-runner.configFile`: The name of the configuration file (default: `.bluewasp.yml`)
- `bluewasp-runner.showOutputOnRun`: Whether to automatically show the output panel when running (default: true) 