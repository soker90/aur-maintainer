# AUR Maintainer

Una GitHub Action para automatizar el mantenimiento de paquetes de Arch Linux en
AUR.

> **Estado:** desarrollo inicial. La API pública y el formato de configuración
> todavía no son estables.

## Funcionalidades previstas

- Detectar nuevas versiones upstream mediante conectores reutilizables.
- Admitir releases de GitHub y tags de versión de GitHub.
- Admitir conectores personalizados a nivel de repositorio y de paquete.
- Actualizar `PKGBUILD` y regenerar `.SRCINFO`.
- Validar paquetes con las herramientas de Arch Linux.
- Crear y mantener pull requests de actualización.
- Permitir opcionalmente el merge automático después de la validación.
- Publicar los paquetes mantenidos en Arch User Repository (AUR).

## Estructura del repositorio

El modelo previsto para los usuarios es deliberadamente pequeño:

```text
repository/
├── .aur-maintainer.yml       # configuración global opcional
├── packages/                 # opcional; los paquetes también pueden estar
│                              # en la raíz
│   └── example-bin/
│       ├── PKGBUILD
│       ├── .SRCINFO
│       └── update.yml
└── connectors/               # conectores locales opcionales del repositorio
    └── example/
```

Un paquete declara cómo se descubre su upstream en `update.yml`:

```yaml
connector: github-tag
config:
  repository: stacklok/toolhive-studio
```

Para repositorios que publican versiones como Git tags sin GitHub Releases,
utiliza el conector `github-tag`:

```yaml
connector: github-tag
config:
  repository: owner/project
```

La configuración global puede restringir qué directorios de paquetes se
gestionan:

```yaml
packages:
  - packages/example-bin
```

Los conectores personalizados locales del repositorio se encuentran en
`connectors/`. Cada conector utiliza un directorio con el nombre del conector y
un módulo ESM en `connectors/<name>/index.js`:

```text
connectors/
└── example/
    └── index.js
```

El módulo debe exportar por defecto una factoría que reciba el mismo contexto de
conector que los conectores integrados y devuelva un conector con un `name`
coincidente:

```js
export default (context) => ({
  name: 'example',
  detect: async (pkg, config) => {
    const response = await context.fetch(config.url)
    const data = await response.json()

    return { version: data.version }
  }
})
```

El paquete lo selecciona normalmente desde `update.yml`:

```yaml
connector: example
config:
  url: https://example.com/releases/latest.json
```

Los conectores locales del repositorio solo se cargan desde los directorios
`connectors/<name>/index.js` del propio repositorio. Un conector local no puede
sustituir a un conector integrado con el mismo nombre, y el nombre del conector
devuelto debe coincidir con el nombre del directorio. Los conectores genéricos
siguen siendo proporcionados por esta Action.

Un paquete puede mapear opcionalmente los metadatos del conector a asignaciones
de PKGBUILD mediante la sección `updates`. El campo `version` siempre actualiza
`pkgver`; los campos de origen y checksum son opcionales porque la estructura de
los paquetes puede variar:

```yaml
connector: custom
config: {}
timeout: 60 # sobrescribe el valor predeterminado de 30 segundos
updates:
  source: 'source=("vega-${version}.tar.gz::${source}")'
  sha256: '_sha256=${sha256}'
```

Los conectores locales tienen un tiempo máximo de ejecución de 30 segundos por
defecto. Puedes sobrescribirlo con `timeout`, expresado en segundos. Debe ser un
entero positivo. Si se alcanza, la Action indica el paquete afectado y conserva
la causa original para facilitar el diagnóstico y conservar el contexto del
error.

Cada mapeo es una plantilla completa de asignación de PKGBUILD. Los placeholders
admitidos son `${version}`, `${source}` y `${sha256}`. Esto mantiene explícita
la nomenclatura de los sources específica de cada paquete, en lugar de hacer que
la Action tenga que inferir la estructura del PKGBUILD.

## Uso

La interfaz prevista es una única Action:

```yaml
permissions:
  contents: write
  pull-requests: write

steps:
  - uses: soker90/aur-maintainer@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
```

Cuando se proporciona `github-token`, la Action confirma las actualizaciones de
los paquetes validadas en `update-branch` y abre un pull request de
actualización contra `base-branch`. Sin un token, las actualizaciones de los
paquetes siguen aplicándose al workspace, pero no se crea ningún pull request.

La configuración y el conjunto final de inputs se documentarán cuando esté lista
la primera implementación estable.

## Desarrollo

Este repositorio se inició a partir de la
[plantilla de GitHub para Actions en TypeScript](https://github.com/actions/typescript-action).

Instala las dependencias y ejecuta la suite de tests con:

```bash
npm install
npm test
```

El bundle distribuible se genera con:

```bash
npm run bundle
```

El directorio generado `dist/` se incluye en el repositorio porque GitHub
ejecuta las JavaScript Actions directamente desde el bundle incluido en el
repositorio.
