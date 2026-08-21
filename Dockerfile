FROM denoland/deno:2.9.5 AS builder

WORKDIR /app
COPY . .
RUN deno task css
RUN deno cache main.tsx
RUN deno task build

FROM denoland/deno:2.9.5

WORKDIR /app
COPY --from=builder /deno-dir /deno-dir
COPY --from=builder /app/node_modules ./node_modules
COPY deno.json deno.lock ./
COPY main.tsx ./
COPY src ./src
COPY lib ./lib
COPY assets ./assets
COPY --from=builder /app/static ./static
RUN mkdir -p /app/.data

EXPOSE 8000

CMD ["run", "-A", "--unstable-kv", "--unstable-cron", "main.tsx"]
