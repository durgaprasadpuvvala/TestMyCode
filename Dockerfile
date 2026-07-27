FROM node:18

# Install compilers for student code execution
RUN apt-get update && apt-get install -y \
    gcc \
    default-jdk \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]