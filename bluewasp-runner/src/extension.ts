import * as vscode from 'vscode';
import { ConfigProvider, CommandConfig } from './configProvider';
import { CommandRunner } from './commandRunner';

export function activate(context: vscode.ExtensionContext) {
  console.log('Blue Wasp Runner is now active!');

  const configProvider = new ConfigProvider();
  const commandRunner = new CommandRunner();

  // Register command to run individual commands
  const runCommand = vscode.commands.registerCommand('bluewasp-runner.run', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config) {
        vscode.window.showErrorMessage('No valid .bluewasp.yml configuration found');
        return;
      }

      const commandOptions = config.commands.map(cmd => ({
        label: cmd.name,
        description: cmd.description || '',
        detail: 'Command'
      }));

      const selectedCommand = await vscode.window.showQuickPick(commandOptions, {
        placeHolder: 'Select a command to run'
      });

      if (!selectedCommand) {
        return; // User cancelled
      }

      const command = config.commands.find(cmd => cmd.name === selectedCommand.label);
      if (command) {
        await commandRunner.runCommand(command, rootPath);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command to run stages
  const runStage = vscode.commands.registerCommand('bluewasp-runner.runStage', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.stages || config.stages.length === 0) {
        vscode.window.showErrorMessage('No valid stages found in .bluewasp.yml configuration');
        return;
      }

      const stageOptions = config.stages.map(stage => ({
        label: stage.name,
        description: stage.description || '',
        detail: 'Stage'
      }));

      const selectedStage = await vscode.window.showQuickPick(stageOptions, {
        placeHolder: 'Select a stage to run'
      });

      if (!selectedStage) {
        return; // User cancelled
      }

      await commandRunner.runStage(config, selectedStage.label, rootPath);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command to run sequences
  const runSequence = vscode.commands.registerCommand('bluewasp-runner.runSequence', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.sequences || config.sequences.length === 0) {
        vscode.window.showErrorMessage('No valid sequences found in .bluewasp.yml configuration');
        return;
      }

      const sequenceOptions = config.sequences.map(sequence => ({
        label: sequence.name,
        description: sequence.description || '',
        detail: 'Sequence'
      }));

      const selectedSequence = await vscode.window.showQuickPick(sequenceOptions, {
        placeHolder: 'Select a sequence to run'
      });

      if (!selectedSequence) {
        return; // User cancelled
      }

      await commandRunner.runSequence(config, selectedSequence.label, rootPath);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command for running commands, stages, or sequences
  const runAll = vscode.commands.registerCommand('bluewasp-runner.runAll', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config) {
        vscode.window.showErrorMessage('No valid .bluewasp.yml configuration found');
        return;
      }

      // Create options for commands, stages, and sequences
      const allOptions = [
        ...(config.commands || []).map(cmd => ({
          label: cmd.name,
          description: cmd.description || '',
          detail: 'Command'
        })),
        ...(config.stages || []).map(stage => ({
          label: stage.name,
          description: stage.description || '',
          detail: 'Stage'
        })),
        ...(config.sequences || []).map(sequence => ({
          label: sequence.name,
          description: sequence.description || '',
          detail: 'Sequence'
        }))
      ];

      if (allOptions.length === 0) {
        vscode.window.showErrorMessage('No commands, stages, or sequences found in configuration');
        return;
      }

      const selectedItem = await vscode.window.showQuickPick(allOptions, {
        placeHolder: 'Select a command, stage, or sequence to run'
      });

      if (!selectedItem) {
        return; // User cancelled
      }

      // Run the selected item based on its type
      if (selectedItem.detail === 'Command') {
        const command = config.commands.find(cmd => cmd.name === selectedItem.label);
        if (command) {
          await commandRunner.runCommand(command, rootPath);
        }
      } else if (selectedItem.detail === 'Stage') {
        await commandRunner.runStage(config, selectedItem.label, rootPath);
      } else if (selectedItem.detail === 'Sequence') {
        await commandRunner.runSequence(config, selectedItem.label, rootPath);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command to show the output panel
  const showOutput = vscode.commands.registerCommand('bluewasp-runner.showOutput', () => {
    commandRunner.showOutput();
  });

  context.subscriptions.push(runCommand, runStage, runSequence, runAll, showOutput);
}

export function deactivate() {} 