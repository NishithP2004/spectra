#!/bin/bash

NODE_SCRIPT_PATH_1="./puppeteer_mcp/server/index.js"
NODE_SCRIPT_PATH_2="./puppeteer_mcp/client/index.js"

chrome_pid=""
node_mcp_server_pid=""
node_mcp_client_pid=""

cleanup() {
    echo "Cleaning up..."

    if [ -n "$node_mcp_server_pid" ] && kill -0 "$node_mcp_server_pid" 2>/dev/null; then
        echo "Killing Node.js process (PID $node_mcp_server_pid)..."
        kill "$node_mcp_server_pid"
    fi

    if [ -n "$node_mcp_client_pid" ] && kill -0 "$node_mcp_client_pid" 2>/dev/null; then
        echo "Killing Node.js process (PID $node_mcp_client_pid)..."
        kill "$node_mcp_client_pid"
    fi

    if [ -n "$chrome_pid" ] && kill -0 "$chrome_pid" 2>/dev/null; then
        echo "Killing Chrome process (PID $chrome_pid)..."
        kill "$chrome_pid"
    fi

    exit 0
}

trap cleanup SIGINT SIGTERM

while true; do
    echo "Starting Chrome..."

    google-chrome --remote-debugging-port=9222 \
        --start-maximized \
        --no-first-run \
        --disable-infobars \
        --disable-features=DefaultBrowserSettingEnabled \
        --disable-default-apps \
        --no-default-browser-check \
        --disable-background-networking \
        --disable-sync \
        --disable-translate \
        --disable-notifications \
        --disable-save-password-bubble \
        --disable-prompt-on-repost \
        --disable-crash-reporter \
        --disable-component-update \
        --disable-domain-reliability \
        --disable-client-side-phishing-detection \
        --disable-backgrounding-occluded-windows \
        --disable-popup-blocking \
        --disable-dev-shm-usage \
        --disable-gpu \
        --user-data-dir=/tmp/chrome-profile \
        --no-sandbox &

    chrome_pid=$!
    echo "Chrome started with PID $chrome_pid"

    echo "Waiting for DevTools WebSocket URL..."
    until WS_URL=$(curl -s localhost:9222/json/version | jq -r '.webSocketDebuggerUrl'); do
        sleep 1
    done
    echo "Got DevTools URL: $WS_URL"

    echo "Starting Node.js with DevTools URL..."
    node "$NODE_SCRIPT_PATH_1" "$WS_URL" &
    node_mcp_server_pid=$!
    echo "Node.js MCP Server started with PID $node_mcp_server_pid"

    node "$NODE_SCRIPT_PATH_2" &
    node_mcp_client_pid=$!
    echo "Node.js MCP Client started with PID $node_mcp_client_pid"

    # Wait for either Chrome or Node.js to exit
    while kill -0 "$chrome_pid" 2>/dev/null && kill -0 "$node_mcp_server_pid" 2>/dev/null  && kill -0 "$node_mcp_client_pid" 2>/dev/null; do
        sleep 1
    done

    echo "Detected one process exited. Restarting both..."
    cleanup
done