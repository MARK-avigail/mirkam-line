FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY requirements-document.txt ./
RUN python3 -m venv /opt/pdf && /opt/pdf/bin/pip install --no-cache-dir -r requirements-document.txt
COPY src ./src
COPY scripts ./scripts
COPY public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PYTHON_BIN=/opt/pdf/bin/python MIRKAM_DATA_DIR=/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/mirkam-server.js"]
