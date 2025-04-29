import * as vscode from 'vscode';
import * as path from 'path';
import { ToolIntegration } from './interface';
import { ResultsItem } from '../views/resultsTreeView';

/**
 * Interface for GitLeaks finding that exactly matches their output format
 */
interface GitLeaksFinding {
  RuleID: string;
  Description: string;
  StartLine: number;
  EndLine: number;
  StartColumn: number;
  EndColumn: number;
  Match: string;
  Secret: string;
  File: string;
  SymlinkFile: string;
  Commit: string;
  Entropy: number;
  Author: string;
  Email: string;
  Date: string;
  Message: string;
  Tags: string[];
  Fingerprint: string;
}

/**
 * Integration for GitLeaks scan results
 */
export class GitLeaksIntegration implements ToolIntegration {
  id = 'gitleaks';
  name = 'GitLeaks';
  supportedFileExtensions = ['.json'];

  /**
   * Determines if this integration can handle the given file
   */
  canHandle(filename: string, data: any): boolean {
    // Check if it's a JSON file with GitLeaks format
    if (!filename.endsWith('.json')) {
      return false;
    }

    // Check if data contains an array of findings with expected GitLeaks properties
    return Array.isArray(data) && 
           data.length > 0 && 
           data[0] !== null &&
           typeof data[0] === 'object' &&
           'RuleID' in data[0] &&
           'Description' in data[0] &&
           'File' in data[0];
  }

  /**
   * Parse GitLeaks results into tree items
   */
  parseResults(data: any, filePath: string, filename: string): ResultsItem[] {
    // Return empty array if data is not in expected format
    if (!Array.isArray(data)) {
      return [this.createErrorItem('Invalid GitLeaks data format')];
    }

    const findings: GitLeaksFinding[] = data;
    
    if (findings.length === 0) {
      return [
        new ResultsItem(
          'No security issues found',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          'GitLeaks scan completed successfully with no findings'
        )
      ];
    }

    // Create summary item
    const results: ResultsItem[] = [
      new ResultsItem(
        `${findings.length} potential secrets found`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        `GitLeaks detected ${findings.length} potential security issues`
      )
    ];

    // Group findings by file
    const fileGroups: Map<string, GitLeaksFinding[]> = new Map();
    
    findings.forEach(finding => {
      // Clean up the file path if needed
      const filePath = finding.File;
      
      if (!fileGroups.has(filePath)) {
        fileGroups.set(filePath, []);
      }
      fileGroups.get(filePath)?.push(finding);
    });

    // Create tree items for each file with findings
    fileGroups.forEach((fileFindings, filePath) => {
      const fileName = path.basename(filePath);
      
      const fileItem = new ResultsItem(
        fileName,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        `${filePath} (${fileFindings.length} findings)`
      );
      fileItem.iconPath = new vscode.ThemeIcon('file');
      
      // Add file findings as children
      fileItem.children = fileFindings.map(finding => {
        // Format the secret for display - trim if too long
        const secretDisplay = finding.Secret.length > 40 
          ? finding.Secret.substring(0, 37) + '...' 
          : finding.Secret;
        
        const findingItem = new ResultsItem(
          `${finding.RuleID}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          `Line ${finding.StartLine}: ${secretDisplay}`
        );
        
        // Add more details to the tooltip
        findingItem.tooltip = 
          `Rule: ${finding.RuleID}\n` +
          `Description: ${finding.Description}\n` +
          `Line: ${finding.StartLine}\n` +
          `Secret: ${finding.Secret}\n` +
          `File: ${finding.File}`;

        // Add command to open file at the secret's location
        findingItem.command = {
          command: 'niobium-runner.openFileAtLocation',
          title: 'Open File',
          arguments: [
            finding.File,
            finding.StartLine,
            finding.StartColumn
          ]
        };

        findingItem.iconPath = new vscode.ThemeIcon('warning');
        return findingItem;
      });
      
      results.push(fileItem);
    });

    return results;
  }

  private createErrorItem(message: string): ResultsItem {
    const item = new ResultsItem(
      message,
      vscode.TreeItemCollapsibleState.None
    );
    item.iconPath = new vscode.ThemeIcon('error');
    return item;
  }
} 