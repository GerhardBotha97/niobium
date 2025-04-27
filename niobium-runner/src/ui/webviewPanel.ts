import * as vscode from 'vscode';
import * as path from 'path';

export interface JobOutput {
  id: string;
  type: 'command' | 'stage' | 'sequence';
  name: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  startTime: Date;
  endTime?: Date;
  output: string;
  error?: string;
  exitCode?: number;
  children?: JobOutput[];
  description?: string;
  command?: string;
  allowFailure?: boolean;
  pid?: number;           // Process ID
  childPids?: number[];   // Child process IDs
  ports?: number[];       // Ports used by this process
}

export class NiobiumPanel {
  public static currentPanel: NiobiumPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _jobs: JobOutput[] = [];

  // Event emitter for kill job events
  private _onKillJobEmitter = new vscode.EventEmitter<string>();
  public readonly onKillJob = this._onKillJobEmitter.event;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    
    // Set the webview's initial html content
    this._update();
    
    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    // Update the content based on view changes
    this._panel.onDidChangeViewState(
      e => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );
    
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'toggleCollapse':
            // Handle toggling collapse state
            break;
          case 'killJob':
            // Handle kill job request
            this._onKillJob(message.jobId);
            break;
          case 'clearJobs':
            // Handle clear jobs request
            this.clearJobs();
            break;
        }
      },
      null,
      this._disposables
    );
  }
  
  // Create or show panel
  public static createOrShow(extensionUri: vscode.Uri): NiobiumPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    
    // If we already have a panel, show it
    if (NiobiumPanel.currentPanel) {
      NiobiumPanel.currentPanel._panel.reveal(column);
      return NiobiumPanel.currentPanel;
    }
    
    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'niobiumPanel',
      'Niobium Runner',
      column || vscode.ViewColumn.One,
      {
        // Enable JavaScript in the webview
        enableScripts: true,
        
        // Restrict the webview to only load resources from the extension's directory
        localResourceRoots: [extensionUri]
      }
    );
    
    NiobiumPanel.currentPanel = new NiobiumPanel(panel, extensionUri);
    return NiobiumPanel.currentPanel;
  }
  
  // Public method to reveal the panel
  public reveal(): void {
    this._panel.reveal();
  }
  
  // Add a job to display
  public addJob(job: JobOutput): void {
    this._jobs.push(job);
    
    try {
      this._update();
    } catch (error) {
      console.error('Error adding job to webview:', error);
      // If updating fails, the webview might be disposed
    }
  }
  
  // Update an existing job
  public updateJob(jobId: string, updates: Partial<JobOutput>): void {
    const updateJobRecursive = (jobs: JobOutput[]): boolean => {
      for (let i = 0; i < jobs.length; i++) {
        if (jobs[i].id === jobId) {
          // Check if this is a status change from running to something else
          const statusChanged = updates.status && jobs[i].status === 'running' && updates.status !== 'running';
          
          // Apply updates
          jobs[i] = { ...jobs[i], ...updates };
          
          // The JobOutput status update has been applied, now refresh the UI
          // Always do a full refresh when status changes to ensure stop button is removed
          this._update();
          
          // If this is a status change, do an additional update after a short delay
          // to ensure UI components like kill buttons are properly updated
          if (statusChanged) {
            setTimeout(() => {
              try {
                this._update();
              } catch (error) {
                console.error('Error in delayed update after status change:', error);
              }
            }, 100);
          }
          
          return true;
        }
        
        // Check children if they exist
        const children = jobs[i].children || [];
        if (children.length > 0) {
          if (updateJobRecursive(children)) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    updateJobRecursive(this._jobs);
  }
  
  // Clear all jobs
  public clearJobs(): void {
    this._jobs = [];
    
    try {
      this._update();
    } catch (error) {
      console.error('Error clearing jobs in webview:', error);
      // If updating fails, the webview might be disposed
    }
  }
  
  // Dispose all resources
  public dispose(): void {
    NiobiumPanel.currentPanel = undefined;
    
    // Clean up resources
    try {
      this._panel.dispose();
    } catch (error) {
      // Ignore errors when disposing the panel as it might already be disposed
      console.debug('Error while disposing panel:', error);
    }
    
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        try {
          disposable.dispose();
        } catch (error) {
          // Ignore errors when disposing resources
          console.debug('Error while disposing resource:', error);
        }
      }
    }
  }
  
  // Generate the status icon based on job status
  private _getStatusIcon(status: JobOutput['status']): string {
    switch (status) {
      case 'running':
        return '⏳';
      case 'success':
        return '✅';
      case 'failed':
        return '❌';
      case 'skipped':
        return '⏭️';
      default:
        return '⚪';
    }
  }
  
  // Generate HTML for a job
  private _generateJobHtml(job: JobOutput, level = 0): string {
    const statusIcon = this._getStatusIcon(job.status);
    const indent = '  '.repeat(level);
    const jobTypeClass = `job-${job.type}`;
    const jobStatusClass = `status-${job.status}`;
    const executionTime = job.endTime 
      ? ((job.endTime.getTime() - job.startTime.getTime()) / 1000).toFixed(2) + 's'
      : '';
    const allowFailureTag = job.allowFailure ? '<span class="allow-failure">Allow Failure</span>' : '';
    
    // Create a display name that removes the "niobium-" prefix only for Docker jobs
    // We identify Docker jobs as command-type jobs with the "niobium-" prefix
    let displayName = job.name;
    if (job.type === 'command' && job.name.startsWith('niobium-')) {
      displayName = job.name.substring('niobium-'.length);
    }
    
    // Add kill button only for running jobs - make sure job.status is accurately checked
    const isRunning = job.status === 'running';
    const killButton = isRunning
      ? `<button class="kill-button" onclick="event.stopPropagation(); killJob('${job.id}')">⏹ Stop</button>` 
      : '';
    
    // Process info for debugging
    const pidInfo = job.pid 
      ? `<span class="pid-info" title="Process ID and ports">PID: ${job.pid}${job.ports?.length ? ` (Ports: ${job.ports.join(', ')})` : ''}</span>` 
      : '';
    
    let html = `
      <div class="job ${jobTypeClass} ${jobStatusClass}" data-id="${job.id}" data-status="${job.status}">
        <div class="job-header" onclick="toggleJob('${job.id}')">
          <span class="status-icon">${statusIcon}</span>
          <span class="job-type">${job.type.toUpperCase()}</span>
          <span class="job-name">${displayName}</span>
          ${allowFailureTag}
          <span class="job-time">${executionTime}</span>
          ${pidInfo}
          ${killButton}
          <span class="collapse-icon">▼</span>
        </div>
        <div class="job-details" id="details-${job.id}">
    `;
    
    // Add job details
    if (job.description) {
      html += `<div class="job-description">${job.description}</div>`;
    }
    
    if (job.command) {
      html += `<div class="job-command"><code>${job.command}</code></div>`;
    }
    
    // Add output
    if (job.output) {
      html += `
        <div class="output-section">
          <div class="output-header" onclick="toggleOutput('output-${job.id}')">
            <span>Output</span>
            <span class="collapse-icon">▼</span>
          </div>
          <pre class="output-content" id="output-${job.id}">${this._escapeHtml(job.output)}</pre>
        </div>
      `;
    }
    
    // Add error if present
    if (job.error) {
      html += `
        <div class="error-section">
          <div class="error-header" onclick="toggleOutput('error-${job.id}')">
            <span>Error</span>
            <span class="collapse-icon">▼</span>
          </div>
          <pre class="error-content" id="error-${job.id}">${this._escapeHtml(job.error)}</pre>
        </div>
      `;
    }
    
    // Add children jobs
    const children = job.children || [];
    if (children.length > 0) {
      html += `<div class="children-jobs">`;
      for (const child of children) {
        html += this._generateJobHtml(child, level + 1);
      }
      html += `</div>`;
    }
    
    html += `
        </div>
      </div>
    `;
    
    return html;
  }
  
  // Escape HTML to prevent XSS
  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  
  // Public method to trigger a full refresh of the webview content
  public refresh(): void {
    this._update();
  }
  
  // Update the webview content
  private _update(): void {
    if (!this._panel.visible) {
      return;
    }
    
    try {
      this._panel.title = 'Niobium Runner';
      this._panel.webview.html = this._getHtmlForWebview();
    } catch (error) {
      console.error('Error updating webview:', error);
      // If we catch an error here, the webview may have been disposed
      // Attempt to clean up our references
      this.dispose();
    }
  }
  
  // Generate the full HTML for the webview
  private _getHtmlForWebview(): string {
    // Create jobs HTML
    let jobsHtml = '';
    for (const job of this._jobs) {
      jobsHtml += this._generateJobHtml(job);
    }
    
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Niobium Runner</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
          }
          
          .job {
            margin: 10px 0;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            overflow: hidden;
          }
          
          .job-header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            cursor: pointer;
            position: relative;
          }
          
          .job-header:hover {
            background-color: var(--vscode-list-hoverBackground);
          }
          
          .job-type {
            font-weight: bold;
            font-size: 0.8em;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            margin-right: 8px;
          }
          
          .job-name {
            flex-grow: 1;
            font-weight: bold;
          }
          
          .job-time {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            margin-right: 8px;
          }
          
          .pid-info {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            background-color: var(--vscode-editor-inlineValuesBackground);
            padding: 2px 6px;
            border-radius: 3px;
            margin-right: 8px;
            font-family: monospace;
          }
          
          .status-icon {
            margin-right: 8px;
          }
          
          .collapse-icon {
            font-size: 0.8em;
          }
          
          .kill-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 2px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8em;
            margin-right: 8px;
          }
          
          .kill-button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          
          .job-details {
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
          }
          
          .job-description {
            margin-bottom: 8px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
          }
          
          .job-command {
            margin-bottom: 8px;
            background-color: var(--vscode-terminal-background);
            padding: 8px;
            border-radius: 3px;
            overflow-x: auto;
          }
          
          .output-section, .error-section {
            margin-top: 10px;
          }
          
          .output-header, .error-header {
            display: flex;
            justify-content: space-between;
            background-color: var(--vscode-editor-lineHighlightBackground);
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px 3px 0 0;
          }
          
          .output-content, .error-content {
            margin: 0;
            padding: 8px;
            background-color: var(--vscode-terminal-background);
            color: var(--vscode-terminal-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            overflow-x: auto;
            border-radius: 0 0 3px 3px;
          }
          
          .error-content {
            color: var(--vscode-errorForeground);
          }
          
          .children-jobs {
            margin-left: 20px;
            margin-top: 10px;
            border-left: 1px dashed var(--vscode-panel-border);
            padding-left: 10px;
          }
          
          .allow-failure {
            font-size: 0.7em;
            background-color: var(--vscode-statusBarItem-warningBackground);
            color: var(--vscode-statusBarItem-warningForeground);
            padding: 2px 4px;
            border-radius: 3px;
            margin-right: 8px;
          }
          
          .container {
            padding: 10px;
          }
          
          .jobs-container {
            margin-top: 10px;
          }
          
          .no-jobs {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
            text-align: center;
          }
          
          .toolbar {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
          }
          
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 10px;
            cursor: pointer;
            border-radius: 3px;
          }
          
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          
          /* Status styling */
          .status-running .job-header {
            border-left: 4px solid #3794ff;
          }
          
          .status-success .job-header {
            border-left: 4px solid #89d185;
          }
          
          .status-failed .job-header {
            border-left: 4px solid #f14c4c;
          }
          
          .status-skipped .job-header {
            border-left: 4px solid #cca700;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="actions-toolbar">
            <button class="action-button" onclick="clearJobs()">Clear Jobs</button>
          </div>
          <div class="jobs-container">
${jobsHtml.length > 0 ? jobsHtml : '<div class="no-jobs">No jobs to display</div>'}
          </div>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function clearJobs() {
            vscode.postMessage({
              command: 'clearJobs'
            });
          }
          
          function toggleJob(id) {
            const details = document.getElementById('details-' + id);
            const header = details.previousElementSibling;
            const collapseIcon = header.querySelector('.collapse-icon');
            
            if (details.style.display === 'none') {
              details.style.display = 'block';
              collapseIcon.textContent = '▼';
            } else {
              details.style.display = 'none';
              collapseIcon.textContent = '▶';
            }
            
            // Notify the extension
            vscode.postMessage({
              command: 'toggleCollapse',
              jobId: id
            });
          }
          
          function killJob(id) {
            // Notify the extension to kill the job
            vscode.postMessage({
              command: 'killJob',
              jobId: id
            });
            
            // Disable the button to prevent multiple clicks
            const buttons = document.querySelectorAll('.job[data-id="' + id + '"] .kill-button');
            buttons.forEach(button => {
              button.disabled = true;
              button.textContent = "Stopping...";
            });
          }
          
          function toggleOutput(id) {
            const output = document.getElementById(id);
            const header = output.previousElementSibling;
            const collapseIcon = header.querySelector('.collapse-icon');
            
            if (output.style.display === 'none') {
              output.style.display = 'block';
              collapseIcon.textContent = '▼';
            } else {
              output.style.display = 'none';
              collapseIcon.textContent = '▶';
            }
          }
          
          // Initialize all job details as expanded
          document.addEventListener('DOMContentLoaded', function() {
            // Your initialization code here
          });
        </script>
      </body>
      </html>
    `;
  }

  private _onKillJob(jobId: string): void {
    this._onKillJobEmitter.fire(jobId);
  }
} 