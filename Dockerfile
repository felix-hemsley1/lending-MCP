FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Runtime data + widget assets loaded by the tools (paths resolve relative to
# dist/, i.e. the project root inside the image).
COPY data ./data
COPY widget ./widget
EXPOSE 3000
CMD ["node", "dist/server.js"]
