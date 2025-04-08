#!/bin/bash

while true; do
    # Check if Chrome is running
    if ! pgrep -x "chrome" > /dev/null; then
        echo "Chrome is not running. Restarting..."

        # Start Chrome with necessary flags
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
            --user-data-dir=/tmp/chrome-profile &

        echo "Chrome started successfully."
    fi
    sleep 2
done