/**
 * Utility functions for Docker operations
 */

/**
 * Sanitize a string to be used as a Docker container name
 * Docker container names must match the regex: [a-zA-Z0-9][a-zA-Z0-9_.-]
 * @param name The original name to sanitize
 * @returns A sanitized name valid for Docker container names
 */
export function sanitizeContainerName(name: string): string {
  // Replace spaces and any other invalid characters with dashes
  let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, '-');
  
  // Ensure the name starts with a letter or number
  if (!/^[a-zA-Z0-9]/.test(sanitized)) {
    sanitized = 'c-' + sanitized;
  }
  
  // Trim the name if it's too long (Docker has a length limit)
  if (sanitized.length > 64) {
    sanitized = sanitized.substring(0, 64);
  }
  
  return sanitized;
} 