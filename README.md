# bff-prisma

Backend-for-Frontend de P.R.I.S.M.A. Es la entrada única de la API REST para `prisma-front`: recibe cada petición `/api/*` y la reenvía al microservicio que corresponde. No tiene base de datos ni lógica de negocio, salvo el módulo del panel de control, que agrega datos de varios servicios.

P.R.I.S.M.A. es un sistema para docentes chilenos que genera rúbricas y material de evaluación adaptado para estudiantes con NEE.

## Qué hace

- Un único punto de acceso para el front, con una sola URL base y un solo CORS.
- Enruta cada petición al servicio destino y reenvía el encabezado `Authorization` sin modificarlo.
- Agrega datos en `/api/dashboard/*` (usuarios, jobs y colegios).
- Publica eventos de actividad de uso al tópico `prisma.activity-events` de Kafka, si `KAFKA_BOOTSTRAP_SERVERS` está definido. Es opcional y nunca bloquea una petición.

## Ruteo

| Ruta del BFF | Servicio destino |
|---|---|
| `/api/auth/*` | `prisma-ms-users` |
| `/api/colegios*` | `prisma-ms-users` (`/api/superadmin/colegios/*`) |
| `/api/admin/users*` | `prisma-ms-users` |
| `/api/admin/{tickets,resources,announcements,sessions,...}` | `prisma-adminpanel` |
| `/api/professors*` | `prisma-adminpanel` |
| `/api/students*`, `/api/students/paci-profiles/*` | `prisma-ms-perfil-alumno` (sin prefijo `/api`) |
| `/api/jobs/*` | `prisma-ms-docs` |
| `/api/dashboard/*` | Agrega users, docs y colegios |

El chat agéntico no pasa por el BFF: el front habla directo con `prisma_workflow`.

## Comportamientos que conviene conocer

- **No valida el JWT.** Lo reenvía y deja que el microservicio lo rechace. Un endpoint nuevo que no llame a ningún microservicio queda sin autenticación; hay que agregarla manualmente. En producción, el API Gateway valida el token antes de llegar aquí.
- **Los errores 4xx del servicio destino se devuelven con HTTP 200** y el error en el cuerpo (`{"statusCode":404,...}`), porque el cliente HTTP no lanza excepción para códigos menores a 500. Al depurar hay que mirar `statusCode` en el cuerpo.
- Cada controlador declara su propio prefijo `api/...`; no hay prefijo global.

## Stack

NestJS 10, `@nestjs/axios`, `@nestjs/config`, Swagger en `/docs`. Puerto 3010 (el valor por defecto del código es 3006; el despliegue usa 3010).

## Configuración

| Variable | Descripción |
|---|---|
| `PORT` | Puerto de escucha. |
| `CORS_ORIGIN` | Orígenes permitidos; vacío cuando el CORS lo hace el API Gateway. |
| `USERS_SERVICE_URL`, `DOCS_SERVICE_URL`, `PERFIL_SERVICE_URL`, `ADMINPANEL_SERVICE_URL` | URL de cada microservicio (en ECS, `http://localhost:<puerto>`). |
| `KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_ACTIVITY_TOPIC` | Opcionales; activan la publicación de actividad. |

## Ejecución y pruebas

```bash
npm install
npm run dev        # nest start --watch
npm test           # Jest
npm run build && npm start
```

## Despliegue

Imagen Docker publicada en ECR (`bff-prisma`) y ejecutada como contenedor de la tarea ECS `prisma-app`, detrás del ALB interno y del API Gateway. Ver `prisma-infra`.
