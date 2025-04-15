import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigProvider, CommandConfig } from './configProvider';
import { CommandRunner } from './commandRunner';
import { DockerRunner } from './dockerRunner';
import { DashboardPanel } from './ui/dashboardPanel';
import { DashboardViewProvider } from './views/dashboardView';
import { ContainerViewProvider } from './views/containerView';

export function activate(context: vscode.ExtensionContext) {
  console.log('Blue Wasp Runner is now active!');

  const configProvider = new ConfigProvider();
  const commandRunner = new CommandRunner(context);
  const dockerRunner = new DockerRunner(context);

  // Initialize the dashboard panel
  DashboardPanel.initialize(context);
  
  // Register tree data providers for sidebar views
  const dashboardViewProvider = new DashboardViewProvider(context);
  const containerViewProvider = new ContainerViewProvider(context);
  
  // Register views for dashboard and containers
  vscode.window.registerTreeDataProvider(
    'bluewasp-dashboard',
    dashboardViewProvider
  );
  
  vscode.window.registerTreeDataProvider(
    'bluewasp-container',
    containerViewProvider
  );

  // Register refresh commands
  context.subscriptions.push(
    vscode.commands.registerCommand('bluewasp-runner.refreshViews', () => {
      dashboardViewProvider.refresh();
      containerViewProvider.refresh();
    })
  );

  // Context menu commands for container view
  context.subscriptions.push(
    vscode.commands.registerCommand('bluewasp-runner.startContainer', async (containerName) => {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const config = await configProvider.loadConfig(rootPath);
        
        if (!config || !config.containers) {
          vscode.window.showErrorMessage('No valid containers found in .bluewasp.yml configuration');
          return;
        }

        const container = config.containers.find(c => c.name === containerName);
        if (container) {
          await dockerRunner.startContainer(container, rootPath);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Create and configure status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  
  // Use VS Code's built-in codicon with a better icon for a wasp (insect-like or flying)
  // Options: $(rocket), $(shield), $(zap), $(lightbulb), $(star)
  statusBarItem.text = "$(zap) BlueWasp";
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.tooltip = "Open BlueWasp Dashboard";
  statusBarItem.command = 'bluewasp-runner.showDashboard';
  statusBarItem.show();
  
  // Register the status bar command to show the dashboard
  const showDashboard = vscode.commands.registerCommand('bluewasp-runner.showDashboard', () => {
    try {
      // Try to show the dashboard, this will create a new one if needed
      const dashboard = DashboardPanel.show(context);
      
      // If the dashboard couldn't be created, show an error
      if (!dashboard) {
        vscode.window.showErrorMessage('Could not open Blue Wasp Dashboard. Please try again.');
      }
    } catch (error) {
      // Handle any errors
      const errorMessage = `Error showing dashboard: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMessage);
      vscode.window.showErrorMessage(errorMessage);
    }
  });

  // Register command to clear activity history
  const clearActivities = vscode.commands.registerCommand('bluewasp-runner.clearActivities', () => {
    DashboardPanel.clearActivities();
    vscode.window.showInformationMessage('Activity history cleared');
  });

  // Register commands for running specific items directly
  const runSpecificCommand = vscode.commands.registerCommand('bluewasp-runner.runSpecificCommand', async (commandName) => {
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

      const command = config.commands.find(cmd => cmd.name === commandName);
      if (!command) {
        vscode.window.showErrorMessage(`Command "${commandName}" not found in configuration`);
        return;
      }

      DashboardPanel.addActivity({
        type: 'running',
        text: `Running command: ${command.name}...`,
        time: new Date()
      });

      const result = await commandRunner.runCommand(command, rootPath);
      
      DashboardPanel.addActivity({
        type: result.success ? 'success' : 'error',
        text: result.success ? `Command ${command.name} executed successfully` : `Command ${command.name} failed: ${result.error}`,
        time: new Date()
      });
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      DashboardPanel.addActivity({
        type: 'error',
        text: errorMessage,
        time: new Date()
      });
    }
  });

  const runSpecificStage = vscode.commands.registerCommand('bluewasp-runner.runSpecificStage', async (stageName) => {
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

      DashboardPanel.addActivity({
        type: 'running',
        text: `Running stage: ${stageName}...`,
        time: new Date()
      });

      const result = await commandRunner.runStage(config, stageName, rootPath);
      
      DashboardPanel.addActivity({
        type: result.success ? 'success' : 'error',
        text: result.success ? `Stage ${stageName} executed successfully` : `Stage ${stageName} failed: ${result.error}`,
        time: new Date()
      });
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      DashboardPanel.addActivity({
        type: 'error',
        text: errorMessage,
        time: new Date()
      });
    }
  });

  const runSpecificSequence = vscode.commands.registerCommand('bluewasp-runner.runSpecificSequence', async (sequenceName) => {
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

      DashboardPanel.addActivity({
        type: 'running',
        text: `Running sequence: ${sequenceName}...`,
        time: new Date()
      });

      const result = await commandRunner.runSequence(config, sequenceName, rootPath);
      
      DashboardPanel.addActivity({
        type: result.success ? 'success' : 'error',
        text: result.success ? `Sequence ${sequenceName} executed successfully` : `Sequence ${sequenceName} failed: ${result.error}`,
        time: new Date()
      });
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      DashboardPanel.addActivity({
        type: 'error',
        text: errorMessage,
        time: new Date()
      });
    }
  });

  // Register command to run individual commands
  const runCommand = vscode.commands.registerCommand('bluewasp-runner.run', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        vscode.commands.executeCommand('runCommand.complete', false, 'No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config) {
        vscode.window.showErrorMessage('No valid .bluewasp.yml configuration found');
        vscode.commands.executeCommand('runCommand.complete', false, 'No valid configuration found');
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
        vscode.commands.executeCommand('runCommand.complete', false, 'Command selection canceled');
        return; // User cancelled
      }

      const command = config.commands.find(cmd => cmd.name === selectedCommand.label);
      if (command) {
        const result = await commandRunner.runCommand(command, rootPath);
        vscode.commands.executeCommand('runCommand.complete', result.success, 
          result.success ? `Command ${command.name} executed successfully` : `Command ${command.name} failed: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      vscode.commands.executeCommand('runCommand.complete', false, errorMessage);
    }
  });

  // Register command to run stages
  const runStage = vscode.commands.registerCommand('bluewasp-runner.runStage', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        vscode.commands.executeCommand('runStage.complete', false, 'No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.stages || config.stages.length === 0) {
        const errorMsg = 'No valid stages found in .bluewasp.yml configuration';
        vscode.window.showErrorMessage(errorMsg);
        vscode.commands.executeCommand('runStage.complete', false, errorMsg);
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
        vscode.commands.executeCommand('runStage.complete', false, 'Stage selection canceled');
        return; // User cancelled
      }

      const result = await commandRunner.runStage(config, selectedStage.label, rootPath);
      vscode.commands.executeCommand('runStage.complete', result.success, 
        result.success ? `Stage ${selectedStage.label} executed successfully` : `Stage ${selectedStage.label} failed: ${result.error}`);
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      vscode.commands.executeCommand('runStage.complete', false, errorMessage);
    }
  });

  // Register command to run sequences
  const runSequence = vscode.commands.registerCommand('bluewasp-runner.runSequence', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        vscode.commands.executeCommand('runSequence.complete', false, 'No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.sequences || config.sequences.length === 0) {
        const errorMsg = 'No valid sequences found in .bluewasp.yml configuration';
        vscode.window.showErrorMessage(errorMsg);
        vscode.commands.executeCommand('runSequence.complete', false, errorMsg);
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
        vscode.commands.executeCommand('runSequence.complete', false, 'Sequence selection canceled');
        return; // User cancelled
      }

      const result = await commandRunner.runSequence(config, selectedSequence.label, rootPath);
      vscode.commands.executeCommand('runSequence.complete', result.success, 
        result.success ? `Sequence ${selectedSequence.label} executed successfully` : `Sequence ${selectedSequence.label} failed: ${result.error}`);
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      vscode.commands.executeCommand('runSequence.complete', false, errorMessage);
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
          detail: cmd.image ? 'Docker Command' : 'Command'
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
      if (selectedItem.detail === 'Command' || selectedItem.detail === 'Docker Command') {
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

  // Register command to show the WebView job visualization panel
  const showJobVisualizer = vscode.commands.registerCommand('bluewasp-runner.showJobVisualizer', () => {
    // This will show the WebView panel through the JobOutputService
    commandRunner.showOutput();
  });

  // Register command to run Docker containers
  const runContainer = vscode.commands.registerCommand('bluewasp-runner.runContainer', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        vscode.commands.executeCommand('runContainer.complete', false, 'No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.containers || config.containers.length === 0) {
        const errorMsg = 'No valid containers found in .bluewasp.yml configuration';
        vscode.window.showErrorMessage(errorMsg);
        vscode.commands.executeCommand('runContainer.complete', false, errorMsg);
        return;
      }

      const containerOptions = config.containers.map(container => ({
        label: container.name,
        description: container.description || `${container.image}${container.tag ? `:${container.tag}` : ''}`,
        detail: 'Container'
      }));

      const selectedContainer = await vscode.window.showQuickPick(containerOptions, {
        placeHolder: 'Select a container to run'
      });

      if (!selectedContainer) {
        vscode.commands.executeCommand('runContainer.complete', false, 'Container selection canceled');
        return; // User cancelled
      }

      const container = config.containers.find(c => c.name === selectedContainer.label);
      if (container) {
        const result = await dockerRunner.startContainer(container, rootPath);
        vscode.commands.executeCommand('runContainer.complete', result.success, 
          result.success ? `Container ${container.name} started successfully` : `Failed to start container ${container.name}: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(errorMessage);
      vscode.commands.executeCommand('runContainer.complete', false, errorMessage);
    }
  });

  // Register command to stop Docker containers
  const stopContainer = vscode.commands.registerCommand('bluewasp-runner.stopContainer', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.containers || config.containers.length === 0) {
        vscode.window.showErrorMessage('No valid containers found in .bluewasp.yml configuration');
        return;
      }

      const containerOptions = config.containers.map(container => ({
        label: container.name,
        description: container.description || `${container.image}${container.tag ? `:${container.tag}` : ''}`,
        detail: 'Container'
      }));

      const selectedContainer = await vscode.window.showQuickPick(containerOptions, {
        placeHolder: 'Select a container to stop'
      });

      if (!selectedContainer) {
        return; // User cancelled
      }

      await dockerRunner.stopContainer(selectedContainer.label);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command to view Docker container logs
  const viewContainerLogs = vscode.commands.registerCommand('bluewasp-runner.viewContainerLogs', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.containers || config.containers.length === 0) {
        vscode.window.showErrorMessage('No valid containers found in .bluewasp.yml configuration');
        return;
      }

      const containerOptions = config.containers.map(container => ({
        label: container.name,
        description: container.description || `${container.image}${container.tag ? `:${container.tag}` : ''}`,
        detail: 'Container'
      }));

      const selectedContainer = await vscode.window.showQuickPick(containerOptions, {
        placeHolder: 'Select a container to view logs'
      });

      if (!selectedContainer) {
        return; // User cancelled
      }

      await dockerRunner.showContainerLogs(selectedContainer.label);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command to remove Docker containers
  const removeContainer = vscode.commands.registerCommand('bluewasp-runner.removeContainer', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = await configProvider.loadConfig(rootPath);
      
      if (!config || !config.containers || config.containers.length === 0) {
        vscode.window.showErrorMessage('No valid containers found in .bluewasp.yml configuration');
        return;
      }

      const containerOptions = config.containers.map(container => ({
        label: container.name,
        description: container.description || `${container.image}${container.tag ? `:${container.tag}` : ''}`,
        detail: 'Container'
      }));

      const selectedContainer = await vscode.window.showQuickPick(containerOptions, {
        placeHolder: 'Select a container to remove'
      });

      if (!selectedContainer) {
        return; // User cancelled
      }

      await dockerRunner.removeContainer(selectedContainer.label);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Register command to show Docker output channel
  const showDockerOutput = vscode.commands.registerCommand('bluewasp-runner.showDockerOutput', () => {
    dockerRunner.showOutput();
  });

  // Register command to add a new Docker container configuration
  const addDockerContainer = vscode.commands.registerCommand('bluewasp-runner.addDockerContainer', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      
      // Prompt for container information
      const name = await vscode.window.showInputBox({
        prompt: 'Enter container name',
        placeHolder: 'e.g., postgres-db'
      });
      
      if (!name) {
        return; // User cancelled
      }
      
      const description = await vscode.window.showInputBox({
        prompt: 'Enter container description (optional)',
        placeHolder: 'e.g., PostgreSQL database container'
      });
      
      const image = await vscode.window.showInputBox({
        prompt: 'Enter container image',
        placeHolder: 'e.g., postgres',
        validateInput: (value) => {
          return value ? null : 'Image is required';
        }
      });
      
      if (!image) {
        return; // User cancelled
      }
      
      const tag = await vscode.window.showInputBox({
        prompt: 'Enter image tag (optional)',
        placeHolder: 'e.g., latest, 13, 3.9-alpine'
      });
      
      const portMapping = await vscode.window.showInputBox({
        prompt: 'Enter port mapping (optional)',
        placeHolder: 'hostPort:containerPort, e.g., 5432:5432'
      });
      
      // Generate YAML
      let yamlContent = `
# Docker container configuration
- name: ${name}
  description: ${description || ''}
  image: ${image}${tag ? `\n  tag: ${tag}` : ''}`;
      
      if (portMapping) {
        const [host, container] = portMapping.split(':');
        yamlContent += `
  ports:
    - host: ${host}
      container: ${container}`;
      }
      
      // Ask if they want to add environment variables
      const addEnv = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Do you want to add environment variables?'
      });
      
      if (addEnv === 'Yes') {
        yamlContent += `
  environment:
    # Add your environment variables here
    # KEY: value`;
      }
      
      // Ask if they want to add volumes
      const addVolumes = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Do you want to add volume mappings?'
      });
      
      if (addVolumes === 'Yes') {
        yamlContent += `
  volumes:
    - source: ./data
      target: /data
      # readonly: true # Uncomment to make readonly`;
      }
      
      // Ask for restart policy
      const restartPolicy = await vscode.window.showQuickPick(['no', 'always', 'on-failure', 'unless-stopped'], {
        placeHolder: 'Select a restart policy'
      });
      
      if (restartPolicy) {
        yamlContent += `
  restart_policy: ${restartPolicy}`;
      }
      
      // Create a new file with the container configuration
      const fileName = `${name}-container-config.yml`;
      const filePath = vscode.Uri.file(`${rootPath}/${fileName}`);
      
      await vscode.workspace.fs.writeFile(
        filePath,
        Buffer.from(yamlContent)
      );
      
      // Open the file
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
      
      vscode.window.showInformationMessage(`Docker container configuration created: ${fileName}`);
      vscode.window.showInformationMessage('Add this configuration to your .bluewasp.yml file under the "containers" section.');
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  context.subscriptions.push(
    statusBarItem,
    showDashboard,
    runSpecificCommand,
    runSpecificStage,
    runSpecificSequence,
    clearActivities
  );
}

export function deactivate() {} 