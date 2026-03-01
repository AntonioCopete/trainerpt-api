FROM node:24-alpine AS production

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy package files and prisma
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install ALL dependencies (including dev) for build
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client and build
RUN pnpm run db:generate && pnpm run build

# Migraciones se ejecutan en GitHub Actions, NO aquí
CMD ["node", "dist/src/main.js"]
