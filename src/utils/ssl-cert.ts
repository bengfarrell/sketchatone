/**
 * SSL Certificate Generation Utility
 * 
 * Generates self-signed SSL certificates for HTTPS and WSS servers.
 * Used for captive portal detection on Android 10+ and secure WebSocket connections.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SSLCertPaths {
  certFile: string;
  keyFile: string;
}

/**
 * Get SSL certificate paths
 * Store in user's home directory or /opt/sketchatone for system installs
 */
export function getSSLCertPaths(): SSLCertPaths {
  let sslDir: string;
  
  if (fs.existsSync('/opt/sketchatone')) {
    sslDir = '/opt/sketchatone/ssl';
  } else {
    sslDir = path.join(os.homedir(), '.sketchatone', 'ssl');
  }

  return {
    certFile: path.join(sslDir, 'cert.pem'),
    keyFile: path.join(sslDir, 'key.pem'),
  };
}

/**
 * Generate a self-signed SSL certificate using OpenSSL
 * 
 * @returns true if certificate was generated or already exists, false on failure
 */
export function generateSelfSignedCert(): boolean {
  const { certFile, keyFile } = getSSLCertPaths();

  // Check if certificate already exists
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return true;
  }

  try {
    // Ensure directory exists
    const sslDir = path.dirname(certFile);
    if (!fs.existsSync(sslDir)) {
      fs.mkdirSync(sslDir, { mode: 0o755, recursive: true });
    }

    // Generate self-signed certificate using OpenSSL
    // Valid for 365 days, 2048-bit RSA key
    const opensslCmd = `openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "${keyFile}" \
      -out "${certFile}" \
      -days 365 \
      -subj "/C=US/ST=CA/L=Local/O=Sketchatone/CN=localhost"`;

    execSync(opensslCmd, { stdio: 'pipe' });

    // Set appropriate permissions
    fs.chmodSync(keyFile, 0o600); // Private key readable only by owner
    fs.chmodSync(certFile, 0o644); // Certificate readable by all

    return true;
  } catch (error) {
    console.warn('Warning: Failed to generate SSL certificate:', error instanceof Error ? error.message : error);
    console.warn('HTTPS and WSS will not be available.');
    console.warn('Make sure OpenSSL is installed: brew install openssl (macOS) or apt-get install openssl (Linux)');
    return false;
  }
}

/**
 * Load SSL certificate and key files
 * 
 * @returns Object with cert and key contents, or null if files don't exist
 */
export function loadSSLCert(): { cert: Buffer; key: Buffer } | null {
  const { certFile, keyFile } = getSSLCertPaths();

  try {
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
      return null;
    }

    return {
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile),
    };
  } catch (error) {
    console.warn('Warning: Failed to load SSL certificate:', error instanceof Error ? error.message : error);
    return null;
  }
}

