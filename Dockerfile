FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["npm", "run", "start"]
