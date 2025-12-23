FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    man-db \
    nmap \
    nikto \
    sqlmap \
    gobuster \
    hydra \
    wfuzz \
    dirb \
    wpscan \
    metasploit-framework \
    john \
    enum4linux \
    sudo \
    curl \
    gnupg \
    ruby ruby-dev build-essential libcurl4-openssl-dev libxml2-dev libxslt1-dev zlib1g-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mandb && \
    if [ -f /usr/share/wordlists/rockyou.txt.gz ]; then gunzip /usr/share/wordlists/rockyou.txt.gz; fi

WORKDIR /app

COPY . .

RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

ENV API_PORT=5000 MCP_SERVER_PORT=5001
EXPOSE 5000 5001

CMD ["bash", "-c", "python3 kali_server.py & python3 main.py"]