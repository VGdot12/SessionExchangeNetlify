FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home appuser
COPY session_swap ./session_swap
RUN mkdir /app/data && chown -R appuser:appuser /app
USER appuser
ENV SWAP_DB=/app/data/swaps.sqlite3
EXPOSE 8000
CMD ["sh", "-c", "python -m session_swap init && exec gunicorn --bind 0.0.0.0:8000 --workers 2 --threads 4 --timeout 60 session_swap.web:application"]
