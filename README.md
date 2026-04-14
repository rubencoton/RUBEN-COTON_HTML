# RUBEN-COTON_HTML

Aplicacion local de email marketing con plantillas HTML.

## Objetivo

Crear y gestionar correos HTML para campanas de mensajeria.
Plantillas reutilizables, previsualizacion local, listas para enviar.

## Estructura

```
RUBEN-COTON_HTML/
├── README.md
├── templates/          # Plantillas HTML de correos
│   └── base.html       # Plantilla base reutilizable
├── assets/
│   ├── css/            # Estilos inline-ready para email
│   └── img/            # Imagenes para campanas
├── campaigns/          # Correos finales listos para enviar
└── preview/            # Previsualizacion local en navegador
    └── index.html      # Vista previa de plantillas
```

## Uso

1. Crear plantilla en `templates/`
2. Previsualizar abriendo `preview/index.html` en navegador
3. Copiar HTML final desde `campaigns/` para enviar

## Stack

- HTML + CSS inline (compatibilidad email)
- Sin dependencias externas
- Ejecucion 100% local

## Autor

RUBEN COTON
