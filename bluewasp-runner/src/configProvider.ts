import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface CommandConfig {
  name: string;
  description?: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  allow_failure?: boolean;
  // Docker integration
  image?: string;
  image_tag?: string;
  container_name?: string;
  ports?: DockerPortConfig[];
  volumes?: DockerVolumeConfig[];
  workdir?: string;
  network?: string;
  entrypoint?: string;
  remove_after_run?: boolean;
  // New fields for variable passing
  outputs?: Record<string, string>;
  depends_on?: string | string[];
}

export interface StageConfig {
  name: string;
  description?: string;
  commands: string[] | CommandConfig[];
  allow_failure?: boolean;
}

export interface SequenceConfig {
  name: string;
  description?: string;
  stages: string[];
}

export interface DockerVolumeConfig {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface DockerPortConfig {
  host: number | string;
  container: number | string;
}

export interface DockerContainerConfig {
  name: string;
  description?: string;
  image: string;
  tag?: string;
  ports?: DockerPortConfig[];
  volumes?: DockerVolumeConfig[];
  environment?: Record<string, string>;
  command?: string;
  entrypoint?: string;
  network?: string;
  workdir?: string;
  restart_policy?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  healthcheck?: {
    command: string;
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  remove_when_stopped?: boolean;
}

export interface BlueWaspConfig {
  commands: CommandConfig[];
  stages?: StageConfig[];
  sequences?: SequenceConfig[];
  containers?: DockerContainerConfig[];
  // New field for global variables
  variables?: Record<string, string>;
}

// Storage for output variables to enable passing between commands
export class VariableManager {
  private static instance: VariableManager;
  private outputVariables: Record<string, string> = {};

  private constructor() { }

  public static getInstance(): VariableManager {
    if (!VariableManager.instance) {
      VariableManager.instance = new VariableManager();
    }
    return VariableManager.instance;
  }

  // Set a variable value
  setVariable(name: string, value: string): void {
    this.outputVariables[name] = value;
  }

  // Get a variable value
  getVariable(name: string): string | undefined {
    return this.outputVariables[name];
  }

  // Get all variables as a map
  getAllVariables(): Record<string, string> {
    return { ...this.outputVariables };
  }

  // Clear all variables
  clearVariables(): void {
    this.outputVariables = {};
  }
}

export class ConfigProvider {
  async loadConfig(workspaceRoot: string): Promise<BlueWaspConfig | null> {
    try {
      const configFile = vscode.workspace.getConfiguration('bluewasp-runner').get<string>('configFile') || '.bluewasp.yml';
      const configPath = path.join(workspaceRoot, configFile);
      
      if (!fs.existsSync(configPath)) {
        vscode.window.showWarningMessage(`Configuration file not found: ${configPath}`);
        return null;
      }
      
      const fileContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContent) as BlueWaspConfig;
      
      if (!config || !Array.isArray(config.commands)) {
        vscode.window.showErrorMessage('Invalid configuration file format. Expected "commands" array.');
        return null;
      }
      
      // Load global variables into VariableManager if defined
      if (config.variables) {
        const variableManager = VariableManager.getInstance();
        for (const [key, value] of Object.entries(config.variables)) {
          variableManager.setVariable(key, String(value));
        }
      }
      
      return this.validateConfig(config);
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  private validateConfig(config: BlueWaspConfig): BlueWaspConfig {
    // Ensure all commands have required fields
    const validCommands = config.commands.filter(cmd => {
      if (!cmd.name) {
        vscode.window.showWarningMessage(`Skipping command with missing name`);
        return false;
      }
      
      // Command can either have a command or an image, but at least one is required
      if (!cmd.command && !cmd.image) {
        vscode.window.showWarningMessage(`Skipping command "${cmd.name}" with missing command or image`);
        return false;
      }
      
      return true;
    });
    
    // Validate stages if present
    const validStages = config.stages?.filter(stage => {
      if (!stage.name) {
        vscode.window.showWarningMessage(`Skipping stage with missing name`);
        return false;
      }
      
      if (!Array.isArray(stage.commands) || stage.commands.length === 0) {
        vscode.window.showWarningMessage(`Skipping stage "${stage.name}" with missing or empty commands`);
        return false;
      }
      
      return true;
    });
    
    // Validate sequences if present
    const validSequences = config.sequences?.filter(sequence => {
      if (!sequence.name) {
        vscode.window.showWarningMessage(`Skipping sequence with missing name`);
        return false;
      }
      
      if (!Array.isArray(sequence.stages) || sequence.stages.length === 0) {
        vscode.window.showWarningMessage(`Skipping sequence "${sequence.name}" with missing or empty stages`);
        return false;
      }
      
      return true;
    });
    
    // Validate Docker containers if present
    const validContainers = config.containers?.filter(container => {
      if (!container.name) {
        vscode.window.showWarningMessage(`Skipping container with missing name`);
        return false;
      }
      
      if (!container.image) {
        vscode.window.showWarningMessage(`Skipping container "${container.name}" with missing image`);
        return false;
      }
      
      return true;
    });
    
    // Add validation for command dependencies and outputs
    config.commands.forEach(cmd => {
      if (cmd.depends_on) {
        const dependencies = Array.isArray(cmd.depends_on) ? cmd.depends_on : [cmd.depends_on];
        
        for (const dependency of dependencies) {
          if (!config.commands.some(c => c.name === dependency)) {
            vscode.window.showWarningMessage(`Command "${cmd.name}" depends on non-existent command "${dependency}"`);
          }
        }
      }
      
      if (cmd.outputs && Object.keys(cmd.outputs).length > 0) {
        // Ensure output variable names are valid
        for (const outputName of Object.keys(cmd.outputs)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(outputName)) {
            vscode.window.showWarningMessage(`Invalid output variable name "${outputName}" in command "${cmd.name}"`);
          }
        }
      }
    });
    
    return {
      commands: validCommands,
      stages: validStages,
      sequences: validSequences,
      containers: validContainers,
      variables: config.variables
    };
  }

  // Helper method to find a command by name
  findCommand(config: BlueWaspConfig, commandName: string): CommandConfig | undefined {
    return config.commands.find(cmd => cmd.name === commandName);
  }

  // Helper method to find a stage by name
  findStage(config: BlueWaspConfig, stageName: string): StageConfig | undefined {
    return config.stages?.find(stage => stage.name === stageName);
  }

  // Helper method to find a sequence by name
  findSequence(config: BlueWaspConfig, sequenceName: string): SequenceConfig | undefined {
    return config.sequences?.find(sequence => sequence.name === sequenceName);
  }
  
  // Helper method to find a container by name
  findContainer(config: BlueWaspConfig, containerName: string): DockerContainerConfig | undefined {
    return config.containers?.find(container => container.name === containerName);
  }

  // Get all commands for a stage, resolving string references to actual commands
  getStageCommands(config: BlueWaspConfig, stageName: string): CommandConfig[] {
    const stage = this.findStage(config, stageName);
    if (!stage) {
      return [];
    }

    const commands: CommandConfig[] = [];
    
    for (const cmdItem of stage.commands) {
      if (typeof cmdItem === 'string') {
        // This is a reference to an existing command
        const cmd = this.findCommand(config, cmdItem);
        if (cmd) {
          // Inherit allow_failure from stage if not specified in command
          if (stage.allow_failure !== undefined && cmd.allow_failure === undefined) {
            commands.push({
              ...cmd,
              allow_failure: stage.allow_failure
            });
          } else {
            commands.push(cmd);
          }
        } else {
          vscode.window.showWarningMessage(`Command "${cmdItem}" referenced in stage "${stageName}" not found`);
        }
      } else {
        // This is an inline command definition
        if ((cmdItem.name && cmdItem.command) || (cmdItem.name && cmdItem.image)) {
          // Inherit allow_failure from stage if not specified in command
          if (stage.allow_failure !== undefined && cmdItem.allow_failure === undefined) {
            commands.push({
              ...cmdItem,
              allow_failure: stage.allow_failure
            });
          } else {
            commands.push(cmdItem);
          }
        }
      }
    }
    
    return commands;
  }

  // Get all stages for a sequence
  getSequenceStages(config: BlueWaspConfig, sequenceName: string): StageConfig[] {
    const sequence = this.findSequence(config, sequenceName);
    if (!sequence) {
      return [];
    }

    const stages: StageConfig[] = [];
    
    for (const stageName of sequence.stages) {
      const stage = this.findStage(config, stageName);
      if (stage) {
        stages.push(stage);
      } else {
        vscode.window.showWarningMessage(`Stage "${stageName}" referenced in sequence "${sequenceName}" not found`);
      }
    }
    
    return stages;
  }
} 