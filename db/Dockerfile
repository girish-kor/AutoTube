FROM postgres:16-alpine

COPY migrations /migrations
COPY run-migrations.sh /run-migrations.sh
RUN chmod +x /run-migrations.sh

WORKDIR /
ENTRYPOINT []
CMD ["./run-migrations.sh"]
