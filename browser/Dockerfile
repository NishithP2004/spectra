FROM selenium/standalone-chrome

EXPOSE 7900 4444 9222

USER root

COPY monitor_chrome.sh /usr/bin/monitor_chrome.sh
RUN chmod +x /usr/bin/monitor_chrome.sh

USER seluser

CMD ["/bin/bash", "-c", "(/usr/bin/monitor_chrome.sh &) && /opt/bin/entry_point.sh"]