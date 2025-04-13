import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { BlueWaspPanel, JobOutput } from './webviewPanel';
import { CommandConfig, StageConfig } from '../configProvider';

export class JobOutputService {
  private static instance: JobOutputService;
  private panel: BlueWaspPanel | undefined;
  private activeJobs: Map<string, JobOutput> = new Map();
  private jobHierarchy: Map<string, string[]> = new Map(); // parentId -> childIds[]

  private constructor(private context: vscode.ExtensionContext) {}

  public static getInstance(context: vscode.ExtensionContext): JobOutputService {
    if (!JobOutputService.instance) {
      JobOutputService.instance = new JobOutputService(context);
    }
    return JobOutputService.instance;
  }

  public showPanel(): void {
    if (!this.panel) {
      this.panel = BlueWaspPanel.createOrShow(this.context.extensionUri);
    } else {
      this.panel.reveal();
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
      this.panel.addJob(jobOutput);
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
      this.panel.addJob(jobOutput);
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
      this.panel.addJob(jobOutput);
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
        this.panel.updateJob(parentId, { children: parentJob.children });
      }
    }
  }

  // Update job output with new content
  public appendOutput(jobId: string, output: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.output += output;
      
      if (this.panel) {
        this.panel.updateJob(jobId, { output: job.output });
      }
    }
  }

  // Add error output to a job
  public appendError(jobId: string, error: string): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.error = (job.error || '') + error;
      
      if (this.panel) {
        this.panel.updateJob(jobId, { error: job.error });
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
        this.panel.updateJob(jobId, { 
          status: 'success',
          endTime: job.endTime
        });
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
        this.panel.updateJob(jobId, { 
          status: 'failed',
          endTime: job.endTime,
          exitCode
        });
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
        this.panel.updateJob(jobId, { 
          status: 'skipped',
          endTime: job.endTime
        });
      }
    }
  }

  // Clear all jobs
  public clearJobs(): void {
    this.activeJobs.clear();
    this.jobHierarchy.clear();
    
    if (this.panel) {
      this.panel.clearJobs();
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
        this.panel.updateJob(jobId, updates);
      }
    }
  }
} 