FROM denoland/deno:2.9.7

WORKDIR /app
COPY . .
RUN deno cache main.tsx

EXPOSE 8000

CMD ["run", "-A", "--unstable-kv", "--unstable-cron", "main.tsx"]
