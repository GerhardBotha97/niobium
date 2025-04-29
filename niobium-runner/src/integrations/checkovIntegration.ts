import * as vscode from 'vscode';
import * as path from 'path';
import { ToolIntegration } from './interface';
import { ResultsItem } from '../views/resultsTreeView';

/**
 * Interface for Checkov result object structure based on actual output
 */
interface CheckovResult {
  check_id: string;
  check_name: string;
  check_result: {
    result: string;
    evaluated_keys?: string[];
  };
  code_block?: any; // Can be array or object with line numbers as keys
  file_path: string;
  file_line_range: number[];
  resource: string;
  check_class: string;
  file_abs_path?: string;
  guideline?: string;
  severity?: string;
  fixed_definition?: any;
  bc_check_id?: string;
  definition_context_file_path?: string | null;
  caller_file_path?: string | null;
  caller_file_line_range?: any;
  resource_address?: string | null;
  evaluations?: any;
  entity_tags?: any;
  benchmarks?: any;
  description?: string;
  short_description?: string;
  vulnerability_details?: any;
  connected_nodes?: any;
  details?: any[];
  check_len?: any;
  results_configuration?: {[key: string]: any};
  _startline_?: number;
  _endline_?: number;
}

/**
 * Interface for Checkov scan data
 */
interface CheckovScanData {
  check_type?: string;
  results?: {
    passed_checks?: CheckovResult[];
    failed_checks?: CheckovResult[];
    skipped_checks?: CheckovResult[];
    parsing_errors?: string[];
  };
  summary?: {
    passed: number;
    failed: number;
    skipped: number;
    parsing_errors: number;
    resource_count: number;
  };
}

/**
 * Integration for Checkov scan results
 */
export class CheckovIntegration implements ToolIntegration {
  id = 'checkov';
  name = 'Checkov';
  supportedFileExtensions = ['.json'];

  /**
   * Determines if this integration can handle the given file
   */
  canHandle(filename: string, data: any): boolean {
    // Check if it's a JSON file
    if (!filename.endsWith('.json')) {
      return false;
    }
    
    // Fast path: if the filename is checkov-results.json, it's likely a Checkov file
    if (filename === 'checkov-results.json' || 
        filename.endsWith('/checkov-results.json') ||
        filename === 'results_json.json' || 
        filename.endsWith('/results_json.json') ||
        filename === 'checkov-report.json' || 
        filename.endsWith('/checkov-report.json')) {
      // Basic check to confirm it's JSON array
      return Array.isArray(data) && data.length > 0 && 
             typeof data[0] === 'object' && data[0] !== null &&
             ('check_id' in data[0] || 'check_name' in data[0] || 'check_result' in data[0] ||
              ('check_type' in data[0] && 'results' in data[0]));
    }

    // Check for standard Checkov format
    if (typeof data === 'object' && data !== null) {
      if ('check_type' in data && 'results' in data && 'summary' in data) {
        return true;
      }
      
      // Check if it's an array of Checkov checks
      if (Array.isArray(data) && data.length > 0) {
        const firstItem = data[0];
        return typeof firstItem === 'object' && firstItem !== null && 
               ('check_id' in firstItem || 'check_result' in firstItem || 
                ('check_type' in firstItem && 'results' in firstItem));
      }
    }
    
    return false;
  }

  /**
   * Parse Checkov results into tree items
   */
  parseResults(data: any, filePath: string, filename: string): ResultsItem[] {
    try {
      // Handle the case where we have an array with a single object containing results
      if (Array.isArray(data) && data.length > 0 && 
          'check_type' in data[0] && 'results' in data[0] && 'summary' in data[0]) {
        return this.parseObjectResults(data[0], filePath, filename);
      }
      
      // Handle array-style results (which appears to be what we're getting)
      if (Array.isArray(data)) {
        return this.parseArrayResults(data, filePath, filename);
      }
      
      // Handle standard Checkov format with check_type, results, and summary
      return this.parseObjectResults(data, filePath, filename);
    } catch (error) {
      console.error('Error parsing Checkov data:', error);
      return [this.createErrorItem(`Error parsing Checkov data: ${error}`)];
    }
  }

  /**
   * Parse object-style Checkov results (with check_type, results, summary structure)
   */
  private parseObjectResults(data: any, filePath: string, filename: string): ResultsItem[] {
    try {
      const checkovData = data as CheckovScanData;
      const results: ResultsItem[] = [];

      // If we have summary information, show it
      if (checkovData.summary) {
        results.push(
          new ResultsItem(
            `Scan Type: ${checkovData.check_type || 'Unknown'}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            `Resource Count: ${checkovData.summary.resource_count}`
          )
        );

        // Add summary
        const summaryItem = new ResultsItem(
          'Summary',
          vscode.TreeItemCollapsibleState.Expanded
        );
        summaryItem.iconPath = new vscode.ThemeIcon('symbol-folder');
        summaryItem.children = [
          new ResultsItem(
            `Passed: ${checkovData.summary.passed}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined
          ),
          new ResultsItem(
            `Failed: ${checkovData.summary.failed}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined
          ),
          new ResultsItem(
            `Skipped: ${checkovData.summary.skipped}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined
          ),
          new ResultsItem(
            `Parsing Errors: ${checkovData.summary.parsing_errors}`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined
          )
        ];

        // Set icons based on result
        summaryItem.children[0].iconPath = new vscode.ThemeIcon('check');
        summaryItem.children[1].iconPath = new vscode.ThemeIcon('error');
        summaryItem.children[2].iconPath = new vscode.ThemeIcon('warning');
        summaryItem.children[3].iconPath = new vscode.ThemeIcon('info');

        results.push(summaryItem);
      }

      // Process failed checks if we have them
      if (checkovData.results?.failed_checks && checkovData.results.failed_checks.length > 0) {
        const fileGroups = this.groupChecksByFile(checkovData.results.failed_checks);
        
        // Create failed checks section
        const failedChecksItem = new ResultsItem(
          `Failed Checks (${checkovData.results.failed_checks.length})`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        failedChecksItem.iconPath = new vscode.ThemeIcon('error');
        
        // Add file groups
        failedChecksItem.children = Object.entries(fileGroups).map(([filePath, checks]) => {
          const fileItem = new ResultsItem(
            `${path.basename(filePath)} (${checks.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            filePath
          );
          fileItem.iconPath = new vscode.ThemeIcon('file');
          
          // Add checks for this file
          fileItem.children = checks.map(check => this.createCheckItem(check));
          
          return fileItem;
        });
        
        results.push(failedChecksItem);
      }

      // Process passed checks if we have them
      if (checkovData.results?.passed_checks && checkovData.results.passed_checks.length > 0) {
        const fileGroups = this.groupChecksByFile(checkovData.results.passed_checks);
        
        // Create passed checks section
        const passedChecksItem = new ResultsItem(
          `Passed Checks (${checkovData.results.passed_checks.length})`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        passedChecksItem.iconPath = new vscode.ThemeIcon('check');
        
        // Add file groups
        passedChecksItem.children = Object.entries(fileGroups).map(([filePath, checks]) => {
          const fileItem = new ResultsItem(
            `${path.basename(filePath)} (${checks.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            filePath
          );
          fileItem.iconPath = new vscode.ThemeIcon('file');
          
          // Add checks for this file
          fileItem.children = checks.map(check => this.createCheckItem(check));
          
          return fileItem;
        });
        
        results.push(passedChecksItem);
      }

      // Add parsing errors if any
      if (checkovData.results?.parsing_errors && checkovData.results.parsing_errors.length > 0) {
        const parsingErrorsItem = new ResultsItem(
          `Parsing Errors (${checkovData.results.parsing_errors.length})`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        parsingErrorsItem.iconPath = new vscode.ThemeIcon('warning');
        
        parsingErrorsItem.children = checkovData.results.parsing_errors.map(error => {
          return new ResultsItem(
            error,
            vscode.TreeItemCollapsibleState.None
          );
        });
        
        results.push(parsingErrorsItem);
      }

      return results;
    } catch (error) {
      console.error('Error parsing object Checkov data:', error);
      return [this.createErrorItem(`Error parsing object Checkov data: ${error}`)];
    }
  }

  /**
   * Parse array-style Checkov results
   */
  private parseArrayResults(data: any[], filePath: string, filename: string): ResultsItem[] {
    try {
      const results: ResultsItem[] = [];
      
      // Add file metadata
      results.push(
        new ResultsItem(
          `Checkov Results: ${filename}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          `Total findings: ${data.length}`
        )
      );
      
      // Group results by check result (PASSED/FAILED)
      const passedChecks = data.filter(check => 
        check.check_result && check.check_result.result === "PASSED"
      );
      
      const failedChecks = data.filter(check => 
        !check.check_result || check.check_result.result !== "PASSED"
      );
      
      // Add summary
      const summaryItem = new ResultsItem(
        'Summary',
        vscode.TreeItemCollapsibleState.Expanded
      );
      summaryItem.iconPath = new vscode.ThemeIcon('symbol-folder');
      summaryItem.children = [
        new ResultsItem(
          `Passed: ${passedChecks.length}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined
        ),
        new ResultsItem(
          `Failed: ${failedChecks.length}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined
        )
      ];
      
      // Set icons based on result
      summaryItem.children[0].iconPath = new vscode.ThemeIcon('check');
      summaryItem.children[1].iconPath = new vscode.ThemeIcon('error');
      
      results.push(summaryItem);
      
      // Group failed checks by file
      if (failedChecks.length > 0) {
        const fileGroups = this.groupChecksByFile(failedChecks);
        
        // Create failed checks section
        const failedChecksItem = new ResultsItem(
          `Failed Checks (${failedChecks.length})`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        failedChecksItem.iconPath = new vscode.ThemeIcon('error');
        
        // Add file groups
        failedChecksItem.children = Object.entries(fileGroups).map(([filePath, checks]) => {
          const fileItem = new ResultsItem(
            `${path.basename(filePath)} (${checks.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            filePath
          );
          fileItem.iconPath = new vscode.ThemeIcon('file');
          
          // Add checks for this file
          fileItem.children = checks.map(check => this.createCheckItem(check));
          
          return fileItem;
        });
        
        results.push(failedChecksItem);
      }
      
      // Add passed checks by file
      if (passedChecks.length > 0) {
        const fileGroups = this.groupChecksByFile(passedChecks);
        
        // Create passed checks section
        const passedChecksItem = new ResultsItem(
          `Passed Checks (${passedChecks.length})`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        passedChecksItem.iconPath = new vscode.ThemeIcon('check');
        
        // Add file groups
        passedChecksItem.children = Object.entries(fileGroups).map(([filePath, checks]) => {
          const fileItem = new ResultsItem(
            `${path.basename(filePath)} (${checks.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            filePath
          );
          fileItem.iconPath = new vscode.ThemeIcon('file');
          
          // Add checks for this file
          fileItem.children = checks.map(check => this.createCheckItem(check));
          
          return fileItem;
        });
        
        results.push(passedChecksItem);
      }
      
      return results;
    } catch (error) {
      console.error('Error parsing array Checkov data:', error);
      return [this.createErrorItem(`Error parsing array Checkov data: ${error}`)];
    }
  }

  /**
   * Group checks by their file path
   */
  private groupChecksByFile(checks: CheckovResult[]): Record<string, CheckovResult[]> {
    const groups: Record<string, CheckovResult[]> = {};
    
    checks.forEach(check => {
      // Ensure we have a file path, using a default if not
      const filePath = check.file_path || 'unknown-file';
      
      if (!groups[filePath]) {
        groups[filePath] = [];
      }
      
      groups[filePath].push(check);
    });
    
    return groups;
  }

  /**
   * Create a tree item for a specific check
   */
  private createCheckItem(check: CheckovResult): ResultsItem {
    // Make sure we handle potential undefined values properly
    const resultStatus = check.check_result?.result || "UNKNOWN";
    const checkName = check.check_name || check.check_id || "Unknown check";
    const severityLabel = check.severity ? `[${check.severity}] ` : '';
    const checkId = check.check_id || check.bc_check_id || "";
    
    // Create a descriptive label for the check
    const checkLabel = `${severityLabel}${checkId}: ${checkName}`;
    
    const checkItem = new ResultsItem(
      checkLabel,
      vscode.TreeItemCollapsibleState.Collapsed,
      undefined,
      undefined,
      `Result: ${resultStatus}`
    );
    
    // Set icon based on result and severity
    if (resultStatus === "PASSED") {
      checkItem.iconPath = new vscode.ThemeIcon('check');
    } else {
      switch (check.severity?.toUpperCase()) {
        case 'CRITICAL':
          checkItem.iconPath = new vscode.ThemeIcon('error');
          break;
        case 'HIGH':
          checkItem.iconPath = new vscode.ThemeIcon('warning');
          break;
        case 'MEDIUM':
          checkItem.iconPath = new vscode.ThemeIcon('warning');
          break;
        case 'LOW':
          checkItem.iconPath = new vscode.ThemeIcon('info');
          break;
        default:
          checkItem.iconPath = new vscode.ThemeIcon('circle-filled');
      }
    }
    
    // Add details as children
    const details: ResultsItem[] = [];
    
    // Resource information
    if (check.resource) {
      details.push(new ResultsItem(
        `Resource: ${check.resource}`,
        vscode.TreeItemCollapsibleState.None
      ));
    }
    
    // Check results
    if (check.check_result) {
      // Convert the check_result to a more readable format if it's an object
      if (typeof check.check_result === 'object') {
        details.push(new ResultsItem(
          `Result: ${check.check_result.result || 'Unknown'}`,
          vscode.TreeItemCollapsibleState.None
        ));
        
        // Include evaluated keys if available
        if (check.check_result.evaluated_keys && check.check_result.evaluated_keys.length > 0) {
          details.push(new ResultsItem(
            'Evaluated Keys:',
            vscode.TreeItemCollapsibleState.Collapsed
          ));
          
          // Add each evaluated key as a child item
          const keysItem = details[details.length - 1];
          keysItem.children = check.check_result.evaluated_keys.map(key => {
            return new ResultsItem(
              key,
              vscode.TreeItemCollapsibleState.None
            );
          });
        }
      } else {
        details.push(new ResultsItem(
          `Result: ${String(check.check_result)}`,
          vscode.TreeItemCollapsibleState.None
        ));
      }
    }
    
    // Description if available
    if (check.description) {
      details.push(new ResultsItem(
        `Description: ${check.description}`,
        vscode.TreeItemCollapsibleState.None
      ));
    }
    
    // File location
    if (check.file_line_range) {
      const fileLocationItem = new ResultsItem(
        `File: ${check.file_path}:${check.file_line_range[0]}-${check.file_line_range[1]}`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        undefined,
        'niobium-runner.openFileAtLocation'
      );
      
      // Command to open the file at the specified location
      fileLocationItem.command = {
        command: 'niobium-runner.openFileAtLocation',
        title: 'Open File',
        arguments: [check.file_abs_path || check.file_path, check.file_line_range[0], 0]
      };
      
      details.push(fileLocationItem);
    }
    
    // Guideline if available
    if (check.guideline) {
      details.push(new ResultsItem(
        `Guideline: ${check.guideline}`,
        vscode.TreeItemCollapsibleState.None
      ));
    }
    
    // Code block if available as array
    if (Array.isArray(check.code_block) && check.code_block.length > 0) {
      const codeItem = new ResultsItem(
        'Code Block',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      codeItem.children = check.code_block.map((line, index) => {
        // Handle nested arrays which are common in Checkov output
        if (Array.isArray(line) && line.length >= 2) {
          return new ResultsItem(
            `${line[0]}: ${line[1]}`,
            vscode.TreeItemCollapsibleState.None
          );
        } else {
          return new ResultsItem(
            `${index + (check._startline_ || 0)}: ${String(line)}`,
            vscode.TreeItemCollapsibleState.None
          );
        }
      });
      
      details.push(codeItem);
    }
    // Code block if available as object
    else if (check.code_block && typeof check.code_block === 'object') {
      const codeItem = new ResultsItem(
        'Code Block',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      codeItem.children = Object.entries(check.code_block).map(([lineNum, content]) => {
        return new ResultsItem(
          `${lineNum}: ${String(content)}`,
          vscode.TreeItemCollapsibleState.None
        );
      });
      
      details.push(codeItem);
    }
    
    // Add other potentially useful info
    if (check.entity_tags && typeof check.entity_tags === 'object') {
      const tagsItem = new ResultsItem(
        'Entity Tags',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      tagsItem.children = Object.entries(check.entity_tags).map(([key, value]) => {
        return new ResultsItem(
          `${key}: ${String(value)}`,
          vscode.TreeItemCollapsibleState.None
        );
      });
      
      details.push(tagsItem);
    }
    
    checkItem.children = details;
    return checkItem;
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