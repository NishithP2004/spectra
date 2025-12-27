FROM selenium/standalone-chrome

USER root

EXPOSE 7900 8921

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        gnupg \
        build-essential \
        jq \
        dos2unix \
        ffmpeg \
        pulseaudio \
        x11vnc \
        pavucontrol \
        alsa-utils \
        sox \
        libsox-fmt-all \
        scrot \
        x11-utils \
        x11-xserver-utils \
        dbus-x11 \
        xserver-xephyr \
        xvfb \
        libxrender1 \
        libxext6 \
        libsm6 \
        wmctrl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g typescript && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY monitor_chrome.sh /usr/bin/monitor_chrome.sh
RUN dos2unix /usr/bin/monitor_chrome.sh && \
    chmod 755 /usr/bin/monitor_chrome.sh

WORKDIR /app
RUN mkdir -p /app/playwright-mcp && \
    chown -R seluser:seluser /app

COPY playwright-mcp/package*.json /app/playwright-mcp/

WORKDIR /app/playwright-mcp/
RUN npm ci

WORKDIR /app

RUN chown -R seluser:seluser /app
COPY . /app

WORKDIR /app/playwright-mcp/
RUN npm run build

USER seluser

CMD ["bash", "-c", "/usr/bin/monitor_chrome.sh & exec /opt/bin/entry_point.sh"]