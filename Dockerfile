FROM node:20-alpine

WORKDIR /app

# 先拷 package.json 走缓存
COPY package.json ./
RUN npm install --production --registry=https://registry.npmmirror.com

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 用 node 自己发请求做健康检查（alpine 的 busybox wget 在 --spider 下表现不稳）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
