import * as vscode from 'vscode';
import * as Dockerode from 'dockerode';
import { DockerContainerConfig } from './configProvider';
import { JobOutputService } from './ui/jobOutputService';
import { IgnoreProvider } from './utils/ignoreUtils';
import * as path from 'path';
import { sanitizeContainerName } from './utils/dockerUtils';

// Interface to track Docker execution results
export interface DockerExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  containerId?: string;
  statusCode?: number;
}

export class DockerRunner {
  private docker: Dockerode;
  private outputChannel: vscode.OutputChannel;
  private jobOutputService: JobOutputService;
  private runningContainers: Map<string, Dockerode.Container> = new Map();
  private ignoreProvider: IgnoreProvider;
  private containerLogs: Map<string, string> = new Map(); // Store logs for each container

  constructor(context?: vscode.ExtensionContext) {
    this.docker = new Dockerode();
    this.outputChannel = vscode.window.createOutputChannel('Blue Wasp Docker');
    this.jobOutputService = context ? JobOutputService.getInstance(context) : null as any;
    this.ignoreProvider = IgnoreProvider.getInstance();
  }

  /**
   * Check if a path should be ignored based on .niobiumignore patterns
   * @param filePath Path to check (relative to workspace root)
   * @param workspaceRoot Workspace root path
   * @returns True if the path should be ignored
   */
  private shouldIgnorePath(filePath: string, workspaceRoot: string): boolean {
    // Get path relative to workspace root
    let relativePath = filePath;
    if (filePath.startsWith(workspaceRoot)) {
      relativePath = path.relative(workspaceRoot, filePath);
    }
    
    // Normalize path separators
    relativePath = relativePath.replace(/\\/g, '/');
    
    return this.ignoreProvider.isIgnored(relativePath);
  }

  /**
   * Helper function to clean Docker log output
   * Removes ANSI color codes and control characters
   */
  private cleanDockerOutput(logs: string): string {
    // First remove standard ANSI escape sequences
    let cleaned = logs
      // Remove ANSI color escape sequences
      .replace(/\u001b\[\d+(;\d+)*m/g, '')
      // Remove other common ANSI escape sequences
      .replace(/\u001b\[K/g, '')  // Clear line
      .replace(/\u001b\[\d+[A-Za-z]/g, '');  // Cursor movement commands
    
    // Remove any other control characters (except newlines, tabs, and carriage returns)
    cleaned = cleaned.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    
    return cleaned;
  }

  /**
   * Start a Docker container based on the provided configuration
   */
  async startContainer(container: DockerContainerConfig, workspaceRoot: string): Promise<DockerExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n[Container] Starting: ${container.name}`);
    if (container.description) {
      this.outputChannel.appendLine(`Description: ${container.description}`);
    }
    this.outputChannel.appendLine(`Image: ${container.image}${container.tag ? `:${container.tag}` : ''}`);
    if (container.command) {
      this.outputChannel.appendLine(`Command: ${container.command}`);
    }
    
    // Ensure container name is valid for Docker
    const sanitizedContainerName = sanitizeContainerName(container.name);
    if (sanitizedContainerName !== container.name) {
      this.outputChannel.appendLine(`Sanitized container name to: ${sanitizedContainerName}`);
      container = { ...container, name: sanitizedContainerName };
    }
    
    // Record start time
    const startTime = new Date();
    this.outputChannel.appendLine(`Starting at: ${startTime.toLocaleTimeString()}`);
    
    // Create job in web view if JobOutputService is available
    let jobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      
      // We need to convert the DockerContainerConfig to CommandConfig format
      // to work with existing JobOutputService
      const containerCommand = `docker run ${container.image}${container.tag ? `:${container.tag}` : ''}${container.command ? ` ${container.command}` : ''}`;
      
      jobId = this.jobOutputService.startCommand({
        name: container.name,
        description: container.description || `Docker container: ${container.image}`,
        command: containerCommand
      });
      
      // Register kill handler for the container job
      if (jobId) {
        this.jobOutputService.registerKillHandler(jobId, async () => {
          this.outputChannel.appendLine(`[INFO] Kill request received for container: ${container.name}`);
          const result = await this.stopContainer(container.name);
          
          if (result.success) {
            this.jobOutputService.appendOutput(jobId!, '\n[System] Container stopped successfully');
            this.jobOutputService.completeJobSuccess(jobId!);
          } else {
            this.jobOutputService.appendError(jobId!, `\n[System] Failed to stop container: ${result.error || 'Unknown error'}`);
            this.jobOutputService.completeJobFailure(jobId!);
          }
          
          return;
        });
      }
    }

    try {
      // Check if the container is already running
      const existingContainer = await this.findContainer(container.name);
      if (existingContainer) {
        const info = await existingContainer.inspect();
        if (info.State.Running) {
          const message = `Container ${container.name} is already running`;
          this.outputChannel.appendLine(`[WARNING] ${message}`);
          
          if (jobId) {
            this.jobOutputService.appendOutput(jobId, message);
            this.jobOutputService.completeJobSuccess(jobId);
          }
          
          return {
            success: true,
            output: message,
            containerId: info.Id
          };
        } else {
          // Remove stopped container if requested
          if (container.remove_when_stopped) {
            await existingContainer.remove();
            this.outputChannel.appendLine(`Removed stopped container: ${container.name}`);
          } else {
            // Start existing container
            await existingContainer.start();
            const message = `Started existing container: ${container.name}`;
            this.outputChannel.appendLine(message);
            
            if (jobId) {
              this.jobOutputService.appendOutput(jobId, message);
              this.jobOutputService.completeJobSuccess(jobId);
            }
            
            this.runningContainers.set(container.name, existingContainer);
            
            return {
              success: true,
              output: message,
              containerId: info.Id
            };
          }
        }
      }

      // Prepare container create options
      const imageName = `${container.image}${container.tag ? `:${container.tag}` : ''}`;
      
      // Parse volumes
      const volumes: { [key: string]: {} } = {};
      const binds: string[] = [];
      
      if (container.volumes) {
        for (const vol of container.volumes) {
          const source = vol.source.startsWith('/') ? vol.source : `${workspaceRoot}/${vol.source}`;
          
          // Skip volumes that match ignore patterns
          if (this.shouldIgnorePath(source, workspaceRoot)) {
            this.outputChannel.appendLine(`[WARNING] Skipping volume "${vol.source}" as it matches an ignore pattern in .niobiumignore`);
            if (jobId) {
              this.jobOutputService.appendOutput(jobId, `[WARNING] Skipping volume "${vol.source}" as it matches an ignore pattern\n`);
            }
            continue;
          }
          
          const mode = vol.readonly ? 'ro' : 'rw';
          binds.push(`${source}:${vol.target}:${mode}`);
          volumes[vol.target] = {};
        }
      }
      
      // Parse ports
      const exposedPorts: { [key: string]: {} } = {};
      const portBindings: Dockerode.PortMap = {};
      
      if (container.ports) {
        for (const port of container.ports) {
          const containerPort = typeof port.container === 'number' ? `${port.container}/tcp` : port.container;
          exposedPorts[containerPort] = {};
          
          const hostBinding = {
            HostPort: typeof port.host === 'number' ? `${port.host}` : port.host
          };
          
          portBindings[containerPort] = [hostBinding];
        }
      }
      
      // Create container
      const createOptions: Dockerode.ContainerCreateOptions = {
        Image: imageName,
        name: container.name,
        Env: container.environment ? Object.entries(container.environment).map(([key, value]) => `${key}=${value}`) : undefined,
        Cmd: container.command ? this.parseCommand(container.command) : undefined,
        Entrypoint: container.entrypoint ? this.parseCommand(container.entrypoint) : undefined,
        WorkingDir: container.workdir,
        HostConfig: {
          Binds: binds.length > 0 ? binds : undefined,
          PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
          RestartPolicy: container.restart_policy ? {
            Name: container.restart_policy,
            MaximumRetryCount: container.restart_policy === 'on-failure' ? 3 : undefined
          } : undefined,
          NetworkMode: container.network
        },
        ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
        Volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
        Healthcheck: container.healthcheck ? {
          Test: ['CMD-SHELL', container.healthcheck.command],
          Interval: container.healthcheck.interval ? parseInt(container.healthcheck.interval) * 1000000000 : undefined,
          Timeout: container.healthcheck.timeout ? parseInt(container.healthcheck.timeout) * 1000000000 : undefined,
          Retries: container.healthcheck.retries,
          StartPeriod: container.healthcheck.start_period ? parseInt(container.healthcheck.start_period) * 1000000000 : undefined
        } : undefined
      };
      
      // Check if image exists locally, pull if not
      try {
        await this.docker.getImage(imageName).inspect();
        this.outputChannel.appendLine(`Image found locally: ${imageName}`);
      } catch (error) {
        // Image not found, pull it
        this.outputChannel.appendLine(`Pulling image: ${imageName}`);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, `Pulling image: ${imageName}...\n`);
        }
        
        const stream = await this.docker.pull(imageName);
        await new Promise((resolve, reject) => {
          this.docker.modem.followProgress(
            stream,
            (err: any, output: any[]) => err ? reject(err) : resolve(output),
            (event: any) => {
              if (event.progress) {
                const message = `${event.id}: ${event.status} ${event.progress}`;
                this.outputChannel.appendLine(message);
                
                if (jobId) {
                  this.jobOutputService.appendOutput(jobId, `${message}\n`);
                }
              } else if (event.id) {
                const message = `${event.id}: ${event.status}`;
                this.outputChannel.appendLine(message);
                
                if (jobId) {
                  this.jobOutputService.appendOutput(jobId, `${message}\n`);
                }
              } else {
                this.outputChannel.appendLine(event.status);
                
                if (jobId) {
                  this.jobOutputService.appendOutput(jobId, `${event.status}\n`);
                }
              }
            }
          );
        });
        
        this.outputChannel.appendLine(`Image pulled: ${imageName}`);
      }
      
      this.outputChannel.appendLine(`Creating container: ${container.name}`);
      const containerInstance = await this.docker.createContainer(createOptions);
      const containerId = containerInstance.id;
      
      this.outputChannel.appendLine(`Starting container: ${container.name} (${containerId})`);
      await containerInstance.start();
      
      // Store running container reference
      this.runningContainers.set(container.name, containerInstance);
      
      // For one-off commands that exit quickly, wait for the container to complete
      // and capture the output
      if (container.command) {
        // Output a message that we're running the command
        this.outputChannel.appendLine(`\n[COMMAND] ${container.command}`);
        
        // Wait for the container to exit without a timeout
        // We're removing the 30-second timeout to allow containers to run as long as needed
        const containerExitData = await containerInstance.wait();
        
        // Get the logs immediately after the container has exited
        const logStream = await containerInstance.logs({
          follow: false,
          stdout: true,
          stderr: true,
          tail: -1  // Use -1 to get all logs
        });
        
        // Clean the logs before displaying or processing
        const rawLogs = logStream.toString();
        const logs = this.cleanDockerOutput(rawLogs);
        
        // Store the logs for this container
        this.containerLogs.set(container.name, logs);
        
        this.outputChannel.appendLine(`\n[OUTPUT]`);
        this.outputChannel.appendLine(logs);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, logs);
        }
      }
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nContainer started at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Startup time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine(`Status: Running`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showInformationMessage(`Container started: ${container.name}`);
      
      // Mark job as complete in WebView if available
      if (jobId) {
        this.jobOutputService.completeJobSuccess(jobId);
      }
      
      // If container was configured to remove after run and has a command, clean it up
      if (container.remove_when_stopped && container.command) {
        try {
          // Check if container has exited
          const info = await containerInstance.inspect();
          if (info.State.Status === 'exited' || info.State.Status === 'created') {
            this.outputChannel.appendLine(`\nRemoving container after completion: ${container.name}`);
            await containerInstance.remove();
            this.runningContainers.delete(container.name);
          }
        } catch (cleanupError) {
          this.outputChannel.appendLine(`\n[WARNING] Failed to cleanup container: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        }
      }
      
      return {
        success: true,
        output: this.containerLogs.get(container.name) || `Container ${container.name} started with ID: ${containerId}`,
        containerId
      };
    } catch (error) {
      // Handle execution error
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`\n[ERROR] ${errorMessage}`);
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nFailed at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showErrorMessage(`Failed to start container: ${container.name}`);
      
      // Mark job as failed in WebView if available
      if (jobId) {
        this.jobOutputService.appendError(jobId, errorMessage);
        this.jobOutputService.completeJobFailure(jobId);
      }
      
      return {
        success: false,
        output: '',
        error: errorMessage
      };
    }
  }

  /**
   * Stop a running Docker container
   */
  async stopContainer(containerName: string): Promise<DockerExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n[Container] Stopping: ${containerName}`);
    
    // Record start time
    const startTime = new Date();
    
    // Create job in web view if JobOutputService is available
    let jobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      
      jobId = this.jobOutputService.startCommand({
        name: `Stop ${containerName}`,
        description: `Stop Docker container: ${containerName}`,
        command: `docker stop ${containerName}`
      });
    }

    try {
      // Find container by name
      const container = await this.findContainer(containerName);
      
      if (!container) {
        const message = `Container not found: ${containerName}`;
        this.outputChannel.appendLine(`[WARNING] ${message}`);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, message);
          this.jobOutputService.completeJobSuccess(jobId);
        }
        
        return {
          success: false,
          output: '',
          error: message
        };
      }
      
      // Check if the container is running
      const info = await container.inspect();
      if (!info.State.Running) {
        const message = `Container ${containerName} is not running`;
        this.outputChannel.appendLine(`[WARNING] ${message}`);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, message);
          this.jobOutputService.completeJobSuccess(jobId);
        }
        
        // Remove container reference
        this.runningContainers.delete(containerName);
        
        return {
          success: true,
          output: message,
          containerId: info.Id
        };
      }
      
      // Stop the container
      this.outputChannel.appendLine(`Stopping container: ${containerName} (${info.Id})`);
      await container.stop();
      
      // Remove container reference
      this.runningContainers.delete(containerName);
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nContainer stopped at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showInformationMessage(`Container stopped: ${containerName}`);
      
      // Mark job as complete in WebView if available
      if (jobId) {
        this.jobOutputService.appendOutput(jobId, `Container ${containerName} stopped successfully`);
        this.jobOutputService.completeJobSuccess(jobId);
      }
      
      return {
        success: true,
        output: `Container ${containerName} stopped successfully`,
        containerId: info.Id
      };
    } catch (error) {
      // Handle execution error
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`\n[ERROR] ${errorMessage}`);
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nFailed at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showErrorMessage(`Failed to stop container: ${containerName}`);
      
      // Mark job as failed in WebView if available
      if (jobId) {
        this.jobOutputService.appendError(jobId, errorMessage);
        this.jobOutputService.completeJobFailure(jobId);
      }
      
      return {
        success: false,
        output: '',
        error: errorMessage
      };
    }
  }

  /**
   * Remove a Docker container
   */
  async removeContainer(containerName: string): Promise<DockerExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n[Container] Removing: ${containerName}`);
    
    // Record start time
    const startTime = new Date();
    
    // Create job in web view if JobOutputService is available
    let jobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      
      jobId = this.jobOutputService.startCommand({
        name: `Remove ${containerName}`,
        description: `Remove Docker container: ${containerName}`,
        command: `docker rm ${containerName}`
      });
    }

    try {
      // Find container by name
      const container = await this.findContainer(containerName);
      
      if (!container) {
        const message = `Container not found: ${containerName}`;
        this.outputChannel.appendLine(`[WARNING] ${message}`);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, message);
          this.jobOutputService.completeJobSuccess(jobId);
        }
        
        return {
          success: false,
          output: '',
          error: message
        };
      }
      
      // Check if the container is running
      const info = await container.inspect();
      if (info.State.Running) {
        this.outputChannel.appendLine(`Container ${containerName} is running. Stopping it first...`);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, `Container ${containerName} is running. Stopping it first...\n`);
        }
        
        await container.stop();
      }
      
      // Remove the container
      this.outputChannel.appendLine(`Removing container: ${containerName} (${info.Id})`);
      await container.remove();
      
      // Remove container reference
      this.runningContainers.delete(containerName);
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nContainer removed at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showInformationMessage(`Container removed: ${containerName}`);
      
      // Mark job as complete in WebView if available
      if (jobId) {
        this.jobOutputService.appendOutput(jobId, `Container ${containerName} removed successfully`);
        this.jobOutputService.completeJobSuccess(jobId);
      }
      
      return {
        success: true,
        output: `Container ${containerName} removed successfully`,
        containerId: info.Id
      };
    } catch (error) {
      // Handle execution error
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`\n[ERROR] ${errorMessage}`);
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nFailed at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showErrorMessage(`Failed to remove container: ${containerName}`);
      
      // Mark job as failed in WebView if available
      if (jobId) {
        this.jobOutputService.appendError(jobId, errorMessage);
        this.jobOutputService.completeJobFailure(jobId);
      }
      
      return {
        success: false,
        output: '',
        error: errorMessage
      };
    }
  }

  /**
   * Show logs from a Docker container
   */
  async showContainerLogs(containerName: string): Promise<DockerExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n[Container] Viewing logs: ${containerName}`);
    
    // Create job in web view if JobOutputService is available
    let jobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      
      jobId = this.jobOutputService.startCommand({
        name: `Logs ${containerName}`,
        description: `View Docker container logs: ${containerName}`,
        command: `docker logs ${containerName}`
      });
    }

    try {
      // Find container by name
      const container = await this.findContainer(containerName);
      
      if (!container) {
        const message = `Container not found: ${containerName}`;
        this.outputChannel.appendLine(`[WARNING] ${message}`);
        
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, message);
          this.jobOutputService.completeJobSuccess(jobId);
        }
        
        return {
          success: false,
          output: '',
          error: message
        };
      }
      
      // Get the logs from the container
      const logStream = await container.logs({
        follow: false,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: 1000
      });
      
      const logs = logStream.toString();
      this.outputChannel.appendLine(`\n[LOGS] ${containerName}:`);
      this.outputChannel.appendLine(logs);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      // Display logs in WebView if available
      if (jobId) {
        this.jobOutputService.appendOutput(jobId, logs);
        this.jobOutputService.completeJobSuccess(jobId);
      }
      
      // Get container info
      const info = await container.inspect();
      
      return {
        success: true,
        output: logs,
        containerId: info.Id
      };
    } catch (error) {
      // Handle execution error
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`\n[ERROR] ${errorMessage}`);
      
      vscode.window.showErrorMessage(`Failed to get logs for container: ${containerName}`);
      
      // Mark job as failed in WebView if available
      if (jobId) {
        this.jobOutputService.appendError(jobId, errorMessage);
        this.jobOutputService.completeJobFailure(jobId);
      }
      
      return {
        success: false,
        output: '',
        error: errorMessage
      };
    }
  }

  /**
   * Show output channel
   */
  showOutput(): void {
    this.outputChannel.show(true);
    
    // Also show the WebView panel if it exists
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
    }
  }

  /**
   * Helper method to find a container by name
   */
  public async findContainer(name: string): Promise<Dockerode.Container | undefined> {
    // Sanitize the name for consistency with how containers are created
    const sanitizedName = sanitizeContainerName(name);
    
    // First check our cache of running containers
    if (this.runningContainers.has(name)) {
      return this.runningContainers.get(name);
    }
    
    if (sanitizedName !== name && this.runningContainers.has(sanitizedName)) {
      return this.runningContainers.get(sanitizedName);
    }
    
    // Otherwise, search Docker for the container
    const containers = await this.docker.listContainers({ all: true });
    
    for (const containerInfo of containers) {
      // Check if this container has the name we're looking for
      const containerNames = containerInfo.Names || [];
      const hasMatchingName = containerNames.some(containerName => 
        containerName === `/${name}` || 
        containerName === name || 
        containerName === `/${sanitizedName}` || 
        containerName === sanitizedName
      );
      
      if (hasMatchingName) {
        const container = this.docker.getContainer(containerInfo.Id);
        return container;
      }
    }
    
    return undefined;
  }

  /**
   * Parse a command string properly handling quotes
   * This properly handles commands with quoted arguments
   */
  private parseCommand(commandStr: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    
    for (let i = 0; i < commandStr.length; i++) {
      const char = commandStr[i];
      
      if ((char === '"' || char === "'") && (i === 0 || commandStr[i-1] !== '\\')) {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else if (char === ' ' && !inQuote) {
        if (current) {
          result.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      result.push(current);
    }
    
    return result;
  }
} 