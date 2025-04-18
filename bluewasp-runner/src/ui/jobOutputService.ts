import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { BlueWaspPanel, JobOutput } from './webviewPanel';
import { CommandConfig, StageConfig } from '../configProvider';

export class JobOutputService {
  private static instance: JobOutputService;
  private panel: BlueWaspPanel | undefined;
  private activeJobs: Map<string, JobOutput> = new Map();
  private jobHierarchy: Map<string, string[]> = new Map(); // parentId -> childIds[]
  private jobKillHandlers: Map<string, () => Promise<void>> = new Map(); // jobId -> kill handler

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
        this.panel = BlueWaspPanel.createOrShow(this.context.extensionUri);
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
      
      if (this.panel) {
        try {
          this.panel.updateJob(jobId, { 
            status: 'success',
            endTime: job.endTime
          });
        } catch (error) {
          console.error('Error completing job with success in panel:', error);
          this.panel = undefined;
        }
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
      
      if (this.panel) {
        try {
          this.panel.updateJob(jobId, { 
            status: 'failed',
            endTime: job.endTime,
            exitCode
          });
        } catch (error) {
          console.error('Error completing job with failure in panel:', error);
          this.panel = undefined;
        }
      }
    }
  }

  // Mark a job as skipped
  public skipJob(jobId: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = 'skipped';
      job.endTime = new Date();
      
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
        // Verify all job statuses are correct
        for (const [id, job] of this.activeJobs.entries()) {
          // Force update the job in the panel to ensure its status is displayed correctly
          this.panel.updateJob(id, job);
        }
      } catch (error) {
        console.error('Error refreshing panel:', error);
        this.panel = undefined;
      }
    }
  }
} 