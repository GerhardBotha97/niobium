import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { CommandConfig, StageConfig, ConfigProvider, NiobiumConfig, DockerContainerConfig, VariableManager } from './configProvider';
import { promisify } from 'util';
import { JobOutputService } from './ui/jobOutputService';
import { DockerRunner } from './dockerRunner';
import { IgnoreProvider } from './utils/ignoreUtils';
import { sanitizeContainerName } from './utils/dockerUtils';
import * as net from 'net';
import * as os from 'os';

const execAsync = promisify(cp.exec);

// Interface to track command execution results
interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

export class CommandRunner {
  private terminal: vscode.Terminal | undefined;
  private configProvider: ConfigProvider;
  private outputChannel: vscode.OutputChannel;
  private jobOutputService: JobOutputService;
  private dockerRunner: DockerRunner;
  private ignoreProvider: IgnoreProvider;
  private variableManager: VariableManager;

  constructor(context?: vscode.ExtensionContext) {
    this.configProvider = new ConfigProvider();
    this.outputChannel = vscode.window.createOutputChannel('Blue Wasp Runner');
    this.jobOutputService = context ? JobOutputService.getInstance(context) : null as any;
    this.dockerRunner = new DockerRunner(context);
    this.ignoreProvider = IgnoreProvider.getInstance();
    this.variableManager = VariableManager.getInstance();
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
   * Process a command string by replacing variables with their values
   * @param commandStr The command string with variables to replace
   * @returns The command string with variables replaced
   */
  private processVariables(commandStr: string): string {
    // Get all variables
    const variables = this.variableManager.getAllVariables();
    
    // Replace all ${VAR_NAME} and $VAR_NAME patterns
    let processedCommand = commandStr;
    
    // First, replace ${VAR_NAME} pattern (safer as it has boundaries)
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
      processedCommand = processedCommand.replace(pattern, value);
    }
    
    // Then replace $VAR_NAME pattern (more prone to false positives)
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\$${key}\\b`, 'g');
      processedCommand = processedCommand.replace(pattern, value);
    }
    
    return processedCommand;
  }

  /**
   * Extract output variables from command output using the outputs configuration
   * @param command The command configuration with outputs defined
   * @param stdout The stdout from the command execution
   */
  private extractOutputVariables(command: CommandConfig, stdout: string): void {
    if (!command.outputs) {
      return;
    }
    
    this.outputChannel.appendLine(`\n[Variables] Extracting output variables for command: ${command.name}`);
    
    for (const [outputName, _] of Object.entries(command.outputs)) {
      // Look for ::set-output name=OUTPUT_NAME::VALUE pattern
      const setOutputRegex = new RegExp(`::set-output name=${outputName}::(.*)`, 'i');
      const match = stdout.match(setOutputRegex);
      
      if (match && match[1]) {
        const value = match[1].trim();
        this.variableManager.setVariable(outputName, value);
        this.outputChannel.appendLine(`[Variables] Extracted ${outputName}=${value}`);
        
        // Also log to job output if available
        if (this.jobOutputService) {
          this.jobOutputService.appendOutput(command.name, `\n[Variables] Set ${outputName}=${value}`);
        }
      }
    }
  }

  /**
   * Check if a command has dependencies and if they have been run
   * @param command The command to check dependencies for
   * @param executedCommands List of already executed command names
   * @returns True if dependencies are satisfied, false otherwise
   */
  private areDependenciesSatisfied(command: CommandConfig, executedCommands: string[]): boolean {
    if (!command.depends_on) {
      return true;
    }
    
    const dependencies = Array.isArray(command.depends_on) ? command.depends_on : [command.depends_on];
    
    for (const dependency of dependencies) {
      if (!executedCommands.includes(dependency)) {
        this.outputChannel.appendLine(`\n[ERROR] Dependency "${dependency}" for command "${command.name}" has not been executed`);
        return false;
      }
    }
    
    return true;
  }

  async runCommand(command: CommandConfig, workspaceRoot: string): Promise<ExecutionResult> {
    // If the command has an image property, run it as a Docker container
    if (command.image) {
      return this.runDockerCommand(command, workspaceRoot);
    }

    // Otherwise, run it as a regular command
    // Show output channel
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n[Command] Running: ${command.name}`);
    if (command.description) {
      this.outputChannel.appendLine(`Description: ${command.description}`);
    }
    
    // Process variables in the command string
    const processedCommand = this.processVariables(command.command);
    this.outputChannel.appendLine(`Command: ${processedCommand}`);
    
    if (command.cwd) {
      this.outputChannel.appendLine(`Working directory: ${command.cwd}`);
    }
    
    if (command.env && Object.keys(command.env).length > 0) {
      this.outputChannel.appendLine('Environment variables:');
      for (const [key, value] of Object.entries(command.env)) {
        const processedValue = this.processVariables(value);
        this.outputChannel.appendLine(`  ${key}=${processedValue}`);
        // Update the env object with processed values for actual execution
        command.env[key] = processedValue;
      }
    }

    if (command.allow_failure) {
      this.outputChannel.appendLine(`Note: This command is allowed to fail (allow_failure: true)`);
    }
    
    // Record start time
    const startTime = new Date();
    this.outputChannel.appendLine(`Starting at: ${startTime.toLocaleTimeString()}`);
    
    // Create job in web view if JobOutputService is available
    let jobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      jobId = this.jobOutputService.startCommand(command);
    }

    // Execute the command with output
    try {
      // Determine the working directory
      const cwd = command.cwd
        ? path.resolve(workspaceRoot, command.cwd)
        : workspaceRoot;
      
      // Check if the working directory is in an ignored path
      if (this.shouldIgnorePath(cwd, workspaceRoot)) {
        const errorMsg = `Working directory "${command.cwd}" is in an ignored path according to .niobiumignore`;
        this.outputChannel.appendLine(`\n[ERROR] ${errorMsg}`);
        if (jobId) {
          this.jobOutputService.appendError(jobId, errorMsg);
          this.jobOutputService.completeJobFailure(jobId, 1);
        }
        return {
          success: false,
          output: '',
          error: errorMsg,
          exitCode: 1
        };
      }
      
      // Set environment variables
      const env = { ...process.env };
      if (command.env) {
        Object.assign(env, command.env);
      }

      // Execute the command and capture output
      const execOptions: cp.ExecOptions = {
        cwd,
        env
      };
      
      // Default shell command
      let shellExecutable = '/bin/bash';
      if (process.platform === 'win32') {
        shellExecutable = 'cmd.exe';
      } else if (process.platform === 'darwin') {
        // On macOS Catalina and later, zsh is the default shell
        shellExecutable = '/bin/zsh';
      }
      
      // Set shell based on command.shell if provided
      if (command.shell !== undefined) {
        if (typeof command.shell === 'string') {
          execOptions.shell = command.shell;
        } else if (command.shell === false) {
          // Direct execution without shell
          execOptions.shell = undefined;
        } else {
          execOptions.shell = shellExecutable;
        }
      } else {
        // Default to using shell
        execOptions.shell = shellExecutable;
      }
      
      // Set up for cancelable command execution
      let childProcess: cp.ChildProcess | null = null;
      let canceled = false;
      let detectedPorts: number[] = [];
      let childPids: number[] = [];
      
      // Try to detect which ports this command will use
      const detectedServerPorts = this.detectPossiblePorts(processedCommand);
      if (detectedServerPorts.length > 0) {
        this.outputChannel.appendLine(`\n[INFO] Detected possible ports: ${detectedServerPorts.join(', ')}`);
      }
      
      // Register kill handler if JobOutputService is available
      if (jobId && this.jobOutputService) {
        this.jobOutputService.registerKillHandler(jobId, async () => {
          if (childProcess && childProcess.pid) {
            this.outputChannel.appendLine(`\n[INFO] Kill request received for command: ${command.name}`);
            canceled = true;
            
            try {
              await this.killProcessAndChildren(childProcess, command, detectedPorts, childPids);
              
              this.jobOutputService.appendOutput(jobId!, '\n[System] Command terminated by user');
              this.jobOutputService.completeJobFailure(jobId!, 130); // 130 is the exit code for SIGTERM
            } catch (killError) {
              const errorMessage = killError instanceof Error ? killError.message : String(killError);
              this.outputChannel.appendLine(`\n[ERROR] Failed to kill process: ${errorMessage}`);
              this.jobOutputService.appendError(jobId!, `\n[System] Failed to terminate command: ${errorMessage}`);
              this.jobOutputService.completeJobFailure(jobId!, 1);
            }
          }
        });
      }
      
      // Custom promise-based exec with cancellation support
      const execResult = await new Promise<{stdout: string, stderr: string, code: number}>((resolve, reject) => {
        // If on Unix systems, spawn with options for process group management
        const execOptionsWithDetached = process.platform !== 'win32' 
          ? { ...execOptions, windowsHide: true } 
          : execOptions;
        
        childProcess = cp.exec(processedCommand, execOptionsWithDetached);
        
        // Update the job with PID information
        if (childProcess && childProcess.pid && jobId) {
          this.outputChannel.appendLine(`\n[INFO] Process started with PID: ${childProcess.pid}`);
          this.jobOutputService.updateJob(jobId, {
            pid: childProcess.pid,
            ports: detectedServerPorts
          });
        }
        
        // Set up periodic checks to detect child processes and port usage
        const portCheckInterval = setInterval(async () => {
          if (!childProcess || !childProcess.pid) {
            clearInterval(portCheckInterval);
            return;
          }
          
          try {
            // Check for processes that are children of our main process
            const newChildPids = await this.findChildProcesses(childProcess.pid);
            if (newChildPids.length > 0) {
              const newPids = newChildPids.filter(pid => !childPids.includes(pid));
              if (newPids.length > 0) {
                childPids = [...childPids, ...newPids];
                this.outputChannel.appendLine(`\n[INFO] Detected child processes: ${newPids.join(', ')}`);
                
                if (jobId) {
                  this.jobOutputService.updateJob(jobId, { childPids });
                }
              }
            }
            
            // Check for ports that have been opened by our process tree
            if (detectedServerPorts.length > 0) {
              const allPids = [childProcess.pid, ...childPids];
              const activePortsInfo = await this.checkPortsInUse(detectedServerPorts, allPids);
              
              if (activePortsInfo.length > 0) {
                const currentPorts = activePortsInfo.map(p => p.port);
                const newPorts = currentPorts.filter(port => !detectedPorts.includes(port));
                
                if (newPorts.length > 0) {
                  detectedPorts = [...detectedPorts, ...newPorts];
                  this.outputChannel.appendLine(`\n[INFO] Detected active ports: ${newPorts.join(', ')}`);
                  
                  if (jobId) {
                    this.jobOutputService.updateJob(jobId, { ports: detectedPorts });
                  }
                }
              }
            }
          } catch (error) {
            // Ignore errors in the background checks
          }
        }, 2000);
        
        let stdout = '';
        let stderr = '';
        
        childProcess.stdout?.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          
          // Scan output for port information
          const portMatches = text.match(/(?:listening on|running on|localhost:|server running|started on|listening at|bound to|port\s*:)(?:.*?)(\d{2,5})/gi);
          if (portMatches) {
            portMatches.forEach((match: string) => {
              const portMatch = match.match(/(\d{2,5})/);
              if (portMatch && portMatch[1]) {
                const port = parseInt(portMatch[1], 10);
                if (port > 0 && port < 65536 && !detectedPorts.includes(port)) {
                  detectedPorts.push(port);
                  this.outputChannel.appendLine(`\n[INFO] Detected port from output: ${port}`);
                  
                  if (jobId) {
                    this.jobOutputService.updateJob(jobId, { ports: detectedPorts });
                  }
                }
              }
            });
          }
          
          // Show real-time output
          this.outputChannel.append(text);
          
          // Add output to WebView if available
          if (jobId) {
            this.jobOutputService.appendOutput(jobId, text);
          }
        });
        
        childProcess.stderr?.on('data', (data) => {
          const text = data.toString();
          stderr += text;
          
          // Show real-time output
          this.outputChannel.append(text);
          
          // Add error to WebView if available
          if (jobId) {
            this.jobOutputService.appendError(jobId, text);
          }
        });
        
        childProcess.on('close', (code) => {
          clearInterval(portCheckInterval);
          
          if (canceled) {
            // If the command was canceled, we've already handled this case
            return;
          }
          
          if (code === 0) {
            resolve({ stdout, stderr, code });
          } else {
            const error: any = new Error(`Command failed with exit code ${code}`);
            error.code = code;
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
          }
        });
        
        childProcess.on('error', (error) => {
          clearInterval(portCheckInterval);
          reject(error);
        });
      });
      
      // Extract output variables if specified in the command
      this.extractOutputVariables(command, execResult.stdout);
      
      // Write output to the output channel
      // No need to append stdout/stderr again as we've already done it in real-time
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nCompleted at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine(`Exit status: Success`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      vscode.window.showInformationMessage(`Command completed successfully: ${command.name}`);
      
      // Mark job as complete in WebView if available
      if (jobId) {
        this.jobOutputService.completeJobSuccess(jobId);
      }
      
      // Return successful result
      return {
        success: true,
        output: execResult.stdout,
        exitCode: 0
      };
    } catch (error) {
      // Handle command execution error
      const exitCode = (error as any).code || 1;
      const stderr = (error as any).stderr || String(error);
      const stdout = (error as any).stdout || '';
      
      // Write output to the output channel
      if (stdout) {
        this.outputChannel.appendLine('\n[OUTPUT]');
        this.outputChannel.appendLine(stdout);
        
        // Add output to WebView if available
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, stdout);
        }
      }
      
      this.outputChannel.appendLine('\n[ERROR]');
      this.outputChannel.appendLine(stderr);
      
      // Add error to WebView if available
      if (jobId) {
        this.jobOutputService.appendError(jobId, stderr);
      }
      
      // Record end time
      const endTime = new Date();
      const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(`\nFailed at: ${endTime.toLocaleTimeString()}`);
      this.outputChannel.appendLine(`Execution time: ${executionTime.toFixed(2)}s`);
      this.outputChannel.appendLine(`Exit code: ${exitCode}`);
      this.outputChannel.appendLine('─'.repeat(80)); // Separator line
      
      // Different message based on if the failure is allowed
      if (command.allow_failure) {
        this.outputChannel.appendLine(`Command failed but continuing (allow_failure: true)`);
        vscode.window.showWarningMessage(`Command failed but continuing: ${command.name}`);
        
        // Mark job as failed in WebView but indicate it's allowed to fail
        if (jobId) {
          this.jobOutputService.completeJobFailure(jobId, exitCode);
        }
      } else {
        vscode.window.showErrorMessage(`Command failed: ${command.name}`);
        
        // Mark job as failed in WebView
        if (jobId) {
          this.jobOutputService.completeJobFailure(jobId, exitCode);
        }
      }
      
      // Return failed result
      return {
        success: false,
        output: stdout,
        error: stderr,
        exitCode
      };
    }
  }

  async runStage(config: NiobiumConfig, stageName: string, workspaceRoot: string): Promise<ExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    
    const stage = this.configProvider.findStage(config, stageName);
    if (!stage) {
      const errorMsg = `Stage "${stageName}" not found`;
      this.outputChannel.appendLine(`\n[ERROR] ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return { success: false, output: '', error: errorMsg };
    }

    this.outputChannel.appendLine(`\n${'='.repeat(80)}`);
    this.outputChannel.appendLine(`[Stage] Running: ${stage.name}`);
    if (stage.description) {
      this.outputChannel.appendLine(`Description: ${stage.description}`);
    }
    if (stage.allow_failure) {
      this.outputChannel.appendLine(`Note: This stage is allowed to fail (allow_failure: true)`);
    }
    this.outputChannel.appendLine(`${'='.repeat(80)}`);
    
    vscode.window.showInformationMessage(`Running stage: ${stage.name}`);
    
    // Create stage job in WebView if JobOutputService is available
    let stageJobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      stageJobId = this.jobOutputService.startStage(stage);
    }
    
    const commands = this.configProvider.getStageCommands(config, stageName);
    if (commands.length === 0) {
      const warningMsg = `No valid commands found in stage "${stageName}"`;
      this.outputChannel.appendLine(`[WARNING] ${warningMsg}`);
      vscode.window.showWarningMessage(warningMsg);
      
      if (stageJobId) {
        this.jobOutputService.appendOutput(stageJobId, `Warning: ${warningMsg}`);
        this.jobOutputService.completeJobFailure(stageJobId);
      }
      
      return { success: false, output: '', error: warningMsg };
    }

    // Record start time
    const stageStartTime = new Date();
    this.outputChannel.appendLine(`Stage started at: ${stageStartTime.toLocaleTimeString()}`);
    this.outputChannel.appendLine(`Total commands to execute: ${commands.length}`);
    
    // Execute each command in sequence
    let commandIndex = 0;
    let stageSuccess = true;
    let combinedOutput = '';
    let executedCommands: string[] = [];
    
    for (const command of commands) {
      commandIndex++;
      this.outputChannel.appendLine(`\n[${commandIndex}/${commands.length}] Executing command: ${command.name}`);
      
      // Check if command dependencies are satisfied
      if (!this.areDependenciesSatisfied(command, executedCommands)) {
        const error = `Cannot run command "${command.name}" because its dependencies have not been executed`;
        this.outputChannel.appendLine(`\n[ERROR] ${error}`);
        
        if (!command.allow_failure) {
          return { 
            success: false, 
            output: combinedOutput, 
            error: error, 
            exitCode: 1
          };
        }
        
        continue;
      }
      
      const result = await this.runCommand(command, workspaceRoot);
      combinedOutput += result.output + '\n';
      
      // Track executed commands for dependency checking
      executedCommands.push(command.name);
      
      // If this command had a WebView job, add it as child of the stage
      if (stageJobId && this.jobOutputService) {
        // Get the command's job ID from active jobs
        const commandJob = [...this.jobOutputService['activeJobs'].values()]
          .find(job => job.type === 'command' && job.name === command.name);
        
        if (commandJob) {
          this.jobOutputService.addChildJob(stageJobId, commandJob.id);
        }
      }
      
      // If the command failed and doesn't allow failure, stop the stage
      if (!result.success && !command.allow_failure) {
        stageSuccess = false;
        this.outputChannel.appendLine(`Command failed. Stopping stage execution since allow_failure is not set.`);
        break;
      }
      
      // Add a small delay between commands
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Record end time
    const stageEndTime = new Date();
    const stageExecutionTime = (stageEndTime.getTime() - stageStartTime.getTime()) / 1000;
    this.outputChannel.appendLine(`\nStage ${stageSuccess ? 'completed' : 'failed'} at: ${stageEndTime.toLocaleTimeString()}`);
    this.outputChannel.appendLine(`Total stage execution time: ${stageExecutionTime.toFixed(2)}s`);
    this.outputChannel.appendLine(`Exit status: ${stageSuccess ? 'Success' : 'Failure'}`);
    this.outputChannel.appendLine(`${'='.repeat(80)}`);

    // Determine if the stage allows failure
    const stageFailed = !stageSuccess;
    
    if (stageFailed) {
      if (stage.allow_failure) {
        this.outputChannel.appendLine(`Stage failed but continuing (allow_failure: true)`);
        vscode.window.showWarningMessage(`Stage failed but continuing: ${stage.name}`);
        
        // Mark stage as failed in WebView but indicate it's allowed to fail
        if (stageJobId) {
          this.jobOutputService.completeJobFailure(stageJobId);
        }
        
        return { success: true, output: combinedOutput };
      } else {
        vscode.window.showErrorMessage(`Stage failed: ${stage.name}`);
        
        // Mark stage as failed in WebView
        if (stageJobId) {
          this.jobOutputService.completeJobFailure(stageJobId);
        }
        
        return { success: false, output: combinedOutput, error: 'Stage execution failed' };
      }
    } else {
      vscode.window.showInformationMessage(`Stage completed successfully: ${stage.name}`);
      
      // Mark stage as successful in WebView
      if (stageJobId) {
        this.jobOutputService.completeJobSuccess(stageJobId);
      }
      
      return { success: true, output: combinedOutput };
    }
  }

  async runSequence(config: NiobiumConfig, sequenceName: string, workspaceRoot: string): Promise<ExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    
    const sequence = this.configProvider.findSequence(config, sequenceName);
    if (!sequence) {
      const errorMsg = `Sequence "${sequenceName}" not found`;
      this.outputChannel.appendLine(`\n[ERROR] ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return { success: false, output: '', error: errorMsg };
    }

    this.outputChannel.appendLine(`\n${'#'.repeat(80)}`);
    this.outputChannel.appendLine(`[Sequence] Running: ${sequence.name}`);
    if (sequence.description) {
      this.outputChannel.appendLine(`Description: ${sequence.description}`);
    }
    this.outputChannel.appendLine(`${'#'.repeat(80)}`);
    
    vscode.window.showInformationMessage(`Running sequence: ${sequence.name}`);
    
    // Create sequence job in WebView if JobOutputService is available
    let sequenceJobId: string | undefined;
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
      sequenceJobId = this.jobOutputService.startSequence(sequence.name, sequence.description);
    }
    
    const stages = this.configProvider.getSequenceStages(config, sequenceName);
    if (stages.length === 0) {
      const warningMsg = `No valid stages found in sequence "${sequenceName}"`;
      this.outputChannel.appendLine(`[WARNING] ${warningMsg}`);
      vscode.window.showWarningMessage(warningMsg);
      
      if (sequenceJobId) {
        this.jobOutputService.appendOutput(sequenceJobId, `Warning: ${warningMsg}`);
        this.jobOutputService.completeJobFailure(sequenceJobId);
      }
      
      return { success: false, output: '', error: warningMsg };
    }

    // Record start time
    const sequenceStartTime = new Date();
    this.outputChannel.appendLine(`Sequence started at: ${sequenceStartTime.toLocaleTimeString()}`);
    this.outputChannel.appendLine(`Total stages to execute: ${stages.length}`);
    
    // Execute each stage in sequence
    let stageIndex = 0;
    let sequenceSuccess = true;
    let combinedOutput = '';
    
    for (const stage of stages) {
      stageIndex++;
      this.outputChannel.appendLine(`\n[${stageIndex}/${stages.length}] Executing stage: ${stage.name}`);
      
      const result = await this.runStage(config, stage.name, workspaceRoot);
      combinedOutput += result.output + '\n';
      
      // If this stage had a WebView job, add it as child of the sequence
      if (sequenceJobId && this.jobOutputService) {
        // Get the stage's job ID from active jobs
        const stageJob = [...this.jobOutputService['activeJobs'].values()]
          .find(job => job.type === 'stage' && job.name === stage.name);
        
        if (stageJob) {
          this.jobOutputService.addChildJob(sequenceJobId, stageJob.id);
        }
      }
      
      // If the stage failed and doesn't have allow_failure, stop the sequence
      if (!result.success) {
        sequenceSuccess = false;
        this.outputChannel.appendLine(`Stage failed. Stopping sequence execution.`);
        break;
      }
      
      // Add a small delay between stages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Record end time
    const sequenceEndTime = new Date();
    const sequenceExecutionTime = (sequenceEndTime.getTime() - sequenceStartTime.getTime()) / 1000;
    this.outputChannel.appendLine(`\nSequence ${sequenceSuccess ? 'completed' : 'failed'} at: ${sequenceEndTime.toLocaleTimeString()}`);
    this.outputChannel.appendLine(`Total sequence execution time: ${sequenceExecutionTime.toFixed(2)}s`);
    this.outputChannel.appendLine(`Exit status: ${sequenceSuccess ? 'Success' : 'Failure'}`);
    this.outputChannel.appendLine(`${'#'.repeat(80)}`);

    if (sequenceSuccess) {
      vscode.window.showInformationMessage(`Sequence completed successfully: ${sequence.name}`);
      
      // Mark sequence as successful in WebView
      if (sequenceJobId) {
        this.jobOutputService.completeJobSuccess(sequenceJobId);
      }
      
      return { success: true, output: combinedOutput };
    } else {
      vscode.window.showErrorMessage(`Sequence failed: ${sequence.name}`);
      
      // Mark sequence as failed in WebView
      if (sequenceJobId) {
        this.jobOutputService.completeJobFailure(sequenceJobId);
      }
      
      return { success: false, output: combinedOutput, error: 'Sequence execution failed' };
    }
  }

  // Method to explicitly show the output channel
  showOutput(): void {
    this.outputChannel.show(true);
    
    // Also show the WebView panel if it exists
    if (this.jobOutputService) {
      this.jobOutputService.showPanel();
    }
  }

  /**
   * Run a command as a Docker container
   */
  private async runDockerCommand(command: CommandConfig, workspaceRoot: string): Promise<ExecutionResult> {
    // Show output channel
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n[Docker Command] Running: ${command.name}`);
    if (command.description) {
      this.outputChannel.appendLine(`Description: ${command.description}`);
    }
    this.outputChannel.appendLine(`Image: ${command.image}${command.image_tag ? `:${command.image_tag}` : ''}`);
    
    // Create a Docker container config from the command
    const containerConfig: DockerContainerConfig = {
      name: command.container_name || `niobium-${sanitizeContainerName(command.name)}-${Date.now()}`,
      description: command.description,
      image: command.image!, // Using non-null assertion as we've validated this exists
      tag: command.image_tag,
      command: command.command,
      ports: command.ports,
      volumes: command.volumes,
      workdir: command.workdir,
      network: command.network,
      entrypoint: command.entrypoint,
      environment: command.env,
      remove_when_stopped: command.remove_after_run
    };
    
    try {
      // Start the container
      const result = await this.dockerRunner.startContainer(containerConfig, workspaceRoot);
      
      // If configured to remove after run and it was successful, remove the container
      if (command.remove_after_run && result.success && result.containerId) {
        await this.dockerRunner.removeContainer(containerConfig.name);
      }
      
      return {
        success: result.success,
        output: result.output,
        error: result.error,
        exitCode: result.statusCode || 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (command.allow_failure) {
        this.outputChannel.appendLine(`Command failed but continuing (allow_failure: true)`);
        vscode.window.showWarningMessage(`Docker command failed but continuing: ${command.name}`);
        
        return {
          success: true, // Mark as successful since failure is allowed
          output: '',
          error: errorMessage,
          exitCode: 0
        };
      } else {
        vscode.window.showErrorMessage(`Docker command failed: ${command.name}`);
        
        return {
          success: false,
          output: '',
          error: errorMessage,
          exitCode: 1
        };
      }
    }
  }

  /**
   * Kill a process, its children, and processes using the same ports
   */
  private async killProcessAndChildren(
    childProcess: cp.ChildProcess, 
    command: CommandConfig, 
    detectedPorts: number[] = [], 
    childPids: number[] = []
  ): Promise<void> {
    if (!childProcess.pid) return;
    
    this.outputChannel.appendLine(`\n[INFO] Attempting to kill process ${childProcess.pid} and its children`);
    
    // Build up a full list of target PIDs
    const allPids = new Set<number>([childProcess.pid, ...childPids]);
    
    // Find any additional child processes we might have missed
    try {
      const additionalPids = await this.findChildProcesses(childProcess.pid);
      additionalPids.forEach(pid => allPids.add(pid));
    } catch (e) {
      // Ignore errors finding child processes
    }
    
    this.outputChannel.appendLine(`\n[INFO] Target PIDs: ${[...allPids].join(', ')}`);
    
    // Ensure we check the most common Node.js server ports for Vite and Express/Node
    const criticalPorts = new Set([...detectedPorts]);
    if (command.command.includes('npm run dev') || command.command.includes('vite')) {
      criticalPorts.add(5173); // Vite default
    }
    if (command.command.includes('npm run start') || command.command.includes('node server')) {
      criticalPorts.add(5000); // Default in the shown output
      criticalPorts.add(3000); // Common Express/React port
    }
    
    // Check if any specific ports are being used and find those processes
    if (criticalPorts.size > 0) {
      try {
        const portsArray = [...criticalPorts];
        this.outputChannel.appendLine(`\n[INFO] Checking port usage for ports: ${portsArray.join(', ')}`);
        const portInfo = await this.checkPortsInUse(portsArray);
        
        for (const info of portInfo) {
          this.outputChannel.appendLine(`\n[INFO] Port ${info.port} used by PID: ${info.pid}`);
          if (info.pid && !allPids.has(info.pid)) {
            allPids.add(info.pid);
            
            try {
              // Also get any child processes of this port-using process
              const morePids = await this.findChildProcesses(info.pid);
              morePids.forEach(pid => allPids.add(pid));
            } catch (e) {
              // Ignore errors finding child processes
            }
          }
        }
      } catch (e) {
        this.outputChannel.appendLine(`\n[WARNING] Error checking port usage: ${e}`);
      }
    }
    
    // Now we have a list of all processes to kill, including:
    // 1. The main process
    // 2. All its children
    // 3. Any process using the detected ports
    // 4. Children of those port-using processes
    
    if (process.platform === 'win32') {
      // Windows process killing
      for (const pid of allPids) {
        try {
          await new Promise<void>(resolve => {
            cp.exec(`taskkill /pid ${pid} /T /F`, (error) => {
              if (error) {
                this.outputChannel.appendLine(`\n[WARNING] Error killing PID ${pid}: ${error.message}`);
              } else {
                this.outputChannel.appendLine(`\n[INFO] Successfully killed PID ${pid}`);
              }
              resolve();
            });
          });
        } catch (e) {
          // Ignore individual kill errors
        }
      }
      
      // Additional process killing for Node.js-based commands
      if (command.command.includes('npm') || command.command.includes('node')) {
        const scriptName = command.command.match(/(?:npm run\s+|node\s+)(\w+)/)?.[1];
        
        if (scriptName) {
          this.outputChannel.appendLine(`\n[INFO] Additional cleanup for Node.js script: ${scriptName}`);
          try {
            await new Promise<void>(resolve => {
              cp.exec(`taskkill /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq *${scriptName}*"`, () => {
                this.outputChannel.appendLine(`\n[INFO] Completed Node.js process cleanup`);
                resolve();
              });
            });
          } catch (e) {
            // Ignore errors in auxiliary cleanup
          }
        }
      }
      
      // Kill processes by port (Windows)
      for (const port of detectedPorts) {
        try {
          await new Promise<void>(resolve => {
            cp.exec(`for /f "tokens=5" %a in ('netstat -aon ^| find ":${port}"') do taskkill /F /PID %a`, () => {
              this.outputChannel.appendLine(`\n[INFO] Attempted cleanup of processes using port ${port}`);
              resolve();
            });
          });
        } catch (e) {
          // Ignore errors in auxiliary cleanup
        }
      }
      
      // Final failsafe - directly kill any processes on critical ports
      // This is a last resort if the regular killing didn't work
      for (const port of criticalPorts) {
        try {
          await new Promise<void>(resolve => {
            // This is more aggressive and will kill any process holding the port
            cp.exec(`for /f "tokens=5" %a in ('netstat -aon ^| find ":${port} "') do taskkill /F /PID %a`, () => {
              this.outputChannel.appendLine(`\n[INFO] Forced cleanup of processes using port ${port}`);
              resolve();
            });
          });
        } catch (e) {
          // Ignore errors in cleanup
        }
      }
    } else {
      // Unix process killing - more straightforward
      for (const pid of allPids) {
        try {
          process.kill(pid, 'SIGTERM');
          this.outputChannel.appendLine(`\n[INFO] Sent SIGTERM to PID ${pid}`);
        } catch (e) {
          // Process might already be gone
        }
      }
      
      // Allow a small delay for SIGTERM to work
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Follow up with SIGKILL for any process that didn't terminate
      for (const pid of allPids) {
        try {
          process.kill(pid, 'SIGKILL');
          this.outputChannel.appendLine(`\n[INFO] Sent SIGKILL to PID ${pid}`);
        } catch (e) {
          // Process might already be gone, which is good
        }
      }
      
      // Also try killing by port (Unix)
      for (const port of detectedPorts) {
        try {
          await new Promise<void>(resolve => {
            cp.exec(`lsof -i:${port} -t | xargs kill -9`, () => {
              this.outputChannel.appendLine(`\n[INFO] Attempted cleanup of processes using port ${port}`);
              resolve();
            });
          });
        } catch (e) {
          // Ignore errors in auxiliary cleanup
        }
      }
      
      // Kill any related npm/node processes
      if (command.command.includes('npm') || command.command.includes('node')) {
        const scriptName = command.command.match(/(?:npm run\s+|node\s+)(\w+)/)?.[1];
        
        if (scriptName) {
          this.outputChannel.appendLine(`\n[INFO] Additional cleanup for Node.js script: ${scriptName}`);
          try {
            await new Promise<void>(resolve => {
              cp.exec(`pkill -f "node.*${scriptName}"`, () => {
                this.outputChannel.appendLine(`\n[INFO] Completed Node.js process cleanup`);
                resolve();
              });
            });
          } catch (e) {
            // Ignore errors in auxiliary cleanup
          }
        }
      }
      
      // Final failsafe - directly kill any processes on critical ports
      // This is a last resort if the regular killing didn't work
      for (const port of criticalPorts) {
        try {
          await new Promise<void>(resolve => {
            // More aggressive direct kill of processes bound to the port
            cp.exec(`lsof -ti:${port} | xargs kill -9`, () => {
              this.outputChannel.appendLine(`\n[INFO] Forced cleanup of processes using port ${port}`);
              resolve();
            });
          });
        } catch (e) {
          // Ignore errors in cleanup
        }
      }
    }
    
    this.outputChannel.appendLine(`\n[INFO] Process termination completed`);
  }
  
  /**
   * Detect possible ports from a command string
   */
  private detectPossiblePorts(command: string): number[] {
    const ports: number[] = [];
    
    // Common default ports 
    if (command.includes('npm run dev') || command.includes('vite')) {
      ports.push(5173); // Vite default port
    }
    
    if (command.includes('npm run start') || command.includes('node server')) {
      ports.push(5000, 3000, 8000, 8080); // Common server ports
    }
    
    // Look for explicit port definitions
    const portMatches = command.match(/(?:PORT|port)=(\d{2,5})/g);
    if (portMatches) {
      portMatches.forEach(match => {
        const port = parseInt(match.split('=')[1], 10);
        if (port > 0 && port < 65536 && !ports.includes(port)) {
          ports.push(port);
        }
      });
    }
    
    return ports;
  }
  
  /**
   * Check if specified ports are in use and by which process
   */
  private async checkPortsInUse(ports: number[], filterPids: number[] = []): Promise<Array<{port: number, pid: number}>> {
    const result: Array<{port: number, pid: number}> = [];
    
    if (process.platform === 'win32') {
      // Windows implementation
      const promises = ports.map(async (port) => {
        return new Promise<void>((resolve) => {
          cp.exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
            if (!error && stdout) {
              const lines = stdout.trim().split('\n');
              for (const line of lines) {
                // Parse the PID from the last column of netstat output
                const match = line.trim().match(/(\d+)$/);
                if (match && match[1]) {
                  const pid = parseInt(match[1], 10);
                  if (!isNaN(pid) && (!filterPids.length || filterPids.includes(pid))) {
                    result.push({ port, pid });
                    break;
                  }
                }
              }
            }
            resolve();
          });
        });
      });
      
      await Promise.all(promises);
    } else {
      // Unix implementation
      const promises = ports.map(async (port) => {
        return new Promise<void>((resolve) => {
          cp.exec(`lsof -i:${port} -P -n -t`, (error, stdout) => {
            if (!error && stdout) {
              const pid = parseInt(stdout.trim(), 10);
              if (!isNaN(pid) && (!filterPids.length || filterPids.includes(pid))) {
                result.push({ port, pid });
              }
            }
            resolve();
          });
        });
      });
      
      await Promise.all(promises);
    }
    
    return result;
  }
  
  /**
   * Find child processes of a given PID
   */
  private async findChildProcesses(pid: number): Promise<number[]> {
    const childPids: number[] = [];
    
    if (process.platform === 'win32') {
      // Windows implementation
      try {
        // Use WMIC to find child processes on Windows
        const { stdout } = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
          cp.exec(`wmic process where (ParentProcessId=${pid}) get ProcessId`, (error, stdout, stderr) => {
            if (error) {
              reject(error);
            } else {
              resolve({ stdout, stderr });
            }
          });
        });
        
        const lines = stdout.trim().split('\n').slice(1); // Skip header line
        for (const line of lines) {
          const childPid = parseInt(line.trim(), 10);
          if (!isNaN(childPid)) {
            childPids.push(childPid);
            
            // Recursively get children of this child process
            try {
              const grandchildren = await this.findChildProcesses(childPid);
              childPids.push(...grandchildren);
            } catch (e) {
              // Ignore errors in recursive calls
            }
          }
        }
      } catch (e) {
        // Fallback to PowerShell if WMIC fails
        try {
          const { stdout } = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
            cp.exec(`powershell "Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | Select-Object -ExpandProperty ProcessId"`, 
              (error, stdout, stderr) => {
                if (error) {
                  reject(error);
                } else {
                  resolve({ stdout, stderr });
                }
              });
          });
          
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            const childPid = parseInt(line.trim(), 10);
            if (!isNaN(childPid)) {
              childPids.push(childPid);
            }
          }
        } catch (e2) {
          // If both methods fail, return empty array
        }
      }
    } else {
      // Unix implementation
      try {
        const { stdout } = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
          cp.exec(`pgrep -P ${pid}`, (error, stdout, stderr) => {
            if (error && error.code !== 1) { // pgrep returns 1 if no processes match
              reject(error);
            } else {
              resolve({ stdout, stderr });
            }
          });
        });
        
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const childPid = parseInt(line.trim(), 10);
            if (!isNaN(childPid)) {
              childPids.push(childPid);
              
              // Recursively get children of this child process
              try {
                const grandchildren = await this.findChildProcesses(childPid);
                childPids.push(...grandchildren);
              } catch (e) {
                // Ignore errors in recursive calls
              }
            }
          }
        }
      } catch (e) {
        // If pgrep fails, try ps
        try {
          const { stdout } = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
            cp.exec(`ps -o pid --ppid ${pid} --no-headers`, (error, stdout, stderr) => {
              if (error) {
                reject(error);
              } else {
                resolve({ stdout, stderr });
              }
            });
          });
          
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              const childPid = parseInt(line.trim(), 10);
              if (!isNaN(childPid)) {
                childPids.push(childPid);
              }
            }
          }
        } catch (e2) {
          // If both methods fail, return empty array
        }
      }
    }
    
    return childPids;
  }
} 