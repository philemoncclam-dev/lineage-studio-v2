# Container image for the Lineage Studio backend, including the Spark sandbox.
#
# Unlike local dev (where Spark lives in a separate pinned venv, sandbox/.venv312),
# the container installs PySpark into the app's own interpreter — the runner
# detects that (importlib.find_spec("pyspark")) and runs the Spark executor with
# the current python, no separate venv needed.
#
# Targets a container host that can run a JVM (Cloud Run / Fly / Render / a VM).
# NOT Vercel — serverless can't host Spark. Build from the repo root:
#     docker build -t lineage-backend .
#     docker run -p 8080:8080 --env-file backend/../.env lineage-backend
#
# GIVE THIS CONTAINER NO SECRETS. It runs the Spark engine, which `exec()`s
# notebook cells, and the child shares this process's uid — so anything in the
# environment is readable via /proc/1/environ by any cell that runs. See the
# isolation note in app/sandbox/runner.py. `SANDBOX_REQUIRE_AUTH` (default on)
# decides who may run one; this decides what they'd find if they did.
# In particular do NOT set PURVIEW_CLIENT_SECRET, DATABASE_URL or
# ANTHROPIC_API_KEY here — those belong on the stub-engine deployment.

FROM python:3.12-slim-bookworm

# Java 17 (Spark 4.0 supports Java 17 and 21) + procps (Spark shells out to `ps`).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless procps \
 && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

WORKDIR /app

# Python deps first (better layer caching). PySpark is pinned to match local dev.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt pyspark==4.0.0

# Backend source.
COPY backend/ ./

# Turns on the deployment assertions in app/startup_checks.py — which is what
# now ENFORCES the rule stated in capitals above, rather than trusting whoever
# next edits this file to have read it. The container refuses to boot if a
# forbidden secret is set on it, or if the sandbox auth gate has been turned off.
ENV APP_ENV=production

# Spark/Ivy want a writable HOME; Cloud Run's only reliably writable path is /tmp.
ENV HOME=/tmp

# Cloud Run (and most hosts) inject PORT; default to 8080 locally.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
