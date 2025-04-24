import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get the full path to the .niobium.yml file in the current workspace
 * @returns The full path to the .niobium.yml file or undefined if not found
 */
export function getConfigFilePath(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const configPath = path.join(rootPath, '.niobium.yml');

  // Check if the file exists
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  // Check for alternate extensions
  const alternateExtensions = [
    '.niobium.yaml',
    'niobium.yml',
    'niobium.yaml'
  ];

  for (const ext of alternateExtensions) {
    const altPath = path.join(rootPath, ext);
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }

  return undefined;
}

/**
 * Get the glob pattern to watch for config files
 * @returns The glob pattern for all possible config file names
 */
export function getConfigWatchPattern(): string {
  return '**/{.niobium.yml,.niobium.yaml,niobium.yml,niobium.yaml}';
} 