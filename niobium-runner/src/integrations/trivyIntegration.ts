import * as vscode from 'vscode';
import * as path from 'path';
import { ToolIntegration } from './interface';
import { ResultsItem } from '../views/resultsTreeView';

/**
 * Interface for Trivy result object structure
 */
interface TrivyResult {
  Target: string;
  Class: string;
  Type: string;
  MisconfSummary?: {
    Successes: number;
    Failures: number;
  };
  Misconfigurations?: TrivyMisconfiguration[];
}

/**
 * Interface for Trivy misconfiguration structure
 */
interface TrivyMisconfiguration {
  Type: string;
  ID: string;
  AVDID?: string;
  Title: string;
  Description: string;
  Message: string;
  Namespace: string;
  Query: string;
  Resolution: string;
  Severity: string;
  PrimaryURL: string;
  References: string[];
  Status: string;
  CauseMetadata?: {
    Resource: string;
    Provider?: string;
    Service?: string;
    StartLine?: number;
    EndLine?: number;
    Code?: {
      Lines: {
        Number: number;
        Content: string;
        IsCause: boolean;
        Highlighted?: string;
      }[];
    };
    Occurrences?: {
      Resource: string;
      Filename: string;
      Location: {
        StartLine: number;
        EndLine: number;
      };
    }[];
  };
}

/**
 * Interface for Trivy scan data
 */
interface TrivyScanData {
  SchemaVersion: number;
  CreatedAt: string;
  ArtifactName: string;
  ArtifactType: string;
  Metadata: any;
  Results: TrivyResult[];
}

/**
 * Integration for Trivy scan results
 */
export class TrivyIntegration implements ToolIntegration {
  id = 'trivy';
  name = 'Trivy';
  supportedFileExtensions = ['.json'];

  /**
   * Determines if this integration can handle the given file
   */
  canHandle(filename: string, data: any): boolean {
    // Check if it's a JSON file with Trivy format
    if (!filename.endsWith('.json')) {
      return false;
    }

    // Check if data contains expected Trivy structure
    return typeof data === 'object' &&
           data !== null &&
           'SchemaVersion' in data &&
           'Results' in data &&
           Array.isArray(data.Results) &&
           data.Results.length > 0 &&
           'Target' in data.Results[0];
  }

  /**
   * Parse Trivy results into tree items
   */
  parseResults(data: any, filePath: string, filename: string): ResultsItem[] {
    try {
      const trivyData = data as TrivyScanData;
      const results: ResultsItem[] = [];

      // Add scan metadata
      results.push(
        new ResultsItem(
          `Scan Info: ${trivyData.ArtifactName}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          `Created: ${new Date(trivyData.CreatedAt).toLocaleString()}`
        )
      );

      // Count total issues by severity
      const severityCounts = this.countSeverities(trivyData.Results);
      console.log('Trivy severity counts:', JSON.stringify(severityCounts));
      
      Object.entries(severityCounts).forEach(([severity, count]) => {
        if (count > 0) {
          console.log(`Adding severity item: ${severity} - ${count} issues`);
          const item = new ResultsItem(
            `${severity}: ${count} issues`,
            vscode.TreeItemCollapsibleState.None
          );
          
          // Set icon based on severity
          switch (severity) {
            case 'CRITICAL':
              item.iconPath = new vscode.ThemeIcon('error');
              break;
            case 'HIGH':
              item.iconPath = new vscode.ThemeIcon('warning');
              break;
            case 'MEDIUM':
              item.iconPath = new vscode.ThemeIcon('info');
              break;
            default:
              item.iconPath = new vscode.ThemeIcon('check');
          }
          
          results.push(item);
        }
      });

      // Group results by type
      const typeGroups = this.groupResultsByType(trivyData.Results);
      console.log('Trivy type groups:', Object.keys(typeGroups));
      
      // Create tree items for each type
      Object.entries(typeGroups).forEach(([type, typeResults]) => {
        const typeItem = new ResultsItem(
          `${type} (${typeResults.length} findings)`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        typeItem.iconPath = new vscode.ThemeIcon('symbol-folder');
        
        // Add results as children
        typeItem.children = this.createItemsForResults(typeResults);
        
        results.push(typeItem);
      });

      return results;
    } catch (error) {
      console.error('Error parsing Trivy data:', error);
      return [this.createErrorItem(`Error parsing Trivy data: ${error}`)];
    }
  }

  /**
   * Count issues by severity across all results
   */
  private countSeverities(results: TrivyResult[]): Record<string, number> {
    const counts: Record<string, number> = {
      'CRITICAL': 0,
      'HIGH': 0,
      'MEDIUM': 0,
      'LOW': 0
    };

    results.forEach(result => {
      // Count direct misconfigurations by their severity
      if (result.Misconfigurations && result.Misconfigurations.length > 0) {
        result.Misconfigurations.forEach(misconfig => {
          if (misconfig.Severity in counts) {
            counts[misconfig.Severity]++;
          }
        });
      }
      
      // Add failures from MisconfSummary to HIGH if there are no direct misconfigurations
      // but there are failures reported in the summary
      if (!result.Misconfigurations && result.MisconfSummary && result.MisconfSummary.Failures > 0) {
        // If we don't have specific misconfigurations but have failures in summary,
        // count them as HIGH severity
        counts['HIGH'] += result.MisconfSummary.Failures;
      }
    });

    return counts;
  }

  /**
   * Group results by their Type property
   */
  private groupResultsByType(results: TrivyResult[]): Record<string, TrivyResult[]> {
    const groups: Record<string, TrivyResult[]> = {};
    
    results.forEach(result => {
      const type = result.Type || 'unknown';
      
      if (!groups[type]) {
        groups[type] = [];
      }
      
      groups[type].push(result);
    });
    
    return groups;
  }

  /**
   * Create tree items for a set of results
   */
  private createItemsForResults(results: TrivyResult[]): ResultsItem[] {
    const items: ResultsItem[] = [];
    
    results.forEach(result => {
      // Create item for each target file
      const hasIssues = result.Misconfigurations && result.Misconfigurations.length > 0;
      const collapsibleState = hasIssues 
        ? vscode.TreeItemCollapsibleState.Collapsed 
        : vscode.TreeItemCollapsibleState.None;
      
      const targetFilename = path.basename(result.Target);
      
      // Debug logging for misconfigurations
      if (hasIssues) {
        console.log(`Found ${result.Misconfigurations!.length} issues in ${result.Target}`);
        
        // Count by severity for this target
        const targetSeverityCounts: Record<string, number> = {
          'CRITICAL': 0, 'HIGH': 0, 'MEDIUM': 0, 'LOW': 0
        };
        
        result.Misconfigurations!.forEach(misconfig => {
          const sev = misconfig.Severity || 'UNKNOWN';
          if (sev in targetSeverityCounts) {
            targetSeverityCounts[sev]++;
          }
        });
        
        console.log(`Severity breakdown for ${result.Target}:`, JSON.stringify(targetSeverityCounts));
      }
      
      const targetItem = new ResultsItem(
        targetFilename,
        collapsibleState,
        undefined,
        undefined,
        `${result.Target}${hasIssues ? ` (${result.Misconfigurations!.length} issues)` : ''}`
      );
      
      // Set icon based on whether there are failures
      if (result.MisconfSummary && result.MisconfSummary.Failures > 0) {
        targetItem.iconPath = new vscode.ThemeIcon('warning');
      } else {
        targetItem.iconPath = new vscode.ThemeIcon('file');
      }
      
      // Add summary if available
      if (result.MisconfSummary) {
        const summaryText = `✓ ${result.MisconfSummary.Successes} passed, ✗ ${result.MisconfSummary.Failures} failed`;
        targetItem.description = summaryText;
      }
      
      // Add misconfigurations as children
      if (hasIssues) {
        targetItem.children = result.Misconfigurations!.map(misconfig => {
          const severity = misconfig.Severity || 'UNKNOWN';
          const misconfigItem = new ResultsItem(
            `[${severity}] ${misconfig.Title}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            misconfig.Message
          );
          
          // Set icon based on severity
          switch (severity) {
            case 'CRITICAL':
              misconfigItem.iconPath = new vscode.ThemeIcon('error');
              break;
            case 'HIGH':
              misconfigItem.iconPath = new vscode.ThemeIcon('warning');
              break;
            case 'MEDIUM':
              misconfigItem.iconPath = new vscode.ThemeIcon('info');
              break;
            case 'LOW':
              misconfigItem.iconPath = new vscode.ThemeIcon('check');
              break;
            default:
              misconfigItem.iconPath = new vscode.ThemeIcon('circle-filled');
          }
          
          // Add detailed tooltip
          misconfigItem.tooltip = 
            `ID: ${misconfig.ID}\n` +
            `Severity: ${misconfig.Severity}\n` +
            `Message: ${misconfig.Message}\n` +
            `Description: ${misconfig.Description}\n` +
            `Resolution: ${misconfig.Resolution}\n` +
            `More info: ${misconfig.PrimaryURL}`;
          
          // Add command to open file if location info is available
          if (misconfig.CauseMetadata && 
              misconfig.CauseMetadata.StartLine && 
              result.Target) {
            misconfigItem.command = {
              command: 'niobium-runner.openFileAtLocation',
              title: 'Open File',
              arguments: [
                result.Target,
                misconfig.CauseMetadata.StartLine,
                1 // Default to column 1
              ]
            };
          }
          
          return misconfigItem;
        });
      }
      
      items.push(targetItem);
    });
    
    return items;
  }

  /**
   * Create an error item for display
   */
  private createErrorItem(message: string): ResultsItem {
    const item = new ResultsItem(
      message,
      vscode.TreeItemCollapsibleState.None
    );
    item.iconPath = new vscode.ThemeIcon('error');
    return item;
  }
} 