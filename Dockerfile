FROM node:20-alpine

WORKDIR /app

# 先拷 package.json 走缓存
COPY package.json ./
RUN npm install --production --registry=https://registry.npmmirror.com

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
