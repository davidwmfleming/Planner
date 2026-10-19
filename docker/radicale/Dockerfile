# Radicale, the calendar server that holds every event and task as plain .ics files in /data.
FROM python:3.13.16-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
RUN pip install --no-cache-dir radicale==3.8.3 \
	&& useradd --system --uid 5232 --home-dir /data radicale \
	&& mkdir -p /data/collections && chown -R radicale /data
COPY config /etc/radicale/config
COPY entrypoint.sh /entrypoint.sh
USER radicale
VOLUME /data
EXPOSE 5232
ENTRYPOINT ["sh", "/entrypoint.sh"]
