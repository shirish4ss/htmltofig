#!/usr/bin/env node

/**
 * Diagnostic script for MCP + SSE system
 * Run: npm run diagnose
 */

import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('🔍 HTML-to-Figma System Diagnostic\n');

// 1. Check required files
console.log('1. Checking files...');
const files = [
  'mcp-server.js',
  'sse-server.js',
  'code.js',
  'ui.html',
  'config/server-config.js'
];

files.forEach(file => {
  const filePath = path.join(projectRoot, file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ ${file}`);
  } else {
    console.log(`   ❌ ${file} NOT FOUND`);
  }
});

// 2. Test MCP Server
console.log('\n2. Testing MCP Server...');
const mcpChild = spawn('node', [path.join(projectRoot, 'mcp-server.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let mcpWorking = false;

mcpChild.stderr.on('data', (data) => {
  const output = data.toString();
  if (output.includes('[MCP-SERVER]')) {
    mcpWorking = true;
  }
});

// 3. Test SSE Server
console.log('3. Testing SSE Server...');
const sseChild = spawn('node', [path.join(projectRoot, 'sse-server.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let sseWorking = false;

sseChild.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('listening on port')) {
    sseWorking = true;
  }
});

// Wait for servers to start
setTimeout(() => {
  mcpChild.kill('SIGTERM');
  sseChild.kill('SIGTERM');

  console.log('\n📋 Diagnostic Summary:');
  console.log(`   ${mcpWorking ? '✅' : '❌'} MCP Server: ${mcpWorking ? 'OK' : 'Error'}`);
  console.log(`   ${sseWorking ? '✅' : '❌'} SSE Server: ${sseWorking ? 'OK' : 'Error'}`);

  console.log('\n🚀 Quick Start:');
  console.log('   1. npm start              # Start SSE server');
  console.log('   2. Open Figma plugin      # Enable MCP Bridge');
  console.log('   3. Use MCP tool in AI     # Send HTML to Figma');

  console.log('\n📝 Generate config: npm run generate-config\n');

}, 2000);
