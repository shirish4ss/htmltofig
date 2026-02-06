#!/usr/bin/env node

/**
 * SSE Server for Figma Plugin - Dedicated Server-Sent Events Server
 * This runs separately from the MCP server to avoid conflicts
 */

import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SERVER_CONFIG, getSSEStreamURL, getHealthURL } from './config/server-config.js';

// ES module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[SSE-SERVER] Starting dedicated SSE server for Figma plugin...');
console.log('[SSE-SERVER] Working directory:', __dirname);

class FigmaSSEServer {
  constructor() {
    // Map of sessionId -> connection (for multi-user routing)
    this.sseConnections = new Map();
    this.httpServer = null;
    this.sharedDataPath = path.join(__dirname, SERVER_CONFIG.SHARED_DATA_FILE);
    this.lastProcessedRequestId = null;

    console.log(`[SSE-SERVER] Environment: ${SERVER_CONFIG.NODE_ENV}`);
    console.log(`[SSE-SERVER] API Key configured: ${SERVER_CONFIG.API_KEY ? 'Yes' : 'No'}`);

    // Watch for file changes
    this.setupFileWatcher();
    this.setupSSEServer();
  }

  // Verify API key for protected endpoints
  verifyApiKey(req) {
    // In development, allow requests without API key
    if (SERVER_CONFIG.NODE_ENV === 'development' && SERVER_CONFIG.API_KEY === 'dev-key') {
      return true;
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }

    const providedKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    return providedKey === SERVER_CONFIG.API_KEY;
  }

  setupFileWatcher() {
    // Watch the shared data file for changes from MCP server
    try {
      fs.watchFile(this.sharedDataPath, (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          console.log('[SSE-SERVER] Shared file changed, processing...');
          this.processSharedFile();
        }
      });
      console.log('[SSE-SERVER] File watcher setup for:', this.sharedDataPath);
    } catch (error) {
      console.log('[SSE-SERVER] File watcher setup failed:', error.message);
    }
  }

  processSharedFile() {
    try {
      if (!fs.existsSync(this.sharedDataPath)) {
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.sharedDataPath, 'utf8'));
      
      // Avoid processing the same request twice
      if (data.requestId === this.lastProcessedRequestId) {
        return;
      }

      console.log('[SSE-SERVER] Processing shared data:', data.requestId);
      this.lastProcessedRequestId = data.requestId;
      
      // Broadcast to all SSE connections
      this.broadcastToSSEClients(data);
      
    } catch (error) {
      console.error('[SSE-SERVER] Error processing shared file:', error);
    }
  }

  setupSSEServer() {
    this.httpServer = http.createServer((req, res) => {
      // Use URL class for more robust parsing
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers.host || 'localhost';
      const fullUrl = new URL(req.url, `${protocol}://${host}`);

      const parsedUrl = {
        pathname: fullUrl.pathname,
        query: Object.fromEntries(fullUrl.searchParams)
      };

      // Normalize pathname: remove trailing slashes and multiple slashes
      const pathname = (parsedUrl.pathname || '/').replace(/\/+/g, '/').replace(/\/+$/, '') || '/';

      console.log(`[SSE-SERVER] ${req.method} ${req.url} -> Pathname: ${pathname}`);

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        });
        res.end();
        return;
      }

      // SSE Endpoint
      if (pathname === SERVER_CONFIG.ENDPOINTS.SSE_STREAM) {
        this.handleSSEConnection(req, res, parsedUrl.query);
        return;
      }

      // MCP Trigger endpoint (for MCP server notifications)
      if (pathname === SERVER_CONFIG.ENDPOINTS.MCP_TRIGGER && req.method === 'POST') {
        this.handleMCPTrigger(req, res);
        return;
      }

      // URL Proxy endpoint (to bypass CORS)
      if (pathname === SERVER_CONFIG.ENDPOINTS.PROXY) {
        this.handleProxyRequest(req, res, parsedUrl.query);
        return;
      }

      // Status endpoint
      if (pathname === SERVER_CONFIG.ENDPOINTS.HEALTH) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': SERVER_CONFIG.ALLOWED_ORIGINS
        });
        res.end(JSON.stringify({
          status: 'running',
          environment: SERVER_CONFIG.NODE_ENV,
          activeConnections: this.sseConnections.size,
          activeSessions: this.getActiveSessions(),
          sseEndpoint: getSSEStreamURL(),
          version: '3.0.0-multiuser',
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // Test broadcast endpoint
      if (pathname === SERVER_CONFIG.ENDPOINTS.TEST_BROADCAST) {
        const testMessage = {
          type: 'test-message',
          message: 'SSE server test broadcast',
          timestamp: new Date().toISOString()
        };
        const success = this.broadcastToSSEClients(testMessage);
        
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          success: success,
          activeConnections: this.sseConnections.size,
          message: testMessage
        }));
        return;
      }

      // 404 for other paths
      console.log(`[SSE-SERVER] 404 Not Found: ${req.method} ${parsedUrl.pathname} (Normalized: ${pathname})`);
      console.log(`[SSE-SERVER] Available endpoints:`, Object.values(SERVER_CONFIG.ENDPOINTS));

      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: 'Not Found',
        path: parsedUrl.pathname,
        normalizedPath: pathname,
        method: req.method,
        availableEndpoints: SERVER_CONFIG.ENDPOINTS
      }));
    });

    // Start the server
    this.httpServer.listen(SERVER_CONFIG.PORT, () => {
      console.log(`[SSE-SERVER] Server listening on port ${SERVER_CONFIG.PORT}`);
      console.log(`[SSE-SERVER] SSE endpoint: ${getSSEStreamURL()}`);
      console.log(`[SSE-SERVER] Status endpoint: ${getHealthURL()}`);
    });
  }

  handleSSEConnection(req, res, query) {
    // Extract sessionId from query params
    const sessionId = query.sessionId;

    if (!sessionId) {
      console.log('[SSE-SERVER] Connection rejected: No sessionId provided');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'sessionId query parameter is required' }));
      return;
    }

    console.log(`[SSE-SERVER] New SSE connection for session: ${sessionId}`);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': SERVER_CONFIG.ALLOWED_ORIGINS,
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Store connection with sessionId
    this.sseConnections.set(sessionId, res);

    // Send initial connection confirmation
    this.sendSSEMessage(res, {
      type: 'connection-established',
      message: 'SSE connection established',
      sessionId: sessionId,
      activeConnections: this.sseConnections.size,
      timestamp: new Date().toISOString()
    });

    // Keep connection alive with periodic heartbeat
    const heartbeat = setInterval(() => {
      if (!res.destroyed) {
        this.sendSSEMessage(res, {
          type: 'heartbeat',
          timestamp: new Date().toISOString()
        });
      }
    }, SERVER_CONFIG.TIMEOUTS.HEARTBEAT);

    // Handle connection close
    req.on('close', () => {
      console.log(`[SSE-SERVER] SSE connection closed for session: ${sessionId}`);
      clearInterval(heartbeat);
      this.sseConnections.delete(sessionId);
    });
  }

  handleMCPTrigger(req, res) {
    // Verify API key for production
    if (!this.verifyApiKey(req)) {
      console.log('[SSE-SERVER] MCP trigger rejected: Invalid API key');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing API key' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const sessionId = data.sessionId;

        console.log(`[SSE-SERVER] MCP trigger received for session: ${sessionId}, requestId: ${data.requestId}`);

        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'sessionId is required in request body' }));
          return;
        }

        // Send to specific session instead of broadcast
        const success = this.sendToSession(sessionId, data);

        if (success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sessionId: sessionId }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Session not found or not connected',
            sessionId: sessionId,
            activeConnections: this.sseConnections.size
          }));
        }
      } catch (error) {
        console.error('[SSE-SERVER] Error handling MCP trigger:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }

  // Send message to specific session
  sendToSession(sessionId, data) {
    const connection = this.sseConnections.get(sessionId);

    if (!connection) {
      console.log(`[SSE-SERVER] Session not found: ${sessionId}`);
      console.log(`[SSE-SERVER] Active sessions: ${Array.from(this.sseConnections.keys()).join(', ')}`);
      return false;
    }

    console.log(`[SSE-SERVER] Sending to session: ${sessionId}`);
    return this.sendSSEMessage(connection, data);
  }

  sendSSEMessage(res, data) {
    if (res.destroyed) return false;
    
    try {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      res.write(message);
      return true;
    } catch (error) {
      console.error('[SSE-SERVER] Error sending SSE message:', error);
      return false;
    }
  }

  broadcastToSSEClients(data) {
    if (this.sseConnections.size === 0) {
      console.log('[SSE-SERVER] No active SSE connections to broadcast to');
      return false;
    }

    console.log(`[SSE-SERVER] Broadcasting to ${this.sseConnections.size} connections`);

    let successCount = 0;
    for (const [sessionId, connection] of this.sseConnections) {
      if (this.sendSSEMessage(connection, data)) {
        successCount++;
      }
    }

    console.log(`[SSE-SERVER] Broadcast successful to ${successCount}/${this.sseConnections.size} connections`);
    return successCount > 0;
  }

  // Get list of active session IDs
  getActiveSessions() {
    return Array.from(this.sseConnections.keys());
  }

  // Handle URL proxy request to bypass CORS
  async handleProxyRequest(req, res, query) {
    const targetUrl = query.url;

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'url query parameter is required' }));
      return;
    }

    console.log(`[SSE-SERVER] Proxying request for URL: ${targetUrl}`);

    try {
      // Use a more modern and complete User-Agent
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        redirect: 'follow', // Explicitly follow redirects
        signal: AbortSignal.timeout(15000) // Increase timeout to 15 seconds
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[SSE-SERVER] Proxy target error: ${response.status} for ${targetUrl}`);
        res.writeHead(response.status >= 400 && response.status < 600 ? response.status : 500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          error: `Target server returned ${response.status}`,
          details: errorText.substring(0, 200)
        }));
        return;
      }

      const contentType = response.headers.get('content-type');
      const buffer = await response.arrayBuffer();

      res.writeHead(200, {
        'Content-Type': contentType || 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Proxied-Url',
        'X-Proxied-Url': targetUrl,
        'Cache-Control': 'no-store'
      });
      res.end(Buffer.from(buffer));
      console.log(`[SSE-SERVER] Proxy successful: ${targetUrl} (${contentType})`);
    } catch (error) {
      console.error(`[SSE-SERVER] Proxy error for ${targetUrl}:`, error.name === 'TimeoutError' ? 'Timeout' : error.message);
      res.writeHead(error.name === 'TimeoutError' ? 504 : 500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: error.message }));
    }
  }

  async start() {
    console.log('[SSE-SERVER] SSE server started successfully');
  }

  shutdown() {
    console.log('[SSE-SERVER] Shutting down SSE server...');

    // Close all SSE connections
    for (const [sessionId, connection] of this.sseConnections) {
      try {
        console.log(`[SSE-SERVER] Closing connection for session: ${sessionId}`);
        connection.end();
      } catch (error) {
        console.error('[SSE-SERVER] Error closing SSE connection:', error);
      }
    }

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
    }

    // Stop file watcher
    if (fs.existsSync(this.sharedDataPath)) {
      fs.unwatchFile(this.sharedDataPath);
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[SSE-SERVER] Received SIGINT, shutting down gracefully...');
  if (sseServer) {
    sseServer.shutdown();
  }
  process.exit(0);
});

// Start the dedicated SSE server
const sseServer = new FigmaSSEServer();
sseServer.start().catch(error => {
  console.error('[SSE-SERVER] Failed to start:', error);
  process.exit(1);
}); 