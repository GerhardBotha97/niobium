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
          case 'runAll':
            vscode.commands.executeCommand('niobium-runner.runAll');
            return;
          case 'refresh':
            this._update();
            return;
          case 'clear':
            vscode.commands.executeCommand('niobium-runner.clearActivities');
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
      vscode.commands.registerCommand('niobium-runner.trackActivity', 
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
      vscode.commands.executeCommand(`niobium-runner.${actualCommandId}`);
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
      
      this._context.globalState.update('niobium.activities', activitiesToStore);
    }
  }

  /**
   * Load activities from persistent storage
   */
  private static _loadActivities() {
    if (this._context) {
      const storedActivities = this._context.globalState.get<any[]>('niobium.activities', []);
      
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
        'niobiumDashboard',
        'Niobium Dashboard',
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
      
      this._panel.title = 'Niobium Dashboard';
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
    // Get the URI for the wasp-icon.svg
    const waspIconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(DashboardPanel._context.extensionPath, 'media', 'wasp-icon.svg'))
    );
    
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
        <title>Niobium Dashboard</title>
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
            background: linear-gradient(135deg, #3794ff, #45aaf2);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            position: relative;
          }
          
          .logo-wasp {
            position: relative;
            width: 36px;
            height: 36px;
            margin-right: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .logo-wasp img {
            width: 100%;
            height: 100%;
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
          
          .card-title {
            font-weight: bold;
            margin-bottom: 8px;
            font-size: 16px;
          }
          
          .card-description {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            flex-grow: 1;
          }
          
          .card-icon {
            font-size: 24px;
            margin-bottom: 12px;
            color: #3794ff;
          }
          
          .activity-section {
            margin-top: 20px;
          }
          
          .activity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
          }
          
          .activity-title {
            font-size: 18px;
            font-weight: bold;
          }
          
          .activity-actions {
            display: flex;
            gap: 8px;
          }
          
          .activity-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
          }
          
          .activity-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
          
          .activity-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 400px;
            overflow-y: auto;
            padding-right: 10px;
          }
          
          .activity-item {
            display: flex;
            align-items: center;
            padding: 8px;
            border-radius: 4px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-left: 3px solid transparent;
          }
          
          .activity-item:hover {
            background-color: var(--vscode-list-hoverBackground);
          }
          
          .activity-icon {
            margin-right: 10px;
            font-size: 16px;
          }
          
          .activity-icon.success {
            color: #4caf50;
          }
          
          .activity-icon.error {
            color: #f44336;
          }
          
          .activity-icon.running {
            color: #2196f3;
          }
          
          .activity-text {
            flex-grow: 1;
            font-size: 14px;
          }
          
          .activity-time {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-left: 10px;
          }
          
          .wasp-badge {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(135deg, #7F8C8D, #5D6D7E);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
            cursor: pointer;
            transition: transform 0.2s;
            z-index: 999;
          }
          
          .wasp-badge:hover {
            transform: scale(1.1);
            background: linear-gradient(135deg, #5D6D7E, #2C3E50);
          }
          
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }
          
          .pulse {
            animation: pulse 2s infinite;
          }
        </style>
      </head>
      <body>
        <div class="dashboard">
          <div class="header">
            <div class="logo-wasp">
              <img src="${waspIconUri}" alt="Niobium Wasp Icon" />
            </div>
            <div>
              <div class="title">Niobium Dashboard</div>
              <div class="subtitle">Run tasks, view activities, and manage Docker containers</div>
            </div>
          </div>
          
          <div class="card-container">
            <div class="card" onclick="runCommand()">
              <div class="card-icon">⚡</div>
              <div class="card-title">Run Command</div>
              <div class="card-description">Execute individual commands defined in your configuration</div>
            </div>
            
            <div class="card" onclick="runStage()">
              <div class="card-icon">🔄</div>
              <div class="card-title">Run Stage</div>
              <div class="card-description">Execute a group of commands as a stage</div>
            </div>
            
            <div class="card" onclick="runSequence()">
              <div class="card-icon">📋</div>
              <div class="card-title">Run Sequence</div>
              <div class="card-description">Execute a sequence of stages in order</div>
            </div>
            
            <div class="card" onclick="runContainer()">
              <div class="card-icon">🐋</div>
              <div class="card-title">Run Container</div>
              <div class="card-description">Start and manage Docker containers</div>
            </div>
          </div>
          
          <div class="activity-section">
            <div class="activity-header">
              <div class="activity-title">Recent Activities</div>
              <div class="activity-actions">
                <button class="activity-button" onclick="refresh()">Refresh</button>
                <button class="activity-button" onclick="clearActivities()">Clear All</button>
              </div>
            </div>
            
            <div class="activity-list">
              ${activitiesHtml}
            </div>
          </div>
        </div>
        
        <div class="wasp-badge pulse" title="Quick access to Niobium actions">
          <img src="${waspIconUri}" alt="Niobium Wasp Icon" width="24" height="24" />
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          
          function runCommand() {
            vscode.postMessage({ command: 'runCommand' });
          }
          
          function runStage() {
            vscode.postMessage({ command: 'runStage' });
          }
          
          function runSequence() {
            vscode.postMessage({ command: 'runSequence' });
          }
          
          function runContainer() {
            vscode.postMessage({ command: 'runContainer' });
          }
          
          function refresh() {
            vscode.postMessage({ command: 'refresh' });
          }
          
          function clearActivities() {
            vscode.postMessage({ command: 'clear' });
          }
          
          // Badge popup menu
          document.querySelector('.wasp-badge').addEventListener('click', function() {
            // Toggle popup menu
            vscode.postMessage({ command: 'runAll' });
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