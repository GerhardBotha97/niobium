import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { NiobiumPanel, JobOutput } from './webviewPanel';
import { CommandConfig, StageConfig } from '../configProvider';

export class JobOutputService {
  private static instance: JobOutputService;
  private panel: NiobiumPanel | undefined;
  private activeJobs: Map<string, JobOutput> = new Map();
  private jobHierarchy: Map<string, string[]> = new Map(); // parentId -> childIds[]
  private jobKillHandlers: Map<string, () => Promise<void>> = new Map(); // jobId -> kill handler
  private jobPids: Map<string, number> = new Map(); // jobId -> process ID

  private constructor(private context: vscode.ExtensionContext) {}

  public static getInstance(context: vscode.ExtensionContext): JobOutputService {
    if (!JobOutputService.instance) {
      JobOutputService.instance = new JobOutputService(context);
    }
    return JobOutputService.instance;
  }

  public showPanel(): void {
    try {
      if (!this.panel) {
        this.panel = NiobiumPanel.createOrShow(this.context.extensionUri);
        // Set up kill job event handler
        this.panel.onKillJob(this.handleKillJob.bind(this));
      } else {
        this.panel.reveal();
      }
    } catch (error) {
      console.error('Error showing panel:', error);
      // Reset panel reference if we get an error revealing it
      this.panel = undefined;
    }
  }

  // Start tracking a command execution
  public startCommand(command: CommandConfig): string {
    // Check if we already have a running job with the same name
    const existingJob = [...this.activeJobs.values()].find(job => 
      job.type === 'command' && 
      job.name === command.name && 
      job.status === 'running'
    );

    // If we have an existing job with the same name that's still running,
    // complete it and add a note to prevent orphaned jobs
    if (existingJob) {
      console.log(`Found existing running job with same name: ${command.name}, completing old job`);
      this.appendOutput(existingJob.id, '\n[System] This job was superseded by a new instance');
      this.completeJobSuccess(existingJob.id);
    }

    const id = uuidv4();
    const jobOutput: JobOutput = {
      id,
      type: 'command',
      name: command.name,
      status: 'running',
      startTime: new Date(),
      output: '',
      command: command.command,
      description: command.description,
      allowFailure: command.allow_failure
    };

    this.activeJobs.set(id, jobOutput);
    
    if (this.panel) {
      try {
        this.panel.addJob(jobOutput);
      } catch (error) {
        console.error('Error adding command job to panel:', error);
        this.panel = undefined;
      }
    }
    
    return id;
  }

  // Register the PID for a job
  public registerPid(jobId: string, pid: number): void {
    console.log(`Registering PID ${pid} for job ${jobId}`);
    this.jobPids.set(jobId, pid);
  }

  // Start tracking a stage execution
  public startStage(stage: StageConfig): string {
    const id = uuidv4();
    const jobOutput: JobOutput = {
      id,
      type: 'stage',
      name: stage.name,
      status: 'running',
      startTime: new Date(),
      output: '',
      description: stage.description,
      allowFailure: stage.allow_failure,
      children: []
    };

    this.activeJobs.set(id, jobOutput);
    this.jobHierarchy.set(id, []);
    
    if (this.panel) {
      try {
        this.panel.addJob(jobOutput);
      } catch (error) {
        console.error('Error adding stage job to panel:', error);
        this.panel = undefined;
      }
    }
    
    return id;
  }

  // Start tracking a sequence execution
  public startSequence(name: string, description?: string): string {
    const id = uuidv4();
    const jobOutput: JobOutput = {
      id,
      type: 'sequence',
      name,
      status: 'running',
      startTime: new Date(),
      output: '',
      description,
      children: []
    };

    this.activeJobs.set(id, jobOutput);
    this.jobHierarchy.set(id, []);
    
    if (this.panel) {
      try {
        this.panel.addJob(jobOutput);
      } catch (error) {
        console.error('Error adding sequence job to panel:', error);
        this.panel = undefined;
      }
    }
    
    return id;
  }

  // Add a child job to a parent job
  public addChildJob(parentId: string, childId: string): void {
    // Update the hierarchy
    const children = this.jobHierarchy.get(parentId) || [];
    children.push(childId);
    this.jobHierarchy.set(parentId, children);
    
    // Update the parent job with the new child
    const parentJob = this.activeJobs.get(parentId);
    const childJob = this.activeJobs.get(childId);
    
    if (parentJob && childJob) {
      if (!parentJob.children) {
        parentJob.children = [];
      }
      
      parentJob.children.push(childJob);
      
      if (this.panel) {
        try {
          this.panel.updateJob(parentId, { children: parentJob.children });
        } catch (error) {
          console.error('Error updating parent job with child in panel:', error);
          this.panel = undefined;
        }
      }
    }
  }

  // Update job output with new content
  public appendOutput(jobId: string, output: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.output += output;
      
      if (this.panel) {
        try {
          this.panel.updateJob(jobId, { output: job.output });
        } catch (error) {
          console.error('Error appending output to job in panel:', error);
          this.panel = undefined;
        }
      }
    }
  }

  // Add error output to a job
  public appendError(jobId: string, error: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.error = (job.error || '') + error;
      
      if (this.panel) {
        try {
          this.panel.updateJob(jobId, { error: job.error });
        } catch (error) {
          console.error('Error appending error to job in panel:', error);
          this.panel = undefined;
        }
      }
    }
  }

  // Complete a job with success
  public completeJobSuccess(jobId: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'success';
      job.endTime = new Date();
      
      // Ensure we remove any kill handlers for this job
      if (this.jobKillHandlers.has(jobId)) {
        this.jobKillHandlers.delete(jobId);
      }
      
      // Remove PID tracking
      this.jobPids.delete(jobId);
      
      if (this.panel) {
        try {
          // Force a complete refresh of the panel to ensure UI is updated correctly
          this.panel.updateJob(jobId, { 
            status: 'success',
            endTime: job.endTime
          });
          
          // Force a complete refresh of the panel
          this.refreshPanel();
        } catch (error) {
          console.error('Error completing job with success in panel:', error);
          this.panel = undefined;
        }
      }
      
      // Refresh the dashboard to show the completed status
      try {
        const { DashboardPanel } = require('./dashboardPanel');
        
        // Add a success activity to the dashboard
        DashboardPanel.addActivity({
          type: 'success',
          text: `Completed job: ${job.name}`,
          time: new Date()
        });
        
        // Force refresh the dashboard panel
        DashboardPanel.refresh();
      } catch (error) {
        console.error('Error refreshing dashboard after job completion:', error);
      }
    }
  }

  // Complete a job with failure
  public completeJobFailure(jobId: string, exitCode?: number): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.endTime = new Date();
      job.exitCode = exitCode;
      
      // Ensure we remove any kill handlers for this job
      if (this.jobKillHandlers.has(jobId)) {
        this.jobKillHandlers.delete(jobId);
      }
      
      // Remove PID tracking
      this.jobPids.delete(jobId);
      
      if (this.panel) {
        try {
          // Update the job status first
          this.panel.updateJob(jobId, { 
            status: 'failed',
            endTime: job.endTime,
            exitCode
          });
          
          // Force a complete refresh of the panel
          this.refreshPanel();
        } catch (error) {
          console.error('Error completing job with failure in panel:', error);
          this.panel = undefined;
        }
      }
      
      // Refresh the dashboard to show the failed status
      try {
        const { DashboardPanel } = require('./dashboardPanel');
        
        // Add a failure activity to the dashboard
        DashboardPanel.addActivity({
          type: 'error',
          text: `Failed job: ${job.name}${exitCode ? ` (code: ${exitCode})` : ''}`,
          time: new Date()
        });
        
        // Force refresh the dashboard panel
        DashboardPanel.refresh();
      } catch (error) {
        console.error('Error refreshing dashboard after job failure:', error);
      }
    }
  }

  // Mark a job as skipped
  public skipJob(jobId: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'skipped';
      job.endTime = new Date();
      
      // Remove PID tracking
      this.jobPids.delete(jobId);
      
      if (this.panel) {
        try {
          this.panel.updateJob(jobId, { 
            status: 'skipped',
            endTime: job.endTime
          });
        } catch (error) {
          console.error('Error marking job as skipped in panel:', error);
          this.panel = undefined;
        }
      }
    }
  }

  // Clear all jobs
  public clearJobs(): void {
    this.activeJobs.clear();
    this.jobHierarchy.clear();
    this.jobKillHandlers.clear();
    this.jobPids.clear();
    
    if (this.panel) {
      try {
        this.panel.clearJobs();
      } catch (error) {
        console.error('Error clearing jobs in panel:', error);
        this.panel = undefined;
      }
    }
  }

  // Get a job by ID
  public getJob(jobId: string): JobOutput | undefined {
    return this.activeJobs.get(jobId);
  }

  // Update a job's details
  public updateJob(jobId: string, updates: Partial<JobOutput>): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      
      if (this.panel) {
        try {
          this.panel.updateJob(jobId, updates);
        } catch (error) {
          console.error('Error updating job in panel:', error);
          this.panel = undefined;
        }
      }
    }
  }

  // Register a kill handler for a specific job
  public registerKillHandler(jobId: string, handler: () => Promise<void>): void {
    this.jobKillHandlers.set(jobId, handler);
  }

  // Handle kill job request from UI
  private async handleKillJob(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job || job.status !== 'running') {
      console.log(`Cannot kill job ${jobId}: job not found or not running`);
      return;
    }

    // Update UI to show job is being killed
    this.updateJob(jobId, { 
      output: job.output + '\n[System] Stopping job...'
    });

    // Execute kill handler if available
    const killHandler = this.jobKillHandlers.get(jobId);
    if (killHandler) {
      try {
        await killHandler();
        // Handler is responsible for updating job status through completeJobSuccess or completeJobFailure
        
        // Ensure the panel is refreshed after a job is killed
        this.refreshPanel();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error killing job ${jobId}:`, errorMessage);
        
        // Mark job as failed and add error message
        this.appendError(jobId, `\n[System] Failed to stop job: ${errorMessage}`);
        this.completeJobFailure(jobId);
        
        // Ensure the panel is refreshed after an error
        this.refreshPanel();
      } finally {
        // Remove the kill handler
        this.jobKillHandlers.delete(jobId);
      }
    } else {
      // No kill handler registered, just mark as cancelled
      this.appendOutput(jobId, '\n[System] Job cancelled by user');
      this.completeJobFailure(jobId);
      
      // Ensure the panel is refreshed
      this.refreshPanel();
    }
  }

  // Refresh the panel to ensure all job statuses are correctly displayed
  private refreshPanel(): void {
    if (this.panel) {
      try {
        console.log("Refreshing panel...");
        
        // Create a registry of running jobs that tracks potential duplicates in a more generic way
        const runningJobs: JobOutput[] = [];
        const completedIds = new Set<string>();
        
        // First gather all running jobs and completed IDs
        for (const job of this.activeJobs.values()) {
          if (job.status === 'running') {
            runningJobs.push(job);
          } else {
            completedIds.add(job.id);
          }
        }
        
        console.log(`RefreshPanel: Found ${runningJobs.length} running jobs`);
        
        // Sort running jobs by start time (newest first) to ensure we keep the most recent ones
        runningJobs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
        
        // First pass: detect basic duplicates (having identical commands or names)
        this.detectExactDuplicates(runningJobs, completedIds);
        
        // Second pass: check for jobs whose processes are no longer running
        this.checkProcessStatus(runningJobs, completedIds);
        
        // Third pass: ensure jobs are cleaned up by context (like stage or command similarity)
        this.cleanupByContext(runningJobs, completedIds);
        
        // Now force an update of all jobs
        for (const [id, job] of this.activeJobs.entries()) {
          // Force update the job in the panel to ensure its status is displayed correctly
          this.panel.updateJob(id, job);
        }
        
        // Also force the panel to do a full refresh
        this.panel.refresh();
      } catch (error) {
        console.error('Error refreshing panel:', error);
        this.panel = undefined;
      }
    }
  }
  
  /**
   * Detect duplicate jobs with identical commands or names
   */
  private detectExactDuplicates(runningJobs: JobOutput[], completedIds: Set<string>): void {
    // Map to track jobs by their effective identity
    const jobsByCommand = new Map<string, JobOutput[]>();
    const jobsByNameBase = new Map<string, JobOutput[]>();
    
    // Group jobs by normalized command and name base
    for (const job of runningJobs) {
      if (completedIds.has(job.id)) continue;
      
      // Group by normalized command (for command-type jobs)
      if (job.command) {
        const normalizedCommand = this.normalizeCommand(job.command);
        if (!jobsByCommand.has(normalizedCommand)) {
          jobsByCommand.set(normalizedCommand, []);
        }
        jobsByCommand.get(normalizedCommand)?.push(job);
      }
      
      // Group by base name (strip prefixes, timestamps)
      const baseName = this.getBaseName(job.name);
      if (!jobsByNameBase.has(baseName)) {
        jobsByNameBase.set(baseName, []);
      }
      jobsByNameBase.get(baseName)?.push(job);
    }
    
    // Process command-based duplicates (highest precision)
    for (const [cmd, jobs] of jobsByCommand.entries()) {
      if (jobs.length > 1) {
        console.log(`Found ${jobs.length} jobs with same normalized command: "${cmd.substring(0, 40)}..."`);
        this.markDuplicateJobs(jobs.slice(1), completedIds, 'command');
      }
    }
    
    // Process name-based duplicates (as fallback)
    for (const [baseName, jobs] of jobsByNameBase.entries()) {
      if (jobs.length > 1) {
        // Filter to only include jobs that weren't already marked as duplicates
        const remainingJobs = jobs.filter(job => !completedIds.has(job.id));
        if (remainingJobs.length > 1) {
          console.log(`Found ${remainingJobs.length} jobs with base name: "${baseName}"`);
          this.markDuplicateJobs(remainingJobs.slice(1), completedIds, 'name');
        }
      }
    }
  }
  
  /**
   * Mark duplicate jobs as complete
   */
  private markDuplicateJobs(jobs: JobOutput[], completedIds: Set<string>, reason: string): void {
    for (const job of jobs) {
      if (!completedIds.has(job.id)) {
        console.log(`Completing duplicate job (by ${reason}): ${job.id} (${job.name})`);
        this.appendOutput(job.id, '\n[System] This job was superseded by a newer instance');
        this.completeJobSuccess(job.id);
        completedIds.add(job.id);
      }
    }
  }
  
  /**
   * Normalize a command string to enable comparison
   */
  private normalizeCommand(command: string): string {
    // Basic normalization
    let normalized = command.trim().replace(/\s+/g, ' ');
    
    // If it's a docker run command, extract the actual command being run
    const dockerMatch = normalized.match(/^docker\s+run\s+(?:--\w+(?:=\S+|\s+\S+)?\s+)*(\S+)\s+(.*)$/i);
    if (dockerMatch) {
      // Extract the command being run inside docker (without the image name)
      normalized = dockerMatch[2];
    }
    
    // Normalize paths in commands that might vary
    normalized = normalized
      // Replace specific output paths
      .replace(/--output(?:=|\s+)[\w\/\.-]+/g, '--output=FILE')
      .replace(/--report-path(?:=|\s+)[\w\/\.-]+/g, '--report-path=FILE')
      // Normalize timestamps or random IDs that might be in output files
      .replace(/\d{8,14}/g, 'TIMESTAMP');
    
    return normalized;
  }
  
  /**
   * Extract base name from a job name by removing common prefixes and timestamps
   */
  private getBaseName(name: string): string {
    // Remove common prefixes
    let baseName = name.replace(/^niobium-/, '');
    
    // Remove timestamp-like suffixes
    baseName = baseName.replace(/-\d{10,14}$/, '');
    
    // Remove version-like suffixes
    baseName = baseName.replace(/-v\d+(\.\d+)*$/, '');
    
    return baseName;
  }

  /**
   * Check if processes are still running
   */
  private async checkProcessStatus(runningJobs: JobOutput[], completedIds: Set<string>): Promise<void> {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Create a list of all PIDs to check
    const pidsToCheck: number[] = [];
    const jobsByPid = new Map<number, JobOutput[]>();
    const jobsWithoutPids: JobOutput[] = [];
    
    // Debug output - log all running jobs
    console.log(`Running job check - ${runningJobs.length} running jobs found`);
    
    for (const job of runningJobs) {
      if (completedIds.has(job.id)) continue;
      
      console.log(`Checking job: ${job.id} (${job.name}) - status: ${job.status}`);
      
      const pid = this.jobPids.get(job.id);
      if (pid) {
        console.log(`  Job ${job.id} has PID: ${pid}`);
        pidsToCheck.push(pid);
        
        if (!jobsByPid.has(pid)) {
          jobsByPid.set(pid, []);
        }
        jobsByPid.get(pid)?.push(job);
      } else {
        console.log(`  Job ${job.id} has no PID registered`);
        jobsWithoutPids.push(job);
      }
    }
    
    if (pidsToCheck.length === 0 && jobsWithoutPids.length === 0) {
      console.log('No PIDs to check and no jobs without PIDs');
      return;
    }
    
    console.log(`Will check ${pidsToCheck.length} PIDs, ${jobsWithoutPids.length} jobs have no PIDs`);
    
    try {
      // Get a list of all running processes
      const { stdout } = await execPromise('ps -e -o pid,comm');
      console.log(`Process list retrieved, parsing results...`);
      
      const runningProcesses = stdout.split('\n')
        .slice(1) // Skip header
        .filter((line: string) => line.trim())
        .map((line: string) => {
          const parts = line.trim().split(/\s+/);
          return { 
            pid: parseInt(parts[0], 10),
            command: parts.slice(1).join(' ')
          };
        });
      
      const runningPids = new Set(runningProcesses.map((p: {pid: number, command: string}) => p.pid));
      console.log(`Found ${runningPids.size} running processes`);
      
      // Check each of our PIDs
      for (const pid of pidsToCheck) {
        if (!runningPids.has(pid)) {
          const jobs = jobsByPid.get(pid) || [];
          
          for (const job of jobs) {
            if (!completedIds.has(job.id)) {
              console.log(`Process ${pid} for job ${job.id} (${job.name}) is no longer running`);
              
              // Check if the job should be considered successful
              let isSuccess = true;
              
              // If output contains errors, mark as failed instead of success
              if (job.output && (
                  job.output.includes('[Error]') || 
                  job.output.includes('[ERROR]') || 
                  job.output.includes('error occurred') ||
                  job.output.includes('failed with exit'))) {
                isSuccess = false;
                console.log(`  Marking job as failed based on output content`);
              }
              
              this.appendOutput(job.id, '\n[System] Process is no longer running');
              
              if (isSuccess) {
                this.completeJobSuccess(job.id);
              } else {
                this.completeJobFailure(job.id, 1);
              }
              
              completedIds.add(job.id);
            }
          }
        } else {
          console.log(`Process ${pid} is still running`);
        }
      }
      
      // Handle jobs without PIDs - mark as complete if they've been running for too long
      if (jobsWithoutPids.length > 0) {
        console.log(`Checking ${jobsWithoutPids.length} jobs without PIDs`);
        
        // Group these jobs by command
        const jobsByCommand = new Map<string, JobOutput[]>();
        
        for (const job of jobsWithoutPids) {
          if (job.command) {
            // Normalize the command
            const normalizedCmd = this.normalizeCommand(job.command);
            if (!jobsByCommand.has(normalizedCmd)) {
              jobsByCommand.set(normalizedCmd, []);
            }
            jobsByCommand.get(normalizedCmd)?.push(job);
          }
        }
        
        // For each command, only keep one job running (the most recent)
        for (const [cmd, jobs] of jobsByCommand.entries()) {
          if (jobs.length > 1) {
            console.log(`Found ${jobs.length} jobs with command: ${cmd.substring(0, 40)}...`);
            
            // Sort by start time (most recent first)
            jobs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
            
            // Keep the most recent job, mark others as complete
            for (let i = 1; i < jobs.length; i++) {
              console.log(`Completing redundant job without PID: ${jobs[i].id} (${jobs[i].name})`);
              this.appendOutput(jobs[i].id, '\n[System] Marked as complete (duplicate job)');
              this.completeJobSuccess(jobs[i].id);
              completedIds.add(jobs[i].id);
            }
          }
        }
        
        // Check for stale jobs without PIDs - they've been running too long
        const now = new Date();
        const MAX_RUNNING_TIME_MS = 5 * 60 * 1000; // 5 minutes for jobs without PIDs
        
        for (const job of jobsWithoutPids) {
          if (completedIds.has(job.id)) continue;
          
          const runningTime = now.getTime() - job.startTime.getTime();
          if (runningTime > MAX_RUNNING_TIME_MS) {
            console.log(`Job without PID running for ${(runningTime / 1000 / 60).toFixed(1)} minutes: ${job.name}`);
            this.appendOutput(job.id, `\n[System] No process information available and job has been running for ${(runningTime / 1000 / 60).toFixed(1)} minutes`);
            this.completeJobSuccess(job.id);
            completedIds.add(job.id);
          }
        }
      }
    } catch (error) {
      console.error('Error checking process status:', error);
    }
  }
  
  /**
   * Clean up jobs by looking at context and relationships between jobs
   */
  private cleanupByContext(runningJobs: JobOutput[], completedIds: Set<string>): void {
    try {
      // Group jobs by name prefix (for tool families)
      const jobsByPrefix = new Map<string, JobOutput[]>();
      
      for (const job of runningJobs) {
        if (completedIds.has(job.id)) continue;
        
        // Extract common prefixes that might indicate similar tools
        const nameParts = job.name.split('-');
        const prefix = nameParts[0];
        
        if (!jobsByPrefix.has(prefix)) {
          jobsByPrefix.set(prefix, []);
        }
        jobsByPrefix.get(prefix)?.push(job);
      }
      
      // Look for tool groups with multiple running instances
      for (const [prefix, jobs] of jobsByPrefix.entries()) {
        if (jobs.length > 1) {
          console.log(`Found ${jobs.length} running jobs with prefix "${prefix}"`);
          
          // Check if all these jobs are also similar in their command or function
          const similarCommandJobs = new Map<string, JobOutput[]>();
          
          for (const job of jobs) {
            let signature = '';
            
            if (job.command) {
              // Get the first "word" of the command as its essence
              const commandEssence = job.command.trim().split(/\s+/)[0];
              signature = `cmd:${commandEssence}`;
            } else {
              // If no command, use the type as distinguisher
              signature = `type:${job.type || 'unknown'}`;
            }
            
            if (!similarCommandJobs.has(signature)) {
              similarCommandJobs.set(signature, []);
            }
            similarCommandJobs.get(signature)?.push(job);
          }
          
          // For each group of similar jobs, keep the newest and complete others
          for (const [signature, similarJobs] of similarCommandJobs.entries()) {
            if (similarJobs.length > 1) {
              console.log(`Found ${similarJobs.length} jobs with prefix "${prefix}" and signature "${signature}"`);
              
              // Sort by start time (most recent first)
              similarJobs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
              
              // Keep the newest job, complete others
              for (let i = 1; i < similarJobs.length; i++) {
                if (!completedIds.has(similarJobs[i].id)) {
                  console.log(`Completing redundant job by context: ${similarJobs[i].id} (${similarJobs[i].name})`);
                  this.appendOutput(similarJobs[i].id, '\n[System] Completed as a duplicate job detected by context');
                  this.completeJobSuccess(similarJobs[i].id);
                  completedIds.add(similarJobs[i].id);
                }
              }
            }
          }
        }
      }
      
      // Check for semantic relationships between jobs with similar purpose
      this.detectSemanticDuplicates(runningJobs, completedIds);
      
    } catch (error) {
      console.error('Error in cleanupByContext:', error);
    }
  }
  
  /**
   * Detect semantically duplicate jobs based on content analysis
   */
  private detectSemanticDuplicates(runningJobs: JobOutput[], completedIds: Set<string>): void {
    try {
      // Group jobs by type (command, stage, sequence)
      const jobsByType = new Map<string, JobOutput[]>();
      
      for (const job of runningJobs) {
        if (completedIds.has(job.id)) continue;
        
        const type = job.type || 'unknown';
        if (!jobsByType.has(type)) {
          jobsByType.set(type, []);
        }
        jobsByType.get(type)?.push(job);
      }
      
      // For each job type, look for similar purpose jobs
      for (const [type, jobs] of jobsByType.entries()) {
        if (jobs.length > 1) {
          console.log(`Checking ${jobs.length} jobs of type "${type}" for semantic duplicates`);
          
          // Create signature groups to detect jobs with similar purpose
          const semanticGroups = new Map<string, JobOutput[]>();
          
          for (const job of jobs) {
            let semanticSignature = '';
            
            // Analyze the job's purpose based on name, command, and output
            const keywords = this.extractKeywords(job);
            
            if (keywords.length > 0) {
              semanticSignature = keywords.slice(0, 3).join('-');
            } else {
              // Fallback to name if no keywords
              semanticSignature = job.name;
            }
            
            if (!semanticGroups.has(semanticSignature)) {
              semanticGroups.set(semanticSignature, []);
            }
            semanticGroups.get(semanticSignature)?.push(job);
          }
          
          // For each semantic group, keep only the newest job
          for (const [signature, sigJobs] of semanticGroups.entries()) {
            if (sigJobs.length > 1) {
              console.log(`Found ${sigJobs.length} jobs with semantic signature "${signature}"`);
              
              // Sort by start time (most recent first)
              sigJobs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
              
              // Keep the newest job, complete others
              for (let i = 1; i < sigJobs.length; i++) {
                if (!completedIds.has(sigJobs[i].id)) {
                  console.log(`Completing semantic duplicate: ${sigJobs[i].id} (${sigJobs[i].name})`);
                  this.appendOutput(sigJobs[i].id, '\n[System] Completed as semantically similar to another running job');
                  this.completeJobSuccess(sigJobs[i].id);
                  completedIds.add(sigJobs[i].id);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in detectSemanticDuplicates:', error);
    }
  }
  
  /**
   * Extract keywords that represent the purpose of a job
   */
  private extractKeywords(job: JobOutput): string[] {
    const keywords: string[] = [];
    
    // Extract from name 
    if (job.name) {
      // Split by common separators and take non-empty parts
      const nameParts = job.name.toLowerCase().split(/[-_\s.]+/).filter(p => p && p.length > 2);
      keywords.push(...nameParts);
    }
    
    // Extract from command if available
    if (job.command) {
      // Look for the main executable/tool in the command
      const cmdParts = job.command.toLowerCase().split(/\s+/);
      const mainCmd = cmdParts[0];
      
      // Exclude very common commands
      if (!['cd', 'ls', 'dir', 'echo', 'cat', 'rm', 'cp', 'mv'].includes(mainCmd)) {
        keywords.push(mainCmd);
      }
      
      // Look for action verbs in the command
      for (const part of cmdParts) {
        if (['scan', 'check', 'test', 'build', 'run', 'analyze', 'detect', 'find'].includes(part)) {
          keywords.push(part);
        }
      }
      
      // Look for tools that might be specified with 'run', 'npx', etc.
      if (['run', 'npx', 'yarn', 'pnpm', 'go', 'python', 'ruby', 'bash'].includes(mainCmd) && cmdParts.length > 1) {
        keywords.push(cmdParts[1]);
      }
    }
    
    // Extract from output if available - look for tool names and purposes
    if (job.output) {
      // Common security/development tool names
      const toolPatterns = [
        'scan', 'lint', 'check', 'test', 'build', 'analyze', 'detect',
        'security', 'vulnerability', 'secret', 'dependency'
      ];
      
      // Look for these patterns in the output
      for (const pattern of toolPatterns) {
        if (job.output.toLowerCase().includes(pattern)) {
          keywords.push(pattern);
        }
      }
    }
    
    // Remove duplicates
    return [...new Set(keywords)];
  }
} 