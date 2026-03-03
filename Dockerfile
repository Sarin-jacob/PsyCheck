# ==================================================================
# Stage 1: 'builder' - Install deps and Setup Directories
# ==================================================================
FROM node:20-slim AS builder

WORKDIR /app

# 1. Install App Dependencies
# We need build tools for better-sqlite3 in some envs, but prebuilds usually work.
# If npm install fails, uncomment the next line:
# RUN apt-get update && apt-get install -y python3 make g++ 
COPY package.json .
RUN npm install

# 2. Copy Source Code
COPY server.js .

# 3. Prepare Public Assets
# We copy the local 'public' folder to the container
COPY public ./public

# 4. Prepare Database Directory
# We must create this here and assign permissions because 'distroless'
# has no shell or 'mkdir' command.
RUN mkdir -p /data
# 65532 is the uid of the 'nonroot' user in distroless
RUN chown -R 65532:65532 /data

# Prune dev dependencies (if any) to keep image small
RUN npm prune --production

# ==================================================================
# Stage 2: 'final' - Distroless Node Image
# ==================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot
USER nonroot

WORKDIR /app

# Copy node_modules (production only)
COPY --from=builder /app/node_modules /app/node_modules

# Copy Server Code
COPY --from=builder /app/server.js /app/server.js
COPY --from=builder /app/package.json /app/package.json

# Copy Public Assets (As is, no minification)
COPY --from=builder /app/public /app/public

# Copy the Data directory with correct permissions
COPY --from=builder --chown=65532:65532 /data /data

# Set Environment
ENV NODE_ENV=production
ENV DB_PATH=/data/storage.db
ENV BASE_URL=/

# Expose Port
EXPOSE 8080

# Define Volume for persistence
VOLUME ["/data"]

# Distroless nodejs entrypoint is implicit "node"
CMD ["server.js"]