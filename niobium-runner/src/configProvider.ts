import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RemoteFileConfig, downloadRemoteFile, parseRemoteFile, getRemoteFilePath } from './utils/remoteFileUtils';

export interface CommandConfig {
  name: string;
  description?: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  allow_failure?: boolean;
  output_file?: string;
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
  parallel?: boolean;
  watch?: {
    patterns: string[];
    debounce?: number;
    pre_commit?: boolean;
  };
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

export interface NiobiumConfig {
  commands: CommandConfig[];
  stages?: StageConfig[];
  sequences?: SequenceConfig[];
  containers?: DockerContainerConfig[];
  // New field for global variables
  variables?: Record<string, string>;
  // New field for including other config files
  include?: string | string[] | RemoteIncludeConfig | RemoteIncludeConfig[];
}

// New interface for remote includes
export interface RemoteIncludeConfig {
  url: string;
  auth?: {
    type: 'token' | 'basic' | 'oauth' | 'none';
    token?: string;
    username?: string;
    password?: string;
  };
  headers?: Record<string, string>;
  refresh?: {
    interval?: number; // In minutes
    force?: boolean;   // Force refresh even if file exists
  };
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

export interface ConfigLoadOptions {
  forceRefreshRemoteIncludes?: boolean;
}

export class ConfigProvider {
  async loadConfig(workspaceRoot: string): Promise<NiobiumConfig | null> {
    return this.loadConfigWithOptions(workspaceRoot, {});
  }

  async loadConfigWithOptions(workspaceRoot: string, options: ConfigLoadOptions = {}): Promise<NiobiumConfig | null> {
    try {
      const configFile = vscode.workspace.getConfiguration('niobium-runner').get<string>('configFile') || '.niobium.yml';
      const configPath = path.join(workspaceRoot, configFile);
      
      if (!fs.existsSync(configPath)) {
        vscode.window.showWarningMessage(`Configuration file not found: ${configPath}`);
        return null;
      }
      
      const fileContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContent) as NiobiumConfig;
      
      if (!config || !Array.isArray(config.commands)) {
        vscode.window.showErrorMessage('Invalid configuration file format. Expected "commands" array.');
        return null;
      }
      
      // Save force refresh option to be used during include processing
      this._forceRefreshRemoteIncludes = options.forceRefreshRemoteIncludes || false;
      
      // Process includes if present
      if (config.include) {
        await this.processIncludes(config, workspaceRoot, path.dirname(configPath));
      }
      
      // Load global variables into VariableManager if defined
      if (config.variables) {
        const variableManager = VariableManager.getInstance();
        for (const [key, value] of Object.entries(config.variables)) {
          variableManager.setVariable(key, String(value));
        }
      }
      
      // Clear the force refresh flag after processing
      this._forceRefreshRemoteIncludes = false;
      
      return this.validateConfig(config);
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // Private property to track force refresh option
  private _forceRefreshRemoteIncludes: boolean = false;
  
  private validateConfig(config: NiobiumConfig): NiobiumConfig {
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
  findCommand(config: NiobiumConfig, commandName: string): CommandConfig | undefined {
    return config.commands.find(cmd => cmd.name === commandName);
  }

  // Helper method to find a stage by name
  findStage(config: NiobiumConfig, stageName: string): StageConfig | undefined {
    return config.stages?.find(stage => stage.name === stageName);
  }

  // Helper method to find a sequence by name
  findSequence(config: NiobiumConfig, sequenceName: string): SequenceConfig | undefined {
    return config.sequences?.find(seq => seq.name === sequenceName);
  }

  // Helper method to find a container by name
  findContainer(config: NiobiumConfig, containerName: string): DockerContainerConfig | undefined {
    return config.containers?.find(container => container.name === containerName);
  }

  // Helper method to get commands for a stage
  getStageCommands(config: NiobiumConfig, stageName: string): CommandConfig[] {
    const stage = this.findStage(config, stageName);
    if (!stage) {
      return [];
    }

    // Stage commands can be either string references to command names or inline command objects
    return stage.commands.map(cmdItem => {
      if (typeof cmdItem === 'string') {
        // This is a reference to a command by name
        const cmd = this.findCommand(config, cmdItem);
        if (!cmd) {
          vscode.window.showWarningMessage(`Stage "${stageName}" references non-existent command "${cmdItem}"`);
          // Return a minimal command that will fail gracefully
          return {
            name: cmdItem,
            description: `Missing command: ${cmdItem}`,
            command: 'echo "Command not found"',
            allow_failure: true
          };
        }
        return cmd;
      } else {
        // This is an inline command object
        return cmdItem;
      }
    });
  }

  // Helper method to get stages for a sequence
  getSequenceStages(config: NiobiumConfig, sequenceName: string): StageConfig[] {
    const sequence = this.findSequence(config, sequenceName);
    if (!sequence) {
      return [];
    }

    return sequence.stages.map(stageName => {
      const stage = this.findStage(config, stageName);
      if (!stage) {
        vscode.window.showWarningMessage(`Sequence "${sequenceName}" references non-existent stage "${stageName}"`);
        // Return a minimal stage that will fail gracefully
        return {
          name: stageName,
          description: `Missing stage: ${stageName}`,
          commands: [],
          allow_failure: true
        };
      }
      return stage;
    });
  }

  // Add a new method to process environment variables in strings
  private processEnvVars(inputString: string): string {
    if (!inputString || typeof inputString !== 'string') {
      return inputString;
    }

    return inputString.replace(/\${([^}]+)}/g, (match, envVarName) => {
      // Process inline variables from VariableManager
      const variableManager = VariableManager.getInstance();
      const varValue = variableManager.getVariable(envVarName);
      if (varValue !== undefined) {
        return varValue;
      }

      // Process environment variables
      const envValue = process.env[envVarName];
      return envValue !== undefined ? envValue : match;
    });
  }

  // Update the processIncludes method to handle file refreshing
  private async processIncludes(config: NiobiumConfig, workspaceRoot: string, basePath: string): Promise<void> {
    // Normalize includes to array form
    const includeItems = Array.isArray(config.include) 
      ? config.include 
      : (config.include ? [config.include] : []);
    
    for (const includeItem of includeItems) {
      try {
        let fullPath: string;
        let isRemote = false;
        let shouldDownload = true;
        
        // Check if this is a remote include
        if (typeof includeItem === 'object' && includeItem.url) {
          isRemote = true;
          // This is a remote include
          const remoteConfig = includeItem as RemoteIncludeConfig;
          
          // Process environment variables in URL and auth token
          const processedUrl = this.processEnvVars(remoteConfig.url);
          
          // Process auth values if present
          let processedAuth = remoteConfig.auth;
          if (processedAuth) {
            if (processedAuth.token) {
              processedAuth = {
                ...processedAuth,
                token: this.processEnvVars(processedAuth.token)
              };
            }
            
            if (processedAuth.username) {
              processedAuth = {
                ...processedAuth,
                username: this.processEnvVars(processedAuth.username)
              };
            }
            
            if (processedAuth.password) {
              processedAuth = {
                ...processedAuth,
                password: this.processEnvVars(processedAuth.password)
              };
            }
          }
          
          // Get the local path for this remote file
          fullPath = getRemoteFilePath(processedUrl, workspaceRoot);
          
          // Check if we need to download the file
          if (fs.existsSync(fullPath)) {
            // File exists, check if refresh is needed
            
            // If global force refresh is enabled, always download
            if (this._forceRefreshRemoteIncludes) {
              shouldDownload = true;
            } else if (remoteConfig.refresh) {
              if (remoteConfig.refresh.force) {
                // Force refresh requested in config
                shouldDownload = true;
              } else if (remoteConfig.refresh.interval) {
                // Check file modification time
                const stats = fs.statSync(fullPath);
                const fileModTime = stats.mtime;
                const currentTime = new Date();
                const diffMinutes = (currentTime.getTime() - fileModTime.getTime()) / (1000 * 60);
                
                // Download if file is older than the refresh interval
                shouldDownload = diffMinutes >= remoteConfig.refresh.interval;
              } else {
                // No interval specified, don't download
                shouldDownload = false;
              }
            } else {
              // No refresh options, don't download
              shouldDownload = false;
            }
          }
          
          // Download the file if needed
          if (shouldDownload) {
            try {
              // Download the remote file
              await downloadRemoteFile(
                parseRemoteFile(processedUrl, processedAuth),
                fullPath
              );
              
              vscode.window.showInformationMessage(`Successfully downloaded remote configuration from ${processedUrl}`);
            } catch (downloadError) {
              throw new Error(`Failed to download remote file from ${processedUrl}: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
            }
          } else {
            vscode.window.showInformationMessage(`Using cached configuration from ${processedUrl}`);
          }
        } else if (typeof includeItem === 'string') {
          // Local file include - also process env vars
          const processedIncludePath = this.processEnvVars(includeItem);
          
          // Resolve the include path relative to the base path
          fullPath = path.isAbsolute(processedIncludePath)
            ? processedIncludePath
            : path.resolve(basePath, processedIncludePath);
          
          // Check if file exists
          if (!fs.existsSync(fullPath)) {
            vscode.window.showWarningMessage(`Included configuration file not found: ${processedIncludePath}`);
            continue;
          }
        } else {
          throw new Error(`Invalid include item: ${JSON.stringify(includeItem)}`);
        }
        
        // Read and parse the include file
        const includeContent = fs.readFileSync(fullPath, 'utf8');
        const includeConfig = yaml.load(includeContent) as Partial<NiobiumConfig>;
        
        if (!includeConfig) {
          throw new Error(`Invalid YAML in included file: ${fullPath}`);
        }
        
        // Merge configs
        if (includeConfig.commands) {
          config.commands = [...config.commands, ...includeConfig.commands];
        }
        
        if (includeConfig.stages) {
          config.stages = [...(config.stages || []), ...includeConfig.stages];
        }
        
        if (includeConfig.sequences) {
          config.sequences = [...(config.sequences || []), ...includeConfig.sequences];
        }
        
        if (includeConfig.containers) {
          config.containers = [...(config.containers || []), ...includeConfig.containers];
        }
        
        if (includeConfig.variables) {
          config.variables = {
            ...(config.variables || {}),
            ...includeConfig.variables
          };
        }
        
        // Process nested includes recursively
        if (includeConfig.include) {
          const nestedConfig = {
            commands: config.commands,
            stages: config.stages,
            sequences: config.sequences,
            containers: config.containers,
            variables: config.variables,
            include: includeConfig.include
          };
          
          await this.processIncludes(nestedConfig, workspaceRoot, isRemote ? workspaceRoot : path.dirname(fullPath));
        }
      } catch (error) {
        vscode.window.showWarningMessage(`Error processing included file ${
          typeof includeItem === 'string' ? includeItem : (includeItem as RemoteIncludeConfig).url
        }: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
} 