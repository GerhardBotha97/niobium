import { IntegrationRegistry } from './integrationRegistry';
import { GitLeaksIntegration } from './gitleaksIntegration';
import { TrivyIntegration } from './trivyIntegration';
import { SemgrepIntegration } from './semgrepIntegration';
import { CheckovIntegration } from './checkovIntegration';

// Create and export the registry instance
export const integrationRegistry = new IntegrationRegistry();

// Register all available integrations
integrationRegistry.register(new GitLeaksIntegration());
integrationRegistry.register(new TrivyIntegration());
integrationRegistry.register(new SemgrepIntegration());
integrationRegistry.register(new CheckovIntegration());

// Export all integration types
export * from './interface';
export * from './integrationRegistry';
export * from './gitleaksIntegration';
export * from './trivyIntegration';
export * from './semgrepIntegration';
export * from './checkovIntegration'; 