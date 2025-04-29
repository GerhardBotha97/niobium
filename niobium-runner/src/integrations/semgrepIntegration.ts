import * as vscode from 'vscode';
import * as path from 'path';
import { ToolIntegration } from './interface';
import { ResultsItem } from '../views/resultsTreeView';

/**
 * Interface for Semgrep result structure
 */
interface SemgrepResult {
  check_id: string;
  path: string;
  start: {
    line: number;
    col: number;
    offset: number;
  };
  end: {
    line: number;
    col: number;
    offset: number;
  };
  extra: {
    message: string;
    fix?: string;
    metadata: {
      category: string;
      cwe?: string[];
      technology?: string[];
      owasp?: string[];
      references?: string[];
      subcategory?: string[];
      likelihood?: string;
      impact?: string;
      confidence?: string;
      vulnerability_class?: string[];
      source?: string;
      shortlink?: string;
    };
    severity: string;
    fingerprint: string;
    lines: string;
    validation_state: string;
    engine_kind: string;
  };
}

/**
 * Interface for Semgrep scan data
 */
interface SemgrepScanData {
  version: string;
  results: SemgrepResult[];
  errors: any[];
  paths: {
    scanned: string[];
  };
  skipped_rules: any[];
}

/**
 * Integration for Semgrep scan results
 */
export class SemgrepIntegration implements ToolIntegration {
  id = 'semgrep';
  name = 'Semgrep';
  supportedFileExtensions = ['.json'];

  /**
   * Determines if this integration can handle the given file
   */
  canHandle(filename: string, data: any): boolean {
    // Check if it's a JSON file with Semgrep format
    if (!filename.endsWith('.json')) {
      return false;
    }

    // Check if data contains expected Semgrep structure
    return typeof data === 'object' &&
           data !== null &&
           'version' in data &&
           'results' in data &&
           Array.isArray(data.results) &&
           'paths' in data;
  }

  /**
   * Parse Semgrep results into tree items
   */
  parseResults(data: any, filePath: string, filename: string): ResultsItem[] {
    try {
      const semgrepData = data as SemgrepScanData;
      const results: ResultsItem[] = [];

      // Add scan metadata
      results.push(
        new ResultsItem(
          `Semgrep Scan v${semgrepData.version}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          `Scanned ${semgrepData.paths.scanned.length} files`
        )
      );

      // Count total issues by severity
      const severityCounts = this.countSeverities(semgrepData.results);
      
      Object.entries(severityCounts).forEach(([severity, count]) => {
        if (count > 0) {
          const item = new ResultsItem(
            `${severity}: ${count} issues`,
            vscode.TreeItemCollapsibleState.None
          );
          
          // Set icon based on severity
          switch (severity) {
            case 'ERROR':
              item.iconPath = new vscode.ThemeIcon('error');
              break;
            case 'WARNING':
              item.iconPath = new vscode.ThemeIcon('warning');
              break;
            case 'INFO':
              item.iconPath = new vscode.ThemeIcon('info');
              break;
            default:
              item.iconPath = new vscode.ThemeIcon('circle-filled');
          }
          
          results.push(item);
        }
      });

      // Group results by file
      const fileGroups = this.groupResultsByFile(semgrepData.results);
      
      // Create tree items for each file
      Object.entries(fileGroups).forEach(([filePath, fileResults]) => {
        const fileName = path.basename(filePath);
        
        const fileItem = new ResultsItem(
          fileName,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          undefined,
          `${filePath} (${fileResults.length} findings)`
        );
        fileItem.iconPath = new vscode.ThemeIcon('file');
        
        // Add file findings as children
        fileItem.children = fileResults.map(result => {
          const ruleId = result.check_id.split('.').pop() || result.check_id;
          const severity = result.extra.severity;
          
          const findingItem = new ResultsItem(
            `[${severity}] ${ruleId}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            `Line ${result.start.line}: ${this.truncateMessage(result.extra.message)}`
          );
          
          // Set icon based on severity
          switch (severity) {
            case 'ERROR':
              findingItem.iconPath = new vscode.ThemeIcon('error');
              break;
            case 'WARNING':
              findingItem.iconPath = new vscode.ThemeIcon('warning');
              break;
            case 'INFO':
              findingItem.iconPath = new vscode.ThemeIcon('info');
              break;
            default:
              findingItem.iconPath = new vscode.ThemeIcon('circle-filled');
          }
          
          // Add detailed tooltip
          findingItem.tooltip = 
            `Rule: ${result.check_id}\n` +
            `Severity: ${result.extra.severity}\n` +
            `Lines: ${result.start.line} - ${result.end.line}\n` +
            `Message: ${result.extra.message}\n` +
            (result.extra.fix ? `Fix: ${result.extra.fix}\n` : '') +
            (result.extra.metadata.shortlink ? `More info: ${result.extra.metadata.shortlink}` : '');
          
          // Add command to open file at the location
          findingItem.command = {
            command: 'niobium-runner.openFileAtLocation',
            title: 'Open File',
            arguments: [
              result.path,
              result.start.line,
              result.start.col
            ]
          };
          
          return findingItem;
        });
        
        results.push(fileItem);
      });

      return results;
    } catch (error) {
      console.error('Error parsing Semgrep data:', error);
      return [this.createErrorItem(`Error parsing Semgrep data: ${error}`)];
    }
  }

  /**
   * Count issues by severity across all results
   */
  private countSeverities(results: SemgrepResult[]): Record<string, number> {
    const counts: Record<string, number> = {
      'ERROR': 0,
      'WARNING': 0,
      'INFO': 0
    };

    results.forEach(result => {
      const severity = result.extra.severity;
      if (severity in counts) {
        counts[severity]++;
      }
    });

    return counts;
  }

  /**
   * Group results by file path
   */
  private groupResultsByFile(results: SemgrepResult[]): Record<string, SemgrepResult[]> {
    const groups: Record<string, SemgrepResult[]> = {};
    
    results.forEach(result => {
      const filePath = result.path;
      
      if (!groups[filePath]) {
        groups[filePath] = [];
      }
      
      groups[filePath].push(result);
    });
    
    return groups;
  }

  /**
   * Truncate long messages for display
   */
  private truncateMessage(message: string, maxLength: number = 100): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + '...';
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