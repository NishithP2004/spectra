FROM node:alpine 
WORKDIR /app
COPY package*.json .
RUN npm ci 
COPY . .
ENV PORT=80
EXPOSE 80
CMD [ "node", "router.js" ]