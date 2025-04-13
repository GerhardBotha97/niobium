# Blue Wasp Runner

A VS Code extension that provides a configurable command runner using `.bluewasp.yml` configuration files.

## Features

- Run pre-configured commands from within VS Code
- Configure commands via YAML files
- Set environment variables and working directories for commands
- Access commands via Command Palette or Status Bar

## Usage

1. Create a `.bluewasp.yml` file in your project root
2. Define your commands in the YAML file
3. Run the commands using the Command Palette with "Run Blue Wasp Command"

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
```

## Command Properties

Each command can have the following properties:

- `name` (required): The name of the command
- `description`: A description of what the command does
- `command` (required): The actual command to execute
- `cwd`: The working directory relative to the project root
- `env`: Environment variables to set before running the command
- `shell`: Whether to run the command in a shell (default: true)

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