import * as vscode from 'vscode';
import * as path from 'path';

export interface ActivityItem {
  type: 'success' | 'error' | 'running';
  text: string;
  time: Date;
}

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  
  // Use extension context storage for persistence
  private static _context: vscode.ExtensionContext;
  
  // Track recent activities
  private static _recentActivities: ActivityItem[] = [];
  
  // Track command handlers to ensure they're properly disposed
  private _commandHandlers: Map<string, vscode.Disposable> = new Map();

  private constructor(panel: vscode.WebviewPanel) {
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
          case 'runCommand':
            this.executeWithTracking('runCommand', 'Running command...');
            return;
          case 'runStage':
            this.executeWithTracking('runStage', 'Running stage...');
            return;
          case 'runSequence':
            this.executeWithTracking('runSequence', 'Running sequence...');
            return;
          case 'runContainer':
            this.executeWithTracking('runContainer', 'Starting container...');
            return;
          case 'refresh':
            this._update();
            return;
          case 'clear':
            vscode.commands.executeCommand('bluewasp-runner.clearActivities');
            return;
        }
      },
      null,
      this._disposables
    );
  }

  /**
   * Initialize the dashboard panel with the extension context
   */
  public static initialize(context: vscode.ExtensionContext) {
    DashboardPanel._context = context;
    
    // Load persisted activities from storage
    this._loadActivities();
    
    // Register global state update handler for tracking activities
    // This ensures activities are tracked even when the dashboard is closed
    context.subscriptions.push(
      vscode.commands.registerCommand('bluewasp-runner.trackActivity', 
        (type: 'success' | 'error' | 'running', text: string) => {
          this.addActivity({
            type,
            text,
            time: new Date()
          });
        }
      )
    );
  }

  /**
   * Execute a command with activity tracking
   */
  private async executeWithTracking(commandId: string, activityText: string) {
    try {
      // Add running activity
      DashboardPanel.addActivity({
        type: 'running',
        text: activityText,
        time: new Date()
      });
      
      // Refresh UI immediately to show running state
      this._update();
      
      // Map our simplified command IDs to the actual extension commands
      const commandMap: Record<string, string> = {
        'runCommand': 'run',
        'runStage': 'runStage',
        'runSequence': 'runSequence',
        'runContainer': 'runContainer'
      };
      
      // Get the actual command ID
      const actualCommandId = commandMap[commandId] || commandId;
      
      // Clean up any existing handler for this command
      const existingHandler = this._commandHandlers.get(`${commandId}.complete`);
      if (existingHandler) {
        existingHandler.dispose();
        this._commandHandlers.delete(`${commandId}.complete`);
      }
      
      // Create a disposable to listen for the command completion
      const resultHandler = vscode.commands.registerCommand(`${commandId}.complete`, (success: boolean, resultMessage: string) => {
        try {
          // Record the result
          DashboardPanel.addActivity({
            type: success ? 'success' : 'error',
            text: resultMessage,
            time: new Date()
          });
          
          // Refresh UI if panel exists
          if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._update();
          }
        } catch (error) {
          console.error('Error in command completion handler:', error);
        } finally {
          // Always clean up the handler
          if (this._commandHandlers.has(`${commandId}.complete`)) {
            this._commandHandlers.get(`${commandId}.complete`)?.dispose();
            this._commandHandlers.delete(`${commandId}.complete`);
          }
        }
      });
      
      // Store the handler for later cleanup
      this._commandHandlers.set(`${commandId}.complete`, resultHandler);
      
      // Execute the actual command - don't block the UI
      vscode.commands.executeCommand(`bluewasp-runner.${actualCommandId}`);
    } catch (error) {
      // Handle any errors
      console.error('Error in executeWithTracking:', error);
      
      DashboardPanel.addActivity({
        type: 'error',
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        time: new Date()
      });
    }
  }

  /**
   * Add activity to recent activities list
   */
  public static addActivity(activity: ActivityItem) {
    // Add to beginning of array
    this._recentActivities.unshift(activity);
    
    // Keep only the most recent 20 activities
    if (this._recentActivities.length > 20) {
      this._recentActivities = this._recentActivities.slice(0, 20);
    }
    
    // Save activities to persistence
    this._saveActivities();
    
    // Refresh the panel if it exists
    if (this.currentPanel) {
      try {
        this.currentPanel._update();
      } catch (error) {
        console.error('Error updating dashboard after activity:', error);
        // If the panel was disposed, reset the reference
        if (error instanceof Error && error.message.includes('disposed')) {
          this.currentPanel = undefined;
        }
      }
    }
  }

  /**
   * Save activities to persistent storage
   */
  private static _saveActivities() {
    if (this._context) {
      // Convert dates to strings for storage
      const activitiesToStore = this._recentActivities.map(activity => ({
        ...activity,
        time: activity.time.toISOString()
      }));
      
      this._context.globalState.update('bluewasp.activities', activitiesToStore);
    }
  }

  /**
   * Load activities from persistent storage
   */
  private static _loadActivities() {
    if (this._context) {
      const storedActivities = this._context.globalState.get<any[]>('bluewasp.activities', []);
      
      // Convert stored activities back to our format
      this._recentActivities = storedActivities.map(activity => ({
        ...activity,
        time: new Date(activity.time)
      }));
    }
  }

  /**
   * Create or show the dashboard panel
   */
  public static show(context: vscode.ExtensionContext): DashboardPanel | undefined {
    try {
      // Initialize if not already done
      if (!this._context) {
        this.initialize(context);
      }
      
      const column = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

      // If we already have a panel, show it
      if (DashboardPanel.currentPanel) {
        try {
          DashboardPanel.currentPanel._panel.reveal(column);
          return DashboardPanel.currentPanel;
        } catch (error) {
          // If reveal fails due to disposal, create a new panel
          console.error('Error revealing panel:', error);
          DashboardPanel.currentPanel = undefined;
        }
      }

      // Otherwise, create a new panel
      const panel = vscode.window.createWebviewPanel(
        'bluewaspDashboard',
        'Blue Wasp Dashboard',
        column || vscode.ViewColumn.One,
        {
          // Enable JavaScript in the webview
          enableScripts: true,
          retainContextWhenHidden: true,
          
          // Restrict the webview to only load resources from the `media` directory
          localResourceRoots: [
            vscode.Uri.file(path.join(context.extensionPath, 'media'))
          ]
        }
      );

      DashboardPanel.currentPanel = new DashboardPanel(panel);
      return DashboardPanel.currentPanel;
    } catch (error) {
      console.error('Error creating dashboard panel:', error);
      return undefined;
    }
  }

  /**
   * Force refresh the dashboard panel
   */
  public static refresh() {
    if (this.currentPanel) {
      this.currentPanel._update();
    }
  }

  /**
   * Clear all activity history
   */
  public static clearActivities() {
    this._recentActivities = [];
    this._saveActivities();
    
    if (this.currentPanel) {
      this.currentPanel._update();
    }
  }

  // Clean up resources
  public dispose() {
    DashboardPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    // Dispose all command handlers
    for (const handler of this._commandHandlers.values()) {
      handler.dispose();
    }
    this._commandHandlers.clear();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  // Update the webview content
  private _update() {
    try {
      // Check if panel still exists and is visible
      if (!this._panel || !this._panel.visible) {
        return;
      }
      
      this._panel.title = 'Blue Wasp Dashboard';
      this._panel.webview.html = this._getHtmlForWebview();
    } catch (error) {
      console.error('Error updating dashboard webview:', error);
      // If we get a disposed error, remove the current panel reference
      if (error instanceof Error && error.message.includes('disposed')) {
        DashboardPanel.currentPanel = undefined;
      }
    }
  }

  // Generate the HTML for the webview
  private _getHtmlForWebview(): string {
    // Generate recent activities HTML
    let activitiesHtml = '';
    if (DashboardPanel._recentActivities.length === 0) {
      activitiesHtml = `
        <div class="activity-item">
          <div class="activity-text">No recent activities</div>
        </div>
      `;
    } else {
      for (const activity of DashboardPanel._recentActivities) {
        const icon = activity.type === 'success' ? '✅' : 
                    activity.type === 'error' ? '❌' : '⏳';
        const timeAgo = this._getTimeAgo(activity.time);
        
        activitiesHtml += `
          <div class="activity-item">
            <div class="activity-icon ${activity.type}">${icon}</div>
            <div class="activity-text">${this._escapeHtml(activity.text)}</div>
            <div class="activity-time">${timeAgo}</div>
          </div>
        `;
      }
    }

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Blue Wasp Dashboard</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
          }
          
          .dashboard {
            max-width: 100%;
            margin: 0 auto;
          }
          
          .header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
          }
          
          .logo {
            font-size: 24px;
            margin-right: 10px;
            color: #3794ff;
          }
          
          .title {
            font-size: 20px;
            font-weight: bold;
          }
          
          .subtitle {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 20px;
          }
          
          .card-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 16px;
            margin-bottom: 30px;
          }
          
          .card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            padding: 16px;
            cursor: pointer;
            transition: transform 0.2s, background-color 0.2s;
            border: 1px solid var(--vscode-panel-border);
            height: 130px;
            display: flex;
            flex-direction: column;
          }
          
          .card:hover {
            transform: translateY(-5px);
            background-color: var(--vscode-list-hoverBackground);
          }
          
          .card-icon {
            font-size: 18px;
            margin-bottom: 10px;
          }
          
          .card-title {
            font-weight: bold;
            margin-bottom: 8px;
          }
          
          .card-description {
            font-size: 12px;
            flex-grow: 1;
            color: var(--vscode-descriptionForeground);
          }
          
          .section-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          
          .recent-activity {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            max-height: 600px;
            overflow-y: auto;
          }
          
          .activity-item {
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
          }
          
          .activity-icon {
            margin-right: 8px;
          }
          
          .activity-text {
            flex-grow: 1;
          }
          
          .activity-time {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
          }
          
          .success {
            color: #89d185;
          }
          
          .error {
            color: #f14c4c;
          }
          
          .running {
            color: #3794ff;
          }
          
          .action-buttons {
            display: flex;
            justify-content: flex-end;
            margin-top: -30px;
          }
          
          .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 8px;
          }
          
          .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          
          .btn-danger {
            background-color: #f14c4c;
          }
          
          .btn-danger:hover {
            background-color: #e13c3c;
          }
        </style>
      </head>
      <body>
        <div class="dashboard">
          <div class="header">
            <div class="logo">🐝</div>
            <div class="title">Blue Wasp Dashboard</div>
          </div>
          
          <div class="subtitle">Manage your commands, stages, sequences and Docker containers</div>
          
          <div class="section-title">Quick Actions</div>
          <div class="card-container">
            <div class="card" onclick="sendCommand('runCommand')">
              <div class="card-icon">▶️</div>
              <div class="card-title">Run Command</div>
              <div class="card-description">Execute a single command defined in your configuration</div>
            </div>
            
            <div class="card" onclick="sendCommand('runStage')">
              <div class="card-icon">🔄</div>
              <div class="card-title">Run Stage</div>
              <div class="card-description">Run a group of commands organized as a stage</div>
            </div>
            
            <div class="card" onclick="sendCommand('runSequence')">
              <div class="card-icon">📋</div>
              <div class="card-title">Run Sequence</div>
              <div class="card-description">Execute a sequence of stages in order</div>
            </div>
            
            <div class="card" onclick="sendCommand('runContainer')">
              <div class="card-icon">🐳</div>
              <div class="card-title">Start Container</div>
              <div class="card-description">Start a Docker container from your configuration</div>
            </div>
          </div>
          
          <div class="section-title">
            Recent Activity
            <div class="action-buttons">
              <button class="btn" onclick="sendCommand('refresh')">Refresh</button>
              <button class="btn btn-danger" onclick="sendCommand('clear')">Clear History</button>
            </div>
          </div>
          <div class="recent-activity">
            ${activitiesHtml}
          </div>
        </div>
        
        <script>
          // Function to send messages to the extension
          function sendCommand(command) {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: command });
          }
          
          // Auto-refresh every 5 seconds
          const refreshInterval = setInterval(() => {
            try {
              sendCommand('refresh');
            } catch (err) {
              // If an error occurs (like the webview being disposed), clear the interval
              clearInterval(refreshInterval);
            }
          }, 5000);
          
          // Handle page unload
          window.addEventListener('unload', () => {
            clearInterval(refreshInterval);
          });
        </script>
      </body>
      </html>
    `;
  }
  
  // Helper method to format time ago
  private _getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) {
      return `${diffSec}s ago`;
    }
    
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
      return `${diffHour}h ago`;
    }
    
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  }
  
  // Helper to escape HTML
  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
} 