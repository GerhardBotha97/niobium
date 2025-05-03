import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StageConfig, ConfigProvider, NiobiumConfig } from '../configProvider';
import { CommandRunner } from '../commandRunner';
import { FileWatcherService } from './fileWatcherService';

/**
 * Service for managing git hooks integration
 */
export class GitHookService {
  private static instance: GitHookService;
  private configProvider: ConfigProvider;
  private commandRunner: CommandRunner;
  private fileWatcherService: FileWatcherService;
  private outputChannel: vscode.OutputChannel;

  private constructor(private context: vscode.ExtensionContext) {
    this.configProvider = new ConfigProvider();
    this.commandRunner = new CommandRunner(context);
    this.fileWatcherService = FileWatcherService.getInstance(context);
    this.outputChannel = vscode.window.createOutputChannel('Niobium Git Hooks');
  }

  /**
   * Get the singleton instance of GitHookService
   */
  public static getInstance(context: vscode.ExtensionContext): GitHookService {
    if (!GitHookService.instance) {
      GitHookService.instance = new GitHookService(context);
    }
    return GitHookService.instance;
  }

  /**
   * Initialize git hooks
   */
  public async initialize(): Promise<void> {
    // Check if git hooks are enabled
    const gitHooksEnabled = vscode.workspace.getConfiguration('niobium-runner')
      .get<boolean>('gitHooks.enabled', true);
      
    if (!gitHooksEnabled) {
      console.log('Git hooks are disabled in settings');
      return;
    }
    
    if (!vscode.workspace.workspaceFolders) {
      return;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const gitDir = path.join(workspaceRoot, '.git');
    
    // Check if this is a git repository
    if (!fs.existsSync(gitDir)) {
      console.log('Not a git repository, skipping git hooks setup');
      return;
    }
    
    // Create hooks directory if it doesn't exist
    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    
    // Check if pre-commit hook is enabled in settings
    const installPreCommit = vscode.workspace.getConfiguration('niobium-runner')
      .get<boolean>('gitHooks.installPreCommit', true);
      
    if (installPreCommit) {
      // Set up pre-commit hook
      await this.setupPreCommitHook(workspaceRoot, hooksDir);
    }
  }

  /**
   * Set up the pre-commit hook
   */
  private async setupPreCommitHook(workspaceRoot: string, hooksDir: string): Promise<void> {
    const preCommitPath = path.join(hooksDir, 'pre-commit');
    const config = await this.configProvider.loadConfig(workspaceRoot);
    
    if (!config || !config.stages) {
      return;
    }
    
    // Check if any stages have pre-commit watchers
    const hasPreCommitWatchers = config.stages.some(
      stage => stage.watch && stage.watch.pre_commit
    );
    
    if (!hasPreCommitWatchers) {
      console.log('No pre-commit watchers configured, skipping pre-commit hook setup');
      return;
    }
    
    // Create pre-commit hook file
    const hookContent = this.generatePreCommitScript(workspaceRoot);
    
    // Back up existing hook if it exists
    if (fs.existsSync(preCommitPath)) {
      const backupPath = `${preCommitPath}.niobium-backup`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(preCommitPath, backupPath);
        console.log(`Backed up existing pre-commit hook to ${backupPath}`);
      }
    }
    
    // Write new hook file
    fs.writeFileSync(preCommitPath, hookContent, { mode: 0o755 }); // Make executable
    console.log(`Pre-commit hook installed at ${preCommitPath}`);
  }

  /**
   * Generate the pre-commit hook script
   */
  private generatePreCommitScript(workspaceRoot: string): string {
    // Get the path to the extension's installation directory
    const extensionPath = this.context.extensionPath;
    const nodePath = process.execPath;
    
    // Create the hook script that will invoke the extension's pre-commit handler
    return `#!/bin/bash

# Niobium pre-commit hook
echo "Running Niobium pre-commit checks..."

# Get the staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

# If no files are staged, exit early
if [ -z "$STAGED_FILES" ]; then
  echo "No files staged for commit, skipping Niobium pre-commit hooks"
  exit 0
fi

# Run VS Code extension command to execute pre-commit watchers
"${nodePath}" "${extensionPath}/out/preCommitRunner.js" "$PWD" "$STAGED_FILES"
EXIT_CODE=$?

# If the command failed, abort the commit
if [ $EXIT_CODE -ne 0 ]; then
  echo "Niobium pre-commit checks failed, aborting commit"
  exit 1
fi

echo "Niobium pre-commit checks passed"
exit 0
`;
  }

  /**
   * Run pre-commit watchers on staged files
   * This is called by the pre-commit hook script
   */
  public async runPreCommitWatchers(workspaceRoot: string, stagedFiles: string[]): Promise<boolean> {
    this.outputChannel.show();
    this.outputChannel.appendLine('Running Niobium pre-commit watchers...');
    
    if (stagedFiles.length === 0) {
      this.outputChannel.appendLine('No files staged for commit, skipping pre-commit watchers');
      return true;
    }
    
    this.outputChannel.appendLine(`Found ${stagedFiles.length} staged files`);
    
    // Load config
    const config = await this.configProvider.loadConfig(workspaceRoot);
    if (!config || !config.stages) {
      this.outputChannel.appendLine('No valid configuration found, skipping pre-commit watchers');
      return true;
    }
    
    // Find stages with pre-commit watchers
    const preCommitStages = config.stages.filter(
      stage => stage.watch && stage.watch.pre_commit
    );
    
    if (preCommitStages.length === 0) {
      this.outputChannel.appendLine('No pre-commit watchers configured, skipping');
      return true;
    }
    
    this.outputChannel.appendLine(`Found ${preCommitStages.length} stages with pre-commit watchers`);
    
    // Run each pre-commit watcher stage
    let allPassed = true;
    for (const stage of preCommitStages) {
      const passesCheck = await this.runPreCommitWatcherStage(stage, config, workspaceRoot, stagedFiles);
      if (!passesCheck && !stage.allow_failure) {
        allPassed = false;
        this.outputChannel.appendLine(`Stage "${stage.name}" failed pre-commit check`);
      }
    }
    
    if (allPassed) {
      this.outputChannel.appendLine('All pre-commit watchers passed');
    } else {
      this.outputChannel.appendLine('Some pre-commit watchers failed, aborting commit');
    }
    
    return allPassed;
  }

  /**
   * Run a single pre-commit watcher stage
   */
  private async runPreCommitWatcherStage(
    stage: StageConfig, 
    config: NiobiumConfig,
    workspaceRoot: string, 
    stagedFiles: string[]
  ): Promise<boolean> {
    this.outputChannel.appendLine(`\nRunning pre-commit watcher stage: ${stage.name}`);
    
    if (!stage.watch || !stage.watch.patterns) {
      return true;
    }
    
    // Check if any staged files match this watcher's patterns
    const matchingFiles = this.getMatchingFiles(stagedFiles, stage.watch.patterns, workspaceRoot);
    
    if (matchingFiles.length === 0) {
      this.outputChannel.appendLine(`No staged files match patterns for stage "${stage.name}", skipping`);
      return true;
    }
    
    this.outputChannel.appendLine(`Found ${matchingFiles.length} matching files for stage "${stage.name}"`);
    this.outputChannel.appendLine(`Running stage "${stage.name}" on staged files...`);
    
    // Run the stage as a pre-commit check
    const result = await this.commandRunner.runStage(config, stage.name, workspaceRoot);
    
    if (result.success) {
      this.outputChannel.appendLine(`Stage "${stage.name}" passed`);
      return true;
    } else {
      this.outputChannel.appendLine(`Stage "${stage.name}" failed: ${result.error || 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Get files that match the watcher patterns
   */
  private getMatchingFiles(files: string[], patterns: string[], workspaceRoot: string): string[] {
    return this.fileWatcherService.getMatchingFiles(files, patterns, workspaceRoot);
  }

  /**
   * Uninstall the pre-commit hook
   */
  public async uninstallPreCommitHook(): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const gitDir = path.join(workspaceRoot, '.git');
    
    // Check if this is a git repository
    if (!fs.existsSync(gitDir)) {
      console.log('Not a git repository, nothing to uninstall');
      return;
    }
    
    const preCommitPath = path.join(gitDir, 'hooks', 'pre-commit');
    
    // Check if pre-commit hook exists
    if (!fs.existsSync(preCommitPath)) {
      console.log('No pre-commit hook found, nothing to uninstall');
      return;
    }
    
    // Read the hook file to check if it's a Niobium hook
    const hookContent = fs.readFileSync(preCommitPath, 'utf8');
    
    if (!hookContent.includes('Niobium pre-commit hook')) {
      this.outputChannel.appendLine('The pre-commit hook does not appear to be a Niobium hook');
      this.outputChannel.appendLine('To prevent accidental removal of custom hooks, the hook will not be uninstalled');
      this.outputChannel.appendLine('You can manually remove the hook if needed');
      this.outputChannel.show();
      return;
    }
    
    // Check if there's a backup to restore
    const backupPath = `${preCommitPath}.niobium-backup`;
    
    if (fs.existsSync(backupPath)) {
      // Restore the backup
      fs.copyFileSync(backupPath, preCommitPath);
      fs.unlinkSync(backupPath);
      console.log('Restored original pre-commit hook from backup');
    } else {
      // No backup, just remove the file
      fs.unlinkSync(preCommitPath);
      console.log('Removed pre-commit hook');
    }
  }
} 