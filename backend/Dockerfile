FROM node:20-alpine AS base

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npx prisma generate && npm prune --omit=dev

EXPOSE 4000

CMD ["npm", "start"]
