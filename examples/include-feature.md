# Config Include Feature - Practical Example

Below are practical examples you can copy and use directly in your project to implement configuration includes.

## Project Structure

```
your-project/
├── .niobium.yml           # Main config file
├── security.niobium.yml   # Security scanning config
└── build/
    └── npm.niobium.yml    # NPM build commands config
```

## Main Configuration File (.niobium.yml)

```yaml
# Main .niobium.yml file with includes
include:
  - security.niobium.yml
  - ./build/npm.niobium.yml

# Define global variables that can be used in all config files
variables:
  PROJECT_NAME: my-project
  VERSION: 1.0.0
  NODE_ENV: development

# Commands defined in the main file
commands:
  - name: run-dev
    description: "Start the development server"
    command: npm run dev
    env:
      PORT: 3000
  
  - name: check-all
    description: "Run all checks"
    command: echo "Running all checks..."
    depends_on:
      - security-scan
      - lint-code

# Combined stage using commands from multiple files
stages:
  - name: validate
    description: "Validate the project"
    commands:
      - security-scan     # From security.niobium.yml
      - lint-code         # From security.niobium.yml
      - npm-test          # From build/npm.niobium.yml
  
  - name: build-and-deploy
    description: "Build and deploy"
    commands:
      - npm-install       # From build/npm.niobium.yml
      - npm-build         # From build/npm.niobium.yml
      - name: deploy
        description: "Deploy to production"
        command: echo "Deploying ${PROJECT_NAME} version ${VERSION}"
        depends_on: npm-build

# Sequence that combines stages from different files
sequences:
  - name: ci-pipeline
    description: "Complete CI pipeline"
    stages:
      - validate
      - security           # From security.niobium.yml
      - build              # From build/npm.niobium.yml
      - build-and-deploy
```

## Security Config File (security.niobium.yml)

```yaml
# Security configuration file
commands:
  - name: security-scan
    description: "Run security scanning"
    command: |
      echo "Running security scan..."
      echo "::set-output name=SCAN_ID::$(date +%s)"
    outputs:
      SCAN_ID:
  
  - name: lint-code
    description: "Lint the code for security issues"
    command: echo "Linting code for security issues..."
  
  - name: dependency-check
    description: "Check dependencies for vulnerabilities"
    command: echo "Checking dependencies for vulnerabilities..."
    depends_on: security-scan

stages:
  - name: security
    description: "Run all security checks"
    commands:
      - security-scan
      - lint-code
      - dependency-check
```

## Build Config File (build/npm.niobium.yml)

```yaml
# NPM build configuration file
commands:
  - name: npm-install
    description: "Install npm dependencies"
    command: npm install
  
  - name: npm-test
    description: "Run tests"
    command: npm test
    depends_on: npm-install
  
  - name: npm-build
    description: "Build the project"
    command: npm run build
    env:
      NODE_ENV: production
    depends_on: npm-install

stages:
  - name: build
    description: "Build the npm project"
    commands:
      - npm-install
      - npm-test
      - npm-build
```

## How to Use

1. Copy the above YAML examples into the appropriate files in your project
2. Customize the commands and settings as needed
3. Run your commands, stages or sequences from VS Code
4. Changes to any included file will be automatically detected when you run a command

## Tips for Effective Config Organization

1. **Split by Purpose**: Separate configs by their purpose (security, build, deploy)
2. **Split by Technology**: Create separate files for different technologies (npm, docker, etc)
3. **Common Base**: Share common configurations across multiple projects
4. **Environment-Specific**: Create separate files for different environments

## Using Variables Across Files

Variables defined in the main config or included configs are available in all commands, regardless of which file they're defined in. This allows you to define common settings in one place and use them everywhere.

## Troubleshooting

If you encounter issues with included files:

1. Check that the paths are correct relative to the including file
2. Verify that included files have the correct YAML structure
3. Check the VS Code log for any warnings or errors
4. Try simplifying your configuration to isolate the problem 