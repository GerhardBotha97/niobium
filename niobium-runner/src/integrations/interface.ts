import * as vscode from 'vscode';
import { ResultsItem } from '../views/resultsTreeView';

/**
 * Interface for tool result parsers
 */
export interface ToolIntegration {
  /**
   * Unique identifier for the tool
   */
  id: string;
  
  /**
   * Display name of the tool
   */
  name: string;
  
  /**
   * File extensions this integration can handle
   */
  supportedFileExtensions: string[];
  
  /**
   * Parse the raw JSON data and return tree items for display
   */
  parseResults(data: any, filePath: string, filename: string): ResultsItem[];
  
  /**
   * Determines if this integration can handle the given file
   */
  canHandle(filename: string, data: any): boolean;
} 