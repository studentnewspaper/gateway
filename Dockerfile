FROM node:16

WORKDIR /app

COPY package*.json ./
RUN npm i

COPY . .

ARG NODE_ENV=${NODE_ENV}

RUN npm i -g npm
RUN npm run gen:sql
RUN npm run build

EXPOSE 8076
CMD ["node", "dist/index.js"]