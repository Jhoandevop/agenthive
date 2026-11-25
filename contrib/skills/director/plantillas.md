# Plantillas del director

## Plan (uno por pedido grande)

```markdown
# Plan del <fecha>: <tema>

Pedido del usuario (<hora>, en el chat): «<cita>».

## Reparto
| # | Quién | Dónde (repo / rama / worktree) | Qué | Estado |
|---|---|---|---|---|
| 1 | <agente> | <ruta>, rama `<rama>` | <entrega concreta> | en curso |

## Contratos entre piezas
- `<endpoint o archivo>`: <formato exacto, códigos, casos de error>.

## Causas encontradas
- <síntoma> → <causa con archivo:línea> → <arreglo propuesto>.
```

## Encargo (lo que recibe un agente)

```text
<Qué es, en una línea>. Lo pidió <usuario> el <fecha> en el chat de <director>; el plan está en <ruta>, punto <n>.

Lee primero: <archivos>.
Reglas duras: solo local; sin push ni despliegue; no tocar <rutas>; sin secretos; <reglas de marca>.

Pasos:
1. …
2. …

Verifica: <tipos>, <pruebas>, <build>, <e2e>; capturas en <ruta>, a 375 px y en escritorio.
Commits locales por tema, con el pie de atribución.
Informe breve: hashes, conteos exactos, capturas, lo que quedó abierto y lo que no pudiste probar.
Si un permiso te bloquea, para y repórtalo; no busques otra vía.
```

## Relevo (punto de retorno)

```markdown
# Relevo <fecha> (<director> a cargo)

## Órdenes del usuario
- «<cita>» (<hora>)

## Quién hace qué
| Agente | Carpeta | Tarea | Entrega / marca de terminado |

## Al retomar
1. ¿Siguen vivos los bucles? (`pgrep -af <patrón>`) ¿Se cortaron por cupo? (cola del log)
2. Lee las entregas de la tabla.
3. Verifica tú: <comandos exactos>.
4. Commits que falten (locales), bitácora y plan.
5. Cierre: sesiones quietas → borrar crons → <apagar o terminar>.

## Estado HH:MM
- <hecho, con hash y conteos>
- Siguiente: <paso concreto>
```

## Índice de entregas (lo que lee el usuario)

```markdown
# <Tema>: para <usuario>

Todo está solo en local: ramas propias, sin push ni despliegue.

| Rama `hash` | Repo / worktree | Qué hace | Cómo verla | Pruebas (verificadas por el director) |
|---|---|---|---|---|

**Para decidir:** <pregunta> → <recomendación>.
**No probado:** <qué y por qué>.
```
