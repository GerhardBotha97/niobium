/**
 * This script is executed by the pre-commit git hook to run pre-commit watchers
 * 
 * Usage: node preCommitRunner.js <workspaceRoot> <stagedFiles>
 * Where:
 *   workspaceRoot: The git repository root directory
 *   stagedFiles: Space-separated list of staged files
 */

import { GitHookService } from './utils/gitHookService';
import * as vscode from 'vscode';
import * as path from 'path';

async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('Usage: node preCommitRunner.js <workspaceRoot> <stagedFiles>');
      process.exit(1);
    }
    
    const workspaceRoot = args[0];
    const stagedFiles = args.slice(1);
    
    console.log(`Running pre-commit checks in ${workspaceRoot}`);
    console.log(`${stagedFiles.length} files staged for commit`);
    
    // Create a context for the GitHookService
    const context = {
      extensionPath: path.dirname(path.dirname(__dirname)), // Get the extension path
      subscriptions: []
    } as unknown as vscode.ExtensionContext;
    
    // Run pre-commit watchers
    const gitHookService = GitHookService.getInstance(context);
    const result = await gitHookService.runPreCommitWatchers(workspaceRoot, stagedFiles);
    
    // Exit with appropriate code based on result
    process.exit(result ? 0 : 1);
  } catch (error) {
    console.error('Error in pre-commit runner:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error in pre-commit runner:', error);
  process.exit(1);
}); 