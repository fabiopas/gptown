FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build:web

ENV NODE_ENV=production
EXPOSE 4200

CMD ["npm", "start"]
