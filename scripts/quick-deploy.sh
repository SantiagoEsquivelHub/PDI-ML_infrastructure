#!/bin/bash

# Script de despliegue rapido sin verificaciones
# Para uso cuando solo quieres deployar rapido

set -e

echo "🚀 Despliegue rapido iniciado..."

# Variables para el historial
TIMESTAMP_ISO=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
TIMESTAMP_COMMIT=$(date +'%Y-%m-%d %H:%M:%S')
DEPLOYED_BY=$(whoami)
DEPLOY_START_TIME=$(date +%s)

# Intentar hacer el deploy
echo "📦 Iniciando build y deploy..."
if npm run build && npm run deploy; then
    DEPLOY_STATUS="SUCCESS"
    echo "✅ Deploy exitoso"
else
    DEPLOY_STATUS="FAILED"
    echo "❌ Deploy falló"
fi

DEPLOY_END_TIME=$(date +%s)
DEPLOY_DURATION=$((DEPLOY_END_TIME - DEPLOY_START_TIME))

# Llenar la tabla de historial
echo "📝 Actualizando historial de despliegues..."
echo "$TIMESTAMP_ISO,$DEPLOY_STATUS,$DEPLOYED_BY,Quick deploy - Duration: ${DEPLOY_DURATION}s" >> deploy-history.csv
echo "✅ Historial actualizado"

# Commit automatico
git add outputs.json cdk.out/ lib/infra-ml-stack.ts deploy-history.csv 2>/dev/null || true

if [ -n "$(git diff --cached --name-only)" ]; then
    git commit -m "🚀 Quick deploy: $TIMESTAMP_COMMIT - Status: $DEPLOY_STATUS"
    echo "✅ Commit de despliegue creado"
else
    echo "ℹ️  No hay cambios para commitear"
fi

echo "✅ Proceso completado - Status: $DEPLOY_STATUS"
