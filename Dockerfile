FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Create database directory if it doesn't exist
RUN mkdir -p database

# Default environment variables
ENV HOST=0.0.0.0
ENV PORT=8001

EXPOSE 8001

CMD ["python", "app.py"]
