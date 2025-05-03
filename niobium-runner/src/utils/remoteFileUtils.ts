import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

/**
 * Remote File Utilities for Niobium
 * 
 * This module provides functionality to fetch configuration files from remote sources
 * including GitHub, GitLab, and custom servers.
 * 
 * Example usage in .niobium.yml:
 * 
 * ```yml
 * # Include a remote configuration file from GitHub
 * include:
 *   url: https://github.com/user/repo/blob/main/.niobium.yml
 *   auth:
 *     type: token
 *     token: ${GITHUB_TOKEN} # Environment variable reference
 *   refresh:
 *     interval: 60  # Refresh every 60 minutes
 * 
 * # Include multiple remote files
 * include:
 *   - url: https://github.com/user/repo/blob/main/commands.yml
 *     auth:
 *       type: token
 *       token: ${GITHUB_TOKEN}
 *     refresh:
 *       force: true  # Always refresh this file
 * 
 *   - url: https://gitlab.com/user/repo/blob/main/stages.yml
 *     auth:
 *       type: token
 *       token: ${GITLAB_TOKEN}
 *     refresh:
 *       interval: 1440  # Refresh daily (24 hours = 1440 minutes)
 * 
 *   - url: https://private-server.com/api/config.yml
 *     auth:
 *       type: basic
 *       username: user
 *       password: ${API_PASSWORD}
 *     # No refresh options means it will only be downloaded once
 * 
 *   - ./local-file.yml  # Local files still work as before
 * ```
 */

export interface RemoteFileConfig {
  url: string;
  auth?: {
    type: 'token' | 'basic' | 'oauth' | 'none';
    token?: string;
    username?: string;
    password?: string;
  };
  headers?: Record<string, string>;
  refresh?: {
    interval?: number;
    force?: boolean;
  };
}

/**
 * Downloads a file from a remote URL
 * 
 * @param remoteConfig The remote file configuration
 * @param targetPath The local path where the file should be saved
 * @returns A promise that resolves when the file is downloaded
 */
export async function downloadRemoteFile(
  remoteConfig: RemoteFileConfig,
  targetPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(remoteConfig.url);
      const isHttps = url.protocol === 'https:';
      const requestModule = isHttps ? https : http;
      const targetDir = path.dirname(targetPath);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // Prepare headers
      const headers: Record<string, string> = {
        ...(remoteConfig.headers || {})
      };
      
      // Add authentication headers if configured
      if (remoteConfig.auth) {
        switch (remoteConfig.auth.type) {
          case 'token':
            headers['Authorization'] = `Bearer ${remoteConfig.auth.token}`;
            break;
          case 'basic':
            if (remoteConfig.auth.username && remoteConfig.auth.password) {
              const authString = Buffer.from(
                `${remoteConfig.auth.username}:${remoteConfig.auth.password}`
              ).toString('base64');
              headers['Authorization'] = `Basic ${authString}`;
            }
            break;
          case 'oauth':
            if (remoteConfig.auth.token) {
              headers['Authorization'] = `token ${remoteConfig.auth.token}`;
            }
            break;
          case 'none':
          default:
            // No authentication headers needed
            break;
        }
      }
      
      // Make the request
      const request = requestModule.get(
        url,
        { headers },
        (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            // Handle redirects
            if (response.headers.location) {
              const redirectConfig: RemoteFileConfig = {
                ...remoteConfig,
                url: response.headers.location
              };
              downloadRemoteFile(redirectConfig, targetPath)
                .then(resolve)
                .catch(reject);
              return;
            }
          }
          
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download file: HTTP status ${response.statusCode}`));
            return;
          }
          
          const fileStream = fs.createWriteStream(targetPath);
          
          response.pipe(fileStream);
          
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
          
          fileStream.on('error', (err) => {
            // Clean up on error
            fs.unlink(targetPath, () => {
              reject(err);
            });
          });
        }
      );
      
      request.on('error', (err) => {
        reject(err);
      });
      
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Parses a remote file URL and creates the appropriate configuration
 * 
 * @param url The remote file URL
 * @param auth Optional authentication configuration
 * @returns The remote file configuration
 */
export function parseRemoteFile(
  url: string,
  auth?: RemoteFileConfig['auth']
): RemoteFileConfig {
  // GitHub specific handling
  if (url.includes('github.com') || url.includes('raw.githubusercontent.com')) {
    return parseGitHubUrl(url, auth);
  }
  
  // GitLab specific handling
  if (url.includes('gitlab.com')) {
    return parseGitLabUrl(url, auth);
  }
  
  // Default handling for other URLs
  return {
    url,
    auth
  };
}

/**
 * Parses a GitHub URL and creates the appropriate configuration
 * 
 * @param url The GitHub URL
 * @param auth Optional authentication configuration
 * @returns The remote file configuration
 */
function parseGitHubUrl(
  url: string,
  auth?: RemoteFileConfig['auth']
): RemoteFileConfig {
  // Convert GitHub URLs to raw.githubusercontent.com if needed
  if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
    // Replace github.com with raw.githubusercontent.com
    // and remove '/blob/' from the path
    url = url.replace('github.com', 'raw.githubusercontent.com')
              .replace('/blob/', '/');
  }
  
  return {
    url,
    auth
  };
}

/**
 * Parses a GitLab URL and creates the appropriate configuration
 * 
 * @param url The GitLab URL
 * @param auth Optional authentication configuration
 * @returns The remote file configuration
 */
function parseGitLabUrl(
  url: string,
  auth?: RemoteFileConfig['auth']
): RemoteFileConfig {
  // Convert GitLab URLs to raw if needed
  if (url.includes('gitlab.com') && url.includes('/blob/')) {
    // Replace /blob/ with /raw/ in the path
    url = url.replace('/blob/', '/raw/');
  }
  
  return {
    url,
    auth
  };
}

/**
 * Gets the appropriate file path for a remote configuration file
 * 
 * @param url The remote file URL
 * @param workspaceRoot The workspace root path
 * @returns The local path where the file should be stored
 */
export function getRemoteFilePath(url: string, workspaceRoot: string): string {
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;
  const pathname = urlObj.pathname;
  
  // Create a cache directory for remote files
  const cacheDir = path.join(workspaceRoot, '.niobium_cache', hostname);
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  // Use the pathname as the file path, but sanitize it
  const filename = pathname
    .split('/')
    .filter(Boolean)
    .join('_');
  
  return path.join(cacheDir, filename);
} 