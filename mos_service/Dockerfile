FROM python:3.9-slim

RUN apt-get update && apt-get install -y ffmpeg build-essential

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

EXPOSE 8080
CMD ["python", "app.py"]
