# AUR Maintainer

Documentación en español de la GitHub Action para automatizar el mantenimiento
de paquetes de Arch Linux en AUR. La documentación inglesa está en
[README.md](README.md).

> **Importante:** la validación ejecuta PKGBUILD y conectores personalizados.
> Son código ejecutable. No expongas credenciales AUR a pull requests no
> confiables.

## Qué hace

- Descubre paquetes desde .aur-maintainer.yml o mediante descubrimiento
  automático.
- Detecta versiones con github-release o github-tag.
- Permite conectores JavaScript de repositorio y conectores shell por paquete.
- Actualiza pkgver y, mediante plantillas, source y SHA-256.
- Regenera y comprueba .SRCINFO.
- Valida con namcap, makepkg y pacman, con fallback Docker de Arch Linux.
- Crea una rama y una PR por actualización.
- Puede hacer squash-merge automático.
- Puede publicar en AUR mediante SSH.
- Puede sincronizar el estado actual mediante aur-publish-only.

## Uso básico

```yaml
name: Maintain AUR

on:
  schedule:
    - cron: '17 */6 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  maintain:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: soker90/aur-maintainer@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input              | Por defecto         | Descripción                                                       |
| ------------------ | ------------------- | ----------------------------------------------------------------- |
| config             | .aur-maintainer.yml | Configuración global.                                             |
| github-token       | —                   | Token para API, ramas, PR, issues y merge.                        |
| update-branch      | update              | Prefijo de ramas de actualización.                                |
| base-branch        | main                | Rama base de las PR.                                              |
| auto-merge         | false               | Esperar checks y hacer squash-merge.                              |
| auto-merge-timeout | 1800                | Tiempo máximo de espera de checks, en segundos.                   |
| aur-publish        | false               | Publicar la actualización validada en AUR.                        |
| aur-publish-only   | false               | Publicar el estado actual sin detectar upstream; tiene prioridad. |
| aur-ssh-key        | —                   | Clave SSH privada autorizada en AUR.                              |
| aur-known-hosts    | —                   | Host keys confiables de aur.archlinux.org.                        |

github-token es obligatorio si auto-merge está activado. Los inputs SSH son
obligatorios para publicar.

## Outputs

- packages: JSON con paquetes inspeccionados, candidatos y resultados.
- pull-request: URL de la primera PR creada.
- pull-requests: JSON con las URLs de las PR.
- validation-failure-issue: URL del issue creado tras un fallo de validación.

## Configuración

Configuración central:

```yaml
packages:
  - path: example-bin
    connector: github-release
    config:
      repository: owner/project
    updates: {}
```

Si no se define packages, se descubre la raíz si contiene PKGBUILD y los
directorios directos de packages/.

Configuración local:

```yaml
connector: github-release
config:
  repository: owner/project
updates: {}
```

También se admite connector/update.yml para conectores personalizados de
paquete. No deben existir a la vez update.yml y connector/update.yml.

## Conectores

github-release usa el último GitHub Release. github-tag consulta los tags y
selecciona la versión Arch más alta.

Conector JavaScript de repositorio:

```text
connectors/<name>/index.js
```

Debe exportar por defecto una factoría que devuelva un conector con name
coincidente.

Conector shell de paquete:

```yaml
connector: custom
timeout: 120
config:
  channel: stable
updates:
  source: 'source=("example-${version}.tar.gz::${source}")'
  sha256: 'sha256sums=("${sha256}")'
```

El script connector/detect.sh recibe AUR_MAINTAINER_PACKAGE,
AUR_MAINTAINER_PACKAGE_PATH y AUR_MAINTAINER_CONFIG_JSON y debe imprimir:

```text
version=1.2.3
source=https://example.com/example-1.2.3.tar.gz
sha256=0123456789abcdef...
```

El timeout por defecto es 30 segundos.

## Validación

La secuencia es:

1. updpkgsums.
2. Regeneración de .SRCINFO.
3. namcap sobre PKGBUILD.
4. makepkg --verifysource.
5. Comprobación de .SRCINFO.
6. makepkg -sf --noconfirm.
7. Comprobación de artefactos.
8. namcap sobre artefactos.
9. pacman -U --noconfirm.

Si las herramientas no están disponibles, se usa Docker con Arch Linux.

Si falla la validación, los cambios se conservan y se crea un issue cuando hay
autenticación de GitHub.

## Pull requests y auto-merge

Cada actualización genera una rama específica, por ejemplo update/vega-cli-bin
si update-branch es update.

Solo se procesa el primer paquete actualizado de cada ejecución para mantener PR
pequeñas.

Con auto-merge: true la Action espera los check runs y hace squash-merge cuando
la PR es mergeable. auto-merge-timeout es la ventana máxima, no un retraso
obligatorio.

## Publicación AUR

```yaml
- uses: soker90/aur-maintainer@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    aur-publish: true
    aur-ssh-key: ${{ secrets.AUR_SSH_PRIVATE_KEY }}
    aur-known-hosts: ${{ secrets.AUR_KNOWN_HOSTS }}
```

La publicación ocurre después de validar el paquete, usa comprobación estricta
de host SSH y publica en master. El contenido del repositorio AUR se sincroniza
con el directorio gestionado, incluyendo la eliminación de archivos versionados
que ya no existen.

aur-publish-only evita la detección upstream y publica el estado actual.

## Seguridad

No ejecutes esta Action con claves AUR ni otros secretos de escritura sobre
código no confiable.

Evita pull_request_target cuando se haga checkout y ejecución de código no
confiable. Para publicar es preferible un workflow programado/manual de
confianza.

Usa permisos mínimos para GITHUB_TOKEN, una clave AUR dedicada y revocable y
runners efímeros cuando sea posible.

## Problemas habituales

- No hay paquetes: revisa config, rutas y PKGBUILD.
- Error API: comprueba owner/name, permisos y rate limits.
- No hay validación: comprueba herramientas Arch o Docker.
- .SRCINFO incorrecto: ejecuta updpkgsums PKGBUILD y makepkg --printsrcinfo >
  .SRCINFO.
- No hay auto-merge: revisa token, permisos, checks y timeout.
- Falla AUR: revisa clave SSH, known-hosts, acceso y rama master.

## Desarrollo

```bash
npm ci
npm run format:check
npm run lint
npm run ci-test
npm run package
```

dist se versiona porque GitHub ejecuta el bundle incluido en la Action.

## Releases

Las versiones siguen SemVer: v1.0.0, v1.0.1, etc. El tag v1 apunta a la última
release compatible.

Uso recomendado:

```yaml
uses: soker90/aur-maintainer@v1
```

También puedes fijar un SHA completo.

## Licencia

MIT. Consulta LICENSE.
