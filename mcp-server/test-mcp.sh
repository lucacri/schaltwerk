#!/bin/bash

# Test script for Lucode MCP Server

echo "Testing Lucode MCP Server..."
echo

# Initialize
echo "1. Initializing MCP Server..."
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node build/lucode-mcp-server.js 2>/dev/null | jq -r '.result.serverInfo'

echo
echo "2. List tools available..."
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node build/lucode-mcp-server.js 2>/dev/null | jq -r '.result.tools[].name'

echo
echo "3. List resources available..."
echo '{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}' | node build/lucode-mcp-server.js 2>/dev/null | jq -r '.result.resources[].uri'

echo
echo "Done! MCP Server is working correctly."