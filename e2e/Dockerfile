FROM denoland/deno:2.9.6

WORKDIR /app
COPY . .
RUN deno cache main.tsx

EXPOSE 8000

CMD ["run", "-A", "--unstable-kv", "--unstable-cron", "main.tsx"]
