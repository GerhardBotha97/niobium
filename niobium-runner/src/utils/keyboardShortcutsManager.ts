import * as vscode from 'vscode';

/**
 * Interface for keyboard shortcut configuration
 */
export interface KeyboardShortcut {
  key: string;
  mac?: string;
  when?: string;
}

/**
 * Interface for the keyboard shortcuts configuration
 */
export interface KeyboardShortcutsConfig {
  runCommand: KeyboardShortcut;
  runStage: KeyboardShortcut;
  runSequence: KeyboardShortcut;
  showOutput: KeyboardShortcut;
  showDashboard: KeyboardShortcut; 
  runContainer: KeyboardShortcut;
  refreshViews: KeyboardShortcut;
  showKeyboardShortcuts: KeyboardShortcut;
}

/**
 * Command mapping for keyboard shortcuts
 */
const COMMAND_MAPPING = {
  runCommand: 'niobium-runner.run',
  runStage: 'niobium-runner.runStage',
  runSequence: 'niobium-runner.runSequence',
  showOutput: 'niobium-runner.showOutput',
  showDashboard: 'niobium-runner.showDashboard',
  runContainer: 'niobium-runner.runContainer',
  refreshViews: 'niobium-runner.refreshViews',
  showKeyboardShortcuts: 'niobium-runner.showKeyboardShortcuts'
};

/**
 * Default when clauses for commands
 */
const DEFAULT_WHEN_CLAUSES = {
  runCommand: 'editorTextFocus',
  runStage: 'editorTextFocus',
  runSequence: 'editorTextFocus',
  showOutput: 'editorTextFocus',
  showDashboard: 'editorTextFocus',
  runContainer: 'editorTextFocus',
  refreshViews: 'viewFocus && view =~ /niobium-/',
  showKeyboardShortcuts: 'editorTextFocus'
};

/**
 * Singleton class to manage keyboard shortcuts
 */
export class KeyboardShortcutsManager {
  private static instance: KeyboardShortcutsManager;
  private context: vscode.ExtensionContext | undefined;
  private currentPackageJson: any | undefined;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): KeyboardShortcutsManager {
    if (!KeyboardShortcutsManager.instance) {
      KeyboardShortcutsManager.instance = new KeyboardShortcutsManager();
    }
    return KeyboardShortcutsManager.instance;
  }

  /**
   * Initialize the keyboard shortcuts manager
   * @param context Extension context
   */
  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
    
    // Check if we need to sync the keyboard shortcuts with configuration
    const shouldSync = context.globalState.get('niobium.shouldSyncKeybindings', true);
    if (shouldSync) {
      this.syncKeyboardShortcuts().catch(error => {
        console.error('Error syncing keyboard shortcuts:', error);
      });
      
      // Set flag to false so we don't sync on every activation unless needed
      context.globalState.update('niobium.shouldSyncKeybindings', false);
    }
  }

  /**
   * Synchronize keyboard shortcuts from configuration to VSCode keybindings
   */
  public async syncKeyboardShortcuts(): Promise<void> {
    try {
      const shortcuts = this.getKeyboardShortcutsConfig();
      
      // Apply each shortcut to VSCode keybindings
      for (const [commandId, shortcut] of Object.entries(shortcuts)) {
        try {
          await this.updateVSCodeKeybindings(commandId as keyof KeyboardShortcutsConfig, shortcut);
        } catch (error) {
          console.error(`Error setting keybinding for ${commandId}:`, error);
        }
      }
      
      // No notification needed during initialization
    } catch (error) {
      console.error('Error syncing keyboard shortcuts:', error);
    }
  }

  /**
   * Get the current keyboard shortcuts configuration
   * @returns The keyboard shortcuts configuration
   */
  public getKeyboardShortcutsConfig(): KeyboardShortcutsConfig {
    const config = vscode.workspace.getConfiguration('niobium-runner');
    const shortcuts = config.get<KeyboardShortcutsConfig>('keyboardShortcuts');
    
    if (!shortcuts) {
      return this.getDefaultKeyboardShortcuts();
    }
    
    // Fill in any missing shortcuts with defaults
    const defaultShortcuts = this.getDefaultKeyboardShortcuts();
    
    return {
      runCommand: shortcuts.runCommand || defaultShortcuts.runCommand,
      runStage: shortcuts.runStage || defaultShortcuts.runStage,
      runSequence: shortcuts.runSequence || defaultShortcuts.runSequence,
      showOutput: shortcuts.showOutput || defaultShortcuts.showOutput,
      showDashboard: shortcuts.showDashboard || defaultShortcuts.showDashboard,
      runContainer: shortcuts.runContainer || defaultShortcuts.runContainer,
      refreshViews: shortcuts.refreshViews || defaultShortcuts.refreshViews,
      showKeyboardShortcuts: shortcuts.showKeyboardShortcuts || defaultShortcuts.showKeyboardShortcuts
    };
  }

  /**
   * Get default keyboard shortcuts configuration
   * @returns Default keyboard shortcuts
   */
  private getDefaultKeyboardShortcuts(): KeyboardShortcutsConfig {
    return {
      runCommand: { key: 'ctrl+shift+r', mac: 'cmd+shift+r', when: DEFAULT_WHEN_CLAUSES.runCommand },
      runStage: { key: 'ctrl+shift+s', mac: 'cmd+shift+s', when: DEFAULT_WHEN_CLAUSES.runStage },
      runSequence: { key: 'ctrl+shift+q', mac: 'cmd+shift+q', when: DEFAULT_WHEN_CLAUSES.runSequence },
      showOutput: { key: 'ctrl+shift+o', mac: 'cmd+shift+o', when: DEFAULT_WHEN_CLAUSES.showOutput },
      showDashboard: { key: 'ctrl+shift+d', mac: 'cmd+shift+d', when: DEFAULT_WHEN_CLAUSES.showDashboard },
      runContainer: { key: 'ctrl+shift+c', mac: 'cmd+shift+c', when: DEFAULT_WHEN_CLAUSES.runContainer },
      refreshViews: { key: 'ctrl+shift+f5', mac: 'cmd+shift+f5', when: DEFAULT_WHEN_CLAUSES.refreshViews },
      showKeyboardShortcuts: { key: 'ctrl+shift+k', mac: 'cmd+shift+k', when: DEFAULT_WHEN_CLAUSES.showKeyboardShortcuts }
    };
  }

  /**
   * Update a keyboard shortcut
   * @param commandId The command ID to update
   * @param shortcut The new keyboard shortcut
   */
  public async updateKeyboardShortcut(commandId: keyof KeyboardShortcutsConfig, shortcut: KeyboardShortcut): Promise<void> {
    // Step 1: Update the stored configuration
    const config = vscode.workspace.getConfiguration('niobium-runner');
    const shortcuts = this.getKeyboardShortcutsConfig();
    
    shortcuts[commandId] = shortcut;
    
    await config.update('keyboardShortcuts', shortcuts, vscode.ConfigurationTarget.Global);
    
    // Step 2: Update VSCode keybindings.json
    await this.updateVSCodeKeybindings(commandId, shortcut);
    
    // Notify the user that the changes have been applied
    vscode.window.showInformationMessage(`Keyboard shortcut for ${this.getCommandDisplayName(commandId)} updated.`);
  }

  /**
   * Update VSCode's keybindings.json file directly for the specified command
   * @param commandId The command ID to update
   * @param shortcut The new keyboard shortcut
   */
  private async updateVSCodeKeybindings(commandId: keyof KeyboardShortcutsConfig, shortcut: KeyboardShortcut): Promise<void> {
    try {
      // Get the VSCode command ID for the shortcut
      const vsCodeCommandId = this.getVSCodeCommandId(commandId);
      
      // Open the keybindings configuration
      await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
      
      // Get the active editor (which should now be the keybindings.json file)
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        throw new Error('Could not open keybindings.json');
      }
      
      // Read the content of the file
      const document = editor.document;
      const text = document.getText();
      
      // Parse the JSON
      let keybindings: any[] = [];
      try {
        keybindings = JSON.parse(text);
        if (!Array.isArray(keybindings)) {
          keybindings = [];
        }
      } catch (error) {
        // If there's an error parsing, start with an empty array
        console.error('Error parsing keybindings.json', error);
      }
      
      // Find any existing binding for this command and remove it
      const existingIndex = keybindings.findIndex(k => k.command === vsCodeCommandId);
      if (existingIndex >= 0) {
        keybindings.splice(existingIndex, 1);
      }
      
      // Create a new binding
      const newBinding: any = {
        command: vsCodeCommandId,
        key: shortcut.key
      };
      
      // Add mac key if specified
      if (shortcut.mac) {
        newBinding.mac = shortcut.mac;
      }
      
      // Add when clause if specified
      if (shortcut.when) {
        newBinding.when = shortcut.when;
      }
      
      // Add the new binding
      keybindings.push(newBinding);
      
      // Format the JSON
      const formattedJson = JSON.stringify(keybindings, null, 4);
      
      // Write back to the file
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );
      
      // Apply the edit
      await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, formattedJson);
      });
      
      // Save the file
      await document.save();
      
      // Close the editor
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      
    } catch (error) {
      console.error('Error updating VSCode keybindings:', error);
      throw new Error(`Failed to update VSCode keybindings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a list of keyboard shortcuts as human-readable strings
   * @returns Array of keyboard shortcut strings
   */
  public getShortcutsAsStrings(): string[] {
    const shortcuts = this.getKeyboardShortcutsConfig();
    
    return [
      `Run Command: ${shortcuts.runCommand.key} (${shortcuts.runCommand.mac} on macOS)`,
      `Run Stage: ${shortcuts.runStage.key} (${shortcuts.runStage.mac} on macOS)`,
      `Run Sequence: ${shortcuts.runSequence.key} (${shortcuts.runSequence.mac} on macOS)`,
      `Show Output: ${shortcuts.showOutput.key} (${shortcuts.showOutput.mac} on macOS)`,
      `Show Dashboard: ${shortcuts.showDashboard.key} (${shortcuts.showDashboard.mac} on macOS)`,
      `Run Docker Container: ${shortcuts.runContainer.key} (${shortcuts.runContainer.mac} on macOS)`,
      `Refresh Views: ${shortcuts.refreshViews.key} (${shortcuts.refreshViews.mac} on macOS)`,
      `Show Keyboard Shortcuts: ${shortcuts.showKeyboardShortcuts.key} (${shortcuts.showKeyboardShortcuts.mac} on macOS)`
    ];
  }

  /**
   * Show a UI for managing keyboard shortcuts
   */
  public async showKeyboardShortcutsManager(): Promise<void> {
    const shortcuts = this.getKeyboardShortcutsConfig();
    
    // Create pick items for each shortcut
    const pickItems = Object.entries(shortcuts).map(([commandId, shortcut]) => {
      const displayName = this.getCommandDisplayName(commandId as keyof KeyboardShortcutsConfig);
      return {
        label: displayName,
        description: `${shortcut.key} (${shortcut.mac} on macOS)`,
        commandId
      };
    });
    
    // Add a reset option
    pickItems.push({
      label: 'Reset All Shortcuts to Defaults',
      description: 'Restore all keyboard shortcuts to their default values',
      commandId: 'reset'
    });
    
    // Show a quick pick to select a shortcut to edit
    const selected = await vscode.window.showQuickPick(pickItems, {
      placeHolder: 'Select a keyboard shortcut to edit'
    });
    
    if (!selected) {
      return;
    }
    
    // Handle reset option
    if (selected.commandId === 'reset') {
      const confirmed = await vscode.window.showWarningMessage(
        'Are you sure you want to reset all keyboard shortcuts to their default values?',
        { modal: true },
        'Yes, Reset All'
      );
      
      if (confirmed === 'Yes, Reset All') {
        await this.resetToDefaults();
      }
      return;
    }
    
    // Show input box to edit the shortcut
    const keyInput = await vscode.window.showInputBox({
      prompt: `Enter new keyboard shortcut for "${selected.label}" (Windows/Linux)`,
      value: shortcuts[selected.commandId as keyof KeyboardShortcutsConfig].key,
      placeHolder: 'e.g., ctrl+shift+r'
    });
    
    if (!keyInput) {
      return;
    }
    
    // Show input box to edit the macOS shortcut
    const macInput = await vscode.window.showInputBox({
      prompt: `Enter new keyboard shortcut for "${selected.label}" (macOS)`,
      value: shortcuts[selected.commandId as keyof KeyboardShortcutsConfig].mac,
      placeHolder: 'e.g., cmd+shift+r'
    });
    
    if (!macInput) {
      return;
    }
    
    // Update the shortcut
    await this.updateKeyboardShortcut(selected.commandId as keyof KeyboardShortcutsConfig, {
      key: keyInput,
      mac: macInput,
      when: shortcuts[selected.commandId as keyof KeyboardShortcutsConfig].when
    });
  }

  /**
   * Get a human-readable display name for a command
   * @param commandId The command ID
   * @returns Display name for the command
   */
  private getCommandDisplayName(commandId: keyof KeyboardShortcutsConfig): string {
    switch (commandId) {
      case 'runCommand':
        return 'Run Command';
      case 'runStage':
        return 'Run Stage';
      case 'runSequence':
        return 'Run Sequence';
      case 'showOutput':
        return 'Show Output';
      case 'showDashboard':
        return 'Show Dashboard';
      case 'runContainer':
        return 'Run Docker Container';
      case 'refreshViews':
        return 'Refresh Views';
      case 'showKeyboardShortcuts':
        return 'Show Keyboard Shortcuts';
      default:
        return commandId;
    }
  }

  /**
   * Get the VS Code command ID for a shortcut command ID
   * @param commandId The shortcut command ID
   * @returns The VS Code command ID
   */
  public getVSCodeCommandId(commandId: keyof KeyboardShortcutsConfig): string {
    return COMMAND_MAPPING[commandId];
  }

  /**
   * Reset all keyboard shortcuts to their default values
   */
  public async resetToDefaults(): Promise<void> {
    // Get default shortcuts
    const config = vscode.workspace.getConfiguration('niobium-runner');
    const defaultShortcuts = this.getDefaultKeyboardShortcuts();
    
    // Update configuration
    await config.update('keyboardShortcuts', defaultShortcuts, vscode.ConfigurationTarget.Global);
    
    // Update each VSCode keybinding to match defaults
    for (const [commandId, shortcut] of Object.entries(defaultShortcuts)) {
      try {
        await this.updateVSCodeKeybindings(commandId as keyof KeyboardShortcutsConfig, shortcut);
      } catch (error) {
        console.error(`Error resetting keybinding for ${commandId}:`, error);
      }
    }
    
    // Notify the user
    vscode.window.showInformationMessage('Keyboard shortcuts have been reset to defaults.');
  }
} 