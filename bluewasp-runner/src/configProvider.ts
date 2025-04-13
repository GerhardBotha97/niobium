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

export interface BlueWaspConfig {
  commands: CommandConfig[];
  stages?: StageConfig[];
  sequences?: SequenceConfig[];
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
      
      if (!cmd.command) {
        vscode.window.showWarningMessage(`Skipping command "${cmd.name}" with missing command`);
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
    
    return {
      commands: validCommands,
      stages: validStages,
      sequences: validSequences
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
        if (cmdItem.name && cmdItem.command) {
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