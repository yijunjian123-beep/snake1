FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.server.json ./
RUN npm ci

COPY server ./server
COPY src/game ./src/game
COPY src/pvp ./src/pvp

RUN npm run build:pvp-server

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist-server ./dist-server

RUN chown -R node:node /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "const http=require('node:http'); const port=process.env.PORT||8787; const req=http.get({host:'127.0.0.1',port,path:'/health',timeout:2000},(res)=>{res.resume(); process.exit(res.statusCode===200?0:1);}); req.on('error',()=>process.exit(1)); req.on('timeout',()=>{req.destroy(); process.exit(1);});"

CMD ["npm", "run", "start:pvp-server"]
