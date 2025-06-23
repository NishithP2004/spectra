FROM tiangolo/nginx-rtmp

RUN apt-get update && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /var/log/rtmp /tmp/recordings && \
    chown -R www-data:www-data /tmp/recordings && \
    chmod -R 777 /tmp/recordings

COPY nginx.conf /etc/nginx/nginx.conf

WORKDIR /app

COPY package*.json .
RUN npm ci
COPY upload_to_gcs.js redis.js ./