# 🏗️ Infraestructura ML con AWS CDK

Este proyecto crea infraestructura AWS para Machine Learning usando CDK, EC2 y FastAPI.

## 📋 Requisitos Previos

- ☁️ AWS CLI configurado con credenciales apropiadas
- 📦 Node.js y npm instalados
- 🛠️ AWS CDK instalado globalmente: `npm install -g aws-cdk`

## 🏗️ Arquitectura de Infraestructura AWS

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              🌐 Internet                                        │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         📍 IP Elástica (Fija)                                  │
│                  (Se mantiene después de cdk destroy)                           │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           🛡️ Grupo de Seguridad                                │
│                   • Puerto 22 (SSH) - 0.0.0.0/0                               │
│                   • Puerto 8000 (FastAPI) - 0.0.0.0/0                         │
│                   • Todo el Tráfico de Salida                                  │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              🏢 VPC (us-east-2)                                │
│                              Máx AZs: 2                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                       🌐 Subred Pública                                 │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │                     💻 Instancia EC2                            │   │   │
│  │  │                   t3.micro (Capa Gratuita)                     │   │   │
│  │  │                Amazon Linux 2023 AMI                           │   │   │
│  │  │                                                                 │   │   │
│  │  │  🔑 Par de Claves: infra-ml-keypair                            │   │   │
│  │  │  🔒 Rol IAM: EC2Role                                           │   │   │
│  │  │     • AmazonEC2ContainerRegistryReadOnly                        │   │   │
│  │  │     • ECR GetAuthorizationToken                                 │   │   │
│  │  │                                                                 │   │   │
│  │  │  📦 Contenedor Docker (Puerto 8000)                            │   │   │
│  │  │     ml-santiago-api:latest                                      │   │   │
│  │  │     Auto-reinicio habilitado                                    │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          📦 Amazon ECR (us-east-2)                             │
│            750477224025.dkr.ecr.us-east-2.amazonaws.com                       │
│                       ml-santiago-api:latest                                   │
│                           (Imagen 567MB)                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

🔄 Flujo del Script User Data:
1. 📥 Actualizaciones del Sistema (yum update, instalar docker, unzip)
2. 🐳 Configuración del Servicio Docker (iniciar, habilitar, agregar ec2-user al grupo docker)
3. ☁️ Instalación de AWS CLI v2
4. ⏳ Espera de Propagación de Permisos IAM (60s)
5. 🔐 Autenticación ECR (región: us-east-2)
6. 📦 Descarga de Imagen Docker (con lógica de reintentos)
7. 🚀 Despliegue del Contenedor (puerto 8000, auto-reinicio)
8. 📊 Registro de Estado (/tmp/deployment-status.txt)

🌍 Región: us-east-2 (Fija)
💰 Optimización de Costos: t3.micro (Elegible para Capa Gratuita)
🔒 Seguridad: Roles IAM con permisos mínimos requeridos
```

## 📁 Estructura del Proyecto

```
infra-ml/
├── bin/
│   └── infra-ml.ts          # 🚀 Punto de entrada de la aplicación CDK
├── lib/
│   └── infra-ml-stack.ts    # 🏢 Stack principal de infraestructura
├── test/
│   └── infra-ml.test.ts     # 🧪 Pruebas unitarias
├── cdk.json                 # ⚙️ Configuración de CDK
├── package.json             # 📋 Dependencias de Node.js
└── README.md               # 📖 Este archivo
```

## 🚀 Inicio Rápido

### 1️⃣ Instalar Dependencias

```bash
npm install
```

### 2️⃣ Crear Par de Claves SSH

```bash
# Crear par de claves y guardar localmente
aws ec2 create-key-pair --key-name infra-ml-keypair --query 'KeyMaterial' --output text > ./infra-ml-keypair.pem

# Establecer permisos correctos (Windows)
icacls .\infra-ml-keypair.pem /inheritance:r /grant:r "%USERNAME%:(R)"
```

### 3️⃣ Desplegar Infraestructura

```bash
# Inicializar CDK (solo necesario una vez por cuenta/región AWS)
cdk bootstrap

# Desplegar el stack
npm run deploy
```

### 4️⃣ Obtener IP Pública de la Instancia EC2

```bash
aws ec2 describe-instances --filters "Name=tag:aws:cloudformation:stack-name,Values=InfraMlStack" --query 'Reservations[*].Instances[*].PublicIpAddress' --output text
```

### 5️⃣ Probar FastAPI

```bash
# Reemplaza PUBLIC_IP con la IP pública de tu instancia
curl http://PUBLIC_IP:8000/
```

## 🔐 Conexión SSH

### Conectarse a la Instancia EC2

```bash
# Conectar vía SSH
ssh -i ./infra-ml-keypair.pem ec2-user@PUBLIC_IP
```

## 🧹 Limpieza

```bash
# Destruir infraestructura
cdk destroy
```

# 📜 Scripts de Despliegue

## 💻 Comandos disponibles

### 🔄 Despliegue completo con commit automático
```bash
npm run auto-deploy
```
- 🔨 Compila el proyecto
- 🧪 Ejecuta tests
- 🚀 Hace deploy con CDK
- 📝 Crea commit automático con timestamp del deploy

### ⚡ Despliegue rápido
```bash
npm run quick-deploy
```
- 🚀 Deploy directo sin validaciones
- 📝 Crea commit automático

## ✅ Requisitos
- 📝 Git configurado
- ☁️ AWS CLI configurado
- 🛠️ CDK instalado
