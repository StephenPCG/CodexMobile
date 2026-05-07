FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_INDEX_URL=https://mirrors.ustc.edu.cn/pypi/simple
ENV PIP_EXTRA_INDEX_URL=https://mirrors.aliyun.com/pytorch-wheels/cpu
ENV MODELSCOPE_CACHE=/models
ENV HF_HOME=/models/huggingface
ENV HF_ENDPOINT=https://hf-mirror.com

WORKDIR /app

RUN sed -i \
    -e 's|http://deb.debian.org/debian|http://mirrors.ustc.edu.cn/debian|g' \
    -e 's|http://security.debian.org/debian-security|http://mirrors.ustc.edu.cn/debian-security|g' \
    /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libsndfile1 git \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --index-url https://mirrors.aliyun.com/pytorch-wheels/cpu \
  --extra-index-url https://mirrors.ustc.edu.cn/pypi/simple \
  torch==2.5.1+cpu torchaudio==2.5.1+cpu

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
