#!/bin/bash

# Script para limpiar completamente el stack InfraMl incluyendo Elastic IPs
# Uso: ./cleanup-complete.sh

set -e

echo "🗑️  Iniciando limpieza completa del stack InfraMl..."

# Paso 1: Destruir el stack CDK
echo "📦 Destruyendo stack CDK..."
cdk destroy --force

echo "✅ Stack CDK destruido"

# Paso 2: Buscar y eliminar Elastic IPs huerfanas
echo "🔍 Buscando Elastic IPs huerfanas..."

# Obtener Elastic IPs que no estan asociadas a instancias
ORPHANED_IPS=$(aws ec2 describe-addresses --region us-east-2 --query 'Addresses[?AssociationId==null].AllocationId' --output text)

if [ -z "$ORPHANED_IPS" ]; then
    echo "✅ No hay Elastic IPs huerfanas"
else
    echo "🧹 Eliminando Elastic IPs huerfanas..."
    for ALLOCATION_ID in $ORPHANED_IPS; do
        echo "   Eliminando: $ALLOCATION_ID"
        aws ec2 release-address --allocation-id $ALLOCATION_ID --region us-east-2
        echo "   ✅ Eliminada: $ALLOCATION_ID"
    done
fi

# Paso 3: Verificacion final
echo "🔍 Verificacion final..."

echo "📋 Stacks CDK restantes:"
cdk list || echo "   No hay stacks CDK"

echo "📋 Elastic IPs restantes:"
REMAINING_IPS=$(aws ec2 describe-addresses --region us-east-2 --query 'Addresses[].{IP:PublicIp,AllocationId:AllocationId}' --output table)
if [ -z "$REMAINING_IPS" ]; then
    echo "   No hay Elastic IPs"
else
    echo "$REMAINING_IPS"
fi

echo ""
echo "🎉 Limpieza completa terminada!"
echo "💡 Tu cuenta AWS esta ahora completamente limpia del proyecto InfraMl"
