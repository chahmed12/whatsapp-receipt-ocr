FROM python:3.11-slim

RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs tesseract-ocr tesseract-ocr-fra tesseract-ocr-ara && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ocr/requirements.txt ocr/
RUN pip install --no-cache-dir -r ocr/requirements.txt

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "webhook.js"]
