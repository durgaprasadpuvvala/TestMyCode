FROM node:18

# Add GCC, JDK, and Python
RUN apt-get update && \
    apt-get install -y gcc default-jdk python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Render dynamically assigns a port, but our code defaults to 3000
EXPOSE 3000
CMD ["node", "server.js"]