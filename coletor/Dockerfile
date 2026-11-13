# Mesma versão do Playwright do script (requirements do repositório: playwright==1.47.0)
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy
ENV TZ=America/Sao_Paulo PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY coletor.py nextsoft_export_to_drive.py nextsoft_xml.py nextsoft_estoque.py fixe_export.py ./
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/saude',timeout=3)"
CMD ["python", "coletor.py"]
