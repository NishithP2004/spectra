FROM selenium/standalone-chrome

EXPOSE 7900 4444 9222

USER root

COPY monitor_chrome.sh /usr/bin/monitor_chrome.sh
RUN chmod +x /usr/bin/monitor_chrome.sh

USER seluser

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash && \
    bash -c "source $HOME/.nvm/nvm.sh && nvm install 22 && nvm use 22"

WORKDIR /app
COPY ./puppeteer_mcp/package*.json .
RUN bash -c "source $HOME/.nvm/nvm.sh && nvm install 22 && npm install"
COPY . .
ENV SERVER_PORT=3000 CLIENT_PORT=3001
EXPOSE 3000 3001

CMD ["/bin/bash", "-c", "(/usr/bin/monitor_chrome.sh &) && (/opt/bin/entry_point.sh)"]