#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# These images/containers never mount developer volumes or publish host ports.
containers=()
cleanup() {
  for container in "${containers[@]}"; do docker rm -f "$container" >/dev/null; done
}
trap cleanup EXIT

build_failed=false
docker build -f infrastructure/docker/api.Dockerfile -t omniroute-api:verify . || build_failed=true
docker build -f infrastructure/docker/web.Dockerfile -t omniroute-web:verify \
  --build-arg NEXT_PUBLIC_API_URL=https://api.ci.invalid \
  --build-arg RENDER_API_ORIGIN=https://api.ci.invalid . || build_failed=true
docker build -f infrastructure/docker/ai-router.Dockerfile -t omniroute-ai-router:verify . || build_failed=true
if [ "$build_failed" = true ]; then exit 1; fi

api=$(docker run -d --network none \
  -e API_PUBLIC_URL=https://api.ci.invalid -e WEB_APP_URL=https://app.ci.invalid \
  -e CORS_ORIGIN=https://app.ci.invalid -e AUTH_COOKIE_DOMAIN=ci.invalid \
  -e AUTH_SESSION_SECRET=synthetic-container-test-secret-32-characters \
  -e GOOGLE_CLIENT_ID=synthetic-client -e GOOGLE_CLIENT_SECRET=synthetic-secret \
  -e DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unavailable \
  -e FILES_STORAGE_DRIVER=supabase -e SUPABASE_STORAGE_BUCKET=synthetic-private-files \
  -e SUPABASE_SERVICE_ROLE_KEY=synthetic-service-role-key -e SUPABASE_URL=https://supabase.ci.invalid \
  -e EMBEDDING_PROVIDER=disabled \
  -e OTEL_SDK_DISABLED=true omniroute-api:verify)
containers+=("$api")
web=$(docker run -d --network none omniroute-web:verify)
containers+=("$web")
router=$(docker run -d --network none omniroute-ai-router:verify)
containers+=("$router")

ready=false
for attempt in {1..30}; do
  if docker exec "$api" node -e "fetch('http://localhost:4000/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" &&
    docker exec "$web" node -e "fetch('http://localhost:3000/login').then(async r=>process.exit(r.ok&&(await r.text()).includes('https://api.ci.invalid/v1/auth/google')?0:1)).catch(()=>process.exit(1))" &&
    docker exec "$router" python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health/ready', timeout=2)"; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  for container in "${containers[@]}"; do docker logs "$container"; done
  exit 1
fi
for container in "${containers[@]}"; do
  test "$(docker inspect --format '{{.Config.User}}' "$container")" = omniroute
done
echo 'All three production images build, start without external services, and run as non-root.'
