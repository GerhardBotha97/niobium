import { ToolIntegration } from './interface';

/**
 * Registry for all tool integrations
 */
export class IntegrationRegistry {
  private integrations: ToolIntegration[] = [];

  /**
   * Register a new tool integration
   */
  register(integration: ToolIntegration): void {
    this.integrations.push(integration);
  }

  /**
   * Find an integration that can handle the given file
   */
  findIntegrationForFile(filename: string, data: any): ToolIntegration | undefined {
    return this.integrations.find(integration => integration.canHandle(filename, data));
  }

  /**
   * Get all registered integrations
   */
  getAllIntegrations(): ToolIntegration[] {
    return [...this.integrations];
  }
} 