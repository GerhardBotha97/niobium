import * as vscode from 'vscode';
import { ConfigProvider, CommandConfig } from './configProvider';
import { CommandRunner } from './commandRunner';
import { DockerRunner } from './dockerRunner';

export function activate(context: vscode.ExtensionContext) {
  console.log('Blue Wasp Runner is now active!');

  const configProvider = new ConfigProvider();
  const commandRunner = new CommandRunner(context);
  const dockerRunner = new DockerRunner(context);

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
        placeHolder: 'Select a container to run'
      });

      if (!selectedContainer) {
        return; // User cancelled
      }

      const container = config.containers.find(c => c.name === selectedContainer.label);
      if (container) {
        await dockerRunner.startContainer(container, rootPath);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
    runCommand, 
    runStage, 
    runSequence, 
    runAll, 
    showOutput, 
    showJobVisualizer, 
    runContainer, 
    stopContainer, 
    viewContainerLogs, 
    removeContainer, 
    showDockerOutput,
    addDockerContainer
  );
}

export function deactivate() {} 