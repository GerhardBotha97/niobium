# Niobium Runner

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://marketplace.visualstudio.com/items?itemName=niobiumrunner.niobium-runner)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

Niobium Runner is a powerful VS Code extension that provides a configurable command runner using `.niobium.yml` configuration files. It enables developers to define, organize, and execute commands directly from the IDE, streamlining development workflows.

## Features

- **Command Execution**: Run individual commands, stages, or sequences defined in your `.niobium.yml` file
- **Docker Integration**: Manage Docker containers directly from VS Code
- **File Watchers**: Set up watchers to trigger commands when files change
- **Custom Dashboard**: Visualize and manage your project's commands in a dedicated sidebar
- **Keyboard Shortcuts**: Configurable shortcuts for frequently used commands

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Niobium Runner"
4. Click Install

## Getting Started

1. Create a `.niobium.yml` file in your project root
2. Define your commands, stages, and sequences in the YAML file
3. Access the Niobium dashboard from the sidebar to run your commands

## Configuration

Create a `.niobium.yml` file in your project with a structure like this:

```yaml
commands:
  build:
    cmd: npm run build
    description: Build the project
  test:
    cmd: npm run test
    description: Run tests

stages:
  dev:
    - build
    - test

sequences:
  full-pipeline:
    - dev
```

## Command Palette

Niobium Runner adds several commands to the VS Code command palette (Ctrl+Shift+P):

- `Niobium: Run Command` - Execute a specific command
- `Niobium: Run Stage` - Execute a group of commands
- `Niobium: Run Sequence` - Execute a sequence of stages
- `Niobium: Show Dashboard` - Open the Niobium dashboard
- `Niobium: Show Runner` - Open the command runner interface

## Docker Integration

Manage Docker containers directly from VS Code:

- Start, stop, and remove containers
- View container logs
- Add new Docker containers

## File Watchers

Set up file watchers to automatically trigger commands when specific files change:

1. Navigate to the File Watchers view in the Niobium sidebar
2. Configure patterns and associated commands
3. Toggle watchers on/off as needed

## Keyboard Shortcuts

Customize keyboard shortcuts for your most frequently used commands:

1. Access keyboard shortcuts settings in VS Code
2. Search for "Niobium" commands
3. Assign your preferred key combinations

## Support

If you encounter any issues or have feature requests, please submit them on our GitHub repository.

## License

This extension is released under the MIT License. See the [LICENSE](LICENSE) file for details. 