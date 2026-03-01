# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client and build
RUN pnpm run db:generate && pnpm run build

# Stage 2: Production
FROM node:24-alpine AS production

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install ONLY production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built app and generated Prisma client from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated

# Expose port (Cloud Run uses $PORT env var)
EXPOSE 8080

# Start the app (migrations run via Cloud Run Job or init container)
CMD ["node", "dist/src/main.js"]
