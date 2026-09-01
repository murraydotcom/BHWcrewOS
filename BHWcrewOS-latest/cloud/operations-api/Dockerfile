FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY *.mjs ./
ENV NODE_ENV=production
USER node
CMD ["node", "server.mjs"]
