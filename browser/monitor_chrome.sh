#!/bin/bash

NODE_SCRIPT_PATH="/app/playwright-mcp/cli.js"

chrome_pid=""
node_mcp_server_pid=""
current_ws_url=""

cleanup_processes() {
    echo "Cleaning up processes..."

    if [ -n "$node_mcp_server_pid" ] && kill -0 "$node_mcp_server_pid" 2>/dev/null; then
        echo "Killing Node.js Server (PID $node_mcp_server_pid)..."
        kill "$node_mcp_server_pid"
        wait "$node_mcp_server_pid" 2>/dev/null || true
    fi

    if [ -n "$chrome_pid" ] && kill -0 "$chrome_pid" 2>/dev/null; then
        echo "Killing Chrome (PID $chrome_pid)..."
        kill "$chrome_pid"
        wait "$chrome_pid" 2>/dev/null || true
    fi

    chrome_pid=""
    node_mcp_server_pid=""
    current_ws_url=""
}

cleanup_and_exit() {
    echo "Received termination signal. Exiting..."
    cleanup_processes
    exit 0
}

trap cleanup_and_exit SIGINT SIGTERM

start_chrome() {
    echo "Starting Chrome..."

    google-chrome --remote-debugging-port=9222 \
        --remote-debugging-address=0.0.0.0 \
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
    sleep 2
}

get_cdp_url() {
    local ws_url
    ws_url=$(curl --silent --max-time 2 http://localhost:9222/json/version | jq -r '.webSocketDebuggerUrl' 2>/dev/null)
    if [[ "$ws_url" == "null" ]] || [[ -z "$ws_url" ]]; then
        echo ""
    else
        echo "$ws_url"
    fi
}

start_node_process() {
    local ws_url="$1"
    echo "Starting Node.js MCP Server with WebSocket URL: $ws_url"

    node "$NODE_SCRIPT_PATH" --cdp-endpoint "$ws_url" --port 8921 --host 0.0.0.0 --vision &
    node_mcp_server_pid=$!
    current_ws_url="$ws_url"
    echo "Node.js MCP Server started with PID $node_mcp_server_pid"
    sleep 1
}

start_pulseaudio() {
    echo "[*] Starting PulseAudio..."
    pulseaudio --start --exit-idle-time=-1
    pactl load-module module-null-sink sink_name=ChromeSink sink_properties=device.description=ChromeAudioSink
    pactl set-default-sink ChromeSink
    echo "[*] PulseAudio started with ChromeSink"
}

start_streaming() {
    if [ -z "$RTMP_URL" ]; then
        echo "[!] RTMP URL not set. Skipping streaming setup."
        return
    fi

    echo "[*] Starting screen and audio streaming to $RTMP_URL..."

    ffmpeg -y \
        -f x11grab -framerate 30 -video_size 1920x1080 -i :99.0 \
        -f pulse -i default \
        -c:v libx264 -preset veryfast -maxrate 3000k -bufsize 6000k \
        -g 50 -c:a aac -b:a 160k -f flv "$RTMP_URL" > /dev/null 2>&1 &

    ffmpeg_pid=$!
    echo "FFmpeg started with PID $ffmpeg_pid"
}

monitor_processes() {
    echo "Monitoring processes and WebSocket URL..."
    while true; do
        sleep 2

        # Check Chrome
        if [ -n "$chrome_pid" ] && ! kill -0 "$chrome_pid" 2>/dev/null; then
            echo "[-] Chrome process (PID $chrome_pid) exited! Restarting..."
            return 1
        fi

        # Check Node.js
        if [ -n "$node_mcp_server_pid" ] && ! kill -0 "$node_mcp_server_pid" 2>/dev/null; then
            echo "[-] Node.js MCP Server (PID $node_mcp_server_pid) exited! Restarting..."
            return 1
        fi

        # Probe for updated CDP URL
        new_ws_url=$(get_cdp_url)

        if [ -z "$new_ws_url" ]; then
            echo "[!] CDP WebSocket URL not available. Skipping check..."
            continue
        fi

        if [ "$new_ws_url" != "$current_ws_url" ]; then
            echo "[⚠] CDP WebSocket URL has changed!"
            echo "Old: $current_ws_url"
            echo "New: $new_ws_url"

            if [ -n "$node_mcp_server_pid" ] && kill -0 "$node_mcp_server_pid" 2>/dev/null; then
                echo "Restarting Node.js MCP server..."
                kill "$node_mcp_server_pid"
                wait "$node_mcp_server_pid" 2>/dev/null || true
            fi

            start_node_process "$new_ws_url"
        fi
    done
}

main() {
    Xvfb :99 -screen 0 1920x1080x24 &
    export DISPLAY=:99
    x11vnc -display :99 -forever -nopw -shared &
    
    sleep 2
    
    if [ "$ENABLE_RECORDING" = "true" ]; then
        start_pulseaudio
        start_streaming
    fi

    while true; do
        cleanup_processes
        start_chrome

        ws_url=$(get_cdp_url)

        if [ -z "$ws_url" ]; then
            echo "Failed to get WebSocket URL. Retrying..."
            sleep 2
            continue
        fi

        start_node_process "$ws_url"
        monitor_processes

        echo "Restarting cycle in 2 seconds..."
        sleep 2
    done
}

sleep 10
main
