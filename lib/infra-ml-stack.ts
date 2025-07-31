import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export class InfraMlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region: 'us-east-2',
        ...props?.env,
      },
    });

    // Crear una VPC básica
    const vpc = new ec2.Vpc(this, 'InfraMlVpc', {
      maxAzs: 2,
    });

    // Crear un Security Group que permita el tráfico al puerto 8000 (FastAPI) y 443 para HTTPS
    const securityGroup = new ec2.SecurityGroup(this, 'InfraMlSG', {
      vpc,
      description: 'Permite trafico al puerto 8000 para FastAPI, 443 para HTTPS y 22 para SSH',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8000), 'Permitir acceso al puerto 8000');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Permitir acceso HTTPS');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Permitir acceso HTTP');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Permitir acceso SSH');

    // Crear rol IAM para la instancia EC2 con permisos para ECR
    const ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
      inlinePolicies: {
        ECRLoginPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:GetAuthorizationToken',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Crear Instance Profile explicitamente para asegurar asociacion correcta
    const instanceProfile = new iam.CfnInstanceProfile(this, 'EC2InstanceProfile', {
      roles: [ec2Role.roleName],
    });

    // Crear una instancia EC2 con el Security Group y rol IAM
    const instance = new ec2.Instance(this, 'InfraMlInstance', {
      vpc,
      securityGroup,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      keyName: 'infra-ml-keypair',
      role: ec2Role,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      associatePublicIpAddress: true,
    });

    // User data mejorado con region fija, NGINX para SSL, y mejor manejo de errores
    instance.addUserData(
      'yum update -y',
      'yum install -y docker unzip nginx openssl',
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      
      // Instalar AWS CLI v2 y configurar PATH
      'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"',
      'unzip awscliv2.zip',
      './aws/install',
      'export PATH="/usr/local/bin:$PATH"',
      
      // Esperar a que los permisos IAM se propaguen
      'sleep 60',
      
      // Verificar que AWS CLI funciona y obtener identidad
      '/usr/local/bin/aws sts get-caller-identity > /tmp/aws-identity.txt 2>&1',
      
      // Configurar region fija us-east-2
      'REGION=us-east-2',
      
      // Login a ECR con manejo de errores y region fija
      '/usr/local/bin/aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin 750477224025.dkr.ecr.$REGION.amazonaws.com > /tmp/ecr-login.txt 2>&1',
      
      // Pull de la imagen con retry en caso de fallos temporales
      'for i in {1..3}; do docker pull 750477224025.dkr.ecr.$REGION.amazonaws.com/ml-santiago-api:latest && break || sleep 10; done',

      // Ejecutar el contenedor en el puerto 8000
      'docker run -d -p 8000:8000 --name ml-api --restart unless-stopped 750477224025.dkr.ecr.$REGION.amazonaws.com/ml-santiago-api:latest',

      // Generar certificado SSL autofirmado para NGINX
      'mkdir -p /etc/ssl/private',
      'openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/nginx-selfsigned.key -out /etc/ssl/certs/nginx-selfsigned.crt -subj "/C=US/ST=OH/L=Columbus/O=MLApi/CN=ml-api"',
      
      // Configurar NGINX como proxy reverso con SSL
      'cat > /etc/nginx/nginx.conf << EOF',
      'user nginx;',
      'worker_processes auto;',
      'error_log /var/log/nginx/error.log;',
      'pid /run/nginx.pid;',
      '',
      'events {',
      '    worker_connections 1024;',
      '}',
      '',
      'http {',
      '    log_format main \'\\$remote_addr - \\$remote_user [\\$time_local] "\\$request" \'',
      '                    \'\\$status \\$body_bytes_sent "\\$http_referer" \'',
      '                    \'"\\$http_user_agent" "\\$http_x_forwarded_for"\';',
      '',
      '    access_log /var/log/nginx/access.log main;',
      '',
      '    sendfile on;',
      '    tcp_nopush on;',
      '    tcp_nodelay on;',
      '    keepalive_timeout 65;',
      '    types_hash_max_size 2048;',
      '',
      '    include /etc/nginx/mime.types;',
      '    default_type application/octet-stream;',
      '',
      '    # Redirigir HTTP a HTTPS',
      '    server {',
      '        listen 80;',
      '        server_name _;',
      '        return 301 https://\\$server_name\\$request_uri;',
      '    }',
      '',
      '    # Servidor HTTPS con proxy a FastAPI',
      '    server {',
      '        listen 443 ssl;',
      '        server_name _;',
      '',
      '        ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;',
      '        ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;',
      '',
      '        ssl_protocols TLSv1.2 TLSv1.3;',
      '        ssl_ciphers HIGH:!aNULL:!MD5;',
      '',
      '        # Configuracion CORS para frontend',
      '        add_header Access-Control-Allow-Origin "*" always;',
      '        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;',
      '        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;',
      '',
      '        location / {',
      '            if (\\$request_method = OPTIONS) {',
      '                return 204;',
      '            }',
      '            proxy_pass http://localhost:8000;',
      '            proxy_set_header Host \\$host;',
      '            proxy_set_header X-Real-IP \\$remote_addr;',
      '            proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;',
      '            proxy_set_header X-Forwarded-Proto \\$scheme;',
      '        }',
      '    }',
      '}',
      'EOF',
      
      // Iniciar NGINX
      'systemctl start nginx',
      'systemctl enable nginx',

      // Verificar que el contenedor este corriendo y crear logs de status
      'sleep 15',
      'docker ps > /tmp/docker-status.txt',
      'docker logs ml-api > /tmp/ml-api-logs.txt 2>&1',
      'nginx -t > /tmp/nginx-test.txt 2>&1',
      'systemctl status nginx > /tmp/nginx-status.txt 2>&1',
      'echo "ML API deployment with SSL completed in us-east-2" > /tmp/deployment-status.txt'
    );

    // Crear una Elastic IP para mantener la IP fija
    // IMPORTANTE: Esta IP se mantiene incluso despues de cdk destroy
    const elasticIp = new ec2.CfnEIP(this, 'InfraMlElasticIP', {
      domain: 'vpc',
      instanceId: instance.instanceId,
    });
    
    // Configurar politica de retencion para mantener la IP despues de destroy
    elasticIp.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);


    // Outputs utiles
    new cdk.CfnOutput(this, 'ElasticIP', {
      value: elasticIp.ref,
      description: 'IP elastica fija de la instancia EC2 (se mantiene despues de destroy)'
    });

    new cdk.CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      description: 'IP publica de la instancia EC2'
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'ID de la instancia EC2'
    });

    new cdk.CfnOutput(this, 'ApiHealthUrl', {
      value: `http://${elasticIp.ref}:8000/`,
      description: 'URL para verificar el estado de la API (HTTP directo - solo testing)'
    });

    new cdk.CfnOutput(this, 'ApiHttpsUrl', {
      value: `https://${elasticIp.ref}/`,
      description: 'URL HTTPS de la API con SSL (usar esta para frontend de produccion)'
    });

    new cdk.CfnOutput(this, 'ApiHttpUrl', {
      value: `http://${elasticIp.ref}/`,
      description: 'URL HTTP de la API (redirige automaticamente a HTTPS)'
    });

    new cdk.CfnOutput(this, 'SSHCommand', {
      value: `ssh -i ./infra-ml-keypair.pem ec2-user@${elasticIp.ref}`,
      description: 'Comando SSH para conectarse a la instancia'
    });

    new cdk.CfnOutput(this, 'ECRImageInfo', {
      value: '750477224025.dkr.ecr.us-east-2.amazonaws.com/ml-santiago-api:latest (567MB)',
      description: 'Informacion de la imagen ECR deployada'
    });

    // Output con informacion importante sobre la Elastic IP
    new cdk.CfnOutput(this, 'ElasticIPWarning', {
      value: 'IMPORTANTE: La Elastic IP se mantiene despues de destroy. Para eliminarla manualmente: aws ec2 release-address --allocation-id <allocation-id>',
      description: 'Instrucciones para manejo manual de Elastic IP'
    });

    // Output para verificar la region de deploy
    new cdk.CfnOutput(this, 'DeployRegion', {
      value: 'us-east-2',
      description: 'Region fija donde se despliega la infraestructura'
    });

    // Output con comandos de debugging para ECR
    new cdk.CfnOutput(this, 'ECRDebugCommands', {
      value: 'ssh -i ~/.ssh/infra-ml-keypair.pem ec2-user@' + elasticIp.ref + ' "sudo cat /var/log/cloud-init-output.log | grep -A5 -B5 ecr"',
      description: 'Comando para revisar logs de ECR en la instancia'
    });

    // Output importante sobre SSL
    new cdk.CfnOutput(this, 'SSLInfo', {
      value: 'Certificado SSL autofirmado configurado con NGINX. La API esta disponible via HTTPS. HTTP redirige automaticamente a HTTPS.',
      description: 'Informacion sobre configuracion SSL/TLS'
    });

    // Output para debugging de SSL
    new cdk.CfnOutput(this, 'SSLDebugCommands', {
      value: 'ssh -i ./infra-ml-keypair.pem ec2-user@' + elasticIp.ref + ' "sudo nginx -t && sudo systemctl status nginx"',
      description: 'Comandos para verificar configuracion SSL/NGINX'
    });
  }
}


