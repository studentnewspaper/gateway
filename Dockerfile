FROM node:16

WORKDIR /app

COPY package*.json ./
RUN npm i

COPY . .

ARG NODE_ENV=${NODE_ENV}
ARG DATABASE_URL=${DATABASE_URL}

RUN npm run build

EXPOSE 8076
CMD ["node", "dist/index.js"]