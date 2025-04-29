import { IntegrationRegistry } from './integrationRegistry';
import { GitLeaksIntegration } from './gitleaksIntegration';

// Create and export the registry instance
export const integrationRegistry = new IntegrationRegistry();

// Register all available integrations
integrationRegistry.register(new GitLeaksIntegration());

// Export all integration types
export * from './interface';
export * from './integrationRegistry';
export * from './gitleaksIntegration'; 