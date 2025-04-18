import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { CommandConfig, StageConfig, ConfigProvider, BlueWaspConfig, DockerContainerConfig } from './configProvider';
import { promisify } from 'util';
import { JobOutputService } from './ui/jobOutputService';
import { DockerRunner } from './dockerRunner';
import { IgnoreProvider } from './utils/ignoreUtils';
import { sanitizeContainerName } from './utils/dockerUtils';

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

  constructor(context?: vscode.ExtensionContext) {
    this.configProvider = new ConfigProvider();
    this.outputChannel = vscode.window.createOutputChannel('Blue Wasp Runner');
    this.jobOutputService = context ? JobOutputService.getInstance(context) : null as any;
    this.dockerRunner = new DockerRunner(context);
    this.ignoreProvider = IgnoreProvider.getInstance();
  }

  /**
   * Check if a path should be ignored based on .bluewaspignore patterns
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
    this.outputChannel.appendLine(`Command: ${command.command}`);
    
    if (command.cwd) {
      this.outputChannel.appendLine(`Working directory: ${command.cwd}`);
    }
    
    if (command.env && Object.keys(command.env).length > 0) {
      this.outputChannel.appendLine('Environment variables:');
      for (const [key, value] of Object.entries(command.env)) {
        this.outputChannel.appendLine(`  ${key}=${value}`);
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
        const errorMsg = `Working directory "${command.cwd}" is in an ignored path according to .bluewaspignore`;
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
      
      const { stdout, stderr } = await execAsync(command.command, execOptions);

      // Write output to the output channel
      if (stdout) {
        this.outputChannel.appendLine('\n[OUTPUT]');
        this.outputChannel.appendLine(stdout);
        
        // Add output to WebView if available
        if (jobId) {
          this.jobOutputService.appendOutput(jobId, stdout);
        }
      }
      
      if (stderr) {
        this.outputChannel.appendLine('\n[STDERR]');
        this.outputChannel.appendLine(stderr);
        
        // Add error to WebView if available
        if (jobId) {
          this.jobOutputService.appendError(jobId, stderr);
        }
      }
      
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
        output: stdout,
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

  async runStage(config: BlueWaspConfig, stageName: string, workspaceRoot: string): Promise<ExecutionResult> {
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
    
    for (const command of commands) {
      commandIndex++;
      this.outputChannel.appendLine(`\n[${commandIndex}/${commands.length}] Executing command: ${command.name}`);
      
      // Run command and link to parent stage in WebView
      const result = await this.runCommand(command, workspaceRoot);
      combinedOutput += result.output + '\n';
      
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

  async runSequence(config: BlueWaspConfig, sequenceName: string, workspaceRoot: string): Promise<ExecutionResult> {
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
      name: command.container_name || `bluewasp-${sanitizeContainerName(command.name)}-${Date.now()}`,
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
} 